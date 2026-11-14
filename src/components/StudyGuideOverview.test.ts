import { expect, it } from "vitest";
import { doneActionIds, isUpcomingDue } from "./StudyGuideOverview";

it("collects actions ticked as done in any guide view", () => {
  const done = doneActionIds({
    '["a",10,"2026-11-09"]': { "assign:7:action": { done: true }, "assign:8:action": { done: false } },
    '["a",11,"2026-11-16"]': { "event:3:action": { done: true }, "plan:1": undefined },
  });
  expect([...done].sort()).toEqual(["assign:7:action", "event:3:action"]);
});

const now = new Date("2026-11-14T10:00:00Z");

it("keeps work that is still due", () => {
  expect(isUpcomingDue("2026-11-16T12:00:00Z", now)).toBe(true);
  expect(isUpcomingDue("2026-11-14T10:00:00Z", now)).toBe(true);
});

it("drops work whose deadline has passed from the home 'what's next' card", () => {
  expect(isUpcomingDue("2026-11-13T06:55:00Z", now)).toBe(false);
});

it("drops items without a usable date", () => {
  expect(isUpcomingDue("", now)).toBe(false);
  expect(isUpcomingDue("unknown", now)).toBe(false);
});
