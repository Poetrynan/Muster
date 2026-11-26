import { expect, it } from 'vitest';
import { assessmentKeys, buildQuickAnswer, quickKey, selectQuickEvidence, unitExams, validateQuickAnswer } from './quick';
import type { GuideScope, SourceRecord } from './types';

const scope: GuideScope = { accountScope: 'acct', courseId: 10, weekId: '2026-11-23', selectedWeek: 9, localDate: '2026-11-26', timezone: 'UTC', now: '2026-11-26T00:00:00Z', language: 'en', model: 'm', availableMinutes: 120 };
const src = (kind: SourceRecord['kind'], id: string, title: string, excerpt: string, extra: Partial<SourceRecord> = {}): SourceRecord =>
    ({ id: `10:${kind}:${id}`, courseId: 10, kind, title, excerpt, locator: title, coverage: kind === 'resource' ? 'title-only' : 'body', week: null, contentHash: id, ...extra });

const all: SourceRecord[] = [
    src('announcement', '1', 'Room change', 'Week 9 tutorial moves to room G12.'),
    src('announcement', '2', 'Old news', 'Enrolment opened.'),
    src('schedule', '0', 'Week 9 - Containers', 'Topics: Docker, ECS. Read chapter 4.'),
    src('resource', 'r1', 'Lecture 9 slides', 'Lecture 9 slides', { week: 9 }),
    src('unit', '3', 'Assessment tasks', 'Assessment 3: Group Project Report. Teams of 4 submit a 3000-word report and a demo video.'),
];
const announcements = [
    { id: 1, courseId: 10, title: 'Room change', content: '', date: '2026-11-24T09:00:00Z' },
    { id: 2, courseId: 10, title: 'Old news', content: '', date: '2026-09-01T09:00:00Z' },
] as never[];

it('only sends announcements from the last two weeks', () => {
    const ev = selectQuickEvidence('announcements', scope, all, announcements);
    expect(ev.available && ev.sources.map(s => s.id)).toEqual(['10:announcement:1']);
});

it('asks for actionable announcement changes and ignores future notices', () => {
    const tomorrow = src('announcement', '3', 'Future notice', 'Another room change.');
    const dates = [...announcements, { id: 3, courseId: 10, title: tomorrow.title, author: 'Tutor', content: '', date: '2026-11-27T09:00:00Z' }];
    const ev = selectQuickEvidence('announcements', scope, [...all, tomorrow], dates);
    expect(ev.available && ev.sources.map(s => s.id)).toEqual(['10:announcement:1']);
    expect(ev.available && ev.prompt).toContain('Omit routine reminders');
});

it('explains an assessment only when Unit Info names it', () => {
    expect(assessmentKeys('Assessment 3: Group Project Report (Group Score: 40%)')).toContain('assessment 3');
    const found = selectQuickEvidence('brief', scope, all, announcements, { name: 'Assessment 3: Group Project Report (40%)' } as never);
    expect(found.available && found.sources.map(s => s.id)).toEqual(['10:unit:3']);
    expect(selectQuickEvidence('brief', scope, all, announcements, { name: 'Quiz 7: Bonus' } as never)).toEqual({ available: false, reason: 'noBrief' });
    // A one-word title ("Containers") must not match a week's topic text.
    expect(assessmentKeys('Quiz 4: Containers')).toEqual(['quiz 4', 'quiz 4: containers']);
    expect(selectQuickEvidence('brief', scope, all, announcements, { name: 'Quiz 4: Containers' } as never)).toEqual({ available: false, reason: 'noBrief' });
});

it('prefers the assessment\'s own description for its requirements', () => {
    const target = { id: 9, name: 'Quiz 4: Containers', description: 'Answer 10 multiple-choice questions in 30 minutes.', url: 'https://learning.monash.edu/mod/quiz/view.php?id=9' } as never;
    const ev = selectQuickEvidence('brief', scope, all, announcements, target);
    expect(ev.available && ev.sources.map(s => s.id)).toEqual(['10:assessmentText:9']);
    expect(ev.available && ev.sources[0].url).toContain('quiz/view.php');
});

it('reads only this unit\'s written feedback', () => {
    const gradebook = [
        { courseId: 10, item: 'Assignment 1', grade: '16.00', range: '0–20', feedback: '<p>Good structure; cite more sources.</p>' },
        { courseId: 10, item: 'Quiz 1', grade: '8.00', range: '0–10', feedback: '' },
        { courseId: 11, item: 'Other unit', grade: '5', range: '0–10', feedback: 'Elsewhere.' },
    ];
    const ev = selectQuickEvidence('feedback', scope, all, announcements, undefined, { gradebook });
    expect(ev.available && ev.sources.map(s => s.title)).toEqual(['Assignment 1']);
    expect(ev.available && ev.sources[0].excerpt).toBe('Good structure; cite more sources.');
    expect(selectQuickEvidence('feedback', scope, all, announcements, undefined, { gradebook: [] })).toEqual({ available: false, reason: 'noFeedback' });
});

it('drops points without valid sources or with numbers the sources do not contain', () => {
    const sources = [all[4]];
    const { points, rejected } = validateQuickAnswer({ schemaVersion: 1, points: [
        { text: 'Teams of 4 submit a 3000-word report.', sourceIds: ['10:unit:3'], action: true },
        { text: 'It is worth 40% of the unit.', sourceIds: ['10:unit:3'] },
        { text: 'Submit a demo video.', sourceIds: ['10:unit:99'] },
        { text: 'No source.', sourceIds: [] },
    ] }, sources);
    expect(points).toEqual([{ text: 'Teams of 4 submit a 3000-word report.', sourceIds: ['10:unit:3'], action: true }]);
    expect(rejected).toBe(3);
    expect(validateQuickAnswer(null, sources)).toEqual({ points: [], rejected: 1 });
});

it('builds a cached answer that keeps only the cited sources', () => {
    const ev = selectQuickEvidence('brief', scope, all, announcements, { name: 'Assessment 3: Group Project Report' } as never);
    if (!ev.available) throw new Error('expected evidence');
    const out = 'Short answer.\n<!--MUSTER_JSON {"schemaVersion":1,"points":[{"text":"Submit a demo video.","sourceIds":["10:unit:3"],"action":true}]} -->';
    const answer = buildQuickAnswer(quickKey(scope, 'brief', 7), 'brief', ev, 'm', out);
    expect(answer.points).toHaveLength(1);
    expect(answer.sources.map(s => s.id)).toEqual(['10:unit:3']);
    expect(answer.inputHash).toBe(ev.inputHash);
});

it('finds this unit\'s exams by id or unit code', () => {
    const exams = [{ id: 'a', courseCode: 'FIT5225_S2', courseName: '', examType: '', date: '2026-11-30', startTime: '', endTime: '', location: '' }, { id: 'b', courseCode: 'FIT9999', courseName: '', examType: '', date: '', startTime: '', endTime: '', location: '' }];
    expect(unitExams(exams, 10, 'FIT5225').map(e => e.id)).toEqual(['a']);
});
