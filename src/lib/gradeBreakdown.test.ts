import { describe, expect, it } from "vitest";
import type { Assignment } from "../services/api";
import { buildCourseGrade, parseScorePercent, fmtPoints } from "./gradeBreakdown";

let nextId = 1000;
const cat = (id: number, name: string, category: string, weight?: number): Assignment => ({
  id, name, courseId: 1, status: "pending", isCategory: true, category, weight, categoryWeight: weight, categoryId: id,
});
const item = (categoryId: number, weight: number | undefined, status: Assignment["status"], grade?: string, gradeMax?: number): Assignment => ({
  id: nextId++, name: `item ${nextId}`, courseId: 1, status, grade, gradeMax, url: "https://x/mod/assign/view.php?id=1",
  isCategory: false, category: "x", weight, categoryWeight: weight, categoryId,
});

describe("parseScorePercent", () => {
  it("reads the formats Moodle produces", () => {
    expect(parseScorePercent("80.25 / 100.00")).toBeCloseTo(80.25);
    expect(parseScorePercent("11.00 out of 13.00")).toBeCloseTo(84.615, 2);
    expect(parseScorePercent("85%")).toBe(85);
    expect(parseScorePercent("80.25", 100)).toBeCloseTo(80.25);
    expect(parseScorePercent("6", 8)).toBe(75);
  });
  it("never guesses", () => {
    expect(parseScorePercent("80.25")).toBeNull(); // bare score without a known maximum
    expect(parseScorePercent("HD")).toBeNull();
    expect(parseScorePercent("-")).toBeNull();
    expect(parseScorePercent(undefined)).toBeNull();
  });
});

describe("FIT5201: Quiz/Test 9%, Artefact 25%, Artefact 16%, Examination 50%", () => {
  const rows = [
    cat(57, "1. Quiz / Test", "Quiz / Test", 9),
    item(57, 9, "graded", "11.00", 13), item(57, 9, "graded", "8.00", 9), item(57, 9, "graded", "6.00", 7), item(57, 9, "graded", "7.00", 8),
    cat(58, "2. Artefact", "Artefact", 25),
    item(58, 25, "graded", "80.25", 100),
    cat(59, "3. Artefact", "Artefact", 16),
    item(59, 16, "submitted"),
    cat(60, "4. Examination", "Examination", 50),
  ];
  const g = buildCourseGrade(rows);

  it("shows four blocks, keeping the two 'Artefact' categories apart", () => {
    expect(g.categories.map((c) => [c.name, c.weight])).toEqual([["Quiz / Test", 9], ["Artefact", 25], ["Artefact", 16], ["Examination", 50]]);
    expect(g.weightsComplete).toBe(true);
  });
  it("splits the quiz weight equally instead of summing 4 × 9%", () => {
    const quiz = g.categories[0];
    expect(quiz.items.map((i) => i.share)).toEqual([2.25, 2.25, 2.25, 2.25]);
    expect(quiz.earned).toBeCloseTo(2.25 * (11 / 13 + 8 / 9 + 6 / 7 + 7 / 8), 5);
  });
  it("computes what is still needed to reach 50", () => {
    expect(g.gradedWeight).toBeCloseTo(34);
    expect(g.pendingWeight).toBeCloseTo(66); // submitted Assessment 2 + unpublished exam
    expect(g.earned).toBeCloseTo(7.8 + 20.0625, 1);
    expect(g.needed).toBeCloseTo(50 - g.earned, 5);
    expect(g.requiredAverage).toBeCloseTo((g.needed / 66) * 100, 5);
    expect(g.outcome).toBe("on-track");
  });
});

