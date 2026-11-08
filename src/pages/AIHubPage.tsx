import { useMemo, useState } from 'react';
import { ArrowLeft, BookOpen, Settings } from 'lucide-react';
import { useAppStore } from '../stores/useAppStore';
import { inferActiveSemesterKey, isCourseInSemester, parseSemester } from '../lib/courseHelpers';
import { guideCopy } from '../lib/studyGuide/copy';
import { StudyGuidePanel } from '../components/StudyGuidePanel';
import { Button } from '../components/ui/button';
export function AIHubPage({ initialCourseId, onBack }: {
    initialCourseId?: number | null;
    onBack: () => void;
}) {
    const courses = useAppStore(s => s.courses), settings = useAppStore(s => s.settings), owner = useAppStore(s => s.cacheOwnerEmail || s.user?.email || '');
    const c = guideCopy(settings.language);
    const eligible = useMemo(() => { const visible = courses.filter(s => !s.isPortal && !settings.hiddenCourseIds?.includes(s.id)); const semester = inferActiveSemesterKey(visible); return visible.filter(s => { const parsed = parseSemester(s.fullName || s.shortName); return parsed.key !== 'other' && isCourseInSemester(parsed, semester); }); }, [courses, settings.hiddenCourseIds]);
    const [selected, setSelected] = useState(initialCourseId ?? Number(localStorage.getItem('muster.guideCourse') || 0));
    const course = eligible.find(s => s.id === selected) ?? eligible[0];
    return <div className="mx-auto w-full min-w-0 max-w-5xl p-4 pb-12 sm:p-6 lg:p-8">
    <div className="mb-6 flex flex-wrap items-center justify-between gap-2"><Button variant="ghost" onClick={onBack} className="gap-2"><ArrowLeft className="h-4 w-4"/>{c.back}</Button><Button variant="ghost" className="gap-2" onClick={() => window.dispatchEvent(new CustomEvent('muster:open-settings', { detail: 'ai' }))}><Settings className="h-4 w-4"/>{c.settings}</Button></div>
    <header className="mb-6"><div className="flex items-center gap-3"><BookOpen className="h-6 w-6 text-primary"/><h1 className="text-2xl font-semibold tracking-tight">{c.title}</h1></div><p className="mt-2 text-sm leading-relaxed text-muted-foreground">{c.subtitle}</p></header>
    {course ? <><label className="mb-6 block text-sm font-medium">{c.course}<select aria-label={c.course} value={course.id} onChange={e => { setSelected(Number(e.target.value)); localStorage.setItem('muster.guideCourse', e.target.value); }} className="mt-2 block w-full min-w-0 max-w-full rounded-xl border border-border bg-card px-3 py-3 text-sm">{eligible.map(s => <option key={s.id} value={s.id}>{s.fullName || s.shortName}</option>)}</select></label><StudyGuidePanel key={`${owner}:${course.id}`} course={course}/></> : <p className="rounded-2xl border border-border p-6 text-muted-foreground">{c.noCourses}</p>}
  </div>;
}
