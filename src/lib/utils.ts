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
 * Accepts the separators Monash actually uses between term and year — space, ASCII hyphen, en/em dash,
 * underscore — and the reversed "2026 S1" / "2026S1" spelling.
 */
export function isTermEnded(courseName?: string): boolean {
  if (!courseName) return false;
  const re = /\bS([12])\s*[-–—_]?\s*(\d{4})\b|\b(\d{4})\s*[-–—_]?\s*S([12])\b/gi;
  const matches = [...courseName.matchAll(re)];
  if (matches.length === 0) return false;
  const last = matches[matches.length - 1];
  // Either the "S1 2026" branch (groups 1,2) or the "2026S1" branch (groups 3,4) matched.
  const sem = parseInt(last[1] ?? last[4], 10);
  const year = parseInt(last[2] ?? last[3], 10);
  const now = new Date();
  const curSem = now.getMonth() >= 6 ? 2 : 1;
  return year < now.getFullYear() || (year === now.getFullYear() && sem < curSem);
}

/**
 * Parse a due date with one fallback: strict `new Date` first, then retry with just
 * the extracted "12 March 2026, 9:55 PM" core — Moodle due cells can carry a trailing
 * relative label ("... 9:55 PM Due tomorrow") that breaks strict parsing.
 * Returns the timestamp (NaN when both attempts fail).
 */
export function parseDueTimestamp(date: string | Date): number {
  let due = new Date(date);
  if (Number.isNaN(due.getTime()) && typeof date === "string") {
    const m = date.match(/(\d{1,2}\s+[A-Za-z]{3,9}\s+\d{4}(?:,?\s+\d{1,2}:\d{2}\s*(?:am|pm))?)/i);
    if (m) due = new Date(m[1]);
  }
  return due.getTime();
}

export function getDaysUntilDue(date: string | Date): number {
  const diff = parseDueTimestamp(date) - Date.now();
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

/** A Moodle resource URL that points at a real downloadable file (not a page/link). */
export function isDownloadableUrl(url?: string): boolean {
  return !!url && (url.includes("pluginfile.php") || url.includes("mod/resource/view.php"));
}

export interface SavePathInput {
  courseId?: number;
  url?: string;
  /** Section/week label (e.g. "Week 1 - Why Research Methods?"); used for per-section subfolders. */
  section?: string;
  /** Week number extracted from the section label (Week 1 -> 1) */
  weekNum?: number;
}

/**
 * Resolve the on-disk *directory* a resource should be saved into. Mirrors the single-download
 * rule in handleDownload: when "group by course" is on the file lands in `<baseDir>/<UNITCODE>`,
 * otherwise in `baseDir`. Batch downloads call this per resource, so files from different courses
 * naturally fall into their own course folders — no special "batch" destination needed.
 */
export function computeSavePath(
  resource: SavePathInput,
  opts: {
    downloadPath: string;
    groupByCourse: boolean;
    groupBySection?: boolean;
    courses: { id: number; fullName?: string | null; shortName?: string | null }[];
  }
): string {
  const baseDir = (opts.downloadPath || "").replace(/[\\/]+$/, "");
  if (!opts.groupByCourse) return baseDir;
  const course = opts.courses.find((c) => c.id === (resource.courseId ?? 0));
  const courseDir = buildCourseDownloadDir(baseDir, resource.courseId ?? 0, course?.fullName, course?.shortName);
  return buildSectionDownloadDir(
    courseDir,
    opts.groupBySection ? resource.section : undefined,
    opts.groupBySection ? resource.weekNum : undefined
  );
}

/**
 * Append the section/week as one more folder level: "<courseDir>/Week 1".
 * - If weekNum is provided (>0), formats strictly as "Week N".
 * - If weekNum is missing, attempts to extract "Week N" from the section title.
 * - Otherwise falls back to the sanitized section title (e.g. "Orientation and Setup").
 * - Skips empty / unparseable section labels so resources without a section
 *   keep landing in the course root.
 */
export function buildSectionDownloadDir(
  courseDir: string,
  section?: string,
  weekNum?: number
): string {
  if (!section && (weekNum === undefined || weekNum === null || weekNum <= 0)) {
    return courseDir;
  }

  let folderName: string;
  if (weekNum && weekNum > 0) {
    folderName = `Week ${weekNum}`;
  } else if (section) {
    const match = section.match(/(?:^|\b)(?:week|wk)\s*(\d{1,2})\b/i) || section.match(/第\s*(\d{1,2})\s*周/);
    if (match) {
      folderName = `Week ${match[1]}`;
    } else {
      folderName = sanitizeFolderName(section);
    }
  } else {
    return courseDir;
  }

  if (!folderName || folderName === "Course") return courseDir;
  return courseDir ? `${courseDir}/${folderName}` : folderName;
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

