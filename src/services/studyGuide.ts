import { generateSummaryStream } from './api';
import type { GenerationStatus, GuideArtifact, GuideContext, GuideFacts, GuideScope, SourceSelection } from '../lib/studyGuide/types';
import { GUIDE_PROMPT, GUIDE_SCHEMA } from '../lib/studyGuide/types';
import { guideKey } from '../lib/studyGuide/sources';
import { parseGuideOutput, validateGuide } from '../lib/studyGuide/validate';
import { stripPartialAppendix } from '../lib/aiStructured';
interface GuideInput {
    scope: GuideScope;
    selection: SourceSelection;
    facts: GuideFacts;
    context: GuideContext;
    apiKey: string;
    apiUrl: string;
    model: string;
    signal?: AbortSignal;
}
export interface GuideAttempt {
    status: GenerationStatus;
    markdown: string;
    error?: string;
    artifact?: GuideArtifact;
}
export async function generateGuide(input: GuideInput, onText: (s: string) => void, transport = generateSummaryStream): Promise<GuideAttempt> {
    let accumulated = '', done = false, error: string | undefined;
    const active = () => !input.signal?.aborted;
    try {
        await transport(input.context.prompt, input.apiKey, input.apiUrl, input.model, 'guide', {
            signal: input.signal,
            onChunk: (text, thinking) => {
                if (!active() || done || error || thinking)
                    return;
                accumulated += text;
                onText(stripPartialAppendix(accumulated));
            },
            onDone: () => {
                if (active() && !error)
                    done = true;
            },
            onError: (message) => {
                if (active() && !done)
                    error = message;
            },
        });
    }
    catch (e) {
        error = e instanceof Error ? e.message : String(e);
    }
    const { markdown, payload } = parseGuideOutput(accumulated);
    if (!active())
        return { status: 'failed', markdown: '', error: 'aborted' };
    if (error || !done)
        return { status: markdown ? 'partial' : 'failed', markdown, error: error || 'Stream ended without completion' };
    const { cards, rejected } = validateGuide(payload, input.facts, input.selection.included, input.context, input.scope);
    if (!markdown && !cards.length)
        return { status: 'failed', markdown: '', error: 'No readable answer returned' };
    const status = cards.length && rejected === 0 ? 'ready' : 'text-only';
    // A JSON-only response still renders validated cards; it never replaces a good guide with an empty view.
    const artifact: GuideArtifact = { schemaVersion: GUIDE_SCHEMA, promptVersion: GUIDE_PROMPT, key: guideKey(input.scope), scope: input.scope, inputHash: input.context.inputHash, generatedAt: new Date().toISOString(), status, markdown, cards, includedSourceIds: input.context.includedSourceIds, omittedSourceIds: input.context.omittedSourceIds, warnings: rejected, sources: input.selection.included, facts: input.facts.facts };
    return { status, markdown, artifact };
}
