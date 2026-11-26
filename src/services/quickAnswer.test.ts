import { expect, it } from 'vitest';
import { runQuickAnswer } from './quickAnswer';

const evidence = {
    available: true as const,
    sources: [{ id: '10:unit:3', courseId: 10, kind: 'unit' as const, title: 'Assessment tasks', excerpt: 'Submit a 3000-word report.', locator: '', coverage: 'body' as const, week: null, contentHash: 'h' }],
    prompt: 'TASK x',
    inputHash: 'hash',
};
const ai = { apiKey: 'k', apiUrl: 'u', model: 'm' };

it('sends the fixed prompt in brief mode and keeps only validated points', async () => {
    let mode = '';
    const run = await runQuickAnswer('key', 'brief', evidence, ai, undefined, async (content, _k, _u, _m, m, cb) => {
        mode = m;
        expect(content).toBe('TASK x');
        cb.onChunk('Answer.\n<!--MUSTER_JSON {"schemaVersion":1,"points":[{"text":"Submit a 3000-word report.","sourceIds":["10:unit:3"],"action":true},{"text":"Due in 7 days.","sourceIds":["10:unit:3"]}]} -->');
        cb.onDone();
    });
    expect(mode).toBe('brief');
    expect(run.answer?.points.map(p => p.text)).toEqual(['Submit a 3000-word report.']);
    expect(run.answer?.rejected).toBe(1);
});

it('reports a failed stream instead of a partial answer', async () => {
    const run = await runQuickAnswer('key', 'brief', evidence, ai, undefined, async (_c, _k, _u, _m, _mode, cb) => { cb.onChunk('half'); cb.onError('HTTP 500'); });
    expect(run).toEqual({ error: 'HTTP 500' });
});
