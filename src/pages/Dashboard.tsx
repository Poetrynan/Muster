import {
  BookOpen,
  Calendar,
  Home,
  LogOut,
  Settings,
  User,
  Bell,
  Search,
  GraduationCap,
  FileText,
  ChevronRight,
  Sun,
  Moon,
  Download,
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  CheckCheck,
  Video,
  FolderOpen,
  CalendarDays,
  ClipboardList,
  X,
  CloudDownload,
  Loader2,
  Sparkles,
} from "lucide-react";
import { useEffect, useState, lazy, Suspense, useCallback, useMemo, useRef } from "react";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Badge } from "../components/ui/badge";
import { EmptyBox } from "../components/ui/empty-box";
import { GradeEmptyIllustration } from "../components/ui/grade-empty-illustration";
import { Skeleton } from "../components/ui/skeleton";
import { Input } from "../components/ui/input";
import { useAppStore } from "../stores/useAppStore";
import { checkForAppUpdates, getCurrentAppVersion, installUpdateInApp, relaunchApp, type ReleaseInfo } from "../services/updater";
import { DownloadCenter } from "../components/DownloadCenter";
import { DownloadProgressRing } from "../components/ui/download-progress-ring";
import { showToast } from "../components/ui/toast";
import { LanguageSelect } from "../components/LanguageSelect";
import { fetchCourses, syncAll, downloadFile, onDownloadProgress, fetchCalendarEvents, fetchGradeOverview, onSyncProgress } from "../services/api";
import { batchDownload } from "../services/batchDownload";
// Reopening the app within this window after the last auto sync renders from local
// data instead of re-scraping everything (user request: "1 小时内关闭再打开不重新抓取").
const LAUNCH_SYNC_COOLDOWN_MS = 60 * 60 * 1000;

// Announcement type classifier: infer type from title + body keywords (rule-first, covers both Chinese and English).
function classifyAnnouncement(
  title: string,
  content: string
): "assignment" | "quiz" | "exam" | "resource" | "grade" | "general" {
  const t = `${title} ${content || ""}`.toLowerCase();
  if (/(assignment|task|submission|作业|任务|提交|deadline|截止)/.test(t)) return "assignment";
  if (/(quiz|test|测验)/.test(t)) return "quiz";
  if (/(exam|midterm|final|考试|期末|exam)/.test(t)) return "exam";
  if (/(grade|result|score|成绩|分数|评分|feedback|反馈)/.test(t)) return "grade";
  if (/(lecture|week|module|slide|课件|资料|讲义|笔记|recording|录播)/.test(t)) return "resource";
  return "general";
}

import { isTermEnded, computeSavePath, isDownloadableUrl } from "../lib/utils";
import {
  findDueAssignments,
  diffAnnouncements,
  diffResources,
  getReminded,
  markReminded,
  showSystemNotification,
} from "../services/reminders";
import type { Resource, CalendarEvent, GradeOverviewRow } from "../services/api";

// Parse term marker from course name: "FIT5215 Deep learning - S2 2025" -> "S2 2025";
// "Master and Honours Thesis - S1 2026 - S2 2026" -> "S1 2026 - S2 2026"; null if none
// Moodle hands us one messy string per course, e.g. "FIT5201 Machine learning - S2 2026".
// Worse, before a full sync the scraper's short_name and full_name are byte-identical
// (split_course_name only splits on a colon, and Monash link text has none), so rendering
// both puts the same sentence on the card banner and the card title. These helpers cut the
// string into the three things a card should show exactly once: code, name, term.
const COURSE_CODE_RE = /^([A-Z]{2,6}\d{2,6}(?:-[A-Z]{2,6}\d{2,6})?)/;
const TERM_RE = /\bS[12]\s*[\u002D\u2013\u2014]?\s*\d{4}\b/gi;

/** Collapse the tabs and double spaces Moodle's markup leaves in link text. */
function tidyName(raw: string): string {
  return raw.replace(/\s+/g, " ").trim();
}

function extractTerm(name: string): string | null {
  if (!name) return null;
  const matches = name.match(TERM_RE);
  if (!matches || matches.length === 0) return null;
  return [...new Set(matches.map((m) => m.toUpperCase()))].join(" - ");
}

/**
 * Split a raw course name into the card's three slots.
 * `code` mirrors derive_short_name in scraper.rs so the card reads the same before and
 * after a sync; it is null for courses that have no code (portal pages, thesis units),
 * which show an icon on the banner instead of repeating the title.
 * `title` is the name with the code and the term removed, since both are shown elsewhere.
 */
function describeCourse(raw: string): { code: string | null; title: string; term: string | null } {
  const tidied = tidyName(raw);
  const code = tidied.match(COURSE_CODE_RE)?.[1] ?? null;
  const stripped = tidied.replace(COURSE_CODE_RE, "").replace(TERM_RE, "");
  // Splitting on a spaced separator and dropping the empty pieces is easier to reason
  // about than a regex that must decide which dangling dash it is looking at, and it
  // never touches a hyphen inside a word ("e-commerce") because the spaces are required.
  const title = stripped
    .split(/\s+[\u002D\u2013\u2014:|]+\s*|^[\u002D\u2013\u2014:|]+\s*/)
    .map((p) => p.trim())
    // A name like "Master and Honours Thesis - S1 2026 - S2 2026" leaves two adjacent
    // separators behind, and the second one survives the split as a lone "-" fragment.
    .filter((p) => p && !/^[\u002D\u2013\u2014:|]+$/.test(p))
    .join(" - ");
  return {
    code,
    // Nothing left to say means the whole name was the code, which the banner already
    // shows; fall back to the raw string only when there is no banner text to duplicate.
    title: title || (code ? "" : tidied),
    term: extractTerm(tidied),
  };
}
import appIcon from "../assets/app-icon.png";
import { useTranslation } from "../i18n/useTranslation";
import type { TranslationKey } from "../i18n/translations";

// P2: React.lazy code splitting — sub-pages load on demand, first-screen bundle shrinks ~40%
const AssignmentsPage = lazy(() => import("./AssignmentsPage").then(m => ({ default: m.AssignmentsPage })));
const SettingsPage = lazy(() => import("./SettingsPage").then(m => ({ default: m.SettingsPage })));
const CourseDetail = lazy(() => import("./CourseDetail").then(m => ({ default: m.CourseDetail })));

// Loading placeholder for sub-pages: a skeleton that mirrors the real page
// layout (sidebar + header + tabs + content list) instead of a spinner.
function PageLoading() {
  return (
    <div className="min-h-screen bg-background flex" aria-busy="true" aria-label="Loading">
      {/* Sidebar skeleton: back button + course color block + title + stats */}
      <aside className="w-72 glass border-r flex flex-col shrink-0">
        <div className="p-4 border-b">
          <Skeleton className="h-9 w-20" />
        </div>
        <div className="p-6 border-b space-y-3">
          <Skeleton className="h-24 w-full rounded-2xl" />
          <Skeleton className="h-5 w-3/4" />
          <Skeleton className="h-3 w-1/2" />
        </div>
      </aside>
      {/* Main content skeleton: header + tabs + resource rows */}
      <main className="flex-1 flex flex-col overflow-hidden">
        <header className="h-16 border-b glass flex items-center px-6 gap-4">
          <Skeleton className="h-5 w-5 rounded" />
          <Skeleton className="h-4 w-24" />
        </header>
        <div className="flex-1 overflow-auto p-6">
          <div className="flex gap-2 mb-6">
            <Skeleton className="h-9 w-20 rounded-full" />
            <Skeleton className="h-9 w-24 rounded-full" />
            <Skeleton className="h-9 w-20 rounded-full" />
          </div>
          <div className="space-y-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="rounded-2xl border bg-card p-4 flex items-start gap-3">
                <Skeleton className="h-10 w-10 rounded-xl shrink-0" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-4 w-2/3" />
                  <Skeleton className="h-3 w-1/3" />
                  <Skeleton className="h-3 w-1/2" />
                </div>
              </div>
            ))}
          </div>
        </div>
      </main>
    </div>
  );
}

// Navigation items with proper icon + text labels (UX: nav-label-icon)
const sidebarItems: { icon: any; labelKey: TranslationKey; id: string }[] = [
  { icon: Home, labelKey: "nav.home", id: "home" },
  { icon: BookOpen, labelKey: "nav.courses", id: "courses" },
  { icon: Calendar, labelKey: "nav.assignments", id: "assignments" },
  { icon: FileText, labelKey: "nav.resources", id: "resources" },
  { icon: CalendarDays, labelKey: "nav.calendar", id: "calendar" },
  { icon: Bell, labelKey: "nav.notifications", id: "notifications" },
  { icon: Settings, labelKey: "nav.settings", id: "settings" },
];

// Minimum interval between manual syncs (rate limit for the refresh button).
const MANUAL_SYNC_COOLDOWN_MS = 60_000;

