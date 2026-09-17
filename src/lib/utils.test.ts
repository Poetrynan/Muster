// TDD: isTermEnded must use proper Monash term-end dates, not a hard month cutoff.
// S1 runs ~late Feb to late June (incl. exams into early July).
// S2 runs ~late July to late Nov (incl. exams into early Dec).
// A course is "ended" only after its term's teaching + exams are done (buffered end date).
import { describe, it, expect } from "vitest";
import { isTermEnded, formatDate } from "./utils";

describe("isTermEnded (Monash calendar aware)", () => {
  it("marks last year's S2 course as ended (regression: S2 2025 in S2 2026)", () => {
    expect(isTermEnded("FIT4005-FIT5125 IT research and innovation methods - S2 2025")).toBe(true);
  });

  it("marks current term course as active", () => {
    expect(isTermEnded("FIT5201 Machine learning - S2 2026")).toBe(false);
  });

  it("handles cross-year thesis courses spanning into the future", () => {
    expect(isTermEnded("Thesis - S2 2026 - S1 2027")).toBe(false);
  });

  it("treats unknown-format course names as active (conservative)", () => {
    expect(isTermEnded("Moodle portal")).toBe(false);
    expect(isTermEnded(undefined)).toBe(false);
  });

  it("marks same-year previous semester as ended after exams", () => {
    expect(isTermEnded("Old course - S1 2026")).toBe(true);
  });
});

describe("formatDate localization", () => {
  const d = new Date(2026, 8, 18); // Sep 18, 2026
  it("formats date in English by default", () => {
    const formatted = formatDate(d, "en");
    expect(formatted).toContain("Sep");
    expect(formatted).toContain("18");
  });

  it("formats date in Chinese when specified", () => {
    const formatted = formatDate(d, "zh");
    expect(formatted).toContain("9月18日");
  });
});

