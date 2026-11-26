import { describe, expect, it } from "vitest";
import { getCurrentTeachingWeek, resolveTeachingWeek } from "./unitTeachingWeek";
import { bundledAcademicTerms } from "./academicCalendar";

const week = {
  num: 1,
  title: "Module 1",
  dates: "Sun 26 July 26 - Sat 1 Aug 26",
};

describe("getCurrentTeachingWeek", () => {
  it("rejects FIT5201's July focus card after the semester", () => {
    expect(getCurrentTeachingWeek(week, new Date(2026, 10, 26))).toBeNull();
  });

  it("keeps both endpoints of a Moodle teaching week", () => {
    expect(getCurrentTeachingWeek(week, new Date(2026, 6, 26))).toBe(week);
    expect(getCurrentTeachingWeek(week, new Date(2026, 7, 1, 23, 59))).toBe(week);
    expect(getCurrentTeachingWeek(week, new Date(2026, 7, 2))).toBeNull();
    expect(getCurrentTeachingWeek(week, new Date(2026, 6, 25))).toBeNull();
  });

  it("only calls a week current when Moodle supplies valid dates", () => {
    const now = new Date(2026, 6, 28);
    expect(getCurrentTeachingWeek({ ...week, dates: null }, now)).toBeNull();
    expect(getCurrentTeachingWeek({ ...week, dates: "31 Jun 2026 – 1 Aug 2026" }, now)).toBeNull();
    const fullYear = { ...week, dates: "Sunday, 26 July 2026 – Saturday, 1 August 2026" };
    expect(getCurrentTeachingWeek(fullYear, now)).toBe(fullYear);
  });
});

describe("Monash calendar teaching weeks", () => {
  const course = { fullName: "FIT5201 Machine learning - S2 2026", shortName: "FIT5201" };
  const resolve = (month: number, day: number) =>
    resolveTeachingWeek(course, week, bundledAcademicTerms, new Date(2026, month - 1, day));

  it("uses the official start when Moodle opens the first module a day earlier", () => {
    expect(resolve(7, 26)).toEqual({ status: "before" });
    expect(resolve(7, 27)).toEqual({ status: "teaching", number: 1, focus: week });
  });

  it("keeps the whole break out of the count and resumes with Week 9", () => {
    expect(resolve(9, 20)).toEqual({ status: "teaching", number: 8, focus: null });
    expect(resolve(9, 21)).toEqual({ status: "break" });
    expect(resolve(9, 27)).toEqual({ status: "break" });
    expect(resolve(9, 28)).toEqual({ status: "teaching", number: 9, focus: null });
  });

  it("never uses an inconsistent Moodle focus to label an official week", () => {
    const misleading = { ...week, dates: "Sun 27 Sep 26 - Sat 3 Oct 26" };
    const shortNameOnly = { fullName: "Machine learning", shortName: "FIT5201 S2 2026" };
    expect(resolveTeachingWeek(shortNameOnly, misleading, bundledAcademicTerms, new Date(2026, 8, 28)))
      .toEqual({ status: "teaching", number: 9, focus: null });
  });

  it("stops after the last teaching day, including during exams", () => {
    expect(resolve(10, 23)).toEqual({ status: "teaching", number: 12, focus: null });
    expect(resolve(10, 24)).toEqual({ status: "ended" });
    expect(resolve(11, 8)).toEqual({ status: "ended" });
    expect(resolve(11, 26)).toEqual({ status: "ended" });
  });

  it("falls back to dated Moodle focus for a nonstandard teaching period", () => {
    const winter = { ...course, fullName: "FIT0001 Winter 2026" };
    expect(resolveTeachingWeek(winter, week, bundledAcademicTerms, new Date(2026, 6, 26)))
      .toEqual({ status: "teaching", number: 1, focus: week });
    const extended = { ...course, fullName: "FIT0001 Extended – S2 2026" };
    expect(resolveTeachingWeek(extended, week, bundledAcademicTerms, new Date(2026, 6, 26)))
      .toEqual({ status: "teaching", number: 1, focus: week });
  });
});