describe("FIT5122: Exercise 40% (10 items), Demonstration 25%, Project 35%, unweighted supplementary", () => {
  const rows = [
    cat(57, "1. Exercise", "Exercise", 40),
    ...Array.from({ length: 10 }, () => item(57, 40, "graded", "9 / 10")),
    cat(58, "2. Demonstration", "Demonstration", 25),
    ...Array.from({ length: 3 }, () => item(58, 25, "graded", "8 / 10")),
    cat(59, "3. Project", "Project", 35),
    item(59, 35, "submitted"), item(59, 35, "pending"),
    cat(60, "Supplementary assessment", "Supplementary assessment", undefined),
  ];
  const g = buildCourseGrade(rows);

  it("ignores the unweighted supplementary category", () => {
    expect(g.categories.map((c) => c.name)).toEqual(["Exercise", "Demonstration", "Project"]);
    expect(g.totalWeight).toBe(100);
  });
  it("marks the pass as secured once 50 is earned", () => {
    expect(g.categories[0].items[0].share).toBe(4);
    expect(g.earned).toBeCloseTo(36 + 20);
    expect(g.needed).toBe(0);
    expect(g.outcome).toBe("passed");
  });
});

describe("caches synced before v0.4 (no isCategory / categoryId / gradeMax)", () => {
  // Shape of the real cached rows: category rows have no url and a "N. " prefix; children
  // inherit the full category weight; names repeat. Scores are made up.
  const legacy = (name: string, weight: number | undefined, category: string, status: Assignment["status"], grade?: string, url = true): Assignment => ({
    id: nextId++, name, courseId: 1, status, grade, weight, category, url: url ? "https://x/mod/assign/view.php?id=9" : undefined,
  });
  it("FIT5222: keeps the two 'Project' and two 'Quiz / Test' categories apart by order", () => {
    const g = buildCourseGrade([
      legacy("1. Project", 32, "Project", "pending", undefined, false),
      legacy("Warm-up", 32, "Project", "pending"), legacy("Challenge", 32, "Project", "graded", "50.00 / 100.00"),
      legacy("2. Project", 32, "Project", "pending", undefined, false),
      legacy("Group project (Weight: 32%)", 32, "Project", "submitted"), legacy("Presentation", 32, "Project", "pending"),
      legacy("3. Quiz / Test", 18, "Quiz / Test", "pending", undefined, false),
      legacy("Test 1 (18%)", 18, "Quiz / Test", "graded", "12.00"),
      legacy("4. Quiz / Test", 18, "Quiz / Test", "pending", undefined, false),
      legacy("Test 2 (18%)", 18, "Quiz / Test", "graded", "15.00"),
    ]);
    expect(g.categories.map((c) => [c.name, c.weight, c.items.length])).toEqual([
      ["Project", 32, 2], ["Project", 32, 2], ["Quiz / Test", 18, 1], ["Quiz / Test", 18, 1],
    ]);
    expect(g.totalWeight).toBe(100);
    expect(g.earned).toBeCloseTo(8); // 16% share × 50%
    // Bare test scores without a known maximum stay "hidden" until a resync fills gradeMax.
    expect(g.hiddenWeight).toBe(36);
  });
  it("FIT5201: A1 and A2 stay in their own 'Artefact' categories", () => {
    const g = buildCourseGrade([
      legacy("2. Artefact", 25, "Artefact", "pending", undefined, false),
      legacy("Assignment 1", 25, "Artefact", "graded", "80.00 / 100.00"),
      legacy("3. Artefact", 16, "Artefact", "pending", undefined, false),
      legacy("Assessment 2", 16, "Artefact", "submitted"),
    ]);
    expect(g.categories.map((c) => [c.weight, c.items.map((i) => i.name)])).toEqual([[25, ["Assignment 1"]], [16, ["Assessment 2"]]]);
    expect(g.earned).toBeCloseTo(20);
    expect(g.pendingWeight).toBeCloseTo(16);
  });
  it("FIT5122: the unnumbered, unweighted supplementary row doesn't join 'Project'", () => {
    const g = buildCourseGrade([
      legacy("3. Project", 35, "Project", "pending", undefined, false),
      legacy("Business Report", 35, "Project", "submitted"), legacy("Professional Conversation", 35, "Project", "pending"),
      { id: nextId++, name: "Supplementary assessment", courseId: 1, status: "pending" },
    ]);
    expect(g.categories.map((c) => [c.name, c.items.length])).toEqual([["Project", 2]]);
    expect(g.categories[0].items[0].share).toBe(17.5);
  });
});

