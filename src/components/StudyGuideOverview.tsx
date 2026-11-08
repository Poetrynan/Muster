import { BookOpen, ChevronRight } from 'lucide-react';
import { useAppStore } from '../stores/useAppStore';
import { guideCopy } from '../lib/studyGuide/copy';
import { buildGuideFacts } from '../lib/studyGuide/facts';
import { accountScope, localDay, selectGuideSources, weekStart } from '../lib/studyGuide/sources';
import { inferActiveSemesterKey, isCourseInSemester, parseSemester } from '../lib/courseHelpers';
/** Local rules only: opening the dashboard never incurs an AI request. */
export function StudyGuideOverview() {
    const state = useAppStore(), c = guideCopy(state.settings.language), now = new Date(), timezone = Intl.DateTimeFormat().resolvedOptions().timeZone, day = localDay(now, timezone);
    const courses = state.courses.filter(c => !c.isPortal && !state.settings.hiddenCourseIds?.includes(c.id)), semester = inferActiveSemesterKey(courses);
    const actions = courses.filter(c => { const s = parseSemester(c.fullName || c.shortName); return s.key !== 'other' && isCourseInSemester(s, semester); }).flatMap(course => {
        const scope = { accountScope: accountScope(state.cacheOwnerEmail || ''), courseId: course.id, weekId: weekStart(day), selectedWeek: state.unitDashboards[course.id]?.currentWeek?.num ?? null, timezone, now: now.toISOString(), localDate: day, language: state.settings.language, model: state.settings.aiModel, availableMinutes: 120 };
        const sources = selectGuideSources({ resources: [], assignments: state.assignments, announcements: state.announcements, events: state.calendarEvents }, scope);
        const facts = buildGuideFacts(sources.included, scope);
        return facts.actions.filter(a => a.priority !== 'normal').map(action => ({ action, course, due: String(facts.facts.find(f => action.factIds.includes(f.id) && f.field === 'dueAt')?.value ?? '') }));
    }).sort((a, b) => a.due.localeCompare(b.due) || a.action.id.localeCompare(b.action.id)).slice(0, 3);
    if (!actions.length)
        return null;
    return <section className="mb-6 rounded-2xl border border-border bg-card p-4 sm:p-5"><h3 className="mb-3 flex items-center gap-2 font-semibold"><BookOpen className="h-4 w-4 text-primary"/>{c.actions}</h3><div className="space-y-2">{actions.map(({ action, course, due }) => <button type="button" key={action.id} className="flex w-full min-w-0 items-center gap-3 rounded-xl bg-muted/40 p-3 text-left hover:bg-muted focus-visible:ring-2 focus-visible:ring-primary" onClick={() => window.dispatchEvent(new CustomEvent('muster:open-study-guide', { detail: course.id }))}><div className="min-w-0 flex-1"><p className="text-sm font-medium [overflow-wrap:anywhere]">{action.title}</p><p className="mt-1 text-xs text-muted-foreground">{course.shortName} · {new Intl.DateTimeFormat(state.settings.language, { timeZone: timezone, dateStyle: 'medium', timeStyle: 'short' }).format(new Date(due))}</p></div><ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground"/></button>)}</div></section>;
}
