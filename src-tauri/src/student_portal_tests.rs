use super::student_portal::parse_portal_exams;
use serde_json::json;
use super::student_portal_session::{PortalSession, validate_account, classify_response};

#[test]
fn portal_sessions_are_account_bound_and_dont_serialize_access_tokens() {
    let session: PortalSession = serde_json::from_value(json!({"apiKey":"public-key","refreshToken":"refresh-secret","uid":"u1","email":"Student@monash.edu","accessToken":"must-not-store"})).unwrap();
    assert!(validate_account(&session, " student@monash.edu ").is_ok());
    assert!(validate_account(&session, "other@monash.edu").is_err());
    assert!(validate_account(&session, "").is_err());
    assert!(!serde_json::to_string(&session).unwrap().contains("must-not-store"));
}

#[test]
fn portal_session_binds_to_moodle_account_despite_generated_firebase_email() {
    use super::student_portal_session::bind_owner;
    // Observed shape: the portal's Firebase email is a generated alias, not the student address.
    let captured: PortalSession = serde_json::from_value(json!({"apiKey":"k","refreshToken":"r","uid":"u1",
        "email":"home-portal-identity-service+0a00a000-000a-0aa0-a00a-0a0aa0aa00a0@monash.edu"})).unwrap();
    assert!(validate_account(&captured, "abcd0001@student.monash.edu").is_err(), "unbound sessions still compare by email");
    let bound = bind_owner(captured.clone(), " ABCD0001@student.monash.edu ").unwrap();
    assert!(validate_account(&bound, "abcd0001@student.monash.edu").is_ok());
    assert!(validate_account(&bound, "other0002@student.monash.edu").is_err(), "a different account stays isolated");
    let restored: PortalSession = serde_json::from_str(&serde_json::to_string(&bound).unwrap()).unwrap();
    assert!(validate_account(&restored, "abcd0001@student.monash.edu").is_ok(), "binding survives keyring round-trip");
    assert_eq!(bind_owner(captured.clone(), "student@monash.edu").err().as_deref(), Some("PORTAL_IDENTITY_UNAVAILABLE"));
    assert!(bind_owner(captured, " ").is_err());
}

#[test]
fn network_and_server_failures_are_not_login_expiry() {
    assert_eq!(classify_response(401, &json!({"errorCode":"STUDENT_PORTAL_TOKEN_EXPIRED"})), "PORTAL_LOGIN_REQUIRED");
    assert_eq!(classify_response(429, &json!({})), "PORTAL_RATE_LIMITED");
    assert_eq!(classify_response(503, &json!({})), "PORTAL_SERVER_ERROR");
    assert_eq!(classify_response(403, &json!({})), "PORTAL_ACCESS_DENIED");
}

#[test]
#[ignore = "Uses the current Windows user's credential manager; run explicitly"]
fn portal_keyring_roundtrip() {
    use super::student_portal_session as store;
    let account = format!("muster-credential-test-{}@invalid", std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos());
    let session = PortalSession { api_key:"fake-public".into(), refresh_token:"fake-refresh".into(), uid:"fake-user".into(), email:account.clone(), etag: None, owner: String::new() };
    let write = store::save(&account, &session);
    if write.is_err() { store::clear(&account); }
    write.unwrap();
    let restored = store::load(&account);
    store::clear(&account);
    assert_eq!(restored.unwrap().unwrap().refresh_token, "fake-refresh");
    assert!(store::load(&account).unwrap().is_none());
}

async fn mock_portal(status: u16) -> (String, tokio::task::JoinHandle<Vec<String>>) {
    mock_portal_body(status, json!({"errorFlags":{"exams":0},"events":[],"errorCode":"STUDENT_PORTAL_TOKEN_EXPIRED"}).to_string()).await
}

