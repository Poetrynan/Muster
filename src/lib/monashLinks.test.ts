import { expect, it } from "vitest";
import { isMonashHost, opensInApp } from "./monashLinks";

it("treats Monash-owned hosts (all campuses) as signed-in hosts", () => {
  for (const host of [
    "monash.edu",
    "www.monash.edu",
    "learning.monash.edu",
    "eassessment.monash.edu",
    "my.monash.edu.au",
    "attendance.monash.edu.my",
    "home.student.monash",
  ]) {
    expect(isMonashHost(host), host).toBe(true);
  }
});

it("rejects look-alikes and third-party sites", () => {
  for (const host of ["notmonash.edu", "monash.edu.evil.com", "edstem.org", "monsu.org", "studentvip.com.au", "monashclubs.org"]) {
    expect(isMonashHost(host), host).toBe(false);
  }
});

it("only opens https Monash links in the app", () => {
  expect(opensInApp("https://home.student.monash/")).toBe(true);
  expect(opensInApp("https://www.monash.edu/students/admin/timetables/allocate/login")).toBe(true);
  expect(opensInApp("http://www.monash.edu/library")).toBe(false);
  expect(opensInApp("https://monsu.org/")).toBe(false);
  expect(opensInApp("not a url")).toBe(false);
});