export function Dashboard() {
  const [activeTab, setActiveTab] = useState("home");
  const [calFilter, setCalFilter] = useState("all");
  const [notifTypeFilter, setNotifTypeFilter] = useState("all");
  const [notifHistoryOpen, setNotifHistoryOpen] = useState(false);
  const [selectedCourseId, setSelectedCourseId] = useState<number | null>(null);
  const [isLoadingCourses, setIsLoadingCourses] = useState(false);
  const [syncProgress, setSyncProgress] = useState<{ done: number; total: number; phase: string } | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  // Batch download: selection is keyed by resource URL (matches the download-manager key).
  const [selectedResourceUrls, setSelectedResourceUrls] = useState<Set<string>>(new Set());
  const [batchDownloading, setBatchDownloading] = useState(false);
  const toggleResource = (url: string) =>
    setSelectedResourceUrls((prev) => {
      const next = new Set(prev);
      if (next.has(url)) next.delete(url);
      else next.add(url);
      return next;
    });
  const handleBatchDownloadSelected = async () => {
    if (batchDownloading) return;
    const selected = resources.filter((r) => r.url && isDownloadableUrl(r.url) && selectedResourceUrls.has(r.url));
    if (selected.length === 0) return;
    setBatchDownloading(true);
    try {
      await batchDownload(selected, t);
      setSelectedResourceUrls(new Set());
    } finally {
      setBatchDownloading(false);
    }
  };
  const [manualSyncCooldown, setManualSyncCooldown] = useState(false);
  const {
    user,
    isLoggedIn,
    settings,
    updateSettings,
    courses: rawCourses = [],
    setCourses: setStoreCourses,
    allResources: rawResources = [],
    assignments: rawAssignments = [],
    announcements: rawAnnouncements = [],
    readAnnouncementIds = [],
    markAnnouncementRead,
    markAllAnnouncementsRead,
    syncStatus,
    setSyncStatus,
    updateAllSyncedData,
    reminderBanner,
    setReminderBanner,
    reset,
    downloads,
    upsertDownload,
    calendarEvents,
    setCalendarEvents,
    gradeOverview,
    setGradeOverview,
  } = useAppStore();

  const { t } = useTranslation();

  // P1: extract the real error message — Tauri's invoke rejects with a plain string rather than an Error instance,
  // so we must handle string / { message } / Error, otherwise the actual Rust error gets swallowed by the i18n fallback text.
  const errMsg = (e: unknown, fallbackKey: TranslationKey): string => {
    if (e instanceof Error) return e.message;
    if (typeof e === "string") return e;
    if (e && typeof e === "object" && "message" in e) {
      const m = (e as Record<string, unknown>).message;
      if (typeof m === "string") return m;
    }
    return t(fallbackKey);
  };

  const courses = Array.isArray(rawCourses) ? rawCourses : [];
  const resources = Array.isArray(rawResources) ? rawResources : [];
  const assignments = Array.isArray(rawAssignments) ? rawAssignments : [];
  const announcements = Array.isArray(rawAnnouncements) ? rawAnnouncements : [];
  // Portal/hub courses are excluded from stats and resource aggregation
  const realCourses = courses.filter((c: any) => !c.isPortal);

  // Assignment stat counts — aligned with the AssignmentsPage left sidebar so
  // the dashboard numbers never disagree with the assignments list:
  //   - Untracked items (hasSubmissionStatus === false, the "41 无提交状态" group)
  //     are excluded from the pending denominator
  //   - Ended-term courses are excluded so last-semester leftovers don't inflate
  //     the dashboard pending count
  const pendingAssignmentsCount = assignments.filter((a: any) => {
    if (!a) return false;
    if (a.status === "submitted" || a.status === "graded") return false;
    if (a.hasSubmissionStatus === false) return false;
    const course = courses.find((c: any) => c?.id === a.courseId);
    if (isTermEnded(course?.fullName || course?.shortName)) return false;
    return true;
  }).length;
  const completedAssignmentsCount = assignments.filter((a: any) =>
    a && (a.status === "submitted" || a.status === "graded")
  ).length;

  // ---- Download manager (browser-style: progress + speed + status) ----
  const dlTick = useRef(new Map<string, { t: number; r: number }>());

  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | undefined;
    onDownloadProgress((p) => {
      if (cancelled) return;
      const now = Date.now();
      const prev = dlTick.current.get(p.key);
      let speed = 0;
      if (prev && now > prev.t) {
        speed = ((p.received - prev.r) * 1000) / (now - prev.t);
      }
      dlTick.current.set(p.key, { t: now, r: p.received });
      const st2 = useAppStore.getState();
      const existing = st2.downloads.find((x) => x.key === p.key);
      if (existing) {
        st2.upsertDownload({
          ...existing,
          received: p.received,
          total: p.total ?? existing.total,
          speed: Math.max(0, speed),
          lastTick: now,
        });
      }
    }).then((u) => {
      unlisten = u;
    });
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  // Notification click-through: open the discussion page in the in-app WebView (shares the SSO session), fall back to the external browser
  const openAnnouncement = async (url: string) => {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("open_in_app_webview", { url, title: "Moodle" });
    } catch {
      try {
        const { openUrl } = await import("@tauri-apps/plugin-opener");
        await openUrl(url);
      } catch { /* silent */ }
    }
  };
  // ---- Resources page: search + type filter + group by course + large-list truncation (perf) ----
  const [resourceQuery, setResourceQuery] = useState("");
  const [resourceTypeFilter, setResourceTypeFilter] = useState<"all" | "file" | "link" | "folder">("all");
  const [expandedCourses, setExpandedCourses] = useState<Set<number>>(new Set());
  // Unit-level primary filter: once a course is selected only its resources render, cutting the DOM from hundreds of cards to dozens and fixing the lag
  const [selectedResourceCourseId, setSelectedResourceCourseId] = useState<number | null>(null);

  const filteredResources = useMemo(() => {
    const q = resourceQuery.trim().toLowerCase();
    // Site course id=1 ("All units") is not a real enrolment; old caches may contain noise from that page, so drop it outright
    const list = resources.filter((r) => r.courseId !== 1);
    const typed =
      resourceTypeFilter === "all"
        ? list
        : list.filter((r) => {
            const t = (r.resourceType || "other").toLowerCase();
            if (resourceTypeFilter === "file") return ["pdf", "doc", "ppt", "video"].includes(t);
            return t === resourceTypeFilter;
          });
    if (!q) return typed;
    return typed.filter(
      (r) =>
        (r.name || "").toLowerCase().includes(q) ||
        (r.section || "").toLowerCase().includes(q)
    );
  }, [resources, resourceQuery, resourceTypeFilter]);

  // Batch-download selection helpers (depend on the filtered list above)
  const filteredDownloadable = filteredResources.filter((r) => r.url && isDownloadableUrl(r.url));
  const allFilteredSelected =
    filteredDownloadable.length > 0 && filteredDownloadable.every((r) => selectedResourceUrls.has(r.url!));
  const toggleSelectAll = () =>
    setSelectedResourceUrls((prev) => {
      const next = new Set(prev);
      if (allFilteredSelected) {
        for (const r of filteredDownloadable) next.delete(r.url!);
      } else {
        for (const r of filteredDownloadable) next.add(r.url!);
      }
      return next;
    });

  const groupedResources = useMemo(() => {
    const map = new Map<number, Resource[]>();
    for (const r of filteredResources) {
      const key = r.courseId ?? 0;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(r);
    }
    const labelOf = (id: number): string => {
      if (id === 0) return t("dashboard.resourcesUnknownCourse");
      const c = courses.find((x) => x.id === id);
      return c?.shortName || c?.fullName || `Course ${id}`;
    };
    return Array.from(map.entries()).sort((a, b) =>
      labelOf(a[0]).localeCompare(labelOf(b[0]))
    );
  }, [filteredResources, courses, t]);

  const toggleExpand = (courseId: number) =>
    setExpandedCourses((prev) => {
      const next = new Set(prev);
      if (next.has(courseId)) {
        next.delete(courseId);
      } else {
        next.add(courseId);
      }
      return next;
    });

  // Unit-level primary filter: keep only the selected course's resources (search/type filters still apply)
  const unitScopedResources = useMemo(() => {
    if (selectedResourceCourseId == null) return filteredResources;
    return filteredResources.filter((r) => r.courseId === selectedResourceCourseId);
  }, [filteredResources, selectedResourceCourseId]);

  // Top Unit tabs: resource count + display name per course
  const unitOptions = useMemo(() => {
    const counts = new Map<number, number>();
    for (const r of resources) {
      if (r.courseId === 1) continue; // exclude the site course "All units"
      counts.set(r.courseId, (counts.get(r.courseId) ?? 0) + 1);
    }
    return Array.from(counts.entries())
      .map(([id, count]) => {
        const c = courses.find((x) => x.id === id);
        return { id, count, label: c?.shortName || c?.fullName || `Course ${id}` };
      })
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [resources, courses]);

  // Render grouped by week (shared by Unit mode and All Units mode)
  const renderWeekGroups = (items: Resource[], ariaLabel: string) => {
    const weekGroups = new Map<string, Resource[]>();
    for (const r of items) {
      const key = r.weekNum != null ? `Week ${r.weekNum}` : r.section || t("dashboard.resourcesOtherWeek");
      if (!weekGroups.has(key)) weekGroups.set(key, []);
      weekGroups.get(key)!.push(r);
    }
    const sortedWeeks = Array.from(weekGroups.entries()).sort((a, b) => {
      const wa = /^Week (\d+)$/.exec(a[0]);
      const wb = /^Week (\d+)$/.exec(b[0]);
      if (wa && wb) return Number(wa[1]) - Number(wb[1]);
      if (wa) return -1;
      if (wb) return 1;
      return a[0].localeCompare(b[0]);
    });
    return sortedWeeks.map(([week, weekItems]) => (
      <div key={week} className="mb-4">
        <h4 className="text-sm font-semibold text-muted-foreground mb-2">
          {week}
          <span className="text-xs ml-1">({weekItems.length})</span>
        </h4>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 resources-list" role="list" aria-label={`${ariaLabel} · ${week}`}>
          {weekItems.map((resource, index) => renderResourceCard(resource, index))}
        </div>
      </div>
    ));
  };

  // Card rendering extracted into a local function: reused after grouping; large lists no longer get per-item stagger animation (perf)
  const renderResourceCard = (resource: Resource, index: number) => {
    const rowKey = `${index}-${resource.url ?? "no-url"}`;
    // Decide whether this is a downloadable file (pluginfile.php = a real file) vs an external/page link
    // Both mod/resource and pluginfile can be downloaded directly (verified: a GET following redirects yields the file); folder/page/url only support opening
    const isDownloadable = resource.url
      ? resource.url.includes("pluginfile.php") || resource.url.includes("mod/resource/view.php")
      : false;
    const owner = courses.find((c) => c.id === resource.courseId);
    const courseLabel = owner?.shortName || owner?.fullName;
    return (
      <div key={rowKey} role="listitem">
        <Card className="card-hover">
          <CardContent className="flex items-center gap-4 p-4">
            {isDownloadable && (
              <input
                type="checkbox"
                checked={selectedResourceUrls.has(resource.url!)}
                onChange={() => toggleResource(resource.url!)}
                className="h-4 w-4 shrink-0 cursor-pointer rounded accent-primary focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                aria-label={t("dashboard.selectAll")}
              />
            )}
            {getFileIcon(resource.resourceType || "other")}
            <div className="flex-1 min-w-0">
              <p className="font-medium truncate text-foreground">{resource.name}</p>
              <div className="flex items-center gap-2 mt-1 flex-wrap">
                {resource.section && (
                  <Badge variant="outline" className="text-xs">{resource.section}</Badge>
                )}
                {courseLabel && <Badge variant="secondary">{courseLabel}</Badge>}
                {resource.fileSize && (
                  <span className="text-xs text-muted-foreground">
                    {(resource.fileSize / 1024 / 1024).toFixed(1)} MB
                  </span>
                )}
                {resource.modifiedDate && (
                  <span className="text-xs text-muted-foreground">· {resource.modifiedDate}</span>
                )}
              </div>
            </div>
            {/* Downloadable = download button; external link = open button */}
            {isDownloadable ? (
              (() => {
                // Row-level progress: the download manager key is the plain URL (backend
                // emits download-progress with key=file_url), so look it up by url.
                const dlItem = resource.url
                  ? downloads.find((d) => d.key === resource.url)
                  : undefined;
                const pct =
                  downloadingId === rowKey && dlItem && dlItem.total
                    ? Math.round(((dlItem.received ?? 0) / dlItem.total) * 100)
                    : null;
                return (
                  <Button
                    variant="ghost"
                    size="icon"
                    // `disabled` would apply pointer-events-none (button.tsx) and swallow
                    // the native title tooltip — use aria-disabled + visual dimming;
                    // handleDownload guards re-entry.
                    aria-label={
                      downloadingId === rowKey
                        ? t("dashboard.downloading")
                        : t("dashboard.download", { name: resource.name })
                    }
                    onClick={() => handleDownload({ key: rowKey, name: resource.name, url: resource.url, courseId: resource.courseId })}
                    className={downloadingId === rowKey ? "opacity-50 cursor-not-allowed" : ""}
                    title={
                      downloadingId === rowKey
                        ? t("dashboard.downloading")
                        : t("dashboard.download", { name: resource.name })
                    }
                    aria-disabled={downloadingId === rowKey}
                  >
                    {downloadingId === rowKey ? (
                      <DownloadProgressRing percent={pct} size={22} />
                    ) : (
                      <Download className="w-4 h-4" />
                    )}
                  </Button>
                );
              })()
            ) : resource.url ? (
              <Button
                variant="ghost"
                size="icon"
                aria-label={t("assignments.openInBrowser")}
                onClick={async () => {
                  try {
                    const { invoke } = await import("@tauri-apps/api/core");
                    await invoke("open_in_app_webview", { url: resource.url, title: resource.name });
                  } catch {
                    try { const { openUrl } = await import("@tauri-apps/plugin-opener"); await openUrl(resource.url!); } catch { /* silent */ }
                  }
                }}
              >
                <ChevronRight className="w-4 h-4" />
              </Button>
            ) : null}
          </CardContent>
        </Card>
      </div>
    );
  };
  // Stats counts are defined below after courses/assignments are declared (L268)

  const handleLogout = () => {
    reset();
  };

  // P1: request de-duplication — prevents StrictMode or rapid interactions from triggering multiple syncs
  // Real-time sync progress: backend emits "sync-progress" (done/total/phase) during fetch_all_data
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    onSyncProgress((p) => setSyncProgress(p)).then((fn) => {
      unlisten = fn;
    });
    return () => unlisten?.();
  }, []);

  const syncAllData = useCallback(async () => {
    if (syncStatus.isRunning) return;
    setSyncStatus({ isRunning: true });
    setSyncProgress(null);
    setLoadError(null);
    try {
      const prevState = useAppStore.getState();
      const data = await syncAll();
      updateAllSyncedData(data);
      // Stamp the cooldown timestamp only after a successful sync — writing it before
      // meant a failed manual sync would suppress the next launch auto-sync for an hour.
      useAppStore.getState().updateSettings({ lastAutoSyncAt: new Date().toISOString() });
      // Calendar events + grade overview (parallel; failures never block the main flow)
      const [cal, grades] = await Promise.all([
        fetchCalendarEvents().catch(() => [] as CalendarEvent[]),
        fetchGradeOverview().catch(() => [] as GradeOverviewRow[]),
      ]);
      setCalendarEvents(cal);
      setGradeOverview(grades);
      // Grade-release reminder: diff against pre-sync overview
      try {
        const stG = prevState.settings;
        if (stG.notifyGrade) {
          const prev = prevState.gradeOverview || [];
          const fresh = grades.filter(
            (g) => g.grade !== "-" && !prev.some((pp) => pp.unit === g.unit && pp.grade === g.grade)
          );
          if (fresh.length > 0) {
            const gTitle = t("reminders.gradeTitle");
            const gBody = fresh.slice(0, 3).map((g) => `${g.unit} — ${g.grade}`).join("; ");
            setReminderBanner({ id: `grade:${Date.now()}`, title: gTitle, body: gBody });
            showSystemNotification(gTitle, gBody);
          }
        }
      } catch (err) {
        console.warn("grade reminder failed:", err);
      }
      // New announcement / resource alerts (diff against pre-sync snapshot)
      try {
        const st = prevState.settings;
        const reminded = getReminded();
        const newIds: string[] = [];
        const parts: string[] = [];
        if (st.notifyNewAnnouncement) {
          const fresh = diffAnnouncements(prevState.announcements, data.announcements);
          const unreminded = fresh.filter((a) => !reminded.has(`ann:${a.id ?? a.title}`));
          if (unreminded.length > 0) {
            newIds.push(...unreminded.map((a) => `ann:${a.id ?? a.title}`));
            parts.push(unreminded.slice(0, 3).map((a) => a.title).join("; "));
          }
        }
        if (st.notifyNewResource) {
          const fresh = diffResources(prevState.allResources, data.resources);
          const unreminded = fresh.filter((r) => !reminded.has(`res:${r.courseId ?? 0}:${r.name}`));
          if (unreminded.length > 0) {
            newIds.push(...unreminded.map((r) => `res:${r.courseId ?? 0}:${r.name}`));
            parts.push(unreminded.slice(0, 3).map((r) => r.name).join("; "));
          }
        }
        if (newIds.length > 0) {
          markReminded(newIds);
          const title = t("reminders.newContentTitle");
          setReminderBanner({ id: `new:${Date.now()}`, title, body: parts.join(" / ") });
          showSystemNotification(title, parts.join(" / "));
        }
      } catch (err) {
        console.warn("new content reminder failed:", err);
      }
    } catch (err) {
      console.error("Failed to sync data:", err);
      setLoadError(errMsg(err, "dashboard.syncFailed"));
    } finally {
      setSyncStatus({ isRunning: false });
    }
  }, [syncStatus.isRunning, setSyncStatus, updateAllSyncedData, t]);

  // Manual refresh: debounce (skip while running/cooldown) + rate limit (60s window).
  const handleManualSync = useCallback(() => {
    if (syncStatus.isRunning || manualSyncCooldown) return;
    syncAllData();
    setManualSyncCooldown(true);
    window.setTimeout(() => setManualSyncCooldown(false), MANUAL_SYNC_COOLDOWN_MS);
  }, [syncStatus.isRunning, manualSyncCooldown, syncAllData]);

  // Download a file from Moodle
  //
  // Use `key` rather than resource.id as the spinner's unique identifier: the backend also parses
  // course/forum top-level links into Resources, whose ids are often 0 or duplicated, so clicking one
  // download button would leave every row sharing that id spinning.
  const handleDownload = async (resource: { key: string; name: string; url?: string; courseId?: number }) => {
    const url = resource.url || "#";
    if (url === "#") {
      showToast(t("dashboard.downloadNoUrl"));
      return;
    }

    setDownloadingId(resource.key);
    // Enqueue into the download manager
    upsertDownload({
      key: url,
      name: resource.name,
      received: 0,
      total: null,
      speed: 0,
      status: "downloading",
      lastTick: Date.now(),
    });
    try {
      const baseDir = settings.downloadPath || "";
      const savePath = computeSavePath(resource, {
        downloadPath: baseDir,
        groupByCourse: settings.groupDownloadsByCourse,
        courses,
      });
      const { path: savedPath } = await downloadFile(url, savePath);
      upsertDownload({
        key: url,
        name: resource.name,
        received: 0,
        total: null,
        speed: 0,
        status: "done",
        path: savedPath,
        lastTick: Date.now(),
      });
      if (settings.openFolderAfterDownload) {
        try {
          const { revealItemInDir } = await import("@tauri-apps/plugin-opener");
          await revealItemInDir(savedPath);
        } catch (err) {
          console.warn("revealItemInDir failed:", err);
        }
      }
      showToast(t("dashboard.downloaded", { path: savedPath }));
    } catch (err) {
      console.error("Download failed:", err);
      upsertDownload({
        key: url,
        name: resource.name,
        received: 0,
        total: null,
        speed: 0,
        status: "error",
        error: err instanceof Error ? err.message : String(err),
        lastTick: Date.now(),
      });
      showToast(t("dashboard.downloadFailed", { error: err instanceof Error ? err.message : "Unknown error" }));
    } finally {
      setDownloadingId(null);
    }
  };

  // P0-4: zero-blocking first screen — on mount, render immediately from Zustand's persisted cache (interactive at 0ms),
  // and defer network-heavy work like fetchCourses + syncAll to an idle frame so scraping doesn't
  // slow down the first paint. Data flow and error handling are unchanged.
  useEffect(() => {
    if (!isLoggedIn) return;
    let isMounted = true;

    const load = async () => {
      // Show the page's initial loading state only when there are no cached courses at all
      if (courses.length === 0) {
        setIsLoadingCourses(true);
      }
      setLoadError(null);

      // Whether this run raised the sync-running flag itself — declared outside the try so
      // the finally below can see it: only the run that raised the flag may lower it again.
      let startedSyncHere = false;

      try {
        // Fire fetchCourses + syncAll in parallel to cut total wait time.
        //
        // Skip the automatic full sync in dev mode (npm run tauri dev): syncAll concurrently scrapes
        // resources/assignments/announcements + every weekly section for each course, hundreds of requests in total, and
        // unoptimized debug parsing is slow on top of that, dragging "open the app" into the minutes range. During debugging, render
        // straight from the Zustand persisted cache and hit the manual sync button in the top-right when fresh data is needed.
        // Release builds (import.meta.env.DEV=false) keep the original "sync on open" behavior, entirely unaffected.
        // 1-hour launch cooldown: reopening the app shortly after the last sync renders
        // from local data (no re-scrape). First run (no timestamp) always syncs.
        const st = useAppStore.getState();
        // The periodic auto-sync check runs before this deferred load() and may already have
        // a full sync in flight. Don't stack a second scrape on top of it, and remember that
        // this run doesn't own the isRunning flag in that case (see the finally below).
        const syncAlreadyRunning = st.syncStatus.isRunning;
        const lastAutoSyncTs = st.settings.lastAutoSyncAt ? Date.parse(st.settings.lastAutoSyncAt) : 0;
        const withinCooldown =
          !Number.isNaN(lastAutoSyncTs) &&
          lastAutoSyncTs > 0 &&
          Date.now() - lastAutoSyncTs < LAUNCH_SYNC_COOLDOWN_MS;
        const shouldAutoSync = !import.meta.env.DEV && !withinCooldown && !syncAlreadyRunning;
        startedSyncHere = shouldAutoSync;
        // Semester-fixed tabs (unit info / schedule / contacts) are cached: after the first
        // full sync they are skipped on regular launches (fetch strategy per user ruling).
        const hasFixedTabCache =
          Object.keys(st.unitInfos).length > 0 &&
          Object.keys(st.schedules).length > 0 &&
          Object.keys(st.contacts).length > 0;
        if (shouldAutoSync) {
          // Mark the startup sync as running so the progress banner shows and manual
          // syncs are de-duplicated; skipped entirely when the cooldown applies.
          setSyncStatus({ isRunning: true });
          // NOTE: the cooldown timestamp (lastAutoSyncAt) is intentionally NOT written
          // here. It is stamped only after a successful sync below — writing it before
          // meant a failed auto-sync polluted the timestamp and suppressed every
          // subsequent launch auto-sync for the next hour (fresh users saw a blank
          // Dashboard until they hit manual sync).
        }
        const [fetched, synced] = await Promise.allSettled([
          shouldAutoSync && courses.length === 0 ? fetchCourses() : Promise.resolve(null),
          shouldAutoSync ? syncAll(!hasFixedTabCache) : Promise.resolve(null),
        ]);

        if (!isMounted) return;

        // Handle the fetchCourses result
        if (fetched.status === "fulfilled" && fetched.value) {
          setStoreCourses(fetched.value);
        }

        // Handle the syncAll result (includes courses/resources/assignments/announcements)
        // In dev mode shouldAutoSync=false, so synced.value is null and we simply skip
        if (synced.status === "fulfilled" && synced.value) {
          updateAllSyncedData(synced.value);
          // Stamp the cooldown timestamp ONLY after a successful sync. A failed auto-sync
          // must not suppress the next launch's auto-sync (see note above).
          useAppStore.getState().updateSettings({ lastAutoSyncAt: new Date().toISOString() });
        } else if (synced.status === "rejected") {
          setLoadError(errMsg(synced.reason, "dashboard.syncFailed"));
        }

        // Calendar events + grade overview ride along with the launch sync (the
        // manual sync already does this). Without it, a re-login (which clears
        // these caches) left grades stuck at "0/0 · no data" until a manual sync.
        if (shouldAutoSync && isMounted) {
          const [cal, grades] = await Promise.all([
            fetchCalendarEvents().catch(() => [] as CalendarEvent[]),
            fetchGradeOverview().catch(() => [] as GradeOverviewRow[]),
          ]);
          if (isMounted) {
            setCalendarEvents(cal);
            setGradeOverview(grades);
          }
        }
      } catch (err) {
        console.error("Failed to load data:", err);
        if (isMounted) {
          setLoadError(errMsg(err, "dashboard.loadFailed"));
        }
      } finally {
        if (isMounted) {
          setIsLoadingCourses(false);
          // Only lower the flag this run raised. When the periodic auto-sync already had a
          // sync in flight, clearing here made the sync banner vanish within a second of
          // login while the scrape was still running — a fresh user saw an empty dashboard
          // that looked like sync never started.
          if (startedSyncHere) {
            setSyncStatus({ isRunning: false });
          }
        }
      }
    };

    // Defer the network-heavy load() to the next tick so the first paint is never blocked.
    // Deliberately NOT using requestIdleCallback here: under Tauri's WebView2 it can stay
    // pending indefinitely (no idle period is ever detected / background throttling), which
    // left a fresh user's Dashboard blank until they hit the manual sync button. A plain
    // setTimeout(0) gives the same "render cached data first" benefit with guaranteed execution.
    const timerHandle = setTimeout(() => { if (isMounted) load(); }, 0);

    return () => {
      isMounted = false;
      clearTimeout(timerHandle);
    };
  }, [isLoggedIn]);

  // Silent update check on launch: only surfaces a banner AFTER the user is in the
  // real app (Dashboard) when a newer release exists. No prompts on the login page.
  const [updateBanner, setUpdateBanner] = useState<ReleaseInfo | null>(null);
  const openReleaseUrl = async (url: string) => {
    try {
      const { openUrl } = await import("@tauri-apps/plugin-opener");
      await openUrl(url);
    } catch {
      /* silent */
    }
  };

  // One-click update straight from the banner. Falls back to the release page when
  // the running build has no updater (v0.1.7 and earlier) or the install fails.
  const [bannerInstalling, setBannerInstalling] = useState(false);
  const [bannerPercent, setBannerPercent] = useState<number | null>(null);
  const [bannerInstalled, setBannerInstalled] = useState(false);
  const installFromBanner = async () => {
    if (!updateBanner) return;
    setBannerInstalling(true);
    setBannerPercent(null);
    try {
      const outcome = await installUpdateInApp((p) => setBannerPercent(p.percent ?? null));
      if (outcome.status === "installed") {
        setBannerInstalled(true);
      } else if (outcome.status === "upToDate") {
        setUpdateBanner(null);
      } else {
        await openReleaseUrl(updateBanner.downloadUrl || updateBanner.htmlUrl);
      }
    } catch (e: any) {
      showToast(e?.message || String(e));
      await openReleaseUrl(updateBanner.htmlUrl);
    } finally {
      setBannerInstalling(false);
    }
  };

  useEffect(() => {
    if (!isLoggedIn) return;
    let cancelled = false;
    getCurrentAppVersion()
      .then((version) => checkForAppUpdates(version))
      .then((res) => {
        if (!cancelled && res.hasUpdate && res.latestRelease) {
          setUpdateBanner(res.latestRelease);
        }
      })
      .catch(() => {
        /* silent: never block the app on an update-check failure */
      });
    return () => {
      cancelled = true;
    };
  }, [isLoggedIn]);

  // Periodic auto-sync: on mount, check whether more than autoSyncIntervalDays (default 7 days) has passed since the last auto-sync.
  // No setInterval — a desktop app restarts often enough that a single check on mount is sufficient.
  // Settings are read via getState() to avoid putting settings in the dependency array and re-running on every settings change.
  // syncAllData is likewise reached through a ref: its identity flips every time syncStatus.isRunning
  // toggles, and keeping it in the dependency list re-armed "sync on launch" after every finished
  // sync — an endless background sync loop (sync → finish → effect re-runs → sync again…).
  const syncAllDataRef = useRef(syncAllData);
  useEffect(() => {
    syncAllDataRef.current = syncAllData;
  });
  useEffect(() => {
    if (!isLoggedIn) return;
    // A sync may already be in flight (launch auto-sync via the mount effect, or a manual sync):
    // stacking the launch check on top of it ran two full scrapes concurrently.
    if (useAppStore.getState().syncStatus.isRunning) return;

    const { settings: current } = useAppStore.getState();
    const intervalDays = current.autoSyncIntervalDays ?? 0;
    const launchSync = current.syncOnLaunch === true;
    if (!current.syncEnabled || (intervalDays <= 0 && !launchSync)) return;

    const last = current.lastAutoSyncAt ? Date.parse(current.lastAutoSyncAt) : 0;
    const elapsed = Date.now() - (Number.isNaN(last) ? 0 : last);
    if (!launchSync && elapsed < intervalDays * 86_400_000) return;

    // lastAutoSyncAt is stamped by syncAllData() itself, but only after a SUCCESSFUL sync.
    // Stamping it here first meant a failed (or interrupted) first sync still counted as
    // "synced just now": the next launch hit the 1h cooldown and the periodic check then
    // waited out the whole interval — a brand-new user could end up with no data and no retry.
    syncAllDataRef.current();
  }, [isLoggedIn]);

  // Due-date reminders: check on mount + hourly poll (data refreshes after sync).
  useEffect(() => {
    if (!isLoggedIn) return;
    const runDueCheck = () => {
      try {
        const { settings: st, assignments: asg } = useAppStore.getState();
        if (!st.notifyDueReminder) return;
        const due = findDueAssignments(asg, st.dueReminderDays ?? 3);
        const reminded = getReminded();
        const fresh = due.filter((d) => !reminded.has(d.id));
        if (fresh.length === 0) return;
        markReminded(fresh.map((d) => d.id));
        const title = t("reminders.dueTitle", { count: fresh.length });
        const body = fresh
          .slice(0, 3)
          .map((d) => `${d.name} (${new Date(d.dueDateIso).toLocaleDateString()})`)
          .join("; ");
        setReminderBanner({ id: `due:${Date.now()}`, title, body });
        showSystemNotification(title, body);
      } catch (err) {
        console.warn("due reminder failed:", err);
      }
    };
    runDueCheck();
    const h = setInterval(runDueCheck, 60 * 60 * 1000);
    return () => clearInterval(h);
  }, [isLoggedIn, setReminderBanner, t]);

  // Unified deadline timeline: calendar events (close/due) + assignments (dueDateIso) merged, de-duplicated and sorted.
  // Quizzes are covered by the mod_quiz close calendar events (the mod/quiz list is used by the course detail tab).
  const deadlineItems = useMemo(() => {
    type Item = { key: string; courseId: number | null; kind: "quiz" | "assign"; title: string; ts: number };
    const items: Item[] = [];
    (calendarEvents || []).forEach((e) => {
      if (e.eventType === "open") return;
      // Only deadlines of courses the user currently has. After a logout / fresh
      // login the course list is empty and stale calendar events must not show;
      // course-less global events (no courseId) only appear when courses exist.
      if (courses.length === 0) return;
      if (e.courseId != null && !courses.some((c) => c.id === e.courseId)) return;
      items.push({
        key: `ev:${e.id}`,
        courseId: e.courseId ?? null,
        kind: e.component === "mod_quiz" ? "quiz" : "assign",
        title: e.title,
        ts: e.timestamp * 1000,
      });
    });
    (assignments || []).forEach((a) => {
      if (!a.dueDateIso) return;
      const t = Date.parse(a.dueDateIso);
      if (Number.isNaN(t)) return;
      items.push({ key: `as:${a.id ?? a.name}:${a.dueDateIso}`, courseId: a.courseId, kind: "assign", title: a.name, ts: t });
    });
    const seen = new Set<string>();
    const norm = (s: string) =>
      s.toLowerCase().replace(/\s*(closes|opens|is due|due)\s*$/i, "").trim();
    const out = items.filter((it) => {
      const k = `${it.courseId ?? 0}|${norm(it.title)}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
    return out.sort((a, b) => a.ts - b.ts);
  }, [calendarEvents, assignments, courses]);

  const dueSoonCount = deadlineItems.filter((d) => d.ts >= Date.now() && d.ts <= Date.now() + 7 * 86_400_000).length;
  const gradedCount = (gradeOverview || []).filter((g) => g.grade !== "-").length;

  const renderDeadlineCard = (item: { key: string; courseId: number | null; kind: "quiz" | "assign"; title: string; ts: number }) => {
    const diff = Math.ceil((item.ts - Date.now()) / 86_400_000);
    const badge =
      diff <= 0 ? (
        <Badge variant="danger">{t("dashboard.dueToday")}</Badge>
      ) : diff === 1 ? (
        <Badge variant="danger" className="font-bold">{t("dashboard.dueTomorrow")}</Badge>
      ) : diff <= 7 ? (
        <Badge variant="danger" className="font-bold">{t("dashboard.dueInDays", { count: diff })}</Badge>
      ) : (
        <Badge variant="secondary">{t("dashboard.dueInDays", { count: diff })}</Badge>
      );
    const Icon = item.kind === "quiz" ? ClipboardList : FileText;
    const course = (courses || []).find((cc) => cc.id === item.courseId);
    const courseLabel = course ? `${course.shortName || course.fullName}` : "";
    return (
      <div
        key={item.key}
        className="stagger-item"
        style={{ animationDelay: "0ms" }}
        role="listitem"
      >
        <Card
          className="card-hover hover-lift cursor-pointer"
          onClick={() => item.courseId != null && setSelectedCourseId(item.courseId)}
        >
          <CardContent className="p-4 flex items-center gap-3">
            <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${item.kind === "quiz" ? "bg-purple-500/15 text-purple-600 dark:text-purple-400" : "bg-sky-500/15 text-sky-600 dark:text-sky-400"}`}>
              <Icon className="w-4 h-4" aria-hidden="true" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">{item.title}</p>
              <p className="text-xs text-muted-foreground truncate">{courseLabel}</p>
            </div>
            <div className="text-right shrink-0">
              <p className="text-sm font-semibold text-foreground font-mono">
                {new Date(item.ts).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
              </p>
              <p className="text-xs text-muted-foreground">{badge}</p>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  };

  // Map real courses to the card shape used by the grid.
  // Deliberately no progress field: Moodle exposes no real study progress, the previously hardcoded 50% was fake data,
  // and showing an identical progress bar on every course misled users, so it was removed entirely.
  const displayCourses = useMemo(() => {
    const list = (courses || []).map((c) => {
      // One raw string in, three deduplicated slots out. Prefer fullName because it is the
      // richer of the two (shortName is only ever a prefix of it), and fall back to a stable
      // placeholder so the card never renders blank.
      const raw = c.fullName || c.shortName || `Course ${c.id}`;
      const parts = describeCourse(raw);
      return {
        id: c.id,
        // Only trust shortName when it actually differs from fullName. When they are equal
        // (the pre-sync path) using it would print the whole course name on the banner and
        // then again as the title.
        code: parts.code ?? (c.shortName && c.shortName !== c.fullName ? tidyName(c.shortName) : null),
        name: parts.title,
        term: parts.term,
        isPortal: c.isPortal,
      };
    });
    const sortBy = settings.courseSortBy ?? "term";
    if (sortBy === "name") {
      return [...list].sort((a, b) => a.name.localeCompare(b.name));
    }
    // term order: S1 2025 -> S2 2025 -> S1 2026 ...; unparseable last.
    // Reads the already-extracted `term` rather than re-parsing the title, which no
    // longer carries the term now that the card shows it on its own line.
    const termKey = (n: string | null): [number, number] => {
      const m = n?.match(/\bS([12])\s*[\u002D\u2013\u2014]?\s*(\d{4})\b/i);
      if (!m) return [9999, 0];
      return [parseInt(m[2], 10), parseInt(m[1], 10)];
    };
    return [...list].sort((a, b) => {
      const ka = termKey(a.term);
      const kb = termKey(b.term);
      return ka[0] - kb[0] || ka[1] - kb[1] || a.name.localeCompare(b.name);
    });
  }, [courses, settings.courseSortBy]);

  // Stats are computed from real data.
  const quickStats = [
    { label: t("dashboard.statDueSoon"), value: dueSoonCount, icon: CalendarDays, color: "text-amber-500" },
    { label: t("dashboard.statTotalCourses"), value: realCourses.length, icon: BookOpen, color: "text-primary" },
    { label: t("dashboard.statPending"), value: pendingAssignmentsCount, icon: Calendar, color: "text-accent" },
    { label: t("dashboard.statNewNotices"), value: (announcements || []).length, icon: Bell, color: "text-info" },
    { label: t("dashboard.statCompleted"), value: completedAssignmentsCount, icon: GraduationCap, color: "text-success" },
  ];

  // Get effective dark mode (resolve "system" to actual theme)
  const getEffectiveDarkMode = (): "dark" | "light" => {
    if (settings.darkMode === "system") {
      return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    }
    return settings.darkMode === "dark" ? "dark" : "light";
  };

  // Theme toggle - toggle between light and dark
  const toggleTheme = () => {
    const currentEffective = getEffectiveDarkMode();
    const nextTheme = currentEffective === "dark" ? "light" : "dark";
    updateSettings({ darkMode: nextTheme });
  };

  // Get theme icon based on current effective mode
  const getThemeIcon = () => {
    if (getEffectiveDarkMode() === "dark") {
      return <Moon className="w-5 h-5" />;
    }
    return <Sun className="w-5 h-5" />;
  };

  // Get theme label for tooltip
  const getThemeLabel = () => {
    return getEffectiveDarkMode() === "dark" ? t("dashboard.themeDark") : t("dashboard.themeLight");
  };

  // Get file icon based on type
  const getFileIcon = (type: string) => {
    if (type === "video") return <Video className="w-5 h-5 text-purple-500" />;
    if (type === "folder") return <FolderOpen className="w-5 h-5 text-amber-500" />;
    return <FileText className={`w-5 h-5 ${type === "pdf" ? "text-red-500" : type === "doc" ? "text-blue-500" : type === "ppt" ? "text-orange-500" : "text-green-500"}`} />;
  };

  // Get notification icon based on type
  const getNotificationIcon = (type: string) => {
    switch (type) {
      case "assignment":
        return <Calendar className="w-5 h-5 text-accent" />;
      case "quiz":
        return <ClipboardList className="w-5 h-5 text-purple-600 dark:text-purple-400" />;
      case "exam":
        return <AlertTriangle className="w-5 h-5 text-destructive" />;
      case "grade":
        return <CheckCircle2 className="w-5 h-5 text-success" />;
      case "resource":
        return <FileText className="w-5 h-5 text-info" />;
      default:
        return <AlertCircle className="w-5 h-5 text-primary" />;
    }
  };

  // Shared course grid — used by both the home preview and the courses tab
  const renderCourseGrid = () => {
    if (isLoadingCourses && courses.length === 0) {
      return (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4" aria-hidden="true">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="rounded-2xl border bg-card p-5 space-y-3">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-5 w-3/4" />
              <Skeleton className="h-3 w-1/2" />
              <Skeleton className="h-3 w-2/3" />
            </div>
          ))}
        </div>
      );
    }
    if (displayCourses.length === 0) {
      return <p className="text-muted-foreground">{t("dashboard.noCourses")}</p>;
    }
    return (
      <div
        className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 items-stretch"
        role="list"
        aria-label={t("dashboard.coursesAria")}
      >
        {displayCourses.map((course, index) => (
          <div
            key={course.id}
            className="stagger-item h-full"
            style={{ animationDelay: `${index * 40 + 160}ms` }}
            role="listitem"
          >
            {/* h-full + flex-col make each card fill the grid row height, keeping equal heights regardless of course name length */}
            <Card
              className="card-hover-scale cursor-pointer overflow-hidden touch-manipulation h-full flex flex-col"
              onClick={() => setSelectedCourseId(course.id)}
            >
              <div
                className="h-24 shrink-0 bg-sky-400 flex items-center justify-center relative px-3"
                aria-hidden="true"
              >
                {course.code ? (
                  /* Smaller font + allow wrapping so long course codes (e.g. FIT4005-FIT5125) show in full without being clipped */
                  <span className="text-xl font-bold text-white/95 font-mono text-center leading-tight break-words line-clamp-2">
                    {course.code}
                  </span>
                ) : (
                  /* No code to show (portal pages, thesis units). An icon keeps the banner
                     from repeating the title that sits right underneath it. */
                  <BookOpen className="w-8 h-8 text-white/90" />
                )}
              </div>
              <CardContent className="p-4 flex-1 flex flex-col">
                {/* min-h reserves two lines of height so a card with a one-line title isn't shorter than a two-line one */}
                {course.isPortal && (
                  <Badge variant="secondary" className="text-xs mb-1">{t("dashboard.portalBadge")}</Badge>
                )}
                <h4 className="font-semibold mb-1 text-foreground line-clamp-2 min-h-[2.75rem]">
                  {course.name}
                </h4>
                {course.term && (
                  <div className="flex items-center mt-auto">
                    <p className="text-sm text-muted-foreground">{course.term}</p>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        ))}
      </div>
    );
  };

  // ============================================================
  // VIEW SWITCHING: Render full-page sub-views when needed
  // ============================================================

  // Course detail view
  if (selectedCourseId !== null) {
    return (
      <Suspense fallback={<PageLoading />}>
        <CourseDetail
          courseId={selectedCourseId}
          onBack={() => setSelectedCourseId(null)}
        />
      </Suspense>
    );
  }

  // Assignments view
  if (activeTab === "assignments") {
    return (
      <Suspense fallback={<PageLoading />}>
        <AssignmentsPage onBack={() => setActiveTab("home")} />
      </Suspense>
    );
  }

  // Settings view
  if (activeTab === "settings") {
    return (
      <Suspense fallback={<PageLoading />}>
        <SettingsPage onBack={() => setActiveTab("home")} />
      </Suspense>
    );
  }

  // Dashboard view (home, courses, resources, notifications)
  return (
    // h-screen + overflow-hidden: lock the whole page inside the viewport so document-level scrolling doesn't drag the sidebar along.
    // The actual content scrolling is handled by the inner <div className="flex-1 overflow-auto ...">.
    <div className="h-screen overflow-hidden bg-background flex">
      {/* Skip to main content link (Accessibility) */}
      <a href="#main-content" className="skip-link">
        {t("dashboard.skipToMain")}
      </a>

      {/* Sidebar - fully static, no animation. h-full + shrink-0 ensure the main content can't stretch it taller.
          The inner nav uses overflow-y-auto to handle overflow of the nav items themselves (only needed in extreme cases). */}
      <aside 
        className="w-72 shrink-0 h-full glass border-r flex flex-col"
        role="navigation"
        aria-label={t("dashboard.mainNav")}
      >
        {/* Logo area */}
        <div className="p-5 border-b shrink-0">
          <div className="flex items-center gap-3">
            <img
              src={appIcon}
              alt="Muster App Icon"
              className="w-10 h-10 rounded-xl shadow-md ring-1 ring-border/30 object-cover flex-shrink-0"
            />
            <div>
              <h1 className="font-bold text-lg text-foreground">{t("app.name")}</h1>
              <p className="text-xs text-muted-foreground">{t("app.tagline")}</p>
            </div>
          </div>
        </div>

        {/* Navigation menu */}
        <nav className="flex-1 min-h-0 overflow-y-auto p-3 space-y-1" role="menu">
          {sidebarItems.map((item) => {
            // Notification badge: count only unread announcements so the badge clears once everything is read
            const badgeCount =
              item.id === "notifications"
                ? (announcements || []).filter(
                    (a: any) => !readAnnouncementIds.includes(a.id)
                  ).length
                : undefined;

            return (
              <button
                key={item.id}
                onClick={() => setActiveTab(item.id)}
                className={`nav-item touch-target touch-manipulation w-full flex items-center gap-3 px-4 py-3 rounded-xl ${
                  activeTab === item.id
                    ? "nav-active"
                    : "text-muted-foreground hover:text-foreground"
                }`}
                role="menuitem"
                aria-current={activeTab === item.id ? "page" : undefined}
                aria-label={t(item.labelKey)}
              >
                <item.icon className="w-5 h-5 flex-shrink-0" />
                <span className="font-medium flex-1 text-left">{t(item.labelKey)}</span>
                {/* Dynamic Badge for notifications */}
                {badgeCount !== undefined && badgeCount > 0 && (
                  <span 
                    className="min-w-[20px] h-5 px-1.5 rounded-full bg-accent text-accent-foreground text-xs font-medium flex items-center justify-center"
                    aria-label={t("dashboard.unread", { count: badgeCount })}
                  >
                    {badgeCount}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        {/* User info area —— pinned to the bottom of the sidebar, does not scroll with content */}
        <div className="p-3 border-t shrink-0">
          <div className="flex items-center gap-3 px-3 py-3 rounded-xl bg-secondary/50">
            <div 
              className="w-10 h-10 rounded-full bg-gradient-to-br from-primary to-primary-light flex items-center justify-center flex-shrink-0"
              aria-hidden="true"
            >
              <User className="w-5 h-5 text-white" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-medium text-sm truncate text-foreground">
                {user?.fullName ?? "Student"}
              </p>
              <p className="text-xs text-muted-foreground truncate">
                {user?.email ?? "student@monash.edu"}
              </p>
            </div>
            <Button 
              variant="ghost" 
              size="icon" 
              onClick={handleLogout}
              className="hover:bg-secondary touch-target"
              aria-label={t("dashboard.logout")}
              title={t("dashboard.logout")}
            >
              <LogOut className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </aside>

      {/* Main content area */}
      <main 
        id="main-content"
        className="flex-1 flex flex-col overflow-hidden"
        role="main"
      >
        {/* Top bar */}
        <header className="h-16 border-b glass flex items-center justify-between px-6">
          <div className="flex items-center gap-4 flex-1 max-w-xl">
            {/* Search with proper accessibility */}
            <div className="relative flex-1">
              <Search 
                className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground"
                aria-hidden="true"
              />
              <input
                type="search"
                placeholder={t("dashboard.searchPlaceholder")}
                className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-secondary/50 border-0 text-foreground placeholder:text-muted-foreground transition-shadow duration-150 focus:outline-none focus:ring-2 focus:ring-ring"
                aria-label={t("dashboard.search")}
              />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <DownloadCenter autoCloseKey={activeTab} />


            <Button
              variant="ghost"
              size="icon"
              // NOTE: `disabled` would apply pointer-events-none (button.tsx) and swallow the
              // native title tooltip — use aria-disabled + visual dimming instead; the click
              // guard lives inside handleManualSync.
              className={
                "hover:bg-secondary touch-target relative" +
                (syncStatus.isRunning || manualSyncCooldown ? " opacity-50 cursor-not-allowed" : "")
              }
              aria-label={t("dashboard.refresh")}
              title={
                syncStatus.isRunning
                  ? t("dashboard.syncing")
                  : manualSyncCooldown
                    ? t("dashboard.refreshCooldown")
                    : t("dashboard.refresh")
              }
              onClick={handleManualSync}
              aria-disabled={syncStatus.isRunning || manualSyncCooldown}
            >
              {syncStatus.isRunning ? (
                <Loader2 className="w-5 h-5 animate-spin text-primary" />
              ) : (
                <CloudDownload className="w-5 h-5 text-foreground" />
              )}
            </Button>
            <LanguageSelect variant="ghost" />
            {/* Theme Toggle Button */}
            <button
              type="button"
              onClick={toggleTheme}
              className="inline-flex items-center justify-center w-10 h-10 rounded-xl text-foreground hover:bg-muted/50 transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              aria-label={t("dashboard.themeToggleAria", { mode: getThemeLabel() })}
              title={getThemeLabel()}
            >
              {getThemeIcon()}
            </button>
            <Button 
              variant="ghost" 
              size="icon" 
              className="hover:bg-secondary touch-target relative"
              aria-label={t("nav.notifications")}
              onClick={() => setActiveTab("notifications")}
            >
              <Bell className="w-5 h-5" />
              {/* Show the dot only when there are unread announcements; it disappears once all are read */}
              {(announcements || []).some((a: any) => !readAnnouncementIds.includes(a.id)) && (
                <span className="absolute top-1 right-1 w-2 h-2 rounded-full bg-accent" aria-hidden="true" />
              )}
            </Button>
          </div>
        </header>

        {/* Content area */}
        <div className="flex-1 overflow-auto p-6 fade-in">
          {/* Update available banner — shown only inside the real app (after login),
              when a newer GitHub release was found by the silent launch check. */}
          {updateBanner && (
            <div className="mb-6 p-4 rounded-2xl bg-primary/10 border border-primary/30 flex items-center justify-between gap-4">
              <button
                type="button"
                onClick={() => openReleaseUrl(updateBanner.htmlUrl)}
                className="flex items-start gap-3 text-left flex-1 min-w-0 group"
              >
                <Sparkles className="w-5 h-5 text-primary shrink-0 mt-0.5" />
                <p className="font-semibold text-foreground group-hover:underline">
                  {t("dashboard.updateBanner", { version: updateBanner.version || updateBanner.tagName })}
                </p>
              </button>
              {bannerInstalled ? (
                <Button size="sm" onClick={() => relaunchApp()}>
                  {t("settings.about.restartNow")}
                </Button>
              ) : (
                <Button size="sm" onClick={installFromBanner} disabled={bannerInstalling}>
                  {bannerInstalling
                    ? bannerPercent === null
                      ? t("settings.about.installingUnknown")
                      : t("settings.about.installingUpdate", { percent: bannerPercent })
                    : t("settings.about.installUpdate")}
                </Button>
              )}
              <Button variant="ghost" size="sm" onClick={() => setUpdateBanner(null)} aria-label={t("common.close")}>
                <X className="w-4 h-4" />
              </Button>
            </div>
          )}

          {/* Reminder Banner */}
          {reminderBanner && (
            <div className="mb-6 p-4 rounded-2xl bg-amber-500/10 border border-amber-500/30 flex items-start justify-between gap-4">
              <div className="flex items-start gap-3">
                <AlertCircle className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
                <div>
                  <p className="font-semibold text-amber-600 dark:text-amber-400">{reminderBanner.title}</p>
                  <p className="text-sm text-muted-foreground mt-0.5">{reminderBanner.body}</p>
                </div>
              </div>
              <Button variant="ghost" size="sm" onClick={() => setReminderBanner(null)} aria-label={t("common.close")}>
                <X className="w-4 h-4" />
              </Button>
            </div>
          )}

          {/* Real-time Syncing Progress Banner — shown for the startup auto-sync
              (first run and every later launch) AND for manual syncs. */}
          {(syncStatus.isRunning || isLoadingCourses) && (
            <div className="mb-6 rounded-2xl border border-primary/25 bg-gradient-to-r from-primary/15 via-primary/5 to-info/15 backdrop-blur-md p-5 shadow-sm overflow-hidden">
              <div className="flex items-center gap-4">
                {/* Progress ring with real % when the backend reports it, spinning arc otherwise */}
                <div className="relative w-12 h-12 shrink-0">
                  {syncProgress && syncProgress.total > 0 ? (
                    <>
                      <svg viewBox="0 0 48 48" className="w-12 h-12 -rotate-90">
                        <circle cx="24" cy="24" r="20" fill="none" strokeWidth="5" className="stroke-primary/15" />
                        <circle
                          cx="24"
                          cy="24"
                          r="20"
                          fill="none"
                          strokeWidth="5"
                          strokeLinecap="round"
                          className="stroke-primary transition-all duration-500 ease-out"
                          strokeDasharray={2 * Math.PI * 20}
                          strokeDashoffset={
                            2 * Math.PI * 20 *
                            (1 - Math.min(100, Math.max(0, Math.round((syncProgress.done / syncProgress.total) * 100))) / 100)
                          }
                        />
                      </svg>
                      <span className="absolute inset-0 flex items-center justify-center text-[11px] font-bold text-primary">
                        {Math.round((syncProgress.done / syncProgress.total) * 100)}%
                      </span>
                    </>
                  ) : (
                    <div className="w-12 h-12 rounded-full border-4 border-primary/20 border-t-primary animate-spin" />
                  )}
                </div>

                {/* Title + live stage description */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h4 className="font-semibold text-sm text-foreground">{t("dashboard.syncBannerTitle")}</h4>
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-primary/15 text-primary font-mono font-medium animate-pulse">
                      {t("dashboard.syncBannerBadge")}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                    {syncProgress && syncProgress.total > 0
                      ? t((`dashboard.syncProgress.${syncProgress.phase}`) as TranslationKey, {
                          done: syncProgress.done,
                          total: syncProgress.total,
                        })
                      : t("dashboard.syncBannerDesc")}
                  </p>
                </div>

                {/* Live indicator */}
                <div className="hidden sm:flex items-center gap-2 shrink-0">
                  <span className="w-2 h-2 rounded-full bg-primary animate-pulse" />
                  <span className="text-xs text-muted-foreground">{t("dashboard.syncLive")}</span>
                </div>
              </div>
            </div>
          )}

          {/* ============================================================ */}
          {/* HOME TAB */}
          {/* ============================================================ */}
          {activeTab === "home" && (
            <>
              {/* Welcome section */}
              <div className="mb-8">
                <h2 className="text-2xl font-bold mb-2 text-foreground">
                  {t("dashboard.welcomeBack", { name: user?.fullName ?? t("dashboard.student") })}
                </h2>
                <p className="text-muted-foreground line-length">
                  {t("dashboard.welcomeHint")}
                </p>
              </div>

              {/* Stat cards - with proper hierarchy */}
              <div
                className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4 mb-8"
                role="list"
                aria-label={t("dashboard.statsAria")}
              >
                {quickStats.map((stat, index) => (
                  <div
                    key={stat.label}
                    className="stagger-item"
                    style={{ animationDelay: `${index * 40}ms` }}
                    role="listitem"
                  >
                    <Card className="card-hover hover-lift">
                      <CardHeader className="flex flex-row items-center justify-between pb-2">
                        {isLoadingCourses && courses.length === 0 ? (
                          <Skeleton className="h-4 w-20" />
                        ) : (
                          <CardTitle className="text-sm font-medium text-muted-foreground">
                            {stat.label}
                          </CardTitle>
                        )}
                        {isLoadingCourses && courses.length === 0 ? (
                          <Skeleton className="h-4 w-4 rounded-full" />
                        ) : (
                          <stat.icon className={`w-4 h-4 ${stat.color}`} aria-hidden="true" />
                        )}
                      </CardHeader>
                      <CardContent>
                        {isLoadingCourses && courses.length === 0 ? (
                          <Skeleton className="h-8 w-14" />
                        ) : (
                          <div className="text-3xl font-bold text-foreground font-mono">
                            {stat.value}
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  </div>
                ))}
              </div>

              {/* Due in the next 7 days (unified deadline timeline) */}
              <div className="mb-4 flex items-center justify-between">
                <h3 className="text-lg font-semibold text-foreground">{t("dashboard.dueIn7")}</h3>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-muted-foreground"
                  onClick={() => setActiveTab("calendar")}
                >
                  {t("dashboard.viewCalendar")}
                  <ChevronRight className="w-4 h-4 ml-1" />
                </Button>
              </div>
              {dueSoonCount === 0 ? (
                <p className="text-sm text-muted-foreground mb-6">{t("dashboard.upcomingEmpty")}</p>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-6" role="list" aria-label={t("dashboard.dueIn7")}>
                  {deadlineItems
                    .filter((d) => d.ts >= Date.now() && d.ts <= Date.now() + 7 * 86_400_000)
                    .slice(0, 6)
                    .map(renderDeadlineCard)}
                </div>
              )}

              {/* Grades progress */}
              <div className="mb-4 flex items-center justify-between">
                <h3 className="text-lg font-semibold text-foreground">{t("dashboard.gradesProgress")}</h3>
                <span className="text-sm text-muted-foreground">
                  {t("dashboard.gradedOf", { graded: gradedCount, total: (gradeOverview || []).length })}
                </span>
              </div>
              {(gradeOverview || []).length === 0 ? (
                <div className="mb-8 p-6 rounded-2xl bg-card border border-border text-center">
                  <GradeEmptyIllustration className="w-28 h-28 mx-auto mb-3" />
                  <p className="text-sm text-muted-foreground max-w-md mx-auto leading-relaxed">
                    {t("dashboard.gradesNoData")}
                  </p>
                </div>
              ) : gradedCount === 0 ? (
                <div className="mb-8 p-6 rounded-2xl bg-card border border-border text-center">
                  <GradeEmptyIllustration className="w-28 h-28 mx-auto mb-3" />
                  <p className="text-sm text-muted-foreground max-w-md mx-auto leading-relaxed">
                    {t("dashboard.gradesEmpty")}
                  </p>
                </div>
              ) : (
                <div className="mb-8 p-4 rounded-2xl bg-card border border-border">
                  <div className="flex flex-wrap gap-2">
                    {(gradeOverview || []).slice(0, 12).map((g) => (
                      <span
                        key={g.unit}
                        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border ${
                          g.grade !== "-"
                            ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20"
                            : "bg-secondary text-muted-foreground border-border"
                        }`}
                        title={g.unit}
                      >
                        {g.grade !== "-" ? g.grade : "–"}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Course grid */}
              <div className="mb-4 flex items-center justify-between">
                <h3 className="text-lg font-semibold text-foreground">{t("dashboard.myCourses")}</h3>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-muted-foreground"
                  onClick={() => setActiveTab("courses")}
                >
                  {t("dashboard.viewAll")}
                  <ChevronRight className="w-4 h-4 ml-1" />
                </Button>
              </div>

              {loadError && (
                <div className="mb-4 p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-sm text-destructive">
                  {loadError}
                </div>
              )}

              {renderCourseGrid()}
            </>
          )}

          {/* ============================================================ */}
          {/* CALENDAR TAB */}
          {/* ============================================================ */}
          {activeTab === "calendar" && (
            <>
              <div className="mb-8 flex items-start justify-between gap-4">
                <div>
                  <h2 className="text-2xl font-bold mb-2 text-foreground">{t("dashboard.calendarTitle")}</h2>
                  <p className="text-muted-foreground line-length">
                    {t("dashboard.calendarSubtitle")}
                  </p>
                </div>
                <select
                  className="h-10 rounded-xl border border-input bg-background text-foreground px-4 py-2 text-sm shrink-0"
                  value={calFilter}
                  onChange={(e) => setCalFilter(e.target.value)}
                  aria-label={t("dashboard.allCourses")}
                >
                  <option value="all">{t("dashboard.allCourses")}</option>
                  {(courses || [])
                    .filter((cc) => deadlineItems.some((d) => d.courseId === cc.id))
                    .map((cc) => (
                      <option key={cc.id} value={cc.id}>
                        {cc.shortName || cc.fullName}
                      </option>
                    ))}
                </select>
              </div>

              {deadlineItems.length === 0 ? (
                <p className="text-muted-foreground">{t("dashboard.noEvents")}</p>
              ) : (
                (() => {
                  const now = Date.now();
                  const groups: { label: string; items: typeof deadlineItems }[] = [
                    { label: t("dashboard.today"), items: deadlineItems.filter((d) => d.ts >= now && d.ts < now + 86_400_000) },
                    { label: t("dashboard.next7"), items: deadlineItems.filter((d) => d.ts >= now + 86_400_000 && d.ts < now + 7 * 86_400_000) },
                    { label: t("dashboard.thisMonth"), items: deadlineItems.filter((d) => d.ts >= now + 7 * 86_400_000 && d.ts < now + 30 * 86_400_000) },
                    { label: t("dashboard.later"), items: deadlineItems.filter((d) => d.ts >= now + 30 * 86_400_000) },
                  ];
                  const visible = groups
                    .map((g) => ({
                      ...g,
                      items: g.items.filter((d) => calFilter === "all" || String(d.courseId) === calFilter),
                    }))
                    .filter((g) => g.items.length > 0);
                  return visible.length === 0 ? (
                    <p className="text-muted-foreground">{t("dashboard.noEvents")}</p>
                  ) : (
                    visible.map((g) => (
                      <div key={g.label}>
                        <h3 className="text-lg font-semibold text-foreground mb-3">{g.label}</h3>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-6" role="list">
                          {g.items.map(renderDeadlineCard)}
                        </div>
                      </div>
                    ))
                  );
                })()
              )}
            </>
          )}

          {/* ============================================================ */}
          {/* COURSES TAB */}
          {/* ============================================================ */}
          {activeTab === "courses" && (
            <>
              <div className="mb-8 flex items-center justify-between">
                <div>
                  <h2 className="text-2xl font-bold mb-2 text-foreground">
                    {t("dashboard.coursesTitle")}
                  </h2>
                  <p className="text-muted-foreground line-length">
                    {t("dashboard.coursesSubtitle")}
                  </p>
                </div>
                <span className="text-sm text-muted-foreground font-mono flex-shrink-0">
                  {t("dashboard.coursesCount", { count: displayCourses.length })}
                </span>
              </div>

              {loadError && (
                <div className="mb-4 p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-sm text-destructive">
                  {loadError}
                </div>
              )}

              {renderCourseGrid()}
            </>
          )}

          {/* ============================================================ */}
          {/* RESOURCES TAB */}
          {/* ============================================================ */}
          {activeTab === "resources" && (
            <>
              <div className="mb-8 flex items-center justify-between">
                <div>
                  <h2 className="text-2xl font-bold mb-2 text-foreground">{t("dashboard.resourcesTitle")}</h2>
                  <p className="text-muted-foreground line-length">
                    {t("dashboard.resourcesSubtitle")}
                  </p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleManualSync}
                  // `disabled` would apply pointer-events-none (button.tsx) and swallow the
                  // native title tooltip — use aria-disabled + visual dimming instead; the
                  // click guard lives inside handleManualSync.
                  className={"gap-2" + (syncStatus.isRunning || isLoadingCourses || manualSyncCooldown ? " opacity-50 cursor-not-allowed" : "")}
                  title={
                    syncStatus.isRunning
                      ? t("dashboard.syncing")
                      : manualSyncCooldown
                        ? t("dashboard.refreshCooldown")
                        : t("dashboard.refresh")
                  }
                  aria-disabled={syncStatus.isRunning || isLoadingCourses || manualSyncCooldown}
                >
                  {syncStatus.isRunning ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>{t("dashboard.syncing")}</span>
                    </>
                  ) : (
                    <>
                      <CloudDownload className="w-4 h-4" />
                      <span>{manualSyncCooldown ? t("dashboard.refreshCooldown") : t("dashboard.refresh")}</span>
                    </>
                  )}
                </Button>
              </div>

              <div className="relative mb-3">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  type="text"
                  value={resourceQuery}
                  onChange={(e) => setResourceQuery(e.target.value)}
                  placeholder={t("dashboard.resourcesSearchPlaceholder")}
                  className="pl-9"
                  aria-label={t("dashboard.resourcesSearchPlaceholder")}
                />
              </div>

              {/* Unit primary selector: picking a course renders only that course, fixing overload/lag */}
              <div className="flex items-center gap-2 mb-4 overflow-x-auto pb-1" role="tablist" aria-label={t("dashboard.resourcesUnitFilterLabel")}>
                <Button
                  variant={selectedResourceCourseId == null ? "default" : "outline"}
                  size="sm"
                  onClick={() => setSelectedResourceCourseId(null)}
                  aria-pressed={selectedResourceCourseId == null}
                  className="shrink-0"
                >
                  {t("dashboard.resourcesAllUnits")}
                  <span className="ml-1 text-xs opacity-70">{resources.filter((r) => r.courseId !== 1).length}</span>
                </Button>
                {unitOptions.map((opt) => (
                  <Button
                    key={opt.id}
                    variant={selectedResourceCourseId === opt.id ? "default" : "outline"}
                    size="sm"
                    onClick={() => setSelectedResourceCourseId(opt.id)}
                    aria-pressed={selectedResourceCourseId === opt.id}
                    className="shrink-0"
                  >
                    {opt.label}
                    <span className="ml-1 text-xs opacity-70">{opt.count}</span>
                  </Button>
                ))}
              </div>

              {/* Type filter (secondary): all / files / links / folders, applied to the current Unit */}
              <div className="flex items-center gap-2 mb-5 flex-wrap">
                {(
                  [
                    ["all", t("dashboard.resourcesFilterAll")],
                    ["file", t("dashboard.resourcesFilterFiles")],
                    ["link", t("dashboard.resourcesFilterLinks")],
                    ["folder", t("dashboard.resourcesFilterFolders")],
                  ] as const
                ).map(([key, label]) => (
                  <Button
                    key={key}
                    variant={resourceTypeFilter === key ? "default" : "outline"}
                    size="sm"
                    onClick={() => setResourceTypeFilter(key)}
                    aria-pressed={resourceTypeFilter === key}
                  >
                    {label}
                  </Button>
                ))}
                {filteredDownloadable.length > 0 && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={toggleSelectAll}
                    className="ml-auto shrink-0"
                  >
                    {allFilteredSelected ? t("common.cancel") : t("dashboard.selectAll")}
                  </Button>
                )}
              </div>

              {/* Batch-download action bar: appears once at least one resource is selected */}
              {selectedResourceUrls.size > 0 && (
                <div className="flex items-center gap-3 mb-4 rounded-lg border border-border bg-card px-4 py-2 shadow-sm">
                  <span className="text-sm font-medium">{t("dashboard.selectedCount", { count: selectedResourceUrls.size })}</span>
                  <div className="ml-auto flex items-center gap-2">
                    <Button size="sm" variant="outline" onClick={() => setSelectedResourceUrls(new Set())} disabled={batchDownloading}>
                      {t("common.cancel")}
                    </Button>
                    <Button size="sm" onClick={handleBatchDownloadSelected} disabled={batchDownloading}>
                      {batchDownloading ? (
                        <Loader2 className="w-4 h-4 mr-1 animate-spin" />
                      ) : (
                        <Download className="w-4 h-4 mr-1" />
                      )}
                      {t("dashboard.downloadSelected")}
                    </Button>
                  </div>
                </div>
              )}

              {unitScopedResources.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-14 text-center">
                  <EmptyBox className="w-32 h-32 mb-4" />
                  <p className="text-sm font-medium text-muted-foreground">{t("dashboard.noResources")}</p>
                  <p className="text-xs text-muted-foreground/60 mt-1">{t("dashboard.noResourcesHint")}</p>
                </div>
              ) : selectedResourceCourseId != null ? (
                // Single Unit mode: render that course grouped by week directly (no per-course wrapper, lighter)
                (() => {
                  const course = courses.find((c) => c.id === selectedResourceCourseId);
                  const unitLabel =
                    course?.shortName ||
                    course?.fullName ||
                    `Course ${selectedResourceCourseId}`;
                  return (
                    <section aria-label={unitLabel}>
                      <div className="flex items-center gap-2 mb-3">
                        <h3 className="font-semibold text-foreground truncate">{unitLabel}</h3>
                        <Badge variant="secondary" className="text-xs shrink-0">{unitScopedResources.length}</Badge>
                      </div>
                      {renderWeekGroups(unitScopedResources, unitLabel)}
                    </section>
                  );
                })()
              ) : (
                // All Units mode: course -> week, truncated to 30 items per course by default
                <div className="space-y-6">
                  {groupedResources.map(([courseId, items]) => {
                    const course = courses.find((c) => c.id === courseId);
                    const label =
                      course?.shortName ||
                      course?.fullName ||
                      (courseId === 0 ? t("dashboard.resourcesUnknownCourse") : `Course ${courseId}`);
                    const expanded = expandedCourses.has(courseId);
                    const visible = expanded ? items : items.slice(0, 30);
                    return (
                      <section key={courseId} aria-label={label}>
                        <div className="flex items-center gap-2 mb-3">
                          <h3 className="font-semibold text-foreground truncate">{label}</h3>
                          <Badge variant="secondary" className="text-xs shrink-0">{items.length}</Badge>
                          {items.length > 30 && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="ml-auto shrink-0"
                              onClick={() => toggleExpand(courseId)}
                            >
                              {expanded
                                ? t("dashboard.resourcesShowLess")
                                : `${t("dashboard.resourcesShowAll")} (${items.length - 30})`}
                            </Button>
                          )}
                        </div>
                        {renderWeekGroups(visible, label)}
                      </section>
                    );
                  })}
                </div>
              )}
            </>
          )}

          {/* NOTIFICATIONS TAB */}
          {/* ============================================================ */}
          {activeTab === "notifications" && (
            <>
              <div className="mb-8 flex items-start justify-between gap-4">
                <div>
                  <h2 className="text-2xl font-bold mb-2 text-foreground">{t("dashboard.notificationsTitle")}</h2>
                  <p className="text-muted-foreground line-length">
                    {t("dashboard.notificationsSubtitle")}
                  </p>
                </div>
                {/* Show only while there are unread items; the button disappears once everything is read */}
                {(announcements || []).some((a: any) => !readAnnouncementIds.includes(a.id)) && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="shrink-0"
                    onClick={() => markAllAnnouncementsRead()}
                  >
                    <CheckCheck className="w-4 h-4 mr-2" />
                    {t("dashboard.markAllRead")}
                  </Button>
                )}
              </div>

              {(() => {
                const list = (announcements || []) as any[];
                if (list.length === 0) {
                  // Empty state, three ways: syncing / sync failed (retryable) / genuinely no announcements
                  if (syncStatus.isRunning || isLoadingCourses) {
                    return (
                      <div className="space-y-3" aria-hidden="true">
                        {Array.from({ length: 3 }).map((_, i) => (
                          <div key={i} className="flex items-start gap-4 p-4 rounded-2xl border bg-card">
                            <Skeleton className="h-10 w-10 rounded-xl" />
                            <div className="flex-1 space-y-2">
                              <Skeleton className="h-4 w-1/3" />
                              <Skeleton className="h-3 w-2/3" />
                              <Skeleton className="h-3 w-1/4" />
                            </div>
                          </div>
                        ))}
                      </div>
                    );
                  }
                  if (!syncStatus.lastSync) {
                    return (
                      <div className="p-4 rounded-xl bg-destructive/10 border border-destructive/20 text-sm text-destructive flex items-center gap-3 flex-wrap">
                        <span>{t("dashboard.notifSyncFailed")}</span>
                        <Button variant="outline" size="sm" onClick={() => syncAllData()}>
                          {t("dashboard.sync")}
                        </Button>
                      </div>
                    );
                  }
                  return (
                    <div className="flex flex-col items-center justify-center py-14 text-center">
                      <EmptyBox className="w-32 h-32 mb-4" />
                      <p className="text-sm font-medium text-muted-foreground">{t("dashboard.noNotifications")}</p>
                    </div>
                  );
                }
                const unreadCount = list.filter((a: any) => !readAnnouncementIds.includes(a.id)).length;
                const ALL_TYPES = ["all", "assignment", "quiz", "exam", "resource", "grade", "general"] as const;
                const typeOf = (a: any) => classifyAnnouncement(a.title || "", a.content || "");
                const availableTypes = ALL_TYPES.filter(
                  (ty) => ty === "all" || list.some((a) => typeOf(a) === ty)
                );
                const filtered =
                  notifTypeFilter === "all"
                    ? list
                    : list.filter((a) => typeOf(a) === notifTypeFilter);
                // Group by course: unread first within a group, newest first; groups ordered by their most recent announcement, newest first
                const groups = new Map<number, any[]>();
                for (const a of filtered) {
                  const k = a.courseId ?? 0;
                  if (!groups.has(k)) groups.set(k, []);
                  groups.get(k)!.push(a);
                }
                const sortByDate = (arr: any[]) =>
                  [...arr].sort((x, y) => {
                    const tx = new Date(x.date || x.postedDate || 0).getTime() || 0;
                    const ty = new Date(y.date || y.postedDate || 0).getTime() || 0;
                    return ty - tx;
                  });
                const ordered = [...groups.entries()]
                  .map(([cid, items]) => [cid, sortByDate(items)] as const)
                  .sort((x, y) => {
                    const t1 = new Date(x[1][0]?.date || x[1][0]?.postedDate || 0).getTime() || 0;
                    const t2 = new Date(y[1][0]?.date || y[1][0]?.postedDate || 0).getTime() || 0;
                    return t2 - t1;
                  });
                const notifTypeBadge: Record<string, string> = {
                  assignment: "warning",
                  quiz: "secondary",
                  exam: "destructive",
                  resource: "info",
                  grade: "success",
                  general: "outline",
                };
                return (
                  <>
                    <div className="flex items-center gap-2 mb-4 flex-wrap">
                      <span className="text-sm text-muted-foreground mr-1">
                        {t("dashboard.notifUnreadCount", { count: unreadCount, total: list.length })}
                      </span>
                      {availableTypes.map((ty) => (
                        <button
                          key={ty}
                          onClick={() => setNotifTypeFilter(ty)}
                          className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-all ${
                            notifTypeFilter === ty
                              ? "bg-primary text-primary-foreground border-primary"
                              : "bg-card text-muted-foreground border-border hover:border-primary/50"
                          }`}
                        >
                          {t(`dashboard.notifType.${ty}`)}
                        </button>
                      ))}
                    </div>
                    {ordered.length === 0 ? (
                      <p className="text-muted-foreground">{t("dashboard.noNotifications")}</p>
                    ) : (
                      (() => {
                        const termEndedOf = (cid: number) => {
                          const course = (courses || []).find((cc) => cc.id === cid);
                          return isTermEnded(course?.fullName);
                        };
                        const activeGroups = ordered.filter(([cid]) => !termEndedOf(cid));
                        const historyGroups = ordered.filter(([cid]) => termEndedOf(cid));
                        const historyCount = historyGroups.reduce((n, [, items]) => n + items.length, 0);
                        const renderGroup = ([cid, items]: readonly [number, any[]]) => {
                        const course = (courses || []).find((cc) => cc.id === cid);
                        const cname = course?.shortName || (cid ? `Course ${cid}` : t("dashboard.generalNotices"));
                        const unread = items.filter((a: any) => !readAnnouncementIds.includes(a.id)).length;
                        return (
                          <div key={cid} className="mb-6">
                            <div className="flex items-center gap-2 mb-2">
                              <h3 className="text-sm font-semibold text-foreground">{cname}</h3>
                              {unread > 0 && <Badge variant="warning">{unread}</Badge>}
                            </div>
                            <div className="space-y-3 announcements-list" role="list" aria-label={t("dashboard.notificationsAria")}>
                              {items.map((a: any, index: number) => {
                                const isUnread = !readAnnouncementIds.includes(a.id);
                                const type = typeOf(a);
                                return (
                                  <div
                                    key={a.id || `${cid}-${index}`}
                                    className="stagger-item"
                                    style={{ animationDelay: `${index * 40}ms` }}
                                    role="listitem"
                                  >
                                    <Card
                                      className={`card-hover cursor-pointer border-l-4 ${
                                        isUnread ? "border-l-primary" : "border-l-transparent opacity-70"
                                      }`}
                                      onClick={() => {
                                        markAnnouncementRead(a.id);
                                        const url =
                                          a.url ||
                                          (a.id
                                            ? `https://learning.monash.edu/mod/forum/discuss.php?d=${a.id}`
                                            : "");
                                        if (url) openAnnouncement(url);
                                      }}
                                    >
                                      <CardContent className="flex items-start gap-4 p-4">
                                        {getNotificationIcon(type)}
                                        <div className="flex-1 min-w-0">
                                          <div className="flex items-center gap-2 mb-1 flex-wrap">
                                            <Badge variant={notifTypeBadge[type] as any}>
                                              {t(`dashboard.notifType.${type}`)}
                                            </Badge>
                                            <h4 className={`text-foreground ${isUnread ? "font-semibold" : "font-normal"}`}>
                                              {a.title}
                                            </h4>
                                            {isUnread && (
                                              <span
                                                className="w-2 h-2 rounded-full bg-accent flex-shrink-0"
                                                aria-label={t("dashboard.unreadLabel")}
                                              />
                                            )}
                                          </div>
                                          <p className="text-sm text-muted-foreground mb-2">{a.content}</p>
                                          <div className="flex items-center gap-2">
                                            <span className="text-xs text-muted-foreground">
                                              {a.author ? `${a.author} · ` : ""}
                                              {a.date || a.postedDate || ""}
                                            </span>
                                          </div>
                                        </div>
                                      </CardContent>
                                    </Card>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        );
                        };
                        return (
                          <>
                            {activeGroups.map(renderGroup)}
                            {historyGroups.length > 0 && (
                              <div className="mb-4">
                                <button
                                  onClick={() => setNotifHistoryOpen(!notifHistoryOpen)}
                                  className="flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-secondary/50 transition-all w-full text-left"
                                >
                                  <span className={`inline-block transition-transform ${notifHistoryOpen ? "" : "-rotate-90"}`}>▾</span>
                                  {t("dashboard.notifHistory", { count: historyCount })}
                                </button>
                                {notifHistoryOpen && historyGroups.map(renderGroup)}
                              </div>
                            )}
                          </>
                        );
                      })()
                    )}
                  </>
                );
              })()}
            </>
          )}
        </div>
      </main>
    </div>
  );
}
