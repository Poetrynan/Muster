import { expect, it } from "vitest";
import { mergePlanProgress } from "./aiProgress";

it("preserves completed tasks when rescheduled and keeps omitted completed tasks", () => {
  const old = { generatedAt: "old", days: [{ day: "Monday", tasks: [
    { text: "Read notes", weekRef: "W1", done: true },
    { text: "Finish lab", done: true }, { text: "Pending", done: false },
  ] }] };
  const result = mergePlanProgress(old, { generatedAt: "new", days: [{ day: "Tuesday", tasks: [
    { text: " Read  notes ", weekRef: "W1" }, { text: "New task" },
  ] }] });
  expect(result.days[0].tasks[0].done).toBe(true);
  expect(result.days[0].tasks[1].done).toBe(false);
  expect(result.days.flatMap(d => d.tasks).filter(t => t.text === "Finish lab")).toEqual([{ text: "Finish lab", done: true }]);
  expect(result.days.flatMap(d => d.tasks).some(t => t.text === "Pending")).toBe(false);
});
