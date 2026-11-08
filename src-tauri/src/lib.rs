// Allow dead_code: auth.rs (SSO / legacy login flows), server.rs (OAuth callback server) and
// some structs in models.rs are intentional WIP feature modules not yet fully wired into the
// call chain, not dead code.
#![allow(dead_code)]

pub mod moodle;
mod student_portal;
mod student_portal_session;
#[cfg(test)]
mod student_portal_tests;
mod server;

use moodle::auth::{MoodleAuth, CookieData, SessionInfo};
use moodle::scraper::MoodleScraper;
use moodle::scraper::DownloadResult;
use moodle::models::{LoginResponse, SyncStatus, Course, Resource, Assignment, Announcement, CalendarEvent, Quiz, CourseContact, GradeEntry, GradeOverviewRow, UnitDashboard, UnitInfo, Schedule, SubmissionStatus, Recording, SyncOptions, SyncResult, ExamSchedule};
use std::sync::Arc;
use tauri::{Emitter, State};
use tokio::sync::Mutex;

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct AiConfig {
    pub api_key: String,
    pub api_url: String,
    pub model: String,
}

type PendingExamResult = (String, Result<Option<Vec<ExamSchedule>>, String>);

/// Application state holding authentication, scraper, and AI config instances
pub struct AppState {
    auth: Arc<MoodleAuth>,
    portal_account: Arc<Mutex<Option<String>>>,
    pending_exam_result: Arc<Mutex<Option<PendingExamResult>>>,
    exam_check_lock: Arc<Mutex<()>>,
    scraper: Arc<Mutex<Option<MoodleScraper>>>,
    ai_config: Arc<Mutex<Option<AiConfig>>>,
    /// Running background syncs by frontend run id, so logout / cancel_sync can abort them.
    syncs: Arc<std::sync::Mutex<std::collections::HashMap<String, tokio::task::AbortHandle>>>,
    /// Minimize to tray instead of closing the window (synced from the frontend settings, on by default)
    close_to_tray: std::sync::atomic::AtomicBool,
}

impl AppState {
    pub fn new() -> Self {
        let auth = Arc::new(MoodleAuth::new());
        Self {
            auth,
            portal_account: Arc::new(Mutex::new(None)),
            pending_exam_result: Arc::new(Mutex::new(None)),
            exam_check_lock: Arc::new(Mutex::new(())),
            scraper: Arc::new(Mutex::new(None)),
            ai_config: Arc::new(Mutex::new(None)),
            syncs: Arc::new(std::sync::Mutex::new(std::collections::HashMap::new())),
            close_to_tray: std::sync::atomic::AtomicBool::new(true),
        }
    }
}

/// Sync the frontend's "minimize to tray on close" setting to the backend (window events read it).
#[tauri::command]
fn set_close_to_tray(enabled: bool, state: tauri::State<'_, AppState>) {
    use std::sync::atomic::Ordering;
    state.close_to_tray.store(enabled, Ordering::Relaxed);
}

/// Return the architecture of the running desktop binary so the updater can
/// select the matching installer without relying on the WebView user agent.
#[tauri::command]
fn get_target_arch() -> &'static str {
    std::env::consts::ARCH
}

/// Login to Moodle with username and password
#[tauri::command]
async fn login(
    username: String,
    password: String,
    state: State<'_, AppState>,
) -> Result<LoginResponse, String> {
    let response = state.auth.login(&username, &password).await?;

    if response.success {
        *state.portal_account.lock().await = response.user.as_ref().map(|u| u.email.clone());
        let mut scraper_guard = state.scraper.lock().await;
        *scraper_guard = Some(MoodleScraper::new(state.auth.clone()));
    }

    Ok(response)
}

/// Login with session cookies (from WebView login)
#[tauri::command]
async fn login_with_cookies(
    cookies: Vec<CookieData>,
    state: State<'_, AppState>,
) -> Result<LoginResponse, String> {
    let response = state.auth.login_with_cookies(cookies).await?;

    if response.success {
        *state.portal_account.lock().await = response.user.as_ref().map(|u| u.email.clone());
        let mut scraper_guard = state.scraper.lock().await;
        *scraper_guard = Some(MoodleScraper::new(state.auth.clone()));
    }

    Ok(response)
}

/// Load saved session from disk. Returns whether a session was restored and
/// the logged-in user (fetched from the dashboard), so the frontend can
/// repopulate the user object instead of using the persisted placeholder.
#[tauri::command]
async fn load_saved_session(
    app_handle: tauri::AppHandle,
    state: State<'_, AppState>,
    has_exam_cache: Option<bool>,
) -> Result<SessionInfo, String> {
    let session = state.auth.load_saved_session(app_handle, state.scraper.clone()).await?;
    *state.portal_account.lock().await = session.user.as_ref().map(|u| u.email.clone());
    if session.logged_in {
        if let Some(account) = session.user.as_ref().map(|u| u.email.clone()).filter(|s| !s.is_empty()) {
            let _check = state.exam_check_lock.lock().await;
            if state.pending_exam_result.lock().await.as_ref().is_some_and(|(owner, _)| owner.eq_ignore_ascii_case(&account)) {
                return Ok(session);
            }
            let check = tokio::time::timeout(std::time::Duration::from_secs(10), student_portal::fetch_exams(&account, has_exam_cache.unwrap_or(false))).await
                .unwrap_or_else(|_| Err("PORTAL_NETWORK_ERROR".into()));
            if check.as_ref().err().is_some_and(|error| error == "PORTAL_LOGIN_REQUIRED" || error == "PORTAL_ACCOUNT_MISMATCH") {
                return Ok(SessionInfo { logged_in: false, user: session.user });
            }
            *state.pending_exam_result.lock().await = Some((account, check));
        }
    }
    Ok(session)
}

/// Logout from Moodle
#[tauri::command]
async fn logout(app_handle: tauri::AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    use tauri::Manager;
    if let Some(window) = app_handle.get_webview_window("student-portal-exams") { let _ = window.close(); }
    if let Some(account) = state.portal_account.lock().await.take() { student_portal_session::clear(&account); }
    *state.pending_exam_result.lock().await = None;
    abort_all_syncs(&state);
    state.auth.logout().await?;

    let mut scraper_guard = state.scraper.lock().await;
    *scraper_guard = None;

    Ok(())
}

/// Check if user is logged in
#[tauri::command]
async fn is_logged_in(state: State<'_, AppState>) -> Result<bool, String> {
    Ok(state.auth.is_logged_in().await)
}

/// Fetch all enrolled courses
#[tauri::command]
async fn fetch_courses(state: State<'_, AppState>) -> Result<Vec<Course>, String> {
    let scraper_guard = state.scraper.lock().await;
    let scraper = scraper_guard.as_ref().ok_or("Not logged in")?;
    scraper.fetch_courses().await
}

/// Fetch resources for a specific course
#[tauri::command]
async fn fetch_course_resources(
    course_id: u64,
    state: State<'_, AppState>,
) -> Result<Vec<Resource>, String> {
    let scraper_guard = state.scraper.lock().await;
    let scraper = scraper_guard.as_ref().ok_or("Not logged in")?;
    scraper.fetch_course_resources(course_id).await
}

