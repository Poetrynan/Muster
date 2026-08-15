import { invoke as tauriInvoke } from "@tauri-apps/api/core";
import { listen as tauriListen, type UnlistenFn } from "@tauri-apps/api/event";

// Check if running in Tauri context
const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

// Return invoke if in Tauri context, otherwise null
function getInvoke() {
  if (isTauri) {
    return tauriInvoke;
  }
  return null;
}

// Types — aligned with the Rust models (serde `rename_all = "camelCase"`) and
// the canonical types in `src/types`. Kept here as the wire-format contract.
export interface User {
  id: number;
  username: string;
  fullName: string;
  email: string;
  profileImage: string;
}

export interface Course {
  id: number;
  shortName: string;
  fullName: string;
  category: string;
  visible: boolean;
  /** Portal/hub course (IT Student Portal, Student Hub, etc.), not an academic course */
  isPortal?: boolean;
}

export interface Resource {
  id: number;
  /** Course ID the resource belongs to. Required when the Dashboard aggregates across courses, otherwise same-named resources can't be told apart. */
  courseId: number;
  name: string;
  /** section/week the resource belongs to (e.g. "Week 1 - Why Research Methods?"), structured by the backend, used for frontend grouping/disambiguation */
  section?: string;
  /** Week number extracted from the section label (Week 1 -> 1), used to collapse by week on the frontend */
  weekNum?: number;
  resourceType: string;
  url: string;
  fileSize?: number;
  modifiedDate?: string;
}

export interface Assignment {
  id: number;
  name: string;
  courseId: number;
  dueDate?: string;
  /** Due date in RFC3339 ISO form ("Monday, 23 March 2026, 9:00 AM" can't be parsed by JS Date, so the backend converts it) */
  dueDateIso?: string;
  status: "pending" | "submitted" | "graded" | "upcoming";
  grade?: string;
  url?: string;
  /** Assessment type: regular `assignment` or `quiz` (Task #37, determined by the backend from the Assessments section). */
  assessmentType?: "assignment" | "quiz";
  /** Weight percentage, e.g. 25 means 25% (Task #37, extracted from the activity name "(Weight: 25%)"). */
  weight?: number;
  /** Assessment category, e.g. "Written" / "Quiz / Test" (Task #37, grouping headings from h1/h2 in the Assessments section). */
  category?: string;
  /** Whether a submission status exists ("-" / empty = untrackable, excluded from the progress denominator) */
  hasSubmissionStatus?: boolean;
}

/** Unit handbook (Unit Information section, `&section=1`). Structures MST's CMS blocks into individual sections. */
export interface UnitInfo {
  courseId: number;
  sections: UnitInfoSection[];
}

export interface UnitInfoSection {
  title: string;
  /** Section body (keeps basic HTML, rendered carefully on the frontend with dangerouslySetInnerHTML). */
  contentHtml: string;
}

/** Course schedule / key dates (Schedule section, `&section=2`). */
export interface Schedule {
  courseId: number;
  items: ScheduleItem[];
}

export interface ScheduleRow {
  cells: string[];
}

export interface ScheduleItem {
  title: string;
  contentHtml: string;
  /** Structured table rows (first row = header) when the section contains a table */
  rows?: ScheduleRow[];
}

/** Submission status and feedback for a single assignment (Task #39, parsed from the assignment detail page mod/assign/view.php). */
export interface SubmissionStatus {
  assignmentId: number;
  submitted: boolean;
  grade?: string | null;
  feedback?: string | null;
  dueDate?: string | null;
}

/** Course recording (Panopto block, Task #40). Selectors need calibrating against a runtime dump. */
export interface Recording {
  id: number;
  title: string;
  url: string;
  duration?: string | null;
}

export interface Announcement {
  id: number;
  title: string;
  content: string;
  author: string;
  date: string;
  courseId: number;
  /** Discussion link (discuss.php?d=N), clicking navigates to the corresponding page */
  url?: string;
}

