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

use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;

use tokio::sync::{Mutex, Semaphore, SemaphorePermit};
use tokio::time::Instant;

const MAX_INTERVAL: Duration = Duration::from_secs(60);
const MAX_CONCURRENCY: usize = 256;

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
            // Tune with MUSTER_THROTTLE_MS / MUSTER_THROTTLE_CONCURRENCY.
            min_interval: Duration::from_millis(100),
            max_concurrency: 24,
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
                cfg.min_interval = Duration::from_millis(ms).min(MAX_INTERVAL);
            }
        }
        if let Ok(n) = std::env::var("MUSTER_THROTTLE_CONCURRENCY") {
            if let Ok(n) = n.parse::<usize>() {
                cfg.max_concurrency = n.clamp(1, MAX_CONCURRENCY);
            }
        }
        if std::env::var("MUSTER_THROTTLE_OFF").as_deref() == Ok("1") {
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
    timing: Mutex<()>,
    schedule: std::sync::Mutex<Schedule>,
    min_interval: Duration,
    /// Total Moodle requests paced since the process started. Read out before/after
    /// a sync to measure the real per-sync request footprint (P0 baseline metric
    /// for the ChangeSignature fingerprint-sync design).
    counter: AtomicU64,
}

#[derive(Debug)]
struct Schedule {
    last_grant: Option<Instant>,
    deferred_until: Instant,
}

impl RequestGate {
    pub fn new(config: ThrottleConfig) -> Self {
        Self {
            semaphore: Semaphore::new(config.max_concurrency.clamp(1, MAX_CONCURRENCY)),
            timing: Mutex::new(()),
            schedule: std::sync::Mutex::new(Schedule {
                last_grant: None,
                deferred_until: Instant::now(),
            }),
            min_interval: config.min_interval.min(MAX_INTERVAL),
            counter: AtomicU64::new(0),
        }
    }

    /// Total requests paced so far (monotonic). Snapshot before and after a sync
    /// and diff the two to get the exact per-sync request footprint.
    pub fn total_count(&self) -> u64 {
        self.counter.load(Ordering::Relaxed)
    }

    /// Extend the shared cooldown, including requests already waiting to start.
    /// A short synchronous lock lets a response defer a sleeping timing waiter.
    /// Durations are bounded to one minute; later deferrals never shorten it.
    pub fn defer_for(&self, duration: Duration) {
        let until = Instant::now() + duration.min(MAX_INTERVAL);
        let mut schedule = self.schedule.lock().expect("gate schedule poisoned");
        schedule.deferred_until = schedule.deferred_until.max(until);
    }

    /// Wait until this request may start, then return a permit that must be
    /// held for the duration of the request (it keeps the concurrency slot
    /// occupied until dropped).
    pub async fn acquire(&self) -> RequestPermit<'_> {
        // Reserve capacity before pacing so semaphore waiters cannot accumulate
        // pre-approved starts. Both guards release automatically on cancellation.
        let permit = self
            .semaphore
            .acquire()
            .await
            .expect("request gate semaphore is never closed");
        let _timing = self.timing.lock().await;
        loop {
            let deadline = {
                let mut schedule = self.schedule.lock().expect("gate schedule poisoned");
                let deadline = schedule.last_grant
                    .map(|last| last + self.min_interval)
                    .unwrap_or(schedule.deferred_until)
                    .max(schedule.deferred_until);
                let now = Instant::now();
                if now >= deadline {
                    schedule.last_grant = Some(now);
                    self.counter.fetch_add(1, Ordering::Relaxed);
                    return RequestPermit { _permit: permit };
                }
                deadline
            };
            tokio::time::sleep_until(deadline).await;
            // A response may have extended the cooldown while we were asleep.
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;

    #[tokio::test]
    async fn cooldown_extends_a_request_already_waiting() {
        let gate = Arc::new(RequestGate::new(ThrottleConfig {
            min_interval: Duration::from_millis(80), max_concurrency: 2,
        }));
        drop(gate.acquire().await);
        let waiting_gate = gate.clone();
        let waiter = tokio::spawn(async move {
            let _permit = waiting_gate.acquire().await;
            Instant::now()
        });
        tokio::time::sleep(Duration::from_millis(20)).await;
        let deferred = Instant::now();
        gate.defer_for(Duration::from_millis(150));
        gate.defer_for(Duration::from_millis(1));
        let granted = waiter.await.unwrap();
        assert!(granted - deferred >= Duration::from_millis(150));
    }

    #[tokio::test]
    async fn cancellation_releases_timing_lock_and_reserved_slot() {
        let gate = Arc::new(RequestGate::new(ThrottleConfig {
            min_interval: Duration::from_millis(120), max_concurrency: 1,
        }));
        drop(gate.acquire().await);
        let waiting_gate = gate.clone();
        let waiter = tokio::spawn(async move { let _p = waiting_gate.acquire().await; });
        tokio::time::sleep(Duration::from_millis(20)).await;
        waiter.abort();
        assert!(waiter.await.unwrap_err().is_cancelled());
        assert_eq!(gate.total_count(), 1, "cancelled wait must not count as a grant");
        let permit = tokio::time::timeout(Duration::from_millis(400), gate.acquire())
            .await.expect("cancelled timing wait must free its slot and lock");
        drop(permit);
        assert_eq!(gate.total_count(), 2);
    }

    #[tokio::test]
    async fn zero_concurrency_cannot_deadlock() {
        let gate = RequestGate::new(ThrottleConfig {
            min_interval: Duration::ZERO, max_concurrency: 0,
        });
        let _permit = tokio::time::timeout(Duration::from_millis(50), gate.acquire())
            .await.expect("invalid zero concurrency must be bounded to one");
    }

    #[tokio::test]
    async fn concurrent_grants_keep_the_full_gap() {
        let gate = Arc::new(RequestGate::new(ThrottleConfig {
            min_interval: Duration::from_millis(50),
            max_concurrency: 16,
        }));
        let barrier = Arc::new(tokio::sync::Barrier::new(20));
        let mut tasks = Vec::new();
        for _ in 0..20 {
            let gate = gate.clone();
            let barrier = barrier.clone();
            tasks.push(tokio::spawn(async move {
                barrier.wait().await;
                let _permit = gate.acquire().await;
                Instant::now()
            }));
        }
        let mut grants = Vec::new();
        for task in tasks {
            grants.push(task.await.unwrap());
        }
        grants.sort();
        for pair in grants.windows(2) {
            assert!(pair[1] - pair[0] >= Duration::from_millis(50),
                "concurrent grants must preserve 50ms, got {:?}", pair[1] - pair[0]);
        }
        assert_eq!(gate.total_count(), 20);
    }

    #[tokio::test]
    async fn queued_permits_do_not_burst_after_a_slow_request() {
        let gate = Arc::new(RequestGate::new(ThrottleConfig {
            min_interval: Duration::from_millis(50),
            max_concurrency: 1,
        }));
        let held = gate.acquire().await;
        let mut tasks = Vec::new();
        for _ in 0..4 {
            let gate = gate.clone();
            tasks.push(tokio::spawn(async move {
                let _permit = gate.acquire().await;
                Instant::now()
            }));
        }
        tokio::time::sleep(Duration::from_millis(250)).await;
        drop(held);
        let mut grants = Vec::new();
        for task in tasks {
            grants.push(task.await.unwrap());
        }
        grants.sort();
        for pair in grants.windows(2) {
            assert!(pair[1] - pair[0] >= Duration::from_millis(50),
                "semaphore queue must preserve 50ms, got {:?}", pair[1] - pair[0]);
        }
    }

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