/// Fetch assignments for a specific course
#[tauri::command]
async fn fetch_assignments(
    course_id: u64,
    state: State<'_, AppState>,
) -> Result<Vec<Assignment>, String> {
    let scraper_guard = state.scraper.lock().await;
    let scraper = scraper_guard.as_ref().ok_or("Not logged in")?;
    scraper.fetch_assignments(course_id).await
}

/// Fetch announcements for a specific course
#[tauri::command]
async fn fetch_announcements(
    course_id: u64,
    state: State<'_, AppState>,
) -> Result<Vec<Announcement>, String> {
    let scraper_guard = state.scraper.lock().await;
    let scraper = scraper_guard.as_ref().ok_or("Not logged in")?;
    scraper.fetch_announcements(course_id).await
}

/// Fetch course contacts (teachers/course team) by parsing the "Contacts" widget on the
/// course page `course/view.php?id=<courseId>`. Teachers/course team only, no students.
#[tauri::command]
async fn fetch_course_contacts(
    course_id: u64,
    state: State<'_, AppState>,
) -> Result<Vec<CourseContact>, String> {
    let scraper_guard = state.scraper.lock().await;
    let scraper = scraper_guard.as_ref().ok_or("Not logged in")?;
    scraper.fetch_course_contacts(course_id).await
}

/// Fetch the course assessment overview (Assessments section): assignments + quizzes + weights + categories.
#[tauri::command]
async fn fetch_course_assessments(
    course_id: u64,
    state: State<'_, AppState>,
) -> Result<Vec<Assignment>, String> {
    let scraper_guard = state.scraper.lock().await;
    let scraper = scraper_guard.as_ref().ok_or("Not logged in")?;
    scraper.fetch_course_assessments(course_id).await
}

/// Fetch the course handbook (Unit Information section).
#[tauri::command]
async fn fetch_course_unit_info(
    course_id: u64,
    state: State<'_, AppState>,
) -> Result<UnitInfo, String> {
    let scraper_guard = state.scraper.lock().await;
    let scraper = scraper_guard.as_ref().ok_or("Not logged in")?;
    scraper.fetch_course_unit_info(course_id).await
}

/// Fetch the course schedule / key dates (Schedule section).
#[tauri::command]
async fn fetch_course_schedule(
    course_id: u64,
    state: State<'_, AppState>,
) -> Result<Schedule, String> {
    let scraper_guard = state.scraper.lock().await;
    let scraper = scraper_guard.as_ref().ok_or("Not logged in")?;
    scraper.fetch_course_schedule(course_id).await
}

/// Fetch the submission status and feedback of a single assignment.
#[tauri::command]
async fn fetch_assignment_submission(
    course_id: u64,
    assignment_id: u64,
    assessment_type: String,
    state: State<'_, AppState>,
) -> Result<SubmissionStatus, String> {
    let scraper_guard = state.scraper.lock().await;
    let scraper = scraper_guard.as_ref().ok_or("Not logged in")?;
    scraper
        .fetch_assignment_submission(course_id, assignment_id, &assessment_type)
        .await
}

/// Fetch course recordings (Panopto block).
#[tauri::command]
async fn fetch_course_recordings(
    course_id: u64,
    state: State<'_, AppState>,
) -> Result<Vec<Recording>, String> {
    let scraper_guard = state.scraper.lock().await;
    let scraper = scraper_guard.as_ref().ok_or("Not logged in")?;
    scraper.fetch_course_recordings(course_id).await
}

/// Abort every running background sync (logout / account switch).
fn abort_all_syncs(state: &AppState) {
    let handles: Vec<_> = state.syncs.lock().unwrap().drain().map(|(_, h)| h).collect();
    for handle in handles {
        handle.abort();
    }
}

/// Sync all data from Moodle.
///
/// The scraper is cloned out of the mutex so other commands (opening a course,
/// downloads) are not blocked for the whole sync. With a `run_id`, progress goes to
/// `sync-progress-{runId}` and per-course batches to `sync-data-{runId}` while the
/// sync is still running; the sync can be aborted with `cancel_sync(runId)`.
#[tauri::command]
async fn sync_all(
    app_handle: tauri::AppHandle,
    state: State<'_, AppState>,
    options: Option<SyncOptions>,
    #[allow(unused)] include_fixed_tabs: Option<bool>,
    run_id: Option<String>,
) -> Result<SyncResult, String> {
    let scraper = {
        let scraper_guard = state.scraper.lock().await;
        scraper_guard.as_ref().ok_or("Not logged in")?.clone()
    };
    let run_id = run_id.filter(|id| {
        !id.is_empty() && id.len() <= 64 && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
    });
    let progress_handle = app_handle.clone();
    let progress_run = run_id.clone();
    let progress: Option<std::sync::Arc<dyn Fn(usize, usize, &str) + Send + Sync>> =
        Some(std::sync::Arc::new(move |done, total, phase| {
            let payload = serde_json::json!({ "done": done, "total": total, "phase": phase });
            let _ = progress_handle.emit("sync-progress", payload.clone());
            if let Some(id) = &progress_run {
                let _ = progress_handle.emit(&format!("sync-progress-{}", id), payload);
            }
        }));
    let on_patch: Option<std::sync::Arc<dyn Fn(moodle::models::SyncPatch) + Send + Sync>> = run_id.clone().map(|id| {
        let handle = app_handle.clone();
        let event = format!("sync-data-{}", id);
        std::sync::Arc::new(move |patch: moodle::models::SyncPatch| {
            let _ = handle.emit(&event, patch);
        }) as std::sync::Arc<dyn Fn(moodle::models::SyncPatch) + Send + Sync>
    });
    let mut opts = options.unwrap_or_default();
    if let Some(ift) = include_fixed_tabs {
        opts.include_fixed_tabs = ift;
    }

    let task = tokio::spawn(async move { scraper.fetch_all_data(progress, on_patch, opts).await });
    let key = run_id.unwrap_or_else(|| {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        format!("anon-{}", nanos)
    });
    state.syncs.lock().unwrap().insert(key.clone(), task.abort_handle());
    let outcome = task.await;
    state.syncs.lock().unwrap().remove(&key);
    match outcome {
        Ok(result) => result,
        Err(e) if e.is_cancelled() => Err("SYNC_CANCELLED".into()),
        Err(e) => Err(format!("sync task failed: {}", e)),
    }
}

/// Abort a background sync started with `sync_all(runId)`. Unknown ids are a no-op.
#[tauri::command]
fn cancel_sync(run_id: String, state: State<'_, AppState>) -> bool {
    match state.syncs.lock().unwrap().remove(&run_id) {
        Some(handle) => {
            handle.abort();
            true
        }
        None => false,
    }
}

