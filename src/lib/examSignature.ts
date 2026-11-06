import type { ExamSchedule } from "../types";

/** Ignore response order and regenerated IDs; compare the actual exam arrangements. */
export function examSignature(exams: ExamSchedule[]): string {
  return JSON.stringify(exams.map(e => [
    e.courseCode.trim().toUpperCase(), e.courseName, e.examType,
    e.startAt || `${e.date}T${e.startTime}`, e.endAt || `${e.date}T${e.endTime}`,
    e.timezone || "", e.location.trim(), e.seatNumber || "", e.durationMinutes ?? null, e.instructions || "",
  ]).map(row => JSON.stringify(row)).sort());
}
