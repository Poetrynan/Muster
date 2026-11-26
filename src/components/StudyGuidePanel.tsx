import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { CalendarClock, ChevronLeft, ChevronRight, ClipboardList, ExternalLink, FileText, Loader2, Megaphone, MessageSquareText, RefreshCw, Sparkles } from 'lucide-react';
import { fetchCourseGradebook, type Assignment, type Course, type GradeEntry } from '../services/api';
import { useAppStore } from '../stores/useAppStore';
import { buildAiUrl, splitAiUrl } from '../services/aiUrl';
import { generateGuide, type GuideAttempt } from '../services/studyGuide';
import { runQuickAnswer } from '../services/quickAnswer';
import { accountScope, fingerprint, guideKey, localDay, selectGuideSources, shiftDate, weekStart } from '../lib/studyGuide/sources';
import { buildGuideContext, buildGuideFacts } from '../lib/studyGuide/facts';
import type { GuideCard as CardData, GuideScope, SourceRecord } from '../lib/studyGuide/types';
import { quickKey, selectQuickEvidence, type AiPreset, type QuickAnswer, type QuickPreset } from '../lib/studyGuide/quick';
import { guideCopy } from '../lib/studyGuide/copy';
import { quickCopy } from '../lib/studyGuide/quickCopy';
import { humanizeAiError } from '../lib/aiError';
import { useAcademicCalendar } from '../lib/academicCalendar';
import { resolveTeachingWeek } from '../lib/unitTeachingWeek';
import { useTranslation } from '../i18n/useTranslation';
import { GuideCard } from './GuideCard';
import { GuideSources } from './GuideSources';
import { Button } from './ui/button';
import { MarkdownRenderer } from './ui/MarkdownRenderer';

const QUICK_ACTIONS: { id: QuickPreset; icon: typeof Sparkles }[] = [
    { id: 'plan', icon: Sparkles },
    { id: 'announcements', icon: Megaphone },
    { id: 'brief', icon: ClipboardList },
    { id: 'feedback', icon: MessageSquareText },
];

/** Open a source the same way the rest of the app does (Monash pages in the signed-in window). */
async function openSource(url?: string, title?: string) {
    if (!url) return;
    if ('__TAURI_INTERNALS__' in window) {
        const { openLink } = await import('../lib/monashLinks');
        await openLink(url, title);
    } else window.open(url, '_blank', 'noopener,noreferrer');
}

function SourceChips({ sources }: { sources: SourceRecord[] }) {
    const chip = 'inline-flex max-w-full items-center gap-1 rounded-md bg-primary/10 px-2 py-0.5 text-[11px] text-primary';
    return <div className="mt-1.5 flex flex-wrap gap-1.5">{sources.map(s => s.url
        ? <button key={s.id} type="button" onClick={() => void openSource(s.url, s.title)} title={s.title} className={`${chip} hover:bg-primary/15 focus-visible:ring-2 focus-visible:ring-primary`}><FileText className="h-3 w-3 shrink-0" aria-hidden="true"/><span className="truncate">{s.title}</span><ExternalLink className="h-3 w-3 shrink-0" aria-hidden="true"/></button>
        : <span key={s.id} title={s.title} className={chip}><FileText className="h-3 w-3 shrink-0" aria-hidden="true"/><span className="truncate">{s.title}</span></span>)}</div>;
}

