import { beforeEach, describe, expect, it, vi } from "vitest";
import { useAppStore } from "./useAppStore";

vi.mock("../services/idbStorage", () => ({ idbStorage: {
  getItem: async () => null, setItem: async () => {}, removeItem: async () => {},
} }));

describe("AI progress persistence", () => {
  beforeEach(() => useAppStore.getState().reset());
  it("keeps progress when the same account reauthenticates and clears it for a different account", () => {
    const user = { id: 1, username: "student", fullName: "Student", email: "student@monash.edu", profileImage: "" };
    useAppStore.getState().setUser(user);
    useAppStore.getState().setCoursePlan(1, { days: [], generatedAt: "today" });
    useAppStore.getState().requireReauthentication("portal");
    expect(useAppStore.getState().isLoggedIn).toBe(false);
    useAppStore.getState().completeLogin(user);
    expect(useAppStore.getState().aiInsights.plans[1]).toBeDefined();
    expect(useAppStore.getState().reauthReason).toBeNull();
    useAppStore.getState().completeLogin({ ...user, id: 2, email: "other@monash.edu" });
    expect(useAppStore.getState().aiInsights.plans).toEqual({});
  });

  it("restores plans, checks and priorities after rehydration, but never a running request", async () => {
    useAppStore.getState().setUser({ id: 1, username: "student", fullName: "Student", email: "student@monash.edu", profileImage: "" });
    const plan = { days: [{ day: "Monday", tasks: [{ text: "Read notes", done: true }] }], generatedAt: "2026-11-06" };
    useAppStore.getState().setCoursePlan(1, plan);
    useAppStore.getState().setPriorities({ items: [], generatedAt: "2026-11-06" });
    useAppStore.getState().setPrioritiesRunning(true);
    const options = useAppStore.persist.getOptions();
    const snapshot = JSON.parse(JSON.stringify(options.partialize!(useAppStore.getState())));
    useAppStore.getState().reset();
    useAppStore.setState({ aiInsights: { plans: {}, priorities: null, prioritiesRunning: false } });
    const storage = options.storage;
    useAppStore.persist.setOptions({ storage: {
      getItem: async () => ({ state: snapshot, version: 0 }),
      setItem: async () => {}, removeItem: async () => {},
    } });
    try {
      await useAppStore.persist.rehydrate();
      expect(useAppStore.getState().aiInsights.plans[1]).toEqual(plan);
      expect(useAppStore.getState().aiInsights.priorities).not.toBeNull();
      expect(useAppStore.getState().aiInsights.prioritiesRunning).toBe(false);
    } finally { useAppStore.persist.setOptions({ storage }); }
  });

  it("clears account-specific AI progress on logout", () => {
    useAppStore.getState().setCoursePlan(1, { days: [], generatedAt: "today" });
    useAppStore.getState().reset();
    expect(useAppStore.getState().aiInsights.plans).toEqual({});
  });

  it("signing out keeps this account's data; the same account picks it up, another account resets", () => {
    const user = { id: 1, username: "student", fullName: "Student", email: "student@monash.edu", profileImage: "" };
    useAppStore.getState().completeLogin(user);
    useAppStore.getState().setCourses([{ id: 9 } as never]);
    useAppStore.getState().setCoursePlan(9, { days: [], generatedAt: "today" });
    useAppStore.getState().signOut(false);
    let s = useAppStore.getState();
    expect(s.isLoggedIn).toBe(false);
    expect(s.reauthReason).toBe("signedOut");
    expect(s.signedOut).toBe(true);
    expect(s.courses).toHaveLength(1);
    // The flag survives a restart so the login page says "you signed out", not "session expired".
    expect(useAppStore.persist.getOptions().partialize!(s)).toMatchObject({ signedOut: true, cacheOwnerEmail: "student@monash.edu" });
    useAppStore.getState().completeLogin(user);
    s = useAppStore.getState();
    expect(s.signedOut).toBe(false);
    expect(s.aiInsights.plans[9]).toBeDefined();
    useAppStore.getState().signOut(false);
    useAppStore.getState().completeLogin({ ...user, id: 2, email: "other@monash.edu" });
    expect(useAppStore.getState().courses).toEqual([]);
  });

  it("signing out with data removal clears everything", () => {
    useAppStore.getState().completeLogin({ id: 1, username: "s", fullName: "S", email: "student@monash.edu", profileImage: "" });
    useAppStore.getState().setCoursePlan(9, { days: [], generatedAt: "today" });
    useAppStore.getState().signOut(true);
    const s = useAppStore.getState();
    expect(s.cacheOwnerEmail).toBeUndefined();
    expect(s.signedOut).toBe(false);
    expect(s.aiInsights.plans).toEqual({});
  });

  it("retains completed summary actions on regeneration and allows unchecking", () => {
    const summary = { id: "s", courseId: 1, courseName: "Course", createdAt: "today", content: "text" };
    useAppStore.getState().addSummary(1, { ...summary, completedActions: ["Read notes"] });
    useAppStore.getState().addSummary(1, { ...summary, content: "regenerated" });
    expect(useAppStore.getState().summaries[1].completedActions).toEqual(["Read notes"]);
    useAppStore.getState().addSummary(1, { ...summary, completedActions: [] });
    expect(useAppStore.getState().summaries[1].completedActions).toEqual([]);
  });

  it("merges pre-AI caches with safe defaults", () => {
    const options = useAppStore.persist.getOptions();
    const restored = options.merge!({ settings: { language: "zh" } }, useAppStore.getState());
    expect(restored.aiInsights).toEqual({ priorities: null, plans: {}, prioritiesRunning: false });
    expect(restored.settings.language).toBe("zh");
  });
  it("discards old-source exam caches and never restores an active request", () => {
    const merge = useAppStore.persist.getOptions().merge!;
    const current = useAppStore.getState();
    const legacy = merge({ exams: [{ id: "old-source" }], examsFetched: true }, current);
    expect(legacy.exams).toEqual([]);
    expect(legacy.examsFetched).toBe(false);
    const saved = merge({ cacheOwnerEmail: "student@monash.edu", exams: [{ id: "portal" }], examsFetched: true, examsFetchedAt: "2026-11-06", examLoadStatus: "loading" }, current);
    expect(saved.exams[0].id).toBe("portal");
    expect(saved.examLoadStatus).toBe("idle");
  });
  it("discards legacy account data with unknown ownership before binding a signed-in user", () => {
    const merge = useAppStore.persist.getOptions().merge!;
    const restored = merge({ courses: [{ id: 9 }], summaries: { 9: { content: "private" } }, aiInsights: { plans: { 9: { days: [] } } }, settings: { language: "zh" } }, useAppStore.getState());
    expect(restored.courses).toEqual([]);
    expect(restored.summaries).toEqual({});
    expect(restored.aiInsights.plans).toEqual({});
    expect(restored.settings.language).toBe("zh");
    useAppStore.setState({ courses: [{ id: 9 } as never], cacheOwnerEmail: undefined });
    useAppStore.getState().completeLogin({ id: 2, username: "other", fullName: "Other", email: "other@monash.edu", profileImage: "" });
    expect(useAppStore.getState().courses).toEqual([]);
  });
});
