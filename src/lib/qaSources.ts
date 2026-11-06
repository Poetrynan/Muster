import type { SearchHit } from "./courseSearch";

export function safeSourceUrl(value?: string): string | undefined {
  try {
    const url = new URL(value ?? "");
    return url.protocol === "https:" && !url.username && !url.password ? url.href : undefined;
  } catch { return undefined; }
}

/** Only inline citation IDs can establish which retrieved sources an answer used. */
export function resolveQaSources(answer: string, hits: SearchHit[]) {
  const prose = answer.replace(/```[\s\S]*?```/g, "").replace(/`[^`]*`/g, "")
    .replace(/\[[^\]]*\]\([^)]*\)/g, "");
  const ids = [...new Set([...prose.matchAll(/\[(\d+)\]/g)].map(m => Number(m[1])))];
  const sources = ids.flatMap(id => {
    const hit = hits.find(h => h.sourceId === id);
    return hit ? [hit] : [];
  });
  return { sources, insufficient: ids.length === 0 || sources.length !== ids.length };
}

export async function openQaSource(source: SearchHit): Promise<void> {
  const url = safeSourceUrl(source.url);
  if (!url) return;
  const hostname = new URL(url).hostname;
  if (hostname === "monash.edu" || hostname.endsWith(".monash.edu")) {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("open_in_app_webview", { url, title: source.title });
      return;
    } catch { /* Reuse the regular external-browser fallback. */ }
  }
  const { openUrl } = await import("@tauri-apps/plugin-opener");
  await openUrl(url);
}