/** Course contact (teacher/course team). Parsed from the Contacts widget on the course page `course/view.php`. */
export interface CourseContact {
  name: string;
  role: string;
  email: string;
  pictureUrl?: string;
}

export interface SyncStatus {
  lastSync?: string;
  coursesCount: number;
  resourcesCount: number;
  assignmentsCount: number;
  announcementsCount: number;
}

export interface LoginResponse {
  success: boolean;
  message: string;
  user?: User;
}

// Return shape of the `load_saved_session` Tauri command (camelCase wire form
// of Rust `SessionInfo { logged_in, user }`).
export interface SessionRestoreInfo {
  loggedIn: boolean;
  user: User | null;
}

export interface CookieData {
  name: string;
  value: string;
  domain: string;
  path: string;
  expires?: string;
}

// Mock data for browser development
const mockUser: User = {
  id: 1,
  username: "student",
  fullName: "Monash Student",
  email: "student@monash.edu",
  profileImage: "",
};

const mockCourses: Course[] = [
  { id: 1, shortName: "FIT1045", fullName: "Introduction to Programming", category: "Engineering", visible: true },
  { id: 2, shortName: "FIT1047", fullName: "Introduction to Computer Systems", category: "Engineering", visible: true },
  { id: 3, shortName: "FIT1051", fullName: "Programming Fundamentals", category: "Engineering", visible: true },
  { id: 4, shortName: "FIT1043", fullName: "Introduction to Data Science", category: "Engineering", visible: true },
  { id: 5, shortName: "MTH1020", fullName: "Analysis of Change", category: "Science", visible: true },
  { id: 6, shortName: "ENG1005", fullName: "Engineering Mathematics", category: "Engineering", visible: true },
];

// API functions with fallback for browser development
export async function login(username: string, password: string): Promise<LoginResponse> {
  try {
    const invoke = getInvoke();
    if (invoke) {
      return await invoke<LoginResponse>("login", { username, password });
    }
    
    // Mock response for browser development
    console.log("[Mock] Login attempt:", username);
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    if (username && password) {
      return {
        success: true,
        message: "Login successful",
        user: mockUser,
      };
    }
    return {
      success: false,
      message: "Invalid username or password",
    };
  } catch (error) {
    console.error("Login error:", error);
    throw error;
  }
}

/// Login with session cookies (from WebView login)
export async function loginWithCookies(cookies: CookieData[]): Promise<LoginResponse> {
  const invoke = getInvoke();
  if (invoke) {
    return invoke<LoginResponse>("login_with_cookies", { cookies });
  }
  
  // Mock response for browser development
  console.log("[Mock] Login with cookies:", cookies.length, "cookies");
  await new Promise(resolve => setTimeout(resolve, 500));
  
  return {
    success: true,
    message: "Login successful",
    user: mockUser,
  };
}

/// Load saved session from disk. Returns restore info so the caller can set
/// both `isLoggedIn` and the `user` object (fixes placeholder user on restart).
export async function loadSavedSession(): Promise<SessionRestoreInfo> {
  const invoke = getInvoke();
  if (invoke) {
    return invoke<SessionRestoreInfo>("load_saved_session");
  }
  // Mock fallback for browser dev — no persisted session.
  return { loggedIn: false, user: null };
}

/// Listen for session-expired event from backend
export async function onSessionExpired(callback: () => void): Promise<UnlistenFn> {
  if (isTauri) {
    return tauriListen("session-expired", () => {
      callback();
    });
  }
  return () => {};
}

export async function logout(): Promise<void> {
  const invoke = getInvoke();
  if (invoke) {
    return invoke<void>("logout");
  }
  console.log("[Mock] Logout");
}

export async function isLoggedIn(): Promise<boolean> {
  const invoke = getInvoke();
  if (invoke) {
    return invoke<boolean>("is_logged_in");
  }
  return false;
}

export async function fetchCourses(): Promise<Course[]> {
  const invoke = getInvoke();
  if (invoke) {
    return invoke<Course[]>("fetch_courses");
  }
  return mockCourses;
}

