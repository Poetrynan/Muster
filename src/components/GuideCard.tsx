import { useState, type ReactNode } from 'react';
import { Pencil } from 'lucide-react';
import type { GuideCard as CardData, GuideProgress, SourceRecord } from '../lib/studyGuide/types';
import { guideCopy } from '../lib/studyGuide/copy';
import { GuideSources } from './GuideSources';
import { Button } from './ui/button';
export function GuideCard({ card, sources, language, progress, onProgress, children }: {
    card: CardData;
    sources: SourceRecord[];
    language: string;
    progress?: GuideProgress;
    onProgress: (progress: GuideProgress) => void;
    children?: ReactNode;
}) {
    const c = guideCopy(language), [editing, setEditing] = useState(false), [draft, setDraft] = useState('');
    return <article className="min-w-0 rounded-2xl border border-border bg-card p-4 sm:p-5 [overflow-wrap:anywhere]">
    <div className="flex items-start gap-3">
      <input type="checkbox" checked={progress?.done ?? false} onChange={e => onProgress({ done: e.target.checked })} aria-label={`${c.done}: ${progress?.text || card.title}`} className="mt-1 h-4 w-4 shrink-0 accent-primary"/>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground"><span>{card.kind === 'plan' || card.origin === 'ai' ? c.advice : c.fact}</span>{card.priority && <span className={card.priority === 'urgent' ? 'text-amber-700 dark:text-amber-300' : ''}>{c[card.priority]}</span>}{card.suggestedMinutes != null && <span>{c.estimated} {card.suggestedMinutes} {c.minutes}</span>}</div>
        {editing ? <form className="mt-2 space-y-2" onSubmit={e => {
                e.preventDefault();
                if (draft.trim()) {
                    onProgress({ text: draft.trim() });
                    setEditing(false);
                }
            }}><textarea aria-label={c.edit} maxLength={500} value={draft} onChange={e => setDraft(e.target.value)} className="min-h-20 w-full resize-y rounded-lg border border-border bg-background p-2 text-sm" autoFocus/><div className="flex gap-2"><Button size="sm" type="submit" disabled={!draft.trim()}>{c.save}</Button><Button size="sm" type="button" variant="ghost" onClick={() => setEditing(false)}>{c.cancel}</Button></div></form> : <h3 className={`mt-1 font-semibold leading-relaxed ${progress?.done ? 'text-muted-foreground line-through' : ''}`}>{progress?.text || card.title}</h3>}
        {card.explanation && <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{card.explanation}</p>}{children}
      </div>
      <button type="button" aria-label={c.edit} title={c.edit} className="rounded-md p-2 text-muted-foreground hover:bg-muted focus-visible:ring-2 focus-visible:ring-primary" onClick={() => { setDraft(progress?.text || card.title); setEditing(true); }}><Pencil className="h-3.5 w-3.5"/></button>
    </div>
    <details className="mt-3 text-sm"><summary className="cursor-pointer rounded py-1 text-muted-foreground focus-visible:ring-2 focus-visible:ring-primary">{c.reference} · {sources.length}</summary><div className="mt-2"><GuideSources sources={sources} language={language}/></div></details>
  </article>;
}
