import { expect, it } from "vitest";
import type { Assignment, Course } from "../services/api";
import { buildDiagnosticReport, redact } from "./diagnostics";

const course = { id: 46961, shortName: "FIT5201", fullName: "FIT5201 Machine learning - S2 2026", category: "", visible: true } as Course;
const rows: Assignment[] = [
  { id: 57, name: "1. Quiz / Test", courseId: 46961, status: "pending", isCategory: true, categoryId: 57, categoryWeight: 9, weight: 9 },
  { id: 1, name: "Quiz 1 secret title", courseId: 46961, status: "graded", grade: "11.00 / 13.00", url: "u", categoryId: 57, categoryWeight: 9, weight: 9 },
  { id: 2, name: "Quiz 4", courseId: 46961, status: "graded", grade: "10.00", url: "u", categoryId: 57, categoryWeight: 9, weight: 9 },
];

const report = () => buildDiagnosticReport({
  appVersion: "0.4.1", language: "zh", platform: "windows x86_64", courses: [course], assignments: rows,
  resourceCount: 12, announcementCount: 3,
  sync: { isRunning: false, lastSync: "2026-11-07T10:00:00Z", errors: ["Failed for student zzzz0001@student.monash.edu at https://learning.monash.edu/course/view.php?id=46961"] },
  exams: { status: "error", error: "PORTAL_EXAM_SCHEMA: exam 1/1: start=object{time:float}", count: 0 },
  portalLog: "2026-11-06T07:14:45Z sign-in: portal exam data unusable: PORTAL_EXAM_SCHEMA",
  context: "exam section error",
});

it("describes structure: counts, weights, grade shapes and error codes", () => {
  const r = report();
  expect(r).toContain("FIT5201 id=46961 rows=3 categories=1 [9] items=2 graded=2");
  expect(r).toContain('gradeShapes={"ratio":1,"bare-no-max":1}');
  expect(r).toContain("PORTAL_EXAM_SCHEMA");
  expect(r).toContain("context: exam section error");
});

it("never includes scores, item names or personal identifiers", () => {
  const r = report();
  expect(r).not.toMatch(/11\.00|10\.00|13\.00/);
  expect(r).not.toContain("secret title");
  expect(r).not.toContain("zzzz0001");
  expect(r).not.toContain("https://");
  expect(redact("id 46961123 a@b.co http://x")).toBe("id <id> <email> <url>");
});