export async function fetchCourseResources(courseId: number): Promise<Resource[]> {
  const invoke = getInvoke();
  if (invoke) {
    return invoke<Resource[]>("fetch_course_resources", { courseId });
  }
  return [
    { id: 1, courseId, name: "Lecture 01 - Introduction.pdf", resourceType: "pdf", url: "#", fileSize: 2500000, modifiedDate: "2026-07-15" },
    { id: 2, courseId, name: "Lecture 02 - Variables.pdf", resourceType: "pdf", url: "#", fileSize: 3100000, modifiedDate: "2026-07-22" },
  ];
}

export async function fetchAssignments(courseId: number): Promise<Assignment[]> {
  const invoke = getInvoke();
  if (invoke) {
    return invoke<Assignment[]>("fetch_assignments", { courseId });
  }
  return [
    { id: 1, name: "Assignment 1 - Python Basics", courseId, dueDate: "2026-08-15", status: "pending" },
    { id: 2, name: "Quiz 1 - Week 1-3", courseId, dueDate: "2026-08-01", status: "submitted", grade: "85/100" },
  ];
}

export async function fetchAnnouncements(courseId: number): Promise<Announcement[]> {
  const invoke = getInvoke();
  if (invoke) {
    return invoke<Announcement[]>("fetch_announcements", { courseId });
  }
  return [
    { id: 1, title: "Welcome to the course!", content: "Welcome message...", author: "Dr. Smith", date: "2026-07-10", courseId },
  ];
}

/**
 * Fetch course contacts (teachers/course team).
 * The backend parses the Contacts widget on the course page `course/view.php?id=<courseId>`, teachers only.
 */
export async function fetchCourseContacts(courseId: number): Promise<CourseContact[]> {
  const invoke = getInvoke();
  if (invoke) {
    return invoke<CourseContact[]>("fetch_course_contacts", { courseId });
  }
  return [];
}

/**
 * Fetch the course assessment overview (Assessments section): assignments + quizzes + weights + categories.
 * The backend parses `course/view.php?id=<courseId>&section=56`, which is more complete than the default assignment list used during sync.
 */
export async function fetchCourseAssessments(courseId: number): Promise<Assignment[]> {
  const invoke = getInvoke();
  if (invoke) {
    return invoke<Assignment[]>("fetch_course_assessments", { courseId });
  }
  return [
    { id: 1, name: "Assignment 1 - Python Basics", courseId, dueDate: "2026-08-15", status: "pending", assessmentType: "assignment", weight: 25, category: "Written" },
    { id: 2, name: "Quiz 1 - Week 1-3", courseId, dueDate: "2026-08-01", status: "submitted", grade: "85/100", assessmentType: "quiz", weight: 10, category: "Quiz / Test" },
  ];
}

/**
 * Fetch the unit handbook (Unit Information section, `&section=1`).
 * The backend parses the CMS blocks (Welcome / Synopsis / Outcomes / Approach / Resources) into a list of sections.
 */
export async function fetchCourseUnitInfo(courseId: number): Promise<UnitInfo> {
  const invoke = getInvoke();
  if (invoke) {
    return invoke<UnitInfo>("fetch_course_unit_info", { courseId });
  }
  return {
    courseId,
    sections: [
      { title: "Welcome", contentHtml: "<p>Welcome to the course. This unit introduces ...</p>" },
      { title: "Synopsis", contentHtml: "<p>This unit covers the fundamentals of ...</p>" },
      { title: "Outcomes", contentHtml: "<ul><li>Understand ...</li><li>Apply ...</li></ul>" },
    ],
  };
}

/**
 * Fetch the course schedule / key dates (Schedule section, `&section=2`).
 */
export async function fetchCourseSchedule(courseId: number): Promise<Schedule> {
  const invoke = getInvoke();
  if (invoke) {
    return invoke<Schedule>("fetch_course_schedule", { courseId });
  }
  return {
    courseId,
    items: [
      { title: "Week 1 - Lecture", contentHtml: "<p>Mon 10:00-12:00, Room CLT" },
      { title: "Week 1 - Tutorial", contentHtml: "<p>Wed 14:00-15:00, Lab 1</p>" },
    ],
  };
}

