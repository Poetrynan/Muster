import type { Course } from "../services/api";

export interface SemesterInfo {
  key: string;              // e.g. "2026-S1", "2025-S2", "other"
  label: string;            // e.g. "2026 S1", "2025 S2", "Other"
  year: number | null;
  termNumber: number;       // 1 = S1, 2 = S2, 3 = Summer, 4 = Winter, 0 = Other
  isCrossSemester: boolean;
  sortWeight: number;       // Higher is newer, e.g. 20261 for 2026 S1
}

const TERM_RE = /\bS([12])\s*[\u002D\u2013\u2014_]?\s*(\d{4})\b|\b(\d{4})\s*[\u002D\u2013\u2014_]?\s*S([12])\b/i;
const CROSS_TERM_RE = /\bS1\s*(\d{4})\s*[\u002D\u2013\u2014_]\s*S2\s*(\d{4})\b/i;
const SUMMER_WINTER_RE = /\b(Summer|Winter)\s*[\u002D\u2013\u2014_]?\s*(\d{4})\b/i;

/**
 * Extract structured semester information from a course name.
 * Handles "FIT5215 Deep learning - S2 2025", "FIT9132 - S1 2026",
 * "Thesis - S1 2026 - S2 2026", "Summer 2026", and portal / ongoing units.
 */
export function parseSemester(courseName: string): SemesterInfo {
  if (!courseName) {
    return {
      key: "other",
      label: "Other",
      year: null,
      termNumber: 0,
      isCrossSemester: false,
      sortWeight: 0,
    };
  }

  // 1. Cross-semester pattern: S1 2026 - S2 2026
  const crossMatch = courseName.match(CROSS_TERM_RE);
  if (crossMatch) {
    const y1 = parseInt(crossMatch[1], 10);
    const y2 = parseInt(crossMatch[2], 10);
    const endYear = Math.max(y1, y2);
    return {
      key: `${y1}-S1-${y2}-S2`,
      label: `S1 ${y1} - S2 ${y2}`,
      year: endYear,
      termNumber: 2,
      isCrossSemester: true,
      // Slightly lower sort weight than standard S2 of that year (e.g. 20261.9 vs 20262)
      // so the primary single-term 2026 S2 pill renders before the cross-semester pill.
      sortWeight: endYear * 10 + 1.9,
    };
  }

  // 2. Standard semester pattern: S1 2026 or 2026 S1
  const stdMatch = courseName.match(TERM_RE);
  if (stdMatch) {
    const termNum = parseInt(stdMatch[1] || stdMatch[4], 10);
    const year = parseInt(stdMatch[2] || stdMatch[3], 10);
    return {
      key: `${year}-S${termNum}`,
      label: `${year} S${termNum}`,
      year,
      termNumber: termNum,
      isCrossSemester: false,
      sortWeight: year * 10 + termNum,
    };
  }

  // 3. Summer / Winter semester pattern
  const swMatch = courseName.match(SUMMER_WINTER_RE);
  if (swMatch) {
    const termType = swMatch[1].toLowerCase();
    const year = parseInt(swMatch[2], 10);
    const termNum = termType === "summer" ? 3 : 4;
    return {
      key: `${year}-${termType}`,
      label: `${year} ${swMatch[1]}`,
      year,
      termNumber: termNum,
      isCrossSemester: false,
      sortWeight: year * 10 + (termType === "summer" ? 0.5 : 2.5),
    };
  }

  return {
    key: "other",
    label: "Other",
    year: null,
    termNumber: 0,
    isCrossSemester: false,
    sortWeight: 0,
  };
}

/**
 * Check if a course is active in the given semester.
 * Handles both exact semester matches and cross-semester units spanning this semester.
 * E.g., if targetSemesterKey is "2026-S2":
 * - A course with "2026-S2" returns true.
 * - A course with "2026-S1-2026-S2" returns true (because it spans through S2 2026).
 */
