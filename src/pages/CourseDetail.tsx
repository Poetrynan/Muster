import { motion } from "framer-motion";
import {
  AlertCircle,
  ArrowLeft,
  BookOpen,
  Calendar,
  CheckCircle2,
  ClipboardList,
  Download,
  ExternalLink,
  FileText,
  MessageSquare,
  Sparkles,
  Video,
  X,
  Loader2,
  ChevronsUp,
  ChevronsDown,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Avatar } from "../components/ui/avatar";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Tabs } from "../components/ui/tabs";
import { Skeleton } from "../components/ui/skeleton";
import { MarkdownRenderer } from "../components/ui/MarkdownRenderer";
import { useAppStore } from "../stores/useAppStore";
import { DownloadCenter } from "../components/DownloadCenter";
import { DownloadProgressRing } from "../components/ui/download-progress-ring";
import { downloadFile } from "../services/api";
import { showToast } from "../components/ui/toast";
import { buildAiUrl, splitAiUrl } from "../services/aiUrl";
import {
  fetchCourseResources,
  fetchCourseContacts,
  generateSummaryStream,
  fetchCourseAssessments,
  fetchCourseUnitInfo,
  fetchCourseSchedule,
  fetchAssignmentSubmission,
  fetchCourseRecordings,
  fetchUnitDashboard,
} from "../services/api";
import type {
  CourseContact,
  Resource,
  Assignment,
  UnitInfo,
  Schedule,
  Recording,
  SubmissionStatus,
  UnitDashboard,
} from "../services/api";
import { useTranslation } from "../i18n/useTranslation";
import { getEffectiveAssignmentStatus } from "../lib/utils";

interface CourseDetailProps {
  courseId: number;
  onBack: () => void;
}

// Zustand v5 uses useSyncExternalStore, so a selector's return value must be referentially stable:
// writing `state.courseResources[id] || []` inside the selector allocates a new array on every call,
// Object.is is always false -> React thinks the snapshot keeps changing -> infinite re-render (React error #185).
// So the empty array is hoisted to module scope as a single reusable constant.
const EMPTY_RESOURCES: Resource[] = [];

// Moodle section titles use "A | B" separators; render them as " · " for readability.
function cleanTitle(s: string): string {
  return s.replace(/\s*\|\s*/g, " · ");
}