/**
 * Fetch the submission status and feedback for a single assignment (Task #39).
 * The backend fetches and parses the assignment detail page `mod/assign/view.php?id=<assignmentId>`.
 */
export async function fetchAssignmentSubmission(
  courseId: number,
  assignmentId: number
): Promise<SubmissionStatus> {
  const invoke = getInvoke();
  if (invoke) {
    return invoke<SubmissionStatus>("fetch_assignment_submission", { courseId, assignmentId });
  }
  return {
    assignmentId,
    submitted: true,
    grade: "18/20",
    feedback: "Good work. Clear structure and correct reasoning. Watch the edge cases in Q3.",
    dueDate: "2026-08-15",
  };
}

/**
 * Fetch course recordings (Panopto block, Task #40).
 * The backend parses the Panopto sidebar on the course page; the static highlight view has no direct links, so it needs calibrating against a runtime dump.
 */
export async function fetchCourseRecordings(courseId: number): Promise<Recording[]> {
  const invoke = getInvoke();
  if (invoke) {
    return invoke<Recording[]>("fetch_course_recordings", { courseId });
  }
  return [
    { id: 1, title: "Lecture 01 - Introduction", url: "https://monash.au.panopto.com/Panopto/Pages/Viewer.aspx?id=mock1", duration: "50:12" },
    { id: 2, title: "Lecture 02 - Variables", url: "https://monash.au.panopto.com/Panopto/Pages/Viewer.aspx?id=mock2", duration: "47:30" },
  ];
}

// ---- Download manager: progress events emitted by the backend during streamed downloads ----
export interface DownloadProgress {
  key: string;
  received: number;
  total: number | null;
}

export interface DownloadItem {
  key: string;
  name: string;
  received: number;
  total: number | null;
  speed: number;
  status: "downloading" | "done" | "error";
  path?: string;
  error?: string;
  lastTick: number;
}

export async function onDownloadProgress(
  cb: (p: DownloadProgress) => void
): Promise<UnlistenFn> {
  return tauriListen<DownloadProgress>("download-progress", (e) => cb(e.payload));
}

// ---- Unit Dashboard (section=0) ----
export interface UnitWeek {
  num: number;
  title: string;
  dates?: string | null;
}

export interface LearningObjective {
  title: string;
  description: string;
  items: string[];
}

export interface LearningNavItem {
  section: number;
  weekLabel: string;
  moduleTitle: string;
  isCurrent: boolean;
}

export interface UnitDashboard {
  courseId: number;
  currentWeek?: UnitWeek | null;
  weeks: UnitWeek[];
  overviewHtml?: string | null;
  learningObjectives: LearningObjective[];
  learningNav: LearningNavItem[];
}

export interface CalendarEvent {
  id: number;
  /** Course ID. Null for events that are only available from the month view. */
  courseId?: number;
  /** Event component: mod_quiz / mod_assign / core, etc. */
  component: string;
  /** Event type: close / due / open, etc. */
  eventType: string;
  title: string;
  /** Unix seconds. upcoming provides an exact time; month-view-only events are 00:00 UTC on the day. */
  timestamp: number;
  url: string;
}

export interface Quiz {
  /** Activity cmid (view.php?id=<cmid>). */
  id: number;
  courseId: number;
  name: string;
  /** Raw close time ("Sunday, 16 August 2026, 9:55 PM"). */
  closes?: string;
  /** Close time in RFC3339. */
  closesIso?: string;
  section: string;
  url: string;
}

/** Cross-course grade overview row (/grade/report/overview/index.php). */
export interface GradeOverviewRow {
  unit: string;
  /** Raw grade text; "-" when not yet graded. */
  grade: string;
}

export interface GradeEntry {
  courseId: number;
  item: string;
  grade?: string | null;
  range?: string | null;
  feedback?: string | null;
  url?: string | null;
}

export async function fetchCalendarEvents(): Promise<CalendarEvent[]> {
  const invoke = getInvoke();
  if (invoke) {
    return invoke<CalendarEvent[]>("fetch_calendar_events");
  }
  return [];
}

