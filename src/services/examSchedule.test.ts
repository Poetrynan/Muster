import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useAppStore } from "../stores/useAppStore";
import { refreshExamSchedule, examErrorKey } from "./examSchedule";
import { fetchExams } from "./api";
vi.mock("./idbStorage", () => ({ idbStorage: { getItem: async () => null, setItem: async () => {}, removeItem: async () => {} } }));
vi.mock("./api", () => ({ fetchExams: vi.fn() }));
beforeEach(() => { useAppStore.getState().reset(); vi.clearAllMocks(); vi.mocked(fetchExams).mockReset(); });
afterEach(() => vi.useRealTimers());
it("throttles automatic checks after failures, including repeated focus events", async () => {
  vi.useFakeTimers();
  vi.mocked(fetchExams).mockRejectedValueOnce(new Error("PORTAL_NETWORK_ERROR")).mockResolvedValue([]);
  await refreshExamSchedule();
  await refreshExamSchedule();
  vi.advanceTimersByTime(299_999);
  await refreshExamSchedule();
  expect(fetchExams).toHaveBeenCalledTimes(1);
  vi.advanceTimersByTime(1);
  await refreshExamSchedule();
  expect(fetchExams).toHaveBeenCalledTimes(2);
});
it("never labels capture timeouts and network errors as expired SSO", () => {
  expect(examErrorKey("PORTAL_CAPTURE_TIMEOUT")).toBe("dashboard.examsCaptureFailed");
  expect(examErrorKey("PORTAL_NETWORK_ERROR")).toBe("dashboard.examsNetworkFailed");
  expect(examErrorKey("PORTAL_LOGIN_REQUIRED")).toBe("dashboard.examsLoginRequired");
  expect(examErrorKey("PORTAL_ACCOUNT_MISMATCH")).toBe("dashboard.examsAccountMismatch");
});
it("leaves loading on failure and retains the last successful exams", async () => {
  useAppStore.getState().setExams([{ id: "old" } as never]);
  vi.mocked(fetchExams).mockRejectedValueOnce(new Error("PORTAL_LOGIN_REQUIRED"));
  await refreshExamSchedule(true);
  expect(useAppStore.getState().examLoadStatus).toBe("error");
  expect(useAppStore.getState().examError).toContain("PORTAL_LOGIN_REQUIRED");
  expect(useAppStore.getState().exams[0].id).toBe("old");
});
it("fetches on first launch, deduplicates concurrent requests and records a valid empty response", async () => {
  let resolve!: (value: []) => void;
  vi.mocked(fetchExams).mockImplementationOnce(() => new Promise(r => { resolve = r; }));
  const first = refreshExamSchedule(); const second = refreshExamSchedule();
  expect(useAppStore.getState().examLoadStatus).toBe("loading");
  resolve([]); await Promise.all([first, second]);
  expect(fetchExams).toHaveBeenCalledTimes(1);
  expect(useAppStore.getState().examLoadStatus).toBe("success");
  expect(useAppStore.getState().examsFetched).toBe(true);
  expect(useAppStore.getState().examsFetchedAt).toBeTruthy();
});
it("does not let a response arriving after logout repopulate the account cache", async () => {
  let resolve!: (value: []) => void;
  vi.mocked(fetchExams).mockImplementationOnce(() => new Promise(r => { resolve = r; }));
  const pending = refreshExamSchedule(); useAppStore.getState().reset(); resolve([]); await pending;
  expect(useAppStore.getState().examsFetched).toBe(false);
});
it("reuses fresh data silently but refreshes explicitly and retries after failure", async () => {
  vi.useFakeTimers();
  useAppStore.getState().setExams([]);
  await refreshExamSchedule();
  expect(fetchExams).not.toHaveBeenCalled();
  vi.mocked(fetchExams).mockRejectedValueOnce(new Error("offline"));
  await refreshExamSchedule(true);
  vi.mocked(fetchExams).mockResolvedValueOnce([]);
  vi.advanceTimersByTime(300_000);
  await refreshExamSchedule(true);
  expect(fetchExams).toHaveBeenCalledTimes(2);
  expect(useAppStore.getState().examLoadStatus).toBe("success");
});
it("automatically checks after restart but preserves an unchanged timetable", async () => {
  useAppStore.getState().setExams([]);
  const cached = useAppStore.getState().exams;
  useAppStore.setState({ examLoadStatus: "idle", examsFetchedAt: "2020-01-01T00:00:00Z" });
  vi.mocked(fetchExams).mockResolvedValueOnce([]);
  await refreshExamSchedule();
  expect(fetchExams).toHaveBeenCalledTimes(1);
  expect(useAppStore.getState().exams).toBe(cached);
  expect(useAppStore.getState().examsCheckedAt).toBeTruthy();
});

