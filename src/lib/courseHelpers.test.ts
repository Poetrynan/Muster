// TDD: isCourseActiveForSemester — current-semester membership with truncated-name fallback.
// Regression for: assignments from past semesters landing in "overdue" because the
// persisted course name is the truncated Moodle dropdown text (no semester token).
import { describe, it, expect } from "vitest";
import { isCourseActiveForSemester } from "./courseHelpers";

const NOW = Date.now();
const daysAgo = (n: number) => NOW - n * 86_400_000;

describe("isCourseActiveForSemester", () => {
  it("current-semester course is active", () => {
    expect(isCourseActiveForSemester("FIT5201 Machine learning - S2 2026", "2026-S2")).toBe(true);
  });

  it("past-semester course is inactive even with full name (S2 2025 vs 2026-S2)", () => {
    expect(isCourseActiveForSemester("FIT5215 Deep learning - S2 2025", "2026-S2")).toBe(false);
    expect(isCourseActiveForSemester("FIT5047\tFundamentals of artificial intelligence - MUM S2 2025", "2026-S2")).toBe(false);
  });

  it("cross-semester thesis spanning current term is active", () => {
    expect(isCourseActiveForSemester("Master and Honours Thesis - S1 2026 - S2 2026", "2026-S2")).toBe(true);
  });

  it("unparseable name (portal) with no due-date evidence is active (conservative)", () => {
    expect(isCourseActiveForSemester("Moodle portal", "2026-S2")).toBe(true);
    expect(isCourseActiveForSemester(undefined, "2026-S2")).toBe(true);
  });

  it("TRUNCATED dropdown name + very old due date => inactive (the FIT4005 bug)", () => {
    expect(
      isCourseActiveForSemester("FIT4005-FIT5125 IT research and innovation meth...", "2026-S2", daysAgo(400))
    ).toBe(false);
  });

  it("truncated name with recent due date stays active", () => {
    expect(
      isCourseActiveForSemester("FIT4005-FIT5125 IT research and innovation meth...", "2026-S2", daysAgo(3))
    ).toBe(true);
  });
});
