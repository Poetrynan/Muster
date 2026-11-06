import { expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

const script = readFileSync(new URL("../../src-tauri/src/student_portal_capture.js", import.meta.url), "utf8");
it("intercepts the portal response without changing it or forwarding non-exam data", async () => {
  let delivered = "";
  const exam = { eventType: "exam", data: { unitCode: "FIT5201" } };
  const payload = { identity: "private", token: "never forward", errorFlags: { exams: 0, classes: 0 }, events: [exam, { eventType: "assignment", grade: 90 }] };
  const response = { status: 200, clone: () => ({ json: async () => payload }) };
  const original = async (_input) => response;
  const window = { top: null, fetch: original }; window.top = window;
  class XHR { open() {} }
  const location = { origin: "https://home.student.monash", href: "https://home.student.monash/", assign: (url) => { delivered = url; } };
  runInNewContext(script, { window, location, URL, Request, XMLHttpRequest: XHR });
  expect(await window.fetch("/api/student/userEvents?strict=false")).toBe(response);
  await Promise.resolve();
  const data = window.__musterPortalResult;
  expect(data.events).toEqual([exam]);
  expect(Object.keys(data).sort()).toEqual(["errorFlags", "events", "status"]);
  expect(data.errorFlags).toEqual({ exams: 0 });
  expect(delivered).toBe("");
  expect(JSON.stringify(data)).not.toContain("private");
  expect(delivered).not.toContain("never");
});
