//! One place for every Moodle page GET.
//!
//! `PageFetcher` sits on top of the shared `RequestGate` and adds what the old
//! per-call helper lacked:
//! - **single-flight**: concurrent requests for the same URL share one download;
//! - **per-sync reuse** (`retain_success = true`): pages fetched successfully during
//!   one sync are kept (bounded) so resources, recordings and status checks that
//!   need the same course/section page do not download it again;
//! - **honest failures**: non-2xx statuses and redirects to a login page are errors,
//!   never parsed as HTML, and failures are never memoized;
//! - **backpressure**: 429/503 put the whole gate into a cooldown (Retry-After);
//! - the gate permit lives exactly for one request + body read.

use std::collections::{HashMap, VecDeque};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use futures_util::future::{BoxFuture, FutureExt, Shared};

use crate::moodle::throttle::RequestGate;

const REQUEST_TIMEOUT: Duration = Duration::from_secs(10);
const MAX_BODY_BYTES: usize = 8 * 1024 * 1024;
const DEFAULT_COOLDOWN: Duration = Duration::from_secs(5);
const MAX_RETAINED_ENTRIES: usize = 800;
const MAX_RETAINED_BYTES: usize = 96 * 1024 * 1024;

type PageResult = Result<Arc<String>, String>;
type InFlight = Shared<BoxFuture<'static, PageResult>>;

#[derive(Default)]
struct State {
    inflight: HashMap<String, InFlight>,
    retained: HashMap<String, Arc<String>>,
    order: VecDeque<String>,
    retained_bytes: usize,
}

struct Inner {
    retain_success: bool,
    state: Mutex<State>,
}

/// Shared page downloader. Clones share the same single-flight table and cache.
#[derive(Clone)]
pub struct PageFetcher {
    gate: Arc<RequestGate>,
    inner: Arc<Inner>,
}

impl std::fmt::Debug for PageFetcher {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let state = self.inner.state.lock().expect("page state poisoned");
        f.debug_struct("PageFetcher")
            .field("retain_success", &self.inner.retain_success)
            .field("inflight", &state.inflight.len())
            .field("retained", &state.retained.len())
            .finish()
    }
}

impl PageFetcher {
    pub fn new(gate: Arc<RequestGate>, retain_success: bool) -> Self {
        Self { gate, inner: Arc::new(Inner { retain_success, state: Mutex::new(State::default()) }) }
    }

    /// A fresh fetcher on the same gate (same pacing) with its own table/cache —
    /// used to scope page reuse to a single sync.
    pub fn scoped(&self, retain_success: bool) -> Self {
        Self::new(self.gate.clone(), retain_success)
    }

    pub fn gate(&self) -> &Arc<RequestGate> {
        &self.gate
    }

    /// GET `url` as text. Concurrent callers for the same URL share one request;
    /// a caller dropping its future never cancels the download for the others.
    pub async fn text(&self, client: &reqwest::Client, url: &str) -> Result<String, String> {
        self.shared(client, url).await.map(|body| body.as_ref().clone())
    }

    fn shared(&self, client: &reqwest::Client, url: &str) -> InFlight {
        let mut state = self.inner.state.lock().expect("page state poisoned");
        if let Some(body) = state.retained.get(url) {
            let body = body.clone();
            return async move { Ok(body) }.boxed().shared();
        }
        if let Some(flight) = state.inflight.get(url) {
            return flight.clone();
        }
        let (client, gate, inner, key) = (client.clone(), self.gate.clone(), self.inner.clone(), url.to_string());
        let flight = async move {
            let result = fetch_once(&client, &gate, &key).await.map(Arc::new);
            let mut state = inner.state.lock().expect("page state poisoned");
            state.inflight.remove(&key);
            if let (true, Ok(body)) = (inner.retain_success, &result) {
                state.retained_bytes += body.len();
                state.retained.insert(key.clone(), body.clone());
                state.order.push_back(key);
                while state.order.len() > MAX_RETAINED_ENTRIES || state.retained_bytes > MAX_RETAINED_BYTES {
                    let Some(old) = state.order.pop_front() else { break };
                    if let Some(evicted) = state.retained.remove(&old) {
                        state.retained_bytes -= evicted.len();
                    }
                }
            }
            result
        }
        .boxed()
        .shared();
        state.inflight.insert(url.to_string(), flight.clone());
        flight
    }
}

