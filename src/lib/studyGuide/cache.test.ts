import { expect, it } from 'vitest';
import { restoreGuides, restoreProgress } from './cache';
import { scope } from './fixtures';
import { guideKey } from './sources';
const a = { schemaVersion: 1, promptVersion: 'arrangements-1', key: guideKey(scope), scope, inputHash: 'x', generatedAt: '2026-11-08T00:00:00Z', status: 'text-only', markdown: 'Readable guide', cards: [], includedSourceIds: [], omittedSourceIds: [], warnings: 0 };
it('restores only readable current-schema artifacts owned by the cache account', () => {
    expect(Object.keys(restoreGuides({ [a.key]: a }, scope.accountScope))).toEqual([a.key]);
    expect(restoreGuides({ [a.key]: a }, 'other')).toEqual({});
    for (const altered of [{ ...a, schemaVersion: 9 }, { ...a, cards: [null] }, { ...a, generatedAt: 'invalid' }, { ...a, scope: null }, { ...a, key: 'wrong' }])
        expect(restoreGuides({ [a.key]: altered }, scope.accountScope)).toEqual({});
});
it('is an idempotent additive migration and accepts missing guide cache', () => { expect(restoreGuides(undefined, scope.accountScope)).toEqual({}); const once = restoreGuides({ [a.key]: a }, scope.accountScope); expect(restoreGuides(once, scope.accountScope)).toEqual(once); });
it('drops malformed personal progress and foreign scope keys', () => { expect(restoreProgress({ [a.key]: { a: null, b: { done: true, text: 'mine' }, c: { done: 'yes' } } }, scope.accountScope)).toEqual({ [a.key]: { b: { done: true, text: 'mine' } } }); expect(restoreProgress({ foreign: { task: { done: true } } }, scope.accountScope)).toEqual({}); });
it('downgrades an invalid verified cached deadline and removes orphan references', () => { const source = { id: '10:assignment:4', title: 'Project', excerpt: 'Project', contentHash: 'x', courseId: 10, kind: 'assignment', locator: 'Project', coverage: 'body', week: null }; const cached = { ...a, sources: [source], facts: [{ id: '10:assignment:4:dueAt', sourceIds: [source.id], field: 'dueAt', status: 'verified', value: 'not-a-date' }, { id: 'foreign', sourceIds: ['foreign'], field: 'grade', status: 'verified', value: '100' }] }; const restored = restoreGuides({ [a.key]: cached }, scope.accountScope)[a.key]; expect(restored.markdown).toBe('Readable guide'); expect(restored.facts).toHaveLength(1); expect(restored.facts![0].status).toBe('unknown'); });