export function StudyGuidePanel({ course }: {
    course: Course;
}) {
    const state = useAppStore(), { t } = useTranslation(), settings = state.settings, c = guideCopy(settings.language), q = quickCopy(settings.language);
    const [clock, setClock] = useState(() => new Date());
    useEffect(() => { const timer = window.setInterval(() => setClock(new Date()), 60000); return () => window.clearInterval(timer); }, []);
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC', localDate = localDay(clock, timezone), currentWeekId = weekStart(localDate);
    const academicCalendar = useAcademicCalendar();
    const teaching = resolveTeachingWeek(course, state.unitDashboards[course.id]?.currentWeek, academicCalendar, clock);
    const teachingWeek = teaching.status === 'teaching' ? teaching.number : null;
    const [weekId, setWeekId] = useState(currentWeekId), [selectedWeek, setSelectedWeek] = useState<number | null | undefined>(undefined), [hours, setHours] = useState(2);
    const effectiveWeek = selectedWeek === undefined ? teachingWeek : selectedWeek;
    const scope: GuideScope = { accountScope: accountScope(state.cacheOwnerEmail || state.user?.email || ''), courseId: course.id, weekId, selectedWeek: effectiveWeek, localDate, timezone, now: clock.toISOString(), language: settings.language, model: settings.aiModel, availableMinutes: Math.round(hours * 60), provider: fingerprint([settings.aiBaseUrl, settings.aiFormat, settings.aiCompatType]) };
    const resources = state.courseResources[course.id] ?? state.allResources.filter(r => r.courseId === course.id);
    const selection = useMemo(() => selectGuideSources({ resources, assignments: state.assignments, announcements: state.announcements, events: state.calendarEvents, unitInfo: state.unitInfos[course.id], schedule: state.schedules[course.id], syncedAt: state.syncStatus.lastSync }, scope), [resources, state.assignments, state.announcements, state.calendarEvents, state.unitInfos, state.schedules, state.syncStatus.lastSync, course.id, scope.accountScope, weekId, effectiveWeek, localDate, timezone, settings.language, settings.aiModel, settings.aiBaseUrl, settings.aiFormat, settings.aiCompatType, hours]);
    const facts = buildGuideFacts(selection.included, scope), context = buildGuideContext(selection, facts, scope), key = guideKey(scope), artifact = state.studyGuides[key], progress = state.guideProgress[key] ?? {};
    const allSources = useMemo(() => [...selection.included, ...selection.excluded], [selection]);
    const hasKey = !!settings.aiApiKey && !!settings.aiBaseUrl;
    const apiUrl = settings.aiBaseUrl ? buildAiUrl(settings.aiBaseUrl, settings.aiFormat ?? splitAiUrl(settings.aiBaseUrl).format) : '';
    const dateText = (value: string | number) => Number.isFinite(new Date(value).getTime()) ? new Intl.DateTimeFormat(settings.language, { timeZone: timezone, dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) : c.unknown;
    /** A calendar day (YYYY-MM-DD) as "26 Nov" / "11月26日", without shifting it through a timezone. */
    const dayText = (day: string) => new Intl.DateTimeFormat(settings.language, { timeZone: 'UTC', month: 'short', day: 'numeric' }).format(new Date(day + 'T12:00:00Z'));

    // ---- Study plan (existing generator, unchanged behaviour) ----
    const requestIdentity = `${key}:${context.inputHash}:${settings.aiBaseUrl}:${settings.aiFormat}:${settings.aiApiKey}`;
    const identity = useRef(requestIdentity);
    identity.current = requestIdentity;
    const generation = useRef<AbortController | null>(null), [running, setRunning] = useState(false), [stream, setStream] = useState(''), [attempt, setAttempt] = useState<GuideAttempt | null>(null);
    useEffect(() => { setRunning(false); setStream(''); setAttempt(null); return () => { generation.current?.abort(); }; }, [requestIdentity]);
    const stale = !!artifact && artifact.inputHash !== context.inputHash;
    const fallback = state.guideFallbacks[key];
    async function generatePlan() {
        if (running || !hasKey || !context.includedSourceIds.length) return;
        const request = requestIdentity, controller = new AbortController();
        generation.current = controller;
        setRunning(true); setStream(''); setAttempt(null);
        const result = await generateGuide({ scope, selection, facts, context, signal: controller.signal, apiKey: settings.aiApiKey, apiUrl, model: settings.aiModel }, text => {
            if (identity.current === request && !controller.signal.aborted) setStream(text);
        });
        if (identity.current !== request || controller.signal.aborted) return;
        if (result.artifact) useAppStore.getState().saveStudyGuide(result.artifact);
        setAttempt(result); setRunning(false);
    }
    const artifactSources = (ids: string[]) => (artifact?.sources ?? selection.included).filter(s => ids.includes(s.id));

    // ---- Week switching: arrows move the calendar week and the teaching week together ----
    const moveWeek = (delta: number) => {
        setWeekId(shiftDate(weekId, delta * 7));
        setSelectedWeek(effectiveWeek == null ? null : Math.max(1, effectiveWeek + delta));
    };

    // ---- This week's to-dos ----
    const todo = facts.actions.map(card => {
        const source = selection.included.find(s => s.id === card.sourceIds[0]);
        const due = String(facts.facts.find(f => card.factIds.includes(f.id) && f.field === 'dueAt')?.value ?? '');
        return { card, source, assignment: source?.assignment, due };
    });
    const countdown = (due: string) => {
        const at = Date.parse(due);
        if (!Number.isFinite(at)) return { label: c.unknown, tone: 'muted' as const };
        if (at < clock.getTime()) return { label: q.overdue, tone: 'danger' as const };
        const days = Math.round((Date.parse(localDay(new Date(at), timezone)) - Date.parse(localDate)) / 86400000);
        if (days <= 0) return { label: q.today, tone: 'danger' as const };
        if (days === 1) return { label: q.tomorrow, tone: 'warning' as const };
        return { label: q.inDays(days), tone: days <= 3 ? 'warning' as const : 'muted' as const };
    };
    const retired = Object.entries(progress).filter(([id, p]) => p.card && (p.done || p.text) && !facts.actions.some(a => a.id === id) && !artifact?.cards.some(card => card.kind === 'plan' && card.id === id));

    // ---- Quick actions ----
    const [active, setActive] = useState<QuickPreset>('plan');
    // Assessments of this unit a targeted action can be about (category summary rows excluded).
    const unitAssessments = useMemo(() => state.assignments
        .filter(a => a.courseId === course.id && !a.isCategory)
        .sort((a, b) => (a.dueDateIso || '9').localeCompare(b.dueDateIso || '9')), [state.assignments, course.id]);
    const [targetId, setTargetId] = useState<number | null>(null);
    const target: Assignment | null = unitAssessments.find(a => a.id === targetId)
        ?? unitAssessments.find(a => a.status === 'pending' || a.status === 'upcoming') ?? unitAssessments[0] ?? null;
    const [gradebook, setGradebook] = useState<GradeEntry[] | undefined>(undefined), [gradebookState, setGradebookState] = useState<'idle' | 'loading' | 'failed'>('idle');
    const quickRun = useRef<AbortController | null>(null);
    const [quickBusy, setQuickBusy] = useState<string | null>(null), [quickError, setQuickError] = useState<{ key: string; message: string } | null>(null);
    useEffect(() => () => quickRun.current?.abort(), []);
    const evidenceFor = (preset: AiPreset, rows = gradebook) => selectQuickEvidence(
        preset, scope, allSources, state.announcements, preset === 'brief' ? target ?? undefined : undefined, { gradebook: rows },
    );
    const keyFor = (preset: AiPreset) => quickKey(scope, preset, preset === 'brief' ? target?.id : undefined);
    /** Feedback lives in the gradebook, which is only opened when the student asks for it. */
    async function loadGradebook(): Promise<GradeEntry[] | undefined> {
        setGradebookState('loading');
        try {
            const rows = await fetchCourseGradebook(course.id);
            setGradebook(rows); setGradebookState('idle');
            return rows;
        } catch {
            setGradebookState('failed');
            return undefined;
        }
    }
    async function ask(preset: AiPreset) {
        if (!hasKey || quickBusy) return;
        let rows = gradebook;
        if (preset === 'feedback' && !rows) { rows = await loadGradebook(); if (!rows) return; }
        const ev = evidenceFor(preset, rows), k = keyFor(preset);
        if (!ev.available) return;
        const controller = new AbortController();
        quickRun.current = controller;
        setQuickBusy(k); setQuickError(null);
        const run = await runQuickAnswer(k, preset, ev, { apiKey: settings.aiApiKey, apiUrl, model: settings.aiModel }, controller.signal);
        if (controller.signal.aborted) return;
        if (run.answer) useAppStore.getState().saveQuickAnswer(run.answer);
        else setQuickError({ key: k, message: humanizeAiError(run.error ?? '', t).headline });
        setQuickBusy(null);
    }
    const tone = { danger: 'border-red-500/30 bg-red-500/[0.06]', warning: 'border-amber-500/30 bg-amber-500/[0.06]', muted: 'border-border bg-card' };
    const badge = { danger: 'bg-red-500/10 text-red-700 dark:text-red-300', warning: 'bg-amber-500/15 text-amber-800 dark:text-amber-300', muted: 'bg-muted text-muted-foreground' };

    const renderAnswer = (preset: AiPreset): ReactNode => {
        if (preset === 'brief' && !target) return <p className="text-sm text-muted-foreground">{q.pickBrief}</p>;
        const k = keyFor(preset), saved: QuickAnswer | undefined = state.quickAnswers[k];
        const pending = preset === 'feedback' && !gradebook;
        const ev = pending ? null : evidenceFor(preset);
        if (ev && !ev.available) return <p className="text-sm text-muted-foreground">{q.reasons[ev.reason]}</p>;
        const busy = quickBusy === k || (pending && gradebookState === 'loading'), outdated = !!saved && !!ev?.available && saved.inputHash !== ev.inputHash;
        return <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" disabled={!hasKey || !!quickBusy || busy} onClick={() => void ask(preset)} className="gap-2">{busy ? <Loader2 className="h-4 w-4 animate-spin"/> : <RefreshCw className="h-4 w-4"/>}{pending && !saved ? q.loadFeedback : saved ? q.regenerate : q.generate}</Button>
            {busy && <span className="text-xs text-muted-foreground">{pending ? q.loadingFeedback : q.running(ev?.available ? ev.sources.length : 0)}</span>}
            {!busy && saved && <span className="text-xs text-muted-foreground">{q.generated} {dateText(saved.generatedAt)}</span>}
          </div>
          {!hasKey && <p className="text-sm text-muted-foreground">{q.noKey}</p>}
          {preset === 'feedback' && pending && <p className="text-xs text-muted-foreground">{q.feedbackNote}</p>}
          {preset === 'feedback' && gradebookState === 'failed' && <p role="status" className="rounded-lg bg-muted p-3 text-sm">{q.feedbackFailed}</p>}
          {quickError?.key === k && <p role="status" className="rounded-lg bg-muted p-3 text-sm">{q.failed} {quickError.message}</p>}
          {outdated && <p role="status" className="rounded-lg bg-amber-500/10 p-3 text-sm">{q.stale}</p>}
          {saved && (saved.points.length ? <ul className="space-y-2.5">{saved.points.map((p, i) => <li key={i} className={`rounded-xl border p-3 text-sm leading-relaxed ${p.action ? 'border-primary/25 bg-primary/[0.04]' : 'border-border'}`}>{p.action && <span className="mr-2 rounded bg-primary/10 px-1.5 py-0.5 text-[11px] font-medium text-primary">{q.mustDo}</span>}{p.text}<SourceChips sources={saved.sources.filter(s => p.sourceIds.includes(s.id))}/></li>)}</ul> : <p className="text-sm text-muted-foreground">{preset === 'announcements' && !outdated && saved.rejected === 0 ? q.noChanges : q.empty}</p>)}
          {saved && saved.rejected > 0 && saved.points.length > 0 && <p className="text-xs text-muted-foreground">{q.rejected(saved.rejected)}</p>}
        </div>;
    };

    const renderPlan = () => <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-xs text-muted-foreground">{q.hours}<input type="number" min={0.5} max={40} step={0.5} value={hours} onChange={e => { const n = Number(e.target.value); if (Number.isFinite(n)) setHours(Math.max(.5, Math.min(40, n))); }} className="mt-1 block w-24 rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm text-foreground"/></label>
        <Button size="sm" disabled={running || !hasKey || !context.includedSourceIds.length} onClick={() => void generatePlan()} className="gap-2">{running ? <Loader2 className="h-4 w-4 animate-spin"/> : <RefreshCw className="h-4 w-4"/>}{running ? c.generating : artifact ? q.regenerate : q.generate}</Button>
      </div>
      {!hasKey && <p className="text-sm text-muted-foreground">{q.noKey}</p>}
      {stale && <p role="status" className="rounded-lg bg-amber-500/10 p-3 text-sm">{c.stale}</p>}
      {attempt && (attempt.status === 'failed' || attempt.status === 'partial') && <div role="status" className="rounded-lg bg-muted p-3 text-sm"><p>{attempt.status === 'partial' ? c.partial : c.failed}</p>{attempt.error && <p className="mt-1 text-muted-foreground">{humanizeAiError(attempt.error, t).headline}</p>}</div>}
      {running && <div aria-live="polite" aria-busy="true" className="max-h-[40dvh] overflow-y-auto rounded-xl bg-muted/40 p-4"><p className="mb-2 text-xs text-muted-foreground">{c.streaming}</p><MarkdownRenderer allowLinks={false} content={stream || c.generating}/></div>}
      {artifact ? <>
        <p className="text-xs text-muted-foreground">{q.generated} {dateText(artifact.generatedAt)} · {c.budget}: {artifact.cards.reduce((sum, card) => sum + (card.suggestedMinutes ?? 0), 0)} {c.minutes}</p>
        {artifact.cards.filter(card => card.kind === 'plan').map(card => <GuideCard key={card.id} card={card} sources={artifactSources(card.sourceIds)} language={settings.language} progress={progress[card.id]} onProgress={p => state.setGuideProgress(key, card.id, { ...p, card })}/>)}
        {artifact.warnings > 0 && <p className="text-xs text-muted-foreground">{c.unsupported}</p>}
        {!artifact.cards.some(card => card.kind === 'plan') && artifact.markdown && <details><summary className="cursor-pointer text-sm text-muted-foreground">{c.raw}</summary><div className="mt-2 max-h-[45dvh] overflow-y-auto rounded-xl border border-border p-4"><MarkdownRenderer allowLinks={false} content={artifact.markdown}/></div></details>}
      </> : !running && <p className="text-sm text-muted-foreground">{context.includedSourceIds.length ? c.noPlan : c.noEvidence}</p>}
      {fallback && <details className="rounded-xl border border-border p-3 text-sm"><summary className="cursor-pointer">{fallback.cards.length ? c.partialSuggestions : c.textOnly}</summary><div className="mt-2 max-h-[45dvh] space-y-3 overflow-y-auto">{fallback.cards.map(card => <GuideCard key={card.id} card={card} sources={(fallback.sources ?? []).filter(s => card.sourceIds.includes(s.id))} language={settings.language} progress={progress[card.id]} onProgress={p => state.setGuideProgress(key, card.id, { ...p, card })}/>)}</div></details>}
    </div>;

    // ---- Rubric self-check (no AI): ticks persist per account, unit and assessment ----
    const renderRubric = (assignment: Assignment) => {
        const criteria = assignment.rubric;
        if (!criteria?.some(criterion => criterion.levels.length > 0)) return null;
        const rubricKey = JSON.stringify([scope.accountScope, 'rubric', course.id, assignment.id]);
        const rubricProgress = state.guideProgress[rubricKey] ?? {};
        return <details className="mt-2 space-y-2">
          <summary className="cursor-pointer text-xs font-medium text-primary">{q.rubric}</summary>
      <p className="text-xs text-muted-foreground">{q.rubricHint}</p>
      <ul className="space-y-2">{criteria.map((cr, i) => {
          if (!cr.levels.length) return null;
          const top = cr.levels[cr.levels.length - 1], done = rubricProgress[`c${i}`]?.done ?? false;
          return <li key={i} className={`rounded-xl border p-3 text-sm ${done ? 'border-emerald-500/30 bg-emerald-500/[0.05]' : 'border-border'}`}>
            <label className="flex cursor-pointer items-start gap-2.5"><input type="checkbox" checked={done} onChange={e => state.setGuideProgress(rubricKey, `c${i}`, { done: e.target.checked })} className="mt-0.5 h-4 w-4 shrink-0 accent-primary"/><span className="min-w-0"><span className="block font-medium">{cr.criterion}</span><span className="mt-1 block text-xs text-muted-foreground"><span className="font-medium text-foreground/80">{q.topLevel}{top.score ? ` · ${top.score}` : ''}: </span>{top.definition}</span></span></label>
            {cr.levels.length > 1 && <details className="mt-2 pl-6 text-xs text-muted-foreground"><summary className="cursor-pointer">{q.otherLevels}</summary><ul className="mt-1 space-y-1">{cr.levels.slice(0, -1).reverse().map((l, j) => <li key={j}>{l.score ? <b className="font-medium">{l.score}: </b> : null}{l.definition}</li>)}</ul></details>}
          </li>;
      })}</ul>
      {assignment.url && <SourceChips sources={[{ id: `rubric-src:${assignment.id}`, courseId: course.id, kind: 'assignment', title: assignment.name, url: assignment.url, excerpt: '', locator: assignment.name, coverage: 'body', week: null, contentHash: '' }]}/>}
        </details>;
    };

    // Picker for the actions that are about one assessment.
    const renderPicker = () => <label className="mb-3 block text-xs text-muted-foreground">{q.pickAssessment}<select value={target?.id ?? ''} onChange={e => setTargetId(Number(e.target.value))} className="mt-1 block w-full min-w-0 rounded-lg border border-border bg-background px-2.5 py-2 text-sm text-foreground">{unitAssessments.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label>;
    const legacy = state.summaries[course.id], legacyPlan = state.aiInsights.plans[course.id];



    return <div className="min-w-0 space-y-4 [overflow-wrap:anywhere]">
    {/* Week bar */}
    <div className="flex flex-wrap items-center gap-1.5 text-sm">
      <Button variant="ghost" size="sm" aria-label={q.prevWeek} onClick={() => moveWeek(-1)}><ChevronLeft className="h-4 w-4"/></Button>
      {effectiveWeek != null && <span className="font-semibold">{q.week(effectiveWeek)}</span>}
      <span className="text-muted-foreground">{dayText(weekId)} – {dayText(shiftDate(weekId, 6))}</span>
      <Button variant="ghost" size="sm" aria-label={q.nextWeek} onClick={() => moveWeek(1)}><ChevronRight className="h-4 w-4"/></Button>
      {(weekId !== currentWeekId || selectedWeek !== undefined) && <Button variant="outline" size="sm" className="h-7 px-2.5 text-xs" onClick={() => { setWeekId(currentWeekId); setSelectedWeek(undefined); }}>{q.thisWeek}</Button>}
    </div>

    {facts.conflicts.length > 0 && <div role="status" className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 text-sm"><p className="mb-3">{c.conflicts}</p><GuideSources sources={allSources.filter(s => facts.conflicts.flat().includes(s.id))} language={settings.language}/></div>}

    <div className="grid min-w-0 gap-4 lg:grid-cols-2">
      {/* Left: this week's to-dos */}
      <section aria-labelledby="guide-todo" className="min-w-0 rounded-2xl border border-border bg-card p-4">
        <div className="mb-3 flex items-center justify-between gap-2"><h2 id="guide-todo" className="flex items-center gap-2 font-semibold"><CalendarClock className="h-4 w-4 text-primary"/>{q.todo}</h2>{todo.length > 0 && <span className="rounded-md bg-primary/10 px-2 py-0.5 text-xs text-primary">{q.items(todo.length)}</span>}</div>
        {todo.length ? <ul className="space-y-2">{todo.map(({ card, assignment, due }) => {
            const done = progress[card.id]?.done ?? false, cd = done ? { label: q.done, tone: 'muted' as const } : countdown(due);
            const tip = !stale && artifact?.cards.find(s => s.kind === 'action' && s.sourceIds.includes(card.sourceIds[0]));
            return <li key={card.id} className={`rounded-xl border p-3 ${tone[cd.tone]}`}>
              <div className="flex items-start gap-2.5">
                <input type="checkbox" checked={done} onChange={e => state.setGuideProgress(key, card.id, { done: e.target.checked, card })} aria-label={`${q.markDone}: ${card.title}`} className="mt-0.5 h-4 w-4 shrink-0 accent-primary"/>
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-2"><p className={`text-sm font-medium leading-snug ${done ? 'text-muted-foreground line-through' : ''}`}>{progress[card.id]?.text || card.title}</p><span className={`shrink-0 rounded-md px-2 py-0.5 text-[11px] font-medium ${badge[cd.tone]}`}>{cd.label}</span></div>
                  <p className="mt-1 text-xs text-muted-foreground">{[assignment ? (assignment.weight != null ? q.weight(assignment.weight) : q.noWeight) : null, due && Number.isFinite(Date.parse(due)) ? `${q.due} ${dateText(due)}` : null].filter(Boolean).join(' · ')}</p>
                  {tip && <p className="mt-1.5 text-xs text-foreground/80">{q.aiTip}: {tip.explanation || tip.title}</p>}
                  {assignment && <>
                    <button type="button" onClick={() => { setTargetId(assignment.id); setActive('brief'); }} className="mt-1.5 text-xs font-medium text-primary hover:underline focus-visible:ring-2 focus-visible:ring-primary">{q.requirements}</button>
                    {renderRubric(assignment)}
                  </>}
                </div>
              </div>
            </li>;
        })}</ul> : <p className="rounded-xl bg-muted/40 p-4 text-sm text-muted-foreground">{q.noTodo}</p>}
        {retired.length > 0 && <details className="mt-3 text-sm"><summary className="cursor-pointer text-muted-foreground">{q.saved} · {retired.length}</summary><div className="mt-2 space-y-2">{retired.map(([id, p]) => <GuideCard key={id} card={p.card as CardData} sources={artifactSources((p.card as CardData).sourceIds)} language={settings.language} progress={p} onProgress={next => state.setGuideProgress(key, id, { ...next, card: p.card })}/>)}</div></details>}
      </section>

      {/* Right: quick actions */}
      <section aria-labelledby="guide-quick" className="min-w-0 rounded-2xl border border-border bg-card p-4">
        <h2 id="guide-quick" className="flex items-center gap-2 font-semibold"><Sparkles className="h-4 w-4 text-primary"/>{q.quick}</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">{q.quickHint}</p>
        <div role="tablist" aria-label={q.quick} className="mt-3 grid grid-cols-2 gap-2">
          {QUICK_ACTIONS.map(({ id, icon: Icon }) => {
            const [label, hint] = q.presets[id], selected = active === id;
            return <button key={id} type="button" role="tab" aria-selected={selected} onClick={() => setActive(id)} className={`flex min-w-0 items-start gap-2 rounded-xl border p-2.5 text-left transition-colors focus-visible:ring-2 focus-visible:ring-primary ${selected ? 'border-primary/40 bg-primary/[0.06]' : 'border-border hover:bg-muted/50'}`}>
              <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${selected ? 'text-primary' : 'text-muted-foreground'}`} aria-hidden="true"/>
              <span className="min-w-0"><span className="block text-sm font-medium leading-snug">{label}</span><span className="block text-[11px] leading-snug text-muted-foreground">{hint}</span></span>
            </button>;
          })}
        </div>
        <div role="tabpanel" className="mt-4 border-t border-border pt-4">
          {active === 'brief' && unitAssessments.length > 0 && renderPicker()}
          {active === 'plan' ? renderPlan() : renderAnswer(active)}
        </div>
      </section>
    </div>

    {/* More: materials and old summaries, on demand */}
    <div className="space-y-2">
      <details className="rounded-xl border border-border bg-card px-4 py-2.5 text-sm"><summary className="cursor-pointer font-medium">{q.materials} · {selection.included.length}</summary><p className="mt-2 text-xs text-muted-foreground">{c.updated}: {state.syncStatus.lastSync ? dateText(state.syncStatus.lastSync) : c.notSynced} · {c.coverageHint}</p><div className="mt-2 max-h-[50dvh] overflow-y-auto"><GuideSources sources={selection.included} language={settings.language}/></div></details>
      {(legacy || legacyPlan) && <details className="rounded-xl border border-border bg-card px-4 py-2.5 text-sm"><summary className="cursor-pointer font-medium">{q.legacy}</summary><p className="my-2 text-muted-foreground">{c.legacyHint}</p>{legacy && <div className="max-h-80 overflow-y-auto"><MarkdownRenderer allowLinks={false} content={legacy.markdown || legacy.content}/></div>}{legacyPlan && <div className="mt-3 max-h-80 overflow-y-auto"><h3>{c.oldPlan}</h3>{legacyPlan.days.map((d, i) => <div key={i} className="mt-2"><b>{d.day}</b>{d.tasks.map((task, j) => <p key={j}>{task.done ? '✓ ' : ''}{task.text}</p>)}</div>)}</div>}</details>}
    </div>
  </div>;
}
