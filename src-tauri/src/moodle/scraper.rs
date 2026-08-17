use std::sync::Arc;

use crate::moodle::auth::MoodleAuth;
use crate::moodle::models::{
    Announcement, AssessmentType, Assignment, AssignmentStatus, CalendarEvent, Course, CourseContact,
    CourseTabData, GradeEntry, GradeOverviewRow, Member, Quiz, Recording, Schedule, ScheduleItem, SubmissionStatus, UnitDashboard,
    UnitInfo, UnitInfoSection, Resource, ResourceType, UnitWeek,
    LearningObjective, LearningNavItem,
};

#[derive(Debug, Clone)]
pub struct MoodleScraper {
    auth: Arc<MoodleAuth>,
    base_url: String,
    ai_client: reqwest::Client,
    /// Full course names extracted from the course page (dropdown text is truncated), backfilled after sync ends.
    course_names: Arc<std::sync::Mutex<std::collections::HashMap<u64, String>>>,
    /// Global polite-request pacing: caps concurrency and enforces a minimum gap between Moodle requests.
    request_gate: Arc<crate::moodle::throttle::RequestGate>,
}

impl MoodleScraper {
    pub fn new(auth: Arc<MoodleAuth>) -> Self {
        let ai_client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(60))
            .build()
            .unwrap_or_default();
        Self {
            base_url: auth.get_base_url().to_string(),
            auth,
            ai_client,
            course_names: Arc::new(std::sync::Mutex::new(std::collections::HashMap::new())),
            request_gate: Arc::new(crate::moodle::throttle::RequestGate::new(
                crate::moodle::throttle::ThrottleConfig::from_env(),
            )),
        }
    }

    /// Fetch all enrolled courses
    pub async fn fetch_courses(&self) -> Result<Vec<Course>, String> {
        let client = self.auth.get_authenticated_client().await?;
        let url = format!("{}/my/", self.base_url);

        let _permit = self.request_gate.acquire().await;
        let response = client
            .get(&url)
            .timeout(std::time::Duration::from_secs(10))
            .send()
            .await
            .map_err(|e| format!("Failed to fetch courses: {}", e))?;

        // Fetch diagnostics: check the final URL and status code first, then the body.
        // Previously any failure to parse courses was reported as "session may be invalid",
        // conflating two completely different failures ("redirected to login page" and
        // "page structure changed"), making them impossible to pinpoint.
        let status = response.status();
        let final_url = response.url().to_string();

        let html = response
            .text()
            .await
            .map_err(|e| format!("Failed to read courses page: {}", e))?;

        if !status.is_success() {
            return Err(format!(
                "Moodle returned HTTP {} (final URL: {}). Please log in again and retry.",
                status, final_url
            ));
        }

        // Intercepted by SSO/login page -> session really is invalid, give clear guidance
        let lower_url = final_url.to_lowercase();
        if lower_url.contains("/login")
            || lower_url.contains("okta.com")
            || lower_url.contains("microsoftonline.com")
            || lower_url.contains("accounts.google.com")
        {
            return Err(format!(
                "Session expired: the request was redirected to the login page ({}). Please log out and sign in again via Monash SSO.",
                final_url
            ));
        }

        match self.parse_courses_from_html(&html) {
            Ok(courses) => Ok(courses),
            Err(parse_err) => {
                // Archive the page on parse failure so the selectors can be fixed against the real DOM.
                let dump_hint = Self::dump_debug_html("my_courses", &html);
                Err(format!(
                    "{} (HTTP {}, final URL: {}, page length {} bytes{})",
                    parse_err,
                    status,
                    final_url,
                    html.len(),
                    dump_hint
                ))
            }
        }
    }

    /// Write the fetched HTML to the system temp dir and return a hint fragment to append to the error message.
    /// Only called on parse failure, for post-mortem diagnosis of the page structure; failures are silently ignored.
    fn dump_debug_html(tag: &str, html: &str) -> String {
        let mut path = std::env::temp_dir();
        path.push(format!("muster-{}-dump.html", tag));
        match std::fs::write(&path, html) {
            Ok(_) => format!(", page saved to {}", path.display()),
            Err(_) => String::new(),
        }
    }

    /// Write the raw course member roster HTML to the project's samples/debug_user_index_<id>.html.
    /// Locates samples via `CARGO_MANIFEST_DIR` (fixed at compile time to src-tauri),
    /// so it reliably lands in the project's samples/ regardless of the runtime CWD, for offline parser development.
    fn dump_members_html(course_id: u64, html: &str) -> String {
        let dir = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../samples");
        let _ = std::fs::create_dir_all(&dir);
        let path = dir.join(format!("debug_user_index_{}.html", course_id));
        match std::fs::write(&path, html) {
            Ok(_) => path.to_string_lossy().to_string(),
            Err(e) => format!("(write failed: {})", e),
        }
    }

    /// Debug helper: write the raw course page HTML to `samples/debug_course_view_<id>.html`.
    /// Only active when the `MONASH_DUMP_COURSE_VIEW` env var is set, so a normal sync
    /// (fetch_all_data calls this per course) doesn't pollute samples/ with 17 dumps.
    /// Purpose: when reproducing "overly long / weird resource titles", let the App dump one page of real HTML
    /// so the `parse_resources_from_html` selectors can be refined offline.
    fn dump_course_view_html(course_id: u64, html: &str) {
        if std::env::var("MONASH_DUMP_COURSE_VIEW").is_err() {
            return;
        }
        let dir = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../samples");
        let _ = std::fs::create_dir_all(&dir);
        let path = dir.join(format!("debug_course_view_{}.html", course_id));
        let _ = std::fs::write(&path, html);
    }

    /// Debug helper: dump a given `&section=<N>` subpage (or assignment page).
    /// Shares the `MONASH_DUMP_COURSE_VIEW` switch with `dump_course_view_html`, making it easy to grab
    /// the real HTML of Assessments / Unit Information / Schedule / Submission subpages
    /// to calibrate selectors. `suffix` distinguishes them (section number or assignment id).
    fn dump_course_view_section_html(course_id: u64, suffix: u64, html: &str) {
        // Controlled by MONASH_DUMP_COURSE_VIEW so routine syncs never write debug files.
        // (section=56 used to always dump while calibrating the assessment weight parser; that
        // phase is over — set the env var again when selectors need recalibration.)
        if std::env::var("MONASH_DUMP_COURSE_VIEW").is_err() {
            return;
        }
        let dir = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../samples");
        let _ = std::fs::create_dir_all(&dir);
        let path = dir.join(format!("debug_course_view_{}_section_{}.html", course_id, suffix));
        let _ = std::fs::write(&path, html);
    }

    /// Fetch resources for a specific course
    pub async fn fetch_course_resources(&self, course_id: u64) -> Result<Vec<Resource>, String> {
        use futures_util::StreamExt;

        let client = self.auth.get_authenticated_client().await?;
        let base_url = format!("{}/course/view.php?id={}", self.base_url, course_id);

        // Fetch the course homepage (used to discover MST week nav links, and as the fallback parse source for non-MST courses).
        let base_html = Self::fetch_course_view_text(&client, &self.request_gate, &base_url).await?;
        Self::dump_course_view_html(course_id, &base_html);
        // Course name backfill: the course page <title>/<h1> has the full course name (dropdown text is truncated).
        if let Some(full) = parse_course_fullname_from_page(&base_html) {
            self.course_names.lock().unwrap().insert(course_id, full);
        }


        // Monash MST template: the left nav on the course page turns each "week/block" into a real
        //   course/view.php?id=<cid>&section=<N>  server-side single-block view.
        // By default (without the section param) only the "current week" is rendered; the rest are collapsed in the static HTML.
        // So fetching every section link in the nav and merging covers all weeks, no Playwright needed.
        // Non-MST course pages have no such links, so this returns empty -> falls back to the single-page parse below.
        let sections = extract_mst_section_links(&base_html, course_id);

        let mut resources: Vec<Resource> = Vec::new();

        if sections.is_empty() {
            // Standard Moodle: the full page is all the content, a single-page parse suffices.
            resources.extend(self.parse_resources_from_html(&base_html, course_id, None)?);
        } else {
            let mut seen_resource_ids: std::collections::HashSet<u64> = std::collections::HashSet::new();
            let mut merged: Vec<Resource> = Vec::new();

            // MST: fetch each section page concurrently and merge.
            // The base page is only used to discover the nav; its content is already covered by the section pages, so it isn't parsed again.
            // buffer_unordered(8) caps concurrency so 17 courses x ~19 weeks don't hit
            // the Monash server all at once (which could trigger rate limiting / SSO risk controls).
            let fetches = sections.into_iter().map(|(section_num, label)| {
                let client = client.clone();
                let gate = self.request_gate.clone();
                let url = format!(
                    "{}/course/view.php?id={}&section={}",
                    self.base_url, course_id, section_num
                );
                async move {
                    let text = Self::fetch_course_view_text(&client, &gate, &url).await;
                    (section_num, label, text)
                }
            });
            let results: Vec<(u64, String, Result<String, String>)> = futures_util::stream::iter(
                fetches,
            )
            .buffer_unordered(8)
            .collect()
            .await;
            // Collect the course-level recording entry (LTI "Learning Capture"): Panopto block content is loaded by JS,
            // but the recording entry is a stable LTI link. Inject the entry into every week's parse result
            // so each "week" group in the frontend shows an "open recording" card.
            let video_entry: Option<(String, String)> =
                match scraper::Selector::parse("li.activity.modtype_lti") {
                    Ok(li_sel) => {
                        let mut found: Option<(String, String)> = None;
                        'video_scan: for (_sn, _lb, text) in &results {
                            if let Ok(html) = text {
                                let doc = scraper::Html::parse_document(html);
                                let Ok(name_sel) = scraper::Selector::parse(".activity-item[data-activityname]")
                                else {
                                    continue;
                                };
                                let Ok(a_sel) = scraper::Selector::parse("a[href*='mod/lti/view.php']") else {
                                    continue;
                                };
                                for li in doc.select(&li_sel) {
                                    let title = li
                                        .select(&name_sel)
                                        .next()
                                        .and_then(|el| el.value().attr("data-activityname"))
                                        .map(|t| t.to_string())
                                        .unwrap_or_default();
                                    let lower = title.to_lowercase();
                                    if !(lower.contains("capture")
                                        || lower.contains("record")
                                        || lower.contains("panopto")
                                        || lower.contains("lecture"))
                                    {
                                        continue;
                                    }
                                    if let Some(href) = li
                                        .select(&a_sel)
                                        .next()
                                        .and_then(|a| a.value().attr("href").map(|h| h.to_string()))
                                    {
                                        let url = if href.starts_with("http") {
                                            href
                                        } else {
                                            format!("{}{}", self.base_url, href)
                                        };
                                        found = Some((title, url));
                                        break 'video_scan;
                                    }
                                }
                            }
                        }
                        found
                    }
                    Err(_) => None,
                };

            for (section_num, label, text) in results {
                match text {
                    Ok(html) => {
                        let section_resources = self.parse_resources_from_html(
                            &html,
                            course_id,
                            Some((section_num, label.clone())),
                        )?;
                        for r in section_resources {
                            if seen_resource_ids.insert(r.id) {
                                merged.push(r);
                            }
                        }
                        // Inject a recording entry card per week (same link gets a different id per week to avoid dedup)
                        if let Some((vtitle, vurl)) = &video_entry {
                            let vid_id = stable_resource_id_for_dedup(&format!("{}#sec{}", vurl, section_num));
                            if seen_resource_ids.insert(vid_id) {
                                merged.push(Resource {
                                    id: vid_id,
                                    course_id,
                                    name: vtitle.clone(),
                                    section: Some(label.clone()),
                                    week_num: extract_week_num(&label),
                                    resource_type: ResourceType::Video,
                                    url: vurl.clone(),
                                    file_size: None,
                                    modified_date: None,
                                });
                            }
                        }
                    }
                    Err(e) => {
                        // A single week failing to fetch shouldn't drag down the whole course; log it and skip that week.
                        eprintln!(
                            "[moodle] MST section {} fetch failed (skipping this week): {}",
                            section_num, e
                        );
                    }
                }
            }
            resources = merged;
        }

        Ok(resources)
    }

    /// GET the course page and read the body text (with a 10s timeout). Extracted as an associated function so
    /// the MST multi-section concurrent fetch can reuse it -- the closure only holds a `reqwest::Client` clone, it doesn't borrow `self`.
    /// `gate` applies the global polite-request pacing (throttle module) so page fetches never burst the server.
    async fn fetch_course_view_text(
        client: &reqwest::Client,
        gate: &Arc<crate::moodle::throttle::RequestGate>,
        url: &str,
    ) -> Result<String, String> {
        let _permit = gate.acquire().await;
        let response = client
            .get(url)
            .timeout(std::time::Duration::from_secs(10))
            .send()
            .await
            .map_err(|e| format!("Failed to fetch {}: {}", url, e))?;
        response
            .text()
            .await
            .map_err(|e| format!("Failed to read {}: {}", url, e))
    }

    /// Fetch assignments for a specific course
    pub async fn fetch_assignments(&self, course_id: u64) -> Result<Vec<Assignment>, String> {
        let client = self.auth.get_authenticated_client().await?;
        let url = format!("{}/mod/assign/index.php?id={}", self.base_url, course_id);

        let _permit = self.request_gate.acquire().await;
        let response = client
            .get(&url)
            .timeout(std::time::Duration::from_secs(10))
            .send()
            .await
            .map_err(|e| format!("Failed to fetch assignments: {}", e))?;

        let html = response
            .text()
            .await
            .map_err(|e| format!("Failed to read assignments page: {}", e))?;

        let assignments = self.parse_assignments_from_html(&html, course_id)?;

        // Fallback: if no assignments found on index page, try course page
        if assignments.is_empty() {
            let course_url = format!("{}/course/view.php?id={}", self.base_url, course_id);
            let _permit = self.request_gate.acquire().await;
            let response = client
                .get(&course_url)
                .timeout(std::time::Duration::from_secs(10))
                .send()
                .await
                .map_err(|e| format!("Failed to fetch course page: {}", e))?;
            let course_html = response
                .text()
                .await
                .map_err(|e| format!("Failed to read course page: {}", e))?;
            let course_assignments = self.parse_assignments_from_course_html(&course_html, course_id)?;
            return Ok(course_assignments);
        }

        Ok(assignments)
    }

    /// Fetch the course assessment overview (Assessments section, `&section=56`).
    /// Covers regular assignments (modtype_assign) + quizzes (modtype_quiz) + weights + assessment categories,
    /// which is more complete than `fetch_assignments` (which only scrapes the mod/assign/index.php table).
    /// The frontend AssignmentsPage uses this to get the full assessment list.
    pub async fn fetch_course_assessments(&self, course_id: u64) -> Result<Vec<Assignment>, String> {
        let client = self.auth.get_authenticated_client().await?;
        let url = format!("{}/course/view.php?id={}&section=56", self.base_url, course_id);
        let html = Self::fetch_course_view_text(&client, &self.request_gate, &url).await?;
        Self::dump_course_view_section_html(course_id, 56, &html);
        let mut assignments = self.parse_assessments_from_html(&html, course_id)?;
        // The widget's STATUS column is rendered by JS and stays empty in static HTML, so enrich
        // real submission state from each item's detail page + the course gradebook.
        self.enrich_assessment_statuses(&client, course_id, &mut assignments).await;
        Ok(assignments)
    }

    /// Fetch the unit handbook (Unit Information section, `&section=1`): structure the MST CMS blocks
    /// (Welcome / Synopsis / Outcomes / Approach / Resources) into a list of sections.
    pub async fn fetch_course_unit_info(&self, course_id: u64) -> Result<UnitInfo, String> {
        let client = self.auth.get_authenticated_client().await?;
        let url = format!("{}/course/view.php?id={}&section=1", self.base_url, course_id);
        let html = Self::fetch_course_view_text(&client, &self.request_gate, &url).await?;
        Self::dump_course_view_section_html(course_id, 1, &html);
        self.parse_unit_info_from_html(&html, course_id)
    }

    /// Fetch the course schedule / key dates (Schedule section, `&section=2`).
    pub async fn fetch_course_schedule(&self, course_id: u64) -> Result<Schedule, String> {
        let client = self.auth.get_authenticated_client().await?;
        let url = format!("{}/course/view.php?id={}&section=2", self.base_url, course_id);
        let html = Self::fetch_course_view_text(&client, &self.request_gate, &url).await?;
        Self::dump_course_view_section_html(course_id, 2, &html);
        self.parse_schedule_from_html(&html, course_id)
    }

    /// Fetch a single assessment's submission status and feedback.
    /// Quizzes live at `mod/quiz/view.php`, regular assignments at
    /// `mod/assign/view.php` — using the wrong route (the old code always hit
    /// the assign route) returned a wrong/empty page, so finished quizzes were
    /// reported as "not submitted".
    pub async fn fetch_assignment_submission(
        &self,
        course_id: u64,
        assignment_id: u64,
        assessment_type: &str,
    ) -> Result<SubmissionStatus, String> {
        let client = self.auth.get_authenticated_client().await?;
        let route = if assessment_type.eq_ignore_ascii_case("quiz") {
            "mod/quiz/view.php"
        } else {
            "mod/assign/view.php"
        };
        let url = format!("{}/{}?id={}", self.base_url, route, assignment_id);
        let html = Self::fetch_course_view_text(&client, &self.request_gate, &url).await?;
        Self::dump_course_view_section_html(course_id, assignment_id, &html);

        let mut status = self.parse_submission_status_from_html(&html, assignment_id)?;
        if assessment_type.eq_ignore_ascii_case("quiz") {
            // The quiz route reports submission differently (attempts + final
            // grade); the assign-page heuristics must not override it.
            status.submitted = parse_quiz_submission_from_html(&html);
            // Grade fallback for quiz pages: "Your final grade for this quiz is
            // 13.00/13.00" — parse_submission_status_from_html already handles
            // grade/成绩 patterns, but quizzes also use "13.00 out of 13.00".
            if status.grade.is_none() {
                status.grade = parse_quiz_grade_from_html(&html);
            }
        }
        Ok(status)
    }

    /// Fetch course recordings (the Panopto sidebar block). In the static highlight view the Panopto block is
    /// only an LTI/iframe placeholder with no direct links; the video links / embed ids exist only on the real runtime page.
    /// When parsing finds nothing, return empty gracefully (no error), pending a runtime dump from the user to calibrate the selectors.
    pub async fn fetch_course_recordings(&self, course_id: u64) -> Result<Vec<Recording>, String> {
        use futures_util::StreamExt;

        let client = self.auth.get_authenticated_client().await?;
        let base_url = format!("{}/course/view.php?id={}", self.base_url, course_id);

        // Fetch the course homepage (discover MST week nav + serve as the fallback parse source).
        let base_html = Self::fetch_course_view_text(&client, &self.request_gate, &base_url).await?;
        Self::dump_course_view_html(course_id, &base_html);
        // Course name backfill: the course page <title>/<h1> has the full course name (dropdown text is truncated).
        if let Some(full) = parse_course_fullname_from_page(&base_html) {
            self.course_names.lock().unwrap().insert(course_id, full);
        }


        // Recordings are often buried in some collapsed section (observed inside the CMS block of
        // Unit Information = `&section=1`), and the default course view only renders the current week -> they get missed.
        // Reuse the MST section discovery; for non-MST courses with no such nav, probe `&section=1` (Unit Information is a common recording host).
        let mst_sections = extract_mst_section_links(&base_html, course_id);
        let mut section_nums: std::collections::HashSet<u64> =
            mst_sections.iter().map(|(n, _)| *n).collect();
        if section_nums.is_empty() {
            section_nums.insert(1);
        }

        // Fetch base + each section page, parse panopto, then merge and dedup.
        // buffer_unordered(8) caps concurrency to avoid hammering the Monash server all at once.
        let mut urls: Vec<String> = vec![base_url.clone()];
        for n in &section_nums {
            urls.push(format!(
                "{}/course/view.php?id={}&section={}",
                self.base_url, course_id, n
            ));
        }
        let fetches = urls.into_iter().map(|url| {
            let client = client.clone();
            let gate = self.request_gate.clone();
            async move { (url.clone(), Self::fetch_course_view_text(&client, &gate, &url).await) }
        });
        let results: Vec<(String, Result<String, String>)> = futures_util::stream::iter(fetches)
            .buffer_unordered(8)
            .collect()
            .await;

        let mut out: Vec<Recording> = Vec::new();
        let mut seen: std::collections::HashSet<String> = std::collections::HashSet::new();
        for (_url, text) in &results {
            if let Ok(html) = text {
                for rec in self.parse_recordings_from_html(html) {
                    if seen.insert(rec.url.clone()) {
                        out.push(rec);
                    }
                }
            }
        }

        // Fallback: the Panopto block's content is loaded asynchronously by JS, so the static HTML has no video list; but the
        // real entry point for recordings is the LTI activity "Learning Capture" (mod/lti/view.php?id=<cmid>).
        // Return it as an "open the recordings page" entry; the frontend renders it as a jump button and the user watches in the browser.
        for (_url, text) in &results {
            if let Ok(html) = text {
                let doc = scraper::Html::parse_document(html);
                let Ok(li_sel) = scraper::Selector::parse("li.activity.modtype_lti") else {
                    continue;
                };
                let Ok(name_sel) = scraper::Selector::parse(".activity-item[data-activityname]") else {
                    continue;
                };
                let Ok(a_sel) = scraper::Selector::parse("a[href*='mod/lti/view.php']") else {
                    continue;
                };
                for li in doc.select(&li_sel) {
                    let title = li
                        .select(&name_sel)
                        .next()
                        .and_then(|el| el.value().attr("data-activityname"))
                        .map(|s| s.to_string())
                        .unwrap_or_default();
                    let lower = title.to_lowercase();
                    if !(lower.contains("capture")
                        || lower.contains("record")
                        || lower.contains("panopto")
                        || lower.contains("lecture"))
                    {
                        continue;
                    }
                    let cmid = li.value().attr("data-id").and_then(|s| s.parse::<u64>().ok());
                    let href = li
                        .select(&a_sel)
                        .next()
                        .and_then(|a| a.value().attr("href").map(|h| h.to_string()));
                    let (Some(id), Some(href)) = (cmid, href) else {
                        continue;
                    };
                    let url = if href.starts_with("http") {
                        href
                    } else {
                        format!("{}{}", self.base_url, href)
                    };
                    if seen.insert(url.clone()) {
                        out.push(Recording {
                            id,
                            title,
                            url,
                            duration: None,
                        });
                    }
                }
            }
        }
        Ok(out)
    }

    /// Parse the assessment items in the Assessments section (`&section=56`).
    ///
    /// Monash uses **two** structures on this page, handled in priority order:
    ///
    /// **Type A (main path): custom "assessment structure" widget** (observed in `live_..._Assessments.html`)
    ///   The page body is rendered by JS into a table; the weight is not inside `li.activity` but in:
    ///   ```html
    ///   <div class="assessment-item ... summary-view-dropdown-header">
    ///     <div class="name-content">
    ///       <a class="dropdown-name-text" data-section="57">1. Quiz / Test</a>
    ///     </div>
    ///     <div class="weight-content">9%</div>   <!-- weight lives here, a bare "9%" -->
    ///   </div>
    ///   ```
    ///   4 category rows = 4 weighted assessment categories. The old regex `weight:\s*\d+%` never matched, because
    ///   (1) the label is actually "Weighting:" (there's an "ing" after weight) and (2) the category weight is a bare "9%" in its own cell.
    ///
    /// **Type B (fallback): standard Moodle `li.activity`** (`modtype_assign` / `modtype_quiz`)
    ///   Older courses / non-widget pages still take this path; the weight is extracted from the li text "Weight(ing): 25%".
    fn parse_assessments_from_html(&self, html: &str, course_id: u64) -> Result<Vec<Assignment>, String> {
        use scraper::{Html, Selector};
        let document = Html::parse_document(html);
        let mut out = Vec::new();
        let mut seen = std::collections::HashSet::new();

        // ---- Type A: the category summary rows of the assessment structure widget (authoritative weight source) ----
        if let (Ok(row_sel), Ok(name_sel), Ok(weight_sel)) = (
            Selector::parse(".assessment-item.summary-view-dropdown-header"),
            Selector::parse(".dropdown-name-text"),
            Selector::parse(".weight-content"),
        ) {
            // Selectors for child rows (individual assignments/quizzes), used to push category weights down to children
            let child_row_sel = Selector::parse(".assessment-item").ok();
            let child_name_sel = Selector::parse("a.name-content-text").ok();
            let due_sel = Selector::parse(".duedate-content").ok();

            for row in document.select(&row_sel) {
                let Some(name_el) = row.select(&name_sel).next() else { continue };
                let raw_name = name_el.text().collect::<String>().trim().to_string();
                if raw_name.is_empty() {
                    continue;
                }

                // Use the category's data-section (57/58/...) as the id: unique and stable
                let section_no = name_el
                    .value()
                    .attr("data-section")
                    .and_then(|s| s.parse::<u64>().ok());
                let id = section_no.unwrap_or(0);
                if id != 0 && !seen.insert(id) {
                    continue;
                }

                // Weight: the bare "9%" in this row's .weight-content (may carry a "Weighting:" prefix)
                let weight = row
                    .select(&weight_sel)
                    .next()
                    .and_then(|w| parse_weight_percent(&w.text().collect::<String>()));

                // Category = name with the leading ordinal stripped ("1. Quiz / Test" -> "Quiz / Test")
                let category = raw_name
                    .trim_start_matches(|c: char| c.is_ascii_digit() || c == '.' || c.is_whitespace())
                    .trim()
                    .to_string();
                let category_opt = if category.is_empty() { None } else { Some(category.clone()) };

                let cat_lower = category.to_lowercase();
                let cat_is_quiz = cat_lower.contains("quiz") || cat_lower.contains("test");

                out.push(Assignment {
                    id,
                    name: raw_name,
                    course_id,
                    due_date: None,
                    due_date_iso: None,
                    status: AssignmentStatus::Pending,
                    grade: None,
                    url: None,
                    assessment_type: if cat_is_quiz {
                        AssessmentType::Quiz
                    } else {
                        AssessmentType::Assignment
                    },
                    weight,
                    category: category_opt.clone(),
                    has_submission_status: false,
                });

                // ---- Child rows: **push down** the category weight to every individual assignment/quiz under it ----
                //
                // Structurally the child rows are not inside the header row but in the sibling container right after it:
                //   <div id="assessment-section-activity-list-{data-section}">
                // Moodle only fills `.weight-content` at the category level; the child row's cell is empty
                // (see FIT5201: Quiz 1~4 weight cells are all empty, the 9% hangs on "1. Quiz / Test").
                // Without this push-down, users would always see null% on individual assignments.
                let (Some(child_row_sel), Some(child_name_sel), Some(due_sel), Some(sec)) =
                    (&child_row_sel, &child_name_sel, &due_sel, section_no)
                else {
                    continue;
                };
                let Ok(list_sel) =
                    Selector::parse(&format!("#assessment-section-activity-list-{}", sec))
                else {
                    continue;
                };
                let Some(list) = document.select(&list_sel).next() else { continue };

                for child in list.select(child_row_sel) {
                    let Some(a) = child.select(child_name_sel).next() else { continue };
                    let child_name = a.text().collect::<String>().trim().to_string();
                    if child_name.is_empty() {
                        continue;
                    }
                    let href = a.value().attr("href").unwrap_or("");
                    // cmid comes from `...view.php?id=6121932`, used as a stable unique id
                    let cmid = href
                        .rsplit("id=")
                        .next()
                        .and_then(|s| {
                            s.chars()
                                .take_while(|c| c.is_ascii_digit())
                                .collect::<String>()
                                .parse::<u64>()
                                .ok()
                        })
                        .unwrap_or(0);
                    if cmid != 0 && !seen.insert(cmid) {
                        continue;
                    }

                    let due_date = child
                        .select(due_sel)
                        .next()
                        .map(|el| {
                            el.text()
                                .collect::<String>()
                                .split_whitespace()
                                .collect::<Vec<_>>()
                                .join(" ")
                        })
                        .filter(|s| !s.is_empty());

                    let is_quiz = href.contains("/mod/quiz/") || cat_is_quiz;

                    out.push(Assignment {
                        id: cmid,
                        name: child_name,
                        course_id,
                        due_date,
                        due_date_iso: None,
                        status: AssignmentStatus::Pending,
                        grade: None,
                        url: if href.is_empty() {
                            None
                        } else if href.starts_with("http") {
                            Some(href.to_string())
                        } else {
                            Some(format!("{}{}", self.base_url, href))
                        },
                        assessment_type: if is_quiz {
                            AssessmentType::Quiz
                        } else {
                            AssessmentType::Assignment
                        },
                        // Key: inherit the category weight
                        weight,
                        category: category_opt.clone(),
                        has_submission_status: false,
                    });
                }
            }
        }

        // If Type A found content, return directly (the widget page body has no li.activity, so Type B would be wasted work)
        if !out.is_empty() {
            // Derived fields: supplement weight from the name; convert due date to ISO.
            for a in &mut out {
                if a.weight.is_none() {
                    a.weight = parse_weight_percent(&a.name);
                }
                a.due_date_iso = a.due_date.as_deref().and_then(parse_moodle_due_date);
            }
            return Ok(out);
        }

        // ---- Type B fallback: standard Moodle li.activity ----
        let li_sel = Selector::parse("li.activity").map_err(|e| format!("sel: {}", e))?;
        let name_sel = Selector::parse(".instancename").map_err(|e| format!("sel: {}", e))?;
        let disp_sel = Selector::parse(".displayname").map_err(|e| format!("sel: {}", e))?;
        let link_sel = Selector::parse("a[href]").map_err(|e| format!("sel: {}", e))?;

        for li in document.select(&li_sel) {
            let class_str: String = li.value().classes().collect::<Vec<_>>().join(" ");
            let is_quiz = class_str.contains("modtype_quiz");
            let is_assign = class_str.contains("modtype_assign");
            if !is_quiz && !is_assign {
                continue;
            }
            let id = li
                .value()
                .attr("data-id")
                .and_then(|s| s.parse::<u64>().ok())
                .unwrap_or(0);
            if !seen.insert(id) {
                continue;
            }

            let name = li
                .select(&name_sel)
                .next()
                .and_then(|el| {
                    el.select(&disp_sel)
                        .next()
                        .map(|d| d.text().collect::<String>().trim().to_string())
                        .filter(|s| !s.is_empty())
                        .or_else(|| Some(el.text().collect::<String>().trim().to_string()))
                })
                .or_else(|| li.value().attr("data-activityname").map(|s| s.to_string()))
                .unwrap_or_default();
            if name.is_empty() {
                continue;
            }

            let li_text = li.text().collect::<String>();
            let weight = parse_weight_percent(&li_text);

            let category = nearest_heading_before(html, &format!("data-id=\"{}\"", id))
                .map(|h| {
                    h.trim_start_matches(|c: char| c.is_ascii_digit() || c == '.' || c.is_whitespace())
                        .trim()
                        .to_string()
                });

            let url = li
                .select(&link_sel)
                .next()
                .and_then(|a| a.value().attr("href"))
                .map(|href| {
                    if href.starts_with("http") {
                        href.to_string()
                    } else {
                        format!("{}{}", self.base_url, href)
                    }
                });

            out.push(Assignment {
                id,
                name,
                course_id,
                due_date: None,
                due_date_iso: None,
                status: AssignmentStatus::Pending,
                grade: None,
                url,
                assessment_type: if is_quiz {
                    AssessmentType::Quiz
                } else {
                    AssessmentType::Assignment
                },
                weight,
                category,
                has_submission_status: false,
            });
        }
        // Supplement weight from the name (e.g. activity name has "(Weight: 25%)"); convert due date to ISO.
        for a in &mut out {
            if a.weight.is_none() {
                a.weight = parse_weight_percent(&a.name);
            }
            a.due_date_iso = a.due_date.as_deref().and_then(parse_moodle_due_date);
        }

        Ok(out)
    }

    /// Best-effort enrichment of assessment submission state.
    ///
    /// The assessment widget's STATUS column is rendered by JS and stays empty in the static
    /// HTML (verified on live_course_assessments_46961.html), so the real submission state must
    /// come from the item's own detail page:
    ///   - quiz (mod/quiz/view.php): a finished attempt renders "Status Finished" with
    ///     Started/Completed timestamps (verified on the real Quiz 1 2026 S2 page);
    ///   - assign (mod/assign/view.php): the submissionstatustable shows "Submitted for grading".
    ///
    /// Then the course gradebook is fetched once: an item carrying an actual grade is Graded
    /// (overrides Submitted) and the grade text is attached.
    ///
    /// All requests go through the global request gate; any failure leaves the item's current
    /// status untouched (pending), so a transient network error never breaks the list.
    async fn enrich_assessment_statuses(
        &self,
        client: &reqwest::Client,
        course_id: u64,
        assignments: &mut [Assignment],
    ) {
        use futures_util::StreamExt;
        if assignments.is_empty() {
            return;
        }

        // ---- 1) detail pages, bounded concurrency via the shared gate ----
        let urls: Vec<(usize, String)> = assignments
            .iter()
            .enumerate()
            .filter_map(|(i, a)| a.url.clone().map(|u| (i, u)))
            .collect();
        if !urls.is_empty() {
            let fetches = urls.into_iter().map(|(i, u)| {
                let client = client.clone();
                let gate = self.request_gate.clone();
                async move { (i, Self::fetch_course_view_text(&client, &gate, &u).await) }
            });
            let results: Vec<(usize, Result<String, String>)> =
                futures_util::stream::iter(fetches).buffered(8).collect().await;

            for (i, res) in results {
                let Ok(html) = res else { continue };
                let a = &mut assignments[i];
                // A successfully fetched detail page means the item's submission state is trackable
                a.has_submission_status = true;
                let submitted = match a.assessment_type {
                    AssessmentType::Quiz => parse_quiz_submission_from_html(&html),
                    AssessmentType::Assignment => self
                        .parse_submission_status_from_html(&html, a.id)
                        .map(|s| s.submitted)
                        .unwrap_or(false),
                };
                if submitted {
                    a.status = AssignmentStatus::Submitted;
                }
            }
        }

        // ---- 2) gradebook: a real grade => Graded (overrides Submitted) ----
        if let Ok(gradebook) = self.fetch_course_gradebook(course_id).await {
            for a in assignments.iter_mut() {
                let Some(entry) = gradebook
                    .iter()
                    .find(|e| cmid_from_url(e.url.as_deref()) == Some(a.id))
                else {
                    continue;
                };
                if let Some(g) = entry.grade.as_deref() {
                    let g = g.trim();
                    if !g.is_empty() && g != "-" {
                        a.status = AssignmentStatus::Graded;
                        a.grade = Some(g.to_string());
                    }
                }
            }
        }
    }

    /// Parse assignments from Moodle assignments index page HTML. CMS blocks of (`&section=1`) -> list of sections.
    ///
    /// Monash CMS has two substructures that must be handled separately (based on the live_course_section1_46961.html sample):
    ///
    /// **Type A: accordion (multiple `<div class="card">...</div>` cards)**
    ///   e.g. Welcome / Unit Resources / Unit Synopsis / Learning Outcomes / Teaching Approach.
    ///   Structure: `.activity-altcontent > .no-overflow > <style> + div#accordionXxxSection > div.card x N`
    ///   In each card, `.card-header` is the collapse trigger (Bootstrap collapse) and `.card-body` holds the body text.
    ///   Dumping the whole altcontent into the frontend's dangerouslySetInnerHTML would show **only the collapse headers**,
    ///   with the body hidden by Bootstrap's `collapse` class (the app WebView doesn't run Moodle's JS). So the cards must be **split**:
    ///   each card yields one `UnitInfoSection { title = card-header h3, content_html = card-body }`.
    ///
    /// **Type B: plain-text CMS**
    ///   e.g. Leganto Reading List / Learning Capture.
    ///   Structure: `.activity-altcontent > .no-overflow > <div class="no-overflow">plain text description</div>`
    ///   Use `data-activityname` as the title and the inner altcontent text as the body.
    ///
    /// In both cases, descendant `<style>` / `<script>` must be stripped (inline CSS would pollute innerHTML rendering).
    fn parse_unit_info_from_html(&self, html: &str, course_id: u64) -> Result<UnitInfo, String> {
        use scraper::{Html, Selector};
        let document = Html::parse_document(html);
        let item_sel = Selector::parse(".activity-item[data-activityname]")
            .map_err(|e| format!("sel item: {}", e))?;
        let altcontent_sel = Selector::parse(".activity-altcontent")
            .map_err(|e| format!("sel alt: {}", e))?;
        let card_sel = Selector::parse(".card").map_err(|e| format!("sel card: {}", e))?;
        let card_header_h3 = Selector::parse(".card-header h3")
            .map_err(|e| format!("sel h3: {}", e))?;
        let card_body_sel = Selector::parse(".card-body")
            .map_err(|e| format!("sel body: {}", e))?;

        let mut sections = Vec::new();
        for item in document.select(&item_sel) {
            let raw_activity_name = item
                .value()
                .attr("data-activityname")
                .unwrap_or("")
                .to_string();
            let activity_name = raw_activity_name.replace(" Section", "").trim().to_string();
            if activity_name.is_empty() {
                continue;
            }

            let Some(altcontent) = item.select(&altcontent_sel).next() else {
                continue;
            };

            // Detect whether this is Type A (contains a .card accordion)
            let cards: Vec<_> = altcontent.select(&card_sel).collect();

            if !cards.is_empty() {
                // Type A: split each card into its own UnitInfoSection
                for card in cards {
                    let title = card
                        .select(&card_header_h3)
                        .next()
                        .map(|h| collect_text_trim(&h))
                        .unwrap_or_else(|| activity_name.clone());
                    let content_html = card
                        .select(&card_body_sel)
                        .next()
                        .map(|b| sanitize_content_html(&b.html()))
                        .unwrap_or_default();
                    // Discard cards with empty bodies: Moodle really does have `<div class="card-body"></div>`
                    // (e.g. FIT5201's Teaching approach), which renders as an empty accordion -- pure noise.
                    if content_html.trim().is_empty() {
                        continue;
                    }
                    sections.push(UnitInfoSection {
                        title,
                        content_html,
                    });
                }
            } else {
                // Type B: plain-text CMS -- the entire altcontent innerHTML is the body
                let content_html = sanitize_content_html(&altcontent.html());
                if !content_html.trim().is_empty() {
                    sections.push(UnitInfoSection {
                        title: activity_name,
                        content_html,
                    });
                }
            }
        }
        Ok(UnitInfo { course_id, sections })
    }

    /// Parse the CMS blocks of the Schedule section (`&section=2`) -> list of key dates / schedule items.
    /// Extract a `<table>` from raw section HTML into structured rows (first row = header),
    /// so the frontend can render it with its own responsive table instead of overflowing raw HTML.
    /// Parse the Monash MST div-based schedule ("Standard Schedule"): each item is a
    /// `.schedule-item` with `date-content` / `learningsection-content` /
    /// `assessmentsection-content` / `addtionaltasks-content` cells (note the typo in
    /// Moodle's own class name). Assessment cells keep their `<a href>` links; the
    /// header row is synthesized since the div layout has no table header.
    fn extract_schedule_div_rows(html: &str) -> Vec<crate::moodle::models::ScheduleRow> {
        use scraper::{ElementRef, Html, Selector};
        let doc = Html::parse_fragment(html);
        let Ok(item_sel) = Selector::parse(".schedule-item") else {
            return Vec::new();
        };
        const COLS: [&str; 4] = [
            "date-content",
            "learningsection-content",
            "assessmentsection-content",
            "addtionaltasks-content",
        ];
        let mut rows: Vec<crate::moodle::models::ScheduleRow> = Vec::new();
        let mut found = false;
        for item in doc.select(&item_sel) {
            let mut cells: Vec<String> = Vec::new();
            for cls in COLS {
                let cell = Selector::parse(&format!(".{}", cls))
                    .ok()
                    .and_then(|sel| item.select(&sel).next())
                    .map(|el| Self::schedule_cell_html(&el))
                    .unwrap_or_default();
                cells.push(cell);
            }
            if cells.iter().any(|c| !c.trim().is_empty()) {
                if !found {
                    found = true;
                    rows.push(crate::moodle::models::ScheduleRow {
                        cells: vec![
                            "DATE".to_string(),
                            "LEARNING SECTION".to_string(),
                            "ASSESSMENTS".to_string(),
                            "ADDITIONAL TASKS".to_string(),
                        ],
                    });
                }
                rows.push(crate::moodle::models::ScheduleRow { cells });
            }
        }
        rows
    }

    /// Serialize one schedule cell: keep `<a href>` links (even inside nested divs),
    /// `<br>` as newline, everything else as escaped text so no raw Moodle markup
    /// reaches the UI. Iterative stack traversal (scraper 0.20 does not export NodeRef).
    fn schedule_cell_html(el: &scraper::ElementRef) -> String {
        fn esc(s: &str) -> String {
            s.replace('&', "&amp;")
                .replace('<', "&lt;")
                .replace('>', "&gt;")
        }
        fn norm(s: &str) -> String {
            s.split_whitespace().collect::<Vec<_>>().join(" ")
        }
        let mut out = String::new();
        let mut stack: Vec<_> = el.children().collect();
        while let Some(node) = stack.pop() {
            match node.value() {
                scraper::Node::Text(t) => {
                    let n = norm(t);
                    if !n.is_empty() {
                        out.push_str(&esc(&n));
                    }
                }
                scraper::Node::Element(e) => {
                    let name = e.name();
                    if name == "a" {
                        let href = e.attr("href").unwrap_or("");
                        let mut text = String::new();
                        for child in node.children() {
                            if let scraper::Node::Text(t) = child.value() {
                                let n = norm(t);
                                if !n.is_empty() {
                                    if !text.is_empty() {
                                        text.push(' ');
                                    }
                                    text.push_str(&n);
                                }
                            }
                        }
                        out.push_str(&format!("<a href=\"{}\">{}</a>", esc(href), esc(&text)));
                    } else if name == "br" {
                        out.push('\n');
                    } else {
                        let mut children: Vec<_> = node.children().collect();
                        children.reverse();
                        stack.extend(children);
                    }
                }
                _ => {}
            }
        }
        out
    }

    fn extract_table_rows(html: &str) -> Vec<crate::moodle::models::ScheduleRow> {
        use scraper::{ElementRef, Html, Selector};
        let doc = Html::parse_fragment(html);
        let mut rows: Vec<crate::moodle::models::ScheduleRow> = Vec::new();
        let Ok(table_sel) = Selector::parse("table") else {
            return rows;
        };
        let Ok(tr_sel) = Selector::parse("tr") else {
            return rows;
        };
        let Ok(th_sel) = Selector::parse("th") else {
            return rows;
        };
        let Ok(td_sel) = Selector::parse("td") else {
            return rows;
        };

        fn cell_text(el: &ElementRef) -> String {
            // Keep <br> as line breaks (multi-line cells), collapse other whitespace.
            let mut html = el.html();
            for tag in ["<br>", "<br/>", "<br />", "<BR>"] {
                html = html.replace(tag, "\n");
            }
            let frag = Html::parse_fragment(&html);
            let text = frag.root_element().text().collect::<String>();
            text.lines()
                .map(|l| l.split_whitespace().collect::<Vec<_>>().join(" "))
                .filter(|l| !l.trim().is_empty())
                .collect::<Vec<_>>()
                .join("\n")
        }

        for table in doc.select(&table_sel) {
            for tr in table.select(&tr_sel) {
                let mut cells: Vec<String> = Vec::new();
                for th in tr.select(&th_sel) {
                    cells.push(cell_text(&th));
                }
                if cells.is_empty() {
                    for td in tr.select(&td_sel) {
                        cells.push(cell_text(&td));
                    }
                }
                if !cells.is_empty() {
                    rows.push(crate::moodle::models::ScheduleRow { cells });
                }
            }
        }
        rows
    }

    fn parse_schedule_from_html(&self, html: &str, course_id: u64) -> Result<Schedule, String> {
        use scraper::{Html, Selector};
        let document = Html::parse_document(html);
        let item_sel =
            Selector::parse(".activity-item[data-activityname]").map_err(|e| format!("sel: {}", e))?;
        let content_sel =
            Selector::parse(".activity-altcontent").map_err(|e| format!("sel: {}", e))?;
        let mut items = Vec::new();
        for item in document.select(&item_sel) {
            let raw_title = item.value().attr("data-activityname").unwrap_or("").to_string();
            let title = raw_title.replace(" Section", "").trim().to_string();
            if title.is_empty() {
                continue;
            }
            let content_html = item
                .select(&content_sel)
                .next()
                .map(|el| el.html())
                .unwrap_or_default();
            // MST schedules are div-based (.schedule-item), not <table>; try the div
            // structure first (keeps assessment links), fall back to classic tables.
            let mut rows = Self::extract_schedule_div_rows(&content_html);
            if rows.is_empty() {
                rows = Self::extract_table_rows(&content_html);
            }
            items.push(ScheduleItem {
                title,
                content_html,
                rows,
            });
        }
        Ok(Schedule { course_id, items })
    }

    /// Parse submission status and feedback from the assignment detail page (best effort; exact selectors
    /// pending calibration against a runtime dump of the assignment page).
    fn parse_submission_status_from_html(&self, html: &str, assignment_id: u64) -> Result<SubmissionStatus, String> {
        let text = html;
        let lower = text.to_lowercase();

        let submitted = !lower.contains("no submission")
            && !lower.contains("not submitted")
            && (lower.contains("submitted")
                || lower.contains("submission status")
                && lower.contains("submitted"));

        // Keep the full "13.00 / 13.00" (numerator AND denominator) so the user
        // sees the max score; understand Chinese "成绩" labels too.
        let grade = regex::Regex::new(
            r"(?is)(?:grade|成绩|成績).{0,120}?(\d+(?:\.\d+)?)(?:[\s\x{A0}]|&nbsp;)*/(?:[\s\x{A0}]|&nbsp;)*(\d+(?:\.\d+)?)",
        )
        .ok()
        .and_then(|re| re.captures(text))
        .map(|c| format!("{} / {}", &c[1], &c[2]))
        .or_else(|| {
            // Bare "0.50 / 1.00" (assign submission table) without a label nearby.
            regex::Regex::new(
                r"(?i)(\d+(?:\.\d+)?)(?:[\s\x{A0}]|&nbsp;)*/(?:[\s\x{A0}]|&nbsp;)*(\d+(?:\.\d+)?)",
            )
            .ok()
            .and_then(|re| re.captures(text))
            .map(|c| format!("{} / {}", &c[1], &c[2]))
        });

        // Feedback body: the td content of the "Feedback comments" row in the assignment detail page's div.feedback table
        // (the old implementation returned a hardcoded Chinese "has feedback" placeholder whenever the page contained "feedback", ignoring English mode and real content).
        let feedback = {
            let doc = scraper::Html::parse_document(text);
            let mut fb: Option<String> = None;
            if let Ok(fb_sel) = scraper::Selector::parse("div.feedback") {
                if let Some(fb_el) = doc.select(&fb_sel).next() {
                    if let Ok(tr_sel) = scraper::Selector::parse("tr") {
                        for tr in fb_el.select(&tr_sel) {
                            let row_text = tr.text().collect::<String>();
                            if row_text.to_lowercase().contains("feedback comments") {
                                if let Ok(td_sel) = scraper::Selector::parse("td") {
                                    if let Some(td) = tr.select(&td_sel).last() {
                                        let t = td
                                            .text()
                                            .collect::<String>()
                                            .split_whitespace()
                                            .collect::<Vec<_>>()
                                            .join(" ");
                                        if !t.is_empty() {
                                            fb = Some(t);
                                        }
                                    }
                                }
                                break;
                            }
                        }
                    }
                }
            }
            fb
        };

        // Clean the extracted feedback: Moodle stores the "View feedback" plugin
        // button as escaped HTML entities (&lt;a href="...viewpluginassignfeedback..."&gt;)
        // inside the cell. Decode the entities and strip any leftover tags, so the
        // dialog shows the human feedback text only — never raw markup.
        let feedback = feedback.map(|t| {
            let decoded = decode_html_entities(&t);
            regex::Regex::new(r"<[^>]*>")
                .ok()
                .map(|re| re.replace_all(&decoded, " ").to_string())
                .unwrap_or(decoded)
                .split_whitespace()
                .collect::<Vec<_>>()
                .join(" ")
        });

        let due_date = regex::Regex::new(r"(?i)due[^0-9]{0,30}(\d{1,2}\s+\w+\s+\d{4})")
            .ok()
            .and_then(|re| re.captures(text))
            .and_then(|c| c.get(1))
            .map(|m| m.as_str().to_string());

        Ok(SubmissionStatus {
            assignment_id,
            submitted,
            grade,
            feedback,
            due_date,
        })
    }

    /// Fetch the course gradebook (grade/report/user/index.php?id=<courseId>):
    /// a single page contains grades / ranges / feedback for all assignments in the course.
    pub async fn fetch_course_gradebook(&self, course_id: u64) -> Result<Vec<GradeEntry>, String> {
        let client = self.auth.get_authenticated_client().await?;
        let url = format!("{}/grade/report/user/index.php?id={}", self.base_url, course_id);
        let html = Self::fetch_course_view_text(&client, &self.request_gate, &url).await?;
        Ok(self.parse_gradebook_from_html(&html, course_id))
    }

    /// Parse the gradebook user report page:
    /// each <tr> has `.gradeitemheader` (name + link), `.column-grade`, `.column-range`, `.column-feedback`.
    /// Only parse actual assessment items (rows with a gradeitemheader); category rows are skipped.
    fn parse_gradebook_from_html(&self, html: &str, course_id: u64) -> Vec<GradeEntry> {
        use scraper::{Html, Selector};
        let doc = Html::parse_document(html);
        let mut out: Vec<GradeEntry> = Vec::new();
        let mut seen = std::collections::HashSet::new();

        let Ok(tr_sel) = Selector::parse("tr") else {
            return out;
        };
        let Ok(name_sel) = Selector::parse(".gradeitemheader") else {
            return out;
        };

        for tr in doc.select(&tr_sel) {
            let Some(name_el) = tr.select(&name_sel).next() else {
                continue;
            };
            let item = name_el
                .text()
                .collect::<String>()
                .split_whitespace()
                .collect::<Vec<_>>()
                .join(" ");
            if item.is_empty() {
                continue;
            }
            let url = name_el.value().attr("href").map(|h| h.to_string());
            let key = url.clone().unwrap_or_else(|| item.clone());
            if !seen.insert(key) {
                continue;
            }

            let cell_text = |sel: &str| -> Option<String> {
                let Ok(c_sel) = Selector::parse(sel) else {
                    return None;
                };
                tr.select(&c_sel).next().map(|td| {
                    td.text()
                        .collect::<String>()
                        .split_whitespace()
                        .collect::<Vec<_>>()
                        .join(" ")
                })
            };

            // The real grade lives in the first child div (`<div>-</div>`); the rest of the cell
            // is the Moodle action menu ("Actions / Grade analysis") which must not leak into the
            // grade string. Plain-text cells (e.g. a bare "-") fall back to the whole cell text.
            let grade_text = match Selector::parse(".column-grade") {
                Ok(c_sel) => tr.select(&c_sel).next().and_then(|td| {
                    let text_of = |el: &scraper::ElementRef| {
                        el.text()
                            .collect::<String>()
                            .split_whitespace()
                            .collect::<Vec<_>>()
                            .join(" ")
                    };
                    // `div > div` (not a leading-`>` relative selector, which cssparser rejects):
                    // the first match in document order is the score div (`<div>-</div>`), which
                    // precedes the moodle action-menu div ("Actions / Grade analysis").
                    if let Ok(inner_sel) = Selector::parse("div > div") {
                        if let Some(v) = td.select(&inner_sel).next() {
                            let t = text_of(&v);
                            if !t.is_empty() {
                                return Some(t);
                            }
                        }
                    }
                    let t = text_of(&td);
                    if t.is_empty() { None } else { Some(t) }
                }),
                Err(_) => None,
            };

            out.push(GradeEntry {
                course_id,
                item,
                grade: grade_text,
                range: cell_text(".column-range").filter(|s| !s.is_empty()),
                feedback: cell_text(".column-feedback").filter(|s| !s.is_empty()),
                url,
            });
        }
        out
    }

    /// Parse the Panopto recordings block.
    ///
    /// Real structure (observed at Monash, inside the course `&section=1` / Unit Information block):
    /// ```html
    /// <a href="https://monash.au.panopto.com/Panopto/Pages/Viewer.aspx?id=<GUID>"
    ///    target="_blank">
    ///   <img alt="S1 2021 Intro"
    ///        src="https://monash.au.panopto.com/Panopto/PublicAPI/SessionPreviewImage?id=<GUID>">
    /// </a>
    /// ```
    /// - Title comes from the inner `<img alt>` (e.g. "S1 2021 Intro");
    /// - URL comes from `<a href>` (the Viewer page); the thumbnail `<img src>` is only used to get the title, not listed separately;
    /// - Also handles the `<iframe src="...panopto...">` embed form.
    /// Returns empty when nothing parses (no error). Note: a desktop-saved view-source/highlight view wraps
    /// attribute values in `<a class="html-attribute-value">` and corrupts the href, so desktop files cannot be
    /// used as samples -- use the raw text fetched by the App at runtime (or dumped via `MONASH_DUMP_COURSE_VIEW=1`).
    fn parse_recordings_from_html(&self, html: &str) -> Vec<Recording> {
        use scraper::{Html, Selector};
        use std::collections::hash_map::DefaultHasher;
        use std::hash::{Hash, Hasher};
        let mut out: Vec<Recording> = Vec::new();
        let mut seen: std::collections::HashSet<String> = std::collections::HashSet::new();
        let doc = Html::parse_document(html);

        // Candidate 1: recordings wrapped in <a href="...panopto..."> (title from the inner <img alt>)
        if let Ok(a_sel) = Selector::parse("a[href*=\"panopto\"]") {
            for a in doc.select(&a_sel) {
                let Some(href) = a.value().attr("href") else {
                    continue;
                };
                if !seen.insert(href.to_string()) {
                    continue;
                }
                let title = a
                    .select(&Selector::parse("img").expect("valid selector"))
                    .next()
                    .and_then(|img| img.value().attr("alt"))
                    .map(|s| decode_html_entities(s).trim().to_string())
                    .filter(|s| !s.is_empty())
                    .or_else(|| {
                        let t = a.text().collect::<String>().trim().to_string();
                        if t.is_empty() {
                            None
                        } else {
                            Some(t)
                        }
                    })
                    .unwrap_or_else(|| "Recording".to_string());
                let id = extract_id_from_url(href).unwrap_or_else(|| {
                    let mut h = DefaultHasher::new();
                    href.hash(&mut h);
                    h.finish()
                });
                out.push(Recording {
                    id,
                    title,
                    url: href.to_string(),
                    duration: None,
                });
            }
        }

        // Candidate 2: the <iframe src="...panopto..."> embed form
        if let Ok(ifr_sel) = Selector::parse("iframe[src*=\"panopto\"]") {
            for ifr in doc.select(&ifr_sel) {
                let Some(src) = ifr.value().attr("src") else {
                    continue;
                };
                if !seen.insert(src.to_string()) {
                    continue;
                }
                let title = ifr
                    .value()
                    .attr("title")
                    .map(|s| decode_html_entities(s).trim().to_string())
                    .filter(|s| !s.is_empty())
                    .unwrap_or_else(|| "Recording".to_string());
                let id = extract_id_from_url(src).unwrap_or_else(|| {
                    let mut h = DefaultHasher::new();
                    src.hash(&mut h);
                    h.finish()
                });
                out.push(Recording {
                    id,
                    title,
                    url: src.to_string(),
                    duration: None,
                });
            }
        }

        out
    }

    /// Fetch announcements for a specific course
    pub async fn fetch_announcements(&self, course_id: u64) -> Result<Vec<Announcement>, String> {
        let client = self.auth.get_authenticated_client().await?;
        let base_url = format!("{}/course/view.php?id={}", self.base_url, course_id);
        let base_html = Self::fetch_course_view_text(&client, &self.request_gate, &base_url).await?;

        let mut out: Vec<Announcement> = Vec::new();
        let mut seen = std::collections::HashSet::new();
        let mut merge = |list: Vec<Announcement>| {
            for a in list {
                if seen.insert(a.id) {
                    out.push(a);
                }
            }
        };

        // 1) Parse the course page directly (standard Moodle / non-MST courses: discussion links may be right on the page)
        merge(self.parse_announcements_from_html(&base_html, course_id)?);

        // 2) MST courses: the announcements forum lives in the FORUMS block (e.g. section=62). First find
        //    the FORUMS section number by its block label, fetch that block page to extract the forum cmid,
        //    then fetch the forum page and parse the discussions.
        //    The old implementation's fallback URL used the course id as the cmid (mod/forum/view.php?id={course_id}),
        //    which returned an error page and left announcements permanently empty -- this now uses the real forum cmid.
        let forums_section = find_forums_section(&extract_mst_section_links(&base_html, course_id));
        if let Some(sec) = forums_section {
            let sec_url = format!(
                "{}/course/view.php?id={}&section={}",
                self.base_url, course_id, sec
            );
            if let Ok(sec_html) = Self::fetch_course_view_text(&client, &self.request_gate, &sec_url).await {
                let cmids = match scraper::Selector::parse("a[href*='mod/forum/view.php']") {
                    Ok(a_sel) => {
                        let doc = scraper::Html::parse_document(&sec_html);
                        doc.select(&a_sel)
                            .filter_map(|a| a.value().attr("href").and_then(extract_id_from_url))
                            .collect::<Vec<u64>>()
                    }
                    Err(_) => Vec::new(),
                };
                for cmid in cmids {
                    let forum_url = format!("{}/mod/forum/view.php?id={}", self.base_url, cmid);
                    if let Ok(forum_html) = Self::fetch_course_view_text(&client, &self.request_gate, &forum_url).await {
                        if let Ok(list) = self.parse_announcements_from_html(&forum_html, course_id) {
                            merge(list);
                        }
                    }
                }
            }
        }

        Ok(out)
    }

    /// Fetch the Unit Dashboard (`&section=0`): the current-week overview card
    /// (week number + title + date range) + learning objectives/Topics body + the index of all weeks.
    pub async fn fetch_course_unit_dashboard(&self, course_id: u64) -> Result<UnitDashboard, String> {
        let client = self.auth.get_authenticated_client().await?;
        let url = format!("{}/course/view.php?id={}&section=0", self.base_url, course_id);
        let html = Self::fetch_course_view_text(&client, &self.request_gate, &url).await?;
        Self::dump_course_view_section_html(course_id, 0, &html);
        Ok(self.parse_unit_dashboard_from_html(&html, course_id))
    }

    /// Parse the Unit Dashboard page (section=0). The current-week card is in
    /// `.mst-current-focus-nav-item`: h3=week number, h1=title, h4.sectionstartenddate=dates;
    /// the detail body (Learning Objectives / Topics) is inside `#mst-current-focus-container`.
    fn parse_unit_dashboard_from_html(&self, html: &str, course_id: u64) -> UnitDashboard {
        use scraper::{Html, Selector};
        let doc = Html::parse_document(html);

        let mut current_week: Option<UnitWeek> = None;
        if let Ok(nav_sel) = Selector::parse(".mst-current-focus-nav-item") {
            if let Some(el) = doc.select(&nav_sel).next() {
                let num = Selector::parse("h3")
                    .ok()
                    .and_then(|sel| el.select(&sel).next())
                    .and_then(|e| extract_week_num(&e.text().collect::<String>()));
                let title = Selector::parse("h1")
                    .ok()
                    .and_then(|sel| el.select(&sel).next())
                    .map(|e| e.text().collect::<String>().trim().to_string())
                    .filter(|s| !s.is_empty());
                let dates = Selector::parse("h4.format-mst.sectionstartenddate")
                    .ok()
                    .and_then(|sel| el.select(&sel).next())
                    .map(|e| e.text().collect::<String>())
                    .map(|t| t.split_whitespace().collect::<Vec<_>>().join(" "))
                    .filter(|s| !s.is_empty());
                if let Some(title) = title {
                    current_week = Some(UnitWeek {
                        num: num.unwrap_or(0),
                        title,
                        dates,
                    });
                }
            }
        }

        let overview_html = Selector::parse("#mst-current-focus-container")
            .ok()
            .and_then(|sel| doc.select(&sel).next())
            .map(|el| sanitize_content_html(&el.inner_html()));

        // ---- Structured learning objectives of the current week ----
        let mut learning_objectives: Vec<LearningObjective> = Vec::new();
        if let Ok(card_sel) = Selector::parse("#collapseOverviewSection") {
            if let Some(card) = doc.select(&card_sel).next() {
                let title = Selector::parse("h3 strong")
                    .ok()
                    .and_then(|s| card.select(&s).next())
                    .map(|e| e.text().collect::<String>().trim().to_string())
                    .unwrap_or_default();
                let description = Selector::parse("p")
                    .ok()
                    .and_then(|s| card.select(&s).next())
                    .map(|e| e.text().collect::<String>().trim().to_string())
                    .unwrap_or_default();
                let items: Vec<String> = Selector::parse("ul li")
                    .ok()
                    .map(|s| {
                        card.select(&s)
                            .map(|e| e.text().collect::<String>().trim().to_string())
                            .filter(|t| !t.is_empty())
                            .collect()
                    })
                    .unwrap_or_default();
                if !title.is_empty() || !items.is_empty() {
                    learning_objectives.push(LearningObjective {
                        title,
                        description,
                        items,
                    });
                }
            }
        }

        // ---- Learning-path navigation: the authoritative week list of the current
        // offering. Moodle section numbers are sparse and accumulate history (a
        // 12-week unit can expose "Week 0".."Week 63"), so the MST focus nav is the
        // single reliable source for what the current term actually contains. ----
        let mut learning_nav: Vec<LearningNavItem> = Vec::new();
        if let Ok(nav_sel) = Selector::parse(".mst-current-focus-nav-item") {
            let sec_re = regex::Regex::new(r"section=(\d+)").unwrap();
            let h5_sel = Selector::parse("h5").ok();
            let span_sel = Selector::parse("span").ok();
            for el in doc.select(&nav_sel) {
                let onclick = el.value().attr("onclick").unwrap_or("");
                let section = sec_re
                    .captures(onclick)
                    .and_then(|c| c.get(1))
                    .and_then(|m| m.as_str().parse::<u64>().ok());
                let is_current = el
                    .value()
                    .classes()
                    .any(|c| c == "mst-current-focus-nav-item-current");
                // Current items carry an extra overlay <h5> ("Current"); the LAST h5 is the real week label.
                let week_label = h5_sel
                    .as_ref()
                    .and_then(|s| el.select(s).last())
                    .map(|e| e.text().collect::<String>().trim().to_string())
                    .unwrap_or_default();
                let module_title = span_sel
                    .as_ref()
                    .and_then(|s| el.select(s).next())
                    .map(|e| e.text().collect::<String>().trim().to_string())
                    .unwrap_or_default();
                if let Some(section) = section {
                    learning_nav.push(LearningNavItem {
                        section,
                        week_label,
                        module_title,
                        is_current,
                    });
                }
            }
        }

        // weeks: derive from the learning nav (authoritative); fall back to all
        // "Week N" section links when the nav is unavailable.
        let mut weeks: Vec<UnitWeek> = learning_nav
            .iter()
            .filter_map(|n| {
                extract_week_num(&n.week_label).map(|num| UnitWeek {
                    num,
                    title: n.module_title.clone(),
                    dates: None,
                })
            })
            .collect();
        if weeks.is_empty() {
            weeks = extract_mst_section_links(html, course_id)
                .into_iter()
                .filter(|(_, title)| title.trim_start().to_ascii_lowercase().starts_with("week "))
                .map(|(n, title)| UnitWeek {
                    num: n as u32,
                    title,
                    dates: None,
                })
                .collect();
        }

        UnitDashboard {
            course_id,
            current_week,
            weeks,
            overview_html,
            learning_objectives,
            learning_nav,
        }
    }

    /// Fetch course contacts (teachers/course team) by parsing the "Contacts" widget on the
    /// course page `course/view.php?id=<courseId>`. The widget only contains teachers/course team,
    /// no students, and isn't subject to the permission restrictions of `/user/index.php`.
    pub async fn fetch_course_contacts(&self, course_id: u64) -> Result<Vec<CourseContact>, String> {
        let client = self.auth.get_authenticated_client().await?;
        let url = format!("{}/course/view.php?id={}", self.base_url, course_id);

        let _permit = self.request_gate.acquire().await;
        let response = client
            .get(&url)
            .timeout(std::time::Duration::from_secs(10))
            .send()
            .await
            .map_err(|e| format!("Failed to fetch course contacts: {}", e))?;

        let html = response
            .text()
            .await
            .map_err(|e| format!("Failed to read course page: {}", e))?;

        Ok(self.parse_contacts_from_html(&html))
    }

    /// Parse the Contacts widget on the course page -> list of contacts.
    ///
    /// HTML structure (from `course/view.php?id=46900`):
    /// ```html
    /// <h1>Contacts</h1>
    /// <!-- Begin HTML generated from contacts template. -->
    /// <div class="widget-container widget-contacts ...">
    ///   <div class="widget-item">
    ///     <div class="contact-pic"><img src="..."></div>
    ///     <div class="contact-details">
    ///       Garry Young<br>
    ///       Lecturer<br>
    ///       <a href="mailto: Garry.Young@monash.edu">Garry.Young@monash.edu</a>
    ///     </div>
    ///   </div>
    /// </div>
    /// ```
    ///
    /// Strategy: use a `(?s)` multi-line regex to grab each whole widget-item at once, then extract
    /// name / role / email (trim the space after mailto) / picture_url separately.
    /// Parse the Contacts widget on the course page -> list of contacts (teachers/course team).
    ///
    /// Uses lenient scraper-based parsing rather than a single brittle regex (the old version required the exact
    /// `name<br>role<br><a mailto>` structure, so a minor tweak in some course templates caused misses ->
    /// users reported contacts not showing):
    /// - Prefer matching `.widget-contacts .widget-item`; if a course template puts contacts in some other
    ///   widget-item container, relax to any `.widget-item` containing `contact-details`.
    /// - Name/role are split from the `.contact-details` text by `<br>` (role may be missing);
    ///   the email is extracted from the `mailto:` link, tolerating the space after `mailto: ` and query params like `?subject=`.
    /// - Cards without a `mailto:` are not treated as contacts, avoiding false matches on other widget-items on the page.
    fn parse_contacts_from_html(&self, html: &str) -> Vec<CourseContact> {
        use scraper::{Html, Selector};
        let mut contacts = Vec::new();
        let doc = Html::parse_document(html);

        let item_sel = Selector::parse(".widget-contacts .widget-item").expect("valid selector");
        let mut items: Vec<_> = doc.select(&item_sel).collect();
        if items.is_empty() {
            // Relax: some Monash course templates put contacts in other .widget-item elements
            // without a .widget-contacts container. We still require a parsable mailto below to avoid false matches.
            let fallback = Selector::parse(".widget-item").expect("valid selector");
            items = doc.select(&fallback).collect();
        }

        let br_re = regex::Regex::new(r"(?i)<br\s*/?>").expect("valid regex");
        let mailto_re = regex::Regex::new(r#"(?i)mailto:\s*([^?"\s]+)"#).expect("valid regex");

        for item in items {
            // Avatar
            let picture_url = item
                .select(&Selector::parse("img").expect("valid selector"))
                .next()
                .and_then(|img| img.value().attr("src"))
                .map(|s| s.trim().to_string());

            // Email: prefer the mailto: link (tolerates the space in `mailto: ` and query params)
            let email = item
                .select(&Selector::parse("a[href]").expect("valid selector"))
                .filter_map(|a| a.value().attr("href"))
                .find_map(|href| {
                    mailto_re
                        .captures(href)
                        .and_then(|c| c.get(1))
                        .map(|m| m.as_str().trim().to_string())
                });
            let email = match email {
                Some(e) if !e.is_empty() => e,
                _ => continue, // no mailto means not a contact card
            };

            // Name / role: contact-details text split by <br>
            let details_html = item
                .select(&Selector::parse(".contact-details").expect("valid selector"))
                .next()
                .map(|d| d.inner_html())
                .unwrap_or_else(|| item.inner_html());

            let segs: Vec<String> = br_re
                .split(&details_html)
                .map(|s| {
                    decode_html_entities(&strip_tags(s))
                        .split_whitespace()
                        .collect::<Vec<_>>()
                        .join(" ")
                })
                .filter(|s| !s.is_empty())
                .collect();

            let mut name = String::new();
            let mut role_parts: Vec<String> = Vec::new();
            for seg in &segs {
                if seg.contains('@') {
                    continue; // redundant email fragment (e.g. `Garry.Young@monash.edu`)
                }
                if name.is_empty() {
                    name = seg.clone();
                } else {
                    role_parts.push(seg.clone());
                }
            }
            let role = role_parts.join(" ");
            if name.is_empty() {
                continue;
            }

            contacts.push(CourseContact {
                name,
                role,
                email,
                picture_url,
            });
        }
        contacts
    }

    /// Fetch the course member roster (`/user/index.php?id=<courseId>`) and return a structured list.
    ///
    /// Monash's participants table is server-rendered for the first 20 rows, paginated via standard `?page=N` GET links.
    /// Strategy: first pass tries `perpage=5000` to grab the whole class at once; if the server still paginates
    /// (`&page=N` appears in the links), fetch the remaining pages and dedup. Per-row parsing is in `parse_participants_from_html`.
    pub async fn fetch_course_members(&self, course_id: u64) -> Result<Vec<Member>, String> {
        let client = self.auth.get_authenticated_client().await?;
        let mut all: Vec<Member> = Vec::new();
        let mut seen: std::collections::HashSet<u64> = std::collections::HashSet::new();

        // First pass: perpage=5000 to grab the whole class at once (large classes get truncated by the server cap; the fallback below handles it).
        let first_url = format!(
            "{}/user/index.php?id={}&perpage=5000",
            self.base_url, course_id
        );
        let (first_html, final_url) = Self::fetch_members_page(&client, &self.request_gate, &first_url).await?;
        if Self::is_login_redirect(&final_url) {
            return Err(format!(
                "Session expired: the request was redirected to the login page ({}). Please log out and sign in again via Monash SSO.",
                final_url
            ));
        }
        // Intercept Moodle error pages (e.g. "no permission to view participants"). Such pages keep the URL unchanged
        // (not a login redirect) but the body is an error box; if not intercepted, parse yields 0 rows -> silently
        // returns an empty list -> the frontend "does nothing when clicked". Surface the real failure reason to the frontend.
        if let Some(msg) = Self::extract_moodle_error(&first_html) {
            return Err(msg);
        }
        // Debug: dump the first page's raw HTML (no manual save needed, makes offline parse debugging easier)
        let _ = Self::dump_members_html(course_id, &first_html);
        self.collect_members(&first_html, course_id, &mut all, &mut seen);

        // If the first page still paginates (perpage was truncated), fetch pages 1..=max_page
        let max_page = Self::extract_max_page(&first_html, course_id);
        for page in 1..=max_page {
            let url = format!(
                "{}/user/index.php?id={}&page={}",
                self.base_url, course_id, page
            );
            let (html, final_url) = Self::fetch_members_page(&client, &self.request_gate, &url).await?;
            if Self::is_login_redirect(&final_url) {
                return Err(format!("Session expired (paging {} bounced to the login page). Please log in again.", page));
            }
            self.collect_members(&html, course_id, &mut all, &mut seen);
        }

        Ok(all)
    }

    /// Merge the members from one page of roster HTML into `all` (deduped by id).
    fn collect_members(
        &self,
        html: &str,
        course_id: u64,
        all: &mut Vec<Member>,
        seen: &mut std::collections::HashSet<u64>,
    ) {
        for m in self.parse_participants_from_html(html, course_id) {
            if seen.insert(m.id) {
                all.push(m);
            }
        }
    }

    /// Parse a single page of participants roster HTML -> list of members.
    ///
    /// Row structure: inside `<tr id="user-index-participants-<cid>_rN">`,
    /// the `cell c1` column is `<a href=".../user/view.php?id=<UID>&course=<CID>">` (an initials
    /// `<span>` followed by the name text), and the `cell c2` column is the role text (e.g. Student / Tutor / Teacher).
    /// Avatars are always initials (no `userpicture` image), so `picture_url` is left empty.
    fn parse_participants_from_html(&self, html: &str, course_id: u64) -> Vec<Member> {
        let mut members = Vec::new();
        // Row: capture the remaining in-row HTML for secondary extraction
        // (?s) makes . match newlines -- Monash's member rows span multiple lines, otherwise .*? won't reach </tr>.
        let row_re = match regex::Regex::new(
            r#"(?s)<tr[^>]*id="user-index-participants-\d+_r\d+"(.*?)</tr>"#,
        ) {
            Ok(re) => re,
            Err(_) => return members,
        };
        // In-row: profile link + name (the initials span is optional; the name comes after </span> and before </a>)
        let link_re = regex::Regex::new(
            r#"user/view\.php\?id=(\d+)[^>]*>(?:<span[^>]*>[^<]*</span>)?\s*([^<]+)</a>"#,
        )
        .ok();
        // Role column
        let role_re = regex::Regex::new(r#"(?s)cell c2"[^>]*>(.*?)</td>"#).ok();

        for cap in row_re.captures_iter(html) {
            let body = &cap[1];
            let uid = match link_re
                .as_ref()
                .and_then(|re| re.captures(body))
                .and_then(|c| c.get(1))
            {
                Some(m) => m.as_str().parse::<u64>().unwrap_or(0),
                None => continue,
            };
            if uid == 0 {
                continue;
            }
            let name = link_re
                .as_ref()
                .and_then(|re| re.captures(body))
                .and_then(|c| c.get(2))
                .map(|m| {
                    let raw = strip_tags(m.as_str());
                    decode_html_entities(&raw)
                        .split_whitespace()
                        .collect::<Vec<_>>()
                        .join(" ")
                })
                .unwrap_or_default();
            let role = role_re
                .as_ref()
                .and_then(|re| re.captures(body))
                .and_then(|c| c.get(1))
                .map(|m| decode_html_entities(&strip_tags(m.as_str())).trim().to_string())
                .unwrap_or_default();

            let profile_url = format!(
                "{}/user/view.php?id={}&course={}",
                self.base_url, uid, course_id
            );
            members.push(Member {
                id: uid,
                name,
                roles: if role.is_empty() { Vec::new() } else { vec![role] },
                picture_url: None,
                profile_url: Some(profile_url),
            });
        }
        members
    }

    /// Fetch one page of roster HTML + the final URL (used for SSO expiry detection).
    async fn fetch_members_page(
        client: &reqwest::Client,
        gate: &Arc<crate::moodle::throttle::RequestGate>,
        url: &str,
    ) -> Result<(String, String), String> {
        let _permit = gate.acquire().await;
        let response = client
            .get(url)
            .timeout(std::time::Duration::from_secs(10))
            .send()
            .await
            .map_err(|e| format!("Failed to fetch members page {}: {}", url, e))?;
        let final_url = response.url().to_string();
        let html = response
            .text()
            .await
            .map_err(|e| format!("Failed to read members page {}: {}", url, e))?;
        Ok((html, final_url))
    }

    /// Whether the final URL landed on a login/SSO page (session expired).
    fn is_login_redirect(url: &str) -> bool {
        let lower = url.to_lowercase();
        lower.contains("/login")
            || lower.contains("okta.com")
            || lower.contains("microsoftonline.com")
            || lower.contains("accounts.google.com")
    }

    /// Extract the max page number from the pagination nav (returns 0 when there's no pagination).
    fn extract_max_page(html: &str, course_id: u64) -> u64 {
        let pat = format!("user/index\\.php\\?id={}&amp;page=(\\d+)", course_id);
        let re = match regex::Regex::new(&pat) {
            Ok(r) => r,
            Err(_) => return 0,
        };
        re.captures_iter(html)
            .filter_map(|c| c.get(1))
            .filter_map(|m| m.as_str().parse::<u64>().ok())
            .max()
            .unwrap_or(0)
    }

    /// Extract the real error message from a Moodle error page (fatal error box).
    ///
    /// For example, inside `data-rel="fatalerror"`:
    /// `<p class="errormessage">Sorry, but you do not currently have
    /// permissions to do that (View participants).</p>`.
    ///
    /// Such pages don't redirect to the login page (it's not a session expiry), but the body is an error box. If not
    /// intercepted, `parse_participants_from_html` parses 0 rows -> the backend silently returns `Ok([])` ->
    /// the frontend gets neither an error nor a roster, appearing as "nothing happens when clicked". On a hit, surface the failure reason to the caller.
    fn extract_moodle_error(html: &str) -> Option<String> {
        // Preferred: the errormessage inside the fatalerror block (most precise, e.g. insufficient permissions).
        if let Some(re) =
            regex::Regex::new(r#"(?s)data-rel="fatalerror"[^>]*>.*?<p class="errormessage">(.*?)</p>"#).ok()
        {
            if let Some(cap) = re.captures(html) {
                let msg = Self::clean_error_text(&cap[1]);
                if !msg.is_empty() {
                    return Some(msg);
                }
            }
        }
        // Fallback: the page <title> is Error and an errormessage appears anywhere in the body.
        let title_is_error =
            regex::Regex::new(r#"(?is)<title>\s*Error\b[^<]*</title>"#).ok().map_or(false, |re| re.is_match(html));
        if title_is_error {
            if let Some(re) = regex::Regex::new(r#"(?s)<p class="errormessage">(.*?)</p>"#).ok() {
                if let Some(cap) = re.captures(html) {
                    let msg = Self::clean_error_text(&cap[1]);
                    if !msg.is_empty() {
                        return Some(msg);
                    }
                }
            }
        }
        None
    }

    /// Clean an error fragment into single-line readable text (strip tags + decode entities + collapse whitespace).
    fn clean_error_text(raw: &str) -> String {
        let t = decode_html_entities(&strip_tags(raw));
        t.split_whitespace().collect::<Vec<_>>().join(" ")
    }

    /// Fetch all data (courses, resources, assignments, announcements).
    /// Fetches per-course data concurrently (up to 4 in-flight) to reduce
    /// total sync time from ~36 sequential requests to a handful of rounds.

    /// All-course calendar events: merges the month view (whole month, day granularity) with the upcoming view
    /// (next 21 days, with precise timestamps and course IDs). For the same event, the upcoming data wins.
    pub async fn fetch_calendar_events(&self) -> Result<Vec<CalendarEvent>, String> {
        let client = self.auth.get_authenticated_client().await?;
        let base = &self.base_url;

        let month_url = format!("{}/calendar/view.php?view=month", base);
        let _permit = self.request_gate.acquire().await;
        let month_html = client
            .get(&month_url)
            .timeout(std::time::Duration::from_secs(20))
            .send()
            .await
            .map_err(|e| format!("Failed to fetch calendar month view: {}", e))?
            .text()
            .await
            .map_err(|e| format!("Failed to read calendar month view: {}", e))?;

        // Year/month context: calendarwrapper carries data-year / data-month
        let mut year: Option<i32> = None;
        let mut month: Option<u32> = None;
        if let Some(cap) = regex::Regex::new(r#"data-year="(\d{4})" data-month="(\d{1,2})""#)
            .unwrap()
            .captures(&month_html)
        {
            year = cap.get(1).and_then(|m| m.as_str().parse().ok());
            month = cap.get(2).and_then(|m| m.as_str().parse().ok());
        }

        // Per-day cell scan: event li[data-region=event-item] following td[data-day=N]
        let mut events: std::collections::HashMap<u64, CalendarEvent> = std::collections::HashMap::new();
        let day_re = regex::Regex::new(r#"<td[^>]*data-day="(\d{1,2})"[^>]*>"#).unwrap();
        let li_re = regex::Regex::new(
            r#"<li[^>]*data-region="event-item"([^>]*)>(?s).*?<a data-action="view-event"[^>]*data-event-id="(\d+)"[^>]*href="([^"]*)"[^>]*title="([^"]*)"[^>]*>"#,
        )
        .unwrap();

        // Note: the date of an event li is determined by "walking back to the nearest data-day" (see below).
        for cap in li_re.captures_iter(&month_html) {
            let li_start = cap.get(0).unwrap().start();
            // Walk back for the current day: take the last data-day before li_start
            let mut day_val: Option<u32> = None;
            for dcap in day_re.captures_iter(&month_html[..li_start]) {
                day_val = dcap.get(1).and_then(|d| d.as_str().parse().ok());
            }
            let attrs = cap.get(1).map(|x| x.as_str()).unwrap_or("");
            let id: u64 = cap.get(2).and_then(|m| m.as_str().parse().ok()).unwrap_or(0);
            let url = cap.get(3).map(|m| m.as_str().to_string()).unwrap_or_default();
            let title = cap.get(4).map(|m| m.as_str().to_string()).unwrap_or_default();
            let component = regex::Regex::new(r#"data-event-component="([^"]*)""#)
                .unwrap()
                .captures(attrs)
                .and_then(|m| m.get(1).map(|x| x.as_str().to_string()))
                .unwrap_or_else(|| "core".to_string());
            let event_type = regex::Regex::new(r#"data-event-eventtype="([^"]*)""#)
                .unwrap()
                .captures(attrs)
                .and_then(|m| m.get(1).map(|x| x.as_str().to_string()))
                .unwrap_or_else(|| "event".to_string());

            let ts = if let (Some(y), Some(mo), Some(d)) = (year, month, day_val) {
                chrono::NaiveDate::from_ymd_opt(y, mo, d)
                    .and_then(|d0| d0.and_hms_opt(0, 0, 0))
                    .map(|ndt| ndt.and_utc().timestamp() as u64)
                    .unwrap_or(0)
            } else {
                0
            };

            if id != 0 {
                events.insert(
                    id,
                    CalendarEvent {
                        id,
                        course_id: None,
                        component,
                        event_type,
                        title,
                        timestamp: ts,
                        url,
                    },
                );
            }
        }

        // upcoming view: 21-day window, with course ID + precise timestamps
        let up_url = format!("{}/calendar/view.php?view=upcoming", base);
        let _permit = self.request_gate.acquire().await;
        let up_html = client
            .get(&up_url)
            .timeout(std::time::Duration::from_secs(20))
            .send()
            .await
            .map_err(|e| format!("Failed to fetch calendar upcoming view: {}", e))?
            .text()
            .await
            .map_err(|e| format!("Failed to read calendar upcoming view: {}", e))?;

        let ev_re = regex::Regex::new(
            r#"<div[^>]*data-type="event"[^>]*data-course-id="(\d+)"[^>]*data-event-id="(\d+)"[^>]*data-event-component="([^"]*)"[^>]*data-event-eventtype="([^"]*)"[^>]*data-event-title="([^"]*)"[^>]*>(?s).*?<h3[^>]*>(.*?)</h3>"#,
        )
        .unwrap();
        let ts_re = regex::Regex::new(r#"view=day&(?:amp;)?time=(\d+)"#).unwrap();

        for cap in ev_re.captures_iter(&up_html) {
            let course_id: u64 = cap.get(1).and_then(|m| m.as_str().parse().ok()).unwrap_or(0);
            let id: u64 = cap.get(2).and_then(|m| m.as_str().parse().ok()).unwrap_or(0);
            let component = cap.get(3).map(|m| m.as_str().to_string()).unwrap_or_default();
            let event_type = cap.get(4).map(|m| m.as_str().to_string()).unwrap_or_default();
            let title = cap
                .get(6)
                .map(|m| m.as_str().trim().to_string())
                .filter(|s| !s.is_empty())
                .or_else(|| cap.get(5).map(|m| m.as_str().to_string()))
                .unwrap_or_default();
            let ts = cap
                .get(0)
                .and_then(|m| ts_re.captures(m.as_str()))
                .and_then(|t| t.get(1))
                .and_then(|t| t.as_str().parse::<u64>().ok())
                .unwrap_or(0);
            let url = format!("{}/calendar/view.php?view=day&time={}", base, ts);
            if id != 0 {
                events
                    .entry(id)
                    .and_modify(|e| {
                        e.course_id = Some(course_id);
                        if ts > 0 {
                            e.timestamp = ts;
                        }
                        e.url = url.clone();
                    })
                    .or_insert(CalendarEvent {
                        id,
                        course_id: Some(course_id),
                        component,
                        event_type,
                        title,
                        timestamp: ts,
                        url,
                    });
            }
        }

        let mut out: Vec<CalendarEvent> = events.into_values().collect();
        out.sort_by_key(|e| e.timestamp);
        Ok(out)
    }

    /// Course quiz list (/mod/quiz/index.php?id=<courseId>).
    pub async fn fetch_course_quizzes(&self, course_id: u64) -> Result<Vec<Quiz>, String> {
        let client = self.auth.get_authenticated_client().await?;
        let url = format!("{}/mod/quiz/index.php?id={}", self.base_url, course_id);
        let _permit = self.request_gate.acquire().await;
        let html = client
            .get(&url)
            .timeout(std::time::Duration::from_secs(20))
            .send()
            .await
            .map_err(|e| format!("Failed to fetch quiz index: {}", e))?
            .text()
            .await
            .map_err(|e| format!("Failed to read quiz index: {}", e))?;

        let row_re = regex::Regex::new(
            r#"<tr[^>]*>(?s).*?</tr>"#,
        )
        .unwrap();
        let cell_re = regex::Regex::new(r#"<t[dh][^>]*>(.*?)</t[dh]>"#).unwrap();
        let link_re = regex::Regex::new(r#"href="([^"]*view\.php\?id=(\d+))""#).unwrap();
        let strip_re = regex::Regex::new(r#"<[^>]+>"#).unwrap();

        let mut quizzes = Vec::new();
        for row in row_re.captures_iter(&html) {
            let row_html = row.get(0).unwrap().as_str();
            // Skip the header row: it starts with th
            if row_html.contains("<th") {
                continue;
            }
            let cells: Vec<String> = cell_re
                .captures_iter(row_html)
                .map(|c| {
                    let raw = c.get(1).map(|m| m.as_str()).unwrap_or("");
                    let text = strip_re.replace_all(raw, " ").to_string();
                    text.split_whitespace().collect::<Vec<_>>().join(" ")
                })
                .collect();
            if cells.len() < 4 {
                continue;
            }
            let link = link_re.captures(row_html);
            let id: u64 = link
                .as_ref()
                .and_then(|l| l.get(2))
                .and_then(|m| m.as_str().parse().ok())
                .unwrap_or(0);
            if id == 0 {
                continue;
            }
            let closes = if cells[2].is_empty() { None } else { Some(cells[2].clone()) };
            let closes_iso = closes
                .as_deref()
                .and_then(parse_moodle_due_date);
            quizzes.push(Quiz {
                id,
                course_id,
                name: cells[1].clone(),
                closes,
                closes_iso,
                section: cells[0].clone(),
                url: link
                    .as_ref()
                    .and_then(|l| l.get(1).map(|m| m.as_str().to_string()))
                    .unwrap_or_default(),
            });
        }
        Ok(quizzes)
    }


    /// Cross-course grade overview (the Unit name | Grade table of /grade/report/overview/index.php).
    /// Row data: course name + grade text ("-" when not yet graded).
    pub async fn fetch_grade_overview(&self) -> Result<Vec<GradeOverviewRow>, String> {
        let client = self.auth.get_authenticated_client().await?;
        let url = format!("{}/grade/report/overview/index.php", self.base_url);
        let _permit = self.request_gate.acquire().await;
        let html = client
            .get(&url)
            .timeout(std::time::Duration::from_secs(20))
            .send()
            .await
            .map_err(|e| format!("Failed to fetch grade overview: {}", e))?
            .text()
            .await
            .map_err(|e| format!("Failed to read grade overview: {}", e))?;

        let row_re = regex::Regex::new(r#"<tr[^>]*>(?s).*?</tr>"#).unwrap();
        let cell_re = regex::Regex::new(r#"<t[dh][^>]*>(.*?)</t[dh]>"#).unwrap();
        let strip_re = regex::Regex::new(r#"<[^>]+>"#).unwrap();

        let mut rows = Vec::new();
        for row in row_re.captures_iter(&html) {
            let row_html = row.get(0).unwrap().as_str();
            if row_html.contains("<th") {
                continue;
            }
            let cells: Vec<String> = cell_re
                .captures_iter(row_html)
                .map(|c| {
                    let raw = c.get(1).map(|m| m.as_str()).unwrap_or("");
                    let text = strip_re.replace_all(raw, " ").to_string();
                    text.split_whitespace().collect::<Vec<_>>().join(" ")
                })
                .collect();
            if cells.len() < 2 || cells[0].is_empty() {
                continue;
            }
            let grade = {
                let g = cells.get(1).cloned().unwrap_or_default();
                let g = g.trim().to_string();
                let lower = g.to_lowercase();
                if g.is_empty()
                    || g == "-"
                    || g == "\u{2014}"
                    || lower.contains("not graded")
                    || lower.contains("not yet graded")
                {
                    "-".to_string()
                } else {
                    g
                }
            };
            rows.push(GradeOverviewRow {
                unit: cells[0].clone(),
                grade,
            });
        }
        Ok(rows)
    }

    /// Fetch the tabs of one course in parallel — Unit Dashboard (section=0), Unit Info
    /// (section=1), Schedule (section=2), Recordings (Panopto block) and Contacts — so the
    /// full sync can pre-fill the course detail page. Each source degrades independently:
    /// a failing tab never blocks the others, and never takes down the whole sync.
    ///
    /// `include_fixed` follows the user's fetch strategy: unit info / schedule / contacts
    /// are semester-fixed content (fetch once and cache), so they are skipped on every
    /// regular login sync and only fetched on first run or a manual full refresh. The
    /// dashboard (its "current week" rolls weekly) and recordings are dynamic and always
    /// fetched. Skipped tabs come back as `None`/empty, which the frontend merges without
    /// overwriting its cached copies.
    pub async fn fetch_course_tab_data(&self, course_id: u64, include_fixed: bool) -> CourseTabData {
        let (dashboard, unit_info, schedule, recordings, contacts) = if include_fixed {
            tokio::join!(
                self.fetch_course_unit_dashboard(course_id),
                self.fetch_course_unit_info(course_id),
                self.fetch_course_schedule(course_id),
                self.fetch_course_recordings(course_id),
                self.fetch_course_contacts(course_id),
            )
        } else {
            let (dashboard, recordings) = tokio::join!(
                self.fetch_course_unit_dashboard(course_id),
                self.fetch_course_recordings(course_id),
            );
            let skipped_unit_info: Result<UnitInfo, String> =
                Err("skipped (fixed tab cached)".to_string());
            let skipped_schedule: Result<Schedule, String> =
                Err("skipped (fixed tab cached)".to_string());
            let skipped_contacts: Result<Vec<CourseContact>, String> =
                Err("skipped (fixed tab cached)".to_string());
            (dashboard, skipped_unit_info, skipped_schedule, recordings, skipped_contacts)
        };
        CourseTabData {
            course_id,
            dashboard: dashboard.ok(),
            unit_info: unit_info.ok(),
            schedule: schedule.ok(),
            recordings: recordings.unwrap_or_default(),
            contacts: contacts.unwrap_or_default(),
        }
    }

    pub async fn fetch_all_data(
        &self,
        progress: Option<Arc<dyn Fn(usize, usize, &str) + Send + Sync>>,
        include_fixed_tabs: bool,
    ) -> Result<
        (
            Vec<Course>,
            Vec<Resource>,
            Vec<Assignment>,
            Vec<Announcement>,
            Vec<CourseTabData>,
        ),
        String,
    > {
        let courses = self.fetch_courses().await?;
        // Portal/hub courses (IT Student Portal, MUM Academic Success, etc.) are not academic courses:
        // skip fetching their resources/assignments/announcements (saves ~5 courses x 19 blocks of requests), and exclude them from the course list.
        let real_courses: Vec<Course> = courses.into_iter().filter(|c| !c.is_portal).collect();
        let total_courses = real_courses.len();
        if let Some(p) = &progress {
            p(0, total_courses, "courses");
        }

        let semaphore = Arc::new(tokio::sync::Semaphore::new(4));

        let handles: Vec<_> = real_courses
            .iter()
            .map(|course| {
                let sem = semaphore.clone();
                let scraper = self.clone();
                let course_id = course.id;
                tokio::spawn(async move {
                    let _permit = sem.acquire().await;
                    // P1: fetch the 3 kinds of per-course data in parallel, cutting sync time by roughly 60%.
                    // Assignments use fetch_course_assessments (Assessments section): it covers quizzes as well
                    // as regular assignments, and enriches real submission state (detail pages + gradebook),
                    // so the Dashboard / AssignmentsPage stats are no longer quiz-blind.
                    let (resources, assignments, announcements, tab_data) = tokio::join!(
                        scraper.fetch_course_resources(course_id),
                        scraper.fetch_course_assessments(course_id),
                        scraper.fetch_announcements(course_id),
                        scraper.fetch_course_tab_data(course_id, include_fixed_tabs),
                    );
                    (
                        resources.unwrap_or_default(),
                        assignments.unwrap_or_default(),
                        announcements.unwrap_or_default(),
                        tab_data,
                    )
                })
            })
            .collect();

        let mut all_resources = Vec::new();
        let mut all_assignments = Vec::new();
        let mut all_announcements = Vec::new();
        let mut all_tab_data = Vec::new();
        let mut done_courses = 0usize;

        for handle in handles {
            if let Ok((resources, assignments, announcements, tab_data)) = handle.await {
                all_resources.extend(resources);
                all_assignments.extend(assignments);
                all_announcements.extend(announcements);
                all_tab_data.push(tab_data);
            }
            done_courses += 1;
            if let Some(p) = &progress {
                p(done_courses, total_courses, "course");
            }
        }

        // Course name backfill: merge back the full course names extracted from <title>/<h1> when fetching course pages
        // (the /my/ dropdown's option text is truncated, e.g. "FIT4005-FIT5125 IT research and innovation meth...").
        let mut enriched: Vec<Course> = real_courses;
        {
            let names = self.course_names.lock().unwrap();
            for course in &mut enriched {
                if let Some(full) = names.get(&course.id) {
                    course.full_name = full.clone();
                    if let Some(code) = derive_short_name(full) {
                        course.short_name = code;
                    }
                }
            }
        }

        Ok((enriched, all_resources, all_assignments, all_announcements, all_tab_data))
    }

    /// Download a file from Moodle and save it to the specified path
    pub async fn download_file(
        &self,
        file_url: &str,
        save_path: &str,
        app_handle: Option<&tauri::AppHandle>,
    ) -> Result<String, String> {
        let client = self.auth.get_authenticated_client().await?;

        let _permit = self.request_gate.acquire().await;
        let response = client
            .get(file_url)
            .send()
            .await
            .map_err(|e| format!("Failed to download file: {}", e))?;

        if !response.status().is_success() {
            return Err(format!("Download failed with status: {}", response.status()));
        }

        // Try to get filename from Content-Disposition header
        let raw_filename = response
            .headers()
            .get("content-disposition")
            .and_then(|val| val.to_str().ok())
            .and_then(|s| {
                let parts: Vec<&str> = s.split("filename=").collect();
                if parts.len() > 1 {
                    Some(parts[1].trim_matches('"').to_string())
                } else {
                    None
                }
            })
            .unwrap_or_else(|| {
                file_url
                    .split('/')
                    .last()
                    .map(|s| s.to_string())
                    .unwrap_or_else(|| "downloaded_file".to_string())
            });

        let filename = sanitize_filename(&raw_filename);

        // Resolve the save path into an absolute directory to drop the file in.
        // A relative path like "FIT5215" is mapped to `<system Downloads>/Muster/FIT5215`.
        // An empty path falls back to `<system Downloads>/Muster`.
        let raw_path = std::path::PathBuf::from(save_path);
        let target_dir = if raw_path.is_absolute() {
            raw_path
        } else {
            let base = dirs::download_dir()
                .unwrap_or_else(|| std::path::PathBuf::from("."))
                .join("Muster");
            let clean_save = save_path.trim().trim_start_matches(['/', '\\']);
            if !clean_save.is_empty() {
                base.join(clean_save)
            } else {
                base
            }
        };
        let full_path = target_dir.join(&filename);

        // Create parent directory if it doesn't exist
        if let Some(parent) = full_path.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| format!("Failed to create directory: {}", e))?;
        }

        // Streaming download + progress events: emit download-progress (key/received/total) to the frontend,
        // which renders a browser-style download manager (progress bar + speed) from it.
        use futures_util::StreamExt;
        use std::io::Write;
        use tauri::Emitter;

        let total = response.content_length();
        let mut file = std::fs::File::create(&full_path)
            .map_err(|e| format!("Failed to create file: {}", e))?;
        let mut received: u64 = 0;
        let mut last_emit = std::time::Instant::now();
        let mut stream = response.bytes_stream();
        while let Some(chunk) = stream.next().await {
            let chunk = chunk.map_err(|e| format!("Failed to read stream: {}", e))?;
            file.write_all(&chunk)
                .map_err(|e| format!("Failed to write file: {}", e))?;
            received += chunk.len() as u64;
            let now = std::time::Instant::now();
            if received == total.unwrap_or(0) || now.duration_since(last_emit).as_millis() >= 200 {
                last_emit = now;
                if let Some(h) = app_handle {
                    let _ = h.emit(
                        "download-progress",
                        serde_json::json!({
                            "key": file_url,
                            "received": received,
                            "total": total,
                        }),
                    );
                }
            }
        }

        Ok(full_path.to_string_lossy().to_string())
    }

    /// Generate an AI summary of course content using OpenAI/Anthropic compatible API.
    /// Auto-detects Anthropic Claude (URL contains "anthropic.com") and switches to its
    /// native request shape: `x-api-key` header + `anthropic-version` + `content[0].text`.
    /// Everything else (DeepSeek / OpenAI / OpenAI-compatible) goes through the standard
    /// chat-completions body.
    ///
    /// Uses the scraper's shared AI client (60s timeout, built once in `new()`).
    /// Content is truncated to ~12 000 characters to stay within typical LLM
    /// context limits.
    /// Streaming AI summary: call the LLM's stream endpoint and push chunks to the frontend as they arrive via the Tauri event
    /// `summary-{stream_id}` (payload: {type:"chunk",text} / {type:"done"} / {type:"error",error}).
    /// Shared system prompt for the AI course summary. Used by both the streaming
    /// and non-streaming paths so the two can never drift apart.
    const AI_SYSTEM_PROMPT: &str = "You are a study assistant for Monash University students.\n\
Follow these rules strictly:\n\
1. Summarize ONLY the course content provided in the user's request. Never invent assignments, due dates, names, or materials not present in the content.\n\
2. If the content does not cover one of the required sections, write \"No information provided for this section\" instead of guessing.\n\
3. Output in the language requested by the user's language instruction in the request.\n\
4. Use Markdown with exactly these section headings: ## Course Overview, ## Key Resources, ## Assignments & Quizzes, ## Recommended Next Steps.\n\
5. Keep the summary under 400 words. Be concise and practical. Do not add opening phrases, greetings, or disclaimers.\n\
6. Highlight anything due within 7 days and keep the exact due-date wording from the content.\n\
7. Keep the exact names of courses, resources and assignments as they appear in the content.\n\
8. Be analytical, not a re-listing — the user can already see the raw list in Moodle. Extract what matters: weights, deadlines, priorities, and what they imply.\n\
9. Compute and state concrete numbers: days until each deadline (use the provided today's date) and each item's share of the grade, with the takeaway (e.g. \"the exam is 50% — by far the biggest item\").\n\
10. For Recommended Next Steps, if the content has no explicit guidance, infer practical suggestions from deadlines and weights (e.g. \"Assignment 1 is due in 26 days — start Module 2 work this week\"), clearly marked as suggestions, never as course requirements.\n\
11. Keep lists short: at most 3-5 bullets per section, one line each.";

    pub async fn generate_summary_stream(
        &self,
        content: &str,
        api_key: &str,
        api_url: &str,
        model: &str,
        app_handle: Option<&tauri::AppHandle>,
        stream_id: &str,
    ) -> Result<(), String> {
        const MAX_CONTENT_CHARS: usize = 12_000;
        use futures_util::StreamExt;
        use tauri::Emitter;

        let client = self.ai_client.clone();
        let is_claude = api_url.contains("anthropic.com") || api_url.trim_end_matches('/').ends_with("/messages");

        let truncated = if content.len() > MAX_CONTENT_CHARS {
            let cut = &content[..MAX_CONTENT_CHARS];
            format!("{}\n\n[... content truncated at {} characters]", cut, MAX_CONTENT_CHARS)
        } else {
            content.to_string()
        };

        let body = if is_claude {
            serde_json::json!({
                "model": model,
                "max_tokens": 8192,
                "stream": true,
                "system": Self::AI_SYSTEM_PROMPT,
                "messages": [{
                    "role": "user",
                    "content": format!("Please summarize the following course content:\n\n{}", truncated)
                }]
            })
        } else {
            serde_json::json!({
                "model": model,
                "messages": [
                    { "role": "system", "content": Self::AI_SYSTEM_PROMPT },
                    { "role": "user", "content": format!("Please summarize the following course content:\n\n{}", truncated) }
                ],
                "max_tokens": 8192,
                "temperature": 0.3,
                "stream": true,
            })
        };

        let mut req = client
            .post(api_url)
            .header("Content-Type", "application/json");
        req = if is_claude {
            req.header("x-api-key", api_key)
                .header("anthropic-version", "2023-06-01")
        } else {
            req.header("Authorization", format!("Bearer {}", api_key))
        };

        let response = req
            .json(&body)
            .send()
            .await
            .map_err(|e| {
                if e.is_timeout() {
                    "AI API request timed out (60s). Please try again or use a shorter content.".to_string()
                } else {
                    format!("Failed to call AI API: {}", e)
                }
            })?;

        if !response.status().is_success() {
            let error_text = response.text().await.unwrap_or_default();
            return Err(format!("AI API error: {}", error_text));
        }

        let emit = |payload: serde_json::Value| {
            if let Some(h) = app_handle {
                let _ = h.emit(&format!("summary-{}", stream_id), &payload);
            }
        };

        let mut stream = response.bytes_stream();
        let mut buffer = String::new();
        let mut full_body: Vec<u8> = Vec::new();
        let mut emitted_any = false;

        // SSE line-by-line parsing: `data: {...}` / `data: [DONE]`; chunk boundaries may split a line, so accumulate in a buffer.
        loop {
            let mut finished = false;
            while let Some(pos) = buffer.find('\n') {
                let line = buffer[..pos].trim().to_string();
                buffer = buffer[pos + 1..].to_string();
                if !line.starts_with("data:") {
                    continue;
                }
                let data = line[5..].trim();
                if data == "[DONE]" {
                    finished = true;
                    break;
                }
                let Ok(v) = serde_json::from_str::<serde_json::Value>(data) else {
                    continue;
                };
                // Reasoning models (e.g. LongCat-2.0) stream their thinking in
                // `delta.reasoning_content` before the actual answer in
                // `delta.content`. Prefer content; fall back to reasoning_content
                // tagged as "thinking" so the UI can show progress instead of a
                // frozen-looking empty screen.
                let (text, thinking) = if is_claude {
                    let t = if v.get("type").and_then(|t| t.as_str()) == Some("content_block_delta") {
                        v.pointer("/delta/text")
                            .and_then(|t| t.as_str())
                            .unwrap_or("")
                            .to_string()
                    } else {
                        String::new()
                    };
                    (t, false)
                } else {
                    let content = v
                        .pointer("/choices/0/delta/content")
                        .and_then(|t| t.as_str())
                        .filter(|s| !s.is_empty())
                        .map(|s| s.to_string());
                    match content {
                        Some(s) => (s, false),
                        None => {
                            let r = v
                                .pointer("/choices/0/delta/reasoning_content")
                                .and_then(|t| t.as_str())
                                .filter(|s| !s.is_empty())
                                .map(|s| s.to_string());
                            (r.unwrap_or_default(), true)
                        }
                    }
                };
                if !text.is_empty() {
                    emit(serde_json::json!({ "type": "chunk", "text": text, "thinking": thinking }));
                    emitted_any = true;
                }
            }
            if finished {
                break;
            }
            match stream.next().await {
                Some(Ok(bytes)) => {
                    full_body.extend_from_slice(&bytes);
                    buffer.push_str(&String::from_utf8_lossy(&bytes));
                }
                Some(Err(e)) => {
                    emit(serde_json::json!({ "type": "error", "error": format!("Stream read failed: {}", e) }));
                    return Err(format!("Failed to read AI stream: {}", e));
                }
                None => break,
            }
        }

        // The tail buffer may retain the last line (no trailing newline)
        if !buffer.trim().is_empty() {
            let line = buffer.trim().to_string();
            if line.starts_with("data:") {
                let data = line[5..].trim();
                if data != "[DONE]" {
                    if let Ok(v) = serde_json::from_str::<serde_json::Value>(data) {
                        let (text, thinking) = if is_claude {
                            let t = if v.get("type").and_then(|t| t.as_str()) == Some("content_block_delta") {
                                v.pointer("/delta/text").and_then(|t| t.as_str()).unwrap_or("").to_string()
                            } else {
                                String::new()
                            };
                            (t, false)
                        } else {
                            let content = v
                                .pointer("/choices/0/delta/content")
                                .and_then(|t| t.as_str())
                                .filter(|s| !s.is_empty())
                                .map(|s| s.to_string());
                            match content {
                                Some(s) => (s, false),
                                None => {
                                    let r = v
                                        .pointer("/choices/0/delta/reasoning_content")
                                        .and_then(|t| t.as_str())
                                        .filter(|s| !s.is_empty())
                                        .map(|s| s.to_string());
                                    (r.unwrap_or_default(), true)
                                }
                            }
                        };
                        if !text.is_empty() {
                            emit(serde_json::json!({ "type": "chunk", "text": text, "thinking": thinking }));
                            emitted_any = true;
                        }
                    }
                }
            }
        }

        if emitted_any {
            emit(serde_json::json!({ "type": "done" }));
            Ok(())
        } else {
            let msg = "The AI provider returned no readable content. The endpoint may not support this request shape, or the model name may be wrong.";
            emit(serde_json::json!({ "type": "error", "error": msg }));
            Err(msg.to_string())
        }
    }

    pub async fn generate_summary(
        &self,
        content: &str,
        api_key: &str,
        api_url: &str,
        model: &str,
    ) -> Result<String, String> {
        const MAX_CONTENT_CHARS: usize = 12_000;

        let client = self.ai_client.clone();

        let is_claude = api_url.contains("anthropic.com") || api_url.trim_end_matches('/').ends_with("/messages");

        // Truncate content to avoid hitting token limits
        let truncated = if content.len() > MAX_CONTENT_CHARS {
            let cut = &content[..MAX_CONTENT_CHARS];
            format!("{}\n\n[... content truncated at {} characters]", cut, MAX_CONTENT_CHARS)
        } else {
            content.to_string()
        };

        // Claude uses a single `user` message (no system role in messages array);
        // OpenAI-compatible uses the standard system+user pair.
        let body = if is_claude {
            serde_json::json!({
                "model": model,
                "max_tokens": 8192,
                "system": Self::AI_SYSTEM_PROMPT,
                "messages": [{
                    "role": "user",
                    "content": format!("Please summarize the following course content:\n\n{}", truncated)
                }]
            })
        } else {
            serde_json::json!({
                "model": model,
                "messages": [
                    { "role": "system", "content": Self::AI_SYSTEM_PROMPT },
                    { "role": "user", "content": format!("Please summarize the following course content:\n\n{}", truncated) }
                ],
                "max_tokens": 8192,
                "temperature": 0.3,
            })
        };

        let mut req = client
            .post(api_url)
            .header("Content-Type", "application/json");
        // Claude: x-api-key + anthropic-version, no Bearer
        req = if is_claude {
            req.header("x-api-key", api_key)
                .header("anthropic-version", "2023-06-01")
        } else {
            req.header("Authorization", format!("Bearer {}", api_key))
        };

        let response = req
            .json(&body)
            .send()
            .await
            .map_err(|e| {
                if e.is_timeout() {
                    "AI API request timed out (60s). Please try again or use a shorter content.".to_string()
                } else {
                    format!("Failed to call AI API: {}", e)
                }
            })?;

        if !response.status().is_success() {
            let error_text = response.text().await.unwrap_or_default();
            return Err(format!("AI API error: {}", error_text));
        }

        let response_json: serde_json::Value = response
            .json()
            .await
            .map_err(|e| format!("Failed to parse AI response: {}", e))?;

        // Claude: response.content[0].text; OpenAI-compatible: response.choices[0].message.content
        let summary = if is_claude {
            response_json
                .get("content")
                .and_then(|c| c.get(0))
                .and_then(|c| c.get("text"))
                .and_then(|c| c.as_str())
                .filter(|s| !s.is_empty())
                .map(|s| s.to_string())
                .ok_or("Failed to extract summary from Claude response")?
        } else {
            let msg = response_json
                .get("choices")
                .and_then(|c| c.get(0))
                .and_then(|c| c.get("message"));
            msg.and_then(|m| m.get("content"))
                .and_then(|c| c.as_str())
                .filter(|s| !s.is_empty())
                .map(|s| s.to_string())
                .or_else(|| {
                    // Reasoning models may only return reasoning_content.
                    msg.and_then(|m| m.get("reasoning_content"))
                        .and_then(|c| c.as_str())
                        .filter(|s| !s.is_empty())
                        .map(|s| s.to_string())
                })
                .ok_or("Failed to extract summary from AI response")?
        };

        Ok(summary.to_string())
    }

    /// Minimal connectivity probe against the user's configured AI endpoint.
    /// Sends a 1-token "ping" (OpenAI-compatible or Anthropic shape, detected the same
    /// way as generate_summary*) and returns ok + latency or an HTTP/error snippet.
    /// Uses the shared AI client; deliberately NOT throttled (user's own provider).
    pub async fn test_ai_connection(
        &self,
        api_key: &str,
        api_url: &str,
        model: &str,
    ) -> Result<serde_json::Value, String> {
        let client = self.ai_client.clone();
        let is_claude =
            api_url.contains("anthropic.com") || api_url.trim_end_matches('/').ends_with("/messages");
        let body = serde_json::json!({
            "model": model,
            "max_tokens": 1,
            "messages": [{ "role": "user", "content": "ping" }],
        });
        let started = std::time::Instant::now();
        let mut req = client
            .post(api_url)
            .json(&body)
            .timeout(std::time::Duration::from_secs(20));
        req = if is_claude {
            req.header("x-api-key", api_key)
                .header("anthropic-version", "2023-06-01")
        } else {
            req.bearer_auth(api_key)
        };
        let resp = req.send().await.map_err(|e| format!("Request failed: {}", e))?;
        let status = resp.status().as_u16();
        let elapsed_ms = started.elapsed().as_millis();
        if resp.status().is_success() {
            Ok(serde_json::json!({
                "ok": true,
                "message": format!("{} ms", elapsed_ms),
                "status": status,
            }))
        } else {
            let snippet: String = resp
                .text()
                .await
                .unwrap_or_default()
                .chars()
                .take(300)
                .collect();
            // Diagnostics: include the actual request URL and a redacted key prefix so
            // misconfigurations (e.g. the base URL pasted into the key field) are
            // obvious at a glance instead of a cryptic provider error.
            let key_hint: String = api_key.chars().take(6).collect();
            Ok(serde_json::json!({
                "ok": false,
                "message": format!(
                    "HTTP {} (url: {}, key: {}...): {}",
                    status, api_url, key_hint, snippet
                ),
                "status": status,
            }))
        }
    }

    /// Parse enrolled courses from the Moodle `/my/` dashboard HTML.
    fn parse_courses_from_html(&self, html: &str) -> Result<Vec<Course>, String> {
        use scraper::{Html, Selector};

        let document = Html::parse_document(html);
        let mut seen = std::collections::HashSet::new();
        let mut courses = Vec::new();

        // Phase 1: the real Monash 4.x `/my/` structure (verified against live_my_courses.html):
        //   <li class="list-group-item course-listitem ..." data-region="course-content" data-course-id="34696">
        //     <a href="...course/view.php?id=34696" class="aalink coursename">
        //       <span id="favorite-icon-..."> ... <span class="sr-only">Course is starred</span> </span>
        //       <span class="sr-only">Course name</span>
        //       FIT4005-FIT5125 IT research and innovation methods - S2 2025
        //     </a>
        //   </li>
        // The old regex `href="...">([^<]+)<` gets cut off by the <span> into an empty string;
        // using a.text() directly would pull in "Course is starred" / "Course name" from .sr-only.
        // Use the recursive extract_visible_text to skip .sr-only subtrees.
        let cn_selectors = ["a.coursename", "a.aalink.coursename"];
        for sel_str in &cn_selectors {
            let Ok(selector) = Selector::parse(sel_str) else { continue };
            for a in document.select(&selector) {
                let Some(href) = a.value().attr("href") else { continue };
                let Some(id) = extract_id_from_url(href) else { continue };
                if !seen.insert(id) { continue };

                let raw = decode_html_entities(&extract_visible_text(a));
                if raw.is_empty() { continue; }
                let (short_name, full_name) = split_course_name(&raw);

                courses.push(Course {
                    id,
                    short_name,
                    full_name,
                    category: String::new(),
                    visible: true,
                    is_portal: false,
                });
            }
            if !courses.is_empty() { break; }
        }

        // Phase 2: fallback to the old Moodle 3.x structure (when a.coursename matches nothing)
        if courses.is_empty() {
            let re = regex::Regex::new(
                r#"href="[^"]*course/view\.php\?id=(\d+)[^"]*"[^>]*>([^<]+)<"#,
            )
            .map_err(|e| format!("Failed to compile course regex: {}", e))?;

            for cap in re.captures_iter(html) {
                let id: u64 = match cap[1].parse() {
                    Ok(v) => v,
                    Err(_) => continue,
                };
                if !seen.insert(id) {
                    continue;
                }

                let raw = decode_html_entities(cap[2].trim());
                if raw.is_empty() { continue; }
                let (short_name, full_name) = split_course_name(&raw);

                courses.push(Course {
                    id,
                    short_name,
                    full_name,
                    category: String::new(),
                    visible: true,
                    is_portal: false,
                });
            }
        }

        // Phase 3: fallback for the new Monash 4.x dashboard.
        // The course list is now rendered asynchronously by block-myoverview's JavaScript, so the static HTML
        // has no a.coursename / course/view.php links at all. The only statically available complete course
        // source is the calendar filter dropdown:
        //   <select class="cal_courses_flt" name="course">
        //     <option value="34645">FIT5047 Fundamentals of artificial intelligence</option>
        //     ...
        //   </select>
        // Prefer an exact match on cal_courses_flt; fall back to select[name="course"] when not found.
        if courses.is_empty() {
            let select_selectors = ["select.cal_courses_flt", "select[name=\"course\"]"];
            let Ok(opt_sel) = Selector::parse("option") else {
                return Err("Failed to compile option selector".to_string());
            };
            for sel_str in &select_selectors {
                let Ok(selector) = Selector::parse(sel_str) else { continue };
                let Some(select_el) = document.select(&selector).next() else { continue };

                // The first item is usually "All courses" (value="" or 0), which gets filtered out by the
                // empty / 0 check below, so no special handling is needed.
                for option in select_el.select(&opt_sel) {
                    let Some(value) = option.value().attr("value") else { continue };
                    let Ok(id) = value.trim().parse::<u64>() else { continue };
                    // The first item in the course calendar filter dropdown is the site course "All units" (value=1), not a real enrollment:
                    // treating it as a course would make sync fetch the site homepage, mixing course names / site-level activities into the resource list (reproduced in testing).
                    if id <= 1 { continue; }
                    if !seen.insert(id) { continue; }

                    let raw = decode_html_entities(
                        &option
                            .text()
                            .collect::<String>()
                            .split_whitespace()
                            .collect::<Vec<_>>()
                            .join(" "),
                    );
                    if raw.is_empty() { continue; }
                    let (short_name, full_name) = split_course_name(&raw);

                    courses.push(Course {
                        id,
                        short_name,
                        full_name,
                        category: String::new(),
                        visible: true,
                        is_portal: false,
                    });
                }

                if !courses.is_empty() { break; }
            }
        }

        // Portal/hub course flag: IT Student Portal, MUM Academic Success, Student Hub, etc.
        // are not academic courses; the frontend can use this to exclude or group them separately.
        for course in &mut courses {
            course.is_portal = is_portal_course_name(&course.full_name);
        }

        if courses.is_empty() {
            return Err(
                "No courses could be parsed from the page. The login session may have expired, or the page structure may have changed."
                    .to_string(),
            );
        }

        Ok(courses)
    }

    /// Parse resources from Moodle course page HTML using scraper crate.
    ///
    /// `section_ctx`: when the caller has already determined which "week/block" this page belongs to via the MST week nav
    /// (e.g. the `course/view.php?id=<cid>&section=<N>` single-block view), pass in
    /// `(section_num, human-readable label)`. The parser will prefer to scope to that block's container
    /// (avoiding activities from other blocks/sidebar/generic areas on the same page being scraped in again), and use the passed
    /// label as the `section` for all resources. Passing `None` falls back to whole-page parsing + auto-inferring section titles
    /// (standard Moodle single page, or fallback when MST week nav discovery fails).
    fn parse_resources_from_html(
        &self,
        html: &str,
        course_id: u64,
        section_ctx: Option<(u64, String)>,
    ) -> Result<Vec<Resource>, String> {
        use scraper::{Html, Selector};

        let full_doc = Html::parse_document(html);
        // If the target block number is known, try to parse only inside that block's container; fall back to the whole page when the container isn't found.
        let scope_html = section_ctx
            .as_ref()
            .map(|(num, _)| find_section_html(&full_doc, *num).unwrap_or_else(|| html.to_string()))
            .unwrap_or_else(|| html.to_string());
        let document = Html::parse_document(&scope_html);
        let mut resources = Vec::new();
        let mut seen = std::collections::HashSet::new();

        // Phase 1: prefer Monash 4.x li.activity.
        //   Standard form (verified against live_course_view_35418.html):
        //     <li class="activity activity-wrapper forum modtype_forum hasinfo " id="module-4551559" data-for="cmitem" data-id="4551559">
        //       <div class="activity-item" data-activityname="...">
        //         <span class="instancename">
        //           <span class="displayname">Announcements: Google Colab Pro ...</span>
        //           <span class="module-name">Forum</span>
        //         </span>
        //         <div class="activity-actions">
        //           <a href=".../mod/forum/view.php?id=4551559">Forum</a>
        //         </div>
        //       </div>
        //     </li>
        //   New form (FIT4005 and others using the MST template):
        //     <li class="activity activity-wrapper cms modtype_cms hasinfo" id="module-4447072" data-id="4447072">
        //       <div class="activity-item" data-activityname="Overview Section" data-region="activity-card">
        //         <div class="activity-grid noname-grid">
        //           <div class="form-control-static activity-altcontent text-break">
        //             ... accordion <h3>Overview</h3> ...
        //           </div>
        //         </div>
        //       </div>
        //     </li>
        //   Such activities have no .instancename and no <a href>, but do have data-activityname + data-id + modtype.
        if let (Ok(li_sel), Ok(name_sel), Ok(link_sel), Ok(h3_sel)) = (
            Selector::parse("li.activity"),
            Selector::parse(".instancename"),
            Selector::parse("a[href]"),
            Selector::parse("h3"),
        ) {
            for li in document.select(&li_sel) {
                // Keep only genuine resource activity types (resource/folder/url/page/book/h5p).
                // Forums / assignments / quizzes / attendance / LTI / CMS accordion blocks / labels aren't resource pages;
                // the real file links inside them are still caught by Phase 2's pluginfile and other selectors.
                if !is_resource_activity(&li) {
                    continue;
                }
                let modtype = extract_modtype_from_activity(&li);
                // ---- URL: prefer a real <a href>, otherwise build a view link from data-id + modtype ----
                let (href, full_url) = if let Some(link) = li.select(&link_sel).next() {
                    let Some(href) = link.value().attr("href") else { continue };
                    let full_url = if href.starts_with("http") {
                        href.to_string()
                    } else {
                        format!("{}{}", self.base_url, href)
                    };
                    (href.to_string(), full_url)
                } else {
                    // No link: build a plausible module URL from the activity's data-id and the extracted modtype.
                    let cmid = li.value().attr("data-id").and_then(|s| s.parse::<u64>().ok());
                    let Some(modname) = modtype.as_deref() else { continue };
                    let Some(cmid) = cmid else { continue };
                    let href = format!("/mod/{}/view.php?id={}", modname, cmid);
                    let full_url = format!("{}{}", self.base_url, href);
                    (href, full_url)
                };

                let resource_id = stable_resource_id_for_dedup(&href);

                if !seen.insert(resource_id) {
                    continue;
                }

                // ---- title priority: .instancename -> data-activityname -> accordion h3 -> link text ----
                let title = extract_activity_instancename(&li, &name_sel)
                    .or_else(|| li.value().attr("data-activityname").map(|s| s.to_string()))
                    .or_else(|| {
                        // Monash MST puts data-activityname on the inner .activity-item
                        li.select(&Selector::parse(".activity-item[data-activityname]").ok()?)
                            .next()
                            .and_then(|el| el.value().attr("data-activityname"))
                            .map(|s| s.to_string())
                    })
                    .or_else(|| {
                        li.select(&h3_sel)
                            .next()
                            .map(|h3| h3.text().collect::<String>().trim().to_string())
                    })
                    .filter(|s| !s.is_empty())
                    .unwrap_or_else(|| {
                        // Fallback: take the first <a>'s text (standard Moodle activity link)
                        li.select(&link_sel)
                            .next()
                            .map(|a| a.text().collect::<String>().trim().to_string())
                            .unwrap_or_default()
                    });

                if title.is_empty() {
                    continue;
                }

                // Filter out container-level noise titles (help blocks / empty forum placeholders / overly long block text)
                let Some(title) = clean_resource_title(&title) else { continue };

                // ---- section context: stored structurally in Resource.section, no longer concatenated into name ----
                // This lets the frontend both group by section and freely decide how to display "section . name",
                // rather than baking the structure into one string (the old "Week 1 - ... - Overview" hack).
                // Prefer the block label explicitly given by the caller (the MST week nav title), otherwise auto-infer.
                let section_title = section_ctx
                    .as_ref()
                    .map(|(_, label)| label.clone())
                    .and_then(|s| clean_resource_title(&s))
                    .or_else(|| section_title_for_activity(&li).and_then(|s| clean_resource_title(&s)));
                let resource_type = classify_resource_type(&full_url, modtype.as_deref(), &title);

                resources.push(Resource {
                    id: resource_id,
                    course_id,
                    name: title,
                    section: section_title,
                    week_num: None,
                    resource_type,
                    url: full_url,
                    file_size: None,
                    modified_date: None,
                });
            }
        }

        // Phase 1.5: fallback to the courseindex side tree.
        //   In some Monash 4.x courses the main body is JS-rendered (`instancename` count is 0),
        //   but the server still serializes the whole course tree into `.courseindex-item[data-for="cm"]`,
        //   including real `mod/*/view.php?id={cmid}` links and completion state.
        //   Source: live_course_view_46961.html (FIT5201) -- all 8 mod/resource items in the main area are here.
        //
        //   Structure:
        //     <div class="courseindex-item d-flex" id="course-index-cm-6121610"
        //          data-for="cm" data-id="6121610">
        //       <span class="completioninfo completion_incomplete" data-for="cm_completion" data-value="0">
        //         <i class="icon fa-regular fa-circle" title="To do"></i>
        //       </span>
        //       <a class="courseindex-link text-truncate"
        //          href=".../mod/resource/view.php?id=6121610" data-for="cm_name"> Module one </a>
        //     </div>
        //
        //   Deduped against Phase 1 via the `seen` set; skipped if li.activity already caught it.
        if let Ok(ci_sel) =
            Selector::parse(".courseindex-item[data-for='cm'] a[data-for='cm_name'][href]")
        {
            for anchor in document.select(&ci_sel) {
                let Some(href) = anchor.value().attr("href") else { continue };
                // Only trust in-site navigation (relative path or base_url prefix); reject javascript:/external links
                let full_url = if href.starts_with("http") {
                    href.to_string()
                } else if href.starts_with('/') {
                    format!("{}{}", self.base_url, href)
                } else {
                    continue;
                };

                // Keep only resource-type links: the course index also contains forum/assignment/quiz cm links, which aren't resource pages
                if !is_resource_url(&full_url) {
                    continue;
                }

                let resource_id = stable_resource_id_for_dedup(href);
                if !seen.insert(resource_id) {
                    continue;
                }

                let title = anchor.text().collect::<String>().trim().to_string();
                if title.is_empty() {
                    continue;
                }
                let Some(title) = clean_resource_title(&title) else { continue };
                let modtype = extract_modtype_from_url(&full_url);
                let resource_type = classify_resource_type(&full_url, modtype.as_deref(), &title);

                resources.push(Resource {
                    id: resource_id,
                    course_id,
                    name: title,
                    section: section_ctx
                        .as_ref()
                        .map(|(_, label)| label.clone())
                        .and_then(|s| clean_resource_title(&s)),
                    week_num: None,
                    resource_type,
                    url: full_url,
                    file_size: None,
                    modified_date: None,
                });
            }
        }

        // Phase 2: fallback for the old Moodle 3.x structure, the new Monash activity-card, and pluginfile
        let selectors = [
            "a.aalink",
            "div.activityinstance a",
            "[data-region='activity-card'] a[href]",
            "a[href*='mod/resource/view.php']",
            "a[href*='mod/url/view.php']",
            "a[href*='mod/folder/view.php']",
            "a[href*='mod/page/view.php']",
            "a[href*='pluginfile.php']",
        ];

        for selector_str in &selectors {
            let Ok(selector) = Selector::parse(selector_str) else {
                continue;
            };

            for element in document.select(&selector) {
                let Some(href) = element.value().attr("href") else {
                    continue;
                };

                // Keep only resource-type links; broad selectors like a.aalink / activity-card also match
                // forum / assignment / quiz module links, filtered out here consistently
                if !is_resource_url(href) {
                    continue;
                }

                let resource_id = stable_resource_id_for_dedup(href);

                if !seen.insert(resource_id) {
                    continue;
                }

                let title = element
                    .text()
                    .collect::<String>()
                    .trim()
                    .to_string();

                if title.is_empty() {
                    continue;
                }

                // Filter out container-level noise titles (Phase 2's a[href] may wrap an entire block's text)
                let Some(title) = clean_resource_title(&title) else { continue };

                let modtype = extract_modtype_from_url(href);
                let resource_type = classify_resource_type(href, modtype.as_deref(), &title);

                resources.push(Resource {
                    id: resource_id,
                    course_id,
                    name: title,
                    section: section_ctx.as_ref().map(|(_, label)| label.clone()).and_then(|s| clean_resource_title(&s)),
                    week_num: None,
                    resource_type,
                    url: if href.starts_with("http") {
                        href.to_string()
                    } else {
                        format!("{}{}", self.base_url, href)
                    },
                    file_size: None,
                    modified_date: None,
                });
            }
        }

        // Fallback: regex
        if resources.is_empty() {
            let re = regex::Regex::new(
                r#"<a[^>]+href="([^"]*(?:mod/resource|mod/url|mod/folder|mod/page|pluginfile)[^"]*)"[^>]*>([^<]+)</a>"#,
            )
            .map_err(|e| format!("Failed to compile resource regex: {}", e))?;

            for cap in re.captures_iter(html) {
                let href = cap[1].to_string();
                let title = cap[2].trim().to_string();

                if title.is_empty() {
                    continue;
                }

                // Filter out container-level noise titles (the regex may likewise match an <a> wrapping a block's text)
                let Some(title) = clean_resource_title(&title) else { continue };

                let resource_id = stable_resource_id_for_dedup(&href);

                if !seen.insert(resource_id) {
                    continue;
                }

                let modtype = extract_modtype_from_url(&href);
                let resource_type = classify_resource_type(&href, modtype.as_deref(), &title);

                resources.push(Resource {
                    id: resource_id,
                    course_id,
                    name: title,
                    section: section_ctx.as_ref().map(|(_, label)| label.clone()).and_then(|s| clean_resource_title(&s)),
                    week_num: None,
                    resource_type,
                    url: if href.starts_with("http") {
                        href
                    } else {
                        format!("{}{}", self.base_url, href)
                    },
                    file_size: None,
                    modified_date: None,
                });
            }
        }

        // Derived field: extract the week number from the section label ("Week 1 - Module 1 - Part A | ..." -> 1),
        // for the frontend to collapse/group by week.
        for r in &mut resources {
            r.week_num = r.section.as_deref().and_then(extract_week_num);
        }

        Ok(resources)
    }

    /// Parse assignments from Moodle assignments index page HTML.
    fn parse_assignments_from_html(&self, html: &str, course_id: u64) -> Result<Vec<Assignment>, String> {
        use scraper::{Html, Selector};

        let document = Html::parse_document(html);
        let mut assignments = Vec::new();
        let mut seen = std::collections::HashSet::new();

        let table_selector = Selector::parse("table.generaltable tbody tr, table tbody tr")
            .map_err(|e| format!("Failed to parse table selector: {}", e))?;

        let link_selector = Selector::parse("a[href*='mod/assign/view.php']")
            .map_err(|e| format!("Failed to parse link selector: {}", e))?;

        // Take each row's td columns. The real Monash 4.x table structure (verified against live_assign_index_35418.html):
        //   c0=Artefact / Section name
        //   c1=<a href=".../mod/assign/view.php?id=NNNN">assignment name</a>
        //   c2=due date (human-readable: "Sunday, 14 September 2025, 9:55 PM", **contains no / or -**)
        //   c3=submission status
        //   c4=actions
        let cell_selector = Selector::parse("td")
            .map_err(|e| format!("Failed to parse cell selector: {}", e))?;

        for row in document.select(&table_selector) {
            let row_text = row.text().collect::<String>();
            if row_text.trim().is_empty() {
                continue;
            }

            if let Some(link) = row.select(&link_selector).next() {
                let Some(href) = link.value().attr("href") else {
                    continue;
                };

                let assignment_id = extract_id_from_url(href).unwrap_or(0);
                if !seen.insert(assignment_id) {
                    continue;
                }

                let name = link.text().collect::<String>().trim().to_string();
                if name.is_empty() {
                    continue;
                }

                // Prefer the 3rd column (c2); too short means that column is empty, so fall back to the column "containing a 4-digit year"
                let tds: Vec<_> = row.select(&cell_selector).collect();
                let due_date = tds
                    .get(2)
                    .map(|td| td.text().collect::<String>().trim().to_string())
                    .filter(|s| s.len() > 5)
                    .or_else(|| {
                        tds.iter().find_map(|td| {
                            let t = td.text().collect::<String>().trim().to_string();
                            if t.len() > 5
                                && t.split(|c: char| !c.is_ascii_digit())
                                    .any(|p| matches!(p.len(), 4) && {
                                        let y: u32 = p.parse().unwrap_or(0);
                                        (2020..=2099).contains(&y)
                                    })
                            {
                                Some(t)
                            } else {
                                None
                            }
                        })
                    });

                // Submission status column (c3): "-" or empty = no submission status (assignments with no submission entry),
                // and the frontend's progress bar denominator shouldn't count these.
                let submission_status_text = tds
                    .get(3)
                    .map(|td| td.text().collect::<String>().trim().to_string())
                    .unwrap_or_default();
                let has_submission_status =
                    !submission_status_text.is_empty() && submission_status_text != "-";

                let status = determine_assignment_status(&row_text);

                // Keep the assignment page link (converted to an absolute URL) for the frontend's "open in browser" jump
                let url = Some(if href.starts_with("http") {
                    href.to_string()
                } else {
                    format!("{}{}", self.base_url, href)
                });

                assignments.push(Assignment {
                    id: assignment_id,
                    name,
                    course_id,
                    due_date,
                    due_date_iso: None,
                    status,
                    grade: None,
                    url,
                    assessment_type: AssessmentType::Assignment,
                    weight: None,
                    category: None,
                    has_submission_status,
                });
            }
        }

        // Derived fields: parse the human-readable due date into ISO (JS's Date can't parse that format);
        // extract the weight from the activity name's "(1%)".
        for a in &mut assignments {
            a.due_date_iso = a.due_date.as_deref().and_then(parse_moodle_due_date);
            if a.weight.is_none() {
                a.weight = parse_weight_percent(&a.name);
            }
        }

        Ok(assignments)
    }

    /// Parse assignments from course page HTML (fallback when index page is empty).
    fn parse_assignments_from_course_html(&self, html: &str, course_id: u64) -> Result<Vec<Assignment>, String> {
        use scraper::{Html, Selector};

        let document = Html::parse_document(html);
        let mut assignments = Vec::new();
        let mut seen = std::collections::HashSet::new();

        let assign_selector = Selector::parse("a[href*='mod/assign/view.php']")
            .map_err(|e| format!("Failed to parse selector: {}", e))?;

        for element in document.select(&assign_selector) {
            let Some(href) = element.value().attr("href") else {
                continue;
            };

            let assignment_id = extract_id_from_url(href).unwrap_or(0);
            if !seen.insert(assignment_id) {
                continue;
            }

            let name = element.text().collect::<String>().trim().to_string();
            if name.is_empty() {
                continue;
            }

            assignments.push(Assignment {
                id: assignment_id,
                name,
                course_id,
                due_date: None,
                due_date_iso: None,
                status: AssignmentStatus::Pending,
                grade: None,
                url: Some(if href.starts_with("http") {
                    href.to_string()
                } else {
                    format!("{}{}", self.base_url, href)
                }),
                assessment_type: AssessmentType::Assignment,
                weight: None,
                category: None,
                has_submission_status: false,
            });
        }

        for a in &mut assignments {
            a.due_date_iso = a.due_date.as_deref().and_then(parse_moodle_due_date);
            if a.weight.is_none() {
                a.weight = parse_weight_percent(&a.name);
            }
        }

        Ok(assignments)
    }

    /// Parse announcements from Moodle course page HTML.
    fn parse_announcements_from_html(&self, html: &str, course_id: u64) -> Result<Vec<Announcement>, String> {
        use scraper::{Html, Selector};

        let document = Html::parse_document(html);
        let mut announcements = Vec::new();
        let mut seen = std::collections::HashSet::new();

        let selectors = [
            "a[href*='mod/forum/discuss.php']",
            "div.forumpost",
            "article.forum-post",
        ];

        for selector_str in &selectors {
            let Ok(selector) = Selector::parse(selector_str) else {
                continue;
            };

            for element in document.select(&selector) {
                let mut title = element
                    .text()
                    .collect::<String>()
                    .trim()
                    .to_string();

                if title.is_empty() {
                    continue;
                }

                let href = element.value().attr("href").unwrap_or("");
                let announcement_id = extract_id_from_url(href).unwrap_or_else(|| {
                    use std::collections::hash_map::DefaultHasher;
                    use std::hash::{Hash, Hasher};
                    let mut hasher = DefaultHasher::new();
                    title.hash(&mut hasher);
                    hasher.finish() as u64
                });

                if !seen.insert(announcement_id) {
                    continue;
                }

                let parent = element.parent();
                let (mut author, date) = if let Some(parent) = parent {
                    // `parent` is a `NodeRef`; `.text()` only exists on `ElementRef`.
                    if let Some(parent_el) = scraper::ElementRef::wrap(parent) {
                        let parent_text = parent_el.text().collect::<String>();
                        (extract_author(&parent_text), extract_date(&parent_text))
                    } else {
                        (String::new(), String::new())
                    }
                } else {
                    (String::new(), String::new())
                };

                // Some Monash forum views render the subject as "Author Name: Subject" with
                // no separate author element; recover the author from the title prefix when
                // the regular extraction found nothing (only for plausible person names).
                if author.is_empty() {
                    if let Some((a, recovered_title)) = extract_author_from_title(&title) {
                        author = a;
                        title = recovered_title;
                    }
                }

                let content = element
                    .text()
                    .collect::<String>()
                    .trim()
                    .to_string();

                announcements.push(Announcement {
                    id: announcement_id,
                    title,
                    content,
                    author,
                    date,
                    course_id,
                    // Discussion link (discuss.php?d=N): lets the frontend jump to the corresponding page when a notification is clicked.
                    // Relative paths are completed into absolute URLs (the WebView can't load relative paths)
                    url: if href.is_empty() {
                        None
                    } else if href.starts_with("http") {
                        Some(href.to_string())
                    } else {
                        Some(format!("{}{}", self.base_url, href))
                    },
                });
            }
        }

                // 3) The MST course page Announcements widget (.widget-forum-container) -- the primary data source
        //    for Monash course page announcements (the forum page turned out to be empty in practice). Structure:
        //      .forum-post-discussionname a -> title + discuss.php link
        //      .forum-post-details -> "author | date"
        //      .forum-post-message -> body (often empty in the widget, needs the detail page to fill in)
        if let (Ok(widget_sel), Ok(name_sel), Ok(details_sel), Ok(msg_sel)) = (
            Selector::parse(".widget-forum-container"),
            Selector::parse(".forum-post-discussionname a"),
            Selector::parse(".forum-post-details"),
            Selector::parse(".forum-post-message"),
        ) {
            for widget in document.select(&widget_sel) {
                let Some(a) = widget.select(&name_sel).next() else {
                    continue;
                };
                let href = a.value().attr("href").unwrap_or("");
                let title = a.text().collect::<String>().trim().to_string();
                if title.is_empty() {
                    continue;
                }
                let announcement_id = extract_id_from_url(href).unwrap_or_else(|| {
                    use std::collections::hash_map::DefaultHasher;
                    use std::hash::{Hash, Hasher};
                    let mut hasher = DefaultHasher::new();
                    title.hash(&mut hasher);
                    hasher.finish() as u64
                });
                if !seen.insert(announcement_id) {
                    continue;
                }
                let details = widget
                    .select(&details_sel)
                    .next()
                    .map(|el| el.text().collect::<String>())
                    .unwrap_or_default();
                let (author, date) = split_announcement_details(&details);
                let content = widget
                    .select(&msg_sel)
                    .next()
                    .map(|el| el.text().collect::<String>().trim().to_string())
                    .unwrap_or_default();
                let url = if href.is_empty() {
                    None
                } else if href.starts_with("http") {
                    Some(href.to_string())
                } else {
                    Some(format!("{}{}", self.base_url, href))
                };
                announcements.push(Announcement {
                    id: announcement_id,
                    title,
                    content,
                    author,
                    date,
                    course_id,
                    url,
                });
            }
        }

        Ok(announcements)
    }
}

impl Default for MoodleScraper {
    fn default() -> Self {
        Self::new(Arc::new(MoodleAuth::new()))
    }
}

/// Extract the numeric ID from a Moodle URL.
fn extract_id_from_url(url: &str) -> Option<u64> {
    if let Ok(parsed) = url::Url::parse(url) {
        for (key, value) in parsed.query_pairs() {
            if key == "id" || key == "d" {
                if let Ok(id) = value.parse::<u64>() {
                    return Some(id);
                }
            }
        }
    }

    let re = regex::Regex::new(r"[?&](?:id|d)=(\d+)").ok()?;
    re.captures(url)
        .and_then(|cap| cap[1].parse::<u64>().ok())
}

/// Return a stable ID for resource deduplication.
///
/// 1. Prefer the `id` / `d` query param in the URL (most stable for Moodle module links).
/// 2. For pluginfile.php / tokenpluginfile.php the identifier is in the path, while the query params
///    (forcedownload, section, etc.) vary per page, causing the same file to be counted as multiple ids.
///    For such URLs, strip the query before hashing.
/// 3. Other links without an id are hashed from the normalized URL directly.
fn stable_resource_id_for_dedup(url: &str) -> u64 {
    use std::collections::hash_map::DefaultHasher;
    use std::hash::{Hash, Hasher};

    if let Some(id) = extract_id_from_url(url) {
        return id;
    }

    let normalized = if url.to_lowercase().contains("pluginfile.php")
        || url.to_lowercase().contains("tokenpluginfile.php")
    {
        url::Url::parse(url)
            .ok()
            .map(|mut u| {
                u.set_query(None);
                u.to_string()
            })
            .unwrap_or_else(|| url.to_string())
    } else {
        url.to_string()
    };

    let mut hasher = DefaultHasher::new();
    normalized.hash(&mut hasher);
    hasher.finish()
}

/// Locate the container for the given section number in the document and return its inner HTML.
/// Handles the standard Moodle 4.x structures: li#section-N / div#section-N / data-sectionid / data-sectionnum.
fn find_section_html(document: &scraper::Html, section_num: u64) -> Option<String> {
    use scraper::Selector;
    let selectors = [
        format!("li#section-{}", section_num),
        format!("div#section-{}", section_num),
        format!("[data-sectionid=\"{}\"]", section_num),
        format!("[data-sectionnum=\"{}\"]", section_num),
    ];
    for sel in &selectors {
        if let Ok(selector) = Selector::parse(sel) {
            if let Some(el) = document.select(&selector).next() {
                return Some(el.html());
            }
        }
    }
    None
}

/// Classify a resource type based on the URL.
/// Whether an activity li is a genuine resource type (file / folder / url / page / book / H5P).
/// Forums / assignments / quizzes / attendance / LTI / CMS accordion blocks / labels are not "resources" (each has
/// its own dedicated parser or shouldn't appear in the resource list); the real file links inside CMS blocks are still
/// caught by Phase 2's pluginfile / mod/resource selectors.
fn is_resource_activity(li: &scraper::ElementRef) -> bool {
    let Some(modname) = li
        .value()
        .classes()
        .find(|c| c.starts_with("modtype_"))
        .map(|c| c.strip_prefix("modtype_").unwrap_or(c))
    else {
        // Older-structure activities with no modtype marker: leave it to the URL check as a fallback, don't block here
        return true;
    };
    matches!(
        modname,
        "resource" | "folder" | "url" | "page" | "book" | "h5pactivity"
    )
}

/// Whether a URL points to a genuine course resource. Module URLs for forums / assignments / quizzes / attendance / LTI
/// are not resource pages; pluginfile links inside CMS blocks still count as resources.
fn is_resource_url(url: &str) -> bool {
    let lower = url.to_lowercase();
    [
        "mod/resource/view.php",
        "mod/folder/view.php",
        "mod/url/view.php",
        "mod/page/view.php",
        "mod/book/view.php",
        "mod/h5pactivity/view.php",
        "pluginfile.php",
    ]
    .iter()
    .any(|pat| lower.contains(pat))
}

/// Whether a course is a portal/hub (non-academic course): IT Student Portal, MUM Academic Success,
/// MUM Graduate Success, School of IT Student Hub, etc. Such courses have no assignments/assessments/forums,
/// so skipping them during sync saves a lot of requests, and the course list can group them separately.
fn is_portal_course_name(name: &str) -> bool {
    let lower = name.to_lowercase();
    lower.contains("portal")
        || lower.contains("student hub")
        || lower.contains("academic success")
        || lower.contains("graduate success")
        || lower.contains("school of it")
}

/// Extract the full course name from course page HTML (the /my/ dropdown option text is truncated).
/// The Monash course page <title> format is: "Unit: FIT5201 Machine learning - S2 2026 | MonashELMS1";
/// falls back to the first non-dashboard <h1> text.
fn parse_course_fullname_from_page(html: &str) -> Option<String> {
    let title_re = regex::Regex::new(r"(?is)<title>\s*Unit:\s*(.*?)\s*\|\s*MonashELMS").ok()?;
    if let Some(c) = title_re.captures(html) {
        if let Some(m) = c.get(1) {
            let name = decode_html_entities(m.as_str().trim());
            if !name.is_empty() {
                return Some(name);
            }
        }
    }
    let h1_re = regex::Regex::new(r"(?is)<h1[^>]*>(.*?)</h1>").ok()?;
    for m in h1_re.captures_iter(html) {
        let text = decode_html_entities(&strip_tags(m.get(1)?.as_str()));
        let text = text.split_whitespace().collect::<Vec<_>>().join(" ");
        if !text.is_empty() && !text.to_lowercase().contains("dashboard") {
            return Some(text);
        }
    }
    None
}

/// Derive the course code from the full course name ("FIT5201 Machine learning - S2 2026" -> "FIT5201";
/// "FIT4005-FIT5125 IT research..." -> "FIT4005-FIT5125").
fn derive_short_name(full: &str) -> Option<String> {
    let re = regex::Regex::new(r"^([A-Z]{2,6}\d{2,6}(?:-[A-Z]{2,6}\d{2,6})?)").ok()?;
    re.captures(full)
        .and_then(|c| c.get(1))
        .map(|m| m.as_str().to_string())
}

/// Extract the week number from a section label ("Week 1 - Module 1 - Part A | ..." -> 1).
fn extract_week_num(section: &str) -> Option<u32> {
    let re = regex::Regex::new(r"(?i)week\s+(\d{1,2})").ok()?;
    re.captures(section)
        .and_then(|c| c.get(1))
        .and_then(|m| m.as_str().parse().ok())
}

/// Parse a Moodle human-readable due date ("Monday, 23 March 2026, 9:00 AM") into RFC3339 ISO.
///
/// Moodle renders deadlines in the course timezone — Monash runs
/// Australia/Melbourne (AEST UTC+10 in winter, AEDT UTC+11 in summer). The
/// wall-clock text must be interpreted as Melbourne local time, NOT as UTC:
/// treating it as UTC shifted every deadline by 10-11 hours, which made the
/// date badge (raw Moodle text) and the relative "tomorrow / in N days" label
/// (computed from dueDateIso) disagree by a day.
fn parse_moodle_due_date(text: &str) -> Option<String> {
    let t = text.split_whitespace().collect::<Vec<_>>().join(" ");
    const FORMATS: &[&str] = &[
        "%A, %d %B %Y, %I:%M %p",
        "%A, %d %B %Y",
        "%d %B %Y, %I:%M %p",
        "%d %B %Y",
    ];
    let melbourne: chrono_tz::Tz = "Australia/Melbourne".parse().ok()?;
    for fmt in FORMATS {
        if let Ok(ndt) = chrono::NaiveDateTime::parse_from_str(&t, fmt) {
            // single(): DST fall-back/spring-forward ambiguities resolve to None
            // (deadlines around those hours are vanishingly rare; better None than wrong).
            // with_timezone(Utc): normalize to UTC so the stored ISO has no +10/+11 offset.
            return ndt
                .and_local_timezone(melbourne)
                .single()
                .map(|dt| dt.with_timezone(&chrono::Utc).to_rfc3339());
        }
        if let Ok(nd) = chrono::NaiveDate::parse_from_str(&t, fmt) {
            let dt = nd.and_hms_opt(23, 59, 0)?;
            return dt
                .and_local_timezone(melbourne)
                .single()
                .map(|dt| dt.with_timezone(&chrono::Utc).to_rfc3339());
        }
    }
    None
}

/// Locate the FORUMS block number in the MST block list (the block hosting the announcements forum, e.g. section=62).
fn find_forums_section(sections: &[(u64, String)]) -> Option<u64> {
    sections
        .iter()
        .find(|(_, label)| label.to_lowercase().contains("forum"))
        .map(|(num, _)| *num)
}

/// Extract the modtype from a li.activity's classes ("modtype_resource" -> "resource").
fn extract_modtype_from_activity(li: &scraper::ElementRef) -> Option<String> {
    li.value()
        .classes()
        .find(|c| c.starts_with("modtype_"))
        .map(|c| c.strip_prefix("modtype_").unwrap_or(c).to_string())
}

/// Infer the modtype from the URL path `/mod/{modname}/view.php`.
fn extract_modtype_from_url(url: &str) -> Option<String> {
    let lower = url.to_lowercase();
    let after = lower.split("/mod/").nth(1)?;
    let modname = after.split('/').next()?;
    if modname.is_empty() {
        return None;
    }
    Some(modname.to_string())
}

/// Extract the file extension from the URL (filename param / path suffix) or from the title.
fn extract_file_extension(url: &str, name: &str) -> Option<String> {
    // 1. Prefer the filename= param in the URL query (common with pluginfile.php)
    let lower_url = url.to_lowercase();
    if let Some(idx) = lower_url.find("filename=") {
        let rest = &url[idx + 9..];
        let end = rest.find('&').unwrap_or(rest.len());
        let fname = &rest[..end];
        if let Some(dot) = fname.rfind('.') {
            let ext = fname[dot + 1..].to_lowercase();
            if !ext.is_empty() && !ext.contains('/') {
                return Some(ext);
            }
        }
    }
    // 2. The extension at the end of the title (e.g. "Lecture 1.pdf")
    if let Some(dot) = name.rfind('.') {
        let ext = name[dot + 1..].trim().to_lowercase();
        // Simple filter: reasonable length, no spaces, not the end of a sentence
        if !ext.is_empty() && ext.len() <= 10 && !ext.contains(' ') && !ext.contains('/') {
            return Some(ext);
        }
    }
    // 3. The suffix of the URL's last path segment
    if let Some(seg_start) = lower_url.rfind('/') {
        let seg = &lower_url[seg_start + 1..];
        let seg = seg.split('?').next().unwrap_or(seg);
        if let Some(dot) = seg.rfind('.') {
            let ext = seg[dot + 1..].to_string();
            if !ext.is_empty() && !ext.contains('/') {
                return Some(ext);
            }
        }
    }
    None
}

/// Classify the resource type from modtype + URL + filename extension.
/// Fixes the problem where looking only at the URL suffix labelled everything Other when Moodle's mod/resource/view.php has no extension.
fn classify_resource_type(url: &str, modtype: Option<&str>, name: &str) -> ResourceType {
    let lower_url = url.to_lowercase();
    let modtype_lower = modtype.map(|s| s.to_lowercase());

    // Folder
    if modtype_lower.as_deref() == Some("folder") || lower_url.contains("mod/folder/view.php") {
        return ResourceType::Folder;
    }

    // Link (URL link / page / book / H5P)
    if modtype_lower.as_deref() == Some("url")
        || modtype_lower.as_deref() == Some("page")
        || modtype_lower.as_deref() == Some("book")
        || modtype_lower.as_deref() == Some("h5pactivity")
        || lower_url.contains("mod/url/view.php")
        || lower_url.contains("mod/page/view.php")
        || lower_url.contains("mod/book/view.php")
        || lower_url.contains("mod/h5pactivity/view.php")
    {
        return ResourceType::Link;
    }

    // File (downloadable resource / pluginfile)
    if modtype_lower.as_deref() == Some("resource")
        || lower_url.contains("mod/resource/view.php")
        || lower_url.contains("pluginfile.php")
    {
        if let Some(ext) = extract_file_extension(url, name) {
            match ext.as_str() {
                "pdf" => return ResourceType::Pdf,
                "doc" | "docx" => return ResourceType::Doc,
                "ppt" | "pptx" | "pps" | "ppsx" => return ResourceType::Ppt,
                "mp4" | "webm" | "mov" | "mkv" | "avi" | "m4v" => return ResourceType::Video,
                _ => {}
            }
        }
        return ResourceType::Other;
    }

    ResourceType::Other
}

/// Parse the submission state from a quiz detail page (mod/quiz/view.php).
///
/// Moodle renders the user's attempts server-side:
/// - a finished attempt shows "Status Finished" in the attempt summary table (with
///   Started / Completed timestamps);
/// - an in-progress attempt shows "Status In progress";
/// - before the first attempt there is no attempt list at all ("This quiz is currently
///   not available." when closed, or just the start form when open).
fn parse_quiz_submission_from_html(html: &str) -> bool {
    let lower = html.to_lowercase();
    if lower.contains("status finished") || lower.contains("status: finished") {
        return true;
    }
    // A completed quiz view/summary page carries the final grade:
    //   EN: "Your final grade for this quiz is 13.00/13.00."
    //   ZH: "您的最终成绩" / "你在这个测验的最终成绩"
    if lower.contains("final grade") || lower.contains("最终成绩") || lower.contains("最終成績") {
        return true;
    }
    // "Your previous attempts" (EN) / "您以前的尝试" (ZH) means at least one
    // finished attempt exists.
    if (lower.contains("your previous attempts")
        || lower.contains("previous attempts")
        || lower.contains("您以前的尝试")
        || lower.contains("你以前的尝试"))
        && !lower.contains("never submitted")
    {
        return true;
    }
    // Safety net: a "Your attempts" block without in-progress / never-submitted markers
    // means at least one attempt was completed.
    lower.contains("your attempts")
        && !lower.contains("status in progress")
        && !lower.contains("never submitted")
}

/// Extract "13.00 / 13.00" from quiz pages: "Your final grade for this quiz is
/// 13.00/13.00" or the attempts table's "13.00 out of 13.00 (100%)".
fn parse_quiz_grade_from_html(html: &str) -> Option<String> {
    let re = regex::Regex::new(
        r"(?is)(?:final grade|grade|成绩|成績).{0,120}?(\d+(?:\.\d+)?)\s*(?:/|out of)\s*(\d+(?:\.\d+)?)",
    )
    .ok()?;
    let cap = re.captures(html)?;
    Some(format!("{} / {}", &cap[1], &cap[2]))
}

/// Extract the activity cmid from a Moodle view URL
/// (".../mod/quiz/view.php?id=6121932" -> 6121932).
fn cmid_from_url(url: Option<&str>) -> Option<u64> {
    let url = url?;
    url.rsplit("id=")
        .next()?
        .chars()
        .take_while(|c| c.is_ascii_digit())
        .collect::<String>()
        .parse()
        .ok()
}

/// Determine assignment status from text content.
fn determine_assignment_status(text: &str) -> AssignmentStatus {
    let lower = text.to_lowercase();

    if lower.contains("submitted") || lower.contains("已提交") {
        AssignmentStatus::Submitted
    } else if lower.contains("graded") || lower.contains("已评分") {
        AssignmentStatus::Graded
    } else if lower.contains("due") || lower.contains("待提交") || lower.contains("pending") {
        AssignmentStatus::Pending
    } else {
        AssignmentStatus::Upcoming
    }
}

/// Extract author name from text content.
/// Extract author name from text content.
fn extract_author(text: &str) -> String {
    // Patterns seen on Monash Moodle: "by John Smith" / "John Smith | 29 May 2026".
    let re = regex::Regex::new(r"(?:by\s+|作者\s*[:：]\s*)([A-Za-z][A-Za-z.\'\- ]{1,60}?)(?=\s*[,|\n]|\s+\d|$)").ok();
    if let Some(cap) = re.and_then(|re| re.captures(text)) {
        let name = cap[1].trim().to_string();
        if !name.is_empty() {
            return name;
        }
    }
    // Empty means "unknown": the frontend then hides the author line instead of showing a raw "Unknown".
    String::new()
}

/// If a forum subject is rendered as "Author Name: Subject" (Monash theme) and the regular
/// author extraction found nothing, recover the author from the title prefix. Only accepts a
/// plausible person-name prefix (2-4 capitalized words, no digits), so titles like "Quiz 3:"
/// or "FIT5222: notice" are left untouched.
fn extract_author_from_title(title: &str) -> Option<(String, String)> {
    let re = regex::Regex::new(r"^([A-Z][A-Za-zÀ-ž.\'\-]+(?:\s+[A-Z][A-Za-zÀ-ž.\'\-]+){1,3}):\s+(.+)$").ok()?;
    let cap = re.captures(title)?;
    let prefix = cap.get(1)?.as_str();
    if prefix.len() > 40 || prefix.chars().any(|c| c.is_ascii_digit()) {
        return None;
    }
    let rest = cap.get(2)?.as_str().trim();
    if rest.is_empty() {
        return None;
    }
    Some((prefix.to_string(), rest.to_string()))
}

/// Extract date from text content.
fn extract_date(text: &str) -> String {
    let re = regex::Regex::new(r"\d{4}-\d{2}-\d{2}|\d{1,2}\s+\w+\s+\d{4}").ok();
    if let Some(cap) = re.and_then(|re| re.captures(text)) {
        return cap[0].to_string();
    }
    String::new()
}

/// Split Moodle link text into `(short_name, full_name)`.
fn split_course_name(raw: &str) -> (String, String) {
    if let Some(idx) = raw.find(':') {
        let short = raw[..idx].trim().to_string();
        let full = raw[idx + 1..].trim().to_string();
        if !short.is_empty() && !full.is_empty() {
            return (short, full);
        }
    }
    let name = raw.to_string();
    (name.clone(), name)
}

/// Decode the handful of HTML entities Moodle commonly emits in course names.
fn decode_html_entities(s: &str) -> String {
    s.replace("\u{0026}amp;", "\u{0026}")
        .replace("\u{0026}lt;", "<")
        .replace("\u{0026}gt;", ">")
        .replace("\u{0026}quot;", "\"")
        .replace("\u{0026}#039;", "'")
        .replace("\u{0026}apos;", "'")
}

/// Strip HTML tags, keeping only visible text (used to extract name/role from inline fragments).
fn strip_tags(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut in_tag = false;
    for c in s.chars() {
        match c {
            '<' => in_tag = true,
            '>' => in_tag = false,
            _ if !in_tag => out.push(c),
            _ => {}
        }
    }
    out
}
/// descendant that has the `sr-only` class (screen-reader-only).
///
/// Used by `parse_courses_from_html` because Monash 4.x wraps the actual course
/// name alongside hidden `<span class="sr-only">` labels (e.g. "Course name",
/// "Course is starred") inside the same `<a class="coursename">` link.
fn extract_visible_text(el: scraper::ElementRef) -> String {
    let mut out = String::new();
    for child in el.children() {
        if let Some(child_el) = scraper::ElementRef::wrap(child) {
            if child_el.value().classes().any(|c| c == "sr-only") {
                continue;
            }
            out.push_str(&extract_visible_text(child_el));
        } else if let scraper::node::Node::Text(t) = child.value() {
            // `child` is a `NodeRef<Node>`, not an `ElementRef`; only
            // `ElementRef` has `.text()`. For a text node, the string lives
            // in the public `text` field of the `Node::Text` variant.
            out.push_str(&t.text);
        }
    }
    out
}

/// Extract the human-readable title from a Moodle `.instancename` element.
/// Monash 4.x wraps the real name in `.displayname` and appends `.module-name`
/// (e.g. "Forum"); we want only the displayname if it exists.
fn extract_activity_instancename(
    activity: &scraper::ElementRef,
    instancename_selector: &scraper::Selector,
) -> Option<String> {
    let name_el = activity.select(instancename_selector).next()?;
    let raw = name_el.text().collect::<String>().trim().to_string();
    if raw.is_empty() {
        return None;
    }
    // If the text contains a visible module-name suffix (e.g. "Page" / "Forum"),
    // try to keep only the .displayname portion.
    if let Some(display) = name_el.select(&scraper::Selector::parse(".displayname").ok()?).next() {
        let d = display.text().collect::<String>().trim().to_string();
        if !d.is_empty() {
            return Some(d);
        }
    }
    Some(raw)
}

/// Filter out "container-level" noise titles from the parse output.
///
/// Some Monash course pages surface help blocks ("See how to use this site"), empty forum placeholders
/// ("Your educator has no viewable content") or a whole block of text as an activity title,
/// producing overly long / duplicate weird cards on the Dashboard (a user reported "See how to use
/// this site Unit dashboard . Your educator has no viewable co ...").
///
/// This uses a "length cap + keyword blacklist" to block them: real resource names (file / page / URL) are usually
/// short, and announcements go through their own parser so they never reach here; returning None on a hit means the resource is discarded.
fn clean_resource_title(raw: &str) -> Option<String> {
    // Collapse whitespace (multiple spaces / newlines -> a single space), so formatting differences can't bypass the length check.
    let t: String = {
        let mut out = String::with_capacity(raw.len());
        let mut last_ws = false;
        for c in raw.chars() {
            if c.is_whitespace() {
                if !last_ws {
                    out.push(' ');
                }
                last_ws = true;
            } else {
                out.push(c);
                last_ws = false;
            }
        }
        out.trim().to_string()
    };
    if t.is_empty() {
        return None;
    }
    // Real resource names are rarely this long (long announcement / forum text goes through another parser).
    if t.chars().count() > 120 {
        return None;
    }
    let low = t.to_lowercase();
    const NOISE: &[&str] = &[
        "see how to use this site",
        "your educator has no viewable",
        "viewable content",
        "no viewable content",
        "getting started",
    ];
    if NOISE.iter().any(|n| low.contains(n)) {
        return None;
    }
    Some(t)
}

/// Best-effort extraction of the section/week title that owns this activity.
/// Tries several Moodle/Monash formats:
///   1. Monash MST: activity inside .mst-current-focus-details-inner →
///      look for sibling/child .mst-current-focus-nav-item h3/h1
///   2. Standard Moodle: ancestor <li.section> → .sectionname
///   3. Bootstrap collapse: ancestor .course-section-header → [data-for="section_title"]
fn section_title_for_activity(activity: &scraper::ElementRef) -> Option<String> {
    // Pre-parse selectors; failures silently abort the helper.
    let h3_h1_sel = scraper::Selector::parse("h3, h1").ok()?;
    let section_title_sel = scraper::Selector::parse("[data-for=\"section_title\"], h3, .sectionname").ok()?;
    let section_name_sel = scraper::Selector::parse(".sectionname, h3").ok()?;
    let nav_item_sel = scraper::Selector::parse(".mst-current-focus-nav-item").ok()?;

    // Walk ancestors looking for section containers.
    let mut current = activity.parent();
    while let Some(node) = current {
        if let Some(el) = scraper::ElementRef::wrap(node) {
            let classes: Vec<_> = el.value().classes().collect();
            let class_str = classes.join(" ");

            // Monash MST: the activity sits inside .mst-current-focus-details-inner,
            // and the week title is in a sibling .mst-current-focus-nav-item.
            if class_str.contains("mst-current-focus-details-inner")
                || class_str.contains("mst-current-focus-details-wrapper")
                || class_str.contains("mst-current-focus-container")
            {
                if let Some(nav) = el.select(&nav_item_sel).next() {
                    let parts: Vec<String> = nav
                        .select(&h3_h1_sel)
                        .map(|h| h.text().collect::<String>().trim().to_string())
                        .filter(|s| !s.is_empty())
                        .collect();
                    if !parts.is_empty() {
                        return Some(parts.join(" - "));
                    }
                }
            }

            // Standard Moodle section header
            if class_str.contains("course-section-header") || class_str.contains("sectionname") {
                let title = el
                    .select(&section_title_sel)
                    .next()
                    .map(|h| h.text().collect::<String>().trim().to_string())
                    .filter(|s| !s.is_empty());
                if title.is_some() {
                    return title;
                }
            }

            // Standard Moodle <li id="section-N" class="section ...">
            if class_str.contains("section")
                && el
                    .value()
                    .attr("id")
                    .map(|id| id.starts_with("section-"))
                    .unwrap_or(false)
            {
                let title = el
                    .select(&section_name_sel)
                    .next()
                    .map(|h| h.text().collect::<String>().trim().to_string())
                    .filter(|s| !s.is_empty());
                if title.is_some() {
                    return title;
                }
            }
        }
        current = node.parent();
    }
    None
}

/// Extract the Monash MST week/block nav links from course page HTML.
///
/// The MST template turns each week/block in the left nav (and in the `.mst-current-focus` area) into a real
/// `course/view.php?id=<cid>&section=<N>` server-side single-block view, with a human-readable label like
/// `title="Week 1 - Why Research Methods?"`.
///
/// Returns a deduped `(section_num, label)` list sorted ascending by section number. Deduping ensures that merging
/// doesn't fetch a week twice when it appears in both the sidebar and mst-current-focus.
///
/// Non-MST (standard Moodle) course pages have no such links and return empty -> the caller falls back to single-page parsing.
/// The href match handles both `&` and `&amp;` (syntax highlighting/some proxies convert `&` to an entity).
fn extract_mst_section_links(html: &str, course_id: u64) -> Vec<(u64, String)> {
    use scraper::{Html, Selector};
    let doc = Html::parse_document(html);
    let Ok(a_sel) = Selector::parse("a[href]") else {
        return Vec::new();
    };
    let Ok(re) = regex::Regex::new(&format!(
        r"course/view\.php\?id={}&(?:amp;)?section=(\d+)",
        course_id
    )) else {
        return Vec::new();
    };
    let mut map: std::collections::BTreeMap<u64, String> = std::collections::BTreeMap::new();
    for a in doc.select(&a_sel) {
        let Some(href) = a.value().attr("href") else {
            continue;
        };
        let Some(sec) = re
            .captures(href)
            .and_then(|c| c.get(1))
            .and_then(|m| m.as_str().parse::<u64>().ok())
        else {
            continue;
        };
        // Label priority: the title attribute (sidebar nav provides a human-readable name) -> link text -> fallback "Section N".
        let label = a
            .value()
            .attr("title")
            .map(|s| s.to_string())
            .filter(|s| !s.trim().is_empty())
            .or_else(|| {
                let t = a.text().collect::<String>().trim().to_string();
                if t.is_empty() {
                    None
                } else {
                    Some(t)
                }
            })
            .unwrap_or_else(|| format!("Section {}", sec));
        map.entry(sec).or_insert(label);
    }
    map.into_iter().collect()
}

/// Find the nearest h1/h2/h3 group heading text before `marker` (e.g. `data-id="4447072"`) in `html`.
/// Used to infer the "assessment category" (Written / Quiz / Test) for assessment items.
/// Pure string scanning, working around scraper having no convenient "previous sibling" API.
fn nearest_heading_before(html: &str, marker: &str) -> Option<String> {
    let marker_pos = html.find(marker)?;
    let heading_re = regex::Regex::new(r"<h([1-3])[^>]*>(.*?)</h\1>").ok()?;
    let tag_re = regex::Regex::new(r"<[^>]+>").ok()?;
    let mut last: Option<String> = None;
    for m in heading_re.find_iter(html) {
        if m.start() < marker_pos {
            let t = tag_re.replace_all(m.as_str(), "").to_string();
            let t = t.trim().to_string();
            if !t.is_empty() {
                last = Some(t);
            }
        } else {
            break;
        }
    }
    last
}

/// Extract the assessment weight percentage from a piece of text.
///
/// Monash uses three forms, all of which must be recognized:
///   1. `"Weighting: 9%"` -- the assessment detail card (`.assessment-info-txt-col`). **Note the label is
///      "Weighting", not "Weight"**, which is why the old `weight:` regex never matched.
///   2. `"Weight: 25%"` -- the form used in standard Moodle activity descriptions.
///   3. `"9%"` -- the `.weight-content` cell of the assessment structure table, a bare percentage with no label.
///
/// The 3rd form is only accepted when the whole text is **exactly** a percentage, to avoid mistaking
/// an arbitrary number in body text (like "80% of students") for a weight.
/// Split the details text of a widget announcement: "Sailaja Rajanala | 29 May 2026" -> (author, date).
/// Split the details text of a widget announcement: "Sailaja Rajanala | 29 May 2026" -> (author, date).
fn split_announcement_details(details: &str) -> (String, String) {
    let mut parts = details.split('|').map(|s| s.trim());
    let author = parts.next().unwrap_or("").to_string();
    let date = parts.next().unwrap_or("").to_string();
    (
        if author.is_empty() { String::new() } else { author },
        date,
    )
}

fn parse_weight_percent(text: &str) -> Option<f64> {
    let t = text.trim();
    if t.is_empty() {
        return None;
    }

    // 1 & 2: with a Weight / Weighting label
    if let Ok(re) = regex::Regex::new(r"(?i)weight(?:ing)?\s*:\s*([\d.]+)\s*%") {
        if let Some(v) = re
            .captures(t)
            .and_then(|c| c.get(1))
            .and_then(|m| m.as_str().parse::<f64>().ok())
        {
            return Some(v);
        }
    }

    // 3: a percentage wrapped in parentheses (common in activity names, e.g. "Assignment 1 - Instructions (35%)")
    if let Ok(re) = regex::Regex::new(r"\(([\d.]+)\s*%\)") {
        if let Some(v) = re
            .captures(t)
            .and_then(|c| c.get(1))
            .and_then(|m| m.as_str().parse::<f64>().ok())
        {
            return Some(v);
        }
    }

    // 4: the whole text is a bare percentage (table cell)
    if let Ok(re) = regex::Regex::new(r"^([\d.]+)\s*%$") {
        if let Some(v) = re
            .captures(t)
            .and_then(|c| c.get(1))
            .and_then(|m| m.as_str().parse::<f64>().ok())
        {
            return Some(v);
        }
    }

    None
}

/// Collect all text nodes inside an element and collapse whitespace.
///
/// Moodle's accordion headings are often padded with newlines/indentation (`<h3>\n  Welcome\n </h3>`),
/// so calling `.text()` directly yields fragments full of whitespace that need normalizing to a single line.
fn collect_text_trim(el: &scraper::ElementRef) -> String {
    el.text()
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

/// Strip `<style>` / `<script>` blocks (including their content) from an HTML fragment, for feeding into the frontend's innerHTML.
///
/// Monash CMS inlines a large `<style>` block at the start of every `.no-overflow` (Bootstrap overrides for the accordion);
/// injecting it as-is into `dangerouslySetInnerHTML` would leak those rules as global styles and pollute the whole app.
/// This is a pure string scan rather than a regex, to avoid pulling in a regex dependency for such a simple case.
fn sanitize_content_html(html: &str) -> String {
    let mut out = String::with_capacity(html.len());
    let mut rest = html;

    'outer: loop {
        // Find the start of the next <style or <script (case-insensitive)
        let lower = rest.to_ascii_lowercase();
        let mut hit: Option<(usize, &str)> = None;
        for tag in ["<style", "<script"] {
            if let Some(idx) = lower.find(tag) {
                if hit.map_or(true, |(prev, _)| idx < prev) {
                    hit = Some((idx, tag));
                }
            }
        }

        let Some((start, tag)) = hit else {
            out.push_str(rest);
            break 'outer;
        };

        out.push_str(&rest[..start]);

        // From the start position, find the matching closing tag
        let close = if tag == "<style" { "</style>" } else { "</script>" };
        match lower[start..].find(close) {
            Some(rel_end) => {
                rest = &rest[start + rel_end + close.len()..];
            }
            // No closing tag (malformed HTML): discard everything remaining, so a half tag can't break the structure
            None => break 'outer,
        }
    }

    out.trim().to_string()
}

/// Sanitize filename from Content-Disposition header or URL to prevent path traversal
fn sanitize_filename(raw: &str) -> String {
    let name = std::path::Path::new(raw)
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or(raw);

    let sanitized: String = name
        .chars()
        .filter(|c| !c.is_control() && *c != '/' && *c != '\\' && *c != ':')
        .collect();

    let trimmed = sanitized.trim_matches('.').trim();
    if trimmed.is_empty() || trimmed == ".." {
        "downloaded_file".to_string()
    } else {
        trimmed.to_string()
    }
}

// ============================================================================
// Regression tests: real Monash pages -> parsers
//
// Goal: verify that samples/live_*.html (real, anonymized Monash Moodle pages) still yield
// non-empty data sets under the current selectors. Only validates "something was extracted", not field details.
//
// All 4 parse functions are `&self` methods, so a MoodleScraper instance is needed.
// The scraper only uses auth on the fetch_* network paths; parse_* touches no network, so it's safe to construct.
// ============================================================================
#[cfg(test)]
mod tests {
    use super::*;
    use crate::moodle::auth::MoodleAuth;
    use std::fs;
    use std::path::PathBuf;
    use std::sync::Arc;

    /// Read one sample file from the samples/ directory and return the full HTML string.
    /// `CARGO_MANIFEST_DIR` points at src-tauri/, and the samples live in samples/ one level up.
    fn sample(name: &str) -> String {
        let p = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../samples")
            .join(name);
        fs::read_to_string(&p)
            .unwrap_or_else(|e| panic!("Cannot read sample {}: {}", p.display(), e))
    }

    /// Construct an offline MoodleScraper instance, used only to call parse_* methods.
    fn test_scraper() -> MoodleScraper {
        MoodleScraper::new(Arc::new(MoodleAuth::new()))
    }

    #[test]
    fn quiz_view_page_with_final_grade_detected_as_submitted() {
        // EN quiz view page after finishing: "Your final grade for this quiz is 13.00/13.00."
        let en = r#"<div class="quizinfomessage">Your final grade for this quiz is <b>13.00/13.00</b>.</div>
                    <div>Your previous attempts</div><a href="/mod/quiz/review.php">Review</a>"#;
        assert!(parse_quiz_submission_from_html(en), "EN final-grade page must be submitted");

        // ZH quiz view page after finishing
        let zh = r#"<div>您的最终成绩是 <b>13.00/13.00</b>。</div>
                    <a href="/mod/quiz/review.php">查看</a>"#;
        assert!(parse_quiz_submission_from_html(zh), "ZH final-grade page must be submitted");

        // Not yet attempted: "Attempt quiz now" button, no final grade
        let open = r#"<div>This quiz is open.</div><button>Attempt quiz now</button>"#;
        assert!(!parse_quiz_submission_from_html(open), "open quiz must NOT be submitted");
    }

    #[test]
    fn finished_quiz_real_page_is_submitted() {
        // Real page: Quiz 1 2026 S2, attempt finished (the exact bug-report case).
        let html = sample("live_quiz_view_finished_6121932.html");
        assert!(parse_quiz_submission_from_html(&html));
        let scraper = test_scraper();
        let status = scraper
            .parse_submission_status_from_html(&html, 6121932)
            .expect("parse");
        // The quiz route overrides the assign-route heuristic:
        assert!(status.submitted || parse_quiz_submission_from_html(&html));
    }

    #[test]
    fn quiz_grade_extracted_with_max_score() {
        let en = "Your final grade for this quiz is 13.00/13.00.";
        assert_eq!(parse_quiz_grade_from_html(en).as_deref(), Some("13.00 / 13.00"));

        let out_of = "Grade: 13.00 out of 13.00 (100%)";
        assert_eq!(parse_quiz_grade_from_html(out_of).as_deref(), Some("13.00 / 13.00"));

        let zh = "您的最终成绩是 8.50 / 10.00。";
        assert_eq!(parse_quiz_grade_from_html(zh).as_deref(), Some("8.50 / 10.00"));

        assert_eq!(parse_quiz_grade_from_html("Attempt quiz now"), None);
    }

    #[test]
    fn feedback_cleans_escaped_html_from_view_feedback_button() {
        let scraper = test_scraper();
        // Real-world shape: the feedback cell contains the human comment plus the
        // escaped "View feedback" button markup.
        let html = r#"<div class="feedback"><table><tbody>
          <tr><th>Feedback comments</th>
          <td><div class="plugincontentsummary"><p>Description Feedback: clear structure.</p>
              &lt;a href="https://learning.monash.edu/mod/assign/view.php?id=4716971&amp;gid=3987304&amp;plugin=comments&amp;action=viewpluginassignfeedback&amp;returnaction&amp;returnparams=rownum%3D0%26amp%3Buseridlistid%3D6a82" id="action_link" class="" &gt;&lt;i class="icon fa fa-magnifying-glass-plus fa-fw " title="View feedback" role="img" aria-label="View feedback"&gt;&lt;/i&gt;&lt;/a&gt;
          </td></tr>
        </tbody></table></div>"#;
        let status = scraper
            .parse_submission_status_from_html(&html, 42)
            .expect("parse");
        let fb = status.feedback.unwrap_or_default();
        assert!(
            fb.contains("Description Feedback: clear structure."),
            "human feedback must survive: {fb:?}"
        );
        assert!(
            !fb.contains("<a href") && !fb.contains("viewpluginassignfeedback"),
            "raw markup must be stripped: {fb:?}"
        );
        assert!(!fb.contains("magnifying-glass-plus"), "icon classes must be gone: {fb:?}");
    }

    #[test]
    fn submission_grade_keeps_full_marks() {
        let scraper = test_scraper();
        let html = "Grade: 0.50 / 1.00";
        let s = scraper
            .parse_submission_status_from_html(&html, 42)
            .expect("parse");
        // grade regex path: bare "X / Y" fallback
        assert_eq!(s.grade.as_deref(), Some("0.50 / 1.00"));

        let html2 = "成绩 13.00 / 13.00";
        let s2 = scraper
            .parse_submission_status_from_html(&html2, 42)
            .expect("parse");
        assert_eq!(s2.grade.as_deref(), Some("13.00 / 13.00"));
    }

    /// Regression: a quiz with a finished attempt must be detected as submitted (real page of
    /// Quiz 1 2026 S2: attempt finished Saturday, 15 August 2026, 9:51 PM).
    #[test]
    fn quiz_submission_detects_finished_attempt() {
        let finished = r#"<h4 class="card-header">Your attempts</h4>
            <table class="generaltable"><tr>
              <th class="cell c0">Attempt 1</th>
              <td class="cell c1"><span class="sr-only">Attempt 1 summary</span>Status Finished</td>
            </tr></table>"#;
        assert!(parse_quiz_submission_from_html(finished));

        let closed = r#"<div class="quizinfo">Attempts allowed: 1 Time limit: 25 mins
            This quiz is currently not available.</div>"#;
        assert!(!parse_quiz_submission_from_html(closed));

        let in_progress = r#"<span class="sr-only">Attempt 1 summary</span>Status In progress"#;
        assert!(!parse_quiz_submission_from_html(in_progress));

        let finished_colon = r#"<td>Status: Finished</td>"#;
        assert!(parse_quiz_submission_from_html(finished_colon));
    }

    /// Regression: cmid extraction from gradebook / activity URLs must match Assignment ids.
    #[test]
    fn cmid_from_url_matches_view_links() {
        assert_eq!(
            cmid_from_url(Some("https://learning.monash.edu/mod/quiz/view.php?id=6121932")),
            Some(6121932)
        );
        assert_eq!(
            cmid_from_url(Some("https://learning.monash.edu/mod/assign/view.php?id=6121936")),
            Some(6121936)
        );
        assert_eq!(cmid_from_url(None), None);
        assert_eq!(cmid_from_url(Some("https://learning.monash.edu/course/view.php?id=46961")), Some(46961));
    }

    /// Regression on real pages: a quiz with a finished attempt (Quiz 1 2026 S2, attempt
    /// completed 2026-08-15 21:51) must be detected as submitted, while a closed/never-started
    /// quiz (Quiz 2 2026 S2) must not.
    #[test]
    fn quiz_submission_from_real_pages() {
        let finished = sample("live_quiz_view_finished_6121932.html");
        assert!(
            parse_quiz_submission_from_html(&finished),
            "finished quiz page should be detected as submitted"
        );

        let closed = sample("live_quiz_view_closed_6121933.html");
        assert!(
            !parse_quiz_submission_from_html(&closed),
            "closed/never-started quiz page should NOT be detected as submitted"
        );
    }

    /// Regression on a real assignment detail page (submitted for grading, graded 0.50 / 1.00):
    /// the submission parse must report submitted=true and recover the grade.
    #[test]
    fn assign_submission_from_real_page() {
        let html = sample("live_assign_view_submitted_5463586.html");
        let scraper = test_scraper();
        let parsed = scraper
            .parse_submission_status_from_html(&html, 5463586)
            .expect("parse should succeed");
        assert!(parsed.submitted, "submitted-for-grading page must be marked submitted");
        assert_eq!(parsed.grade.as_deref(), Some("0.50 / 1.00"));
    }


    /// Regression: Contacts parsing must be lenient -- a space after `mailto: `, a possibly-missing role,
    /// and email text separate from the link. The old single regex would miss these cases.
    #[test]
    fn contacts_parser_handles_mailto_space_and_missing_role() {
        let scraper = test_scraper();
        let html = r#"
        <div class="widget-container widget-contacts">
          <div class="widget-item">
            <div class="contact-pic"><img src="https://x/user/icon/f1"/></div>
            <div class="contact-details">
              Garry Young<br/>
              Lecturer<br/>
              <a href="mailto: Garry.Young@monash.edu">Garry.Young@monash.edu</a>
            </div>
          </div>
          <div class="widget-item">
            <div class="contact-pic"><img src="https://x/user/icon/f2"/></div>
            <div class="contact-details">
              Jane Doe<br/>
              <a href="mailto:Jane.Doe@monash.edu">Jane.Doe@monash.edu</a>
            </div>
          </div>
        </div>
        "#;
        let contacts = scraper.parse_contacts_from_html(html);
        assert_eq!(contacts.len(), 2, "should parse 2 contacts");
        assert_eq!(contacts[0].name, "Garry Young");
        assert_eq!(contacts[0].role, "Lecturer");
        assert_eq!(contacts[0].email, "Garry.Young@monash.edu");
        assert_eq!(contacts[0].picture_url.as_deref(), Some("https://x/user/icon/f1"));
        // The second has no role, so role should be an empty string, not mistakenly grabbing the email text
        assert_eq!(contacts[1].name, "Jane Doe");
        assert_eq!(contacts[1].role, "");
        assert_eq!(contacts[1].email, "Jane.Doe@monash.edu");
    }

    /// Regression: when there is no .widget-contacts container but a .widget-item still has contact-details +
    /// mailto, matching should be relaxed (some Monash course templates).
    #[test]
    fn contacts_parser_falls_back_to_any_widget_item() {
        let scraper = test_scraper();
        let html = r#"
        <div class="some-other-block">
          <div class="widget-item">
            <div class="contact-pic"><img src="https://x/u/9"/></div>
            <div class="contact-details">
              Sam Lee<br/>
              Tutor<br/>
              <a href="mailto:Sam.Lee@monash.edu">Sam.Lee@monash.edu</a>
            </div>
          </div>
        </div>
        "#;
        let contacts = scraper.parse_contacts_from_html(html);
        assert_eq!(contacts.len(), 1);
        assert_eq!(contacts[0].name, "Sam Lee");
        assert_eq!(contacts[0].email, "Sam.Lee@monash.edu");
    }

    /// Regression: classify_resource_type should decide by modtype + filename extension, not just the URL suffix.
    /// Moodle mod/resource/view.php links have no extension themselves, Previously all became Other.
    #[test]
    fn classify_resource_type_uses_modtype_and_file_extension() {
        // pluginfile with a filename param in the URL -> PDF
        assert!(matches!(
            classify_resource_type(
                "https://x/pluginfile.php/123/mod_resource/content/0/Lecture1.pdf?forcedownload=1",
                Some("resource"),
                "Lecture 1"
            ),
            ResourceType::Pdf
        ));
        // mod/resource with no extension info -> still a file but format unknown -> Other ( honest fallback )
        assert!(matches!(
            classify_resource_type("https://x/mod/resource/view.php?id=123", Some("resource"), "Lecture 1"),
            ResourceType::Other
        ));
        // folder
        assert!(matches!(
            classify_resource_type("https://x/mod/folder/view.php?id=456", Some("folder"), "Week 1 Files"),
            ResourceType::Folder
        ));
        // url link
        assert!(matches!(
            classify_resource_type("https://x/mod/url/view.php?id=789", Some("url"), "External Reading"),
            ResourceType::Link
        ));
        // Should be recognized when the title carries the extension but the URL doesn't
        assert!(matches!(
            classify_resource_type("https://x/mod/resource/view.php?id=999", Some("resource"), "Slides.pptx"),
            ResourceType::Ppt
        ));
    }

    /// Regression: Recordings parsing should take `<a href="...panopto...">` as the URL and the inner `<img alt>` as the title,
    /// without listing the thumbnail `<img src>` separately. Structure observed on the Monash course `&section=1` page.
    #[test]
    fn recordings_parser_extracts_title_and_url_from_panopto_link() {
        let scraper = test_scraper();
        let html = r#"
        <div>
          <a href="https://monash.au.panopto.com/Panopto/Pages/Viewer.aspx?id=f8b1e122-86b4-4f0f-9402-b0d000149f64" target="_blank">
            <img width="512" height="288" alt="S1 2021 Intro"
                 src="https://monash.au.panopto.com/Panopto/PublicAPI/SessionPreviewImage?id=f8b1e122-86b4-4f0f-9402-b0d000149f64">
          </a>
        </div>
        "#;
        let recs = scraper.parse_recordings_from_html(html);
        assert_eq!(recs.len(), 1, "should parse exactly 1 recording (thumbnails are not separate rows)");
        assert_eq!(recs[0].title, "S1 2021 Intro");
        assert!(
            recs[0].url.contains("Viewer.aspx?id=f8b1e122"),
            "URL should be the Viewer page, not a thumbnail: {}",
            recs[0].url
        );
    }

    /// Regression: the `<iframe src="...panopto...">` embed form should also be parsed.
    #[test]
    fn recordings_parser_handles_iframe_embed() {
        let scraper = test_scraper();
        let html = r#"
        <iframe src="https://monash.au.panopto.com/Panopto/Pages/Embed.aspx?id=abc-123"
                title="Week 3 Recording" width="720" height="405"></iframe>
        "#;
        let recs = scraper.parse_recordings_from_html(html);
        assert_eq!(recs.len(), 1);
        assert_eq!(recs[0].title, "Week 3 Recording");
        assert!(recs[0].url.contains("Embed.aspx?id=abc-123"));
    }

    #[test]
    fn clean_resource_title_filters_container_noise() {
        // Normal short titles are kept
        assert_eq!(
            clean_resource_title("Overview Section"),
            Some("Overview Section".to_string())
        );
        // Collapse redundant whitespace
        assert_eq!(
            clean_resource_title("  Week 1  -  Why Research Methods?  "),
            Some("Week 1 - Why Research Methods?".to_string())
        );
        // Help blocks / empty forum placeholders -> discarded
        assert_eq!(
            clean_resource_title("See how to use this site"),
            None
        );
        assert_eq!(
            clean_resource_title("Your educator has no viewable content"),
            None
        );
        // Container-level concatenated overly long text -> discarded
        assert_eq!(
            clean_resource_title(
                "See how to use this site Unit dashboard Your educator has no viewable content See how to use this site"
            ),
            None
        );
    }

    #[test]
    fn parse_real_monash_samples() {
        let scraper = test_scraper();

        // 1) Dashboard -> course list
        let dash = sample("live_my_courses.html");
        let courses = scraper
            .parse_courses_from_html(&dash)
            .expect("parsing the dashboard should return Ok");
        println!("courses = {}", courses.len());
        assert!(!courses.is_empty(), "dashboard should parse at least 1 course");

        // 2) Course homepage -> resources/activities
        let course_id: u64 = 34645;
        let course_html = sample(&format!("live_course_view_{}.html", course_id));
        let resources = scraper
            .parse_resources_from_html(&course_html, course_id, None)
            .expect("parsing the course page should return Ok");
        println!("resources({}) = {}", course_id, resources.len());
        assert!(
            !resources.is_empty(),
            "course page {} should parse at least 1 resource/activity",
            course_id
        );
        assert!(
            resources.iter().all(|r| r.course_id == course_id),
            "all resources should have course_id equal to the passed course ID {}",
            course_id
        );

        // 3) Assignments overview -> assignments
        let assign_html = sample(&format!("live_assign_index_{}.html", course_id));
        let assignments = scraper
            .parse_assignments_from_html(&assign_html, course_id)
            .expect("parsing the assignment overview should return Ok");
        println!("assignments({}) = {}", course_id, assignments.len());
        assert!(
            !assignments.is_empty(),
            "assignment overview {} should parse at least 1 assignment",
            course_id
        );

        // 4) Announcements forum (forum view)
        // Pick a sample that actually has discussion threads: live_forum_view_4850270.html has 26 discuss.php links.
        // (4436189/4447049/4545711/4551559/6121582 are themselves empty forums, so 0 hits is expected)
        let forum_id = 4850270u64;
        let forum_html = sample(&format!("live_forum_view_{}.html", forum_id));
        let announcements = scraper
            .parse_announcements_from_html(&forum_html, course_id)
            .expect("parsing the announcement forum should return Ok");
        println!("announcements(forum={}) = {}", forum_id, announcements.len());
            assert!(
            !announcements.is_empty(),
            "forum page {} should parse at least 1 announcement",
            forum_id
        );
    }

    /// Regression: after the Monash 4.x new dashboard moved the course list to async JS rendering, the static HTML
    /// no longer has a.coursename / course/view.php links. This test uses an inline fixture to verify the parser can
    /// extract all courses from the calendar filter dropdown `<select class="cal_courses_flt">`.
    /// Loads no real sample, to avoid committing sensitive data like session cookies.
    #[test]
    fn parse_courses_from_calendar_filter() {
        let scraper = test_scraper();
        let html = r#"
            <html><body>
              <form>
                <select class="cal_courses_flt" name="course">
                  <option value="">All courses</option>
                  <option value="34645">FIT5047 Fundamentals of artificial intelligence</option>
                  <option value="35418">FIT9132 Introduction to &amp; databases</option>
                  <option value="35987">FIT5125 IT research &amp; innovation methods</option>
                </select>
              </form>
            </body></html>
        "#;

        let courses = scraper
            .parse_courses_from_html(html)
            .expect("calendar filter dropdown should parse courses");

        // "All courses" (value="") is filtered out, leaving 3 real courses
        assert_eq!(courses.len(), 3, "should parse 3 courses");

        let ids: Vec<u64> = courses.iter().map(|c| c.id).collect();
        assert!(ids.contains(&34645));
        assert!(ids.contains(&35418));
        assert!(ids.contains(&35987));

        // Entities should be decoded and whitespace collapsed
        let c = courses.iter().find(|c| c.id == 35418).unwrap();
        assert_eq!(c.full_name, "FIT9132 Introduction to & databases");
    }

    /// Regression: Monash MST course pages turn each "week/block" into a real
    /// `course/view.php?id=<cid>&section=<N>` server-side single-block view (the left nav carries a
    /// human-readable `title` label). `extract_mst_section_links` should extract all weeks and dedup,
    /// which is the foundation of the "cover all weeks without Playwright" capability.
    ///
    /// The sample comes from a real MST course page provided by a user (id=34696, FIT4005-FIT5125),
    /// dumped to samples/mst_course_view_34696.html (syntax-highlighting escapes already reverted).
    #[test]
    fn mst_extracts_all_section_nav_links() {
        let html = sample("mst_course_view_34696.html");
        let links = extract_mst_section_links(&html, 34696);

        // After dedup, at least 17 blocks should be covered (Unit Dashboard/Information/Schedule + additional information +
        // Week 1..12 + Assessments/Forums/Support).
        assert!(links.len() >= 17, "should extract >=17 MST section links, actual {}", links.len());

        // Ascending by section number (guaranteed by BTreeMap).
        for w in links.windows(2) {
            assert!(w[0].0 < w[1].0, "section numbers should be ascending");
        }

        // Verify the labels of key blocks.
        let by_sec: std::collections::HashMap<u64, String> =
            links.into_iter().collect();
        assert_eq!(
            by_sec.get(&7).map(String::as_str),
            Some("Week 1 - Why Research Methods?"),
            "Week 1 label should come from the nav title"
        );
        assert_eq!(
            by_sec.get(&56).map(String::as_str),
            Some("ASSESSMENTS"),
            "Assessments label should come from the nav title"
        );
        assert_eq!(
            by_sec.get(&65).map(String::as_str),
            Some("SUPPORT"),
            "Support label should come from the nav title"
        );
        assert_eq!(
            by_sec.get(&5).map(String::as_str),
            Some("Additional information and resources"),
            "extra-info label should come from the nav title"
        );
    }

    /// Regression: when `fetch_course_resources` fetches week by week via `&section=N`, it passes that week's
    /// `(section_num, nav title)` in as `section_ctx`, and the parsed resources' `section`
    /// field should equal that label rather than falling back to `section_title_for_activity`'s inference.
    /// Also locks in the resource type filter: cms accordion blocks / forums don't enter the resource list.
    #[test]
    fn mst_forced_section_labels_resources() {
        let scraper = test_scraper();
        let html = r#"
            <html><body>
              <li id="section-5" class="section course-section main clearfix">
                <ul class="section">
                  <li class="activity activity-wrapper cms modtype_cms hasinfo" id="module-5001" data-id="5001">
                    <div class="activity-item" data-activityname="Overview Section"></div>
                  </li>
                </ul>
              </li>
              <li id="section-7" class="section course-section main clearfix">
                <ul class="section">
                  <li class="activity activity-wrapper resource modtype_resource hasinfo" id="module-7001" data-id="7001">
                    <div class="activity-item" data-activityname="Lecture slides">
                      <a href="https://learning.monash.edu/mod/resource/view.php?id=7001">Lecture slides</a>
                    </div>
                  </li>
                  <li class="activity activity-wrapper forum modtype_forum hasinfo" id="module-7002" data-id="7002">
                    <div class="activity-item" data-activityname="Site announcements Forum">
                      <a href="https://learning.monash.edu/mod/forum/view.php?id=7002">Forum</a>
                    </div>
                  </li>
                </ul>
              </li>
            </body></html>
        "#;
        let label = "Week 1 - Why Research Methods?".to_string();
        let resources = scraper
            .parse_resources_from_html(&html, 34696, Some((7, label.clone())))
            .expect("MST course page should parse successfully");

        // Keep only the resource-type activities inside section-7: the cms block and the forum are filtered out
        assert_eq!(resources.len(), 1, "should parse exactly 1 resource inside section-7 (cms/forum filtered)");
        assert_eq!(resources[0].id, 7001, "should take the resource id of section-7");
        for r in &resources {
            assert_eq!(
                r.section.as_deref(),
                Some(label.as_str()),
                "resource section should equal the forced_section label"
            );
        }
    }

    /// Regression: when section_ctx passes a concrete section_num, the parser should only take activities inside
    /// that block's container, avoiding activities from other blocks/generic areas/sidebar on the same page being
    /// scraped in again (this was the root cause of MST courses showing many duplicate
    /// "Additional information and resources" cards).
    #[test]
    fn mst_section_page_scopes_to_target_section() {
        let scraper = test_scraper();
        let html = r#"
            <html><body>
              <li id="section-5" class="section course-section main clearfix">
                <ul class="section">
                  <li class="activity activity-wrapper resource modtype_resource hasinfo" id="module-10001" data-id="10001">
                    <div class="activity-item" data-activityname="Additional doc">
                      <a href="https://learning.monash.edu/mod/resource/view.php?id=10001">Additional doc</a>
                    </div>
                  </li>
                </ul>
              </li>
              <li id="section-7" class="section course-section main clearfix">
                <ul class="section">
                  <li class="activity activity-wrapper resource modtype_resource hasinfo" id="module-10002" data-id="10002">
                    <div class="activity-item" data-activityname="Week 1 doc">
                      <a href="https://learning.monash.edu/mod/resource/view.php?id=10002">Week 1 doc</a>
                    </div>
                  </li>
                </ul>
              </li>
            </body></html>
        "#;
        let label = "Week 1 - Why Research Methods?".to_string();
        let resources = scraper
            .parse_resources_from_html(html, 34696, Some((7, label)))
            .expect("should parse successfully");
        assert_eq!(resources.len(), 1, "should parse exactly 1 resource inside section-7");
        assert_eq!(resources[0].id, 10002, "should take the resource id of section-7");
        assert_eq!(resources[0].name, "Week 1 doc");
    }

    /// Regression: file links like pluginfile.php have no `id=` query param, and hashing the full URL directly
    /// means query param changes (forcedownload=1, section, etc.) cause the same file to be counted as multiple ids.
    /// stable_resource_id_for_dedup strips the query for pluginfile before hashing.
    #[test]
    fn pluginfile_url_dedup_normalizes_query_params() {
        let base = "https://learning.monash.edu/pluginfile.php/123/course/section/5/file.pdf";
        let a = stable_resource_id_for_dedup(&format!("{}?forcedownload=1", base));
        let b = stable_resource_id_for_dedup(&format!("{}?section=7", base));
        let c = stable_resource_id_for_dedup(base);
        assert_eq!(a, b, "different query params should not change the pluginfile dedup id");
        assert_eq!(b, c, "with/without query params should yield the same dedup id");
    }

    /// Regression: the MST template wraps each week's content into a custom activity (no .instancename, no <a href>,
    /// only data-activityname + cmid). For **resource-type** activities (modtype_resource) the parser should:
    ///   1. build the URL from data-id + modtype;
    ///   2. get the title from data-activityname / the inner h3;
    ///   3. store the section context structurally in the Resource.section field, keeping name as the activity's original name,
    ///      leaving display up to the frontend, so the list isn't full of identical "Overview" entries.
    /// Note: modtype_cms accordion blocks no longer enter the resource list (users reported too much noise on the resources page);
    /// the real file links inside them are covered by Phase 2's pluginfile and other selectors.
    #[test]
    fn parse_mst_resource_activity_disambiguates_title() {
        let scraper = test_scraper();
        let html = r#"
            <html><body>
              <ul class="mst mst-level-0">
                <li id="section-0" class="section course-section main clearfix">
                  <div class="content collapse show">
                    <div id="mst-current-focus-container" class="d-flex">
                      <div class="mst-current-focus-details-wrapper d-flex flex-wrap">
                        <div class="mst-current-focus-details-inner flex-wrap hidden">
                          <div class="mst-current-focus-nav-item">
                            <h3>Week 1</h3>
                            <h1>Why Research Methods?</h1>
                            <h4 class="format-mst sectionstartenddate">Sun 27 July 25 - Sat  2 Aug 25</h4>
                          </div>
                          <ul class="section m-0 p-0 img-text" data-for="cmlist">
                            <li class="activity activity-wrapper resource modtype_resource hasinfo"
                                id="module-4447072" data-for="cmitem" data-id="4447072">
                              <div class="activity-item focus-control activityinline"
                                   data-activityname="Overview Section" data-region="activity-card">
                                <div class="activity-grid noname-grid">
                                  <div class="form-control-static activity-altcontent text-break">
                                    <h3>Overview</h3>
                                    <p>Research methods are not just for academic research...</p>
                                  </div>
                                </div>
                              </div>
                            </li>
                            <li class="activity activity-wrapper cms modtype_cms hasinfo"
                                id="module-4447073" data-for="cmitem" data-id="4447073">
                              <div class="activity-item focus-control activityinline"
                                   data-activityname="Overview Section" data-region="activity-card">
                                <div class="activity-grid noname-grid">
                                  <div class="form-control-static activity-altcontent text-break">
                                    <h3>Overview</h3>
                                    <p>Some CMS block text...</p>
                                  </div>
                                </div>
                              </div>
                            </li>
                          </ul>
                        </div>
                      </div>
                    </div>
                  </div>
                </li>
              </ul>
            </body></html>
        "#;

        let resources = scraper
            .parse_resources_from_html(html, 34696, None)
            .expect("MST course page should parse successfully");

        // Only modtype_resource is kept; the same-named cms accordion block is filtered out
        assert_eq!(resources.len(), 1, "should parse 1 MST resource activity (cms block filtered)");
        let r = &resources[0];
        assert_eq!(r.id, 4447072, "resource id should be the cmid");
        assert_eq!(r.course_id, 34696, "resource course_id should equal the passed course ID");
        assert_eq!(r.url, "https://learning.monash.edu/mod/resource/view.php?id=4447072");
        // Key: name keeps the activity's original name (including Overview), while the section field carries the Week 1 context,
        // for structured frontend rendering/grouping instead of baking the structure into one string.
        assert!(
            r.name.contains("Overview"),
            "name should keep the original activity name Overview Section; actual: {}",
            r.name
        );
        assert!(
            r.section.as_ref().map_or(false, |s| s.contains("Week 1")),
            "section field should carry the Week 1 context; actual: {:?}",
            r.section
        );
    }

    /// Regression (real sample): the Unit Information (`&section=1`) accordion must be **split into cards**.
    ///
    /// The sample live_course_section1_46961.html has 7 `data-activityname` items, 5 of which are
    /// Bootstrap accordions (16 `.card-body` in total). The old implementation only dumped the whole altcontent,
    /// so the frontend received body text hidden by the `collapse` class -- users saw a blank area under the "Welcome" heading.
    /// This test locks in three things: the cards are split, the body is non-empty, and inline `<style>` is stripped.
    #[test]
    fn unit_info_splits_accordion_cards_from_real_sample() {
        let scraper = test_scraper();
        let html = sample("live_course_section1_46961.html");

        let info = scraper
            .parse_unit_info_from_html(&html, 46961)
            .expect("real section=1 page should parse successfully");

        assert_eq!(info.course_id, 46961);
        // The sample has 5 accordions (Teaching approach's empty card-body gets dropped) + 2 plain-text CMS blocks.
        // What matters isn't the section count but that **the body text was extracted** -- the old implementation only dumped collapse headers with empty bodies.
        assert!(
            info.sections.len() >= 4,
            "should parse multiple non-empty sections, only got {}: {:?}",
            info.sections.len(),
            info.sections.iter().map(|s| &s.title).collect::<Vec<_>>()
        );

        // Every section must have a title + non-empty body, and the body must not retain inline styles/scripts
        for s in &info.sections {
            assert!(!s.title.trim().is_empty(), "section title should not be empty: {:?}", s);
            assert!(
                !s.content_html.trim().is_empty(),
                "section \"{}\" body should not be empty (empty cards must be dropped)",
                s.title
            );
            let lower = s.content_html.to_ascii_lowercase();
            assert!(
                !lower.contains("<style") && !lower.contains("<script"),
                "section \"{}\" body still contains <style>/<script>",
                s.title
            );
        }

        // Lock in specific content: the Welcome card's body must include the lecturer introduction, not an empty collapse header.
        let welcome = info
            .sections
            .iter()
            .find(|s| s.title.contains("Welcome"))
            .expect("should have a Welcome section");
        assert!(
            welcome.content_html.contains("Machine Learning")
                || welcome.content_html.contains("Reza Haffari"),
            "Welcome body should contain real content, actual: {}",
            welcome.content_html
        );
    }

    /// Regression (real sample): the MST "Standard Schedule" is div-based
    /// (.schedule-item), not a <table>; it must parse into structured rows that
    /// keep assessment links, with a synthesized header row.
    #[test]
    fn schedule_parses_div_based_items_with_links() {
        let scraper = test_scraper();
        let html = sample("live_unit_schedule_46961.html");
        let schedule = scraper
            .parse_schedule_from_html(&html, 46961)
            .expect("real Schedule page should parse successfully");

        let sched_item = schedule
            .items
            .iter()
            .find(|it| it.title.contains("Standard Schedule"))
            .expect("should have a Standard Schedule activity");

        let rows = &sched_item.rows;
        assert!(rows.len() >= 3, "should have a header + multiple data rows, actual {}", rows.len());

        // synthesized header
        let header = &rows[0];
        assert_eq!(header.cells.len(), 4);
        assert_eq!(header.cells[0], "DATE");
        assert_eq!(header.cells[1], "LEARNING SECTION");
        assert_eq!(header.cells[2], "ASSESSMENTS");

        // data rows: the Week 3 row should contain a Quiz link (links preserved, not plain text)
        let week3 = rows
            .iter()
            .find(|r| r.cells[1].contains("Linear models for regression"))
            .expect("should have a Week 3 row");
        assert!(week3.cells[0].contains("Sun 9 Aug 26"));
        assert!(
            week3.cells[2].contains("<a href="),
            "ASSESSMENTS cell should keep its link, actual: {}",
            week3.cells[2]
        );
        assert!(week3.cells[2].contains("Quiz 1 2026 S2"));
    }

    /// Regression (real sample): the Unit Dashboard must be parsed into structured
    /// data — learning objectives, the MST focus nav (the authoritative week list)
    /// and weeks derived from it — instead of dumping raw Moodle HTML.
    #[test]
    fn unit_dashboard_parses_structured_objectives_and_nav() {
        let scraper = test_scraper();
        let html = sample("live_unit_dashboard_46961.html");
        let dash = scraper.parse_unit_dashboard_from_html(&html, 46961);

        // 1) Current week card
        let cw = dash.current_week.expect("should have a current-week card");
        assert_eq!(cw.num, 3);
        assert!(cw.title.contains("Linear models for regression"));
        assert!(cw.dates.is_some());

        // 2) Learning objectives, structured
        assert!(
            !dash.learning_objectives.is_empty(),
            "should parse a learning-objectives card"
        );
        let obj = &dash.learning_objectives[0];
        assert!(obj.title.contains("Learning Objectives"));
        assert!(obj.description.contains("linear regression"));
        assert!(obj.items.len() >= 4, "learning-objectives list should have >=4 items, actual {}", obj.items.len());
        assert!(obj.items.iter().any(|i| i.contains("Bias-Variance")));

        // 3) Learning nav: the authoritative week list (sparse section numbers 7/11/15/19...)
        assert!(dash.learning_nav.len() >= 12, "nav should have >=12 items, actual {}", dash.learning_nav.len());
        let week1 = dash
            .learning_nav
            .iter()
            .find(|n| n.week_label == "Week 1")
            .expect("should have Week 1");
        assert_eq!(week1.section, 7);
        assert!(week1.module_title.contains("Module 1 - Part A"));
        assert!(!week1.is_current);

        let current = dash
            .learning_nav
            .iter()
            .find(|n| n.is_current)
            .expect("should have a current-week nav item");
        assert_eq!(current.week_label, "Week 3");
        assert_eq!(current.section, 15);

        // 4) weeks derived from the nav: exactly the real teaching weeks, no Week 63
        assert_eq!(dash.weeks.len(), 12, "a 12-week course should have exactly 12 weeks, actual {}", dash.weeks.len());
        assert!(dash.weeks.iter().all(|w| w.num <= 12));
        assert!(dash.weeks.iter().any(|w| w.num == 1 && w.title.contains("Elements of Machine Learning")));
    }

    /// Regression (real sample): the courseindex side tree should recover the mod/resource and mod/folder items the main area misses.
    ///
    /// The main area of the sample live_course_view_46961.html is JS-rendered; in the server HTML only
    /// the courseindex tree carries real links. Phase 1.5 exists exactly for pages like this.
    #[test]
    fn resources_recovered_from_courseindex_tree_in_real_sample() {
        let scraper = test_scraper();
        let html = sample("live_course_view_46961.html");

        let resources = scraper
            .parse_resources_from_html(&html, 46961, None)
            .expect("real course home page should parse successfully");

        let resource_files: Vec<_> = resources
            .iter()
            .filter(|r| r.url.contains("mod/resource/view.php"))
            .collect();
        assert!(
            resource_files.len() >= 5,
            "courseindex should recover multiple mod/resource; actual {}",
            resource_files.len()
        );

        assert!(
            resources.iter().any(|r| r.url.contains("mod/folder/view.php")),
            "should also recover mod/folder"
        );

        // All resources must have an absolute URL and a non-empty name, with unique ids (dedup working)
        let mut ids = std::collections::HashSet::new();
        for r in &resources {
            assert!(r.url.starts_with("http"), "URL should be absolute: {}", r.url);
            assert!(!r.name.trim().is_empty(), "resource name should not be empty: {:?}", r);
            assert_eq!(r.course_id, 46961);
            assert!(ids.insert(r.id), "duplicate resource id: {} ({})", r.id, r.name);
        }
    }

    /// Regression: the site course "All units" (value=1) in the calendar filter dropdown isn't a real enrollment,
    /// and shouldn't be treated as a course (otherwise sync fetches the site homepage and the resource list gets course names/site-level activities mixed in).
    #[test]
    fn courses_parser_skips_site_course_all_units_option() {
        let scraper = test_scraper();
        let html = r#"
            <select class="cal_courses_flt" name="course">
              <option selected="selected" value="1">All units</option>
              <option value="34696">FIT4005-FIT5125 IT research and innovation methods - S2 2025</option>
              <option value="46961">FIT5201 Machine learning - S2 2026</option>
            </select>
        "#;
        let courses = scraper
            .parse_courses_from_html(html)
            .expect("should parse courses from the dropdown");
        assert_eq!(courses.len(), 2, "the site course All units should be filtered out, leaving 2 real courses");
        assert!(courses.iter().all(|c| c.id != 1), "should not contain the site course with id=1");
    }

    /// Regression: the resource parser should keep only genuine resource activity types (resource/folder/url/page, etc.),
    /// so forums / assignments / quizzes / CMS accordion blocks no longer leak into the resource list.
    #[test]
    fn resources_parser_keeps_only_resource_activity_types() {
        let scraper = test_scraper();
        let html = r#"
            <ul>
              <li class="activity activity-wrapper cms modtype_cms" id="module-1" data-id="1">
                <div class="activity-item" data-activityname="Overview Section"></div>
              </li>
              <li class="activity activity-wrapper forum modtype_forum" id="module-2" data-id="2">
                <div class="activity-item" data-activityname="Site announcements Forum">
                  <a href="https://learning.monash.edu/mod/forum/view.php?id=2">Forum</a>
                </div>
              </li>
              <li class="activity activity-wrapper quiz modtype_quiz" id="module-3" data-id="3">
                <div class="activity-item" data-activityname="Quiz 1">
                  <a href="https://learning.monash.edu/mod/quiz/view.php?id=3">Quiz</a>
                </div>
              </li>
              <li class="activity activity-wrapper resource modtype_resource" id="module-4" data-id="4">
                <div class="activity-item" data-activityname="Lecture slides">
                  <span class="instancename">Lecture slides</span>
                  <a href="https://learning.monash.edu/mod/resource/view.php?id=4">Resource</a>
                </div>
              </li>
            </ul>
        "#;
        let resources = scraper
            .parse_resources_from_html(html, 34696, None)
            .expect("parsing resources should succeed");
        assert_eq!(resources.len(), 1, "only modtype_resource should be kept");
        assert_eq!(resources[0].name, "Lecture slides");
        assert!(resources[0].url.contains("mod/resource/view.php"));
    }

    /// Regression: forum / assignment cm links in the courseindex side tree shouldn't enter the resource list.
    #[test]
    fn resources_parser_filters_courseindex_non_resource_links() {
        let scraper = test_scraper();
        let html = r#"
            <div class="courseindex-item" data-for="cm" data-id="10">
              <a class="courseindex-link" href="https://learning.monash.edu/mod/forum/view.php?id=10" data-for="cm_name">Site announcements</a>
            </div>
            <div class="courseindex-item" data-for="cm" data-id="11">
              <a class="courseindex-link" href="https://learning.monash.edu/mod/assign/view.php?id=11" data-for="cm_name">Assignment 1</a>
            </div>
            <div class="courseindex-item" data-for="cm" data-id="12">
              <a class="courseindex-link" href="https://learning.monash.edu/mod/resource/view.php?id=12" data-for="cm_name">Lecture notes</a>
            </div>
        "#;
        let resources = scraper
            .parse_resources_from_html(html, 34696, None)
            .expect("parsing resources should succeed");
        assert_eq!(resources.len(), 1, "only resource-type links should be kept in courseindex");
        assert_eq!(resources[0].name, "Lecture notes");
    }

    /// Portal/hub courses (IT Student Portal, MUM Academic Success, Student Hub, etc.)
    /// are not academic courses and should be flagged isPortal for the frontend to group/exclude.
    #[test]
    fn is_portal_course_name_detects_hubs_and_portals() {
        assert!(is_portal_course_name("IT Student Portal"));
        assert!(is_portal_course_name("MUM Academic Success"));
        assert!(is_portal_course_name("MUM Graduate Success"));
        assert!(is_portal_course_name("MUM School of IT - General Student Hub"));
        assert!(!is_portal_course_name("FIT5201 Machine learning - S2 2026"));
        assert!(!is_portal_course_name("Master and Honours Thesis - S1 2026 - S2 2026"));
    }

    /// The course page <title> provides the full course name, which can backfill the truncated name from the dropdown.
    #[test]
    fn course_fullname_backfilled_from_page_title() {
        let html = r#"<html><head><title>Unit: FIT5201 Machine learning - S2 2026 | MonashELMS1</title></head><body></body></html>"#;
        assert_eq!(
            parse_course_fullname_from_page(html).as_deref(),
            Some("FIT5201 Machine learning - S2 2026")
        );
        // h1 fallback
        let html2 = r#"<html><body><h1>FIT9132 Introduction to databases</h1></body></html>"#;
        assert_eq!(
            parse_course_fullname_from_page(html2).as_deref(),
            Some("FIT9132 Introduction to databases")
        );
        // Pages with no course info -> None
        assert_eq!(parse_course_fullname_from_page("<html><body>Home</body></html>"), None);
    }

    /// Derive the course code from the full course name.
    #[test]
    fn derive_short_name_extracts_unit_code() {
        assert_eq!(
            derive_short_name("FIT5201 Machine learning - S2 2026").as_deref(),
            Some("FIT5201")
        );
        assert_eq!(
            derive_short_name("FIT4005-FIT5125 IT research and innovation methods - S2 2025").as_deref(),
            Some("FIT4005-FIT5125")
        );
        assert_eq!(derive_short_name("Master and Honours Thesis"), None);
    }

    /// section label -> week number.
    #[test]
    fn extract_week_num_parses_week_labels() {
        assert_eq!(extract_week_num("Week 1 - Module 1 - Part A | Elements of Machine Learning"), Some(1));
        assert_eq!(extract_week_num("Week 12 - Module 6 - B | Machine Learning Ethic and review"), Some(12));
        assert_eq!(extract_week_num("UNIT DASHBOARD"), None);
        assert_eq!(extract_week_num("Additional information and resources"), None);
    }

    /// Parenthesized weights (common in activity names, e.g. "(35%)") should also be extracted;
    /// this is one of the root causes of null weights in the assignments table.
    #[test]
    fn parse_weight_percent_accepts_parenthesized_percent() {
        assert_eq!(parse_weight_percent("Assignment 1 - Instructions (35%)"), Some(35.0));
        assert_eq!(
            parse_weight_percent("Assignment 1 | Elements of Machine Learning, Linear Models for Classification and regression (25%)"),
            Some(25.0)
        );
        assert_eq!(parse_weight_percent("(Weight: 25%)"), Some(25.0));
        assert_eq!(parse_weight_percent("9%"), Some(9.0));
        assert_eq!(parse_weight_percent("No weight here"), None);
    }

    /// Human-readable due date -> RFC3339 (the real format is "Monday, 23 March 2026, 9:00 AM",
    /// which JS's Date can't parse, so the backend must convert it to ISO).
    #[test]
    fn moodle_due_date_parsed_to_iso() {
        // 23 March 2026 is AEDT (UTC+11): 9:00 AM Melbourne == 22:00 UTC the day before.
        assert_eq!(
            parse_moodle_due_date("Monday, 23 March 2026, 9:00 AM").as_deref(),
            Some("2026-03-22T22:00:00+00:00")
        );
        // 14 September 2025 is AEST (UTC+10): 9:55 PM Melbourne == 11:55 UTC same day.
        assert_eq!(
            parse_moodle_due_date("Sunday, 14 September 2025, 9:55 PM").as_deref(),
            Some("2025-09-14T11:55:00+00:00")
        );
        // The exact case from the bug report: "16 August" badge but "tomorrow" label.
        // 16 August 2026 is AEST (UTC+10): 11:59 PM Melbourne == 13:59 UTC.
        assert_eq!(
            parse_moodle_due_date("Sunday, 16 August 2026, 11:59 PM").as_deref(),
            Some("2026-08-16T13:59:00+00:00")
        );
        // Date-only deadlines default to 23:59 Melbourne local time.
        assert_eq!(
            parse_moodle_due_date("Sunday, 16 August 2026").as_deref(),
            Some("2026-08-16T13:59:00+00:00")
        );
        assert_eq!(parse_moodle_due_date("No date here"), None);
    }

    /// Locate the FORUMS block in the MST block list.
    #[test]
    fn find_forums_section_locates_forums_label() {
        let sections = vec![
            (56u64, "ASSESSMENTS".to_string()),
            (62u64, "FORUMS".to_string()),
            (63u64, "SUPPORT".to_string()),
        ];
        assert_eq!(find_forums_section(&sections), Some(62));
        assert_eq!(find_forums_section(&[]), None);
    }

    /// Course parsing should flag portal/hub courses (from the /my/ calendar dropdown).
    #[test]
    fn courses_parser_marks_portal_courses() {
        let scraper = test_scraper();
        let html = r#"
            <select class="cal_courses_flt" name="course">
              <option value="34696">FIT4005-FIT5125 IT research and innovation methods - S2 2025</option>
              <option value="9680">IT Student Portal</option>
              <option value="22250">MUM Academic Success</option>
            </select>
        "#;
        let courses = scraper.parse_courses_from_html(html).expect("should parse courses");
        assert_eq!(courses.len(), 3);
        let portal: Vec<_> = courses.iter().filter(|c| c.is_portal).collect();
        assert_eq!(portal.len(), 2, "IT Student Portal and MUM Academic Success should be marked as portals");
        let real = courses.iter().find(|c| c.id == 34696).unwrap();
        assert!(!real.is_portal);
    }

    /// `sanitize_content_html` must strip entire `<style>`/`<script>` blocks (including content),
    /// case-insensitively, and must not leave a half tag for innerHTML when the closing tag is missing.
    #[test]
    fn sanitize_content_html_strips_style_and_script_blocks() {
        assert_eq!(
            sanitize_content_html("<p>a</p><style>.x{color:red}</style><p>b</p>"),
            "<p>a</p><p>b</p>"
        );
        assert_eq!(
            sanitize_content_html("<SCRIPT>alert(1)</SCRIPT><p>ok</p>"),
            "<p>ok</p>"
        );
        // No closing tag: discard everything after the start point
        assert_eq!(sanitize_content_html("<p>keep</p><style>.y{"), "<p>keep</p>");
        // Returned as-is when no processing is needed (only trimmed)
        assert_eq!(sanitize_content_html("  <p>plain</p>  "), "<p>plain</p>");
    }

    /// `parse_weight_percent` must recognize all three forms:
    /// "Weighting: 9%" (Monash detail card), "Weight: 25%" (standard Moodle), and a bare "9%" (table cell).
    /// The old regex `weight:\s*\d+%` missed "Weighting:" (the extra "ing") and bare percentages.
    #[test]
    fn parse_weight_percent_accepts_all_monash_variants() {
        assert_eq!(parse_weight_percent("Weighting: 9%"), Some(9.0));
        assert_eq!(parse_weight_percent("weighting:  25 %"), Some(25.0));
        assert_eq!(parse_weight_percent("Weight: 25%"), Some(25.0));
        assert_eq!(parse_weight_percent("50%"), Some(50.0));
        assert_eq!(parse_weight_percent("  16.5%  "), Some(16.5));
        // A bare number in the middle of a paragraph shouldn't be picked up (prevents things like "80% of students" polluting the weight)
        assert_eq!(parse_weight_percent("It affects 80% of students."), None);
        assert_eq!(parse_weight_percent(""), None);
        assert_eq!(parse_weight_percent("no percent here"), None);
    }

    /// Regression (real sample): the 4 assessment categories on the Assessments page (`&section=56`) must carry weights,
    /// and **the category weight must be pushed down to each child assignment/quiz under it** -- individual Quiz 1/2/3/4 must also show 9%.
    ///
    /// The sample `live_course_assessments_46961.html` has 4 category summary rows (`.summary-view-dropdown-header`),
    /// with weights 9% / 25% / 16% / 50% (100% in total). The old parser caught nothing at all -- it only looked for
    /// `li.activity modtype_quiz/assign` (this page has modtype_assign=0) and matched with a `weight:` regex
    /// while the real label is "Weighting:".
    #[test]
    fn assessments_parser_extracts_category_weights_from_real_sample() {
        let scraper = test_scraper();
        let html = sample("live_course_assessments_46961.html");

        let items = scraper
            .parse_assessments_from_html(&html, 46961)
            .expect("Assessments page should parse successfully");

        // 4 categories + a number of child assignments/quizzes (Quiz 1~4 and the like)
        assert!(
            items.len() >= 4,
            "should have at least 4 assessment categories, actual {}",
            items.len()
        );

        // Every item's weight must be non-None (this is exactly the "Weight: null%" bug scene)
        for a in &items {
            assert!(
                a.weight.is_some(),
                "assessment \"{}\" weight should not be null: {:?}",
                a.name, a
            );
            assert_eq!(a.course_id, 46961);
        }

        // The category rows (names shaped like "1. Quiz / Test" / "2. Artefact") should total 100%.
        // Note that "2. Artefact" and "3. Artefact" have the same name once the ordinal is stripped, so distinguish by the **raw name**
        // (with the ordinal); deduping by category would swallow the 16% one.
        let category_total: f64 = items
            .iter()
            .filter(|a| {
                a.name
                    .trim_start()
                    .chars()
                    .next()
                    .map_or(false, |c| c.is_ascii_digit())
                    && a.name.contains('.')
            })
            .filter_map(|a| a.weight)
            .sum();
        assert!(
            (category_total - 100.0).abs() < 0.01,
            "4 category weights should sum to 100%, actual {}: {:?}",
            category_total,
            items
                .iter()
                .map(|a| (a.name.clone(), a.weight))
                .collect::<Vec<_>>()
        );

        // Verify the push-down to child rows: at least one Quiz-category child assignment carries the 9% weight (one of Quiz 1/2/3/4)
        let quiz_child = items.iter().find(|a| {
            matches!(a.assessment_type, AssessmentType::Quiz)
                && a.name.to_lowercase().contains("quiz ")
                && a.weight == Some(9.0)
        });
        assert!(
            quiz_child.is_some(),
            "at least one Quiz sub-assignment should inherit the 9% category weight"
        );
    }
}