it("returns to unified login on an expired portal session without losing study progress", async () => {
  useAppStore.getState().setUser({ id: 1, username: "student", fullName: "Student", email: "student@monash.edu", profileImage: "" });
  useAppStore.getState().setLoggedIn(true);
  useAppStore.getState().setCoursePlan(1, { generatedAt: "today", days: [] });
  vi.mocked(fetchExams).mockRejectedValueOnce(new Error("PORTAL_LOGIN_REQUIRED"));
  await refreshExamSchedule(true);
  expect(useAppStore.getState().isLoggedIn).toBe(false);
  expect(useAppStore.getState().reauthReason).toBe("portal");
  expect(useAppStore.getState().aiInsights.plans[1]).toBeDefined();
});
it("treats unreadable portal exam data as a data error, not expired sign-in", async () => {
  useAppStore.getState().setUser({ id: 1, username: "student", fullName: "Student", email: "student@monash.edu", profileImage: "" });
  useAppStore.getState().setLoggedIn(true);
  useAppStore.getState().setExams([{ id: "old" } as never]);
  const error = "PORTAL_EXAM_SCHEMA: exam 1/2 (eventKind=standard): start.time is not an integer; start=object{time:string}, end=object{time:integer}";
  expect(examErrorKey(error)).toBe("dashboard.examsDataUnavailable");
  expect(examErrorKey("PORTAL_EXAM_UNAVAILABLE")).toBe("dashboard.examsDataUnavailable");
  vi.mocked(fetchExams).mockRejectedValueOnce(error);
  await refreshExamSchedule(true);
  expect(useAppStore.getState().isLoggedIn).toBe(true);
  expect(useAppStore.getState().examLoadStatus).toBe("error");
  expect(useAppStore.getState().exams[0].id).toBe("old");
});
it("keeps the cached array after HTTP 304 and updates it only when the arrangement changes", async () => {
  vi.useFakeTimers();
  const exam = { id: "e1", courseCode: "FIT5201", courseName: "Machine learning", examType: "Final", date: "2026-11-16", startTime: "08:00", endTime: "10:10", location: "Room 1" };
  useAppStore.getState().setExams([exam]);
  const cached = useAppStore.getState().exams;
  vi.mocked(fetchExams).mockResolvedValueOnce(null);
  await refreshExamSchedule(true);
  expect(useAppStore.getState().exams).toBe(cached);
  vi.mocked(fetchExams).mockResolvedValueOnce([{ ...exam, id: "regenerated-id" }]);
  vi.advanceTimersByTime(300_000);
  await refreshExamSchedule(true);
  expect(useAppStore.getState().exams).toBe(cached);
  vi.mocked(fetchExams).mockResolvedValueOnce([{ ...exam, startTime: "09:00" }]);
  vi.advanceTimersByTime(300_000);
  await refreshExamSchedule(true);
  expect(useAppStore.getState().exams[0].startTime).toBe("09:00");
  expect(useAppStore.getState().exams).not.toBe(cached);
});
