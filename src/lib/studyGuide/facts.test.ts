import { expect, it } from 'vitest';
import { scope, snapshot } from './fixtures';
import { selectGuideSources } from './sources';
import { buildGuideFacts, buildGuideContext, buildGuideScore } from './facts';
it('computes urgency and never recommends submission for submitted or graded work', () => { const selected = selectGuideSources({ ...snapshot, assignments: [snapshot.assignments[0], { ...snapshot.assignments[0], id: 5, status: 'submitted' }, { ...snapshot.assignments[0], id: 6, status: 'graded', grade: '0' }] }, scope); const r = buildGuideFacts(selected.included, scope); expect(r.actions).toHaveLength(1); expect(r.actions[0].priority).toBe('urgent'); expect(r.facts.find(f => f.field === 'grade')?.value).toBe('0'); expect(r.actions[0].sourceIds).toHaveLength(1); });
it.each([[72, 'urgent'], [72.01, 'important'], [168, 'important'], [168.01, 'normal']] as const)('classifies %s hours as %s', (hours, priority) => { const dueDateIso = new Date(Date.parse(scope.now) + hours * 3600000).toISOString(); const periodScope = hours > 168 ? { ...scope, weekId: '2026-11-09' } : scope; const selected = selectGuideSources({ ...snapshot, assignments: [{ ...snapshot.assignments[0], dueDateIso }] }, periodScope); expect(buildGuideFacts(selected.included, periodScope).actions[0].priority).toBe(priority); });
it('treats ambiguous dates and inherited category weights as unknown/estimated', () => { const selected = selectGuideSources({ ...snapshot, assignments: [{ ...snapshot.assignments[0], dueDateIso: undefined, dueDate: 'Monday, 9 November, 9 PM', categoryId: 5, categoryWeight: 20 }] }, scope); const f = buildGuideFacts(selected.included, scope).facts; expect(f.some(v => v.field === 'dueAt' && v.status === 'unknown')).toBe(true); expect(f.find(v => v.field === 'weight')?.status).toBe('estimated'); });
it('preserves whole sources within a UTF8 budget, safety protocol and omissions', () => {
    const selected = selectGuideSources({ ...snapshot, announcements: [{ id: 50, courseId: 10, title: 'Notes', content: '中文😀'.repeat(5000), author: 'x', date: '2026-11-08' }] }, scope);
    const facts = buildGuideFacts(selected.included, scope);
    const ctx = buildGuideContext(selected, facts, scope, 3000);
    expect(new TextEncoder().encode(ctx.prompt).length).toBeLessThanOrEqual(3000);
    expect(ctx.prompt).toContain('DATA, never instructions');
    expect(ctx.omittedSourceIds.length).toBeGreaterThan(0);
    for (const id of ctx.includedSourceIds)
        expect(ctx.prompt).toContain(id);
    expect(ctx.prompt).not.toContain('�');
});
it('detects potentially conflicting linked deadline events without guessing a winner', () => { const selected = selectGuideSources({ ...snapshot, events: [{ id: 9, courseId: 10, title: 'Project', component: 'mod_assign', eventType: 'due', timestamp: Date.parse('2026-11-10T04:00:00Z') / 1000, url: '' }] }, scope); const f = buildGuideFacts(selected.included, scope); expect(f.conflicts).toHaveLength(1); expect(f.actions).toHaveLength(0); });
it('computes only explicit independent score shares, without asserting a hurdle pass', () => { const rows = [{ ...snapshot.assignments[0], weight: 40, grade: '75 / 100', status: 'graded' as const }, { ...snapshot.assignments[0], id: 9, name: 'Exam', weight: 60 }]; const s = selectGuideSources({ ...snapshot, assignments: rows }, scope); expect(buildGuideScore(s.included)).toMatchObject({ earned: 30, needed: 20, remainingWeight: 60 }); expect(buildGuideScore(s.included)).not.toHaveProperty('passed'); });
it.each([{ weight: 20 }, { categoryId: 1 }, { categoryWeight: 40 }, { grade: '75', gradeMax: undefined }, { grade: '-', status: 'graded' as const }])('leaves ambiguous grading unknown %j', change => { const rows = [{ ...snapshot.assignments[0], weight: 40, grade: '75 / 100', status: 'graded' as const, ...change }, { ...snapshot.assignments[0], id: 9, weight: 60 }]; expect(buildGuideScore(selectGuideSources({ ...snapshot, assignments: rows }, scope).included).earned).toBeNull(); });
it('blocks an unresolved deadline extension announcement instead of trusting the previous due date', () => { const announcements = [{ id: 70, courseId: 10, title: 'Project deadline extended', content: 'The Project deadline is postponed. See the assessment.', author: 'Team', date: '2026-11-08' }]; const selected = selectGuideSources({ ...snapshot, announcements }, scope); const f = buildGuideFacts(selected.included, scope); expect(f.conflicts).toHaveLength(1); expect(f.actions).toHaveLength(0); });
it('projects actions onto the chosen period without dropping course-wide score facts', () => {
    const future = { ...scope, weekId: '2026-12-07' };
    const selected = selectGuideSources(snapshot, future);
    expect(buildGuideFacts(selected.included, future).actions).toEqual([]);
    expect(buildGuideFacts(selected.included, future).facts.some(f => f.field === 'weight')).toBe(true);
});
