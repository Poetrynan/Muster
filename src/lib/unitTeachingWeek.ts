import type { AcademicTerm, Course, UnitWeek } from "../services/api";
import { parseSemester } from "./courseHelpers";

const months = [
  "january", "february", "march", "april", "may", "june",
  "july", "august", "september", "october", "november", "december",
];

function parseMoodleDay(text: string): number | null {
  const match = text.match(/^(?:[a-z]+,?\s+)?(\d{1,2})\s+([a-z]+)\s+(\d{2}|\d{4})$/i);
  if (!match) return null;
  const [, dayText, monthText, yearText] = match;
  const monthName = monthText.toLowerCase();
  const month = months.findIndex((name) => name === monthName || name.slice(0, 3) === monthName);
  if (month < 0) return null;
  const year = Number(yearText) + (yearText.length === 2 ? 2000 : 0);
  const day = Number(dayText);
  const date = new Date(year, month, day);
  return date.getMonth() === month && date.getDate() === day ? date.getTime() : null;
}

/** Moodle's focus can point to a past or future module. Verify its local dates before calling it current. */
export function getCurrentTeachingWeek(week: UnitWeek | null | undefined, now = new Date()): UnitWeek | null {
  if (!week?.dates) return null;
  const range = week.dates.trim().split(/\s*[-–—]\s*/);
  if (range.length !== 2) return null;
  const start = parseMoodleDay(range[0]);
  const end = parseMoodleDay(range[1]);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  return start != null && end != null && start <= today && today <= end ? week : null;
}

export type TeachingWeek =
  | { status: "before" | "break" | "ended" | "unknown" }
  | { status: "teaching"; number: number; focus: UnitWeek | null };

const dayMs = 86_400_000;

export function resolveTeachingWeek(
  course: Pick<Course, "fullName" | "shortName"> | null | undefined,
  week: UnitWeek | null | undefined,
  calendar: readonly AcademicTerm[],
  now = new Date(),
): TeachingWeek {
  const fullSemester = parseSemester(course?.fullName ?? "");
  const semester = fullSemester.key === "other" ? parseSemester(course?.shortName ?? "") : fullSemester;
  const courseNames = `${course?.fullName ?? ""} ${course?.shortName ?? ""}`;
  const standardSemester = !semester.isCrossSemester && !/\b(extended|northern|trimester|monash online)\b/i.test(courseNames);
  const term = standardSemester ? calendar.find((item) => item.key === semester.key) : undefined;
  const focus = getCurrentTeachingWeek(week, now);
  if (!term) {
    return focus ? { status: "teaching", number: focus.num, focus } : { status: "unknown" };
  }

  // Calendar arithmetic uses days, so DST changes cannot move a teaching week.
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) / dayMs;
  const start = Date.parse(term.teachingStart) / dayMs;
  const end = Date.parse(term.teachingEnd) / dayMs;
  if (today < start) return { status: "before" };
  if (today > end) return { status: "ended" };

  const breakStart = Date.parse(term.breakStart) / dayMs;
  const breakEnd = Date.parse(term.breakEnd) / dayMs;
  const elapsedWeeks = Math.floor((today - start) / 7);
  const firstBreakWeek = Math.floor((breakStart - start) / 7);
  const lastBreakWeek = Math.floor((breakEnd - start) / 7);
  if (elapsedWeeks >= firstBreakWeek && elapsedWeeks <= lastBreakWeek) return { status: "break" };

  const skipped = elapsedWeeks > lastBreakWeek ? lastBreakWeek - firstBreakWeek + 1 : 0;
  const number = elapsedWeeks + 1 - skipped;
  return { status: "teaching", number, focus: focus?.num === number ? focus : null };
}

export function getLearningWeekNumber(label: string): number | null {
  const match = label.match(/\bWeek\s+(\d+)\b/i);
  return match ? Number(match[1]) : null;
}
