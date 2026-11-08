import type { GuideCard, GuideContext, GuideFacts, GuideScope, SourceRecord } from './types';
import { stripPartialAppendix, extractMusterPayload } from '../aiStructured';
import { guideKey } from './sources';
export function parseGuideOutput(text: string): {
    markdown: string;
    payload: unknown;
} {
    return { markdown: stripPartialAppendix(text).trim(), payload: extractMusterPayload(text) };
}
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const strings = (v: unknown): v is string[] => Array.isArray(v) && v.every(s => typeof s === 'string');
export function validateGuide(raw: unknown, facts: GuideFacts, sources: SourceRecord[], ctx: GuideContext, scope: GuideScope): {
    cards: GuideCard[];
    rejected: number;
} {
    if (!record(raw) || raw.schemaVersion !== 1 || !Array.isArray(raw.cards))
        return { cards: [], rejected: 1 };
    const allowedKeys = new Set(['kind', 'title', 'explanation', 'sourceIds', 'factIds', 'suggestedMinutes']);
    const sourceMap = new Map(sources.map(s => [s.id, s]));
    const cards: GuideCard[] = [];
    let rejected = 0, minutes = 0;
    for (const c of raw.cards.slice(0, 20)) {
        if (!record(c) || Object.keys(c).some(k => !allowedKeys.has(k)) || !['action', 'plan'].includes(String(c.kind)) || typeof c.title !== 'string' || !c.title.trim() || c.title.length > 200 || !strings(c.sourceIds) || !c.sourceIds.length || !strings(c.factIds) || c.sourceIds.some(id => !sourceMap.has(id) || !ctx.includedSourceIds.includes(id)) || c.factIds.some(id => !facts.facts.some(f => f.id === id && f.status === 'verified' && f.sourceIds.every(s => c.sourceIds instanceof Array && c.sourceIds.includes(s))))) {
            rejected++;
            continue;
        }
        if (c.explanation != null && (typeof c.explanation !== 'string' || c.explanation.length > 800)) {
            rejected++;
            continue;
        }
        const sourceIds = [...new Set(c.sourceIds)].sort(), factIds = [...new Set(c.factIds)].sort();
        // Free prose cannot safely associate a number with its field. Facts are rendered
        // separately by factId; only exact source titles may carry numeric identifiers.
        let prose = c.title + ' ' + (c.explanation ?? '');
        for (const id of sourceIds)
            prose = prose.split(sourceMap.get(id)!.title).join('');
        if (/\d/.test(prose)) {
            rejected++;
            continue;
        }
        if (c.kind === 'plan' && sourceIds.some(id => { const s = sourceMap.get(id)!; return (s.kind === 'assignment' || s.kind === 'event') && !facts.actions.some(a => a.sourceIds.includes(id)); })) {
            rejected++;
            continue;
        }
        if (c.kind === 'action' && !facts.actions.some(a => a.sourceIds.some(s => sourceIds.includes(s)))) {
            rejected++;
            continue;
        }
        const duration = c.suggestedMinutes;
        if (duration != null && (typeof duration !== 'number' || !Number.isInteger(duration) || duration <= 0 || duration > scope.availableMinutes || minutes + duration > scope.availableMinutes)) {
            rejected++;
            continue;
        }
        if (c.kind === 'plan' && duration == null) {
            rejected++;
            continue;
        }
        const id = `${guideKey(scope)}:${c.kind}:${sourceIds.join('|')}`;
        if (cards.some(c => c.id === id)) {
            rejected++;
            continue;
        }
        if (c.kind === 'action' && cards.filter(c => c.kind === 'action').length >= 3) {
            rejected++;
            continue;
        }
        minutes += typeof duration === 'number' ? duration : 0;
        cards.push({ id, kind: c.kind as GuideCard['kind'], title: c.title.trim(), explanation: c.explanation as string | undefined, sourceIds, factIds, suggestedMinutes: duration as number | undefined, origin: 'ai' });
    }
    return { cards, rejected };
}