async fn mock_portal_body(status: u16, events_body: String) -> (String, tokio::task::JoinHandle<Vec<String>>) {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("http://{}", listener.local_addr().unwrap());
    let task = tokio::spawn(async move {
        let mut requests = vec![];
        for (code, body) in [(200, json!({"user_id":"u1","id_token":"fake-access","refresh_token":"rotated-refresh"}).to_string()), (status, events_body)] {
            let (mut stream, _) = listener.accept().await.unwrap();
            let mut raw = vec![];
            loop {
                let mut buf = [0;4096]; let n = stream.read(&mut buf).await.unwrap();
                if n == 0 { break; } raw.extend_from_slice(&buf[..n]);
                let text = String::from_utf8_lossy(&raw);
                if let Some(header_end) = text.find("\r\n\r\n") {
                    let size = text[..header_end].lines().find_map(|l| l.to_lowercase().strip_prefix("content-length:").and_then(|s| s.trim().parse::<usize>().ok())).unwrap_or(0);
                    if raw.len() >= header_end + 4 + size { break; }
                }
            }
            requests.push(String::from_utf8(raw).unwrap());
            let reply = format!("HTTP/1.1 {code} Test\r\nETag: \"exam-v2\"\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len());
            stream.write_all(reply.as_bytes()).await.unwrap();
        }
        requests
    });
    (url, task)
}

#[tokio::test]
async fn invalid_exam_responses_never_advance_the_cached_validator() {
    for body in ["not-json".to_owned(), json!({"errorFlags":{"exams":500},"events":[]}).to_string()] {
        let (base, task) = mock_portal_body(200, body).await;
        let saved = PortalSession { api_key:"public-key".into(),refresh_token:"saved-refresh".into(),uid:"u1".into(),email:"student@monash.edu".into(), etag: Some("\"exam-v1\"".into()), owner: String::new() };
        let mut persisted = vec![];
        let result = super::student_portal_session::request_renew(&reqwest::Client::new(), &saved, &format!("{base}/token"), &format!("{base}/events"), |s| { persisted.push(s.clone()); Ok(()) }).await;
        assert!(result.is_err());
        assert_eq!(persisted.len(), 1, "only token rotation may be saved for an invalid exam response");
        assert_eq!(persisted[0].etag, saved.etag);
        assert_eq!(persisted[0].refresh_token, "rotated-refresh");
        task.await.unwrap();
    }
}

#[tokio::test]
async fn restart_restore_renews_then_fetches_without_opening_a_login_window() {
    let (base, task) = mock_portal(200).await;
    let saved = PortalSession { api_key:"public-key".into(),refresh_token:"saved-refresh".into(),uid:"u1".into(),email:"student@monash.edu".into(), etag: None, owner: String::new() };
    let mut persisted = vec![];
    let body = super::student_portal_session::request_renew(&reqwest::Client::new(), &saved, &format!("{base}/token"), &format!("{base}/events"), |s| { persisted.push(s.clone()); Ok(()) }).await.unwrap();
    assert!(body["events"].as_array().unwrap().is_empty());
    assert_eq!(persisted[0].refresh_token, "rotated-refresh");
    let requests = task.await.unwrap();
    assert!(requests[0].contains("grant_type=refresh_token&refresh_token=saved-refresh"));
    assert!(requests[1].to_lowercase().contains("authorization: bearer fake-access"));
}

#[tokio::test]
async fn refresh_rotation_survives_transient_portal_failure() {
    let (base, task) = mock_portal(503).await;
    let saved = PortalSession { api_key:"public-key".into(),refresh_token:"saved-refresh".into(),uid:"u1".into(),email:"student@monash.edu".into(), etag: None, owner: String::new() };
    let mut persisted = vec![];
    let error = super::student_portal_session::request_renew(&reqwest::Client::new(), &saved, &format!("{base}/token"), &format!("{base}/events"), |s| { persisted.push(s.clone()); Ok(()) }).await.unwrap_err();
    assert_eq!(error, "PORTAL_SERVER_ERROR");
    assert_eq!(persisted[0].refresh_token, "rotated-refresh");
    task.await.unwrap();
}

#[tokio::test]
async fn conditional_exam_check_accepts_304_without_parsing_an_empty_response() {
    let (base, task) = mock_portal(304).await;
    let saved = PortalSession { api_key:"public-key".into(),refresh_token:"saved-refresh".into(),uid:"u1".into(),email:"student@monash.edu".into(), etag: Some("\"exam-v1\"".into()), owner: String::new() };
    let body = super::student_portal_session::request_renew(&reqwest::Client::new(), &saved, &format!("{base}/token"), &format!("{base}/events"), |_| Ok(())).await.unwrap();
    assert_eq!(body["notModified"], true);
    let requests = task.await.unwrap();
    assert!(requests[1].to_lowercase().contains("if-none-match: \"exam-v1\""));
}

fn fixture() -> serde_json::Value {
    json!({"errorFlags":{"exams":0},"events":[
        {"uuid":"exam-fixture","eventKind":"standard","eventType":"exam",
         "start":{"time":1794787200000_i64},"end":{"time":1794795000000_i64},
         "data":{"unitCode":"FIT5201","unitTitle":"Machine learning","activityType":"eExamR (Final)","timezoneLocation":"Kuala Lumpur","campus":"MA","notes":"Log in 30 minutes early."},
         "location":{"locationKind":"unknown","data":{"description":"Room 100. Seat Number: 12"}}},
        {"eventKind":"assessment","eventType":"assignment","start":{"time":1794787200000_i64}},
        {"eventKind":"standard","eventType":"class","start":{"time":1794787200000_i64}}
    ]})
}

#[test]
fn parses_verified_portal_schema_and_malaysia_time() {
    let exams = parse_portal_exams(&fixture()).unwrap();
    assert_eq!(exams.len(), 1);
    assert_eq!(exams[0].date, "2026-11-16");
    assert_eq!(exams[0].start_time, "08:00");
    assert_eq!(exams[0].end_time, "10:10");
    assert_eq!(exams[0].duration_minutes, Some(130));
    assert_eq!(exams[0].seat_number.as_deref(), Some("12"));
    assert_eq!(exams[0].timezone.as_deref(), Some("Asia/Kuala_Lumpur"));
}

#[test]
fn distinguishes_empty_results_from_api_or_schema_failures() {
    assert!(parse_portal_exams(&json!({"errorFlags":{"exams":0},"events":[]})).unwrap().is_empty());
    assert!(parse_portal_exams(&json!({"errorFlags":{"exams":500},"events":[]})).is_err());
    assert!(parse_portal_exams(&json!({"message":"not authenticated"})).is_err());
    let mut broken = fixture(); broken["events"][0]["end"]["time"] = json!(0);
    assert!(parse_portal_exams(&broken).is_err());
}

#[test]
fn accepts_integral_float_times_from_native_webview_eval() {
    // Observed 2026-11-06: native eval delivered start/end as `time:float`.
    let mut native = fixture();
    native["events"][0]["start"]["time"] = json!(1794787200000.0_f64);
    native["events"][0]["end"]["time"] = json!(1794795000000.0_f64);
    let exams = parse_portal_exams(&native).unwrap();
    assert_eq!((exams[0].date.as_str(), exams[0].start_time.as_str(), exams[0].end_time.as_str()), ("2026-11-16", "08:00", "10:10"));
    // Re-serialised raw text from the eval callback parses the same way.
    let raw = serde_json::to_string(&native).unwrap();
    assert!(raw.contains("1794787200000.0"));
    assert_eq!(parse_portal_exams(&serde_json::from_str(&raw).unwrap()).unwrap()[0].start_at, exams[0].start_at);
    for bad in [json!(1794787200000.5_f64), json!(1e300_f64), json!(-1e300_f64)] {
        let mut broken = fixture(); broken["events"][0]["start"]["time"] = bad;
        assert!(parse_portal_exams(&broken).unwrap_err().starts_with("PORTAL_EXAM_SCHEMA:"));
    }
}

#[test]
fn exam_schema_errors_are_classified_and_redacted() {
    for (start, shape) in [
        (json!({"time":"2026-11-16T00:00:00Z"}), "start=object{time:string}"),
        (json!({"time":null}), "start=object{time:null}"),
        (json!({"time":1794787200000.5}), "start=object{time:float}"),
        (json!(null), "start=missing"),
    ] {
        let mut broken = fixture(); broken["events"][0]["start"] = start;
        let error = parse_portal_exams(&broken).unwrap_err();
        assert!(error.starts_with("PORTAL_EXAM_SCHEMA:"), "{error}");
        assert!(error.contains("exam 1/1 (eventKind=standard)"), "{error}");
        assert!(error.contains(shape), "{error}");
        assert!(!error.contains("2026-11-16") && !error.contains("FIT5201"), "values must not leak: {error}");
    }
    assert_eq!(parse_portal_exams(&json!({"errorFlags":{"exams":500},"events":[]})).unwrap_err(), "PORTAL_EXAM_UNAVAILABLE");
}

fn capture_session() -> PortalSession {
    PortalSession { api_key:"public-key".into(), refresh_token:"refresh".into(), uid:"u1".into(), email:"student@monash.edu".into(), etag: None, owner: String::new() }
}

#[test]
fn unusable_exam_data_at_sign_in_keeps_the_session_but_not_the_etag() {
    use super::student_portal::capture_from_result;
    let mut broken = fixture();
    broken["events"][0]["start"]["time"] = json!("pending");
    broken["etag"] = json!("\"exam-v9\"");
    let capture = capture_from_result(capture_session(), &broken);
    assert!(capture.exams.unwrap_err().starts_with("PORTAL_EXAM_SCHEMA:"));
    assert_eq!(capture.session.refresh_token, "refresh");
    assert_eq!(capture.session.etag, None, "a failed parse must not advance the validator");

    let mut good = fixture(); good["etag"] = json!("\"exam-v9\"");
    let capture = capture_from_result(capture_session(), &good);
    assert_eq!(capture.exams.unwrap().len(), 1);
    assert_eq!(capture.session.etag.as_deref(), Some("\"exam-v9\""));
}
