import type { Assignment, CourseContact } from '../../services/api';

/**
 * Program-computed AI Assistant features. None of these call an AI model, so none of them
 * can hallucinate: they only rearrange numbers and text already synced from Moodle.
 */

export const GRADE_TARGETS = [
    { mark: 50, label: 'P' },
    { mark: 60, label: 'C' },
    { mark: 70, label: 'D' },
    { mark: 80, label: 'HD' },
] as const;

export interface GradeTarget {
    mark: number;
    label: string;
    /** Average percentage needed on the unmarked weight; null when already secured or impossible. */
    neededAverage: number | null;
    status: 'secured' | 'possible' | 'impossible';
}

/**
 * What average the remaining assessments need for each grade band. Arithmetic on the
 * confirmed weighted marks only; it says nothing about hurdles or scaling.
 */
export function gradeTargets(earned: number, remainingWeight: number): GradeTarget[] {
    return GRADE_TARGETS.map(({ mark, label }) => {
        const gap = mark - earned;
        if (gap <= 0) return { mark, label, neededAverage: null, status: 'secured' as const };
        if (remainingWeight <= 0) return { mark, label, neededAverage: null, status: 'impossible' as const };
        const needed = (gap / remainingWeight) * 100;
        if (needed > 100) return { mark, label, neededAverage: null, status: 'impossible' as const };
        // Round up to 0.1 so the target is never understated; the epsilon absorbs float noise (56.000000001).
        return { mark, label, neededAverage: Math.ceil(needed * 10 - 1e-9) / 10, status: 'possible' as const };
    });
}

export interface DatedItem {
    id: string;
    due: string;
}

/** Calendar day (YYYY-MM-DD) of an instant in a timezone. */
export function dayIn(iso: string, timezone: string): string | null {
    const at = new Date(iso);
    if (!Number.isFinite(at.getTime())) return null;
    const p = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(at);
    return ['year', 'month', 'day'].map(k => p.find(v => v.type === k)?.value).join('-');
}

/** Group items by local day; a day with two or more deadlines is a clash. */
export function groupByDay<T extends DatedItem>(items: T[], timezone: string): { day: string; items: T[]; clash: boolean }[] {
    const days = new Map<string, T[]>();
    for (const item of items) {
        const day = dayIn(item.due, timezone);
        if (!day) continue;
        days.set(day, [...(days.get(day) ?? []), item]);
    }
    return [...days.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([day, list]) => ({ day, items: list.sort((a, b) => a.due.localeCompare(b.due)), clash: list.length >= 2 }));
}

/** Who to write to about an assessment: the chief examiner / coordinator first. */
export function pickRecipients(contacts: CourseContact[]): CourseContact[] {
    const rank = (role: string) => /chief examiner/i.test(role) ? 0 : /coordinator/i.test(role) ? 1 : /lecturer|teacher|instructor/i.test(role) ? 2 : 3;
    const withEmail = contacts.filter(c => /@/.test(c.email));
    const sorted = [...withEmail].sort((a, b) => rank(a.role) - rank(b.role));
    const best = sorted.length ? rank(sorted[0].role) : 3;
    return sorted.filter(c => rank(c.role) === best).slice(0, 2);
}

export const SPECIAL_CONSIDERATION_URL = 'https://www.monash.edu/students/admin/assessments/extensions-special-consideration';

/**
 * A plain extension-request email the student edits and sends themselves. Staff email is in
 * English, so the draft is English whatever the interface language. Only synced facts are
 * filled in; the reason is left as a placeholder for the student.
 */
export function extensionEmail(input: {
    unitCode: string;
    assignment: Assignment;
    recipients: CourseContact[];
    studentName: string;
    studentEmail: string;
    timezone: string;
}): { to: string; subject: string; body: string } {
    const { unitCode, assignment, recipients, studentName, studentEmail, timezone } = input;
    const dueIso = assignment.dueDateIso;
    const due = dueIso && Number.isFinite(Date.parse(dueIso))
        ? new Intl.DateTimeFormat('en-AU', { timeZone: timezone, dateStyle: 'full', timeStyle: 'short' }).format(new Date(dueIso))
        : assignment.dueDate || '';
    const greeting = recipients.length ? `Dear ${recipients.map(r => r.name.split(/\s+/)[0]).join(' and ')},` : 'Dear teaching team,';
    const studentId = studentEmail.split('@')[0];
    const body = [
        greeting,
        '',
        `I am writing to request an extension for ${assignment.name} in ${unitCode}${due ? `, currently due ${due}` : ''}.`,
        '',
        '[Briefly explain the reason and how long you need.]',
        '',
        'I can provide supporting documentation if required. Please let me know if I should apply through Special Consideration instead.',
        '',
        'Kind regards,',
        studentName,
        studentId ? `Student ID / username: ${studentId}` : '',
    ].filter((line, i, all) => !(line === '' && all[i - 1] === '')).join('\n').trim();
    return {
        to: recipients.map(r => r.email).join(', '),
        subject: `${unitCode} – Extension request: ${assignment.name}`,
        body,
    };
}
