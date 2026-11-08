import type { GuideScope, GuideSnapshot, SourceRecord, SourceSelection } from './types';
import { GUIDE_PROMPT, GUIDE_SCHEMA } from './types';
export function fingerprint(value: unknown): string {
    const canonical = (v: unknown): unknown => Array.isArray(v) ? v.map(canonical) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)).map(([k, val]) => [k, canonical(val)])) : v;
    const input = JSON.stringify(canonical(value));
    let h = 2166136261;
    for (let i = 0; i < input.length; i++) {
        h ^= input.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    return (h >>> 0).toString(16).padStart(8, '0');
}
export const accountScope = (email: string) => fingerprint(email.trim().toLowerCase());
export const guideKey = (s: GuideScope) => JSON.stringify([s.accountScope, s.courseId, s.weekId, s.selectedWeek, GUIDE_SCHEMA]);
export function weekStart(date: string): string {
    const day = new Date(date + 'T12:00:00Z');
    day.setUTCDate(day.getUTCDate() - (day.getUTCDay() + 6) % 7);
    return day.toISOString().slice(0, 10);
}
export function shiftDate(date: string, days: number): string { const d = new Date(date + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10); }
export function localDay(now: Date, timezone: string): string {
    const p = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
    return ['year', 'month', 'day'].map(k => p.find(v => v.type === k)?.value).join('-');
}
export function textOnly(html: string): string { return String(html ?? '').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/\s+/g, ' ').trim(); }
export function safeSourceUrl(value?: string): string | undefined {
    try {
        const u = new URL(value ?? '');
        return ['https:', 'http:'].includes(u.protocol) ? u.href : undefined;
    }
    catch {
        return undefined;
    }
}
const weekOf = (title: string) => { const n = /\bweek\s*(\d{1,2})\b/i.exec(title); return n ? Number(n[1]) : null; };
export function selectGuideSources(snapshot: GuideSnapshot, scope: GuideScope): SourceSelection {
    const included: SourceRecord[] = [], excluded: SourceRecord[] = [];
    const add = (kind: SourceRecord['kind'], id: string | number, title: string, body: string, options: Partial<SourceRecord> = {}, use = true) => {
        const record: SourceRecord = { id: `${scope.courseId}:${kind}:${id}`, courseId: scope.courseId, kind, title, excerpt: textOnly(body), locator: `${kind}: ${title}`, coverage: kind === 'resource' ? 'title-only' : 'body', week: null, ...options, contentHash: fingerprint([title, body, options]), syncedAt: snapshot.syncedAt };
        record.url = safeSourceUrl(record.url);
        (use ? included : excluded).push(record);
    };
    for (const r of snapshot.resources.filter(r => r.courseId === scope.courseId)) {
        const week = r.weekNum ?? weekOf(r.section ?? '');
        add('resource', r.id, r.name, r.name, { week, url: r.url, locator: r.section || r.name }, scope.selectedWeek == null || week == null || week === scope.selectedWeek);
    }
    for (const a of snapshot.assignments.filter(a => a.courseId === scope.courseId && !a.isCategory))
        add('assignment', a.id, a.name, [a.status, a.dueDateIso || a.dueDate, a.grade, a.gradeMax != null ? `Maximum: ${a.gradeMax}` : '', a.weight != null ? `Weight: ${a.weight}%` : '', a.category].filter(v => v != null && v !== '').join(' · '), { url: a.url, assignment: a });
    const start = Date.parse(scope.weekId + 'T00:00:00Z') - 7 * 86400000, end = start + 21 * 86400000;
    for (const a of snapshot.announcements.filter(a => a.courseId === scope.courseId)) {
        const date = Date.parse(a.date), week = weekOf(a.title + ' ' + textOnly(a.content));
        const linked = snapshot.assignments.some(t => t.courseId === scope.courseId && t.name.length > 3 && (a.title + ' ' + a.content).toLowerCase().includes(t.name.toLowerCase()));
        add('announcement', a.id, a.title, a.content, { url: a.url, week, locator: `${a.date} · ${a.title}` }, (date >= start && date < end) || (scope.selectedWeek != null && week === scope.selectedWeek) || linked || !Number.isFinite(date));
    }
    for (const e of snapshot.events.filter(e => e.courseId === scope.courseId && e.eventType !== 'open' && e.timestamp > 0))
        add('event', e.id, e.title, new Date(e.timestamp * 1000).toISOString(), { url: e.url, event: e });
    if (snapshot.unitInfo?.courseId === scope.courseId)
        for (const [i, s] of snapshot.unitInfo.sections.entries())
            add('unit', i, s.title, s.contentHtml);
    if (snapshot.schedule?.courseId === scope.courseId)
        for (const [i, s] of snapshot.schedule.items.entries())
            add('schedule', i, s.title, s.contentHtml);
    included.sort((a, b) => a.id.localeCompare(b.id));
    excluded.sort((a, b) => a.id.localeCompare(b.id));
    const { now: _, ...stableScope } = scope;
    void _;
    return { included, excluded, coverage: { body: included.filter(s => s.coverage === 'body').length, titleOnly: included.filter(s => s.coverage === 'title-only').length, unknownWeek: included.filter(s => s.kind === 'resource' && s.week == null).length }, inputHash: fingerprint([stableScope, GUIDE_SCHEMA, GUIDE_PROMPT, included.map(s => [s.id, s.contentHash]), excluded.map(s => [s.id, s.contentHash])]) };
}