/// Remove all files inside the configured download folder (user-initiated, from the clear-data modal).
#[tauri::command]
async fn clear_downloads(save_path: String) -> Result<(), String> {
    let raw = std::path::PathBuf::from(save_path);
    let dir = if raw.is_absolute() {
        raw
    } else {
        dirs::download_dir()
            .unwrap_or_else(|| std::path::PathBuf::from("."))
            .join("Muster")
    };
    if !dir.exists() {
        return Ok(());
    }
    for entry in std::fs::read_dir(&dir).map_err(|e| e.to_string())? {
        let path = entry.map_err(|e| e.to_string())?.path();
        if path.is_dir() {
            std::fs::remove_dir_all(&path).map_err(|e| e.to_string())?;
        } else {
            std::fs::remove_file(&path).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

/// Minimal connectivity probe for the user's configured AI endpoint (OpenAI-compatible or Anthropic).
#[tauri::command]
async fn test_ai_connection(
    state: State<'_, AppState>,
    api_key: String,
    api_url: String,
    model: String,
) -> Result<serde_json::Value, String> {
    let scraper_guard = state.scraper.lock().await;
    let scraper = scraper_guard.as_ref().ok_or("Not logged in")?;
    scraper.test_ai_connection(&api_key, &api_url, &model).await
}

/// Get sync status (fetches live counts from Moodle)
#[tauri::command]
async fn get_sync_status(state: State<'_, AppState>) -> Result<SyncStatus, String> {
    let scraper_guard = state.scraper.lock().await;
    let scraper = scraper_guard.as_ref().ok_or("Not logged in")?;

    let courses = scraper.fetch_courses().await?;

    let mut resources_count = 0;
    let mut assignments_count = 0;
    let mut announcements_count = 0;

    for course in &courses {
        // Skip portal/hub courses: they have no assignments/resources/announcements, and it saves requests
        if course.is_portal {
            continue;
        }
        if let Ok(resources) = scraper.fetch_course_resources(course.id).await {
            resources_count += resources.len() as u32;
        }
        // Count assessments (quizzes included) the same way the sync path does
        if let Ok(assignments) = scraper.fetch_course_assessments(course.id).await {
            assignments_count += assignments.len() as u32;
        }
        if let Ok(announcements) = scraper.fetch_announcements(course.id).await {
            announcements_count += announcements.len() as u32;
        }
    }

    Ok(SyncStatus {
        last_sync: Some(chrono::Local::now().to_rfc3339()),
        courses_count: courses.len() as u32,
        resources_count,
        assignments_count,
        announcements_count,
    })
}

/// Download a file from Moodle
#[tauri::command]
async fn download_file(
    file_url: String,
    save_path: String,
    skip_existing: bool,
    state: State<'_, AppState>,
    app_handle: tauri::AppHandle,
) -> Result<DownloadResult, String> {
    let scraper_guard = state.scraper.lock().await;
    let scraper = scraper_guard.as_ref().ok_or("Not logged in")?;
    scraper.download_file(&file_url, &save_path, Some(&app_handle), skip_existing).await
}

/// Fetch all-course calendar events (month view merged with upcoming).
#[tauri::command]
async fn fetch_calendar_events(
    state: State<'_, AppState>,
) -> Result<Vec<CalendarEvent>, String> {
    let scraper_guard = state.scraper.lock().await;
    let scraper = scraper_guard.as_ref().ok_or("Not logged in")?;
    scraper.fetch_calendar_events().await
}

/// Fetch the cross-course grade overview (grade/report/overview).
#[tauri::command]
async fn fetch_grade_overview(
    state: State<'_, AppState>,
) -> Result<Vec<GradeOverviewRow>, String> {
    let scraper_guard = state.scraper.lock().await;
    let scraper = scraper_guard.as_ref().ok_or("Not logged in")?;
    scraper.fetch_grade_overview().await
}

/// Fetch the quiz list of a course (mod/quiz/index.php).
#[tauri::command]
async fn fetch_course_quizzes(
    course_id: u64,
    state: State<'_, AppState>,
) -> Result<Vec<Quiz>, String> {
    let scraper_guard = state.scraper.lock().await;
    let scraper = scraper_guard.as_ref().ok_or("Not logged in")?;
    scraper.fetch_course_quizzes(course_id).await
}

/// Fetch the course gradebook (grade/report/user: all grades + ranges + feedback)
#[tauri::command]
async fn fetch_course_gradebook(
    course_id: u64,
    state: State<'_, AppState>,
) -> Result<Vec<GradeEntry>, String> {
    let scraper_guard = state.scraper.lock().await;
    let scraper = scraper_guard.as_ref().ok_or("Not logged in")?;
    scraper.fetch_course_gradebook(course_id).await
}

/// Fetch the unit dashboard (current week card + learning objectives + week index)
#[tauri::command]
async fn fetch_course_unit_dashboard(
    course_id: u64,
    state: State<'_, AppState>,
) -> Result<UnitDashboard, String> {
    let scraper_guard = state.scraper.lock().await;
    let scraper = scraper_guard.as_ref().ok_or("Not logged in")?;
    scraper.fetch_course_unit_dashboard(course_id).await
}

/// Save AI configuration in backend state
#[tauri::command]
async fn save_ai_config(
    api_key: String,
    api_url: String,
    model: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let mut guard = state.ai_config.lock().await;
    *guard = Some(AiConfig {
        api_key,
        api_url,
        model,
    });
    Ok(())
}

// Reserve before dispatching generation so cancel-before-start needs no
// tombstones. An absent reservation can never recreate a cancelled request.
#[derive(Default)]
struct SummaryStreamRegistry {
    jobs: std::sync::Mutex<std::collections::HashMap<String, Arc<SummaryStreamJob>>>,
}

struct SummaryStreamJob {
    cancel: tokio::sync::watch::Sender<bool>,
    started: std::sync::atomic::AtomicBool,
}

struct SummaryStreamGuard<'a> {
    registry: &'a SummaryStreamRegistry,
    stream_id: String,
    job: Arc<SummaryStreamJob>,
}

impl Drop for SummaryStreamGuard<'_> {
    fn drop(&mut self) {
        let mut jobs = self.registry.jobs.lock().unwrap_or_else(|e| e.into_inner());
        if jobs.get(&self.stream_id).is_some_and(|job| Arc::ptr_eq(job, &self.job)) {
            jobs.remove(&self.stream_id);
        }
    }
}

impl SummaryStreamRegistry {
    fn reserve(&self, stream_id: &str) -> Result<(), String> {
        let mut jobs = self.jobs.lock().unwrap_or_else(|e| e.into_inner());
        if jobs.contains_key(stream_id) {
            return Err("Summary stream ID already registered".into());
        }
        let (cancel, _) = tokio::sync::watch::channel(false);
        jobs.insert(stream_id.into(), Arc::new(SummaryStreamJob {
            cancel, started: std::sync::atomic::AtomicBool::new(false),
        }));
        Ok(())
    }

    fn cancel(&self, stream_id: &str) {
        if let Some(job) = self.jobs.lock().unwrap_or_else(|e| e.into_inner()).remove(stream_id) {
            // send_replace retains the state even if cancellation beats subscribe.
            job.cancel.send_replace(true);
        }
    }

    async fn run<F>(&self, stream_id: &str, generation: F) -> Result<(), String>
    where F: std::future::Future<Output = Result<(), String>> {
        let job = {
            let jobs = self.jobs.lock().unwrap_or_else(|e| e.into_inner());
            let job = jobs.get(stream_id).ok_or("Summary stream cancelled or not registered")?.clone();
            if job.started.swap(true, std::sync::atomic::Ordering::SeqCst) {
                return Err("Summary stream already started".into());
            }
            job
        };
        let guard = SummaryStreamGuard { registry: self, stream_id: stream_id.into(), job };
        let mut cancellation = guard.job.cancel.subscribe();
        // Drop the losing generation future, including reqwest/SSE and any
        // scraper/config lock wait. The guard removes this job only.
        tokio::select! {
            biased;
            _ = async {
                loop {
                    if *cancellation.borrow_and_update() { break; }
                    if cancellation.changed().await.is_err() { break; }
                }
            } => Err("Summary stream cancelled".into()),
            result = generation => result,
        }
    }
}

fn summary_streams() -> &'static SummaryStreamRegistry {
    static STREAMS: std::sync::OnceLock<SummaryStreamRegistry> = std::sync::OnceLock::new();
    STREAMS.get_or_init(SummaryStreamRegistry::default)
}