export async function fetchCourseQuizzes(courseId: number): Promise<Quiz[]> {
  const invoke = getInvoke();
  if (invoke) {
    return invoke<Quiz[]>("fetch_course_quizzes", { courseId });
  }
  return [];
}

export async function fetchGradeOverview(): Promise<GradeOverviewRow[]> {
  const invoke = getInvoke();
  if (invoke) {
    return invoke<GradeOverviewRow[]>("fetch_grade_overview");
  }
  return [];
}

export async function fetchCourseGradebook(courseId: number): Promise<GradeEntry[]> {
  const invoke = getInvoke();
  if (!invoke) return [];
  return invoke<GradeEntry[]>("fetch_course_gradebook", { courseId });
}

export async function fetchUnitDashboard(courseId: number): Promise<UnitDashboard> {
  const invoke = getInvoke();
  if (!invoke) return { courseId, weeks: [], learningObjectives: [], learningNav: [] };
  return invoke<UnitDashboard>("fetch_course_unit_dashboard", { courseId });
}

export async function syncAll(): Promise<{
  courses: Course[];
  resources: Resource[];
  assignments: Assignment[];
  announcements: Announcement[];
}> {
  const invoke = getInvoke();
  if (invoke) {
    const result = invoke<[Course[], Resource[], Assignment[], Announcement[]]>("sync_all");
    const [courses, resources, assignments, announcements] = await result;
    return { courses, resources, assignments, announcements };
  }
  
  // P2: parallelized mock — all 3 resource kinds for every course are requested at once, cutting wait time by about 60%
  const results = await Promise.all(
    mockCourses.map(async (course) => {
      const [courseResources, courseAssignments, courseAnnouncements] = await Promise.all([
        fetchCourseResources(course.id),
        fetchAssignments(course.id),
        fetchAnnouncements(course.id),
      ]);
      return { course, courseResources, courseAssignments, courseAnnouncements };
    })
  );

  const allResources: Resource[] = [];
  const allAssignments: Assignment[] = [];
  const allAnnouncements: Announcement[] = [];

  for (const { course, courseResources, courseAssignments, courseAnnouncements } of results) {
    allResources.push(...courseResources.map(r => ({ ...r, courseId: course.id })));
    allAssignments.push(...courseAssignments);
    allAnnouncements.push(...courseAnnouncements);
  }

  return {
    courses: mockCourses,
    resources: allResources,
    assignments: allAssignments,
    announcements: allAnnouncements,
  };
}

export interface SyncProgress {
  done: number;
  total: number;
  phase: string;
}

export interface AiConnectionTest {
  ok: boolean;
  message: string;
  status?: number;
}

/// Send a 1-token ping to the user's configured AI endpoint to verify connectivity
export async function testAiConnection(apiKey: string, apiUrl: string, model: string): Promise<AiConnectionTest> {
  const invoke = getInvoke();
  if (invoke) {
    return invoke<AiConnectionTest>("test_ai_connection", { apiKey, apiUrl, model });
  }
  // Browser dev mock
  await new Promise((resolve) => setTimeout(resolve, 600));
  return { ok: true, message: "Connected (mock)" };
}

/// Listen for real-time sync progress events emitted by the backend during fetch_all_data
export async function onSyncProgress(cb: (p: SyncProgress) => void): Promise<UnlistenFn> {
  if (isTauri) {
    return tauriListen<SyncProgress>("sync-progress", (e) => cb(e.payload));
  }
  return () => {};
}

export async function getSyncStatus(): Promise<SyncStatus> {
  const invoke = getInvoke();
  if (invoke) {
    return invoke<SyncStatus>("get_sync_status");
  }
  return {
    lastSync: new Date().toISOString(),
    coursesCount: mockCourses.length,
    resourcesCount: 12,
    assignmentsCount: 5,
    announcementsCount: 3,
  };
}

