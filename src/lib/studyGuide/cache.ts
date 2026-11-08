import type { GuideArtifact, GuideProgress, FactRecord } from './types';
import { GUIDE_SCHEMA } from './types';
import { guideKey } from './sources';
import { verifiedDate } from './facts';
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const strings = (v: unknown) => Array.isArray(v) && v.every(i => typeof i === 'string');
const cardValid = (c: unknown) => object(c) && typeof c.id === 'string' && typeof c.title === 'string' && ['action', 'plan'].includes(String(c.kind)) && strings(c.sourceIds) && strings(c.factIds) && (c.explanation == null || typeof c.explanation === 'string') && (c.suggestedMinutes == null || (typeof c.suggestedMinutes === 'number' && Number.isFinite(c.suggestedMinutes)));
/** Old summaries/plans remain in their original cache; they are never silently promoted. */
export function restoreGuides(raw: unknown, owner: string): Record<string, GuideArtifact> {
    if (!object(raw))
        return {};
    const restored: Record<string, GuideArtifact> = {};
    for (const [key, value] of Object.entries(raw)) {
        if (!object(value) || value.schemaVersion !== GUIDE_SCHEMA || !object(value.scope) || value.scope.accountScope !== owner || typeof value.scope.courseId !== 'number' || typeof value.scope.weekId !== 'string' || typeof value.generatedAt !== 'string' || !Number.isFinite(Date.parse(value.generatedAt)) || typeof value.markdown !== 'string' || !['ready', 'text-only'].includes(String(value.status)) || !strings(value.includedSourceIds) || !strings(value.omittedSourceIds) || !Array.isArray(value.cards) || typeof value.inputHash !== 'string')
            continue;
        const a = value as unknown as GuideArtifact;
        if (a.key !== key || key !== guideKey(a.scope) || a.cards.some(c => !cardValid(c)) || typeof a.scope.model !== 'string' || typeof a.scope.language !== 'string' || typeof a.scope.timezone !== 'string')
            continue;
        if (a.sources && (!Array.isArray(a.sources) || a.sources.some(s => !object(s) || typeof s.id !== 'string' || !s.id.startsWith(`${a.scope.courseId}:`) || s.courseId!==a.scope.courseId || typeof s.title !== 'string' || typeof s.excerpt !== 'string' || typeof s.contentHash !== 'string' || typeof s.locator!=='string' || !['body','title-only'].includes(s.coverage))))
            continue;
        if (a.facts && (!Array.isArray(a.facts) || a.facts.some(f => !object(f) || typeof f.id !== 'string' || !strings(f.sourceIds) || !['dueAt', 'status', 'grade', 'weight', 'remainingHours'].includes(f.field) || !['string', 'number'].includes(typeof f.value))))
            continue;
        const facts = (a.facts ?? []).filter(f => f.sourceIds.length > 0 && f.sourceIds.every(id => a.sources?.some(s => s.id === id)) && f.id === `${f.sourceIds[0]}:${f.field}`).map(f => {
            let status: FactRecord['status'] = ['verified', 'estimated', 'unknown', 'conflicting'].includes(f.status) ? f.status : 'unknown';
            if (f.field === 'dueAt' && !verifiedDate(String(f.value)))
                status = 'unknown';
            if (f.field === 'status' && !['pending', 'upcoming', 'submitted', 'graded'].includes(String(f.value)))
                status = 'unknown';
            if (['weight', 'remainingHours'].includes(f.field) && (typeof f.value !== 'number' || !Number.isFinite(f.value)))
                status = 'unknown';
            if (f.field === 'weight' && typeof f.value === 'number' && (f.value < 0 || f.value > 100))
                status = 'unknown';
            return { ...f, status };
        });
        const cards=a.cards.filter(c=>c.sourceIds.length>0&&c.sourceIds.every(id=>a.sources?.some(s=>s.id===id))).map(c=>({...c,factIds:c.factIds.filter(id=>facts.some(f=>f.id===id))}));
        if(!cards.length&&!a.markdown.trim())continue;
        restored[key] = { ...a, facts, cards };
    }
    return restored;
}
export function restoreProgress(raw: unknown, owner: string): Record<string, Record<string, GuideProgress>> {
    if (!object(raw))
        return {};
    const restored: Record<string, Record<string, GuideProgress>> = {};
    for (const [key, entries] of Object.entries(raw)) {
        try {
            if (JSON.parse(key)[0] !== owner || !object(entries))
                continue;
        }
        catch {
            continue;
        }
        const good = Object.entries(entries).filter(([, p]) => object(p) && (p.done == null || typeof p.done === 'boolean') && (p.text == null || typeof p.text === 'string') && (p.card == null || cardValid(p.card)));
        if (good.length)
            restored[key] = Object.fromEntries(good) as Record<string, GuideProgress>;
    }
    return restored;
}
