import { generateSummaryStream } from './api';
import { buildQuickAnswer, type AiPreset, type QuickAnswer, type QuickEvidence } from '../lib/studyGuide/quick';
import { stripThinking } from '../lib/aiStructured';

export interface QuickRun {
    answer?: QuickAnswer;
    error?: string;
}

/**
 * Ask the fixed question behind one quick action. The reply is never shown as free text:
 * only the points that pass validateQuickAnswer reach the UI.
 */
export async function runQuickAnswer(
    key: string,
    preset: AiPreset,
    evidence: Extract<QuickEvidence, { available: true }>,
    ai: { apiKey: string; apiUrl: string; model: string },
    signal?: AbortSignal,
    transport = generateSummaryStream,
): Promise<QuickRun> {
    let output = '', done = false, error: string | undefined;
    try {
        await transport(evidence.prompt, ai.apiKey, ai.apiUrl, ai.model, 'brief', {
            signal,
            onChunk: (text, thinking) => { if (!thinking) output += text; },
            onDone: () => { done = true; },
            onError: (message) => { error = message; },
        });
    } catch (e) {
        error = e instanceof Error ? e.message : String(e);
    }
    if (signal?.aborted) return { error: 'aborted' };
    if (error || !done) return { error: error || 'Stream ended without completion' };
    return { answer: buildQuickAnswer(key, preset, evidence, ai.model, stripThinking(output)) };
}
