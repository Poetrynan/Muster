import { motion } from "framer-motion";
import {
  Calendar,
  CalendarDays,
  CheckCircle2,
  ChevronRight,
  Clock,
  AlertCircle,
  ArrowDownWideNarrow,
  ArrowLeft,
  ArrowUpNarrowWide,
  ClipboardList,
  ExternalLink,
  HelpCircle,
  Loader2,
  X,
} from "lucide-react";
import { useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { invoke } from "@tauri-apps/api/core";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Card, CardContent } from "../components/ui/card";
import { Progress } from "../components/ui/progress";
import { Tabs } from "../components/ui/tabs";
import { useAppStore } from "../stores/useAppStore";
import { getEffectiveAssignmentStatus, isTermEnded , parseDueTimestamp } from "../lib/utils";

// Determine whether a course term has ended (Monash: S1 ≈ late Feb - Jun, S2 ≈ late Jul - Nov).
import { useTranslation } from "../i18n/useTranslation";
import type { TranslationKey } from "../i18n/translations";
import { fetchAssignmentSubmission, fetchCourseGradebook } from "../services/api";
import type { SubmissionStatus, GradeEntry } from "../services/api";

interface AssignmentsPageProps {
  onBack: () => void;
}

export function AssignmentsPage({ onBack }: AssignmentsPageProps) {
  const [activeTab, setActiveTab] = useState("all");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [helpOpen, setHelpOpen] = useState(false);
  // Task #39 — submission status / feedback dialog for a single assignment
  const [submission, setSubmission] = useState<SubmissionStatus | null>(null);
  // Gradebook (grade report): matched against to fill in missing feedback/grades
  const [gradebook, setGradebook] = useState<GradeEntry[]>([]);
  const [submissionLoading, setSubmissionLoading] = useState(false);
  const [submissionError, setSubmissionError] = useState<string | null>(null);
  const [submissionForId, setSubmissionForId] = useState<number | null>(null);
  const { assignments, courses } = useAppStore();
  const { t } = useTranslation();

  // Task #46/#47 — top-level Unit selector: picking a course renders only that course's assignments, fixing the clutter of mixing all courses.
  // The chip badge shows the "to-do count" (effective pending/upcoming/overdue), which drives action better than a total count.
  const [selectedAssignmentCourseId, setSelectedAssignmentCourseId] = useState<number | null>(null);
  const [collapsedBuckets, setCollapsedBuckets] = useState<Set<string>>(new Set());

  // Open the assignment page in an in-app WebView window.
  // Shares the SSO session cookie, so the user does not need to sign in again.
  const handleOpenInBrowser = async (url?: string) => {
    if (!url) return;
    try {
      await invoke("open_in_app_webview", { url, title: "Moodle Assignments" });
    } catch (err) {
      // If the host is blocked (not monash.edu) or anything else fails, fall back to the external browser
      console.warn("In-app open failed, falling back to external:", err);
      try { await openUrl(url); } catch { /* silent */ }
    }
  };

  // Task #39 — open the submission status / feedback dialog for a single assignment
  const handleOpenSubmission = async (courseId: number, assignmentId: number, assessmentType?: "assignment" | "quiz") => {
    setSubmissionForId(assignmentId);
    setSubmissionLoading(true);
    setSubmissionError(null);
    setSubmission(null);
    try {
      const res = await fetchAssignmentSubmission(courseId, assignmentId, assessmentType);
      setSubmission(res);
      // Fetch the gradebook in parallel to fill in feedback/grades (does not block the dialog)
      fetchCourseGradebook(courseId).then(setGradebook).catch(() => {});
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

  // Tab ids independent of the current language (avoids hardcoded English/Chinese keys)
  const tabKeyMap: Record<string, "all" | "pending" | "submitted" | "graded"> = {
    all: "all",
    pending: "pending",
    submitted: "submitted",
    graded: "graded",
  };
  const tabs = [
    { id: "all", label: t("assignments.tab.all") },
    { id: "pending", label: t("assignments.tab.pending") },
    { id: "submitted", label: t("assignments.tab.submitted") },
    { id: "graded", label: t("assignments.tab.graded") },
  ];

  const courseMap = new Map(courses.map((c) => [c.id, c.shortName || c.fullName]));
  const courseFullMap = new Map(courses.map((c) => [c.id, c.fullName || c.shortName || ""]));
  const annotated = assignments.map((a) => ({
    ...a,
    course: courseMap.get(a.courseId) || t("course.courseNumber", { id: a.courseId }),
  }));

  const currentTab = tabKeyMap[activeTab] ?? "all";
  const filteredAssignments = annotated.filter((assignment) => {
    if (currentTab === "all") return true;
    if (currentTab === "pending")
      return (
        (assignment.status === "pending" || assignment.status === "upcoming") &&
        !isTermEnded(courseFullMap.get(assignment.courseId))
      );
    if (currentTab === "submitted") return assignment.status === "submitted";
    if (currentTab === "graded") return assignment.status === "graded";
    return true;
  });

  // Sort by due date. Ascending by default (soonest first); the header button toggles descending.
  // Entries without a dueDate always sort last, so NaN cannot scramble the order.
  const sortedAssignments = [...filteredAssignments].sort((a, b) => {
    const ad = a.dueDateIso || a.dueDate;
    const bd = b.dueDateIso || b.dueDate;
    const at = ad ? new Date(ad).getTime() : NaN;
    const bt = bd ? new Date(bd).getTime() : NaN;
    const aInvalid = Number.isNaN(at);
    const bInvalid = Number.isNaN(bt);
    if (aInvalid && bInvalid) return 0;
    if (aInvalid) return 1;
    if (bInvalid) return -1;
    return sortDir === "asc" ? at - bt : bt - at;
  });

  // ── Unit selector: aggregate the to-do count per course (effective pending/upcoming/overdue), excluding the portal course courseId=1
  const unitOptions = (() => {
    const map = new Map<number, { label: string; pending: number }>();
    for (const a of annotated) {
      const entry = map.get(a.courseId) ?? { label: a.course, pending: 0 };
      const eff = getEffectiveAssignmentStatus(a.status, a.dueDateIso || a.dueDate);
      if (
        (eff === "pending" || eff === "upcoming" || eff === "overdue") &&
        !isTermEnded(courseFullMap.get(a.courseId))
      )
        entry.pending += 1;
      map.set(a.courseId, entry);
    }
    return [...map.entries()]
      .filter(([id]) => id !== 1)
      .map(([id, v]) => ({ id, label: v.label, count: v.pending }))
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
  })();

  const allPendingCount = annotated.filter((a) => {
    const eff = getEffectiveAssignmentStatus(a.status, a.dueDateIso || a.dueDate);
    return (
      (eff === "pending" || eff === "upcoming" || eff === "overdue") &&
      !isTermEnded(courseFullMap.get(a.courseId))
    );
  }).length;

  // Assignments within the currently selected Unit scope (reuses the due-date ordering of sortedAssignments)
  const unitScoped =
    selectedAssignmentCourseId == null
      ? sortedAssignments
      : sortedAssignments.filter((a) => a.courseId === selectedAssignmentCourseId);

  // ── Bucket by due date: assignments have no week field, so due_date_iso is the natural grouping axis.
  // submitted and graded get separate buckets so the two states are never visually mixed.
  const DAY_MS = 1000 * 60 * 60 * 24;
  const bucketOf = (a: (typeof annotated)[number]): string => {
    const eff = getEffectiveAssignmentStatus(a.status, a.dueDateIso || a.dueDate);
    // Anything from an ended term → archived bucket, whatever its state. This has to come before
    // the submitted/graded checks or last semester's handed-in work never leaves the active list.
    if (isTermEnded(courseFullMap.get(a.courseId))) return "archived";
    if (eff === "submitted") return "submitted";
    if (eff === "graded") return "graded";
    const iso = a.dueDateIso || a.dueDate;
    if (!iso) return "noDate";
    const dueMs = parseDueTimestamp(iso);
    // An unparseable due string must NOT fall through to "later" — NaN fails every
    // comparison below, which silently dumped such items into the wrong bucket.
    if (Number.isNaN(dueMs)) return "noDate";
    const days = Math.ceil((dueMs - Date.now()) / DAY_MS);
    if (days < 0) return "overdue";
    if (days === 0) return "today";
    if (days <= 7) return "thisWeek";
    if (days <= 14) return "nextWeek";
    return "later";
  };

  const BUCKET_ORDER = ["overdue", "today", "thisWeek", "nextWeek", "later", "noDate", "submitted", "graded", "archived"];
  const bucketLabelKey: Record<string, TranslationKey> = {
    overdue: "assignments.bucketOverdue",
    today: "assignments.bucketToday",
    thisWeek: "assignments.bucketThisWeek",
    nextWeek: "assignments.bucketNextWeek",
    later: "assignments.bucketLater",
    noDate: "assignments.bucketNoDate",
    submitted: "assignments.bucketSubmitted",
    graded: "assignments.bucketGraded",
    archived: "assignments.bucketArchived",
  };

  const groupedByBucket = (() => {
    const m = new Map<string, (typeof annotated)[number][]>();
    for (const a of unitScoped) {
      const b = bucketOf(a);
      const arr = m.get(b) ?? [];
      arr.push(a);
      m.set(b, arr);
    }
    return m;
  })();

  const toggleBucket = (key: string) =>
    setCollapsedBuckets((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  // A single assignment card (reused by every bucket); index drives the entrance animation stagger (capped so the tail is not too slow)
  const renderAssignmentCard = (assignment: (typeof annotated)[number], index: number) => {
    const daysUntil = getDaysUntilDue(assignment.dueDateIso || assignment.dueDate);
    // Grade display: prefer the assignment's own grade (which carries "X / Y" from detail pages).
    // Fall back to the gradebook row matched by normalized name so graded quizzes show the full
    // max score in the list instead of a bare number.
    const norm = (s?: string) =>
      (s || "").toLowerCase().replace(/\(\d+(?:\.\d+)?%\)/g, "").replace(/\s+/g, " ").trim();
    const gbForCard = gradebook.length > 0
      ? gradebook.find((g) => norm(g.item) === norm(assignment.name))
      : undefined;
    const gradeForCard = (() => {
      const ag = assignment.grade;
      if (!ag) return;
      // Already has "X / Y" format from the detail-page or new gradebook path: use directly.
      if (ag.includes("/")) return ag;
      // Bare number: try to append the gradebook range so the list shows the max score too.
      if (gbForCard?.range) return `${ag} / ${gbForCard.range}`;
      return ag;
    })();
    return (
      <motion.div
        key={assignment.id}
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: Math.min(index, 12) * 0.04 }}
      >
        <Card className="card-hover">
          <CardContent className="p-4">
            <div className="flex items-start gap-4">
              {getStatusIcon(getEffectiveAssignmentStatus(assignment.status, assignment.dueDateIso || assignment.dueDate))}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1 flex-wrap">
                  <h3 className="font-semibold">{assignment.name}</h3>
                  {assignment.assessmentType === "quiz" && (
                    <Badge variant="secondary">{t("assignments.type.quiz")}</Badge>
                  )}
                  {assignment.assessmentType === "assignment" && (
                    <Badge variant="outline">{t("assignments.type.assignment")}</Badge>
                  )}
                </div>
                <p className="text-sm text-muted-foreground mb-2">
                  {assignment.course}
                </p>
                <div className="flex items-center gap-3 flex-wrap">
                  <span className="text-sm text-muted-foreground">
                    {assignment.dueDate
                      ? t("assignments.dueDate", { date: assignment.dueDate })
                      : t("assignments.dueDate", { date: t("course.dueUnset") })}
                  </span>
                  {daysUntil !== null && daysUntil > 0 && (assignment.status === "pending" || assignment.status === "upcoming") &&
                    (daysUntil <= 7 ? (
                      <Badge variant="danger" className="font-bold">
                        {t("assignments.dueIn", { days: daysUntil })}
                      </Badge>
                    ) : (
                      <span className="text-sm text-muted-foreground">
                        {t("assignments.dueIn", { days: daysUntil })}
                      </span>
                    ))}
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
                  {assignment.grade && gradeForCard && (
                    <span className="text-sm text-green-600">{t("assignments.grade", { grade: gradeForCard })}</span>
                  )}
                </div>
              </div>
              <div className="flex flex-col items-end gap-2">
                {(() => {
                  const effBadge = getEffectiveAssignmentStatus(assignment.status, assignment.dueDate);
                  if (
                    effBadge !== "submitted" &&
                    effBadge !== "graded" &&
                    isTermEnded(courseFullMap.get(assignment.courseId))
                  ) {
                    return <Badge variant="secondary">{t("assignments.termEnded")}</Badge>;
                  }
                  return getStatusBadge(effBadge);
                })()}
                <div className="flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    title={t("assignments.submission.view")}
                    aria-label={t("assignments.submission.view")}
                    onClick={() => handleOpenSubmission(assignment.courseId, assignment.id, assignment.assessmentType)}
                  >
                    <ClipboardList className="w-4 h-4" />
                  </Button>
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
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </motion.div>
    );
  };

  // Progress only counts assignments that "have a submission status" (hasSubmissionStatus !== false);
  // those without one ("-" / no submission entry) go to untracked and are excluded from the percentage.
  const tracked = annotated.filter((a) => a.hasSubmissionStatus !== false);
  const untracked = annotated.filter((a) => a.hasSubmissionStatus === false);
  const totalCount = tracked.length;
  const pendingCount = tracked.filter((a) => {
    const eff = getEffectiveAssignmentStatus(a.status, a.dueDateIso || a.dueDate);
    return (eff === "pending" || eff === "upcoming" || eff === "overdue") &&
      !isTermEnded(courseFullMap.get(a.courseId));
  }).length;
  const doneCount = tracked.filter((a) => a.status === "submitted" || a.status === "graded").length;
  const completionPct = totalCount === 0 ? 0 : Math.round((doneCount / totalCount) * 100);

  const now = Date.now();
  const upcoming = annotated
    .filter((a) => (a.dueDateIso || a.dueDate) && (a.status === "pending" || a.status === "upcoming"))
    .map((a) => ({ ...a, _due: new Date((a.dueDateIso || a.dueDate)!).getTime() }))
    .filter((a) => a._due >= now)
    .sort((a, b) => a._due - b._due)[0];
  const upcomingDays = upcoming ? Math.ceil((upcoming._due - now) / (1000 * 60 * 60 * 24)) : null;

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "pending":
        return <Clock className="w-5 h-5 text-yellow-500" />;
      case "submitted":
        return <CheckCircle2 className="w-5 h-5 text-blue-500" />;
      case "graded":
        return <CheckCircle2 className="w-5 h-5 text-green-500" />;
      case "overdue":
        return <AlertCircle className="w-5 h-5 text-red-500" />;
      case "upcoming":
        return <CalendarDays className="w-5 h-5 text-purple-500" />;
      default:
        return <Clock className="w-5 h-5 text-gray-500" />;
    }
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

  const getDaysUntilDue = (dueDate: string | undefined) => {
    if (!dueDate) return null;
    const due = new Date(dueDate);
    const diffTime = due.getTime() - now;
    return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  };

  return (
    <div className="h-screen overflow-hidden bg-background flex">
      {/* Sidebar — same layout as Dashboard: h-full + shrink-0 with an inner flex-col;
          the Due Soon card is pinned to the bottom via mt-auto + shrink-0 and does not scroll with the middle content */}
      <motion.aside
        initial={{ x: -280 }}
        animate={{ x: 0 }}
        transition={{ duration: 0.4, ease: [0.25, 0.1, 0.25, 1] }}
        className="w-72 shrink-0 h-full glass border-r flex flex-col"
      >
        <div className="p-4 border-b shrink-0">
          <Button variant="ghost" onClick={onBack} className="gap-2">
            <ArrowLeft className="w-4 h-4" />
            {t("common.back")}
          </Button>
        </div>

        <div className="p-6 shrink-0">
          <h2 className="font-bold text-lg mb-2">{t("assignments.title")}</h2>
          <p className="text-sm text-muted-foreground">{t("assignments.subtitle")}</p>
        </div>

        {/* Stats — scrollable middle area */}
        <div className="px-6 space-y-4 min-h-0 overflow-y-auto flex-1">
          <Card>
            <CardContent className="p-4">
              <div className="flex items-end justify-between mb-2">
                <div>
                  <span className="block text-sm text-muted-foreground">{t("assignments.completion")}</span>
                  <span className="text-2xl font-bold leading-tight">
                    {doneCount}
                    <span className="text-sm font-medium text-muted-foreground"> / {totalCount}</span>
                  </span>
                </div>
                <span className="text-2xl font-bold text-primary">{completionPct}%</span>
              </div>
              <Progress value={completionPct} size="sm" />
              {untracked.length > 0 && (
                <p className="text-[11px] text-muted-foreground/80 mt-2 leading-relaxed">
                  {t("assignments.untracked", { count: untracked.length })}
                </p>
              )}
            </CardContent>
          </Card>

          <div className="grid grid-cols-2 gap-3">
            <Card>
              <CardContent className="p-4 text-center">
                <div className="text-2xl font-bold text-yellow-500">{pendingCount}</div>
                <div className="text-xs text-muted-foreground">{t("assignments.pending")}</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4 text-center">
                <div className="text-2xl font-bold text-green-500">{doneCount}</div>
                <div className="text-xs text-muted-foreground">{t("assignments.completed")}</div>
              </CardContent>
            </Card>
          </div>
        </div>

        {/* Due soon — mt-auto pushes it to the bottom, shrink-0 keeps it from being squeezed */}
        <div className="p-6 mt-auto shrink-0">
          {/* Uses a more saturated amber background + thick border + dark text so it does not blend into the sidebar's translucent glass background and turn grey.
              relative keeps an independent stacking context so the shadow stays on top. */}
          <Card className="relative bg-amber-200 dark:bg-amber-900/60 border-2 border-amber-500 dark:border-amber-600 shadow-xl">
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-2">
                <AlertCircle className="w-4 h-4 text-amber-900 dark:text-amber-200" strokeWidth={2.5} />
                <span className="text-sm font-bold text-amber-900 dark:text-amber-100">{t("assignments.dueSoon")}</span>
              </div>
              {upcoming ? (
                <p className="text-sm font-semibold text-amber-900 dark:text-amber-100">
                  {upcoming.name} ·{" "}
                  <Badge variant="danger" className="font-bold">
                    {t("assignments.dueIn", { days: upcomingDays ?? 0 })}
                  </Badge>
                </p>
              ) : (
                <p className="text-sm font-semibold text-amber-900 dark:text-amber-100">
                  {totalCount === 0 ? t("assignments.noData") : t("assignments.dueSoon")}
                </p>
              )}
            </CardContent>
          </Card>
        </div>
      </motion.aside>

      {/* Main content area */}
      <main className="flex-1 flex flex-col overflow-hidden">
        <header className="h-16 border-b glass flex items-center justify-between px-6">
          <div className="flex items-center gap-4">
            <Calendar className="w-5 h-5 text-primary" />
            <h1 className="font-semibold">{t("assignments.listTitle")}</h1>
            <span className="text-sm text-muted-foreground">{t("assignments.count", { count: unitScoped.length })}</span>
          </div>
          <div className="flex items-center gap-2">
            {/* Help: explains what the "open in browser" button on a card does */}
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setHelpOpen(true)}
              title={t("assignments.help.title")}
              aria-label={t("assignments.help.title")}
            >
              <HelpCircle className="w-4 h-4" />
            </Button>
            {/* Sort by due date: click toggles between ascending and descending */}
            <Button
              variant="outline"
              size="sm"
              onClick={() => setSortDir((d) => (d === "asc" ? "desc" : "asc"))}
              title={t("assignments.sortByDue")}
            >
              {sortDir === "asc" ? (
                <ArrowUpNarrowWide className="w-4 h-4 mr-2" />
              ) : (
                <ArrowDownWideNarrow className="w-4 h-4 mr-2" />
              )}
              {sortDir === "asc" ? t("assignments.sortAsc") : t("assignments.sortDesc")}
            </Button>
          </div>
        </header>

        <div className="flex-1 overflow-auto px-6 py-6">
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3 }}
          >
            {/* Top-level Unit selector: picking a course renders only that course's assignments, fixing the clutter of mixing all courses.
                The badge shows the to-do count (pending/upcoming/overdue) so the most backed-up course is obvious at a glance. */}
            <div
              className="flex items-center gap-2 mb-4 overflow-x-auto pb-1"
              role="tablist"
              aria-label={t("assignments.unitFilterLabel")}
            >
              <Button
                variant={selectedAssignmentCourseId == null ? "default" : "outline"}
                size="sm"
                onClick={() => setSelectedAssignmentCourseId(null)}
                aria-pressed={selectedAssignmentCourseId == null}
                className="shrink-0 rounded-full"
              >
                {t("assignments.allUnits")}
                <span className="ml-1 text-xs opacity-70">{allPendingCount}</span>
              </Button>
              {unitOptions.map((opt) => (
                <Button
                  key={opt.id}
                  variant={selectedAssignmentCourseId === opt.id ? "default" : "outline"}
                  size="sm"
                  onClick={() => setSelectedAssignmentCourseId(opt.id)}
                  aria-pressed={selectedAssignmentCourseId === opt.id}
                  className="shrink-0 rounded-full"
                >
                  {opt.label}
                  <span className="ml-1 text-xs opacity-70">{opt.count}</span>
                </Button>
              ))}
            </div>

            <Tabs tabs={tabs.map((tab) => tab.label)} activeTab={tabs.find((tab) => tab.id === activeTab)?.label || ""} onChange={(label) => {
              const found = tabs.find((tab) => tab.label === label);
              if (found) setActiveTab(found.id);
            }} className="mb-6" />

            {/* Collapsible rendering bucketed by due date: assignments have no week field, so due_date_iso is the natural grouping axis.
                Submitted/graded get their own bucket (done) and are not mixed into the urgency buckets. */}
            <div className="space-y-6 assignments-list">
              {unitScoped.length === 0 ? (
                <div className="text-center py-12">
                  <Calendar className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
                  <p className="text-muted-foreground">
                    {totalCount === 0 ? t("assignments.noData") : t("assignments.noFilterMatch")}
                  </p>
                </div>
              ) : (
                BUCKET_ORDER.map((bucketKey) => {
                  const items = groupedByBucket.get(bucketKey);
                  if (!items || items.length === 0) return null;
                  const collapsed = collapsedBuckets.has(bucketKey);
                  return (
                    <section key={bucketKey} aria-label={t(bucketLabelKey[bucketKey])}>
                      <button
                        type="button"
                        onClick={() => toggleBucket(bucketKey)}
                        className="flex items-center gap-2 mb-3 w-full text-left"
                        aria-expanded={!collapsed}
                      >
                        <ChevronRight
                          className={`w-4 h-4 text-muted-foreground transition-transform ${collapsed ? "" : "rotate-90"}`}
                        />
                        <h3 className="font-semibold text-foreground">{t(bucketLabelKey[bucketKey])}</h3>
                        <Badge variant="secondary" className="text-xs shrink-0">{items.length}</Badge>
                      </button>
                      {!collapsed && (
                        <div className="space-y-3 px-1 py-1 -mx-1">
                          {items.map((assignment, index) => renderAssignmentCard(assignment, index))}
                        </div>
                      )}
                    </section>
                  );
                })
              )}
            </div>
          </motion.div>
        </div>
      </main>

      {/* Help dialog: explains what the "open in browser" button does and why a re-login may be required */}
      {helpOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="assignments-help-title"
          onClick={() => setHelpOpen(false)}
        >
          <Card
            className="w-full max-w-lg bg-card"
            onClick={(e) => e.stopPropagation()}
          >
            <CardContent className="p-6">
              <div className="flex items-start justify-between gap-4 mb-4">
                <h2 id="assignments-help-title" className="text-lg font-bold flex items-center gap-2">
                  <HelpCircle className="w-5 h-5 text-primary" />
                  {t("assignments.help.title")}
                </h2>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 shrink-0"
                  onClick={() => setHelpOpen(false)}
                  aria-label={t("common.close")}
                >
                  <X className="w-4 h-4" />
                </Button>
              </div>
              <div className="space-y-4 text-sm leading-relaxed">
                <div>
                  <p className="font-semibold mb-1 flex items-center gap-2">
                    <ExternalLink className="w-4 h-4 text-primary" />
                    {t("assignments.help.buttonHeading")}
                  </p>
                  <p className="text-muted-foreground">{t("assignments.help.buttonBody")}</p>
                </div>
                <div>
                  <p className="font-semibold mb-1">{t("assignments.help.loginHeading")}</p>
                  <p className="text-muted-foreground">{t("assignments.help.loginBody")}</p>
                </div>
                <div>
                  <p className="font-semibold mb-1">{t("assignments.help.missingHeading")}</p>
                  <p className="text-muted-foreground">{t("assignments.help.missingBody")}</p>
                </div>
              </div>
              <div className="mt-6 flex justify-end">
                <Button onClick={() => setHelpOpen(false)}>{t("common.close")}</Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

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
                  {(() => {
                    // Gradebook matching runs once so the badge and the grade/range/feedback block share one result.
                    const current = annotated.find((x) => x.id === submissionForId);
                    const norm = (s?: string) =>
                      (s || "").toLowerCase().replace(/\(\d+(?:\.\d+)?%\)/g, "").replace(/\s+/g, " ").trim();
                    const gb = gradebook.find((g) => norm(g.item) === norm(current?.name));
                    const gradeText = submission.grade || gb?.grade || undefined;
                    const rangeText = gb?.range || undefined;
                    const feedbackText = submission.feedback || gb?.feedback || undefined;
                    // Status badge priority: a real grade (from detail page or gradebook) wins,
                    // then submitted flag, finally not-submitted.
                    const hasGrade = !!gradeText && gradeText.trim() !== "" && gradeText.trim() !== "-";
                    return (
                      <>
                        <div className="flex items-center gap-2">
                          {hasGrade ? (
                            <Badge variant="success">
                              <CheckCircle2 className="w-3.5 h-3.5 mr-1" />
                              {t("assignments.submission.graded")}
                            </Badge>
                          ) : submission.submitted ? (
                            <Badge variant="info">
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
                        {gradeText && (
                          <p className="font-medium text-green-600">
                            {t("assignments.submission.grade", {
                              grade: rangeText ? `${gradeText} (${rangeText})` : gradeText,
                            })}
                          </p>
                        )}
                        {feedbackText && (
                          <div className="rounded-lg bg-muted/50 p-3">
                            <p className="text-sm text-muted-foreground whitespace-pre-line">
                              {t("assignments.submission.feedback", { feedback: feedbackText })}
                            </p>
                          </div>
                        )}
                      </>
                    );
                  })()}
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