/// Seconds (`Retry-After: 30`) or an HTTP date; bounded by the gate itself.
pub(crate) fn parse_retry_after(value: &str) -> Option<Duration> {
    let value = value.trim();
    if let Ok(secs) = value.parse::<u64>() {
        return Some(Duration::from_secs(secs));
    }
    let at = chrono::DateTime::parse_from_rfc2822(value).ok()?;
    let wait = at.with_timezone(&chrono::Utc) - chrono::Utc::now();
    Some(wait.to_std().unwrap_or(Duration::ZERO))
}

fn is_login_url(url: &str) -> bool {
    let lower = url.to_lowercase();
    lower.contains("/login") || lower.contains("okta.com") || lower.contains("microsoftonline.com") || lower.contains("accounts.google.com")
}

async fn fetch_once(client: &reqwest::Client, gate: &RequestGate, url: &str) -> Result<String, String> {
    let _permit = gate.acquire().await;
    let mut response = client
        .get(url)
        .timeout(REQUEST_TIMEOUT)
        .send()
        .await
        .map_err(|e| format!("Failed to fetch {url}: {e}"))?;
    let status = response.status();
    if status.as_u16() == 429 || status.as_u16() == 503 {
        let wait = response
            .headers()
            .get(reqwest::header::RETRY_AFTER)
            .and_then(|v| v.to_str().ok())
            .and_then(parse_retry_after)
            .unwrap_or(DEFAULT_COOLDOWN);
        gate.defer_for(wait);
        return Err(format!("Moodle asked to slow down (HTTP {}) for {url}", status.as_u16()));
    }
    if !status.is_success() {
        return Err(format!("HTTP {} for {url}", status.as_u16()));
    }
    if !is_login_url(url) && is_login_url(response.url().as_str()) {
        return Err(format!("Moodle session expired (redirected to login) for {url}"));
    }
    let mut body = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|e| format!("Failed to read {url}: {e}"))? {
        if body.len() + chunk.len() > MAX_BODY_BYTES {
            return Err(format!("Response too large for {url}"));
        }
        body.extend_from_slice(&chunk);
    }
    Ok(String::from_utf8_lossy(&body).into_owned())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::moodle::throttle::ThrottleConfig;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::time::Instant;

    /// Minimal loopback HTTP server. Routes:
    /// /slow (200 after 250ms), /ok, /flaky (500 first, then 200), /busy (503 Retry-After: 1),
    /// /redirect (303 → /login/index.php), /login/index.php (200 login page).
    async fn server() -> (String, Arc<AtomicUsize>, Arc<AtomicUsize>) {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let base = format!("http://{}", listener.local_addr().unwrap());
        let total = Arc::new(AtomicUsize::new(0));
        let flaky = Arc::new(AtomicUsize::new(0));
        let (t, f) = (total.clone(), flaky.clone());
        tokio::spawn(async move {
            loop {
                let Ok((mut sock, _)) = listener.accept().await else { break };
                let (t, f) = (t.clone(), f.clone());
                tokio::spawn(async move {
                    let mut buf = vec![0u8; 4096];
                    let n = sock.read(&mut buf).await.unwrap_or(0);
                    let req = String::from_utf8_lossy(&buf[..n]).to_string();
                    let path = req.split_whitespace().nth(1).unwrap_or("/").to_string();
                    t.fetch_add(1, Ordering::SeqCst);
                    let (status, extra, body) = match path.as_str() {
                        "/slow" => { tokio::time::sleep(Duration::from_millis(250)).await; ("200 OK", String::new(), "slow page") }
                        "/flaky" if f.fetch_add(1, Ordering::SeqCst) == 0 => ("500 Oops", String::new(), "error page"),
                        "/flaky" => ("200 OK", String::new(), "recovered"),
                        "/busy" => ("503 Busy", "Retry-After: 1\r\n".to_string(), "busy"),
                        "/redirect" => ("303 See Other", "Location: /login/index.php\r\n".to_string(), ""),
                        "/login/index.php" => ("200 OK", String::new(), "<form>login</form>"),
                        _ => ("200 OK", String::new(), "ok page"),
                    };
                    let reply = format!("HTTP/1.1 {status}\r\n{extra}Content-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len());
                    let _ = sock.write_all(reply.as_bytes()).await;
                });
            }
        });
        (base, total, flaky)
    }

    fn fetcher(retain: bool) -> PageFetcher {
        PageFetcher::new(Arc::new(RequestGate::new(ThrottleConfig { min_interval: Duration::ZERO, max_concurrency: 8 })), retain)
    }

    #[tokio::test]
    async fn concurrent_same_url_downloads_once() {
        let (base, total, _) = server().await;
        let pages = fetcher(false);
        let client = reqwest::Client::new();
        let url = format!("{base}/slow");
        let results = futures_util::future::join_all((0..6).map(|_| pages.text(&client, &url))).await;
        assert!(results.iter().all(|r| r.as_deref() == Ok("slow page")));
        assert_eq!(total.load(Ordering::SeqCst), 1);
    }

    #[tokio::test]
    async fn only_retaining_fetchers_reuse_finished_pages() {
        let (base, total, _) = server().await;
        let client = reqwest::Client::new();
        let url = format!("{base}/ok");
        let plain = fetcher(false);
        plain.text(&client, &url).await.unwrap();
        plain.text(&client, &url).await.unwrap();
        assert_eq!(total.load(Ordering::SeqCst), 2, "non-retaining fetcher must not cache");
        let sync = plain.scoped(true);
        sync.text(&client, &url).await.unwrap();
        sync.clone().text(&client, &url).await.unwrap();
        assert_eq!(total.load(Ordering::SeqCst), 3, "a sync-scoped fetcher reuses its page across clones");
    }

    #[tokio::test]
    async fn failures_are_not_memoized() {
        let (base, total, _) = server().await;
        let pages = fetcher(true);
        let client = reqwest::Client::new();
        let url = format!("{base}/flaky");
        assert!(pages.text(&client, &url).await.unwrap_err().contains("HTTP 500"));
        assert_eq!(pages.text(&client, &url).await.as_deref(), Ok("recovered"));
        assert_eq!(total.load(Ordering::SeqCst), 2);
    }

    #[tokio::test]
    async fn busy_server_puts_the_whole_gate_into_cooldown() {
        let (base, _, _) = server().await;
        let pages = fetcher(false);
        let client = reqwest::Client::new();
        assert!(pages.text(&client, &format!("{base}/busy")).await.unwrap_err().contains("HTTP 503"));
        let start = Instant::now();
        pages.text(&client, &format!("{base}/ok")).await.unwrap();
        assert!(start.elapsed() >= Duration::from_millis(900), "next request must wait for Retry-After, waited {:?}", start.elapsed());
    }

    #[tokio::test]
    async fn redirect_to_login_is_an_error_not_html() {
        let (base, _, _) = server().await;
        let pages = fetcher(true);
        let client = reqwest::Client::new();
        let err = pages.text(&client, &format!("{base}/redirect")).await.unwrap_err();
        assert!(err.contains("redirected to login"), "{err}");
    }

    #[tokio::test]
    async fn cancelling_the_first_caller_does_not_strand_the_others() {
        let (base, total, _) = server().await;
        let pages = fetcher(false);
        let client = reqwest::Client::new();
        let url = format!("{base}/slow");
        let (p, c, u) = (pages.clone(), client.clone(), url.clone());
        let leader = tokio::spawn(async move { p.text(&c, &u).await });
        tokio::time::sleep(Duration::from_millis(40)).await;
        let waiter = { let (p, c, u) = (pages.clone(), client.clone(), url.clone()); tokio::spawn(async move { p.text(&c, &u).await }) };
        tokio::time::sleep(Duration::from_millis(20)).await;
        leader.abort();
        assert_eq!(waiter.await.unwrap().as_deref(), Ok("slow page"));
        assert_eq!(total.load(Ordering::SeqCst), 1);
    }

    #[test]
    fn retry_after_accepts_seconds_and_http_dates() {
        assert_eq!(parse_retry_after(" 30 "), Some(Duration::from_secs(30)));
        let soon = (chrono::Utc::now() + chrono::Duration::seconds(20)).to_rfc2822();
        let wait = parse_retry_after(&soon).unwrap();
        assert!(wait <= Duration::from_secs(20) && wait >= Duration::from_secs(18));
        assert_eq!(parse_retry_after("Wed, 21 Oct 2015 07:28:00 GMT"), Some(Duration::ZERO));
        assert_eq!(parse_retry_after("soon"), None);
    }
}
