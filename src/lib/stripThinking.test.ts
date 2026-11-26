import { expect, it } from 'vitest';
import { stripThinking } from './aiStructured';
import { runQuickAnswer } from '../services/quickAnswer';

it('removes reasoning a model wrote inline before its answer', () => {
    expect(stripThinking('<think>The user wants a plan… let me count weeks.</think>\n\n本周先完成作业 2。')).toBe('本周先完成作业 2。');
    expect(stripThinking('Answer <thinking>scratch</thinking>stays.')).toBe('Answer stays.');
});

it('hides a reasoning block that is still streaming', () => {
    expect(stripThinking('<think>Still working out the ord')).toBe('');
    expect(stripThinking('Part one. <think>half')).toBe('Part one. ');
});

it('leaves ordinary answers alone', () => {
    expect(stripThinking('Compare a < b and think about it.')).toBe('Compare a < b and think about it.');
});

it('quick actions parse the answer after the reasoning, never the reasoning itself', async () => {
    const evidence = {
        available: true as const,
        sources: [{ id: '10:unit:3', courseId: 10, kind: 'unit' as const, title: 'Assessment tasks', excerpt: 'Submit a report.', locator: '', coverage: 'body' as const, week: null, contentHash: 'h' }],
        prompt: 'TASK x', inputHash: 'hash',
    };
    const reasoning = '<think>Maybe I should say 42 marks and cite <!--MUSTER_JSON {"schemaVersion":1,"points":[{"text":"Bogus 42","sourceIds":["10:unit:3"]}]} --></think>';
    const answer = 'Done.\n<!--MUSTER_JSON {"schemaVersion":1,"points":[{"text":"Submit a report.","sourceIds":["10:unit:3"],"action":true}]} -->';
    const run = await runQuickAnswer('k', 'brief', evidence, { apiKey: 'k', apiUrl: 'u', model: 'm' }, undefined, async (_c, _k, _u, _m, _mode, cb) => { cb.onChunk(reasoning + answer); cb.onDone(); });
    expect(run.answer?.points.map(p => p.text)).toEqual(['Submit a report.']);
});
