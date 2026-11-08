import { ExternalLink } from 'lucide-react';
import type { SourceRecord } from '../lib/studyGuide/types';
import { guideCopy } from '../lib/studyGuide/copy';
import { safeSourceUrl } from '../lib/studyGuide/sources';
export function GuideSources({ sources, language, includedIds, omittedIds }: {
    sources: SourceRecord[];
    language: string;
    includedIds?: string[];
    omittedIds?: string[];
}) {
    const c = guideCopy(language);
    return <div className="min-w-0 space-y-2">{sources.map(source => <details key={source.id} className="rounded-xl border border-border bg-background/60 text-sm">
    <summary className="cursor-pointer px-3 py-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary [overflow-wrap:anywhere]">
      <span className="font-medium">{source.title}</span>
      <span className="ml-2 text-xs text-muted-foreground">{source.coverage === 'title-only' ? c.titleOnly : c.body}{omittedIds?.includes(source.id) ? ` · ${c.omitted}` : includedIds?.includes(source.id) ? ` · ${c.included}` : ''}</span>
    </summary>
    <div className="space-y-2 border-t border-border px-3 py-3 [overflow-wrap:anywhere]">
      <p className="text-xs text-muted-foreground">{source.locator}</p>
      <p className="max-h-48 overflow-y-auto whitespace-pre-wrap leading-relaxed">{source.excerpt}</p>
      {safeSourceUrl(source.url) ? <button type="button" className="inline-flex items-center gap-1 rounded-md py-1 text-primary underline underline-offset-4 focus-visible:ring-2 focus-visible:ring-primary" onClick={async () => {
                    const url = safeSourceUrl(source.url);
                    if (!url)
                        return;
                    if ('__TAURI_INTERNALS__' in window) {
                        const { openUrl } = await import('@tauri-apps/plugin-opener');
                        await openUrl(url);
                    }
                    else
                        window.open(url, '_blank', 'noopener,noreferrer');
                }}>{c.open}<ExternalLink className="h-3 w-3" aria-hidden="true"/></button> : <p className="text-xs text-muted-foreground">{c.noLink}</p>}
    </div>
  </details>)}</div>;
}
