/**
 * Reminder service: assignment due reminders + new announcement/resource alerts.
 *
 * Channels:
 *  1. In-app banner (store reminderBanner) - always available.
 *  2. System notification via Web Notification API (Tauri WebView2 supports it;
 *     silently degrades when unavailable/denied).
 */

export interface DueAssignment {
  /** dedup key: due:<id|name>:<dueDateIso> */
  id: string;
  name: string;
  dueDateIso: string;
}

const REMINDED_KEY = "muster-reminded-v1";
const MAX_REMINDED = 500;

export function getReminded(): Set<string> {
  try {
    const raw = localStorage.getItem(REMINDED_KEY);
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}

export function markReminded(ids: string[]): void {
  try {
    const s = getReminded();
    ids.forEach((i) => s.add(i));
    const arr = Array.from(s).slice(-MAX_REMINDED);
    localStorage.setItem(REMINDED_KEY, JSON.stringify(arr));
  } catch {
    /* storage unavailable - reminders may repeat, acceptable */
  }
}

export function clearReminded(): void {
  try {
    localStorage.removeItem(REMINDED_KEY);
  } catch {
    /* ignore */
  }
}

/**
 * Find assignments due within `days` from now that are not yet submitted/graded.
 * A 1-day grace period is allowed for assignments that just passed.
 */
export function findDueAssignments(
  assignments: { id?: number; name: string; dueDateIso?: string; status?: string }[],
  days: number
): DueAssignment[] {
  const now = Date.now();
  const horizon = days * 86_400_000;
  const grace = 86_400_000;
  return assignments
    .filter((a) => {
      if (!a.dueDateIso) return false;
      if (a.status === "submitted" || a.status === "graded") return false;
      const t = Date.parse(a.dueDateIso);
      if (Number.isNaN(t)) return false;
      const diff = t - now;
      return diff >= -grace && diff <= horizon;
    })
    .map((a) => ({
      id: `due:${a.id ?? a.name}:${a.dueDateIso}`,
      name: a.name,
      dueDateIso: a.dueDateIso!,
    }));
}

/** Announcements present in `next` but not in `prev` (id or title as key). */
export function diffAnnouncements(
  prev: { id?: number; title: string }[],
  next: { id?: number; title: string }[]
): { id?: number; title: string }[] {
  const prevKeys = new Set(prev.map((a) => a.id ?? a.title));
  return next.filter((a) => !prevKeys.has(a.id ?? a.title));
}

/** Resources present in `next` but not in `prev` (courseId+name as key; ids are unreliable). */
export function diffResources(
  prev: { courseId?: number; name: string }[],
  next: { courseId?: number; name: string }[]
): { courseId?: number; name: string }[] {
  const prevKeys = new Set(prev.map((r) => `${r.courseId ?? 0}:${r.name}`));
  return next.filter((r) => !prevKeys.has(`${r.courseId ?? 0}:${r.name}`));
}

/** System notification via Web Notification API. No-op when unavailable. */
export function showSystemNotification(title: string, body: string): void {
  try {
    if (typeof Notification === "undefined") return;
    if (Notification.permission === "granted") {
      new Notification(title, { body });
    } else if (Notification.permission !== "denied") {
      Notification.requestPermission().then((p) => {
        if (p === "granted") new Notification(title, { body });
      });
    }
  } catch (e) {
    console.warn("system notification failed:", e);
  }
}

/** Ask for notification permission (call when the user enables a reminder toggle). */
export function requestNotificationPermission(): void {
  try {
    if (typeof Notification !== "undefined" && Notification.permission === "default") {
      Notification.requestPermission().catch(() => {});
    }
  } catch {
    /* ignore */
  }
}
