import { expect, it } from "vitest";
import { resolveSubmissionState } from "./submissionState";
it("shows graded when a quiz has a score but no submission flag", () => {
  expect(resolveSubmissionState({ submitted: false, grade: "15.90" })).toBe("graded");
});
it("keeps hidden grades graded and uses cached assessment evidence", () => {
  expect(resolveSubmissionState({ submitted: false, graded: true })).toBe("graded");
  expect(resolveSubmissionState({ submitted: false, grade: "-" }, { status: "graded" })).toBe("graded");
  expect(resolveSubmissionState({ submitted: false }, { grade: "0" })).toBe("graded");
});
it("distinguishes submitted work from genuinely unsubmitted work", () => {
  expect(resolveSubmissionState({ submitted: true, grade: "-" })).toBe("submitted");
  expect(resolveSubmissionState({ submitted: false }, { status: "submitted" })).toBe("submitted");
  expect(resolveSubmissionState({ submitted: false, grade: "—" })).toBe("notSubmitted");
});
