import { expect, it } from "vitest";
import { gradesForCourses } from "./gradeOverview";

// Mirrors the live overview: 5 units this term plus 3 non-unit sites.
const rows = [
  { unit: "Master and Honours Thesis - S1 2026 - S2 2026", grade: "-", courseId: 41163 },
  { unit: "Master and Honours Thesis - S2 2026 - S1 2027", grade: "-", courseId: 46817 },
  { unit: "FIT5122 Professional practice - S2 2026", grade: "-", courseId: 46900 },
  { unit: "FIT5201 Machine learning - S2 2026", grade: "HD", courseId: 46961 },
  { unit: "FIT5222 Planning and automated reasoning - S2 2026", grade: "-", courseId: 45044 },
  { unit: "IT Student Portal", grade: "-", courseId: 9680 },
  { unit: "MUM School of IT - General Student Hub", grade: "-", courseId: 42725 },
  { unit: "MUM School of IT - Postgraduate Student Hub", grade: "-", courseId: 42657 },
];
const shown = [41163, 46817, 46900, 46961, 45044].map((id) => ({ id }));

it("counts only the courses shown under My Courses", () => {
  const visible = gradesForCourses(rows, shown);
  expect(visible).toHaveLength(5);
  expect(visible.map((r) => r.courseId)).not.toContain(9680);
  expect(visible.filter((r) => r.grade !== "-")).toHaveLength(1);
});

it("matches rows cached without a course id by course name", () => {
  const legacy = rows.map(({ unit, grade }) => ({ unit, grade }));
  const visible = gradesForCourses(legacy, [{ id: 46961, fullName: "FIT5201  Machine learning - S2 2026" }]);
  expect(visible).toEqual([{ unit: "FIT5201 Machine learning - S2 2026", grade: "HD" }]);
  expect(gradesForCourses(undefined, shown)).toEqual([]);
});
