//! Account-bound portal refresh credentials. Never store passwords or access tokens.
use serde::{Deserialize, Serialize};
use serde_json::Value;
static STORE_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());
static EPOCH: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
// Never trust a persisted ETag after a process restart: a crash could have occurred
// before the corresponding response reached IndexedDB. The first check is full.
static CHECK_VERSIONS: std::sync::LazyLock<std::sync::Mutex<std::collections::HashMap<String, String>>> =
    std::sync::LazyLock::new(|| std::sync::Mutex::new(std::collections::HashMap::new()));

pub fn epoch() -> u64 { EPOCH.load(std::sync::atomic::Ordering::SeqCst) }
pub fn ensure_current(ticket: u64) -> Result<(), String> {
    if epoch() != ticket { return Err("PORTAL_CANCELLED".into()); }
    Ok(())
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PortalSession {
    pub api_key: String,
    pub refresh_token: String,
    pub uid: String,
    pub email: String,
    #[serde(default)]
    pub etag: Option<String>,
    /// The Moodle account this portal session was bound to during the same
    /// single-window SSO. The portal's Firebase email is a generated identifier
    /// (`…+<uuid>@monash.edu`), not the student address, so it cannot be compared
    /// with the Moodle email. Empty only for legacy entries / fresh captures.
    #[serde(default)]
    pub owner: String,
}

/// Bind a freshly captured portal session to the Moodle account that completed
/// the same login window. Rejects the placeholder identity used when Moodle
/// profile lookup fails, so two students can never share one credential entry.
pub fn bind_owner(mut session: PortalSession, account: &str) -> Result<PortalSession, String> {
    let account = account.trim().to_lowercase();
    if account.is_empty() || account == "student@monash.edu" {
        return Err("PORTAL_IDENTITY_UNAVAILABLE".into());
    }
    session.owner = account;
    Ok(session)
}

pub fn validate_account(session: &PortalSession, expected: &str) -> Result<(), String> {
    let bound = if session.owner.trim().is_empty() { &session.email } else { &session.owner };
    if expected.trim().is_empty() || !bound.trim().eq_ignore_ascii_case(expected.trim()) {
        return Err("PORTAL_ACCOUNT_MISMATCH".into());
    }
    if session.api_key.is_empty() || session.refresh_token.is_empty() || session.uid.is_empty() {
        return Err("PORTAL_LOGIN_REQUIRED".into());
    }
    Ok(())
}

pub fn classify_response(status: u16, _body: &Value) -> &'static str {
    match status {
        400 | 401 => "PORTAL_LOGIN_REQUIRED",
        403 => "PORTAL_ACCESS_DENIED",
        429 => "PORTAL_RATE_LIMITED",
        500..=599 => "PORTAL_SERVER_ERROR",
        0 => "PORTAL_NETWORK_ERROR",
        _ => "PORTAL_RESPONSE_ERROR",
    }
}

fn entry(account: &str) -> Result<keyring::Entry, String> {
    keyring::Entry::new("com.poetrynan.muster.portal", &account.trim().to_lowercase())
        .map_err(|_| "PORTAL_CREDENTIAL_STORE_UNAVAILABLE".into())
}

pub fn load(account: &str) -> Result<Option<PortalSession>, String> {
    match entry(account)?.get_password() {
        Ok(raw) => {
            let session: PortalSession = serde_json::from_str(&raw).map_err(|_| "PORTAL_LOGIN_REQUIRED")?;
            validate_account(&session, account)?;
            Ok(Some(session))
        }
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(_) => Err("PORTAL_CREDENTIAL_STORE_UNAVAILABLE".into()),
    }
}

pub fn save(account: &str, session: &PortalSession) -> Result<(), String> {
    validate_account(session, account)?;
    let raw = serde_json::to_string(session).map_err(|_| "PORTAL_CREDENTIAL_SAVE_FAILED")?;
    entry(account)?.set_password(&raw).map_err(|_| "PORTAL_CREDENTIAL_SAVE_FAILED".into())
}

pub fn clear(account: &str) {
    let _lock = STORE_LOCK.lock().unwrap();
    EPOCH.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
    CHECK_VERSIONS.lock().unwrap().remove(&account.trim().to_lowercase());
    if let Ok(entry) = entry(account) { let _ = entry.delete_password(); }
}

