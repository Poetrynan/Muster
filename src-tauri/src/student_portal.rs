use crate::moodle::models::ExamSchedule;
use chrono::{TimeZone, Utc};
use chrono_tz::Tz;
use serde_json::Value;
const ORIGIN: &str = "https://home.student.monash";



fn timezone(data: &Value) -> Result<Tz, String> {
    let location = data["timezoneLocation"].as_str().unwrap_or("");
    if let Ok(tz) = location.parse::<Tz>() { return Ok(tz); }
    match location {
        "Kuala Lumpur" | "Malaysia" => Ok(chrono_tz::Asia::Kuala_Lumpur),
        "Melbourne" => Ok(chrono_tz::Australia::Melbourne),
        "Sydney" => Ok(chrono_tz::Australia::Sydney),
        "Prato" => Ok(chrono_tz::Europe::Rome),
        "Suzhou" => Ok(chrono_tz::Asia::Shanghai),
        "" if data["campus"] == "MA" => Ok(chrono_tz::Asia::Kuala_Lumpur),
        _ => Err(format!("Unsupported portal exam timezone: {location}")),
    }
}

/// Append a redacted line to `%LOCALAPPDATA%/com.poetrynan.muster/logs/portal-diagnostics.log`.
/// Callers pass only error codes and value-free shapes: never tokens, emails or exam data.
fn diagnostics_path() -> Option<std::path::PathBuf> {
    let base = std::env::var_os("LOCALAPPDATA").or_else(|| std::env::var_os("HOME"))?;
    Some(std::path::PathBuf::from(base).join("com.poetrynan.muster").join("logs").join("portal-diagnostics.log"))
}

/// Last `max_lines` lines of the redacted diagnostics log, for the in-app problem report.
pub fn diagnostics_tail(max_lines: usize) -> String {
    let Some(path) = diagnostics_path() else { return String::new() };
    let text = std::fs::read_to_string(path).unwrap_or_default();
    let lines: Vec<&str> = text.lines().collect();
    lines[lines.len().saturating_sub(max_lines)..].join("\n")
}

pub fn diagnostic(message: &str) {
    use std::io::Write;
    eprintln!("[portal] {message}");
    let Some(path) = diagnostics_path() else { return };
    if let Some(dir) = path.parent() { let _ = std::fs::create_dir_all(dir); }
    if std::fs::metadata(&path).is_ok_and(|m| m.len() > 256 * 1024) { let _ = std::fs::remove_file(&path); }
    if let Ok(mut file) = std::fs::OpenOptions::new().create(true).append(true).open(&path) {
        let _ = writeln!(file, "{} {message}", Utc::now().to_rfc3339());
    }
}

/// JSON type name only: diagnostics must never echo portal values.
fn json_kind(value: &Value) -> &'static str {
    match value {
        Value::Null => "null",
        Value::Bool(_) => "bool",
        Value::Number(n) if n.is_i64() || n.is_u64() => "integer",
        Value::Number(_) => "float",
        Value::String(_) => "string",
        Value::Array(_) => "array",
        Value::Object(_) => "object",
    }
}

/// Redacted shape of a time field: its JSON type and, for objects, key names only.
fn time_shape(value: &Value) -> String {
    match value {
        Value::Object(map) => {
            let fields = map.iter().map(|(k, v)| format!("{k}:{}", json_kind(v))).collect::<Vec<_>>().join(",");
            format!("object{{{fields}}}")
        }
        Value::Null => "missing".into(),
        other => json_kind(other).into(),
    }
}

/// Epoch milliseconds. Observed (2026-11-06 diagnostics): the portal API sends
/// integers, but WebView2's native eval callback re-serialises them as floats
/// (`time:float`). Accept a float only when it is an exact integral value within
/// the IEEE-754 safe-integer range; fractional, NaN or out-of-range values fail.
fn epoch_millis(value: &Value) -> Option<i64> {
    if let Some(ms) = value.as_i64() { return Some(ms); }
    let f = value.as_f64()?;
    const SAFE: f64 = 9_007_199_254_740_991.0;
    (f.is_finite() && f.fract() == 0.0 && f.abs() <= SAFE).then_some(f as i64)
}

