/**
 * Structured-output contract for Muster AI generations.
 *
 * Every AI mode returns Markdown for humans plus a machine-readable appendix on
 * the LAST line:  <!--MUSTER_JSON { ... } -->
 *
 * The appendix is stripped from the rendered Markdown; its parsed payload drives
 * the structured cards (actions / priorities / plan days / QA sources). Any
 * parse failure degrades gracefully to plain Markdown — never an error surface.
 */

export interface AiAction {
  title: string;
  dueAt?: string;
  kind?: string;
  courseCode?: string;
}

export interface AiPriority {
  item: string;
  level: "urgent" | "important" | "normal";
  reason?: string;
}

export interface AiPlanDay {
  day: string;
  tasks: { text: string; weekRef?: string }[];
}

export interface AiSource {
  title: string;
}

export interface SummaryActions {
  actions?: AiAction[];
  priorities?: AiPriority[];
  weeklyFocus?: string;
  days?: AiPlanDay[];
  sources?: AiSource[];
  confidence?: "high" | "medium" | "low";
}

export const MUSTER_JSON_MARKER = "<!--MUSTER_JSON";
export const MUSTER_JSON_END = "-->";

const PRIORITY_LEVELS = new Set(["urgent", "important", "normal"]);

/** FNV-1a style normalization guard reused by every field copy. */
function str(v: unknown, max = 300): string | undefined {
  if (typeof v !== "string") return undefined;
  const s = v.trim();
  return s ? s.slice(0, max) : undefined;
}

function normalizeLevel(v: unknown): "urgent" | "important" | "normal" {
  const s = typeof v === "string" ? v.trim().toLowerCase() : "";
  return PRIORITY_LEVELS.has(s) ? (s as "urgent" | "important" | "normal") : "normal";
}

function normalizeConfidence(v: unknown): "high" | "medium" | "low" | undefined {
  const s = typeof v === "string" ? v.trim().toLowerCase() : "";
  return s === "high" || s === "medium" || s === "low" ? s : undefined;
}

function normalizePayload(raw: unknown): SummaryActions | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const obj = raw as Record<string, unknown>;

  const actions: AiAction[] = Array.isArray(obj.actions)
    ? (obj.actions
        .map((a): AiAction | null => {
          const o = (a ?? {}) as Record<string, unknown>;
          const title = str(o.title, 200);
          if (!title) return null;
          return {
            title,
            dueAt: str(o.dueAt, 40),
            kind: str(o.kind, 40),
            courseCode: str(o.courseCode, 40),
          };
        })
        .flatMap((a) => (a === null ? [] : [a]))
        .slice(0, 20))
    : [];

  const priorities: AiPriority[] = Array.isArray(obj.priorities)
    ? (obj.priorities
        .map((p): AiPriority | null => {
          const o = (p ?? {}) as Record<string, unknown>;
          const item = str(o.item, 200);
          if (!item) return null;
          return { item, level: normalizeLevel(o.level), reason: str(o.reason, 200) };
        })
        .flatMap((p) => (p === null ? [] : [p]))
        .slice(0, 20))
    : [];

  const days: AiPlanDay[] = Array.isArray(obj.days)
    ? (obj.days
        .map((d): AiPlanDay | null => {
          const o = (d ?? {}) as Record<string, unknown>;
          const day = str(o.day, 80);
          if (!day) return null;
          const tasks = Array.isArray(o.tasks)
            ? (o.tasks
                .map((t): { text: string; weekRef?: string } | null => {
                  const to = (t ?? {}) as Record<string, unknown>;
                  const text = str(to.text, 300);
                  if (!text) return null;
                  return { text, weekRef: str(to.weekRef, 80) };
                })
                .flatMap((t) => (t === null ? [] : [t]))
                .slice(0, 8))
            : [];
          return { day, tasks };
        })
        .flatMap((d) => (d === null ? [] : [d]))
        .slice(0, 14))
    : [];

  const sources: AiSource[] = Array.isArray(obj.sources)
    ? (obj.sources
        .map((s): AiSource | null => {
          const o = (s ?? {}) as Record<string, unknown>;
          const title = str(o.title, 200);
          return title ? { title } : null;
        })
        .flatMap((s) => (s === null ? [] : [s]))
        .slice(0, 10))
    : [];

  const weeklyFocus = str(obj.weeklyFocus, 300);
  const confidence = normalizeConfidence(obj.confidence);

  const payload: SummaryActions = {};
  if (actions.length) payload.actions = actions;
  if (priorities.length) payload.priorities = priorities;
  if (weeklyFocus) payload.weeklyFocus = weeklyFocus;
  if (days.length) payload.days = days;
  if (sources.length) payload.sources = sources;
  if (confidence) payload.confidence = confidence;

  // Empty payload = nothing structured to show.
  return Object.keys(payload).length ? payload : null;
}

/**
 * Locate the appendix marker (if any) and try to parse its JSON payload.
 * Returns the payload (null when absent/invalid) and the Markdown with the
 * appendix (and anything after the last marker) removed.
 */
export function extractMusterJson(text: string): { json: SummaryActions | null; clean: string } {
  const source = String(text ?? "");
  const markerIdx = source.lastIndexOf(MUSTER_JSON_MARKER);
  if (markerIdx < 0) return { json: null, clean: source.trim() };

  const before = source.slice(0, markerIdx).trim();
  const tail = source.slice(markerIdx + MUSTER_JSON_MARKER.length);

  const endIdx = tail.indexOf(MUSTER_JSON_END);
  let inner = endIdx >= 0 ? tail.slice(0, endIdx) : tail;

  // Tolerate a ```json fence wrapped around the payload.
  inner = inner.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/i, "").trim();

  let json: SummaryActions | null = null;
  if (inner) {
    try {
      json = normalizePayload(JSON.parse(inner));
    } catch {
      json = null;
    }
  }

  return { json, clean: before };
}

/**
 * Streaming guard: while chunks are still arriving the appendix may be partially
 * transmitted; hide the marker and any trailing fragment from live rendering.
 * A fully closed appendix stays (it is stripped at done-time by extractMusterJson).
 */
export function stripPartialAppendix(streamingText: string): string {
  const s = String(streamingText ?? "");
  const markerIdx = s.lastIndexOf(MUSTER_JSON_MARKER);
  if (markerIdx < 0) return s;

  const tail = s.slice(markerIdx + MUSTER_JSON_MARKER.length);
  if (tail.includes(MUSTER_JSON_END)) return s; // closed: let extraction handle it
  return s.slice(0, markerIdx).trimEnd();
}
