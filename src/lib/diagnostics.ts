import type { Assignment, Course } from "../services/api";
import { buildCourseGrade } from "./gradeBreakdown";

/**
 * Structure-only problem report for the feedback form. It describes *shape*, never
 * content: counts, statuses, weights and error codes — no scores, no assignment or
 * announcement text, no names or emails. The user sees exactly this text before sending.
 */
export interface DiagnosticInput {
  appVersion: string;
  language: string;
  platform: string;
  courses: Course[];
  assignments: Assignment[];
  resourceCount: number;
  announcementCount: number;
  sync: { isRunning: boolean; lastSync?: string; errors?: string[] };
  exams: { status: string; error: string | null; count: number; checkedAt?: string };
  portalLog: string;
  context?: string;
}

/** Remove anything personal that can appear inside raw error strings. */
export function redact(text: string): string {
  return text
    .replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, "<email>")
    .replace(/https?:\/\/\S+/g, "<url>")
    .replace(/\b\d{6,}\b/g, "<id>");
}

const unitCode = (c: Course) => (c.shortName || c.fullName || "").match(/[A-Z]{3}\d{4}/i)?.[0]?.toUpperCase() ?? `course#${c.id}`;

function gradeShape(grade: string | undefined, max: number | undefined): string {
  const g = (grade ?? "").trim();
  if (!g || g === "-") return "none";
  if (/(\/|out of)/i.test(g)) return "ratio";
  if (/%/.test(g)) return "percent";
  if (/^-?\d+(\.\d+)?$/.test(g)) return max ? "bare+max" : "bare-no-max";
  return "text";
}

export function buildDiagnosticReport(d: DiagnosticInput): string {
  const lines: string[] = [];
  lines.push("Muster diagnostic report (structure only: no scores, names or content)");
  lines.push(`app ${d.appVersion || "?"} · lang ${d.language} · ${d.platform}`);
  if (d.context) lines.push(`context: ${redact(d.context)}`);
  lines.push("");
  lines.push(`sync: running=${d.sync.isRunning} lastSync=${d.sync.lastSync ?? "never"} errors=${d.sync.errors?.length ?? 0}`);
  (d.sync.errors ?? []).slice(0, 5).forEach((e) => lines.push(`  ! ${redact(e).slice(0, 160)}`));
  lines.push(`data: courses=${d.courses.length} assessments=${d.assignments.length} resources=${d.resourceCount} announcements=${d.announcementCount}`);
  lines.push(`exams: status=${d.exams.status} count=${d.exams.count} checked=${d.exams.checkedAt ?? "never"} error=${d.exams.error ? redact(d.exams.error).slice(0, 200) : "none"}`);
  lines.push("");
  lines.push("courses:");
  for (const c of d.courses) {
    const rows = d.assignments.filter((a) => a.courseId === c.id);
    const cats = rows.filter((a) => a.isCategory);
    const items = rows.filter((a) => !a.isCategory);
    const count = (f: (a: Assignment) => boolean) => items.filter(f).length;
    const shapes: Record<string, number> = {};
    items.forEach((a) => { const s = gradeShape(a.grade, a.gradeMax); shapes[s] = (shapes[s] ?? 0) + 1; });
    const g = buildCourseGrade(rows);
    lines.push(
      `- ${unitCode(c)} id=${c.id} rows=${rows.length} categories=${cats.length}` +
      ` [${cats.map((x) => x.categoryWeight ?? x.weight ?? "?").join(",")}]` +
      ` items=${items.length} graded=${count((a) => a.status === "graded")} submitted=${count((a) => a.status === "submitted")} pending=${count((a) => a.status === "pending" || a.status === "upcoming")}` +
      ` withMax=${count((a) => a.gradeMax != null)} linked=${count((a) => Boolean(a.url))} catIds=${count((a) => a.categoryId != null)}` +
      ` gradeShapes=${JSON.stringify(shapes)} weightTotal=${Math.round(g.totalWeight * 10) / 10} outcome=${g.outcome}`
    );
  }
  lines.push("");
  lines.push("portal log (redacted at source):");
  lines.push(d.portalLog.trim() ? redact(d.portalLog.trim()) : "(empty)");
  return lines.join("\n");
}
