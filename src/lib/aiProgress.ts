import type { AiPlan } from "../types";

const taskKey = (task: AiPlan["days"][number]["tasks"][number]) =>
  JSON.stringify([task.text.trim().replace(/\s+/g, " "), task.weekRef?.trim() ?? ""]);

/** Carry completion across rescheduling; retain completed history omitted by the model. */
export function mergePlanProgress(previous: AiPlan | undefined, next: AiPlan): AiPlan {
  const completed = new Set(previous?.days.flatMap(d => d.tasks.filter(t => t.done).map(taskKey)) ?? []);
  const seen = new Set<string>();
  const days = next.days.map(d => ({ ...d, tasks: d.tasks.map(t => {
    const key = taskKey(t);
    seen.add(key);
    return { ...t, done: completed.has(key) };
  }) }));
  for (const day of previous?.days ?? []) {
    const tasks = day.tasks.filter(t => t.done && !seen.has(taskKey(t)));
    if (tasks.length) days.push({ ...day, tasks: tasks.map(t => ({ ...t, done: true })) });
  }
  return { ...next, days };
}