/// Start SSO login with system browser
export async function startSSOLogin(): Promise<LoginResponse> {
  const invoke = getInvoke();
  if (invoke) {
    return await invoke<LoginResponse>("start_sso_login");
  }
  
  // Mock response for browser development
  console.log("[Mock] Start SSO login");
  await new Promise(resolve => setTimeout(resolve, 2000));
  
  return {
    success: true,
    message: "Login successful",
    user: mockUser,
  };
}

/// Start SSO login with WebView window
export async function startSSOLoginWebView(): Promise<LoginResponse> {
  const invoke = getInvoke();
  if (invoke) {
    return await invoke<LoginResponse>("start_sso_login_webview");
  }
  
  // Mock response for browser development
  console.log("[Mock] Start SSO login with WebView");
  await new Promise(resolve => setTimeout(resolve, 2000));
  
  return {
    success: true,
    message: "Login successful",
    user: mockUser,
  };
}


/// Download a file from Moodle to local storage
export async function downloadFile(fileUrl: string, savePath: string): Promise<string> {
  const invoke = getInvoke();
  if (invoke) {
    return invoke<string>("download_file", { fileUrl, savePath });
  }
  console.log("[Mock] Download file:", fileUrl, "to", savePath);
  await new Promise(resolve => setTimeout(resolve, 1000));
  return savePath;
}

/// Save AI configuration in Rust backend
export async function saveAiConfig(
  apiKey: string,
  apiUrl: string,
  model: string
): Promise<void> {
  const invoke = getInvoke();
  if (invoke) {
    await invoke("save_ai_config", { apiKey, apiUrl, model });
  }
}

export interface SummaryStreamEvent {
  type: "chunk" | "done" | "error";
  text?: string;
  error?: string;
  /** True when the chunk is the model's reasoning process (no final content yet). */
  thinking?: boolean;
}

/// Streaming AI summary: the frontend generates a streamId and registers the event listener first,
/// then the Rust side pushes incremental text through the `summary-{streamId}` event as it arrives.
export async function generateSummaryStream(
  content: string,
  apiKey: string,
  apiUrl: string,
  model: string,
  callbacks: {
    onChunk: (text: string, thinking?: boolean) => void;
    onDone: () => void;
    onError: (error: string) => void;
  }
): Promise<void> {
  if (!isTauri) {
    // Browser dev environment: no Tauri bridge, emit a one-shot mock output
    const mock =
      "This is a mock AI summary. Configure an API key and open the desktop app to use real streaming summaries.";
    callbacks.onChunk(mock);
    callbacks.onDone();
    return;
  }
  const streamId =
    (crypto?.randomUUID?.() as string) ||
    `s-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  let unlisten: (() => void) | undefined;
  unlisten = await tauriListen<SummaryStreamEvent>(`summary-${streamId}`, (e) => {
    const p = e.payload;
    if (p.type === "chunk" && p.text) {
      callbacks.onChunk(p.text, p.thinking);
    } else if (p.type === "done") {
      unlisten?.();
      callbacks.onDone();
    } else if (p.type === "error") {
      unlisten?.();
      callbacks.onError(p.error || "Stream failed");
    }
  });
  try {
    const inv = getInvoke();
    if (!inv) {
      callbacks.onError("Tauri bridge unavailable");
      return;
    }
    await inv("generate_summary_stream", { content, apiKey, apiUrl, model, streamId });
  } catch (err) {
    unlisten?.();
    callbacks.onError(err instanceof Error ? err.message : String(err));
  }
}

/// Generate an AI summary of course content
export async function generateSummary(
  content: string,
  apiKey?: string,
  apiUrl?: string,
  model?: string
): Promise<string> {
  const invoke = getInvoke();
  if (invoke) {
    return invoke<string>("generate_summary", {
      content,
      apiKey: apiKey || null,
      apiUrl: apiUrl || null,
      model: model || null,
    });
  }
  console.log("[Mock] Generate summary for content:", content.length, "characters");
  await new Promise(resolve => setTimeout(resolve, 2000));
  return "This is a mock AI summary. Configure an API key to use the real AI summary feature.";
}