export function CourseDetail({ courseId, onBack }: CourseDetailProps) {
  const [activeTab, setActiveTab] = useState("materials");
  const {
    courses,
    allResources,
    assignments,
    announcements,
    settings,
    downloads,
    setCourseResources,
    addSummary,
  } = useAppStore();
  // Tab data fetched live by the full sync on every login: render instantly from the
  // in-memory store, and only fall back to on-demand fetching when the sync hasn't
  // populated the data yet (e.g. the user opened a course before the sync finished).
  const cachedContacts = useAppStore((s) => s.contacts[courseId]);
  const cachedDashboard = useAppStore((s) => s.unitDashboards[courseId]);
  const cachedUnitInfo = useAppStore((s) => s.unitInfos[courseId]);
  const cachedSchedule = useAppStore((s) => s.schedules[courseId]);
  const cachedRecordings = useAppStore((s) => s.recordings[courseId]);
  const setCourseTabData = useAppStore((s) => s.setCourseTabData);
  const { t } = useTranslation();
  const [loadingResources, setLoadingResources] = useState(false);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [streamContent, setStreamContent] = useState("");
  const [thinkingText, setThinkingText] = useState("");
  const [thinkingExpanded, setThinkingExpanded] = useState(false);
  const [thinkingActive, setThinkingActive] = useState(false);
  const streamRef = useRef("");
  const [loadingContacts, setLoadingContacts] = useState(false);
  const [contacts, setContacts] = useState<CourseContact[]>(cachedContacts ?? []);
  const [contactsError, setContactsError] = useState<string | null>(null);

  // Task #38 — Unit Info (handbook) + Schedule, fetching &section=1 / &section=2 of the same course in parallel
  const [loadingUnitInfo, setLoadingUnitInfo] = useState(false);
  const [unitInfo, setUnitInfo] = useState<UnitInfo | null>(cachedUnitInfo ?? null);
  const [schedule, setSchedule] = useState<Schedule | null>(cachedSchedule ?? null);
  const [unitInfoError, setUnitInfoError] = useState<string | null>(null);

  // Task #40 — Lecture Recordings (Panopto block)
  const [loadingRecordings, setLoadingRecordings] = useState(false);
  const [recordings, setRecordings] = useState<Recording[]>(cachedRecordings ?? []);
  const [recordingsError, setRecordingsError] = useState<string | null>(null);
  // Distinguish "fetched and empty" from "never fetched", so an empty cache isn't
  // refetched on every tab switch; the full sync marks it loaded even when a course
  // has no recordings at all.
  const [recordingsLoaded, setRecordingsLoaded] = useState(cachedRecordings !== undefined);
  // Unit Dashboard (unit overview, section=0)
  const [dashboardData, setDashboardData] = useState<UnitDashboard | null>(cachedDashboard ?? null);
  const [loadingDashboard, setLoadingDashboard] = useState(false);
  const [dashboardError, setDashboardError] = useState<string | null>(null);

  // Task #37 — assessment overview (assignments + quizzes + weights + categories), from &section=56
  // Initial true: the first paint must show the skeleton, not flash the store fallback list.

  // Task #39 — submission status / feedback dialog for a single assignment
  const [submission, setSubmission] = useState<SubmissionStatus | null>(null);
  const [submissionLoading, setSubmissionLoading] = useState(false);
  const [submissionError, setSubmissionError] = useState<string | null>(null);
  const [submissionForId, setSubmissionForId] = useState<number | null>(null);

  const course = courses.find((c) => c.id === courseId);

  // Write one tab's freshly fetched data back into the in-memory store (merged with
  // whatever the full sync fetched), so later tab switches render without refetching.
  const patchTabData = (patch: {
    dashboard?: UnitDashboard | null;
    unitInfo?: UnitInfo | null;
    schedule?: Schedule | null;
    recordings?: Recording[];
    contacts?: CourseContact[];
  }) => {
    const state = useAppStore.getState();
    setCourseTabData([
      {
        courseId,
        dashboard: patch.dashboard !== undefined ? patch.dashboard : (state.unitDashboards[courseId] ?? null),
        unitInfo: patch.unitInfo !== undefined ? patch.unitInfo : (state.unitInfos[courseId] ?? null),
        schedule: patch.schedule !== undefined ? patch.schedule : (state.schedules[courseId] ?? null),
        recordings: patch.recordings ?? state.recordings[courseId] ?? [],
        contacts: patch.contacts ?? state.contacts[courseId] ?? [],
      },
    ]);
  };

  // Open a link in an in-app WebView window, sharing the SSO session cookie.
  const handleOpenInBrowser = async (url?: string) => {
    if (!url) return;
    try {
      await invoke("open_in_app_webview", { url, title: "Moodle" });
    } catch (err) {
      console.warn("In-app open failed, falling back to external:", err);
      try { await openUrl(url); } catch { /* silent */ }
    }
  };

  const courseAssignments = useMemo(
    () => assignments.filter((a) => a.courseId === courseId),
    [assignments, courseId]
  );
  // Assignments come from the full sync (fetched live on every login): seed the local
  // state from it so the tab renders instantly. The skeleton only appears when the sync
  // hasn't covered this course yet and an on-demand fetch is actually running.
  const [loadingAssessments, setLoadingAssessments] = useState(courseAssignments.length === 0);
  const [assessments, setAssessments] = useState<Assignment[]>(courseAssignments);
  const [assessmentsError, setAssessmentsError] = useState<string | null>(null);
  const courseAnnouncements = useMemo(
    () => announcements.filter((a) => a.courseId === courseId),
    [announcements, courseId]
  );

  const courseResources = useAppStore(
    (state) => state.courseResources[courseId] ?? EMPTY_RESOURCES
  );

  const displayedResources = useMemo(() => {
    if (courseResources.length > 0) return courseResources;
    return allResources.filter((r) => r.courseId === courseId);
  }, [courseResources, allResources, courseId]);

  useEffect(() => {
    if (displayedResources.length === 0 && !loadingResources) {
      setLoadingResources(true);
      fetchCourseResources(courseId)
        .then((resources) => {
          setCourseResources(courseId, resources);
        })
        .catch((err) => {
          console.error("Failed to load course resources:", err);
        })
        .finally(() => setLoadingResources(false));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [courseId]);

  const tabs = [
    { id: "dashboard", label: t("course.tab.dashboard") },
    { id: "materials", label: t("course.tab.materials") },
    { id: "assignments", label: t("course.tab.assignments") },
    { id: "announcements", label: t("course.tab.announcements") },
    { id: "contacts", label: t("course.tab.contacts") },
    { id: "unitInfo", label: t("course.tab.unitInfo") },
    { id: "recordings", label: t("course.tab.recordings") },
    { id: "aiSummary", label: t("course.tab.aiSummary") },
  ];

  const getFileIcon = (type: string) => {
    const t = type.toLowerCase();
    if (t === "pdf") return <FileText className="w-5 h-5 text-red-500" />;
    if (t === "doc") return <FileText className="w-5 h-5 text-blue-500" />;
    if (t === "ppt") return <FileText className="w-5 h-5 text-orange-500" />;
    if (t === "video") return <FileText className="w-5 h-5 text-purple-500" />;
    if (t === "link") return <FileText className="w-5 h-5 text-cyan-500" />;
    return <FileText className="w-5 h-5 text-gray-500" />;
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "pending":
        return <Badge variant="warning">{t("assignments.status.pending")}</Badge>;
      case "submitted":
        return <Badge variant="info">{t("assignments.status.submitted")}</Badge>;
      case "graded":
        return <Badge variant="success">{t("assignments.status.graded")}</Badge>;
      case "overdue":
        return <Badge variant="danger">{t("assignments.status.overdue")}</Badge>;
      case "upcoming":
        return <Badge variant="secondary">{t("assignments.status.upcoming")}</Badge>;
      default:
        return <Badge>{status}</Badge>;
    }
  };

  // Contacts come from the full sync when available; only fetch on demand when the data
  // is missing (sync not finished yet, or a course not covered by the last sync).
  useEffect(() => {
    if (cachedContacts !== undefined) {
      setContacts(cachedContacts);
      setLoadingContacts(false);
      return;
    }
    let ignore = false;
    setContacts([]);
    setContactsError(null);
    setLoadingContacts(true);
    fetchCourseContacts(courseId)
      .then((res) => {
        if (ignore) return;
        setContacts(res);
        patchTabData({ contacts: res });
      })
      .catch((err) => { if (!ignore) setContactsError(`Fetch failed: ${err}`); })
      .finally(() => { if (!ignore) setLoadingContacts(false); });
    return () => { ignore = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [courseId, cachedContacts]);

  // Task #38 — fetch the handbook (&section=1) and schedule (&section=2) in parallel
  const handleFetchUnitInfo = async () => {
    setLoadingUnitInfo(true);
    setUnitInfoError(null);
    try {
      const [ui, sc] = await Promise.all([
        fetchCourseUnitInfo(courseId),
        fetchCourseSchedule(courseId),
      ]);
      setUnitInfo(ui);
      setSchedule(sc);
      patchTabData({ unitInfo: ui, schedule: sc });
    } catch (err) {
      setUnitInfoError(t("course.unitInfo.error", { error: String(err) }));
    } finally {
      setLoadingUnitInfo(false);
    }
  };

  // Task #40 — fetch Panopto recordings
  const handleFetchRecordings = async () => {
    setLoadingRecordings(true);
    setRecordingsError(null);
    try {
      const res = await fetchCourseRecordings(courseId);
      setRecordings(res);
      setRecordingsLoaded(true);
      patchTabData({ recordings: res });
    } catch (err) {
      setRecordingsError(t("course.recordings.error", { error: String(err) }));
    } finally {
      setLoadingRecordings(false);
    }
  };

  // Unit Dashboard: current week overview + learning objectives + week index
  const handleFetchDashboard = async () => {
    setLoadingDashboard(true);
    setDashboardError(null);
    try {
      const res = await fetchUnitDashboard(courseId);
      setDashboardData(res);
      patchTabData({ dashboard: res });
    } catch (err) {
      setDashboardError(String(err));
    }
    setLoadingDashboard(false);
  };

  // Auto-fetch on first tab open (overview / unit info / recordings) - the user
  // should never have to discover a fetch button; the buttons stay as manual refresh.
  useEffect(() => {
    if (activeTab === "unitInfo" && !unitInfo && !schedule && !loadingUnitInfo && !unitInfoError) {
      handleFetchUnitInfo();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

  useEffect(() => {
    if (activeTab === "recordings" && !recordingsLoaded && !loadingRecordings && !recordingsError) {
      handleFetchRecordings();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

  useEffect(() => {
    if (activeTab === "dashboard" && !dashboardData && !loadingDashboard && !dashboardError) {
      handleFetchDashboard();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

  // When the full sync finishes while this course is already open, adopt the fresh data
  // so the tabs update without a reload (values are identical when nothing changed).
  useEffect(() => {
    if (cachedDashboard) setDashboardData(cachedDashboard);
  }, [cachedDashboard]);
  useEffect(() => {
    if (cachedUnitInfo) setUnitInfo(cachedUnitInfo);
    if (cachedSchedule) setSchedule(cachedSchedule);
  }, [cachedUnitInfo, cachedSchedule]);
  useEffect(() => {
    if (cachedRecordings !== undefined) {
      setRecordings(cachedRecordings);
      setRecordingsLoaded(true);
    }
  }, [cachedRecordings]);

  // Real download via the shared download manager (visible in the top-bar
  // download panel), same as the Dashboard resource rows.
  // NOTE: the download-manager key MUST be the plain URL — the backend emits
  // "download-progress" with key=file_url, so a composite row key would never
  // receive progress updates (spinner without percentage).
  const [resourceDownloadingKey, setResourceDownloadingKey] = useState<string | null>(null);
  const handleDownloadResource = async (resource: { key: string; name: string; url?: string }) => {
    if (!resource.url || resourceDownloadingKey) return;
    const { upsertDownload } = useAppStore.getState();
    const settings = useAppStore.getState().settings;
    const dlKey = resource.url;
    setResourceDownloadingKey(resource.key);
    upsertDownload({
      key: dlKey,
      name: resource.name,
      received: 0,
      total: null,
      speed: 0,
      status: "downloading",
      lastTick: Date.now(),
    });
    try {
      const savedPath = await downloadFile(resource.url, settings.downloadPath || "");
      upsertDownload({
        key: dlKey,
        name: resource.name,
        received: 1,
        total: 1,
        speed: 0,
        status: "done",
        path: savedPath,
        lastTick: Date.now(),
      });
      showToast(t("dashboard.downloaded", { path: savedPath }));
    } catch (err) {
      upsertDownload({
        key: dlKey,
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
      setResourceDownloadingKey(null);
    }
  };

  const handleOpenSection = async (sectionNum: number) => {
    const url = `https://learning.monash.edu/course/view.php?id=${courseId}&section=${sectionNum}`;
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("open_in_app_webview", { url, title: `Week ${sectionNum}` });
    } catch {
      try {
        const { openUrl } = await import("@tauri-apps/plugin-opener");
        await openUrl(url);
      } catch { /* silent */ }
    }
  };

  // Open arbitrary links (e.g. assessment links inside the schedule) in the app webview.
  const handleOpenLink = async (url: string, title: string) => {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("open_in_app_webview", { url, title });
    } catch {
      try {
        const { openUrl } = await import("@tauri-apps/plugin-opener");
        await openUrl(url);
      } catch { /* silent */ }
    }
  };

  // Click delegation for schedule cells: links rendered via dangerouslySetInnerHTML
  // open in the app webview instead of navigating the whole window.
  const handleScheduleLinkClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    const a = target.closest("a");
    if (a?.href) {
      e.preventDefault();
      handleOpenLink(a.href, a.textContent?.trim() || "Link");
    }
  };

  // Task #37 — fetch the assessment overview (assignments + quizzes + weights + categories)
  const handleFetchAssessments = async () => {
    setLoadingAssessments(true);
    setAssessmentsError(null);
    try {
      const res = await fetchCourseAssessments(courseId);
      setAssessments(res);
    } catch (err) {
      setAssessmentsError(`Fetch failed: ${err}`);
    } finally {
      setLoadingAssessments(false);
    }
  };

  // Assessments are pre-fetched by the full sync (login / launch). Only fetch on demand
  // when the store has no cached data for this course yet.
  useEffect(() => {
    if (courseAssignments.length === 0) {
      handleFetchAssessments();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [courseId]);

  // When the full sync finishes while this course is already open, adopt the fresh store
  // data — but only if the local state is still empty (a manually refreshed list is newer).
  useEffect(() => {
    if (courseAssignments.length > 0 && assessments.length === 0) {
      setAssessments(courseAssignments);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [courseAssignments]);

  // Task #39 — open the submission status / feedback dialog for a single assignment
  const handleOpenSubmission = async (assignmentId: number) => {
    setSubmissionForId(assignmentId);
    setSubmissionLoading(true);
    setSubmissionError(null);
    setSubmission(null);
    try {
      const res = await fetchAssignmentSubmission(courseId, assignmentId);
      setSubmission(res);
    } catch (err) {
      setSubmissionError(t("assignments.submission.error", { error: String(err) }));
    } finally {
      setSubmissionLoading(false);
    }
  };

  const closeSubmission = () => {
    setSubmissionForId(null);
    setSubmission(null);
    setSubmissionError(null);
  };

  // ── Jump to top / jump to bottom ─────────────────────────────────────────
  // Scrolling happens on the `flex-1 overflow-auto` container below (not the document),
  // so we must grab its ref and compute the position ourselves; `window.scrollY` is always 0 here.
  const scrollRef = useRef<HTMLDivElement>(null);
  const [scrollState, setScrollState] = useState({ canUp: false, canDown: false });

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    // Within 40px of the top/bottom, treat it as "already at the edge" and stop showing the corresponding button,
    // to avoid the button flickering in the last few pixels.
    const EDGE = 40;
    const update = () => {
      const { scrollTop, scrollHeight, clientHeight } = el;
      const overflowing = scrollHeight - clientHeight > EDGE * 2;
      setScrollState({
        canUp: overflowing && scrollTop > EDGE,
        canDown: overflowing && scrollTop < scrollHeight - clientHeight - EDGE,
      });
    };

    update();
    el.addEventListener("scroll", update, { passive: true });
    // Switching tabs / data arriving both change the content height; track it with a ResizeObserver,
    // otherwise the button won't appear when switching from short to long content.
    const ro = new ResizeObserver(update);
    ro.observe(el);
    for (const child of Array.from(el.children)) ro.observe(child);

    return () => {
      el.removeEventListener("scroll", update);
      ro.disconnect();
    };
  }, [activeTab]);

  const scrollToEdge = (to: "top" | "bottom") => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: to === "top" ? 0 : el.scrollHeight, behavior: "smooth" });
  };

  const handleGenerateSummary = async () => {
    if (!settings.aiApiKey) {
      setSummaryError(t("course.ai.error.noKey"));
      return;
    }
    if (!settings.aiBaseUrl) {
      setSummaryError(t("course.ai.error.noBaseUrl"));
      return;
    }
    setSummaryLoading(true);
    setSummaryError(null);
    streamRef.current = "";
    setStreamContent("");
    setThinkingText("");
    setThinkingExpanded(false);
    setThinkingActive(false);
    try {
      // Language directive: follows the UI language (settings.language); structural requirements are already built into the backend system prompt
      const langInstruction =
        settings.language === "zh"
          ? "Please answer in Simplified Chinese."
          : settings.language === "ja"
          ? "Please answer in Japanese."
          : settings.language === "ko"
          ? "Please answer in Korean."
          : "Please answer in English.";

      // Tell the model today's date so it can compute countdowns and priorities.
      const todayLabel = new Date().toLocaleDateString("en-CA"); // YYYY-MM-DD
      const content = [
        `Course: ${course?.fullName || courseId}`,
        `Today's date: ${todayLabel}`,
        "",
        "This week's resources:",
        ...displayedResources.slice(0, 20).map((r) => `- ${r.name}`),
        "",
        "Assignments:",
        ...courseAssignments.map((a) => `- ${a.name}${a.dueDate ? ` (Due: ${a.dueDate})` : ""}`),
        "",
        ...(assessments.some((a) => a.weight != null)
          ? [
              "Assessment weights:",
              ...assessments
                .filter((a) => a.weight != null)
                .map((a) => `- ${a.name} (Weight: ${a.weight}%)`),
            ]
          : []),
        "",
        "Announcements:",
        ...courseAnnouncements.slice(0, 10).map((a) => {
          const body = (a.content || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
          return `- ${a.title} — ${a.author}${body ? `: ${body.slice(0, 300)}` : ""}`;
        }),
        "",
        langInstruction,
      ].join("\n");

      const fullAiUrl = buildAiUrl(
        settings.aiBaseUrl || "",
        settings.aiFormat ?? splitAiUrl(settings.aiBaseUrl || "").format
      );
      await generateSummaryStream(
        content,
        settings.aiApiKey,
        fullAiUrl,
        settings.aiModel,
        {
          onChunk: (text, thinking) => {
            if (thinking) {
              setThinkingActive(true);
              setThinkingText((prev) => prev + text);
              return;
            }
            setThinkingActive(false);
            streamRef.current += text;
            setStreamContent(streamRef.current);
          },
          onDone: () => {
            setThinkingActive(false);
            addSummary(courseId, {
              id: `${courseId}-${Date.now()}`,
              courseId,
              courseName: course?.fullName || `Course ${courseId}`,
              createdAt: new Date().toISOString(),
              generatedAt: new Date().toISOString(),
              provider: settings.aiCompatType,
              model: settings.aiModel,
              content: streamRef.current,
            });
            setSummaryLoading(false);
          },
          onError: (err) => {
            setThinkingActive(false);
            setSummaryError(err);
            setSummaryLoading(false);
          },
        }
      );
    } catch (err) {
      setSummaryError(err instanceof Error ? err.message : t("course.ai.error.generic"));
    } finally {
      // In streaming mode, loading is cleared by onDone/onError; this is a fallback so error paths can't hang
      setSummaryLoading(false);
    }
  };

  const savedSummary = useAppStore((state) => state.summaries[courseId]);

  // Auto summary: when autoSummaryOnOpen is on and no cached summary exists, generate on entering the course.
  useEffect(() => {
    if (!settings.autoSummaryOnOpen) return;
    if (!settings.aiApiKey || !settings.aiBaseUrl) return;
    if (savedSummary) return;
    handleGenerateSummary();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [courseId, settings.autoSummaryOnOpen, settings.aiApiKey, settings.aiBaseUrl, savedSummary]);

  return (
    <div className="min-h-screen bg-background flex">
      {/* Sidebar - course navigation */}
      <motion.aside
        initial={{ x: -280 }}
        animate={{ x: 0 }}
        transition={{ duration: 0.4, ease: [0.25, 0.1, 0.25, 1] }}
        className="w-72 glass border-r flex flex-col"
      >
        <div className="p-4 border-b">
          <Button variant="ghost" onClick={onBack} className="gap-2">
            <ArrowLeft className="w-4 h-4" />
            {t("common.back")}
          </Button>
        </div>

        <div className="p-6 border-b">
          {/* The sidebar is only w-72 wide (about 240px after p-6), far narrower than the cards in the home course grid,
              so the font size drops one step below the text-xl used there; combined with break-words + line-clamp-2
              to keep long course names (e.g. "FIT5201 Machine learning - S2 2026") from bursting the h-24 color block */}
          <div className="h-24 rounded-2xl bg-sky-400 flex items-center justify-center mb-4 px-3 overflow-hidden">
            <span className="text-base font-bold text-white/90 text-center leading-tight break-words line-clamp-3">
              {course?.shortName || t("course.courseNumber", { id: courseId })}
            </span>
          </div>
          <h2 className="font-bold text-lg mb-1">
            {course?.fullName || t("course.details")}
          </h2>
          <p className="text-sm text-muted-foreground">
            {t("course.stats", {
              resources: displayedResources.length,
              assignments: courseAssignments.length,
              announcements: courseAnnouncements.length,
            })}
          </p>
        </div>

      </motion.aside>

      {/* Main content area */}
      <main className="flex-1 flex flex-col overflow-hidden relative">
        <header className="h-16 border-b glass flex items-center justify-between px-6">
          <div className="flex items-center gap-4">
            <BookOpen className="w-5 h-5 text-primary" />
            <h1 className="font-semibold">
              {course?.shortName || t("course.courseNumber", { id: courseId })}
            </h1>
          </div>
          {/* Same download manager as the Dashboard — users don't have to go back
              to the home page to check download progress. */}
          <DownloadCenter autoCloseKey={courseId} />
        </header>

        <div ref={scrollRef} className="flex-1 overflow-auto p-6 relative">
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3 }}
          >
            <Tabs
              tabs={tabs.map((tab) => tab.label)}
              activeTab={tabs.find((tab) => tab.id === activeTab)?.label || ""}
              onChange={(label) => {
                const found = tabs.find((tab) => tab.label === label);
                if (found) setActiveTab(found.id);
              }}
              className="mb-6"
            />

            {/* Materials tab */}
            {activeTab === "materials" && (
              <div className="space-y-3">
                {loadingResources && (
                  <div className="space-y-3" aria-hidden="true">
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
                )}
                {!loadingResources && displayedResources.length === 0 && (
                  <div className="text-center py-12 text-muted-foreground">
                    <FileText className="w-12 h-12 mx-auto mb-4" />
                    <p>{t("course.materials.empty")}</p>
                    <p className="text-xs mt-1">{t("course.materials.emptyHint")}</p>
                  </div>
                )}
                {/* Grouped by section (Week X) to make the data structure obvious at a glance.
                    Items without a section fall into "Uncategorized", listed last. */}
                {(() => {
                  const groups = new Map<string, typeof displayedResources>();
                  const NO_SECTION = "__none__";
                  for (const r of displayedResources) {
                    const key = r.section || NO_SECTION;
                    if (!groups.has(key)) groups.set(key, []);
                    groups.get(key)!.push(r);
                  }
                  // Sections come first (by name), uncategorized last
                  const orderedKeys = Array.from(groups.keys()).sort((a, b) => {
                    if (a === NO_SECTION) return 1;
                    if (b === NO_SECTION) return -1;
                    return a.localeCompare(b, undefined, { numeric: true });
                  });
                  let globalIdx = 0;
                  return orderedKeys.map((key) => (
                    <div key={key} className="space-y-2">
                      <h3 className="text-sm font-semibold text-muted-foreground px-1 pt-2 sticky top-0 bg-background/80 backdrop-blur-sm z-10">
                        {key === NO_SECTION ? t("course.materials.ungrouped") : key}
                      </h3>
                      {groups.get(key)!.map((resource) => {
                        const idx = globalIdx++;
                        // Both mod/resource and pluginfile can be downloaded directly; folder/page/url only support opening

  const isDownloadable = resource.url
    ? resource.url.includes("pluginfile.php") || resource.url.includes("mod/resource/view.php")
    : false;
                        return (
                          <motion.div
                            key={`${idx}-${resource.url ?? "no-url"}`}
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ delay: Math.min(idx, 10) * 0.03 }}
                          >
                            <Card className="card-hover">
                              <CardContent className="flex items-center gap-4 p-4">
                                {getFileIcon(resource.resourceType)}
                                <div className="flex-1 min-w-0">
                                  <p className="font-medium truncate">{resource.name}</p>
                                  {resource.modifiedDate && (
                                    <p className="text-xs text-muted-foreground mt-0.5">{resource.modifiedDate}</p>
                                  )}
                                </div>
                                {isDownloadable ? (
                                  (() => {
                                    const rowKey = `${idx}-${resource.url ?? "no-url"}`;
                                    const isThisDownloading = resourceDownloadingKey === rowKey;
                                    // Progress for THIS file only (download-manager key = url, matches backend events)
                                    const dlItem = resource.url
                                      ? downloads.find((d) => d.key === resource.url)
                                      : undefined;
                                    const pct =
                                      isThisDownloading && dlItem && dlItem.total
                                        ? Math.round(((dlItem.received ?? 0) / dlItem.total) * 100)
                                        : null;
                                    return (
                                      <Button
                                        variant="ghost"
                                        size="icon"
                                        // NOTE: `disabled` would apply pointer-events-none (button.tsx)
                                        // and swallow the native title tooltip — use aria-disabled +
                                        // visual dimming instead; handleDownloadResource guards clicks.
                                        className={isThisDownloading ? "opacity-50 cursor-not-allowed" : ""}
                                        onClick={() =>
                                          handleDownloadResource({
                                            key: rowKey,
                                            name: resource.name,
                                            url: resource.url,
                                          })
                                        }
                                        aria-disabled={isThisDownloading}
                                        title={
                                          isThisDownloading
                                            ? t("course.materials.downloading")
                                            : t("course.materials.download")
                                        }
                                      >
                                        {isThisDownloading ? (
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
                                    title={t("assignments.openInBrowser")}
                                    onClick={async () => {
                                      try {
                                        const { invoke } = await import("@tauri-apps/api/core");
                                        await invoke("open_in_app_webview", { url: resource.url, title: resource.name });
                                      } catch {
                                        try { const { openUrl } = await import("@tauri-apps/plugin-opener"); await openUrl(resource.url!); } catch { /* silent */ }
                                      }
                                    }}
                                  >
                                    <ArrowLeft className="w-4 h-4 rotate-180" />
                                  </Button>
                                ) : null}
                              </CardContent>
                            </Card>
                          </motion.div>
                        );
                      })}
                    </div>
                  ));
                })()}
              </div>
            )}

            {/* Assignments tab */}
            {activeTab === "assignments" && (
              <div className="space-y-3">
                {loadingAssessments && assessments.length === 0 ? (
                  // Loading: skeleton only. The store fallback list is NOT rendered during
                  // loading — mixing skeleton + stale list caused a flash of wrong statuses.
                  <div className="space-y-3" aria-hidden="true">
                    {Array.from({ length: 5 }).map((_, i) => (
                      <div key={i} className="rounded-2xl border bg-card p-4 flex items-center gap-3">
                        <Skeleton className="h-10 w-10 rounded-xl shrink-0" />
                        <div className="flex-1 space-y-2">
                          <Skeleton className="h-4 w-2/3" />
                          <Skeleton className="h-3 w-1/3" />
                        </div>
                        <Skeleton className="h-6 w-14 rounded-full" />
                      </div>
                    ))}
                  </div>
                ) : (
                  <>
                {assessmentsError && (
                  <div className="text-xs text-destructive break-all flex items-center gap-2 flex-wrap">
                    <span>{assessmentsError}</span>
                    <button type="button" onClick={handleFetchAssessments} className="text-primary underline font-medium hover:opacity-80">
                      {t("common.retry")}
                    </button>
                  </div>
                )}
                {(() => {
                  const displayed = assessments.length > 0 ? assessments : courseAssignments;
                  if (displayed.length === 0) {
                    return (
                      <div className="text-center py-12 text-muted-foreground">
                        <Calendar className="w-12 h-12 mx-auto mb-4" />
                        <p>{t("course.assignments.empty")}</p>
                      </div>
                    );
                  }
                  return displayed.map((assignment, index) => (
                    <motion.div
                      key={assignment.id}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: index * 0.05 }}
                    >
                      <Card className="card-hover">
                        <CardContent className="flex items-start gap-4 p-4">
                          <Calendar className="w-5 h-5 text-muted-foreground mt-1" />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <p className="font-medium">{assignment.name}</p>
                              {assignment.assessmentType === "quiz" && (
                                <Badge variant="secondary">{t("assignments.type.quiz")}</Badge>
                              )}
                              {assignment.assessmentType === "assignment" && (
                                <Badge variant="outline">{t("assignments.type.assignment")}</Badge>
                              )}
                            </div>
                            <div className="flex items-center gap-2 flex-wrap mt-1">
                              <span className="text-sm text-muted-foreground">
                                {assignment.dueDate
                                  ? t("assignments.dueDate", { date: assignment.dueDate })
                                  : t("assignments.dueDate", { date: t("course.dueUnset") })}
                              </span>
                              {assignment.weight != null && (
                                <Badge variant="warning">
                                  {t("assignments.weight", { weight: assignment.weight })}
                                </Badge>
                              )}
                              {assignment.category && (
                                <Badge variant="info">
                                  {t("assignments.category", { category: assignment.category })}
                                </Badge>
                              )}
                              {assignment.grade && (
                                <span className="text-sm font-medium text-green-600">
                                  {t("assignments.grade", { grade: assignment.grade })}
                                </span>
                              )}
                            </div>
                          </div>
                          <div className="flex flex-col items-end gap-2">
                            {getStatusBadge(getEffectiveAssignmentStatus(assignment.status, assignment.dueDate))}
                            <div className="flex items-center gap-1">
                              {assignment.url && (
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-8 w-8"
                                  title={t("assignments.openInBrowser")}
                                  aria-label={t("assignments.openInBrowser")}
                                  onClick={() => handleOpenInBrowser(assignment.url)}
                                >
                                  <ExternalLink className="w-4 h-4" />
                                </Button>
                              )}
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8"
                                title={t("assignments.submission.view")}
                                aria-label={t("assignments.submission.view")}
                                onClick={() => handleOpenSubmission(assignment.id)}
                              >
                                <ClipboardList className="w-4 h-4" />
                              </Button>
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    </motion.div>
                  ));
                })()}
                  </>
                )}
              </div>
            )}

            {/* Announcements tab */}
            {activeTab === "announcements" && (
              <div className="space-y-3">
                {courseAnnouncements.length === 0 && (
                  <div className="text-center py-12 text-muted-foreground">
                    <MessageSquare className="w-12 h-12 mx-auto mb-4" />
                    <p>{t("course.announcements.empty")}</p>
                  </div>
                )}
                {courseAnnouncements.map((announcement, index) => (
                  <motion.div
                    key={announcement.id}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: index * 0.05 }}
                  >
                    <Card className="card-hover">
                      <CardHeader>
                        <div className="flex items-center justify-between">
                          <CardTitle className="text-base">{announcement.title}</CardTitle>
                          <span className="text-sm text-muted-foreground">{announcement.date}</span>
                        </div>
                      </CardHeader>
                      <CardContent>
                        <p className="text-sm text-muted-foreground mb-3 whitespace-pre-line">
                          {announcement.content}
                        </p>
                        <div className="flex items-center gap-2">
                          <Avatar size="sm" fallback={announcement.author || t("course.author.unknown")} />
                          <span className="text-sm font-medium">{announcement.author || t("course.author.unknown")}</span>
                        </div>
                      </CardContent>
                    </Card>
                  </motion.div>
                ))}
              </div>
            )}

            {/* Contacts tab: course teachers / course team */}
            {activeTab === "contacts" && (
              <div className="space-y-4">
                {loadingContacts && (
                  <div className="space-y-3" aria-hidden="true">
                    {Array.from({ length: 2 }).map((_, i) => (
                      <div key={i} className="rounded-2xl border bg-card p-4 flex items-center gap-3">
                        <Skeleton className="h-10 w-10 rounded-full shrink-0" />
                        <div className="flex-1 space-y-2">
                          <Skeleton className="h-4 w-1/2" />
                          <Skeleton className="h-3 w-1/3" />
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                {contactsError && (
                  <p className="text-xs text-destructive break-all">
                    {t("course.contacts.fetchFailed", { error: typeof contactsError === "string" ? contactsError : String(contactsError) })}
                  </p>
                )}
                {!contactsError && contacts.length === 0 && !loadingContacts && (
                  <p className="text-xs text-muted-foreground">
                    {t("course.contacts.empty")}
                  </p>
                )}
                {contacts.length > 0 && (
                  <div className="grid gap-3">
                    {contacts.map((contact) => (
                      <Card key={contact.email} className="card-hover">
                        <CardContent className="flex items-center gap-4 p-4">
                          <Avatar
                            src={contact.pictureUrl}
                            alt={contact.name}
                            fallback={contact.name}
                            size="lg"
                          />
                          <div className="flex-1 min-w-0">
                            <p className="font-medium">{contact.name}</p>
                            <p className="text-sm text-muted-foreground">{contact.role}</p>
                            <a
                              href={`mailto:${contact.email}`}
                              className="text-sm text-primary hover:underline break-all"
                            >
                              {contact.email}
                            </a>
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Unit info tab: Unit Information + Schedule (Task #38) */}
            {activeTab === "unitInfo" && (
              <div className="space-y-4">
                {loadingUnitInfo && (
                  <div className="space-y-4" aria-hidden="true">
                    {/* Handbook cards */}
                    {Array.from({ length: 2 }).map((_, i) => (
                      <div key={`ui-sk-${i}`} className="rounded-2xl border bg-card p-5 space-y-3">
                        <Skeleton className="h-5 w-1/3" />
                        <Skeleton className="h-3 w-full" />
                        <Skeleton className="h-3 w-5/6" />
                        <Skeleton className="h-3 w-2/3" />
                        <Skeleton className="h-3 w-3/4" />
                      </div>
                    ))}
                    {/* Schedule table skeleton */}
                    <div className="rounded-2xl border bg-card p-5 space-y-3">
                      <Skeleton className="h-5 w-24" />
                      <div className="rounded-xl border overflow-hidden">
                        <div className="bg-muted/50 px-4 py-2.5 flex gap-6">
                          <Skeleton className="h-3 w-16" />
                          <Skeleton className="h-3 w-40" />
                          <Skeleton className="h-3 w-32" />
                          <Skeleton className="h-3 w-24" />
                        </div>
                        {Array.from({ length: 5 }).map((_, i) => (
                          <div key={`tb-${i}`} className="px-4 py-2.5 flex gap-6 border-t border-border/60">
                            <Skeleton className="h-3 w-16" />
                            <Skeleton className="h-3 w-44" />
                            <Skeleton className="h-3 w-36" />
                            <Skeleton className="h-3 w-20" />
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
                {unitInfoError && (
                  <div className="text-xs text-destructive break-all flex items-center gap-2 flex-wrap">
                    <span>{unitInfoError}</span>
                    <button type="button" onClick={handleFetchUnitInfo} className="text-primary underline font-medium hover:opacity-80">
                      {t("common.retry")}
                    </button>
                  </div>
                )}

                {/* Handbook (Unit Information) */}
                {!unitInfoError && (unitInfo?.sections.length ?? 0) > 0 && (
                  <div className="space-y-3">
                    <h3 className="font-semibold flex items-center gap-2">
                      <ClipboardList className="w-4 h-4 text-primary" />
                      {t("course.unitInfo.handbookTitle")}
                    </h3>
                    {unitInfo!.sections.map((s, i) => {
                      const hasContent =
                        s.contentHtml.replace(/<[^>]*>/g, "").trim().length > 0;
                      return (
                        <Card key={`ui-${i}`} className="card-hover">
                          <CardHeader>
                            <CardTitle className="text-base">{s.title}</CardTitle>
                          </CardHeader>
                          <CardContent>
                            {hasContent ? (
                              <div
                                className="cms-content text-sm text-muted-foreground"
                                dangerouslySetInnerHTML={{ __html: s.contentHtml }}
                              />
                            ) : (
                              <p className="text-sm text-muted-foreground/70 flex items-center gap-1.5">
                                <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                                {t("course.unitInfo.emptySection")}
                              </p>
                            )}
                          </CardContent>
                        </Card>
                      );
                    })}
                  </div>
                )}

                {/* Schedule */}
                {!unitInfoError && (schedule?.items.length ?? 0) > 0 && (
                  <div className="space-y-3">
                    <h3 className="font-semibold flex items-center gap-2">
                      <Calendar className="w-4 h-4 text-primary" />
                      {t("course.unitInfo.scheduleTitle")}
                    </h3>
                    {schedule!.items.map((it, i) => (
                      <Card key={`sc-${i}`} className="card-hover">
                        <CardContent className="p-5">
                          <p className="font-medium mb-3">{it.title}</p>
                          {it.rows && it.rows.length > 0 ? (
                            <div
                              className="overflow-x-auto rounded-xl border border-border"
                              onClick={handleScheduleLinkClick}
                            >
                              <table className="w-full text-sm border-collapse min-w-0">
                                <thead>
                                  <tr className="bg-muted/50">
                                    {it.rows[0].cells.map((cell, ci) => (
                                      <th
                                        key={ci}
                                        className="text-left font-semibold uppercase tracking-wide text-primary px-4 py-2.5 border-b border-border text-xs whitespace-pre-line align-top"
                                      >
                                        {cell}
                                      </th>
                                    ))}
                                  </tr>
                                </thead>
                                <tbody>
                                  {it.rows.slice(1).map((row, ri) => (
                                    <tr
                                      key={ri}
                                      className="transition-colors hover:bg-muted/30"
                                    >
                                      {row.cells.map((cell, ci) => (
                                        <td
                                          key={ci}
                                          className="px-4 py-2.5 border-b border-border/60 align-top whitespace-pre-line"
                                        >
                                          {cell.trim() ? (
                                            <span
                                              className="schedule-cell-html"
                                              dangerouslySetInnerHTML={{ __html: cell }}
                                            />
                                          ) : (
                                            <span className="text-muted-foreground/50">—</span>
                                          )}
                                        </td>
                                      ))}
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          ) : (
                            <div
                              className="cms-content text-sm text-muted-foreground"
                              dangerouslySetInnerHTML={{ __html: it.contentHtml }}
                            />
                          )}
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                )}

                {!loadingUnitInfo && !unitInfoError && !unitInfo && !schedule && (
                  <div className="text-center py-12 text-muted-foreground">
                    <ClipboardList className="w-12 h-12 mx-auto mb-4" />
                    <p>{t("course.unitInfo.empty")}</p>
                    <p className="text-xs mt-1">{t("course.unitInfo.emptyHint")}</p>
                  </div>
                )}
              </div>
            )}

            {/* Unit overview (Unit Dashboard, section=0) */}
            {activeTab === "dashboard" && (
              <div className="space-y-4">
                {loadingDashboard && (
                  <div className="space-y-4" aria-hidden="true">
                    {/* Current week card */}
                    <div className="rounded-2xl border border-primary/30 bg-card p-5 space-y-3">
                      <Skeleton className="h-3 w-24" />
                      <Skeleton className="h-6 w-2/3" />
                      <Skeleton className="h-3 w-1/3" />
                    </div>
                    {/* Learning objectives */}
                    <div className="rounded-2xl border border-l-4 border-l-primary bg-card p-5 space-y-3">
                      <Skeleton className="h-4 w-32" />
                      <Skeleton className="h-3 w-full" />
                      <Skeleton className="h-3 w-5/6" />
                      {Array.from({ length: 4 }).map((_, i) => (
                        <div key={`lo-${i}`} className="flex items-center gap-2">
                          <Skeleton className="h-4 w-4 rounded-full" />
                          <Skeleton className="h-3 w-2/3" />
                        </div>
                      ))}
                    </div>
                    {/* Learning path */}
                    <div className="space-y-2">
                      <Skeleton className="h-4 w-24" />
                      {Array.from({ length: 6 }).map((_, i) => (
                        <div key={`lp-${i}`} className="rounded-xl border bg-card p-3 flex items-center gap-3">
                          <Skeleton className="h-3 w-12" />
                          <Skeleton className="h-3 flex-1" />
                          <Skeleton className="h-5 w-10 rounded-full" />
                        </div>
                      ))}
                    </div>
                    {/* Week grid */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                      {Array.from({ length: 8 }).map((_, i) => (
                        <div key={`wg-${i}`} className="rounded-xl border bg-card p-3 flex items-center justify-between">
                          <div className="space-y-2 flex-1">
                            <Skeleton className="h-3 w-12" />
                            <Skeleton className="h-3 w-3/4" />
                          </div>
                          <Skeleton className="h-6 w-6 rounded-md" />
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {dashboardError && (
                  <div className="text-xs text-destructive break-all flex items-center gap-2 flex-wrap">
                    <span>{dashboardError}</span>
                    <button type="button" onClick={handleFetchDashboard} className="text-primary underline font-medium hover:opacity-80">
                      {t("common.retry")}
                    </button>
                  </div>
                )}
                {dashboardData && (
                  <>
                    {dashboardData.currentWeek && (
                      <Card className="border-primary/30">
                        <CardContent className="p-5">
                          <p className="text-xs font-semibold text-primary uppercase mb-1">
                            {t("course.dashboard.currentWeek")} · Week {dashboardData.currentWeek.num}
                          </p>
                          <h3 className="text-xl font-bold">{cleanTitle(dashboardData.currentWeek.title)}</h3>
                          {dashboardData.currentWeek.dates && (
                            <p className="text-sm text-muted-foreground mt-1">{dashboardData.currentWeek.dates}</p>
                          )}
                        </CardContent>
                      </Card>
                    )}
                    {dashboardData.learningObjectives.map((obj, oi) => (
                      <Card key={oi} className="border-l-4 border-l-primary">
                        <CardContent className="p-5">
                          <div className="flex items-center gap-2 mb-2">
                            <BookOpen className="w-4 h-4 text-primary" />
                            <h4 className="font-semibold">{cleanTitle(obj.title)}</h4>
                          </div>
                          {obj.description && (
                            <p className="text-sm text-muted-foreground mb-3">{obj.description}</p>
                          )}
                          {obj.items.length > 0 && (
                            <ul className="space-y-1.5">
                              {obj.items.map((it, ii) => (
                                <li key={ii} className="flex items-start gap-2 text-sm">
                                  <CheckCircle2 className="w-4 h-4 text-primary shrink-0 mt-0.5" />
                                  <span>{cleanTitle(it)}</span>
                                </li>
                              ))}
                            </ul>
                          )}
                        </CardContent>
                      </Card>
                    ))}
                    {dashboardData.learningNav.length > 0 && (
                      <div>
                        <h4 className="text-sm font-semibold text-muted-foreground mb-2">
                          {t("course.dashboard.learningPath")}
                        </h4>
                        <div className="space-y-1.5">
                          {dashboardData.learningNav.map((item) => (
                            <button
                              key={item.section}
                              type="button"
                              onClick={() => handleOpenSection(item.section)}
                              className={`w-full flex items-center gap-3 rounded-xl border p-3 text-left transition-all hover:bg-muted/50 ${
                                item.isCurrent ? "border-primary/40 bg-primary/5" : "bg-card"
                              }`}
                            >
                              <span
                                className={`w-16 shrink-0 text-xs font-bold ${
                                  item.weekLabel ? "text-foreground" : "text-muted-foreground"
                                }`}
                              >
                                {item.weekLabel || "·"}
                              </span>
                              <span className="flex-1 min-w-0 text-sm truncate">
                                {cleanTitle(item.moduleTitle)}
                              </span>
                              {item.isCurrent && (
                                <Badge variant="default">{t("course.dashboard.currentBadge")}</Badge>
                              )}
                              <ExternalLink className="w-4 h-4 text-muted-foreground shrink-0" />
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                    {dashboardData.weeks.length > 0 && (
                      <div>
                        <h4 className="text-sm font-semibold text-muted-foreground mb-2">{t("course.dashboard.weeks")}</h4>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                          {dashboardData.weeks.map((w) => (
                            <Card key={w.num} className="card-hover cursor-pointer">
                              <CardContent className="p-3 flex items-center justify-between gap-2">
                                <div className="min-w-0">
                                  <p className="text-xs font-semibold">Week {w.num}</p>
                                  <p className="text-sm truncate">{cleanTitle(w.title)}</p>
                                </div>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  onClick={() => handleOpenSection(w.num)}
                                  title={t("course.dashboard.openWeek")}
                                  aria-label={t("course.dashboard.openWeek")}
                                >
                                  <ExternalLink className="w-4 h-4" />
                                </Button>
                              </CardContent>
                            </Card>
                          ))}
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>
            )}
            {/* Recordings tab (Task #40) */}
            {activeTab === "recordings" && (
              <div className="space-y-4">
                {loadingRecordings && (
                  <div className="space-y-3" aria-hidden="true">
                    {Array.from({ length: 5 }).map((_, i) => (
                      <div key={i} className="rounded-2xl border bg-card p-4 flex items-center gap-3">
                        <Skeleton className="h-12 w-20 rounded-lg shrink-0" />
                        <div className="flex-1 space-y-2">
                          <Skeleton className="h-4 w-3/4" />
                          <Skeleton className="h-3 w-1/3" />
                        </div>
                        <Skeleton className="h-8 w-16 rounded-lg" />
                      </div>
                    ))}
                  </div>
                )}
                {recordingsError && (
                  <div className="text-xs text-destructive break-all flex items-center gap-2 flex-wrap">
                    <span>{recordingsError}</span>
                    <button type="button" onClick={handleFetchRecordings} className="text-primary underline font-medium hover:opacity-80">
                      {t("common.retry")}
                    </button>
                  </div>
                )}
                {recordings.map((rec) => (
                  <Card key={rec.id} className="card-hover">
                    <CardContent className="flex items-center gap-4 p-4">
                      <Video className="w-5 h-5 text-purple-500" />
                      <div className="flex-1 min-w-0">
                        <p className="font-medium truncate">{rec.title}</p>
                        {rec.duration && (
                          <p className="text-sm text-muted-foreground">
                            {t("course.recordings.duration", { duration: rec.duration })}
                          </p>
                        )}
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleOpenInBrowser(rec.url)}
                        title={t("course.recordings.open")}
                        aria-label={t("course.recordings.open")}
                      >
                        <ExternalLink className="w-4 h-4" />
                      </Button>
                    </CardContent>
                  </Card>
                ))}
                {!loadingRecordings && !recordingsError && recordings.length === 0 && (
                  <div className="text-center py-12 text-muted-foreground">
                    <Video className="w-12 h-12 mx-auto mb-4" />
                    <p>{t("course.recordings.empty")}</p>
                    <p className="text-xs mt-1">{t("course.recordings.emptyHint")}</p>
                  </div>
                )}
              </div>
            )}

            {/* AI summary tab */}
            {activeTab === "aiSummary" && (
              <div className="space-y-4">
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base flex items-center gap-2.5">
                      {/* AI surfaces get their own blue-to-violet accent so generated text
                          is never mistaken for scraped course data. */}
                      <span className="w-8 h-8 rounded-xl flex items-center justify-center shrink-0 bg-gradient-to-br from-blue-500/15 to-violet-500/20 text-violet-600 dark:text-violet-400">
                        <Sparkles className="w-4 h-4" />
                      </span>
                      {t("course.ai.summaryTitle.generic")}
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    {!settings.aiApiKey && (
                      <div className="p-3 mb-4 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-600 dark:text-amber-400 text-xs flex items-center gap-2">
                        <AlertCircle className="w-4 h-4 shrink-0" />
                        <span>{t("course.ai.error.noKey")}</span>
                      </div>
                    )}
                    {summaryError && (
                      <div className="text-sm text-red-500 mb-3">{summaryError}</div>
                    )}
                    <Button
                      onClick={handleGenerateSummary}
                      disabled={summaryLoading || !settings.aiApiKey}
                      className="bg-gradient-to-r from-blue-600 to-violet-600 hover:from-blue-600/90 hover:to-violet-600/90 text-white"
                    >
                      {summaryLoading ? (
                        <>
                          <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                          {t("course.ai.generating")}
                        </>
                      ) : (
                        <>
                          <Sparkles className="w-4 h-4 mr-2" />
                          {savedSummary ? t("course.ai.regenerate") : t("course.ai.generate")}
                        </>
                      )}
                    </Button>
                    {(summaryLoading || savedSummary) && (
                      <div className="mt-4 p-5 rounded-2xl bg-card border shadow-sm">
                        {summaryLoading && !streamContent && !thinkingText && (
                          <p className="text-sm text-muted-foreground mb-2">{t("course.ai.generating")}</p>
                        )}
                        {/* Thinking collapsible: shown while reasoning, expandable afterwards */}
                        {thinkingText && (
                          <div className="mb-3 rounded-xl border bg-muted/40 overflow-hidden">
                            <button
                              type="button"
                              onClick={() => setThinkingExpanded((v) => !v)}
                              className="w-full flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground hover:bg-muted/60 transition-colors"
                            >
                              {thinkingActive ? (
                                <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
                              ) : (
                                <Sparkles className="w-3.5 h-3.5 shrink-0 text-violet-500" />
                              )}
                              <span className="font-medium">{t("course.ai.thought")}</span>
                              <ChevronsDown
                                className={`w-3.5 h-3.5 ml-auto transition-transform duration-200 ${
                                  thinkingExpanded ? "rotate-180" : ""
                                }`}
                              />
                            </button>
                            {thinkingExpanded && (
                              <div className="px-3 pb-3 pt-2 border-t border-border/50 max-h-52 overflow-auto text-xs leading-relaxed text-muted-foreground/80 whitespace-pre-wrap">
                                {thinkingText}
                              </div>
                            )}
                          </div>
                        )}
                        {/* No final answer produced (e.g. thinking consumed the token budget) */}
                        {!summaryLoading && thinkingText && !streamContent && (
                          <p className="text-xs text-amber-600/90 dark:text-amber-400/90 mt-1">
                            {t("course.ai.noAnswer")}
                          </p>
                        )}
                        <MarkdownRenderer
                          content={summaryLoading ? streamContent : savedSummary?.content || ""}
                        />
                        {summaryLoading && (
                          <span className="ai-stream-cursor" aria-hidden="true">▍</span>
                        )}

                      </div>
                    )}
                  </CardContent>
                </Card>
              </div>
            )}
          </motion.div>
        </div>

        {/* Jump to top / jump to bottom —— only appear when the content is long enough.
            Positioned absolute against <main> (rather than inside the scroll container) so they don't
            scroll away with the content; fixed isn't used either, to avoid mis-centering over the sidebar. */}
        {scrollState.canUp && (
          <button
            type="button"
            onClick={() => scrollToEdge("top")}
            title={t("course.scroll.toTop")}
            aria-label={t("course.scroll.toTop")}
            className="absolute top-20 left-1/2 -translate-x-1/2 z-30 flex items-center gap-1.5
                       rounded-full border border-border bg-background/85 backdrop-blur-md
                       px-3 py-1.5 text-xs text-muted-foreground shadow-lg
                       transition hover:bg-accent hover:text-foreground"
          >
            <ChevronsUp className="w-3.5 h-3.5" />
            {t("course.scroll.toTop")}
          </button>
        )}
        {scrollState.canDown && (
          <button
            type="button"
            onClick={() => scrollToEdge("bottom")}
            title={t("course.scroll.toBottom")}
            aria-label={t("course.scroll.toBottom")}
            className="absolute bottom-6 left-1/2 -translate-x-1/2 z-30 flex items-center gap-1.5
                       rounded-full border border-border bg-background/85 backdrop-blur-md
                       px-4 py-2 text-sm font-medium text-foreground shadow-xl
                       transition hover:bg-accent"
          >
            <ChevronsDown className="w-4 h-4" />
            {t("course.scroll.toBottom")}
          </button>
        )}
      </main>

      {/* Submission status / feedback dialog (Task #39) */}
      {submissionForId !== null && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="submission-title"
          onClick={closeSubmission}
        >
          <Card className="w-full max-w-lg bg-card" onClick={(e) => e.stopPropagation()}>
            <CardContent className="p-6">
              <div className="flex items-start justify-between gap-4 mb-4">
                <h2 id="submission-title" className="text-lg font-bold flex items-center gap-2">
                  <ClipboardList className="w-5 h-5 text-primary" />
                  {t("assignments.submission.title")}
                </h2>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 shrink-0"
                  onClick={closeSubmission}
                  aria-label={t("assignments.submission.close")}
                >
                  <X className="w-4 h-4" />
                </Button>
              </div>

              {submissionLoading && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  {t("assignments.submission.loading")}
                </div>
              )}
              {submissionError && <p className="text-sm text-destructive">{submissionError}</p>}
              {submission && (
                <div className="space-y-3 text-sm">
                  <div className="flex items-center gap-2">
                    {submission.submitted ? (
                      <Badge variant="success">
                        <CheckCircle2 className="w-3.5 h-3.5 mr-1" />
                        {t("assignments.submission.submitted")}
                      </Badge>
                    ) : (
                      <Badge variant="warning">{t("assignments.submission.notSubmitted")}</Badge>
                    )}
                  </div>
                  {submission.dueDate && (
                    <p className="text-muted-foreground">
                      {t("assignments.submission.dueDate", { date: submission.dueDate })}
                    </p>
                  )}
                  {submission.grade && (
                    <p className="font-medium text-green-600">
                      {t("assignments.submission.grade", { grade: submission.grade })}
                    </p>
                  )}
                  {submission.feedback && (
                    <div className="rounded-lg bg-muted/50 p-3">
                      <p className="text-sm text-muted-foreground whitespace-pre-line">
                        {t("assignments.submission.feedback", { feedback: submission.feedback })}
                      </p>
                    </div>
                  )}
                </div>
              )}

              <div className="mt-6 flex justify-end">
                <Button onClick={closeSubmission}>{t("assignments.submission.close")}</Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}