describe("Master thesis: five copies of the structure, weights in item names", () => {
  const named = (categoryId: number, name: string, weight: number, status: Assignment["status"], grade?: string, gradeMax?: number): Assignment => ({
    ...item(categoryId, weight, status, grade, gradeMax), name,
  });
  const rows: Assignment[] = [
    cat(26, "1. Demonstration", "Demonstration", 15),
    named(26, "Literature Review + Proposal Submission (15%)", 15, "graded", "80.00", 100),
    named(26, "Interim Presentation Video File Submission (Part One)", 15, "submitted"),
    named(26, "Interim Presentation Discussion Forum (Part Two)", 15, "pending"),
    cat(27, "2. Written", "Written", 80),
    named(27, "Final Thesis Paper (80%)", 80, "submitted"),
    cat(28, "3. Artefact", "Artefact", 5),
    named(28, "Final Presentation Video Submission (5%)", 5, "pending"),
    // The page repeats the category set four more times with no items under them.
    ...[29, 32, 35, 38].flatMap((id) => [cat(id, "1. Artefact", "Artefact", 15), cat(id + 1, "2. Presentation", "Presentation", 5), cat(id + 2, "3. Written", "Written", 80)]),
  ];
  const g = buildCourseGrade(rows);

  it("drops the empty duplicate structures instead of totalling 500%", () => {
    expect(g.categories.map((c) => [c.name, c.weight])).toEqual([["Demonstration", 15], ["Written", 80], ["Artefact", 5]]);
    expect(g.totalWeight).toBe(100);
    expect(g.weightsComplete).toBe(true);
  });
  it("uses the weight stated in an item's name", () => {
    expect(g.categories[0].items.map((i) => i.share)).toEqual([15, 0, 0]);
    expect(g.earned).toBeCloseTo(12);
    expect(g.pendingWeight).toBeCloseTo(85);
  });
  it("falls back to an equal split when stated weights exceed the category", () => {
    const odd = buildCourseGrade([cat(1, "1. A", "A", 10), named(1, "Part (8%)", 10, "pending"), named(1, "Part (7%)", 10, "pending")]);
    expect(odd.categories[0].items.map((i) => i.share)).toEqual([5, 5]);
  });
});

describe("edge cases", () => {
  it("keeps graded-but-hidden scores out of both earned and remaining", () => {
    const g = buildCourseGrade([cat(1, "1. Essay", "Essay", 60), item(1, 60, "graded"), cat(2, "2. Exam", "Exam", 40)]);
    expect(g.hiddenWeight).toBe(60);
    expect(g.earned).toBe(0);
    expect(g.pendingWeight).toBe(40);
    expect(g.outcome).toBe("not-started");
  });
  it("flags when 50 can no longer be reached", () => {
    const g = buildCourseGrade([cat(1, "1. A", "A", 70), item(1, 70, "graded", "20 / 100"), cat(2, "2. B", "B", 30)]);
    expect(g.earned).toBeCloseTo(14);
    expect(g.outcome).toBe("unreachable");
  });
  it("flags a high required average as at risk", () => {
    const g = buildCourseGrade([cat(1, "1. A", "A", 50), item(1, 50, "graded", "40 / 100"), cat(2, "2. B", "B", 50)]);
    expect(g.requiredAverage).toBeCloseTo(60);
    expect(g.outcome).toBe("at-risk");
  });
  it("falls back to per-item weights on older templates", () => {
    const legacy: Assignment[] = [
      { id: 1, name: "Assignment 1 (30%)", courseId: 1, status: "graded", grade: "70 / 100", weight: 30, category: "Written", url: "u" },
      { id: 2, name: "Exam", courseId: 1, status: "pending", weight: 70, category: "Exam", url: "u" },
    ];
    const g = buildCourseGrade(legacy);
    expect(g.categories.map((c) => [c.name, c.weight])).toEqual([["Written", 30], ["Exam", 70]]);
    expect(g.earned).toBeCloseTo(21);
  });
  it("reports no data without weights", () => {
    expect(buildCourseGrade([]).outcome).toBe("no-data");
    expect(fmtPoints(32.44)).toBe("32.4");
    expect(fmtPoints(50)).toBe("50");
  });
});