/// Structured, value-free schema diagnostic for a single exam record.
fn schema_error(index: usize, total: usize, event: &Value, problem: &str) -> String {
    let kind = event["eventKind"].as_str()
        .filter(|k| k.len() <= 32 && k.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-'))
        .unwrap_or("?");
    format!("PORTAL_EXAM_SCHEMA: exam {}/{total} (eventKind={kind}): {problem}; start={}, end={}",
        index + 1, time_shape(&event["start"]), time_shape(&event["end"]))
}

/// A source error is never interpreted as a valid empty timetable. Every failure
/// is a `PORTAL_EXAM_*` data error, distinct from authentication failures.
pub fn parse_portal_exams(value: &Value) -> Result<Vec<ExamSchedule>, String> {
    if value.get("status").and_then(Value::as_u64).is_some_and(|s| s != 200) {
        return Err("PORTAL_RESPONSE_ERROR".into());
    }
    if value["errorFlags"]["exams"].as_i64() != Some(0) {
        return Err("PORTAL_EXAM_UNAVAILABLE".into());
    }
    let events = value["events"].as_array().ok_or("PORTAL_EXAM_SCHEMA: events is not an array")?;
    let exam_events: Vec<&Value> = events.iter().filter(|e| e["eventType"] == "exam").collect();
    let total = exam_events.len();
    let mut exams = Vec::new();
    let mut seen = std::collections::HashSet::new();
    for (index, event) in exam_events.into_iter().enumerate() {
        let fail = |problem: &str| schema_error(index, total, event, problem);
        let start_ms = epoch_millis(&event["start"]["time"]).ok_or_else(|| fail("start.time is not integral epoch ms"))?;
        let end_ms = epoch_millis(&event["end"]["time"]).ok_or_else(|| fail("end.time is not integral epoch ms"))?;
        if end_ms <= start_ms { return Err(fail("end is not after start")); }
        let start = Utc.timestamp_millis_opt(start_ms).single().ok_or_else(|| fail("start.time out of range"))?;
        let end = Utc.timestamp_millis_opt(end_ms).single().ok_or_else(|| fail("end.time out of range"))?;
        let data = &event["data"];
        let tz = timezone(data).map_err(|_| fail("unsupported timezoneLocation"))?;
        let unit = data["unitCode"].as_str().filter(|s| !s.is_empty()).ok_or_else(|| fail("missing data.unitCode"))?;
        let activity = data["activityType"].as_str().unwrap_or("Assessment");
        let id = event["uuid"].as_str().map(str::to_owned).unwrap_or_else(|| format!("{unit}:{start_ms}:{activity}"));
        if !seen.insert(id.clone()) { continue; }
        let location_data = &event["location"]["data"];
        let location = location_data["description"].as_str().map(str::to_owned)
            .or_else(|| location_data.as_array().map(|rooms| rooms.iter().filter_map(|r| {
                r["roomName"].as_str().map(|room| format!("{} {}", r["buildingName"].as_str().unwrap_or(""), room).trim().to_owned())
            }).collect::<Vec<_>>().join(", "))).unwrap_or_default();
        let seat = regex::Regex::new(r"(?i)seat\s*(?:number|no\.?)?\s*:\s*([A-Za-z0-9-]+)").unwrap()
            .captures(&location).map(|c| c[1].to_owned());
        exams.push(ExamSchedule {
            id, course_id: None, course_name: data["unitTitle"].as_str().unwrap_or(unit).into(),
            course_code: unit.into(), exam_type: activity.into(),
            date: start.with_timezone(&tz).format("%Y-%m-%d").to_string(),
            start_time: start.with_timezone(&tz).format("%H:%M").to_string(),
            end_time: end.with_timezone(&tz).format("%H:%M").to_string(),
            start_at: Some(start.to_rfc3339()), end_at: Some(end.to_rfc3339()), timezone: Some(tz.name().into()),
            location, seat_number: seat, duration_minutes: u32::try_from((end_ms - start_ms) / 60_000).ok(),
            instructions: data["notes"].as_str().filter(|s| !s.is_empty()).map(str::to_owned),
            url: Some(format!("{ORIGIN}/")),
        });
    }
    exams.sort_by(|a,b| a.start_at.cmp(&b.start_at));
    Ok(exams)
}

/// Native evaluation keeps refresh credentials out of URLs, DOM events and logs.
async fn snapshot(window: &tauri::WebviewWindow) -> Result<Value, String> {
    let (tx, rx) = tokio::sync::oneshot::channel();
    let sender = std::sync::Mutex::new(Some(tx));
    window.eval_with_callback(include_str!("student_portal_snapshot.js"), move |raw| {
        if let Some(tx) = sender.lock().unwrap().take() { let _ = tx.send(serde_json::from_str::<Value>(&raw)); }
    }).map_err(|_| "PORTAL_WEBVIEW_ERROR")?;
    tokio::time::timeout(std::time::Duration::from_secs(3), rx).await
        .map_err(|_| "PORTAL_CAPTURE_TIMEOUT")?.map_err(|_| "PORTAL_WEBVIEW_ERROR")?
        .map_err(|_| "PORTAL_CAPTURE_ERROR".into())
}

/// Authentication and exam data are separate outcomes: a trusted portal session
/// lets login continue even when the exam payload is unusable.
/// The login window starts hidden. Reveal it only when an SSO page needs the
/// user (login form / MFA seen on two consecutive polls, so auto-posting SAML
/// hops never flash), or after a fallback delay so a stuck page is never invisible.
pub fn reveal_when_interactive(window: tauri::WebviewWindow) {
    tauri::async_runtime::spawn(async move {
        let started = tokio::time::Instant::now();
        let mut hits = 0;
        loop {
            tokio::time::sleep(std::time::Duration::from_millis(500)).await;
            if window.url().is_err() || window.is_visible().unwrap_or(true) { return; }
            let needs = snapshot(&window).await.is_ok_and(|s| s["needsInteraction"] == true);
            hits = if needs { hits + 1 } else { 0 };
            if hits >= 2 || started.elapsed() > std::time::Duration::from_secs(15) {
                let _ = window.show();
                let _ = window.set_focus();
                return;
            }
        }
    });
}

pub struct PortalCapture {
    pub session: crate::student_portal_session::PortalSession,
    pub exams: Result<Vec<ExamSchedule>, String>,
}

/// Build the capture from a verified HTTP-200 result. A failed parse never
/// advances the ETag, so the next check re-reads the full body.
pub fn capture_from_result(mut session: crate::student_portal_session::PortalSession, result: &Value) -> PortalCapture {
    let exams = parse_portal_exams(result);
    session.etag = if exams.is_ok() { result["etag"].as_str().map(str::to_owned) } else { None };
    PortalCapture { session, exams }
}

/// The only interactive auth flow lives in the main login window, before Home.
pub async fn begin_sso(window: &tauri::WebviewWindow) -> Result<PortalCapture, String> {
    let ticket = crate::student_portal_session::epoch();
    let deadline = tokio::time::Instant::now() + std::time::Duration::from_secs(300);
    let mut auth_rejected = false;
    while tokio::time::Instant::now() < deadline {
        crate::student_portal_session::ensure_current(ticket)?;
        if window.url().is_err() { return Err("PORTAL_CANCELLED".into()); }
        if let Ok(state) = snapshot(window).await {
            let result = &state["result"];
            if let Some(status) = result["status"].as_u64() {
                if status == 401 { auth_rejected = true; }
                else if status != 200 {
                    return Err(crate::student_portal_session::classify_response(status as u16, result).into());
                } else {
                    let session: crate::student_portal_session::PortalSession = serde_json::from_value(state["session"].clone())
                        .map_err(|_| "PORTAL_CAPTURE_ERROR")?;
                    crate::student_portal_session::validate_account(&session, &session.email)?;
                    let capture = capture_from_result(session, result);
                    match &capture.exams {
                        Ok(exams) => diagnostic(&format!("sign-in: portal exams parsed ({} records)", exams.len())),
                        Err(error) => diagnostic(&format!("sign-in: portal exam data unusable: {error}")),
                    }
                    return Ok(capture);
                }
            }
        }
        tokio::time::sleep(std::time::Duration::from_millis(500)).await;
    }
    Err(if auth_rejected { "PORTAL_LOGIN_REQUIRED" } else { "PORTAL_CAPTURE_TIMEOUT" }.into())
}

/// A background check can never open a login window. Auth expiry is handled by
/// the app's unified login screen; a valid ETag can avoid a full response body.
pub async fn fetch_exams(account: &str, has_cache: bool) -> Result<Option<Vec<ExamSchedule>>, String> {
    use crate::student_portal_session as session;
    let ticket = session::epoch();
    let saved = session::load(account)?.ok_or("PORTAL_LOGIN_REQUIRED")?;
    let body = session::renew(account, &saved, ticket, has_cache).await?;
    if body["notModified"] == true { return Ok(None); }
    parse_portal_exams(&body).map(Some)
}