#[tauri::command]
fn register_summary_stream(stream_id: String) -> Result<(), String> {
    summary_streams().reserve(&stream_id)
}

#[tauri::command]
fn cancel_summary_stream(stream_id: String) {
    summary_streams().cancel(&stream_id);
}

/// Stream an AI summary through a previously reserved, cancellable job.
#[tauri::command]
async fn generate_summary_stream(
    content: String,
    api_key: Option<String>,
    api_url: Option<String>,
    model: Option<String>,
    mode: Option<String>,
    stream_id: String,
    state: State<'_, AppState>,
    app_handle: tauri::AppHandle,
) -> Result<(), String> {
    summary_streams().run(&stream_id, async {
        let scraper_guard = state.scraper.lock().await;
        let scraper = scraper_guard.as_ref().ok_or("Not logged in")?;

        let ai_guard = state.ai_config.lock().await;
        let key = api_key
            .filter(|k| !k.trim().is_empty())
            .or_else(|| ai_guard.as_ref().map(|c| c.api_key.clone()))
            .ok_or_else(|| "AI API Key is missing. Please configure it in Settings.".to_string())?;
        let url = api_url
            .filter(|u| !u.trim().is_empty())
            .or_else(|| ai_guard.as_ref().map(|c| c.api_url.clone()))
            .unwrap_or_else(|| "https://api.openai.com/v1/chat/completions".to_string());
        let md = model
            .filter(|m| !m.trim().is_empty())
            .or_else(|| ai_guard.as_ref().map(|c| c.model.clone()))
            .unwrap_or_else(|| "gpt-4o-mini".to_string());
        drop(ai_guard);

        scraper
            .generate_summary_stream(&content, &key, &url, &md, mode.as_deref().unwrap_or("summary"), Some(&app_handle), &stream_id)
            .await
    }).await
}

/// Generate an AI summary of course content
#[tauri::command]
async fn generate_summary(
    content: String,
    api_key: Option<String>,
    api_url: Option<String>,
    model: Option<String>,
    mode: Option<String>,
    state: State<'_, AppState>,
) -> Result<String, String> {
    let scraper_guard = state.scraper.lock().await;
    let scraper = scraper_guard.as_ref().ok_or("Not logged in")?;

    let ai_guard = state.ai_config.lock().await;

    let key = api_key
        .filter(|k| !k.trim().is_empty())
        .or_else(|| ai_guard.as_ref().map(|c| c.api_key.clone()))
        .ok_or_else(|| "AI API Key is missing. Please configure it in Settings.".to_string())?;

    let url = api_url
        .filter(|u| !u.trim().is_empty())
        .or_else(|| ai_guard.as_ref().map(|c| c.api_url.clone()))
        .unwrap_or_else(|| "https://api.openai.com/v1/chat/completions".to_string());

    let md = model
        .filter(|m| !m.trim().is_empty())
        .or_else(|| ai_guard.as_ref().map(|c| c.model.clone()))
        .unwrap_or_else(|| "gpt-4o-mini".to_string());

    scraper
        .generate_summary(&content, &key, &url, &md, mode.as_deref().unwrap_or("summary"))
        .await
}

