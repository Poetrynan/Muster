import { useMemo, useState } from 'react';
import { ArrowLeft, Settings, Sparkles } from 'lucide-react';
import { useAppStore } from '../stores/useAppStore';
import { inferActiveSemesterKey, isCourseInSemester, parseSemester } from '../lib/courseHelpers';
import { guideCopy } from '../lib/studyGuide/copy';
import { quickCopy } from '../lib/studyGuide/quickCopy';
import { StudyGuidePanel } from '../components/StudyGuidePanel';
import { AllUnitsPanel } from '../components/AllUnitsPanel';
import { Button } from '../components/ui/button';

/** Relative "2 hours ago" in the interface language. */
function ago(iso: string | undefined, language: string): string | null {
    const at = iso ? Date.parse(iso) : NaN;
    if (!Number.isFinite(at)) return null;
    const minutes = Math.round((Date.now() - at) / 60000);
    const rtf = new Intl.RelativeTimeFormat(language, { numeric: 'auto' });
    if (minutes < 60) return rtf.format(-Math.max(0, minutes), 'minute');
    if (minutes < 60 * 24) return rtf.format(-Math.round(minutes / 60), 'hour');
    return rtf.format(-Math.round(minutes / 1440), 'day');
}

export function AIHubPage({ initialCourseId, onBack }: {
    initialCourseId?: number | null;
    onBack: () => void;
}) {
    const courses = useAppStore(s => s.courses), settings = useAppStore(s => s.settings), owner = useAppStore(s => s.cacheOwnerEmail || s.user?.email || ''), lastSync = useAppStore(s => s.syncStatus.lastSync);
    const c = guideCopy(settings.language), q = quickCopy(settings.language);
    const eligible = useMemo(() => { const visible = courses.filter(s => !s.isPortal && !settings.hiddenCourseIds?.includes(s.id)); const semester = inferActiveSemesterKey(visible); return visible.filter(s => { const parsed = parseSemester(s.fullName || s.shortName); return parsed.key !== 'other' && isCourseInSemester(parsed, semester); }); }, [courses, settings.hiddenCourseIds]);
    // 'all' shows every unit's week on one timeline; a number is one unit.
    const [selected, setSelected] = useState<number | 'all'>(() => { if (initialCourseId) return initialCourseId; try { const v = localStorage.getItem('muster.guideCourse'); return v === 'all' ? 'all' : Number(v || 0); } catch { return 0; } });
    const course = selected === 'all' ? undefined : eligible.find(s => s.id === selected) ?? eligible[0];
    const pick = (id: number | 'all') => { setSelected(id); try { localStorage.setItem('muster.guideCourse', String(id)); } catch { /* per-viewer convenience only */ } };
    const synced = ago(lastSync, settings.language);
    return <div className="mx-auto w-full min-w-0 max-w-6xl p-4 pb-12 sm:p-6 lg:p-8">
    <div className="mb-4 flex flex-wrap items-center justify-between gap-2"><Button variant="ghost" onClick={onBack} className="gap-2"><ArrowLeft className="h-4 w-4"/>{q.back}</Button><Button variant="ghost" className="gap-2" onClick={() => window.dispatchEvent(new CustomEvent('muster:open-settings', { detail: 'ai' }))}><Settings className="h-4 w-4"/>{q.settings}</Button></div>
    <header className="mb-4 flex flex-wrap items-center justify-between gap-3">
      <div className="flex min-w-0 items-center gap-3"><div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary"><Sparkles className="h-5 w-5"/></div><div className="min-w-0"><h1 className="text-xl font-semibold tracking-tight">{c.title}</h1><p className="text-sm text-muted-foreground">{q.subtitle}</p></div></div>
      <span className={`rounded-full px-3 py-1 text-xs ${synced ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300' : 'bg-muted text-muted-foreground'}`}>{synced ? `${q.synced} · ${synced}` : q.notSynced}</span>
    </header>
    {eligible.length ? <>
      <nav aria-label={c.course} className="-mx-1 mb-4 flex gap-1.5 overflow-x-auto px-1 pb-1">{[{ id: 'all' as const, label: q.allUnits, title: q.allUnits }, ...eligible.map(s => ({ id: s.id, label: s.shortName || s.fullName, title: s.fullName }))].map(tab => { const on = selected === 'all' ? tab.id === 'all' : tab.id === course?.id; return <button key={tab.id} type="button" aria-pressed={on} title={tab.title} onClick={() => pick(tab.id)} className={`shrink-0 rounded-lg border px-3 py-1.5 text-sm transition-colors focus-visible:ring-2 focus-visible:ring-primary ${on ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-card hover:bg-muted'}`}>{tab.label}</button>; })}</nav>
      {course ? <StudyGuidePanel key={`${owner}:${course.id}`} course={course}/> : <AllUnitsPanel courses={eligible} onOpenUnit={pick}/>}
    </> : <p className="rounded-2xl border border-border p-6 text-muted-foreground">{c.noCourses}</p>}
  </div>;
}