pub fn save_guarded(account: &str, session: &PortalSession, ticket: u64) -> Result<(), String> {
    let _lock = STORE_LOCK.lock().unwrap();
    ensure_current(ticket)?;
    save(account, session)?;
    let mut versions = CHECK_VERSIONS.lock().unwrap();
    let key = account.trim().to_lowercase();
    if let Some(etag) = &session.etag { versions.insert(key, etag.clone()); }
    else { versions.remove(&key); }
    Ok(())
}

/// Refresh through the original Firebase service, then call the original Monash API.
/// Transient failures never erase a usable refresh credential.
pub async fn renew(account: &str, session: &PortalSession, ticket: u64, has_cache: bool) -> Result<Value, String> {
    ensure_current(ticket)?;
    validate_account(session, account)?;
    let client = reqwest::Client::builder().timeout(std::time::Duration::from_secs(20))
        .redirect(reqwest::redirect::Policy::none())
        .default_headers({
            let mut headers = reqwest::header::HeaderMap::new();
            headers.insert("Origin", "https://home.student.monash".parse().unwrap());
            headers.insert("Referer", "https://home.student.monash/".parse().unwrap());
            headers
        }).build().map_err(|_| "PORTAL_NETWORK_ERROR")?;
    let mut cached = session.clone();
    cached.etag = if has_cache { CHECK_VERSIONS.lock().unwrap().get(&account.trim().to_lowercase()).cloned() } else { None };
    let body = request_renew(&client, &cached, "https://securetoken.googleapis.com/v1/token", "https://home.student.monash/api/student/userEvents?strict=false", |rotated| save_guarded(account, rotated, ticket)).await
        .inspect_err(|error| crate::student_portal::diagnostic(&format!("background check failed: {error}")))?;
    ensure_current(ticket)?;
    Ok(body)
}

pub(crate) async fn request_renew(client: &reqwest::Client, session: &PortalSession, token_url: &str, events_url: &str, mut persist: impl FnMut(&PortalSession) -> Result<(), String>) -> Result<Value, String> {
    let response = client.post(token_url)
        .query(&[("key", &session.api_key)])
        .form(&[("grant_type", "refresh_token"), ("refresh_token", &session.refresh_token)])
        .send().await.map_err(|_| "PORTAL_NETWORK_ERROR")?;
    let status = response.status().as_u16();
    let token: Value = response.json().await.map_err(|_| "PORTAL_RESPONSE_ERROR")?;
    if status != 200 { return Err(classify_response(status, &token).into()); }
    if token["user_id"].as_str() != Some(&session.uid) { return Err("PORTAL_ACCOUNT_MISMATCH".into()); }
    let access = token["id_token"].as_str().ok_or("PORTAL_RESPONSE_ERROR")?;
    let mut rotated = session.clone();
    if let Some(refresh) = token["refresh_token"].as_str().filter(|s| !s.is_empty()) {
        rotated.refresh_token = refresh.into();
    }
    // Persist rotation even if the subsequent course API temporarily fails.
    persist(&rotated)?;
    let mut request = client.get(events_url).bearer_auth(access);
    if let Some(etag) = &session.etag { request = request.header("If-None-Match", etag); }
    let response = request.send().await.map_err(|_| "PORTAL_NETWORK_ERROR")?;
    let status = response.status().as_u16();
    if status == 304 {
        if session.etag.is_none() { return Err("PORTAL_RESPONSE_ERROR".into()); }
        return Ok(serde_json::json!({"notModified":true}));
    }
    let etag = response.headers().get("ETag").and_then(|v| v.to_str().ok()).map(str::to_owned);
    let body: Value = response.json().await.map_err(|_| "PORTAL_RESPONSE_ERROR")?;
    if status != 200 { return Err(classify_response(status, &body).into()); }
    // A transport-success response can still report unavailable/invalid exams.
    // Accept its validator only once the corresponding timetable is usable.
    crate::student_portal::parse_portal_exams(&body)?;
    rotated.etag = etag;
    persist(&rotated)?;
    Ok(body)
}
