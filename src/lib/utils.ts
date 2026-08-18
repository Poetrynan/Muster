import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatDate(date: string | Date): string {
  return new Date(date).toLocaleDateString("zh-CN", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

export function formatRelativeTime(date: string | Date): string {
  const now = new Date();
  const target = new Date(date);
  const diff = now.getTime() - target.getTime();
  
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  
  if (days > 0) return `${days} 天前`;
  if (hours > 0) return `${hours} 小时前`;
  if (minutes > 0) return `${minutes} 分钟前`;
  return "刚刚";
}

/**
 * Determine whether a course's teaching period has ended (Monash: S1 ~ late Feb-June, S2 ~ late July-November).
 * For cross-semester courses ("S1 2026 - S2 2026") the last semester is used; returns false when nothing can be parsed.
 */
export function isTermEnded(courseName?: string): boolean {
  if (!courseName) return false;
  const re = /\bS([12])\s*[–—]?\s*(\d{4})\b/gi;
  const matches = [...courseName.matchAll(re)];
  if (matches.length === 0) return false;
  const last = matches[matches.length - 1];
  const year = parseInt(last[2], 10);
  const sem = parseInt(last[1], 10);
  const now = new Date();
  const curSem = now.getMonth() >= 6 ? 2 : 1;
  return year < now.getFullYear() || (year === now.getFullYear() && sem < curSem);
}

export function getDaysUntilDue(date: string | Date): number {
  const now = new Date();
  const due = new Date(date);
  const diff = due.getTime() - now.getTime();
  return Math.ceil(diff / (1000 * 60 * 60 * 24));
}

export function getFileExtension(filename: string): string {
  return filename.split(".").pop()?.toUpperCase() ?? "";
}

/**
 * Compute the "effective status" of an assignment.
 *
 * The backend `determine_assignment_status` only matches keywords in the table row text and never compares
 * the due date with the current time — so an assignment that was due back in 2025 falls through to
 * `upcoming` as long as its row has no submitted/graded keyword, and the UI shows "starting soon", which is clearly wrong.
 *
 * Here we re-evaluate against real time:
 * - submitted / graded → keep as-is (once handed in it should never be called overdue)
 * - upcoming / pending with a past due date → `overdue`
 * - no valid due date → keep as-is (no guessing without a date)
 */
export function getEffectiveAssignmentStatus(
  status: string,
  dueDate?: string
): string {
  if (status === "submitted" || status === "graded") return status;
  if (!dueDate) return status;

  const due = new Date(dueDate).getTime();
  if (Number.isNaN(due)) return status;

  return due < Date.now() ? "overdue" : status;
}

export function formatFileSize(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}


const COURSE_CODE_RE = /^([A-Z]{2,6}\d{2,6}(?:-[A-Z]{2,6}\d{2,6})?)/;

/** Extract the pure unit code ("FIT5215", "FIT4005-FIT5125") from a course name. */
export function getCourseCode(fullName?: string | null): string | null {
  if (!fullName) return null;
  return fullName.match(COURSE_CODE_RE)?.[1] ?? null;
}

/** Windows-safe folder name (no \ / : * ? " < > |). */
export function sanitizeFolderName(name: string): string {
  const cleaned = name.replace(/[\\/:*?"<>|]/g, "").trim();
  return cleaned || "Course";
}

/**
 * Download directory for a course when "group downloads by course" is enabled:
 * "<baseDir>/<UNITCODE>". Falls back to just the unit code when no base dir is set.
 */
export function buildCourseDownloadDir(
  baseDir: string,
  courseId: number,
  fullName?: string | null,
  shortName?: string | null
): string {
  const code = getCourseCode(fullName) ?? getCourseCode(shortName) ?? `Course-${courseId}`;
  const safe = sanitizeFolderName(code);
  const base = (baseDir || "").replace(/[\\/]+$/, "");
  return base ? `${base}/${safe}` : safe;
}

export type DesktopPlatform = "macos" | "windows" | "linux" | "other";

export function getDesktopPlatform(): DesktopPlatform {
  if (typeof navigator === "undefined") return "other";
  const identity = `${navigator.platform || ""} ${navigator.userAgent || ""}`.toLowerCase();
  if (identity.includes("mac")) return "macos";
  if (identity.includes("win")) return "windows";
  if (identity.includes("linux")) return "linux";
  return "other";
}

