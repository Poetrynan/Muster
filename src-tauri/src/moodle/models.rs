use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct User {
    pub id: u64,
    pub username: String,
    pub full_name: String,
    pub email: String,
    pub profile_image: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Course {
    pub id: u64,
    pub short_name: String,
    pub full_name: String,
    pub category: String,
    pub visible: bool,
    /// Portal/hub course (IT Student Portal, MUM Academic Success, Student Hub, etc.):
    /// not an academic course, skipped during sync; the frontend can group them separately.
    #[serde(default)]
    pub is_portal: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Resource {
    pub id: u64,
    /// Course ID the resource belongs to. Required when the Dashboard aggregates across
    /// courses, otherwise identically named resources cannot be traced back to a source.
    pub course_id: u64,
    pub name: String,
    /// The section/week the resource belongs to (e.g. "Week 1 - Why Research Methods?").
    /// Stored structurally so the frontend can group/disambiguate, instead of baking the
    /// section into the `name` string.
    pub section: Option<String>,
    /// Week number extracted from the section label ("Week 1 - Module 1..." -> 1), used by
    /// the frontend to collapse by week.
    pub week_num: Option<u32>,
    pub resource_type: ResourceType,
    pub url: String,
    pub file_size: Option<u64>,
    pub modified_date: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum ResourceType {
    #[serde(rename = "pdf")]
    Pdf,
    #[serde(rename = "doc")]
    Doc,
    #[serde(rename = "ppt")]
    Ppt,
    #[serde(rename = "video")]
    Video,
    #[serde(rename = "link")]
    Link,
    #[serde(rename = "folder")]
    Folder,
    #[serde(rename = "other")]
    Other,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Assignment {
    pub id: u64,
    pub name: String,
    pub course_id: u64,
    pub due_date: Option<String>,
    /// Human-readable due date parsed into RFC3339 ISO ("Monday, 23 March 2026, 9:00 AM" ->
    /// "2026-03-23T09:00:00+00:00"), so the frontend can sort/count down directly.
    pub due_date_iso: Option<String>,
    pub status: AssignmentStatus,
    pub grade: Option<String>,
    pub url: Option<String>,
    /// Assessment kind: regular assignment or quiz. Determined from `modtype_assign` /
    /// `modtype_quiz` in the Assessments section. The frontend uses it to pick icon and layout.
    pub assessment_type: AssessmentType,
    /// Weight percentage, e.g. 25.0 means 25%. Extracted from the activity name "(Weight: 25%)"
    /// or from the weight badge.
    pub weight: Option<f64>,
    /// Assessment category, e.g. "Written" / "Quiz / Test" (Assessments section groups by h1/h2
    /// headings).
    pub category: Option<String>,
    /// Whether a submission status exists (Moodle submissionstatus column is neither "-" nor empty).
    /// false = no submission entry / not trackable; excluded from the frontend progress denominator.
    #[serde(default)]
    pub has_submission_status: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum AssignmentStatus {
    #[serde(rename = "pending")]
    Pending,
    #[serde(rename = "submitted")]
    Submitted,
    #[serde(rename = "graded")]
    Graded,
    #[serde(rename = "upcoming")]
    Upcoming,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum AssessmentType {
    #[serde(rename = "assignment")]
    Assignment,
    #[serde(rename = "quiz")]
    Quiz,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Announcement {
    pub id: u64,
    pub title: String,
    pub content: String,
    pub author: String,
    pub date: String,
    pub course_id: u64,
    /// Discussion link (mod/forum/discuss.php?d=N); the frontend navigates to it on click.
    pub url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncStatus {
    pub last_sync: Option<String>,
    pub courses_count: u32,
    pub resources_count: u32,
    pub assignments_count: u32,
    pub announcements_count: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LoginRequest {
    pub username: String,
    pub password: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LoginResponse {
    pub success: bool,
    pub message: String,
    pub user: Option<User>,
}

/// Course participant (member). Populated after parsing `/user/index.php?id=<courseId>`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Member {
    pub id: u64,
    pub name: String,
    /// Role list, e.g. ["Teacher"] / ["Tutor"] / ["Student"].
    pub roles: Vec<String>,
    pub picture_url: Option<String>,
    pub profile_url: Option<String>,
}

/// Course contact (teacher/course team). Parsed from the "Contacts" widget on the course
/// page `course/view.php?id=<courseId>`; needs no extra interaction and carries no student
/// privacy risk.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CourseContact {
    pub name: String,
    pub role: String,
    pub email: String,
    pub picture_url: Option<String>,
}

/// Course handbook (Unit Information section, `&section=1`). Turns MST's CMS blocks
/// (Welcome / Synopsis / Outcomes / Approach / Resources) into structured sections for the
/// frontend Unit Info tab, instead of dumping them into the resource list.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UnitInfo {
    pub course_id: u64,
    pub sections: Vec<UnitInfoSection>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UnitInfoSection {
    pub title: String,
    /// Section body (basic HTML preserved; the frontend renders it carefully via
    /// dangerouslySetInnerHTML).
    pub content_html: String,
}

/// Course schedule / key dates (Schedule section, `&section=2`).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Schedule {
    pub course_id: u64,
    pub items: Vec<ScheduleItem>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScheduleRow {
    /// Table cells of one row; the first row is the header.
    pub cells: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScheduleItem {
    pub title: String,
    pub content_html: String,
    /// Structured table rows extracted from the content (empty when the section has no table).
    #[serde(default)]
    pub rows: Vec<ScheduleRow>,
}

/// Submission status and feedback of a single assignment. Parsed from the assignment detail
/// page (`mod/assign/view.php?id=<id>`).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SubmissionStatus {
    pub assignment_id: u64,
    pub submitted: bool,
    /// Moodle's own "Grading status" row says the work has been marked. Independent of `grade`:
    /// a unit can release feedback while hiding the score, so this is the authoritative signal
    /// for "已评分" and `grade` only carries the display text when there is one.
    pub graded: bool,
    pub grade: Option<String>,
    pub feedback: Option<String>,
    pub due_date: Option<String>,
}

/// Course recording (Panopto sidebar block). Selectors need calibrating against a runtime dump:
/// in the static highlight view the Panopto block is an LTI/iframe placeholder with no direct
/// links; only the real runtime page carries video links / embed ids.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Recording {
    pub id: u64,
    pub title: String,
    pub url: String,
    pub duration: Option<String>,
}

/// A single row of the gradebook user report page (grade/report/user/index.php):
/// one page holds the grades / ranges / feedback for every assignment in the course.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GradeEntry {
    pub course_id: u64,
    pub item: String,
    pub grade: Option<String>,
    pub range: Option<String>,
    pub feedback: Option<String>,
    pub url: Option<String>,
}

/// Unit Dashboard (`&section=0`): the current-week overview card of an MST course page
/// (week number + title + date range) + learning objectives/topics body + index of all weeks.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UnitDashboard {
    pub course_id: u64,
    pub current_week: Option<UnitWeek>,
    pub weeks: Vec<UnitWeek>,
    /// Current-week detail HTML (Learning Objectives / Topics etc.), rendered by the frontend after sanitizing
    pub overview_html: Option<String>,
    /// Structured learning objectives of the current week (parsed from the focus card).
    pub learning_objectives: Vec<LearningObjective>,
    /// Structured learning-path navigation of the current offering (parsed from the MST focus nav).
    pub learning_nav: Vec<LearningNavItem>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LearningObjective {
    pub title: String,
    pub description: String,
    pub items: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LearningNavItem {
    /// Moodle section number (from the nav item's target URL).
    pub section: u64,
    /// Week label, e.g. "Week 1"; empty for auxiliary entries like "Additional information and resources".
    pub week_label: String,
    /// Module title, e.g. "Module 2 - Part A | Linear models for regression".
    pub module_title: String,
    pub is_current: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UnitWeek {
    pub num: u32,
    pub title: String,
    pub dates: Option<String>,
}


/// Calendar event (all courses). Parsed from the /calendar/view.php month view (whole month,
/// day granularity) and the upcoming view (next 21 days, with exact timestamps and course ID),
/// merged by event_id.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CalendarEvent {
    pub id: u64,
    /// Course ID. None for events only available from the month view (which carries no course info).
    pub course_id: Option<u64>,
    /// Event component: mod_quiz / mod_assign / core etc.
    pub component: String,
    /// Event type: close / due / open etc.
    pub event_type: String,
    pub title: String,
    /// Unix seconds. upcoming provides exact timestamps; month-view-only events use 00:00 UTC of that day.
    pub timestamp: u64,
    pub url: String,
}

/// Course quiz list (/mod/quiz/index.php?id=<courseId>).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Quiz {
    /// Activity cmid (view.php?id=<cmid>).
    pub id: u64,
    pub course_id: u64,
    pub name: String,
    /// Raw close time text ("Sunday, 16 August 2026, 9:55 PM").
    pub closes: Option<String>,
    /// Close time as RFC3339 (reuses parse_datetime_to_rfc3339; defaults to 23:59 that day when no time is given).
    pub closes_iso: Option<String>,
    /// Assessment category (e.g. "1. Quiz / Test").
    pub section: String,
    pub url: String,
}

/// Cross-course grade overview row (the Unit name | Grade table of /grade/report/overview/index.php).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GradeOverviewRow {
    pub unit: String,
    /// Raw grade text; "-" when not yet graded.
    pub grade: String,
}


/// All tab data of one course, aggregated by the background pre-fetch (part of the full
/// sync) so the course detail page can render every tab instantly from cache — Unit
/// Dashboard (section=0), Unit Info (section=1), Schedule (section=2), Recordings
/// (Panopto block) and Contacts are fetched while the user is still on the Dashboard.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CourseTabData {
    pub course_id: u64,
    pub dashboard: Option<UnitDashboard>,
    pub unit_info: Option<UnitInfo>,
    pub schedule: Option<Schedule>,
    #[serde(default)]
    pub recordings: Vec<Recording>,
    #[serde(default)]
    pub contacts: Vec<CourseContact>,
}
