//! Polite request pacing for every Moodle request.
//!
//! Muster deliberately behaves like a careful human user rather than a crawler:
//! each request must first win a concurrency slot and then wait for a minimum
//! gap since the previous request started. A full sync of ~12 courses fetches
//! a few hundred pages; without pacing that is a burst that looks like a bot,
//! with pacing it is a slow, steady, human-like stream that stays well within
//! what the university's systems expect.
//!
//! Only Moodle page fetches are paced. Login/SSO flows (auth.rs) and the
//! user's own AI provider calls are intentionally not throttled: they are
//! one-off and user-initiated.

use std::time::Duration;

use tokio::sync::{Mutex, Semaphore, SemaphorePermit};
use tokio::time::Instant;

/// Tunable pacing parameters.
#[derive(Debug, Clone, Copy)]
pub struct ThrottleConfig {
    /// Minimum gap between two request *starts*.
    pub min_interval: Duration,
    /// Maximum number of Moodle requests in flight at the same time.
    pub max_concurrency: usize,
}

impl Default for ThrottleConfig {
    fn default() -> Self {
        Self {
            // Balance between politeness and UX: a full sync of ~12 courses
            // (~300+ pages incl. per-assignment detail pages) is gated by the
            // global start-interval: 100ms made that floor alone ~30s and the
            // sync felt dead-slow. 40ms keeps a global pace cap (<=25 starts/s,
            // still far gentler than a crawler) while cutting that floor ~2.5x.
            // Concurrency 16 keeps slots well utilized (see acquire() order
            // change: interval wait happens BEFORE taking a slot).
            // Tune with MUSTER_THROTTLE_MS / MUSTER_THROTTLE_CONCURRENCY.
            min_interval: Duration::from_millis(40),
            max_concurrency: 16,
        }
    }
}

impl ThrottleConfig {
    /// Build the config from `MUSTER_THROTTLE_*` env vars (used for tuning and
    /// testing; a release build without these vars just uses the defaults).
    /// `MUSTER_THROTTLE_OFF=1` disables pacing entirely (dev convenience).
    pub fn from_env() -> Self {
        let mut cfg = Self::default();
        if let Ok(ms) = std::env::var("MUSTER_THROTTLE_MS") {
            if let Ok(ms) = ms.parse::<u64>() {
                cfg.min_interval = Duration::from_millis(ms);
            }
        }
        if let Ok(n) = std::env::var("MUSTER_THROTTLE_CONCURRENCY") {
            if let Ok(n) = n.parse::<usize>() {
                if n > 0 {
                    cfg.max_concurrency = n;
                }
            }
        }
        if std::env::var("MUSTER_THROTTLE_OFF").is_ok() {
            cfg.min_interval = Duration::ZERO;
            cfg.max_concurrency = 256;
        }
        cfg
    }
}

/// A permit that keeps one concurrency slot occupied until the request ends.
pub struct RequestPermit<'a> {
    _permit: SemaphorePermit<'a>,
}

/// Global gate shared by every Moodle fetch: caps concurrency AND enforces a
/// minimum interval between request starts.
#[derive(Debug)]
pub struct RequestGate {
    semaphore: Semaphore,
    last_request: Mutex<Instant>,
    min_interval: Duration,
}

impl RequestGate {
    pub fn new(config: ThrottleConfig) -> Self {
        Self {
            semaphore: Semaphore::new(config.max_concurrency),
            last_request: Mutex::new(Instant::now() - config.min_interval),
            min_interval: config.min_interval,
        }
    }

    /// Wait until this request may start, then return a permit that must be
    /// held for the duration of the request (it keeps the concurrency slot
    /// occupied until dropped).
    pub async fn acquire(&self) -> RequestPermit<'_> {
        // Wait for the minimum interval FIRST — without holding a concurrency
        // slot. This keeps every slot productive: no slot sits idle just
        // waiting for the interval to elapse. The slot is only taken once
        // the request is actually ready to fire.
        {
            let mut last = self.last_request.lock().await;
            let now = Instant::now();
            let since = now.duration_since(*last);
            if since < self.min_interval {
                let wait = self.min_interval - since;
                drop(last);
                tokio::time::sleep(wait).await;
                *self.last_request.lock().await = Instant::now();
            } else {
                *last = now;
            }
        }
        let permit = self
            .semaphore
            .acquire()
            .await
            .expect("request gate semaphore is never closed");
        RequestPermit { _permit: permit }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;

    #[tokio::test]
    async fn paces_requests_in_order() {
        let gate = Arc::new(RequestGate::new(ThrottleConfig {
            min_interval: Duration::from_millis(50),
            max_concurrency: 1,
        }));
        let start = Instant::now();
        {
            let _p = gate.acquire().await;
        }
        let t1 = start.elapsed();
        {
            let _p = gate.acquire().await;
        }
        let t2 = start.elapsed();
        assert!(t1 < Duration::from_millis(40), "first request should start immediately, took {:?}", t1);
        assert!(t2 >= Duration::from_millis(50), "second request should wait for the interval, took {:?}", t2);
    }

    #[tokio::test]
    async fn caps_concurrency() {
        let gate = Arc::new(RequestGate::new(ThrottleConfig {
            min_interval: Duration::ZERO,
            max_concurrency: 2,
        }));
        let p1 = gate.acquire().await;
        let p2 = gate.acquire().await;
        let mut p3 = Box::pin(gate.acquire());
        tokio::time::sleep(Duration::from_millis(30)).await;
        {
            let r = tokio::time::timeout(Duration::from_millis(10), p3.as_mut()).await;
            assert!(r.is_err(), "third permit must wait while two are held");
        }
        drop(p1);
        {
            let r = tokio::time::timeout(Duration::from_millis(500), p3.as_mut()).await;
            assert!(r.is_ok(), "third permit should be granted after a slot frees up");
        }
        drop(p2);
    }
}
