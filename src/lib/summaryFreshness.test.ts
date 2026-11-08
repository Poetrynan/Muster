import { describe, it, expect } from "vitest";
import { computeCourseDataHash, computeDeadlineHash } from "./summaryFreshness";
import type { CourseDataHashInput, GenerationHashMetadata } from "./summaryFreshness";

describe("generation evidence freshness", () => {
  const evidence = {
    resources: [{ id: 1, name: "Worksheet", section: "Week 6", content: "Original body" }],
    assignments: [{ id: 2, name: "HW", status: "graded", grade: "7", gradeMax: 10, range: "0–10", weight: 20, category: "Labs", categoryId: 3, categoryWeight: 40, isCategory: false }],
    announcements: [{ id: 4, title: "Update", date: "2026-11-08", content: "Original announcement" }],
    unitInfoSections: [{ title: "Overview", contentHtml: "Original policy" }],
    gradeEntries: [{ courseId: 1, item: "HW", grade: "7", range: "0–10", feedback: "Original feedback" }],
    scheduleItems: [{ title: "Week 6", contentHtml: "Original schedule", rows: [{ cells: ["Monday", "Lab"] }] }],
  };
  const metadata = {
    selectedWeek: 6, localDate: "2026-11-08", timezone: "Asia/Singapore", language: "zh",
    model: "test-model", promptVersion: "guide-1", schemaVersion: 1,
    accountScope: "fictional", courseId: 1, availableMinutes: 60,
  };

  it("includes assignment grading and category changes in both hash surfaces", () => {
    for (const change of [{ grade: "8" }, { gradeMax: 20 }, { range: "0–20" }, { weight: 25 }, { category: "Project" }, { categoryId: 9 }, { categoryWeight: 50 }, { isCategory: true }]) {
      const assignments = [{ ...evidence.assignments[0], ...change }];
      expect(computeCourseDataHash({ ...evidence, assignments })).not.toBe(computeCourseDataHash(evidence));
      expect(computeDeadlineHash(assignments, [])).not.toBe(computeDeadlineHash(evidence.assignments, []));
    }
  });

  it("includes bodies, gradebook ranges and ordered schedule cells", () => {
    const changes: CourseDataHashInput[] = [
      { ...evidence, resources: [{ ...evidence.resources[0], content: "Updated body" }] },
      { ...evidence, announcements: [{ ...evidence.announcements[0], content: "Updated announcement" }] },
      { ...evidence, unitInfoSections: [{ title: "Overview", contentHtml: "Updated policy" }] },
      { ...evidence, gradeEntries: [{ ...evidence.gradeEntries[0], range: "0–20" }] },
      { ...evidence, gradeEntries: [{ ...evidence.gradeEntries[0], grade: "8" }] },
      { ...evidence, scheduleItems: [{ ...evidence.scheduleItems[0], rows: [{ cells: ["Lab", "Monday"] }] }] },
    ];
    for (const changed of changes) expect(computeCourseDataHash(changed)).not.toBe(computeCourseDataHash(evidence));
  });

  it("includes optional generation metadata and keeps old call signatures usable", () => {
    const changes: Partial<GenerationHashMetadata>[] = [
      { selectedWeek: 7 }, { localDate: "2026-11-09" }, { timezone: "UTC" }, { language: "en" },
      { model: "other" }, { promptVersion: "guide-2" }, { schemaVersion: 2 },
      { accountScope: "other" }, { courseId: 2 }, { availableMinutes: 90 },
    ];
    expect(computeCourseDataHash(evidence)).toMatch(/^[0-9a-f]{8}$/);
    for (const change of changes) {
      expect(computeCourseDataHash(evidence, { ...metadata, ...change })).not.toBe(computeCourseDataHash(evidence, metadata));
      expect(computeDeadlineHash(evidence.assignments, [], { ...metadata, ...change })).not.toBe(computeDeadlineHash(evidence.assignments, [], metadata));
    }
  });

  it("canonicalizes collections and object keys without mutating the input", () => {
    const input = {
      ...evidence,
      resources: [...evidence.resources, { id: 5, name: "Slides", section: "Week 6", content: "Slides" }],
      assignments: [...evidence.assignments, { ...evidence.assignments[0], id: 6, name: "Quiz" }],
      announcements: [...evidence.announcements, { ...evidence.announcements[0], id: 7 }],
      unitInfoTitles: ["Overview", "Policies"],
      gradeEntries: [...evidence.gradeEntries, { ...evidence.gradeEntries[0], item: "Quiz" }],
    };
    const before = JSON.stringify(input);
    const reordered = { ...input, resources: [...input.resources].reverse(), assignments: [...input.assignments].reverse(), announcements: [...input.announcements].reverse(), unitInfoTitles: [...input.unitInfoTitles].reverse(), gradeEntries: [...input.gradeEntries].reverse() };
    expect(computeCourseDataHash(reordered, { ...metadata })).toBe(computeCourseDataHash(input, metadata));
    expect(JSON.stringify(input)).toBe(before);
    expect(computeCourseDataHash({ resources: [{ name: "a|b", section: "c" }], assignments: [], announcements: [] })).not.toBe(computeCourseDataHash({ resources: [{ name: "a", section: "b|c" }], assignments: [], announcements: [] }));
  });
});

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
