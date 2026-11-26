import { AlertTriangle, CalendarClock, GraduationCap, Megaphone } from 'lucide-react';
import type { Course } from '../services/api';
import { useAppStore } from '../stores/useAppStore';
import { buildGuideFacts } from '../lib/studyGuide/facts';
import { accountScope, localDay, selectGuideSources, weekStart } from '../lib/studyGuide/sources';
import { groupByDay } from '../lib/studyGuide/assistant';
import { unitExams } from '../lib/studyGuide/quick';
import { quickCopy } from '../lib/studyGuide/quickCopy';

/**
 * "All units": this week's deadlines from every unit on one timeline, with clash days
 * flagged, plus upcoming exams and new announcements. Program-computed, no AI.
 */
export function AllUnitsPanel({ courses, onOpenUnit }: { courses: Course[]; onOpenUnit: (id: number) => void }) {
    const state = useAppStore(), language = state.settings.language, q = quickCopy(language);
    const now = new Date(), timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC', today = localDay(now, timezone);
    const owner = accountScope(state.cacheOwnerEmail || state.user?.email || '');

    const items = courses.flatMap(course => {
        const scope = { accountScope: owner, courseId: course.id, weekId: weekStart(today), selectedWeek: null, timezone, now: now.toISOString(), localDate: today, language, model: state.settings.aiModel, availableMinutes: 120 };
        const sources = selectGuideSources({ resources: [], assignments: state.assignments, announcements: state.announcements, events: state.calendarEvents }, scope);
        const facts = buildGuideFacts(sources.included, scope);
        return facts.actions.map(action => ({
            id: action.id,
            title: action.title,
            course,
            due: String(facts.facts.find(f => action.factIds.includes(f.id) && f.field === 'dueAt')?.value ?? ''),
        }));
    }).filter(i => { const at = Date.parse(i.due); return Number.isFinite(at) && at >= now.getTime(); });
    const days = groupByDay(items, timezone);

    const horizon = now.getTime() + 21 * 86400000;
    const exams = courses.flatMap(course => unitExams(state.exams, course.id, course.shortName || course.fullName || '').map(e => ({ e, course })))
        .filter(({ e }) => { const at = Date.parse(e.startAt || e.date); return Number.isFinite(at) && at >= now.getTime() - 86400000 && at <= horizon; });
    const weekAgo = now.getTime() - 7 * 86400000;
    const notices = courses.map(course => ({ course, count: state.announcements.filter(a => a.courseId === course.id && Date.parse(a.date) >= weekAgo).length })).filter(n => n.count > 0);

    const dayLabel = (day: string) => new Intl.DateTimeFormat(language, { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric' }).format(new Date(day + 'T12:00:00Z'));
    const time = (iso: string) => new Intl.DateTimeFormat(language, { timeZone: timezone, timeStyle: 'short' }).format(new Date(iso));
    const unitButton = (course: Course) => <button type="button" onClick={() => onOpenUnit(course.id)} className="shrink-0 rounded-md bg-primary/10 px-1.5 py-0.5 text-[11px] font-medium text-primary hover:bg-primary/15 focus-visible:ring-2 focus-visible:ring-primary">{course.shortName || course.fullName}</button>;

    return <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
    <section aria-labelledby="across-title" className="min-w-0 rounded-2xl border border-border bg-card p-4">
      <h2 id="across-title" className="mb-3 flex items-center gap-2 font-semibold"><CalendarClock className="h-4 w-4 text-primary"/>{q.acrossTitle}</h2>
      {days.length ? <ol className="space-y-3">{days.map(d => <li key={d.day}>
        <p className="mb-1.5 flex items-center gap-2 text-xs font-medium text-muted-foreground">{dayLabel(d.day)}{d.day === today && <span className="rounded bg-red-500/10 px-1.5 py-0.5 text-[11px] text-red-700 dark:text-red-300">{q.today}</span>}{d.clash && <span className="inline-flex items-center gap-1 rounded bg-amber-500/15 px-1.5 py-0.5 text-[11px] text-amber-800 dark:text-amber-300"><AlertTriangle className="h-3 w-3"/>{q.clash}</span>}</p>
        <ul className={`space-y-1.5 ${d.clash ? 'rounded-xl border border-amber-500/30 bg-amber-500/[0.05] p-2' : ''}`}>{d.items.map(i => <li key={i.id} className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-sm">{unitButton(i.course)}<span className="min-w-0 flex-1 truncate" title={i.title}>{i.title}</span><span className="shrink-0 text-xs tabular-nums text-muted-foreground">{time(i.due)}</span></li>)}</ul>
      </li>)}</ol> : <p className="rounded-xl bg-muted/40 p-4 text-sm text-muted-foreground">{q.noneAcross}</p>}
    </section>
    <div className="min-w-0 space-y-4">
      <section aria-labelledby="across-exams" className="rounded-2xl border border-border bg-card p-4">
        <h2 id="across-exams" className="mb-3 flex items-center gap-2 font-semibold"><GraduationCap className="h-4 w-4 text-primary"/>{q.examsSoon}</h2>
        {exams.length ? <ul className="space-y-2">{exams.map(({ e, course }) => <li key={e.id} className="flex items-start gap-2 text-sm">{unitButton(course)}<span className="min-w-0"><span className="block">{e.examType || e.courseName}</span><span className="block text-xs text-muted-foreground">{[e.date, e.startTime, e.location].filter(Boolean).join(' · ')}</span></span></li>)}</ul> : <p className="text-sm text-muted-foreground">{q.noExam}</p>}
      </section>
      {notices.length > 0 && <section aria-labelledby="across-notices" className="rounded-2xl border border-border bg-card p-4">
        <h2 id="across-notices" className="mb-3 flex items-center gap-2 font-semibold"><Megaphone className="h-4 w-4 text-primary"/>{q.noticesTitle}</h2>
        <ul className="space-y-1.5">{notices.map(({ course, count }) => <li key={course.id} className="flex items-center gap-2 text-sm">{unitButton(course)}<span className="text-muted-foreground">{q.newNotices(count)}</span></li>)}</ul>
      </section>}
    </div>
  </div>;
}
