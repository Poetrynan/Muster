import { expect, it } from 'vitest';
import { extensionEmail, gradeTargets, groupByDay, pickRecipients } from './assistant';

it('works out the average needed for each grade band', () => {
    const t = gradeTargets(42, 50);
    expect(t.map(x => [x.label, x.status, x.neededAverage])).toEqual([
        ['P', 'possible', 16], ['C', 'possible', 36], ['D', 'possible', 56], ['HD', 'possible', 76],
    ]);
    expect(gradeTargets(65, 10).map(x => x.status)).toEqual(['secured', 'secured', 'possible', 'impossible']);
    expect(gradeTargets(40, 0)[0].status).toBe('impossible');
});

it('flags days with two or more deadlines as clashes', () => {
    const days = groupByDay([
        { id: 'a', due: '2026-11-25T13:00:00Z' },
        { id: 'b', due: '2026-11-25T06:00:00Z' },
        { id: 'c', due: '2026-11-27T06:00:00Z' },
        { id: 'x', due: 'not a date' },
    ], 'Australia/Melbourne');
    expect(days.map(d => [d.day, d.items.map(i => i.id), d.clash])).toEqual([
        ['2026-11-25', ['b'], false],
        ['2026-11-26', ['a'], false],
        ['2026-11-27', ['c'], false],
    ]);
    expect(groupByDay([{ id: 'a', due: '2026-11-25T01:00:00Z' }, { id: 'b', due: '2026-11-25T05:00:00Z' }], 'UTC')[0].clash).toBe(true);
});

it('writes to the chief examiner first', () => {
    const contacts = [
        { name: 'Sam Tutor', role: 'Tutor', email: 'sam@example.test' },
        { name: 'Alex Lee', role: 'Chief Examiner', email: 'alex@example.test' },
        { name: 'No Mail', role: 'Chief Examiner', email: '' },
    ];
    expect(pickRecipients(contacts).map(c => c.name)).toEqual(['Alex Lee']);
});

it('drafts an extension email from synced facts, leaving the reason to the student', () => {
    const mail = extensionEmail({
        unitCode: 'FIT5225',
        assignment: { id: 2, name: 'Assignment 2: Cloud Deployment', courseId: 10, status: 'pending', dueDateIso: '2026-11-28T12:55:00Z' },
        recipients: [{ name: 'Alex Lee', role: 'Chief Examiner', email: 'alex@example.test' }],
        studentName: 'Sample Student',
        studentEmail: 'abcd0001@student.monash.edu',
        timezone: 'Australia/Melbourne',
    });
    expect(mail.to).toBe('alex@example.test');
    expect(mail.subject).toBe('FIT5225 – Extension request: Assignment 2: Cloud Deployment');
    expect(mail.body).toContain('Dear Alex,');
    expect(mail.body).toContain('currently due Saturday, 28 November 2026');
    expect(mail.body.split('\n\n').length).toBeGreaterThan(3);
    expect(mail.body).toContain('[Briefly explain the reason');
    expect(mail.body).toContain('Student ID / username: abcd0001');
});