/// Start SSO login flow with the system browser.
///
/// Retained for backwards compatibility with the frontend but routed through the
/// embedded WebView. The original system-browser design was broken by design:
/// the browser and the Rust `reqwest` client have separate cookie stores, so the
/// SSO session could never be shared (see reference project, which uses one
/// Playwright context for both). Use [`start_sso_login_webview`] directly.
#[tauri::command]
async fn start_sso_login(
    app_handle: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<LoginResponse, String> {
    start_sso_login_webview_inner(app_handle, state).await
}

/// SSO login via an embedded Tauri WebView window.
///
/// Flow:
/// 1. Complete Student Portal authentication, then Moodle in the same WebView.
/// 2. Let the user complete Monash SSO + 2FA inside it (navigations to
///    okta/google are allowed — `on_navigation` always returns true).
/// 3. When the WebView lands on `learning.monash.edu/my/...` (no `login` in the
///    path), both realms are authenticated.
/// 4. Read the WebView's cookies (incl. HttpOnly `MoodleSession`) via the
///    WebView2 cookie manager and hand them to `reqwest`.
/// 5. Close the window and finish the login as if it were a cookie login.
#[tauri::command]
async fn start_sso_login_webview(
    app_handle: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<LoginResponse, String> {
    start_sso_login_webview_inner(app_handle, state).await
}

async fn start_sso_login_webview_inner(
    app_handle: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<LoginResponse, String> {
    use std::sync::{Arc, Mutex};
    use tauri::WebviewUrl;
    use tauri::webview::WebviewWindowBuilder;
    use tauri::Manager;
    use url::Url;

    const LOGIN_URL: &str = "https://learning.monash.edu/login/index.php";
    const WINDOW_LABEL: &str = "sso-login";

    // If a stale login window is still around (e.g. previous attempt was
    // abandoned), close it before opening a fresh one.
    if let Some(existing) = app_handle.get_webview_window(WINDOW_LABEL) {
        let _ = existing.close();
        // Give the runtime a moment to tear it down.
        tokio::time::sleep(std::time::Duration::from_millis(200)).await;
    }

    // Channel used by `on_navigation` to signal that the user has landed on the
    // authenticated dashboard. Wrapped in Option so it fires exactly once.
    let success_tx: Arc<Mutex<Option<tokio::sync::oneshot::Sender<Url>>>> =
        Arc::new(Mutex::new(None));
    let (tx, rx) = tokio::sync::oneshot::channel::<Url>();
    *success_tx.lock().unwrap() = Some(tx);

    // `on_navigation` runs on the UI thread before each navigation. We must
    // return `true` for every URL (returning false would cancel the redirect to
    // the SSO provider and break login); we only *observe* success as a side
    // effect.
    let success_tx_clone = success_tx.clone();
    let on_nav = move |url: &Url| -> bool {
        if is_moodle_dashboard(url) {
            if let Some(sender) = success_tx_clone.lock().unwrap().take() {
                let _ = sender.send(url.clone());
            }
        }
        true
    };

    *state.pending_exam_result.lock().await = None;
    let login_url: Url = "https://home.student.monash/"
        .parse()
        .map_err(|e| format!("invalid login URL: {}", e))?;

    let webview_window = WebviewWindowBuilder::new(
        &app_handle,
        WINDOW_LABEL,
        WebviewUrl::External(login_url),
    )
    .title("Monash SSO Sign In")
    .inner_size(1000.0, 720.0)
    .min_inner_size(640.0, 480.0)
    .center()
    .visible(false)
    .on_navigation(on_nav)
    .initialization_script(include_str!("student_portal_capture.js"))
    .build()
    .map_err(|e| format!("Failed to open login window: {}", e))?;
    // Silent SSO (existing school session) completes without ever showing a window.
    student_portal::reveal_when_interactive(webview_window.clone());

    let success_tx_close = success_tx.clone();
    webview_window.on_window_event(move |event| {
        if matches!(event, tauri::WindowEvent::CloseRequested { .. } | tauri::WindowEvent::Destroyed) {
            if let Ok(mut guard) = success_tx_close.lock() {
                // Drop the sender so rx unblocks immediately with RecvError
                let _ = guard.take();
            }
        }
    });

    // Authenticate the stricter Portal realm FIRST, in the one visible login window.
    // Home remains gated until both this leg and Moodle are ready.
    let portal_capture = match student_portal::begin_sso(&webview_window).await {
        Ok(capture) => capture,
        Err(error) => {
            student_portal::diagnostic(&format!("sign-in: portal leg failed: {error}"));
            let _ = webview_window.close();
            return Err(error);
        }
    };
    if webview_window.navigate(LOGIN_URL.parse().unwrap()).is_err() {
        let _ = webview_window.close();
        return Err("PORTAL_WEBVIEW_ERROR".into());
    }

    // Wait (up to 5 min) for the user to complete SSO and land on /my/.
    let _success_url = match tokio::time::timeout(
        std::time::Duration::from_secs(300),
        rx,
    )
    .await
    {
        Ok(Ok(url)) => url,
        Ok(Err(_)) => {
            let _ = webview_window.close();
            return Err("Login cancelled or the window was closed.".to_string());
        }
        Err(_) => {
            let _ = webview_window.close();
            return Err(
                "Login timed out (not completed within 5 minutes). Please complete the Monash SSO login in the popup window and try again."
                    .to_string(),
            );
        }
    };

    // Give the WebView a beat to commit the final redirect's cookies before we
    // read them from the cookie manager.
    tokio::time::sleep(std::time::Duration::from_millis(800)).await;

    // Extract cookies through the established WebView2 path on Windows and
    // Tauri's HttpOnly-capable WKWebView API on macOS.
    #[cfg(windows)]
    let (cookies_tx, cookies_rx) = std::sync::mpsc::channel::<Result<Vec<CookieData>, String>>();
    #[cfg(windows)]
    let webview_for_extract = webview_window.clone();
    #[cfg(windows)]
    webview_for_extract
        .with_webview(move |pw| {
            let result = moodle::webview_cookies::extract_moodle_cookies(&pw);
            let _ = cookies_tx.send(result);
        })
        .map_err(|e| format!("Failed to access WebView for cookie extraction: {}", e))?;

    #[cfg(windows)]
    let cookies = cookies_rx
        .recv_timeout(std::time::Duration::from_secs(15))
        .map_err(|e| format!("Cookie extraction timed out: {}", e))??;

    #[cfg(any(target_os = "macos", target_os = "linux"))]
    let cookies = moodle::webview_cookies::extract_moodle_cookies_webkit(&webview_window)?;

    #[cfg(not(any(windows, target_os = "macos", target_os = "linux")))]
    let cookies: Vec<CookieData> = {
        let _ = webview_window.close();
        return Err("SSO cookie extraction is supported only on Windows, macOS, and Linux.".to_string());
    };

    if cookies.is_empty() {
        let _ = webview_window.close();
        return Err(
            "No valid session cookie was obtained after login. Please try logging in again.".to_string(),
        );
    }

    println!("SSO WebView login: extracted {} cookies", cookies.len());

    // Hand the WebView cookies (incl. HttpOnly MoodleSession) to reqwest.
    let response = state.auth.login_with_cookies(cookies).await?;

    if response.success {
        *state.portal_account.lock().await = response.user.as_ref().map(|u| u.email.clone());
        let mut scraper_guard = state.scraper.lock().await;
        *scraper_guard = Some(MoodleScraper::new(state.auth.clone()));
        drop(scraper_guard);
        let account = response.user.as_ref().map(|u| u.email.as_str()).unwrap_or("");
        let bound = student_portal_session::bind_owner(portal_capture.session, account)
            .and_then(|session| student_portal_session::save_guarded(account, &session, student_portal_session::epoch()));
        if let Err(error) = bound {
            student_portal::diagnostic(&format!("sign-in: portal credential not saved: {error}"));
            let _ = state.auth.logout().await;
            *state.portal_account.lock().await = None;
            let _ = webview_window.close();
            return Err(error);
        }
        // Exam data errors surface in the exam section, never as a login failure.
        *state.pending_exam_result.lock().await = Some((account.into(), portal_capture.exams.map(Some)));
    }
    let _ = webview_window.close();

    Ok(response)
}

/// Recent lines of the redacted portal diagnostics log (error codes and field types only),
/// attached to in-app problem reports when the user opts in.
#[tauri::command]
fn read_portal_diagnostics() -> String {
    student_portal::diagnostics_tail(40)
}

/// Fetch exams from the authenticated Monash student portal.
#[tauri::command]
async fn fetch_exams(state: State<'_, AppState>, has_cache: Option<bool>) -> Result<Option<Vec<ExamSchedule>>, String> {
    let _check = state.exam_check_lock.lock().await;
    let account = match state.portal_account.lock().await.clone() {
        Some(account) => account,
        // Moodle permits offline restoration even if profile lookup fails. Do not
        // turn an unavailable identity into a false authentication-expired event.
        None if state.auth.is_logged_in().await => return Err("PORTAL_IDENTITY_UNAVAILABLE".into()),
        None => return Err("PORTAL_LOGIN_REQUIRED".into()),
    };
    if let Some((owner, result)) = state.pending_exam_result.lock().await.take() {
        if owner.eq_ignore_ascii_case(&account) { return result; }
    }
    student_portal::fetch_exams(&account, has_cache.unwrap_or(false)).await
}

/// Open a Moodle URL in an in-app WebView window.
///
/// Deliberately *not* the system browser: the app's WebView2 shares the
/// user-data folder that the SSO login flow populated, so the MoodleSession
/// cookie is already there and the user is not asked to log in again.
///
/// The URL is restricted to `monash.edu` hosts over https. This window carries
/// the user's live Moodle session, so allowing an arbitrary URL here would let
/// any injected link ride that session. It is also intentionally left out of
/// `capabilities/default.json`, meaning the remote page gets no Tauri IPC access.
#[tauri::command]
async fn open_in_app_webview(
    app_handle: tauri::AppHandle,
    url: String,
    title: Option<String>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    use tauri::webview::WebviewWindowBuilder;
    use tauri::{Manager, WebviewUrl};
    use url::Url;

    const LABEL: &str = "in-app-browser";

    let parsed: Url = url.parse().map_err(|e| format!("Invalid link: {}", e))?;

    if parsed.scheme() != "https" {
        return Err("Only https links are supported".to_string());
    }
    let host_ok = parsed
        .host_str()
        .map(|h| h == "monash.edu" || h.ends_with(".monash.edu"))
        .unwrap_or(false);
    if !host_ok {
        return Err("Only Monash on-site links are allowed".to_string());
    }

    // Get the cookie data of the currently logged-in user
    let cookies = state.auth.get_saved_cookies().await;

    // Reuse the same window: replace its content when another assignment is clicked, to avoid piling up windows
    if let Some(existing) = app_handle.get_webview_window(LABEL) {
        let _ = existing.close();
        tokio::time::sleep(std::time::Duration::from_millis(150)).await;
    }

    let webview_window = WebviewWindowBuilder::new(&app_handle, LABEL, WebviewUrl::External(parsed))
        .title(title.unwrap_or_else(|| "Muster".to_string()))
        // A notch smaller than the main window (1360x840), centered on top, so it reads like a
        // child window rather than another peer main window
        .inner_size(1020.0, 700.0)
        .min_inner_size(560.0, 420.0)
        .center()
        .build()
        .map_err(|e| format!("Failed to open window: {}", e))?;

    // Inject the MoodleSession and other cookies to allow login-free access.
    if !cookies.is_empty() {
        #[cfg(windows)]
        {
            let url_for_inject = url.clone();
            let _ = webview_window.with_webview(move |pw| {
                let _ = moodle::webview_cookies::inject_moodle_cookies(
                    &pw,
                    &cookies,
                    &url_for_inject,
                );
            });
        }

        #[cfg(any(target_os = "macos", target_os = "linux"))]
        moodle::webview_cookies::inject_moodle_cookies_webkit(
            &webview_window,
            &cookies,
            &url,
        )?;
    }

    Ok(())
}

/// Heuristic: has the user reached the authenticated Moodle dashboard?
///
/// After a successful SSO the WebView lands on `learning.monash.edu/my/...` (or
/// occasionally the site root). We treat any `learning.monash.edu` URL whose
/// path does not contain `login` as authenticated — this excludes the SSO
/// provider hosts (okta/google) and the Moodle login page itself.
fn is_moodle_dashboard(url: &url::Url) -> bool {
    match url.host_str() {
        Some(host) if host.ends_with("learning.monash.edu") => {
            !url.path().to_lowercase().contains("login")
        }
        _ => false,
    }
}

// ============================================================================
// Boot Trace
//
// Purpose: open up the previously unobservable timeline behind "black screen after launch /
// slow loading". Milestones from both the Rust side and the WebView side are recorded on a
// single timeline sharing the same zero point (the instant the process enters `run()`), so
// per-stage cost and who is waiting on whom can be read off directly.
//
// Output goes to two places:
//   1. stdout -- directly visible in the `npm run tauri dev` terminal, easy to copy-paste.
//   2. `<downloads dir>/muster-boot.log` -- also available in production builds,
//      since the packaged exe has no terminal. Each launch **appends**, never truncates.
//
// The frontend pushes its own milestones onto the same timeline via the `dev_log` command
// (see index.html).
// ============================================================================
static BOOT_INSTANT: std::sync::OnceLock<std::time::Instant> = std::sync::OnceLock::new();

fn boot_elapsed_ms() -> u128 {
    BOOT_INSTANT
        .get_or_init(std::time::Instant::now)
        .elapsed()
        .as_millis()
}

/// Write one boot log line: stdout + boot.log in the downloads directory.
fn boot_log(source: &str, message: &str) {
    let line = format!(
        "[boot +{:>6}ms] [{:<5}] {}",
        boot_elapsed_ms(),
        source,
        message
    );
    println!("{}", line);

    // Persist to disk (failures are silent: logging itself must never fail the boot)
    if let Some(dir) = dirs::download_dir() {
        let path = dir.join("muster-boot.log");
        use std::io::Write;
        if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(path) {
            let _ = writeln!(f, "{}", line);
        }
    }
}

/// Called by the frontend to write WebView-side milestones onto the same boot timeline.
///
/// `stage` is the stage name (e.g. `html-parsed` / `react-mount` / `first-paint`); `detail`
/// usually carries the frontend's own relative milliseconds so both clocks can be aligned.
#[tauri::command]
fn dev_log(stage: String, detail: String) {
    boot_log("web", &format!("{} — {}", stage, detail));
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
/// Structured system information attached to feedback submissions.
/// Reported from Rust (not parsed from a user-agent string): OS family, exact
/// version, architecture, Apple Silicon flag and the app version.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemInfo {
    pub os: String,
    pub arch: String,
    pub os_version: String,
    pub is_apple_silicon: bool,
    pub app_version: String,
}

/// Best-effort OS version:
/// - Windows: RtlGetVersion (kernel version, e.g. "10.0.26200")
/// - macOS:   `sw_vers -productVersion` (e.g. "15.5")
/// - other:   empty (unknown)
fn detect_os_version() -> String {
    #[cfg(target_os = "windows")]
    {
        use windows::Wdk::System::SystemServices::RtlGetVersion;
        use windows::Win32::System::SystemInformation::OSVERSIONINFOW;
        let mut vi = OSVERSIONINFOW {
            dwOSVersionInfoSize: std::mem::size_of::<OSVERSIONINFOW>() as u32,
            ..Default::default()
        };
        // NTSTATUS == 0 means STATUS_SUCCESS.
        let status = unsafe { RtlGetVersion(&mut vi) };
        if status.is_ok() {
            return format!("{}.{}.{}", vi.dwMajorVersion, vi.dwMinorVersion, vi.dwBuildNumber);
        }
        "unknown".to_string()
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("sw_vers")
            .arg("-productVersion")
            .output()
            .ok()
            .and_then(|o| String::from_utf8(o.stdout).ok())
            .map(|v| v.trim().to_string())
            .unwrap_or_else(|| "unknown".to_string())
    }
    #[cfg(target_os = "linux")]
    {
        if let Ok(content) = std::fs::read_to_string("/etc/os-release") {
            for line in content.lines() {
                if let Some(val) = line.strip_prefix("PRETTY_NAME=") {
                    return val.trim_matches('"').to_string();
                }
            }
        }
        std::process::Command::new("uname")
            .arg("-r")
            .output()
            .ok()
            .and_then(|o| String::from_utf8(o.stdout).ok())
            .map(|v| v.trim().to_string())
            .unwrap_or_else(|| "unknown".to_string())
    }
    #[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
    {
        "unknown".to_string()
    }
}

#[tauri::command]
fn get_system_info(app_handle: tauri::AppHandle) -> SystemInfo {
    let os = std::env::consts::OS.to_string();
    let arch = std::env::consts::ARCH.to_string();
    SystemInfo {
        os,
        arch,
        os_version: detect_os_version(),
        is_apple_silicon: std::env::consts::OS == "macos" && std::env::consts::ARCH == "aarch64",
        app_version: app_handle.package_info().version.to_string(),
    }
}

pub fn run() {
    use tauri::{Listener, Manager};

    // Boot timing origin: anchored the moment the process enters run(), the shared zero point for all boot logs.
    let _ = BOOT_INSTANT.set(std::time::Instant::now());
    boot_log("rust", "run() entered, building tauri app");

    tauri::Builder::default()
        // MUST be the first plugin (per tauri-plugin-single-instance docs):
        // any second launch of the app is redirected here — we just focus the
        // existing main window and exit the new process. Without this, every
        // double-click (and every NSIS-installer relaunch during an update)
        // spawned a fully parallel instance. Incident report: 20+ cascading
        // windows froze a user's PC (see v0.2.9 release notes).
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            use tauri::Manager;
            boot_log("rust", "single-instance callback: focusing existing window");
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.show();
                let _ = w.unminimize();
                let _ = w.set_focus();
            }
        }))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .manage(AppState::new())
        .on_window_event(|window, event| {
            // Main window close button: hide instead of exiting when "minimize to tray on close" is enabled
            if window.label() == "main" {
                if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                    use std::sync::atomic::Ordering;
                    let state = window.state::<AppState>();
                    if state.close_to_tray.load(Ordering::Relaxed) {
                        api.prevent_close();
                        let _ = window.hide();
                    }
                }
            }
        })
        .setup(|app| {
            // System tray: left click shows the main window; menu = Show / Quit
            {
                use tauri::menu::{Menu, MenuItem};
                use tauri::tray::TrayIconBuilder;
                use tauri::Manager;

                let show_item = MenuItem::with_id(app, "show", "Show Muster", true, None::<&str>)
                    .expect("tray show item");
                let quit_item = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)
                    .expect("tray quit item");
                let menu = Menu::with_items(app, &[&show_item, &quit_item]).expect("tray menu");

                // macOS menu bar items use a dedicated monochrome template image so
                // AppKit can tint it correctly for light, dark, and highlighted states.
                // Other platforms keep the full-colour application icon.
                #[cfg(target_os = "macos")]
                let tray_icon = tauri::include_image!("icons/tray-macos-template.png");
                #[cfg(not(target_os = "macos"))]
                let tray_icon = app.default_window_icon().expect("default icon").clone();

                let _tray = TrayIconBuilder::with_id("main-tray")
                    .tooltip("Muster")
                    .icon(tray_icon)
                    .icon_as_template(cfg!(target_os = "macos"))
                    .menu(&menu)
                    .show_menu_on_left_click(false)
                    .on_menu_event(|app, event| match event.id.as_ref() {
                        "show" => {
                            if let Some(w) = app.get_webview_window("main") {
                                let _ = w.show();
                                let _ = w.unminimize();
                                let _ = w.set_focus();
                            }
                        }
                        "quit" => app.exit(0),
                        _ => {}
                    })
                    .on_tray_icon_event(|tray, event| {
                        use tauri::tray::{MouseButton, MouseButtonState, TrayIconEvent};
                        if let TrayIconEvent::Click {
                            button: MouseButton::Left,
                            button_state: MouseButtonState::Up,
                            ..
                        } = event
                        {
                            let app = tray.app_handle();
                            if let Some(w) = app.get_webview_window("main") {
                                let _ = w.show();
                                let _ = w.unminimize();
                                let _ = w.set_focus();
                            }
                        }
                    })
                    .build(app)
                    .expect("tray icon build");
            }

            boot_log("rust", "setup() start");
            boot_log("rust", "setup() start");
            // P0-3: backend window-show fallback --
            // the frontend emits("app-ready") and calls show() itself after the first frame; if it
            // never signals (JS error, network stall, bundle parse failure, etc.), we wait at most
            // 1500ms and then force the window visible so the user never sees a permanent black
            // screen. The fallback is cancelled as soon as app-ready arrives.
            if let Some(window) = app.get_webview_window("main") {
                // Ensure high-resolution icon on Windows taskbar (prevents blurriness on High-DPI screens)
                let icon = tauri::include_image!("icons/icon.png");
                let _ = window.set_icon(icon);
                // Adaptive window sizing: "windowed" by default (**not** auto-maximized), but
                // shrunk intelligently to the current monitor's work area -- the goal is to open
                // as a normal centered window with margins all around whose bottom edge is not
                // covered by the taskbar; users who want fullscreen can click maximize themselves.
                //
                // Pitfall hit before: using the 1360x840 from tauri.conf.json directly, the work
                // area on 13-14" high-DPI screens at 125% scaling is under 840 tall and the bottom
                // gets clipped by the taskbar. Here we subtract a 60px safety margin (covering the
                // title bar + taskbar padding + common DPI rounding error).
                if let Ok(Some(monitor)) = window.current_monitor() {
                    let scale = monitor.scale_factor();
                    let work = monitor.work_area();
                    let work_w = work.size.width as f64 / scale;
                    let work_h = work.size.height as f64 / scale;
                    let work_x = work.position.x as f64 / scale;
                    let work_y = work.position.y as f64 / scale;

                    const MARGIN: f64 = 60.0;
                    let win_w = 1360.0_f64.min(work_w - MARGIN).max(960.0);
                    let win_h = 840.0_f64.min(work_h - MARGIN).max(540.0);
                    let x = work_x + ((work_w - win_w) / 2.0).max(0.0);
                    let y = work_y + ((work_h - win_h) / 2.0).max(0.0);

                    let _ = window.set_size(tauri::Size::Logical(tauri::LogicalSize::new(win_w, win_h)));
                    let _ = window.set_position(tauri::Position::Logical(tauri::LogicalPosition::new(x, y)));
                    boot_log("rust", &format!("main window resized to {:.0}x{:.0} @ ({:.0},{:.0}), scale={:.2}", win_w, win_h, x, y, scale));
                } else {
                    boot_log("rust", "current_monitor() returned None — using tauri.conf default size");
                }

                let win_for_timer = window.clone();
                let cancel_flag = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
                let cancel_for_listener = cancel_flag.clone();

                // Listen for the frontend's first-frame-ready signal
                window.listen("app-ready", move |_| {
                    boot_log("rust", "received app-ready event from frontend");
                    cancel_for_listener.store(true, std::sync::atomic::Ordering::SeqCst);
                });

                // Fallback: force show if the frontend has not reported ready after 1500ms
                tauri::async_runtime::spawn(async move {
                    tokio::time::sleep(std::time::Duration::from_millis(1500)).await;
                    if !cancel_flag.load(std::sync::atomic::Ordering::SeqCst) {
                        boot_log("rust", "app-ready timeout (1500ms) — forcing window.show() fallback");
                        let _ = win_for_timer.show();
                        let _ = win_for_timer.set_focus();
                    } else {
                        boot_log("rust", "fallback timer skipped (app-ready arrived first)");
                    }
                });
            } else {
                boot_log("rust", "get_webview_window(\"main\") returned None in setup()");
            }
            boot_log("rust", "setup() done");
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            login,
            login_with_cookies,
            load_saved_session,
            logout,
            is_logged_in,
            fetch_courses,
            fetch_course_resources,
            fetch_assignments,
            fetch_announcements,
            fetch_course_contacts,
            fetch_course_assessments,
            fetch_course_unit_info,
            fetch_course_schedule,
            fetch_assignment_submission,
            fetch_course_recordings,
            fetch_calendar_events,
            fetch_course_quizzes,
            fetch_course_gradebook,
            fetch_course_unit_dashboard,
            fetch_grade_overview,
            fetch_exams,
            read_portal_diagnostics,
            set_close_to_tray,
            get_target_arch,
            get_system_info,
            sync_all,
            cancel_sync,
            get_sync_status,
            download_file,
            clear_downloads,
            save_ai_config,
            generate_summary,
            generate_summary_stream,
            register_summary_stream,
            cancel_summary_stream,
            test_ai_connection,
            start_sso_login,
            start_sso_login_webview,
            open_in_app_webview,
            dev_log,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::detect_os_version;

    #[tokio::test]
    async fn summary_stream_cancellation_before_start_never_polls_generation() {
        let registry = super::SummaryStreamRegistry::default();
        registry.reserve("early").unwrap();
        registry.cancel("early");
        let mut polled = false;
        let result = registry.run("early", async { polled = true; Ok(()) }).await;
        assert!(result.unwrap_err().contains("cancelled"));
        assert!(!polled);
        // Cancellation of an absent/finished ID never creates a future job.
        registry.cancel("unknown");
        assert!(registry.run("unknown", async { Ok(()) }).await.is_err());
    }

    #[tokio::test]
    async fn summary_stream_cancellation_drops_running_future_and_spares_other_job() {
        use std::sync::{Arc, atomic::{AtomicBool, Ordering}};
        struct OnDrop(Arc<AtomicBool>);
        impl Drop for OnDrop { fn drop(&mut self) { self.0.store(true, Ordering::SeqCst); } }
        let registry = Arc::new(super::SummaryStreamRegistry::default());
        registry.reserve("first").unwrap(); registry.reserve("other").unwrap();
        let dropped = Arc::new(AtomicBool::new(false));
        let (started, ready) = tokio::sync::oneshot::channel();
        let (finish_other, other_finished) = tokio::sync::oneshot::channel();
        let first = {
            let registry = registry.clone(); let dropped = dropped.clone();
            tokio::spawn(async move { registry.run("first", async {
                let _guard = OnDrop(dropped); let _ = started.send(());
                std::future::pending::<Result<(), String>>().await
            }).await })
        };
        let other = {
            let registry = registry.clone();
            tokio::spawn(async move { registry.run("other", async { other_finished.await.unwrap(); Ok(()) }).await })
        };
        ready.await.unwrap(); registry.cancel("first");
        let result = tokio::time::timeout(std::time::Duration::from_secs(1), first).await.expect("cancel did not stop future").unwrap();
        assert!(result.unwrap_err().contains("cancelled"));
        assert!(dropped.load(Ordering::SeqCst)); assert!(!other.is_finished());
        finish_other.send(()).unwrap(); assert!(other.await.unwrap().is_ok());
        assert!(registry.run("other", async { Ok(()) }).await.is_err(), "completed jobs must be removed");
    }

    #[tokio::test]
    async fn summary_stream_cancellation_works_while_waiting_for_scraper_lock() {
        use std::sync::{Arc, atomic::{AtomicBool, Ordering}};
        let registry = Arc::new(super::SummaryStreamRegistry::default());
        registry.reserve("waiting").unwrap();
        let scraper_lock = Arc::new(tokio::sync::Mutex::new(()));
        let held = scraper_lock.lock().await;
        let entered = Arc::new(AtomicBool::new(false));
        let (started, ready) = tokio::sync::oneshot::channel();
        let job = {
            let registry = registry.clone(); let scraper_lock = scraper_lock.clone(); let entered = entered.clone();
            tokio::spawn(async move { registry.run("waiting", async {
                let _ = started.send(());
                let _guard = scraper_lock.lock().await;
                entered.store(true, Ordering::SeqCst); Ok(())
            }).await })
        };
        ready.await.unwrap(); registry.cancel("waiting");
        let result = tokio::time::timeout(std::time::Duration::from_secs(1), job).await.expect("cancel blocked on scraper lock").unwrap();
        assert!(result.is_err()); drop(held); assert!(!entered.load(Ordering::SeqCst));
    }

    #[tokio::test]
    async fn summary_stream_cancellation_registry_cleans_success_and_error() {
        let registry = super::SummaryStreamRegistry::default();
        for result in [Ok(()), Err("provider failed".to_string())] {
            registry.reserve("job").unwrap();
            assert!(registry.reserve("job").is_err(), "duplicate IDs must not replace a live job");
            assert_eq!(registry.run("job", async { result.clone() }).await, result);
            assert!(registry.run("job", async { Ok(()) }).await.is_err());
        }
    }

    #[tokio::test]
    async fn summary_stream_cancellation_closes_http_response_body() {
        use std::sync::Arc;
        use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt};
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = format!("http://{}/chat/completions", listener.local_addr().unwrap());
        let (sent, receiving) = tokio::sync::oneshot::channel();
        let server = tokio::spawn(async move {
            let (socket, _) = listener.accept().await.unwrap();
            let mut socket = tokio::io::BufReader::new(socket);
            let mut length = 0;
            loop {
                let mut line = String::new();
                assert!(socket.read_line(&mut line).await.unwrap() > 0);
                if line == "\r\n" { break; }
                if let Some((key, value)) = line.split_once(':') {
                    if key.eq_ignore_ascii_case("content-length") { length = value.trim().parse::<usize>().unwrap(); }
                }
            }
            socket.read_exact(&mut vec![0; length]).await.unwrap();
            // Leave a real SSE response open. Cancelling must drop reqwest's
            // response body and close the socket, rather than merely stop UI events.
            socket.get_mut().write_all(b"HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nContent-Length: 100000\r\n\r\ndata: {\"choices\":[{\"delta\":{\"content\":\"Partial\"}}]}\n\n").await.unwrap();
            sent.send(()).unwrap();
            let mut byte = [0];
            socket.read(&mut byte).await.unwrap()
        });
        let registry = Arc::new(super::SummaryStreamRegistry::default());
        registry.reserve("http").unwrap();
        let job = {
            let registry = registry.clone();
            tokio::spawn(async move {
                let scraper = super::MoodleScraper::new(Arc::new(super::MoodleAuth::new()));
                registry.run("http", scraper.generate_summary_stream("fictional fixture", "fake-key", &url, "fixture-model", "guide", None, "http")).await
            })
        };
        tokio::time::timeout(std::time::Duration::from_secs(2), receiving).await.unwrap().unwrap();
        registry.cancel("http");
        assert!(tokio::time::timeout(std::time::Duration::from_secs(2), job).await.unwrap().unwrap().unwrap_err().contains("cancelled"));
        assert_eq!(tokio::time::timeout(std::time::Duration::from_secs(2), server).await.expect("HTTP transport stayed open after cancellation").unwrap(), 0);
    }

    #[test]
    fn os_version_is_never_empty() {
        // On Windows this resolves via RtlGetVersion (kernel version), on macOS via
        // sw_vers; it must never panic and should return a non-empty string.
        let v = detect_os_version();
        println!("detect_os_version() = {v:?} | os = {} | arch = {}", std::env::consts::OS, std::env::consts::ARCH);
        assert!(!v.is_empty(), "detect_os_version returned empty");
        // Windows: "10.0.26200"; macOS: "15.5" — contains at least one digit.
        assert!(v.chars().any(|c| c.is_ascii_digit()), "no version digits in {v:?}");
    }

    #[test]
    fn os_and_arch_constants_are_populated() {
        assert_eq!(std::env::consts::OS.len() > 0, true);
        assert_eq!(std::env::consts::ARCH.len() > 0, true);
    }
}
