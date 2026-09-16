import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { AlertCircle, ChevronRight, Loader2, RefreshCw, Settings as SettingsIcon, Sparkles } from "lucide-react";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Skeleton } from "../components/ui/skeleton";
import { MarkdownRenderer } from "../components/ui/MarkdownRenderer";
import { useAppStore } from "../stores/useAppStore";
import { buildAiUrl, splitAiUrl } from "../services/aiUrl";
import { buildCourseAiContext, buildPlanContext, buildPrioritiesContext } from "../services/aiContext";
import { extractMusterJson, stripPartialAppendix, type AiPriority } from "../lib/aiStructured";
import { computeCourseDataHash, computeDeadlineHash } from "../lib/summaryFreshness";
import { searchCourseMaterials, buildQaContext, type CourseMaterial, type SearchHit } from "../lib/courseSearch";
import { fetchCourseGradebook, generateSummaryStream } from "../services/api";
import type { GradeEntry } from "../services/api";
import { useTranslation } from "../i18n/useTranslation";

const SCOPE_ALL = "all";

function langInstruction(language?: string): string {
  return language === "zh"
    ? "Please answer in Simplified Chinese."
    : language === "ja"
    ? "Please answer in Japanese."
    : language === "ko"
    ? "Please answer in Korean."
    : "Please answer in English.";
}