export function isCourseInSemester(sem: SemesterInfo, targetSemesterKey: string): boolean {
  if (targetSemesterKey === "all") return true;
  if (sem.key === targetSemesterKey) return true;

  if (sem.isCrossSemester) {
    const parts = sem.key.split("-");
    if (parts.length === 4) {
      const startKey = `${parts[0]}-${parts[1]}`;
      const endKey = `${parts[2]}-${parts[3]}`;
      if (targetSemesterKey === startKey || targetSemesterKey === endKey) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Automatically infer the current active semester key based on:
 * 1. Monash University calendar timing (Feb-June: S1, July-Nov: S2, Dec-Jan: Summer).
 * 2. Exact match against standard semesters the student is enrolled in (e.g. 2026-S2).
 * 3. Fallback to cross-semester units or the newest semester present in the student's courses.
 */
export function inferActiveSemesterKey(courses: Course[]): string {
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth(); // 0-indexed: 0 = Jan, 1 = Feb ... 11 = Dec

  // Monash standard academic calendar
  let naturalTerm = "S1";
  if (currentMonth >= 6 && currentMonth <= 10) {
    // July - November -> S2
    naturalTerm = "S2";
  } else if (currentMonth === 11 || currentMonth === 0) {
    // Dec - Jan -> Summer (or upcoming S1)
    naturalTerm = "S1";
  } else {
    // Feb - June -> S1
    naturalTerm = "S1";
  }

  const naturalKey = `${currentYear}-${naturalTerm}`;

  const availableSemesters = courses.map((c) => parseSemester(c.fullName || c.shortName || ""));

  // 1. Strict exact match on standard primary semester (e.g. 2026-S2) - HIGHEST priority!
  const exactMatch = availableSemesters.find((s) => s.key === naturalKey && !s.isCrossSemester);
  if (exactMatch) {
    return exactMatch.key;
  }

  // 2. Cross-semester match if no standard semester exists
  const crossMatch = availableSemesters.find((s) => s.isCrossSemester && s.year === currentYear);
  if (crossMatch) {
    return crossMatch.key;
  }

  // 3. Fallback: newest standard semester
  const validStandard = availableSemesters.filter((s) => s.sortWeight > 0 && !s.isCrossSemester);
  if (validStandard.length > 0) {
    validStandard.sort((a, b) => b.sortWeight - a.sortWeight);
    return validStandard[0].key;
  }

  // 4. Fallback: newest overall semester
  const validSemesters = availableSemesters.filter((s) => s.sortWeight > 0);
  if (validSemesters.length > 0) {
    validSemesters.sort((a, b) => b.sortWeight - a.sortWeight);
    return validSemesters[0].key;
  }

  return "all";
}

export interface SemesterTabOption {
  key: string;
  label: string;
  count: number;
  isCurrent?: boolean;
}

/**
 * Extract all unique semester tabs for filtering, sorted from newest to oldest.
 */
export function getSemesterTabs(courses: Course[], hiddenCourseIds: number[] = []): SemesterTabOption[] {
  const activeCourses = courses.filter((c) => !hiddenCourseIds.includes(c.id));
  const currentKey = inferActiveSemesterKey(activeCourses);

  const termMap = new Map<string, { label: string; count: number; sortWeight: number }>();

  for (const c of activeCourses) {
    const sem = parseSemester(c.fullName || c.shortName || "");
    const existing = termMap.get(sem.key) || { label: sem.label, count: 0, sortWeight: sem.sortWeight };
    existing.count += 1;
    termMap.set(sem.key, existing);
  }

  const terms = Array.from(termMap.entries()).map(([key, data]) => ({
    key,
    label: data.label,
    count: data.count,
    sortWeight: data.sortWeight,
    isCurrent: key === currentKey,
  }));

  // Sort descending by sortWeight (newest first)
  terms.sort((a, b) => b.sortWeight - a.sortWeight);

  return terms;
}
