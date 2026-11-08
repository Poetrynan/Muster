/**
 * Freshness hashes (P0-C): detect when locally-cached course data changed after
 * an AI artifact (summary / priority ranking / plan) was generated, so the UI
 * can nudge the user to regenerate — without burning tokens automatically.
 *
 * FNV-1a 32-bit over a canonical serialization: stable, tiny, zero-dep.
 */

function fnv1a(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export interface CourseDataHashInput {
  resources: { id?: number; courseId?: number; name: string; section?: string; weekNum?: number; url?: string; resourceType?: string; modifiedDate?: string; content?: string; contentHtml?: string }[];
  assignments: DeadlineAssignment[];
  announcements: { id: number; title: string; date: string; courseId?: number; content?: string; url?: string }[];
  unitInfoTitles?: string[];
  unitInfoSections?: { title: string; contentHtml: string }[];
  gradeEntries?: { courseId?: number; item: string; grade?: string | null; range?: string | null; feedback?: string | null; url?: string | null }[];
  scheduleItems?: { title: string; contentHtml: string; rows?: { cells: string[] }[] }[];
}

/** Optional so existing summary/deadline callers keep their current signatures. */
export interface GenerationHashMetadata {
  accountScope?: string;
  courseId?: number;
  selectedWeek?: string | number | null;
  localDate?: string;
  timezone?: string;
  language?: string;
  model?: string;
  mode?: string;
  promptVersion?: string | number;
  schemaVersion?: string | number;
  availableMinutes?: number;
}

/** Sort object keys, but retain semantic array order (schedule rows/cells). */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value).filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
      .map(([key, v]) => `${JSON.stringify(key)}:${canonical(v)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

/** These top-level collections are sets; sorting never mutates caller data. */
function collection(items: unknown[] | undefined): string[] {
  return (items ?? []).map(canonical).sort();
}

/** Hash the course data an AI summary was built from. */
export function computeCourseDataHash(i: CourseDataHashInput, metadata?: GenerationHashMetadata): string {
  return fnv1a(canonical({
    resources: collection(i.resources),
    assignments: collection(i.assignments),
    announcements: collection(i.announcements),
    unitInfoTitles: collection(i.unitInfoTitles),
    unitInfoSections: collection(i.unitInfoSections),
    gradeEntries: collection(i.gradeEntries),
    scheduleItems: collection(i.scheduleItems),
    metadata: metadata ?? {},
  }));
}

export interface DeadlineAssignment {
  id?: number;
  courseId?: number;
  name: string;
  dueDateIso?: string;
  dueDate?: string;
  status?: string;
  grade?: string | null;
  gradeMax?: number;
  range?: string | null;
  weight?: number;
  category?: string;
  categoryId?: number;
  categoryWeight?: number;
  isCategory?: boolean;
  hasSubmissionStatus?: boolean;
  assessmentType?: string;
  url?: string;
}

export interface DeadlineEvent {
  id: number;
  courseId?: number;
  title: string;
  timestamp: number;
  eventType: string;
}

/** Hash the cross-course deadline surface (assignments + closing calendar events). */
export function computeDeadlineHash(assignments: DeadlineAssignment[], calendarEvents: DeadlineEvent[], metadata?: GenerationHashMetadata): string {
  return fnv1a(canonical({
    // Undated assessments still affect planning through grades/category weights.
    assignments: collection(assignments),
    // Opening events aren't deadlines and should not create phantom staleness.
    calendarEvents: collection((calendarEvents ?? []).filter((e) => e.eventType !== "open")),
    metadata: metadata ?? {},
  }));
}
