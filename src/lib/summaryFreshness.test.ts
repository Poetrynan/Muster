import { describe, it, expect } from "vitest";
import { computeCourseDataHash, computeDeadlineHash } from "./summaryFreshness";

describe("computeCourseDataHash", () => {
  const base = {
    resources: [
      { name: "Lecture 6 slides", section: "Week 6" },
      { name: "Lab 6 worksheet", section: "Week 6" },
    ],
    assignments: [{ name: "HW1", dueDateIso: "2026-09-20", status: "pending" }],
    announcements: [{ id: 7, title: "HW1 clarifications", date: "2026-09-14" }],
    unitInfoTitles: ["Overview"],
  };

  it("is stable for identical input", () => {
    expect(computeCourseDataHash(base)).toBe(computeCourseDataHash({ ...base }));
  });

  it("changes when a resource is added or renamed", () => {
    const added = computeCourseDataHash({
      ...base,
      resources: [...base.resources, { name: "New file", section: "Week 7" }],
    });
    const renamed = computeCourseDataHash({
      ...base,
      resources: [{ name: "Lecture 6 slides v2", section: "Week 6" }, base.resources[1]],
    });
    expect(added).not.toBe(computeCourseDataHash(base));
    expect(renamed).not.toBe(computeCourseDataHash(base));
  });

  it("changes when an assignment due date or status changes", () => {
    const due = computeCourseDataHash({
      ...base,
      assignments: [{ name: "HW1", dueDateIso: "2026-09-25", status: "pending" }],
    });
    const status = computeCourseDataHash({
      ...base,
      assignments: [{ name: "HW1", dueDateIso: "2026-09-20", status: "submitted" }],
    });
    expect(due).not.toBe(computeCourseDataHash(base));
    expect(status).not.toBe(computeCourseDataHash(base));
  });

  it("changes when an announcement is added", () => {
    const more = computeCourseDataHash({
      ...base,
      announcements: [...base.announcements, { id: 8, title: "New", date: "2026-09-15" }],
    });
    expect(more).not.toBe(computeCourseDataHash(base));
  });

  it("returns a stable value for empty input", () => {
    const empty = { resources: [], assignments: [], announcements: [], unitInfoTitles: [] };
    expect(computeCourseDataHash(empty)).toBe(computeCourseDataHash(empty));
    expect(computeCourseDataHash(empty)).toMatch(/^[0-9a-f]{8}$/);
  });
});

describe("computeDeadlineHash", () => {
  const base = {
    assignments: [{ id: 1, name: "HW1", dueDateIso: "2026-09-20", status: "pending" }],
    calendarEvents: [{ id: 5, title: "Quiz 1 close", timestamp: 1758300000, eventType: "close" }],
  };

  it("is stable for identical input", () => {
    expect(computeDeadlineHash(base.assignments, base.calendarEvents)).toBe(
      computeDeadlineHash(base.assignments, base.calendarEvents)
    );
  });

  it("changes when a deadline moves or status changes", () => {
    const moved = computeDeadlineHash(
      [{ id: 1, name: "HW1", dueDateIso: "2026-09-28", status: "pending" }],
      base.calendarEvents
    );
    expect(moved).not.toBe(computeDeadlineHash(base.assignments, base.calendarEvents));
  });

  it("changes when a calendar event is added", () => {
    const more = computeDeadlineHash(base.assignments, [
      ...base.calendarEvents,
      { id: 6, title: "New quiz", timestamp: 1758900000, eventType: "due" },
    ]);
    expect(more).not.toBe(computeDeadlineHash(base.assignments, base.calendarEvents));
  });

  it("ignores open events (they are not deadlines)", () => {
    const withOpen = computeDeadlineHash(base.assignments, [
      ...base.calendarEvents,
      { id: 7, title: "Week 7 opens", timestamp: 1758900000, eventType: "open" },
    ]);
    expect(withOpen).toBe(computeDeadlineHash(base.assignments, base.calendarEvents));
  });
});
