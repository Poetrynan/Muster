import type { GradeOverviewRow } from "../services/api";

interface CourseRef {
  id: number;
  fullName?: string;
  shortName?: string;
}

const norm = (s: string | undefined) => (s ?? "").replace(/\s+/g, " ").trim().toLowerCase();

/**
 * Moodle's grade overview lists every enrolment (past terms, school hubs, the IT
 * student portal). Keep only rows for the courses the user is shown, matching by
 * course id; rows cached before ids were captured fall back to the course name.
 */
export function gradesForCourses(rows: GradeOverviewRow[] | undefined, courses: CourseRef[]): GradeOverviewRow[] {
  const ids = new Set(courses.map((c) => c.id));
  const names = new Set(courses.flatMap((c) => [norm(c.fullName), norm(c.shortName)]).filter(Boolean));
  return (rows ?? []).filter((r) => (r.courseId != null ? ids.has(r.courseId) : names.has(norm(r.unit))));
}
