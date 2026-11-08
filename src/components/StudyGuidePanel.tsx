import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, BookOpen, Loader2, RefreshCw } from 'lucide-react';
import type { Course } from '../services/api';
import { useAppStore } from '../stores/useAppStore';
import { buildAiUrl, splitAiUrl } from '../services/aiUrl';
import { generateGuide, type GuideAttempt } from '../services/studyGuide';
import { accountScope, fingerprint, guideKey, localDay, selectGuideSources, shiftDate, weekStart } from '../lib/studyGuide/sources';
import { buildGuideContext, buildGuideFacts, buildGuideScore } from '../lib/studyGuide/facts';
import type { FactRecord, GuideScope } from '../lib/studyGuide/types';
import { guideCopy } from '../lib/studyGuide/copy';
import { humanizeAiError } from '../lib/aiError';
import { useTranslation } from '../i18n/useTranslation';
import { GuideCard } from './GuideCard';
import { GuideSources } from './GuideSources';
import { Button } from './ui/button';
import { MarkdownRenderer } from './ui/MarkdownRenderer';
export function StudyGuidePanel({ course }: {
    course: Course;
}) {
    const state = useAppStore(), { t } = useTranslation(), settings = state.settings, c = guideCopy(settings.language);
    const [clock, setClock] = useState(() => new Date());
    useEffect(() => { const timer = window.setInterval(() => setClock(new Date()), 60000); return () => window.clearInterval(timer); }, []);
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC', localDate = localDay(clock, timezone), currentWeekId = weekStart(localDate);
    const [weekId, setWeekId] = useState(currentWeekId), [selectedWeek, setSelectedWeek] = useState<number | null>(state.unitDashboards[course.id]?.currentWeek?.num ?? null), [hours, setHours] = useState(2);
    const scope: GuideScope = { accountScope: accountScope(state.cacheOwnerEmail || state.user?.email || ''), courseId: course.id, weekId, selectedWeek, localDate, timezone, now: clock.toISOString(), language: settings.language, model: settings.aiModel, availableMinutes: Math.round(hours * 60), provider: fingerprint([settings.aiBaseUrl, settings.aiFormat, settings.aiCompatType]) };
    const resources = state.courseResources[course.id] ?? state.allResources.filter(r => r.courseId === course.id);
    const selection = useMemo(() => selectGuideSources({ resources, assignments: state.assignments, announcements: state.announcements, events: state.calendarEvents, unitInfo: state.unitInfos[course.id], schedule: state.schedules[course.id], syncedAt: state.syncStatus.lastSync }, scope), [resources, state.assignments, state.announcements, state.calendarEvents, state.unitInfos, state.schedules, state.syncStatus.lastSync, course.id, scope.accountScope, weekId, selectedWeek, localDate, timezone, settings.language, settings.aiModel, settings.aiBaseUrl, settings.aiFormat, settings.aiCompatType, hours]);
    const facts = buildGuideFacts(selection.included, scope), context = buildGuideContext(selection, facts, scope), key = guideKey(scope), artifact = state.studyGuides[key], progress = state.guideProgress[key] ?? {};
    const requestIdentity = `${key}:${context.inputHash}:${settings.aiBaseUrl}:${settings.aiFormat}:${settings.aiApiKey}`;
    const identity = useRef(requestIdentity);
    identity.current = requestIdentity;
    const generation = useRef<AbortController | null>(null), [running, setRunning] = useState(false), [stream, setStream] = useState(''), [attempt, setAttempt] = useState<GuideAttempt | null>(null);
    useEffect(() => { setRunning(false); setStream(''); setAttempt(null); return () => { generation.current?.abort(); }; }, [requestIdentity]);
    const changeWeek = (value: string) => {
        if (!/^\d{4}-\d\d-\d\d$/.test(value) || !Number.isFinite(Date.parse(value)))
            return;
        setWeekId(weekStart(value));
        setSelectedWeek(null);
    };
    const availableWeeks = [...new Set([...resources.flatMap(r => r.weekNum == null ? [] : [r.weekNum]), ...(selectedWeek == null ? [] : [selectedWeek])])].sort((a, b) => a - b);
    const hasKey = !!settings.aiApiKey && !!settings.aiBaseUrl;
    const stale = !!artifact && artifact.inputHash !== context.inputHash;
    const fallback = state.guideFallbacks[key];
    const legacy = state.summaries[course.id], legacyPlan = state.aiInsights.plans[course.id];
    const dateText = (value: string | number) => Number.isFinite(new Date(value).getTime()) ? new Intl.DateTimeFormat(settings.language, { timeZone: timezone, dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) : c.unknown;
    const displayFact = (f: FactRecord, withOwner = false, origins = selection.included) => {
        const value = f.field === 'dueAt' && f.status === 'verified' ? dateText(f.value) : f.field === 'status' && String(f.value) in c ? c[f.value as 'pending'] : f.value;
        return <span key={f.id} className="inline-block rounded-md bg-muted/60 px-2 py-1 text-xs [overflow-wrap:anywhere]">{withOwner ? `${f.sourceIds.map(id => origins.find(s => s.id === id)?.title || c.reference).join(' · ')} · ` : ''}{c[f.field]}: {value}{f.field === 'weight' ? '%' : ''}{f.status !== 'verified' ? ` · ${f.status === 'estimated' ? c.estimated : f.status === 'conflicting' ? c.conflicting : c.unknown}` : ''}</span>;
    };
    async function generate() {
        if (running || !hasKey || !context.includedSourceIds.length)
            return;
        const request = requestIdentity, controller = new AbortController();
        generation.current = controller;
        setRunning(true);
        setStream('');
        setAttempt(null);
        const result = await generateGuide({ scope, selection, facts, context, signal: controller.signal, apiKey: settings.aiApiKey, apiUrl: buildAiUrl(settings.aiBaseUrl, settings.aiFormat ?? splitAiUrl(settings.aiBaseUrl).format), model: settings.aiModel }, text => {
            if (identity.current === request && !controller.signal.aborted)
                setStream(text);
        });
        if (identity.current !== request || controller.signal.aborted)
            return;
        if (result.artifact)
            useAppStore.getState().saveStudyGuide(result.artifact);
        setAttempt(result);
        setRunning(false);
    }
    const artifactSources = (ids: string[]) => (artifact?.sources ?? selection.included).filter(s => ids.includes(s.id));
    const retired = Object.entries(progress).filter(([id, p]) => p.card && (p.done || p.text) && !facts.actions.slice(0, 3).some(c => c.id === id) && !artifact?.cards.some(c => c.kind === 'plan' && c.id === id));
    const changedSources = artifact?.sources?.filter(old => !selection.included.some(s => s.id === old.id && s.contentHash === old.contentHash)) ?? [];
    const newSources = artifact?.sources ? selection.included.filter(s => !artifact.sources!.some(old => old.id === s.id)) : [];
    const score = buildGuideScore(selection.included);
    const currentSources = (ids: string[]) => selection.included.filter(s => ids.includes(s.id));
    return <div className="min-w-0 space-y-6 [overflow-wrap:anywhere]">
    <section className="rounded-2xl border border-border bg-card p-4 sm:p-5">
      <div className="grid min-w-0 gap-4 sm:grid-cols-3">
        <label className="min-w-0 text-sm font-medium">{c.week}<input type="date" value={weekId} onChange={e => changeWeek(e.target.value)} className="mt-2 block w-full min-w-0 rounded-lg border border-border bg-background p-2.5"/></label>
        <label className="min-w-0 text-sm font-medium">{c.teachingWeek}<select aria-label={c.teachingWeek} value={selectedWeek ?? ''} onChange={e => setSelectedWeek(e.target.value === '' ? null : Number(e.target.value))} className="mt-2 block w-full rounded-lg border border-border bg-background p-2.5"><option value="">{c.unknownWeek}</option>{availableWeeks.map(w => <option key={w} value={w}>{w}</option>)}</select></label>
        <label className="min-w-0 text-sm font-medium">{c.hours}<input type="number" min={0.5} max={40} step={0.5} value={hours} onChange={e => {
            const n = Number(e.target.value);
            if (Number.isFinite(n))
                setHours(Math.max(.5, Math.min(40, n)));
        }} className="mt-2 block w-full rounded-lg border border-border bg-background p-2.5"/></label>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-1"><Button variant="ghost" size="sm" aria-label={c.previous} onClick={() => changeWeek(shiftDate(weekId, -7))}><ArrowLeft className="h-4 w-4"/></Button><Button variant="ghost" size="sm" onClick={() => { setWeekId(currentWeekId); setSelectedWeek(state.unitDashboards[course.id]?.currentWeek?.num ?? null); }}>{c.current}</Button><Button variant="ghost" size="sm" aria-label={c.next} onClick={() => changeWeek(shiftDate(weekId, 7))}><ArrowRight className="h-4 w-4"/></Button><span className="ml-2 text-xs text-muted-foreground">{weekId} – {shiftDate(weekId, 6)} · {timezone}</span></div>
      <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{c.scopeHint} {weekId === currentWeekId ? c.currentWindow : c.selectedWindow} {selectedWeek == null ? c.unknownWeekHint : ""}</p>
    </section>
    <section aria-labelledby="guide-overview" className="space-y-3"><h2 id="guide-overview" className="text-lg font-semibold">{c.overview}</h2><div className="grid gap-3 sm:grid-cols-3">{[[c.facts, facts.facts.filter(f => f.field === 'status').length], [c.sources, selection.included.length], [c.titleOnly, selection.coverage.titleOnly]].map(([label, count]) => <div key={label} className="rounded-xl border border-border bg-card p-4"><p className="text-xs text-muted-foreground">{label}</p><p className="mt-1 text-2xl font-semibold tabular-nums">{count}</p></div>)}</div><p className="text-xs leading-relaxed text-muted-foreground">{c.updated}: {state.syncStatus.lastSync ? dateText(state.syncStatus.lastSync) : c.notSynced} · {c.coverageHint}</p></section>
    {facts.conflicts.length > 0 && <div role="status" className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 text-sm"><p className="mb-3">{c.conflicts}</p><GuideSources sources={currentSources([...new Set(facts.conflicts.flat())])} language={settings.language}/></div>}
    <section aria-labelledby="guide-actions" className="space-y-3"><h2 id="guide-actions" className="text-lg font-semibold">{c.actions}</h2>{facts.actions.length ? facts.actions.slice(0, 3).map(card => <GuideCard key={card.id} card={card} sources={currentSources(card.sourceIds)} language={settings.language} progress={progress[card.id]} onProgress={p => state.setGuideProgress(key, card.id, { ...p, card })}><div className="mt-2 flex flex-wrap gap-1.5">{facts.facts.filter(f => card.factIds.includes(f.id)).map(f => displayFact(f))}</div>{!stale && artifact?.cards.filter(suggestion => suggestion.kind === "action" && suggestion.sourceIds.includes(card.sourceIds[0])).map(suggestion => <p key={suggestion.id} className="mt-2 text-sm text-muted-foreground">{c.advice}: {suggestion.explanation || suggestion.title}</p>)}</GuideCard>) : <p className="rounded-xl border border-border p-4 text-sm text-muted-foreground">{selection.included.length ? c.noActions : c.noData}</p>}<p className="text-xs leading-relaxed text-muted-foreground">{c.completion}</p></section>
    <section aria-labelledby="guide-plan" className="space-y-3 rounded-2xl border border-border bg-card p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-3"><h2 id="guide-plan" className="text-lg font-semibold">{c.plan}</h2><Button disabled={running || !hasKey || !context.includedSourceIds.length} onClick={() => void generate()} className="gap-2">{running ? <Loader2 className="h-4 w-4 animate-spin"/> : <RefreshCw className="h-4 w-4"/>}{running ? c.generating : artifact ? c.update : c.generate}</Button></div>
      {!hasKey && <p className="text-sm leading-relaxed text-muted-foreground">{c.noKey}</p>}
      {stale && <p role="status" className="rounded-lg bg-amber-500/10 p-3 text-sm">{c.stale}</p>}
      {stale && (changedSources.length > 0 || newSources.length > 0) && <details className="text-sm"><summary className="cursor-pointer">{c.changes} · {changedSources.length + newSources.length}</summary><div className="mt-2"><GuideSources sources={[...changedSources, ...newSources]} language={settings.language}/></div></details>}
      {attempt && (attempt.status === 'failed' || attempt.status === 'partial') && <div role="status" className="rounded-lg bg-muted p-3 text-sm"><p>{attempt.status === 'partial' ? c.partial : c.failed}</p>{attempt.error && <p className="mt-1 text-muted-foreground">{humanizeAiError(attempt.error, t).headline}</p>}</div>}
      {running && <div aria-live="polite" aria-busy="true" className="max-h-[45dvh] overflow-y-auto rounded-xl bg-muted/40 p-4"><p className="mb-2 text-xs text-muted-foreground">{c.streaming}</p><MarkdownRenderer allowLinks={false} content={stream || c.generating}/></div>}
      {attempt?.status === 'partial' && attempt.markdown && <details open><summary className="text-sm">{c.partial}</summary><div className="mt-2 max-h-80 overflow-y-auto rounded-lg border border-border p-3"><MarkdownRenderer allowLinks={false} content={attempt.markdown}/></div></details>}
      {artifact ? <>
        <p className="text-xs text-muted-foreground">{dateText(artifact.generatedAt)} · {artifact.scope.model} · {c.budget}: {artifact.cards.reduce((sum, c) => sum + (c.suggestedMinutes ?? 0), 0)} {c.minutes}</p>
        {artifact.status === 'text-only' && <p className="text-sm text-muted-foreground">{c.textOnly}</p>}
        {artifact.warnings > 0 && <p className="text-xs text-muted-foreground">{c.unsupported}</p>}
        {artifact.cards.filter(card => card.kind === 'plan').map(card => <GuideCard key={card.id} card={card} sources={artifactSources(card.sourceIds)} language={settings.language} progress={progress[card.id]} onProgress={p => state.setGuideProgress(key, card.id, { ...p, card })}><div className="mt-2 flex flex-wrap gap-1.5">{(artifact.facts ?? []).filter(f => card.factIds.includes(f.id)).map(f => displayFact(f, true, artifact.sources ?? []))}</div></GuideCard>)}
        {artifact.markdown && <details open={!artifact.cards.length}><summary className="cursor-pointer text-sm text-muted-foreground">{c.raw}</summary><div className="mt-3 max-h-[55dvh] overflow-y-auto rounded-xl border border-border p-4"><MarkdownRenderer allowLinks={false} content={artifact.markdown}/></div></details>}
      </> : !running && <p className="text-sm text-muted-foreground">{context.includedSourceIds.length ? c.noPlan : c.noEvidence}</p>}
      {fallback && <details open className="rounded-xl border border-border p-4"><summary className="cursor-pointer text-sm">{fallback.cards.length?c.partialSuggestions:c.textOnly}</summary><p className="my-2 text-xs text-muted-foreground">{dateText(fallback.generatedAt)} · {c.unsupported}</p><div className="max-h-[55dvh] space-y-3 overflow-y-auto">{fallback.cards.map(card=><GuideCard key={card.id} card={card} sources={(fallback.sources??[]).filter(s=>card.sourceIds.includes(s.id))} language={settings.language} progress={progress[card.id]} onProgress={p=>state.setGuideProgress(key,card.id,{...p,card})}><div className="mt-2 flex flex-wrap gap-1.5">{(fallback.facts??[]).filter(f=>card.factIds.includes(f.id)).map(f=>displayFact(f,true,fallback.sources??[]))}</div></GuideCard>)}<MarkdownRenderer allowLinks={false} content={fallback.markdown}/></div></details>}
      <details className="text-xs text-muted-foreground"><summary className="cursor-pointer py-1">{c.preview}</summary><p className="my-2 leading-relaxed">{c.privacy}</p><div className="max-h-96 overflow-y-auto"><GuideSources sources={currentSources(context.includedSourceIds)} language={settings.language}/></div></details>
    </section>
    {retired.length > 0 && <section className="space-y-3"><h2 className="text-lg font-semibold">{c.savedTasks}</h2>{retired.map(([id, p]) => <GuideCard key={id} card={p.card!} sources={artifactSources(p.card!.sourceIds)} language={settings.language} progress={p} onProgress={next => state.setGuideProgress(key, id, { ...next, card: p.card })}/>)}</section>}
    <details className="rounded-2xl border border-border bg-card p-4 sm:p-5"><summary className="cursor-pointer font-semibold">{c.facts} · {facts.facts.filter(f => f.field === 'status').length}</summary><div className="mt-4 space-y-3">{selection.included.filter(s => s.assignment).map(s => <div key={s.id} className="rounded-xl bg-muted/40 p-3"><h3 className="mb-2 text-sm font-medium">{s.title}</h3><div className="mb-2 flex flex-wrap gap-1.5">{facts.facts.filter(f => f.sourceIds.includes(s.id)).map(f => displayFact(f))}</div><GuideSources sources={[s]} language={settings.language}/></div>)}{!facts.facts.length && <p className="text-sm text-muted-foreground">{c.noFact}</p>}</div></details>
    <section className="rounded-2xl border border-border p-4 sm:p-5"><h2 className="font-semibold">{c.score}</h2>{score.earned == null ? <p className="mt-2 text-sm text-muted-foreground">{c.scoreUnknown}</p> : <><dl className="mt-3 grid gap-3 sm:grid-cols-3">{[[c.earned, score.earned], [c.needed, score.needed], [c.remaining, `${score.remainingWeight}%`]].map(([label, value]) => <div key={label}><dt className="text-xs text-muted-foreground">{label}</dt><dd className="mt-1 text-lg font-semibold tabular-nums">{value}</dd></div>)}</dl><p className="mt-3 text-xs text-muted-foreground">{c.scoreHint}</p><details className="mt-3 text-sm"><summary>{c.reference}</summary><GuideSources sources={currentSources(score.sourceIds)} language={settings.language}/></details></>}</section>
    <section className="space-y-3"><h2 className="flex items-center gap-2 text-lg font-semibold"><BookOpen className="h-4 w-4 text-primary"/>{c.sources}</h2><p className="text-xs text-muted-foreground">{selection.coverage.body} {c.body} · {selection.coverage.titleOnly} {c.titleOnly} · {context.omittedSourceIds.length} {c.omitted}</p><details><summary className="cursor-pointer py-2 text-sm">{c.sources} · {selection.included.length}</summary><div className="max-h-[55dvh] overflow-y-auto"><GuideSources sources={selection.included} language={settings.language} includedIds={artifact?.includedSourceIds.filter(id => selection.included.some(s => s.id === id && artifact.sources?.some(old => old.id === id && old.contentHash === s.contentHash)))} omittedIds={context.omittedSourceIds}/></div></details>{selection.excluded.length > 0 && <details><summary className="cursor-pointer text-sm text-muted-foreground">{c.excluded} · {selection.excluded.length}</summary><div className="mt-2"><GuideSources sources={selection.excluded} language={settings.language}/></div></details>}</section>
    {(legacy || legacyPlan) && <details className="rounded-2xl border border-border p-4 text-sm"><summary className="cursor-pointer">{c.legacy}</summary><p className="my-3 text-muted-foreground">{c.legacyHint}</p>{legacy && <div className="max-h-80 overflow-y-auto"><MarkdownRenderer allowLinks={false} content={legacy.markdown || legacy.content}/></div>}{legacyPlan && <div className="mt-3 max-h-80 overflow-y-auto"><h3>{c.oldPlan}</h3>{legacyPlan.days.map((d, i) => <div key={i} className="mt-2"><b>{d.day}</b>{d.tasks.map((task, j) => <p key={j}>{task.done ? '✓ ' : ''}{task.text}</p>)}</div>)}</div>}</details>}
  </div>;
}
