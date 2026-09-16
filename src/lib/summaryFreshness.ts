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
  resources: { name: string; section?: string }[];
  assignments: { name: string; dueDateIso?: string; dueDate?: string; status: string }[];
  announcements: { id: number; title: string; date: string }[];
  unitInfoTitles?: string[];
}

/** Hash the course data an AI summary was built from. */
export function computeCourseDataHash(i: CourseDataHashInput): string {
  const parts: string[] = [];
  for (const r of i.resources || []) parts.push(`R|${r.name}|${r.section ?? ""}`);
  for (const a of i.assignments || []) parts.push(`A|${a.name}|${a.dueDateIso ?? a.dueDate ?? ""}|${a.status}`);
  for (const n of i.announcements || []) parts.push(`N|${n.id}|${n.title}|${n.date}`);
  for (const t of i.unitInfoTitles || []) parts.push(`U|${t}`);
  return fnv1a(parts.join("\n"));
}

export interface DeadlineAssignment {
  id?: number;
  name: string;
  dueDateIso?: string;
  dueDate?: string;
  status?: string;
}

export interface DeadlineEvent {
  id: number;
  title: string;
  timestamp: number;
  eventType: string;
}

/** Hash the cross-course deadline surface (assignments + closing calendar events). */
export function computeDeadlineHash(assignments: DeadlineAssignment[], calendarEvents: DeadlineEvent[]): string {
  const parts: string[] = [];
  for (const a of assignments || []) {
    if (!a.dueDateIso && !a.dueDate) continue;
    parts.push(`A|${a.id ?? a.name}|${a.name}|${a.dueDateIso ?? a.dueDate}|${a.status ?? ""}`);
  }
  for (const e of calendarEvents || []) {
    // "open" events are not deadlines; including them would cause phantom staleness.
    if (e.eventType === "open") continue;
    parts.push(`E|${e.id}|${e.title}|${e.timestamp}|${e.eventType}`);
  }
  return fnv1a(parts.sort().join("\n"));
}