export function AIHubPage({ initialCourseId }: { initialCourseId?: number | null }) {
  const courses = useAppStore((s) => s.courses);
  const assignments = useAppStore((s) => s.assignments);
  const announcements = useAppStore((s) => s.announcements);
  const allResources = useAppStore((s) => s.allResources);
  const courseResourcesMap = useAppStore((s) => s.courseResources);
  const unitInfos = useAppStore((s) => s.unitInfos);
  const schedules = useAppStore((s) => s.schedules);
  const recordings = useAppStore((s) => s.recordings);
  const calendarEvents = useAppStore((s) => s.calendarEvents);
  const aiInsights = useAppStore((s) => s.aiInsights);
  const setCoursePlan = useAppStore((s) => s.setCoursePlan);
  const addSummary = useAppStore((s) => s.addSummary);
  const settings = useAppStore((s) => s.settings);
  const summaries = useAppStore((s) => s.summaries);
  const { t } = useTranslation();

  const hasKey = !!settings.aiApiKey && !!settings.aiBaseUrl;

  // Scope: remembered across visits; deep-link (initialCourseId) wins on mount.
  const [scope, setScope] = useState<string>(() => {
    if (initialCourseId != null) return String(initialCourseId);
    return localStorage.getItem("muster.aiHubScope") || SCOPE_ALL;
  });
  useEffect(() => {
    localStorage.setItem("muster.aiHubScope", scope);
  }, [scope]);

  const courseId = scope === SCOPE_ALL ? null : Number(scope);
  const course = courseId != null ? courses.find((c) => c.id === courseId) : undefined;

  // ---- cross-course materials assembly (all cached data, zero network) ----
  const allMaterials: CourseMaterial[] = useMemo(() => {
    const mats: CourseMaterial[] = [];
    for (const c of courses) {
      const cid = c.id;
      const code = c.shortName || c.fullName;
      const push = (kind: CourseMaterial["kind"], title: string, body: string, weekNum?: number) =>
        mats.push({ sourceId: 0, kind, courseId: cid, title: code ? `${code} · ${title}` : title, body, weekNum });
      const res = courseResourcesMap[cid]?.length ? courseResourcesMap[cid] : allResources.filter((r) => r.courseId === cid);
      for (const r of res) push("resource", r.name, r.section ?? "", r.weekNum);
      for (const a of assignments.filter((a) => a.courseId === cid)) {
        push("assignment", a.name, a.dueDateIso ? `Due ${a.dueDateIso}. Weight ${a.weight ?? "?"}%. Status ${a.status}.` : `Status ${a.status}.`);
      }
      for (const a of announcements.filter((a) => a.courseId === cid)) {
        push("announcement", a.title, `${a.author} (${a.date}): ${a.content.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim()}`);
      }
      for (const s of schedules[cid]?.items ?? []) push("schedule", s.title, s.contentHtml.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim());
      for (const s of unitInfos[cid]?.sections ?? []) push("unitinfo", s.title, s.contentHtml.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim());
      for (const r of recordings[cid] ?? []) push("recording", r.title, "");
    }
    return mats;
  }, [courses, courseResourcesMap, allResources, assignments, announcements, schedules, unitInfos, recordings]);

  // Single-course materials slice (reuses the same shape as CourseDetail did).
  const courseMaterials: CourseMaterial[] = useMemo(() => {
    if (courseId == null) return [];
    return allMaterials.filter((m) => m.courseId === courseId);
  }, [allMaterials, courseId]);

  const courseAssignments = useMemo(
    () => (courseId != null ? assignments.filter((a) => a.courseId === courseId) : []),
    [assignments, courseId]
  );
  const courseAnnouncements = useMemo(
    () => (courseId != null ? announcements.filter((a) => a.courseId === courseId) : []),
    [announcements, courseId]
  );
  const displayedResources = useMemo(
    () =>
      courseId != null
        ? courseResourcesMap[courseId]?.length
          ? courseResourcesMap[courseId]
          : allResources.filter((r) => r.courseId === courseId)
        : [],
    [courseResourcesMap, allResources, courseId]
  );

  // ---- summary state (single course) ----
  const savedSummary = courseId != null ? summaries[courseId] : undefined;
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [streamContent, setStreamContent] = useState("");
  const [thinkingText, setThinkingText] = useState("");
  const [thinkingExpanded, setThinkingExpanded] = useState(false);
  const [thinkingActive, setThinkingActive] = useState(false);
  const streamRef = useRef("");
  const gradeBookRef = useRef<Map<number, GradeEntry[]>>(new Map());
  const [doneActions, setDoneActions] = useState<Set<string>>(new Set());
  const toggleAction = (key: string) => {
    setDoneActions((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const currentCourseDataHash = useMemo(
    () =>
      computeCourseDataHash({
        resources: displayedResources,
        assignments: courseAssignments,
        announcements: courseAnnouncements,
        unitInfoTitles: unitInfos[courseId ?? 0]?.sections?.map((s) => s.title),
      }),
    [displayedResources, courseAssignments, courseAnnouncements, unitInfos, courseId]
  );
  const summaryStale = !!savedSummary?.dataHash && savedSummary.dataHash !== currentCourseDataHash;

  const handleGenerateSummary = useCallback(async () => {
    if (courseId == null || summaryLoading) return;
    if (!settings.aiApiKey) { setSummaryError(t("course.ai.error.noKey")); return; }
    if (!settings.aiBaseUrl) { setSummaryError(t("course.ai.error.noBaseUrl")); return; }
    setSummaryLoading(true);
    setSummaryError(null);
    streamRef.current = "";
    setStreamContent("");
    setThinkingText("");
    setThinkingExpanded(false);
    setThinkingActive(false);
    try {
      let gradeEntries = gradeBookRef.current.get(courseId) ?? [];
      if (!gradeBookRef.current.has(courseId)) {
        gradeEntries = await fetchCourseGradebook(courseId).catch(() => []);
        gradeBookRef.current.set(courseId, gradeEntries);
      }
      const content = buildCourseAiContext({
        courseName: course?.fullName || `Course ${courseId}`,
        today: new Date().toLocaleDateString("en-CA"),
        language: langInstruction(settings.language),
        resources: displayedResources,
        assignments: courseAssignments,
        announcements: courseAnnouncements,
        unitInfo: unitInfos[courseId] ?? null,
        schedule: schedules[courseId] ?? null,
        recordings: recordings[courseId] ?? [],
        contacts: [],
        gradeEntries,
      });
      const fullAiUrl = buildAiUrl(settings.aiBaseUrl || "", settings.aiFormat ?? splitAiUrl(settings.aiBaseUrl || "").format);
      await generateSummaryStream(content, settings.aiApiKey, fullAiUrl, settings.aiModel, "summary", {
        onChunk: (text, thinking) => {
          if (thinking) { setThinkingActive(true); setThinkingText((p) => p + text); return; }
          setThinkingActive(false);
          streamRef.current += text;
          setStreamContent(streamRef.current);
        },
        onDone: () => {
          setThinkingActive(false);
          const { json, clean } = extractMusterJson(streamRef.current);
          addSummary(courseId, {
            id: `${courseId}-${Date.now()}`,
            courseId,
            courseName: course?.fullName || `Course ${courseId}`,
            createdAt: new Date().toISOString(),
            generatedAt: new Date().toISOString(),
            provider: settings.aiCompatType,
            model: settings.aiModel,
            content: clean,
            structured: json ?? undefined,
            dataHash: currentCourseDataHash,
          });
          setSummaryLoading(false);
        },
        onError: (err) => { setThinkingActive(false); setSummaryError(err); setSummaryLoading(false); },
      });
    } catch (err) {
      setSummaryError(err instanceof Error ? err.message : t("course.ai.error.generic"));
    } finally {
      setSummaryLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [courseId, summaryLoading, settings.aiApiKey, settings.aiBaseUrl, currentCourseDataHash]);

  // Auto summary on entering the hub with a course scope (hash-gated).
  useEffect(() => {
    if (!settings.autoSummaryOnOpen) return;
    if (!hasKey || courseId == null) return;
    if (savedSummary && savedSummary.dataHash === currentCourseDataHash) return;
    handleGenerateSummary();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [courseId]);

  // ---- study plan state (single course) ----
  const [planLoading, setPlanLoading] = useState(false);
  const [planError, setPlanError] = useState<string | null>(null);
  const planStreamRef = useRef("");
  const savedPlan = useAppStore((s) => (courseId != null ? s.aiInsights.plans[courseId] : undefined));
  const planDataHash = useMemo(() => computeDeadlineHash(courseAssignments, []), [courseAssignments]);
  const planStale = !!savedPlan?.dataHash && savedPlan.dataHash !== planDataHash;

  const handleGeneratePlan = useCallback(async () => {
    if (courseId == null || planLoading) return;
    setPlanLoading(true);
    setPlanError(null);
    planStreamRef.current = "";
    try {
      const ctx = buildPlanContext({
        course: course ?? { id: courseId, shortName: "", fullName: `Course ${courseId}`, category: "", visible: true },
        assignments: courseAssignments,
        recordings: recordings[courseId] ?? [],
        schedule: schedules[courseId] ?? null,
        unitInfo: unitInfos[courseId] ?? null,
        today: new Date().toLocaleDateString("en-CA"),
        language: langInstruction(settings.language),
      });
      const fullAiUrl = buildAiUrl(settings.aiBaseUrl || "", settings.aiFormat ?? splitAiUrl(settings.aiBaseUrl || "").format);
      let acc = "";
      await generateSummaryStream(ctx, settings.aiApiKey, fullAiUrl, settings.aiModel, "plan", {
        onChunk: (text) => { acc += text; },
        onDone: () => {
          const { json } = extractMusterJson(acc);
          if (json?.days?.length) {
            setCoursePlan(courseId, {
              days: json.days.map((d) => ({ ...d, tasks: d.tasks.map((t2) => ({ ...t2, done: false })) })),
              weeklyFocus: json.weeklyFocus,
              generatedAt: new Date().toISOString(),
              dataHash: planDataHash,
            });
          } else {
            setPlanError(t("course.ai.error.generic"));
          }
          setPlanLoading(false);
        },
        onError: (err) => { setPlanError(err); setPlanLoading(false); },
      });
    } catch (err) {
      setPlanError(err instanceof Error ? err.message : t("course.ai.error.generic"));
      setPlanLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [courseId, planLoading, courseAssignments, planDataHash]);

  const togglePlanTask = (dayIdx: number, taskIdx: number) => {
    if (courseId == null || !savedPlan) return;
    const days = savedPlan.days.map((d, di) =>
      di !== dayIdx ? d : { ...d, tasks: d.tasks.map((t2, ti) => (ti !== taskIdx ? t2 : { ...t2, done: !t2.done })) }
    );
    setCoursePlan(courseId, { ...savedPlan, days });
  };

  // ---- Q&A state (works for both scopes) ----
  const [askQuestion, setAskQuestion] = useState("");
  const [askLoading, setAskLoading] = useState(false);
  const [askError, setAskError] = useState<string | null>(null);
  const [askAnswer, setAskAnswer] = useState("");
  const [askThinking, setAskThinking] = useState("");
  const [askThinkingActive, setAskThinkingActive] = useState(false);
  const [askSources, setAskSources] = useState<SearchHit[]>([]);
  const [askConfidence, setAskConfidence] = useState<"high" | "medium" | "low" | null>(null);
  const [askThinkingExpanded, setAskThinkingExpanded] = useState(false);
  const askStreamRef = useRef("");

  const handleAsk = useCallback(async () => {
    const q = askQuestion.trim();
    if (!q || askLoading || !hasKey) return;
    setAskLoading(true);
    setAskError(null);
    setAskAnswer("");
    setAskThinking("");
    setAskThinkingActive(false);
    setAskSources([]);
    setAskConfidence(null);
    askStreamRef.current = "";
    try {
      const pool = courseId == null ? allMaterials : courseMaterials;
      // Cross-course sampling: cap per-course hits before global ranking so one
      // chatty course can't drown out the rest (design §7.5 safeguard).
      const hits =
        courseId == null
          ? (() => {
              const perCourse = new Map<number, SearchHit[]>();
              for (const h of searchCourseMaterials(q, pool)) {
                const arr = perCourse.get(h.courseId) ?? [];
                if (arr.length < 3) arr.push(h);
                perCourse.set(h.courseId, arr);
              }
              return [...perCourse.values()].flat().sort((a, b) => b.score - a.score);
            })()
          : searchCourseMaterials(q, pool);
      const ctx = buildQaContext(hits, q, new Date().toLocaleDateString("en-CA"), langInstruction(settings.language));
      const fullAiUrl = buildAiUrl(settings.aiBaseUrl || "", settings.aiFormat ?? splitAiUrl(settings.aiBaseUrl || "").format);
      await generateSummaryStream(ctx, settings.aiApiKey, fullAiUrl, settings.aiModel, "qa", {
        onChunk: (text, thinking) => {
          if (thinking) { setAskThinkingActive(true); setAskThinking((p) => p + text); return; }
          setAskThinkingActive(false);
          askStreamRef.current += text;
          setAskAnswer(askStreamRef.current);
        },
        onDone: () => {
          setAskThinkingActive(false);
          const { json, clean } = extractMusterJson(askStreamRef.current);
          setAskAnswer(clean);
          setAskSources(hits.slice(0, json?.sources?.length ?? 0));
          setAskConfidence(json?.confidence ?? null);
          setAskLoading(false);
        },
        onError: (err) => { setAskThinkingActive(false); setAskError(err); setAskLoading(false); },
      });
    } catch (err) {
      setAskError(err instanceof Error ? err.message : t("course.ai.error.generic"));
      setAskLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [askQuestion, askLoading, hasKey, courseId, allMaterials, courseMaterials]);

  // ---- priorities (all-courses scope) ----
  const prioritiesInFlight = useRef(false);
  const maybeRefreshPriorities = useCallback(
    async (auto: boolean) => {
      const st = useAppStore.getState();
      const { aiApiKey, aiBaseUrl, aiModel, aiFormat } = st.settings;
      if (!aiApiKey || !aiBaseUrl) return;
      if (prioritiesInFlight.current || st.aiInsights.prioritiesRunning) return;
      const dataHash = computeDeadlineHash(st.assignments, st.calendarEvents);
      if (auto && st.aiInsights.priorities && st.aiInsights.priorities.dataHash === dataHash) return;
      prioritiesInFlight.current = true;
      st.setPrioritiesRunning(true);
      try {
        const ctx = buildPrioritiesContext({
          courses: st.courses,
          assignments: st.assignments,
          calendarEvents: st.calendarEvents,
          gradeOverview: st.gradeOverview,
          today: new Date().toLocaleDateString("en-CA"),
          language: st.settings.language || "en",
        });
        const fullAiUrl = buildAiUrl(aiBaseUrl, aiFormat ?? splitAiUrl(aiBaseUrl).format);
        let acc = "";
        await generateSummaryStream(ctx, aiApiKey, fullAiUrl, aiModel, "priorities", {
          onChunk: (text) => { acc += text; },
          onDone: () => {
            const { json } = extractMusterJson(acc);
            const items = (json?.priorities ?? []) as AiPriority[];
            st.setPriorities({ items, generatedAt: new Date().toISOString(), dataHash });
          },
          onError: (e) => { console.warn("priorities refresh failed:", e); st.setPrioritiesRunning(false); },
        });
      } catch (e) {
        console.warn("priorities refresh failed:", e);
      } finally {
        prioritiesInFlight.current = false;
        if (useAppStore.getState().aiInsights.prioritiesRunning) useAppStore.getState().setPrioritiesRunning(false);
      }
    },
    []
  );
  const currentDeadlineHash = useMemo(() => computeDeadlineHash(assignments, calendarEvents), [assignments, calendarEvents]);
  const prioritiesStale = !!aiInsights.priorities && aiInsights.priorities.dataHash !== currentDeadlineHash;

  // First visit to the all-scope with a key: fetch priorities if never generated.
  const prioritiesAutoTried = useRef(false);
  useEffect(() => {
    if (scope !== SCOPE_ALL || !hasKey || prioritiesAutoTried.current) return;
    prioritiesAutoTried.current = true;
    void maybeRefreshPriorities(true);
  }, [scope, hasKey, maybeRefreshPriorities]);

  // Reset transient stream state when switching scope.
  useEffect(() => {
    setSummaryError(null);
    setStreamContent("");
    setThinkingText("");
    setPlanError(null);
    setAskError(null);
    setAskAnswer("");
    setAskThinking("");
    setAskSources([]);
    setAskConfidence(null);
  }, [scope]);

  // ---- sidebar dot: something stale or never generated ----
  // (exported via window event so Dashboard's sidebar can render the dot without prop drilling)
  useEffect(() => {
    const prioritiesDot = !aiInsights.priorities || prioritiesStale;
    let summaryDot = false;
    for (const c of courses) {
      const s = summaries[c.id];
      if (!s) { summaryDot = true; break; }
    }
    window.dispatchEvent(new CustomEvent("muster:ai-dot", { detail: prioritiesDot || summaryDot }));
  }, [aiInsights.priorities, prioritiesStale, courses, summaries]);

  // ---------- no key: onboarding card ----------
  if (!hasKey) {
    return (
      <div className="p-8 max-w-3xl mx-auto">
        <div className="rounded-2xl border border-primary/20 bg-primary/5 p-8 text-center">
          <div className="w-14 h-14 rounded-2xl mx-auto mb-4 flex items-center justify-center bg-gradient-to-br from-blue-500/15 to-violet-500/20 text-violet-600 dark:text-violet-400">
            <Sparkles className="w-7 h-7" />
          </div>
          <h2 className="text-lg font-semibold mb-2">{t("aiHub.noKey.title")}</h2>
          <p className="text-sm text-muted-foreground max-w-md mx-auto mb-5 leading-relaxed">
            {t("aiHub.noKey.desc")}
          </p>
          <div className="rounded-xl border border-border bg-card p-4 text-left mb-5">
            <div className="flex items-center gap-2 mb-1.5">
              <span className="w-6 h-6 rounded-lg bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center text-white text-[11px] font-bold shrink-0">Z</span>
              <b className="text-sm">{t("settings.ai.freeZaiTitle")}</b>
              <span className="ml-auto text-[10px] font-semibold text-emerald-600 bg-emerald-500/10 border border-emerald-500/20 rounded-full px-2 py-0.5">
                {t("settings.ai.freeTag")}
              </span>
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed">{t("settings.ai.freeZaiDesc")}</p>
          </div>
          <Button
            onClick={() => window.dispatchEvent(new CustomEvent("muster:open-settings"))}
            className="bg-gradient-to-r from-blue-600 to-violet-600 hover:from-blue-600/90 hover:to-violet-600/90 text-white"
          >
            <SettingsIcon className="w-4 h-4 mr-2" />
            {t("aiHub.noKey.gotoSettings")}
          </Button>
        </div>
      </div>
    );
  }

  // ---------- main hub ----------
  return (
    <div className="p-8 max-w-5xl mx-auto">
      <div className="flex items-center justify-between gap-3 mb-1">
        <h1 className="text-2xl font-bold flex items-center gap-2.5">
          <span className="w-9 h-9 rounded-xl flex items-center justify-center bg-gradient-to-br from-blue-500/15 to-violet-500/20 text-violet-600 dark:text-violet-400">
            <Sparkles className="w-5 h-5" />
          </span>
          {t("aiHub.title")}
        </h1>
        <p className="text-xs text-muted-hidden text-muted-foreground">{t("aiHub.subtitle")}</p>
      </div>

      {/* course scope chips */}
      <div className="flex flex-wrap gap-2 mt-5 mb-6" role="tablist" aria-label={t("aiHub.scopeLabel")}>
        <button
          type="button"
          role="tab"
          aria-selected={scope === SCOPE_ALL}
          onClick={() => setScope(SCOPE_ALL)}
          className={`px-3.5 py-1.5 rounded-xl text-sm font-medium border transition-colors ${
            scope === SCOPE_ALL
              ? "bg-primary/10 border-primary/40 text-foreground"
              : "border-border text-muted-foreground hover:text-foreground hover:border-border/80"
          }`}
        >
          {t("aiHub.scopeAll")}
        </button>
        {courses.map((c) => (
          <button
            key={c.id}
            type="button"
            role="tab"
            aria-selected={scope === String(c.id)}
            onClick={() => setScope(String(c.id))}
            className={`px-3.5 py-1.5 rounded-xl text-sm font-medium border transition-colors ${
              scope === String(c.id)
                ? "bg-primary/10 border-primary/40 text-foreground"
                : "border-border text-muted-foreground hover:text-foreground hover:border-border/80"
            }`}
          >
            {c.shortName || c.fullName}
          </button>
        ))}
      </div>

      {scope === SCOPE_ALL ? (
        <div className="space-y-4">
          {/* priorities */}
          <Card>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between gap-2">
                <CardTitle className="text-base flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-violet-500" aria-hidden="true" />
                  {t("dashboard.aiPriorities.title")}
                </CardTitle>
                <Button variant="ghost" size="sm" onClick={() => maybeRefreshPriorities(false)} disabled={aiInsights.prioritiesRunning} aria-label={t("dashboard.aiPriorities.refresh")}>
                  <RefreshCw className={`w-4 h-4 ${aiInsights.prioritiesRunning ? "animate-spin" : ""}`} aria-hidden="true" />
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {prioritiesStale && <p className="text-xs text-amber-600 dark:text-amber-400 mb-2">{t("dashboard.aiPriorities.stale")}</p>}
              {aiInsights.prioritiesRunning && (aiInsights.priorities?.items ?? []).length === 0 ? (
                <div className="space-y-2" aria-busy="true">
                  {[0, 1, 2].map((i) => <Skeleton key={i} className="h-10 w-full rounded-xl" />)}
                </div>
              ) : (aiInsights.priorities?.items ?? []).length === 0 ? (
                <p className="text-sm text-muted-foreground">{t("dashboard.aiPriorities.empty")}</p>
              ) : (
                <ul className="space-y-2">
                  {(aiInsights.priorities?.items ?? []).slice(0, 8).map((pr, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border shrink-0 ${
                        pr.level === "urgent"
                          ? "bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20"
                          : pr.level === "important"
                          ? "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20"
                          : "bg-secondary text-muted-foreground border-border"
                      }`}>
                        {t(`dashboard.aiPriorities.level.${pr.level}`)}
                      </span>
                      <div className="min-w-0">
                        <p className="truncate">{pr.item}</p>
                        {pr.reason && <p className="text-xs text-muted-foreground">{pr.reason}</p>}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
              {aiInsights.priorities?.generatedAt && (
                <p className="text-xs text-muted-foreground mt-2">
                  {t("dashboard.aiPriorities.generatedAt", { time: new Date(aiInsights.priorities.generatedAt).toLocaleTimeString() })}
                </p>
              )}
            </CardContent>
          </Card>

          {/* cross-course QA */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2.5">
                <span className="w-8 h-8 rounded-xl flex items-center justify-center shrink-0 bg-gradient-to-br from-blue-500/15 to-violet-500/20 text-violet-600 dark:text-violet-400">
                  <Sparkles className="w-4 h-4" />
                </span>
                {t("aiHub.ask.allTitle")}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <QaInput
                askQuestion={askQuestion} setAskQuestion={setAskQuestion} handleAsk={handleAsk}
                askLoading={askLoading} placeholder={t("aiHub.ask.allPlaceholder")} label={t("aiHub.ask.allTitle")}
              />
              {askError && <div className="text-sm text-red-500 mt-3">{askError}</div>}
              {!askAnswer && !askLoading && !askError && <p className="text-sm text-muted-foreground mt-3">{t("course.ai.ask.empty")}</p>}
              {(askLoading || askAnswer) && (
                <AnswerBlock
                  thinking={askThinking} thinkingActive={askThinkingActive}
                  thinkingExpanded={askThinkingExpanded} setThinkingExpanded={setAskThinkingExpanded}
                  answer={askAnswer} loading={askLoading}
                  sources={askSources} confidence={askConfidence}
                />
              )}
            </CardContent>
          </Card>
        </div>
      ) : (
        <div className="space-y-4">
          {/* course summary */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2.5">
                <span className="w-8 h-8 rounded-xl flex items-center justify-center shrink-0 bg-gradient-to-br from-blue-500/15 to-violet-500/20 text-violet-600 dark:text-violet-400">
                  <Sparkles className="w-4 h-4" />
                </span>
                {t("course.ai.summaryTitle.generic")}
                {course && <span className="text-sm font-normal text-muted-foreground">· {course.fullName}</span>}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {summaryError && <div className="text-sm text-red-500 mb-3">{summaryError}</div>}
              <Button
                onClick={handleGenerateSummary}
                disabled={summaryLoading}
                className="bg-gradient-to-r from-blue-600 to-violet-600 hover:from-blue-600/90 hover:to-violet-600/90 text-white"
              >
                {summaryLoading ? (
                  <><Loader2 className="w-4 h-4 mr-2 animate-spin" />{t("course.ai.generating")}</>
                ) : (
                  <><Sparkles className="w-4 h-4 mr-2" />{savedSummary ? t("course.ai.regenerate") : t("course.ai.generate")}</>
                )}
              </Button>
              {summaryStale && (
                <div className="mt-3 p-3 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-600 dark:text-amber-400 text-xs flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{t("course.ai.stale.title")}</span>
                </div>
              )}
              {(summaryLoading || savedSummary) && (
                <div className="mt-4 p-5 rounded-2xl bg-card border shadow-sm">
                  {summaryLoading && !streamContent && !thinkingText && (
                    <p className="text-sm text-muted-foreground mb-2">{t("course.ai.generating")}</p>
                  )}
                  {thinkingText && (
                    <div className="mb-3 rounded-xl border bg-muted/40 overflow-hidden">
                      <button
                        type="button"
                        onClick={() => setThinkingExpanded((v) => !v)}
                        className="w-full flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground hover:bg-muted/60 transition-colors"
                      >
                        {thinkingActive ? <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" /> : <Sparkles className="w-3.5 h-3.5 shrink-0 text-violet-500" />}
                        <span className="font-medium">{t("course.ai.thought")}</span>
                        <ChevronRight className={`w-3.5 h-3.5 ml-auto transition-transform duration-200 ${thinkingExpanded ? "rotate-90" : ""}`} />
                      </button>
                      {thinkingExpanded && (
                        <div className="px-3 pb-3 pt-2 border-t border-border/50 max-h-52 overflow-auto text-xs leading-relaxed text-muted-foreground/80 whitespace-pre-wrap">
                          {thinkingText}
                        </div>
                      )}
                    </div>
                  )}
                  {!summaryLoading && thinkingText && !streamContent && (
                    <p className="text-xs text-amber-600/90 dark:text-amber-400/90 mt-1">{t("course.ai.noAnswer")}</p>
                  )}
                  {!summaryLoading && savedSummary?.structured?.weeklyFocus && (
                    <div className="mb-3 p-3 rounded-xl bg-violet-500/10 border border-violet-500/20 text-sm">
                      <span className="font-medium text-violet-600 dark:text-violet-400">{t("course.ai.weeklyFocus")}: </span>
                      <span className="text-foreground">{savedSummary.structured.weeklyFocus}</span>
                    </div>
                  )}
                  {!summaryLoading && savedSummary?.structured?.priorities && savedSummary.structured.priorities.length > 0 && (
                    <div className="mb-3 flex flex-wrap gap-1.5">
                      {savedSummary.structured.priorities.map((p, i) => (
                        <span key={i} title={p.reason || ""}
                          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border ${
                            p.level === "urgent"
                              ? "bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20"
                              : p.level === "important"
                              ? "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20"
                              : "bg-secondary text-muted-foreground border-border"
                          }`}>
                          {p.item}
                        </span>
                      ))}
                    </div>
                  )}
                  {!summaryLoading && savedSummary?.structured?.actions && savedSummary.structured.actions.length > 0 && (
                    <div className="mb-3 p-3 rounded-xl bg-card border">
                      <p className="text-xs font-medium text-muted-foreground mb-2">{t("course.ai.actions.title")}</p>
                      <ul className="space-y-1.5">
                        {savedSummary.structured.actions.map((a, i) => (
                          <li key={i} className="flex items-start gap-2 text-sm">
                            <input type="checkbox" checked={doneActions.has(`${courseId}:${i}`)} onChange={() => toggleAction(`${courseId}:${i}`)} className="mt-0.5" />
                            <span className={doneActions.has(`${courseId}:${i}`) ? "line-through text-muted-foreground" : ""}>
                              {a.title}
                              {a.dueAt ? <span className="text-muted-foreground"> · {a.dueAt}</span> : null}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  <MarkdownRenderer content={summaryLoading ? stripPartialAppendix(streamContent) : savedSummary?.content || ""} />
                  {summaryLoading && <span className="ai-stream-cursor" aria-hidden="true">▍</span>}
                </div>
              )}
            </CardContent>
          </Card>

          {/* study plan */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between gap-2">
                <CardTitle className="text-base flex items-center gap-2.5">
                  <span className="w-8 h-8 rounded-xl flex items-center justify-center shrink-0 bg-gradient-to-br from-blue-500/15 to-violet-500/20 text-violet-600 dark:text-violet-400">
                    <Sparkles className="w-4 h-4" />
                  </span>
                  {t("course.ai.plan.title")}
                </CardTitle>
                <Button
                  onClick={handleGeneratePlan}
                  disabled={planLoading}
                  className="bg-gradient-to-r from-blue-600 to-violet-600 hover:from-blue-600/90 hover:to-violet-600/90 text-white"
                >
                  {planLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                  <span className="ml-2">{t("course.ai.plan.generate")}</span>
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {planError && <div className="text-sm text-red-500 mb-3">{planError}</div>}
              {planStale && (
                <div className="mb-3 p-3 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-600 dark:text-amber-400 text-xs flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{t("course.ai.stale.title")}</span>
                </div>
              )}
              {!savedPlan && !planLoading && !planError && (
                <p className="text-sm text-muted-foreground">{t("course.ai.plan.note")}</p>
              )}
              {planLoading && (
                <div className="space-y-2" aria-busy="true">
                  {[0, 1, 2].map((i) => <Skeleton key={i} className="h-10 w-full rounded-xl" />)}
                </div>
              )}
              {savedPlan && (
                <div className="space-y-3">
                  {savedPlan.weeklyFocus && (
                    <div className="p-3 rounded-xl bg-violet-500/10 border border-violet-500/20 text-sm">
                      <span className="font-medium text-violet-600 dark:text-violet-400">{t("course.ai.weeklyFocus")}: </span>
                      <span className="text-foreground">{savedPlan.weeklyFocus}</span>
                    </div>
                  )}
                  {savedPlan.days.map((day, di) => (
                    <div key={di} className="p-3 rounded-xl bg-card border">
                      <p className="text-sm font-medium mb-2">{day.day}</p>
                      <ul className="space-y-1.5">
                        {day.tasks.map((task, ti) => (
                          <li key={ti} className="flex items-start gap-2 text-sm">
                            <input type="checkbox" checked={!!task.done} onChange={() => togglePlanTask(di, ti)} className="mt-0.5" />
                            <span className={task.done ? "line-through text-muted-foreground" : ""}>
                              {task.text}
                              {task.weekRef ? <span className="text-muted-foreground"> · {task.weekRef}</span> : null}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                  <p className="text-xs text-muted-foreground">{t("course.ai.plan.note")}</p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* course QA */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2.5">
                <span className="w-8 h-8 rounded-xl flex items-center justify-center shrink-0 bg-gradient-to-br from-blue-500/15 to-violet-500/20 text-violet-600 dark:text-violet-400">
                  <Sparkles className="w-4 h-4" />
                </span>
                {t("course.ai.ask.title")}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <QaInput
                askQuestion={askQuestion} setAskQuestion={setAskQuestion} handleAsk={handleAsk}
                askLoading={askLoading} placeholder={t("course.ai.ask.placeholder")} label={t("course.ai.ask.title")}
              />
              {askError && <div className="text-sm text-red-500 mt-3">{askError}</div>}
              {!askAnswer && !askLoading && !askError && <p className="text-sm text-muted-foreground mt-3">{t("course.ai.ask.empty")}</p>}
              {(askLoading || askAnswer) && (
                <AnswerBlock
                  thinking={askThinking} thinkingActive={askThinkingActive}
                  thinkingExpanded={askThinkingExpanded} setThinkingExpanded={setAskThinkingExpanded}
                  answer={askAnswer} loading={askLoading}
                  sources={askSources} confidence={askConfidence}
                />
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}

function QaInput({
  askQuestion, setAskQuestion, handleAsk, askLoading, placeholder, label,
}: {
  askQuestion: string;
  setAskQuestion: (v: string) => void;
  handleAsk: () => void;
  askLoading: boolean;
  placeholder: string;
  label: string;
}) {
  return (
    <div className="flex gap-2">
      <input
        type="text"
        value={askQuestion}
        onChange={(e) => setAskQuestion(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter" && !e.nativeEvent.isComposing) handleAsk(); }}
        placeholder={placeholder}
        className="flex-1 h-10 px-3 rounded-xl border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-violet-500/40"
        aria-label={label}
      />
      <Button onClick={handleAsk} disabled={askLoading || !askQuestion.trim()} className="bg-gradient-to-r from-blue-600 to-violet-600 hover:from-blue-600/90 hover:to-violet-600/90 text-white">
        {askLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
      </Button>
    </div>
  );
}

function AnswerBlock({
  thinking, thinkingActive, thinkingExpanded, setThinkingExpanded, answer, loading, sources, confidence,
}: {
  thinking: string;
  thinkingActive: boolean;
  thinkingExpanded: boolean;
  setThinkingExpanded: (f: (v: boolean) => boolean) => void;
  answer: string;
  loading: boolean;
  sources: SearchHit[];
  confidence: "high" | "medium" | "low" | null;
}) {
  const { t } = useTranslation();
  return (
    <div className="mt-4 p-5 rounded-2xl bg-card border shadow-sm">
      {thinking && (
        <div className="mb-3 rounded-xl border bg-muted/40 overflow-hidden">
          <button
            type="button"
            onClick={() => setThinkingExpanded((v) => !v)}
            className="w-full flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground hover:bg-muted/60 transition-colors"
          >
            {thinkingActive ? <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" /> : <Sparkles className="w-3.5 h-3.5 shrink-0 text-violet-500" />}
            <span className="font-medium">{t("course.ai.thought")}</span>
            <ChevronRight className={`w-3.5 h-3.5 ml-auto transition-transform duration-200 ${thinkingExpanded ? "rotate-90" : ""}`} />
          </button>
          {thinkingExpanded && (
            <div className="px-3 pb-3 pt-2 border-t border-border/50 max-h-52 overflow-auto text-xs leading-relaxed text-muted-foreground/80 whitespace-pre-wrap">
              {thinking}
            </div>
          )}
        </div>
      )}
      <MarkdownRenderer content={loading ? stripPartialAppendix(answer) : answer} />
      {loading && <span className="ai-stream-cursor" aria-hidden="true">▍</span>}
      {!loading && sources.length > 0 && (
        <div className="mt-3 pt-3 border-t border-border/50">
          <p className="text-xs font-medium text-muted-foreground mb-1.5">{t("course.ai.sources")}</p>
          <div className="flex flex-wrap gap-1.5">
            {sources.map((s) => (
              <span key={s.sourceId} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-secondary text-muted-foreground border">
                [{s.sourceId}] {s.title.slice(0, 50)}
              </span>
            ))}
            {confidence && (
              <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${
                confidence === "high"
                  ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20"
                  : confidence === "medium"
                  ? "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20"
                  : "bg-secondary text-muted-foreground border-border"
              }`}>
                {t(`course.ai.confidence.${confidence}`)}
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
