import { expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
const source = readFileSync(new URL("../../src-tauri/src/student_portal_snapshot.js", import.meta.url), "utf8");

it("recovers the authenticated account and refresh credential without navigation or access token export", () => {
  const user = { email: "student@monash.edu", uid: "u1", apiKey: "key", stsTokenManager: { refreshToken: "secret", accessToken: "no-export" } };
  const storage = { length: 1, key: () => "firebase:authUser:key:[DEFAULT]", getItem: () => JSON.stringify(user) };
  const result = runInNewContext(source, { location: { origin: "https://home.student.monash", hostname: "home.student.monash" }, window: { __musterPortalResult: { status: 200, events: [] } }, document: { readyState: "complete" }, sessionStorage: storage, localStorage: { length: 0 } });
  expect(result.session.email).toBe("student@monash.edu");
  expect(result.session.refreshToken).toBe("secret");
  expect(JSON.stringify(result)).not.toContain("no-export");
});
it("reports an actual sign-in form separately from a loading portal", () => {
  const result = runInNewContext(source, { location: { origin: "https://monashuni.okta.com", hostname: "monashuni.okta.com" }, document: { readyState: "complete", querySelector: () => ({}) } });
  expect(result.needsInteraction).toBe(true);
  expect(result.session).toBeUndefined();
});
