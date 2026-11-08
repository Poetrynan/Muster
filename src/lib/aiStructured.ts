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
 * Parse the last appendix as raw JSON, without mode-specific normalization.
 * Returns null when absent/invalid; callers must validate their own schema.
 */
export function extractMusterPayload(text: string): unknown | null {
  const source = String(text ?? "");
  let markerIdx=-1;
  let nextMarker=source.indexOf(MUSTER_JSON_MARKER);
  while(nextMarker>=0){
    markerIdx=nextMarker;
    const boundary=appendixBoundary(source,nextMarker+MUSTER_JSON_MARKER.length);
    nextMarker=source.indexOf(MUSTER_JSON_MARKER,boundary.next);
  }
  if (markerIdx < 0) return null;
  const tail = source.slice(markerIdx + MUSTER_JSON_MARKER.length);

  const endIdx = appendixBoundary(tail, 0).end;
  let inner = tail.slice(0, endIdx);

  // Tolerate a ```json fence wrapped around the payload.
  inner = inner.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/i, "").trim();

  try {
    return JSON.parse(inner) as unknown;
  } catch {
    return null;
  }
}

/**
 * Normalize the last payload, hiding every appendix from the Markdown.
 * JSON-only responses get readable fallback text, never an empty task claim.
 */
export function extractMusterJson(text: string): { json: SummaryActions | null; clean: string } {
  const source = String(text ?? "");
  const clean = stripPartialAppendix(source).trim();
  const fallback = "The AI response did not include a readable explanation. Please regenerate to get an explanation.";
  return {
    json: normalizePayload(extractMusterPayload(source)),
    clean: clean || (source.trim() ? fallback : ""),
  };
}

/** Closing delimiters inside JSON strings are data, including escaped quotes. */
function appendixBoundary(source: string, start: number): { end: number; next: number } {
  let quoted = false;
  let escaped = false;
  for (let pos = start; pos < source.length; pos++) {
    const char = source[pos];
    if (quoted) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') quoted = false;
    } else if (char === '"') quoted = true;
    else if (source.startsWith(MUSTER_JSON_END, pos)) {
      return { end: pos, next: pos + MUSTER_JSON_END.length };
    } else if (source.startsWith(MUSTER_JSON_MARKER, pos)) {
      return { end: pos, next: pos };
    }
  }
  return { end: source.length, next: source.length };
}

/**
 * Streaming guard: while chunks are still arriving the appendix may be partially
 * transmitted. Hide closed/open appendices and even a split marker prefix.
 * Keep raw chunks separately so completion parsing still has the full payload.
 */
export function stripPartialAppendix(streamingText: string): string {
  const source = String(streamingText ?? "");
  let visible = "";
  let cursor = 0;
  let marker = source.indexOf(MUSTER_JSON_MARKER);
  while (marker >= 0) {
    visible += source.slice(cursor, marker);
    cursor = appendixBoundary(source, marker + MUSTER_JSON_MARKER.length).next;
    marker = source.indexOf(MUSTER_JSON_MARKER, cursor);
  }
  visible += source.slice(cursor);
  for (let size = MUSTER_JSON_MARKER.length - 1; size > 0; size--) {
    if (visible.endsWith(MUSTER_JSON_MARKER.slice(0, size))) {
      visible = visible.slice(0, -size);
      break;
    }
  }
  return visible === source ? source : visible.trimEnd();
}
