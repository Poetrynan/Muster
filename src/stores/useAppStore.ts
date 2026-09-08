import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { idbStorage } from "../services/idbStorage";
import type { AppSettings, SyncStatus, Summary } from "../types";
import type { Course, Resource, Assignment, Announcement, User, DownloadItem, CalendarEvent, GradeOverviewRow, UnitDashboard, UnitInfo, Schedule, Recording, CourseContact, CourseTabData, SyncOptions } from "../services/api";
import { inferActiveSemesterKey, isCourseInSemester, parseSemester } from "../lib/courseHelpers";

interface AppState {
  // User state
  user: User | null;
  isLoggedIn: boolean;
  
  // Course state
  courses: Course[];
  currentCourse: Course | null;
  courseResources: Record<number, Resource[]>;
  // Full resource set (from syncAll), filtered by courseId as a second step
  allResources: Resource[];

  // Summary state
  summaries: Record<number, Summary>;

  // Assignment state
  assignments: Assignment[];

  // Announcement state
  announcements: Announcement[];
  // Set of read announcement ids (serialized as an array, set operations done on the frontend)
  readAnnouncementIds: number[];

  // Sync state
  syncStatus: SyncStatus;

  // Calendar events across all courses (aggregated from fetch_calendar_events)
  calendarEvents: CalendarEvent[];
  // Cross-course grade overview (/grade/report/overview)
  gradeOverview: GradeOverviewRow[];

  // Per-course tab data from the full sync. unitInfos / schedules / contacts are semester-fixed
  // (persisted cache — fetched once, reused on later launches); unitDashboards / recordings are
  // dynamic (fetched live on every login, memory only). Within a session all of it is shared so
  // tab switches render instantly without waiting for a tab switch to trigger scraping.
  unitDashboards: Record<number, UnitDashboard>;
  unitInfos: Record<number, UnitInfo>;
  schedules: Record<number, Schedule>;
  recordings: Record<number, Recording[]>;
  contacts: Record<number, CourseContact[]>;

  // Download manager (not persisted)
  downloads: DownloadItem[];

  // Settings
  settings: AppSettings;

  // Actions
  setUser: (user: User | null) => void;
  setLoggedIn: (loggedIn: boolean) => void;
  setCourses: (courses: Course[]) => void;
  setCurrentCourse: (course: Course | null) => void;
  setCourseResources: (courseId: number, resources: Resource[]) => void;
  setAllResources: (resources: Resource[]) => void;
  addSummary: (courseId: number, summary: Summary) => void;
  setAssignments: (assignments: Assignment[]) => void;
  setAnnouncements: (announcements: Announcement[]) => void;
  markAnnouncementRead: (id: number) => void;
  markAllAnnouncementsRead: () => void;
  setSyncStatus: (status: Partial<SyncStatus>) => void;
  setCalendarEvents: (events: CalendarEvent[]) => void;
  setGradeOverview: (rows: GradeOverviewRow[]) => void;
  setCourseTabData: (tabs: CourseTabData[]) => void;
  upsertDownload: (item: DownloadItem) => void;
  removeDownload: (key: string) => void;
  clearDownloads: () => void;
  // Reminder banner (not persisted)
  reminderBanner: { id: string; title: string; body: string } | null;
  setReminderBanner: (banner: { id: string; title: string; body: string } | null) => void;
  updateSettings: (settings: Partial<AppSettings>) => void;
  updateAllSyncedData: (data: {
    courses?: Course[];
    resources?: Resource[];
    assignments?: Assignment[];
    announcements?: Announcement[];
    tabs?: CourseTabData[];
    fullRefresh?: boolean;
  }) => void;
  hideCourse: (courseId: number) => void;
  unhideCourse: (courseId: number) => void;
  togglePinCourse: (courseId: number) => void;
  reset: () => void;
}

const defaultSettings: AppSettings = {
  aiCompatType: "openai",
  aiFormat: "openai",
  aiBaseUrl: "https://api.openai.com/v1/chat/completions",
  aiApiKey: "",
  aiModel: "gpt-4o-mini",
  summaryLanguage: "zh-CN",
  autoSummaryOnOpen: false,
  aiFeatureSummary: false,
  aiFeatureAssign: false,
  aiFeatureAdvice: false,
  syncEnabled: true,
  syncOnLaunch: false,
  autoSyncIntervalDays: 7,
  lastAutoSyncAt: undefined,
  darkMode: "system",
  accentColor: "blue",
  courseSortBy: "term",
  hiddenCourseIds: [],
  pinnedCourseIds: [],
  downloadPath: "",
  openFolderAfterDownload: true,
  groupDownloadsByCourse: true,
  groupDownloadsBySection: true,
  notifications: true,
  notificationSound: true,
  notifyAssignmentDue: true,
  notifyNewMaterial: true,
  notifyAnnouncement: false,
  notifyGrade: true,
  syncWifiOnly: true,
  autoDownloadNew: false,
  notifyDueReminder: false,
  dueReminderDays: 3,
  notifyNewAnnouncement: false,
  notifyNewResource: false,
  language: "en",
  minimizeToTray: true,
};

const defaultSyncStatus: SyncStatus = {
  isRunning: false,
};

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
  // Initial state
  user: null,
  isLoggedIn: false,
  courses: [],
  currentCourse: null,
  courseResources: {},
  allResources: [],
  summaries: {},
  assignments: [],
  announcements: [],
  readAnnouncementIds: [],
  syncStatus: defaultSyncStatus,
  calendarEvents: [],
  gradeOverview: [],
  unitDashboards: {},
  unitInfos: {},
  schedules: {},
  recordings: {},
  contacts: {},
  downloads: [],
  reminderBanner: null,
  settings: defaultSettings,

  // Actions
  setUser: (user) => set({ user }),
  setLoggedIn: (isLoggedIn) => set({ isLoggedIn }),
  setCourses: (courses) => set({ courses }),
  setCurrentCourse: (currentCourse) => set({ currentCourse }),
  setCourseResources: (courseId, resources) =>
    set((state) => ({
      courseResources: { ...state.courseResources, [courseId]: resources },
    })),
  setAllResources: (allResources) => set({ allResources }),
  addSummary: (courseId, summary) =>
    set((state) => ({
      summaries: { ...state.summaries, [courseId]: summary },
    })),
  setAssignments: (assignments) => set({ assignments }),
  setAnnouncements: (announcements) => set({ announcements }),
  markAnnouncementRead: (id) =>
    set((state) =>
      state.readAnnouncementIds.includes(id)
        ? state
        : { readAnnouncementIds: [...state.readAnnouncementIds, id] }
    ),
  markAllAnnouncementsRead: () =>
    set((state) => {
      // Only accumulate ids from the current list into the read set, so old ids already deleted on the backend don't grow without bound
      const currentIds = state.announcements.map((a) => a.id).filter((id) => id != null);
      const merged = new Set([...state.readAnnouncementIds, ...currentIds]);
      return { readAnnouncementIds: Array.from(merged) };
    }),
  setSyncStatus: (status) =>
    set((state) => ({
      syncStatus: { ...state.syncStatus, ...status },
    })),
  setCalendarEvents: (calendarEvents) => set({ calendarEvents }),
  setGradeOverview: (gradeOverview) => set({ gradeOverview }),
  setCourseTabData: (tabs) =>
    set((state) => {
      const unitDashboards = { ...state.unitDashboards };
      const unitInfos = { ...state.unitInfos };
      const schedules = { ...state.schedules };
      const recordings = { ...state.recordings };
      const contacts = { ...state.contacts };
      for (const tab of tabs) {
        // A failed tab (null) keeps the previous in-memory data instead of wiping it.
        if (tab.dashboard) unitDashboards[tab.courseId] = tab.dashboard;
        if (tab.unitInfo) unitInfos[tab.courseId] = tab.unitInfo;
        if (tab.schedule) schedules[tab.courseId] = tab.schedule;
        // Empty arrays are meaningful ("fetched, nothing there") and overwrite the data.
        recordings[tab.courseId] = tab.recordings;
        contacts[tab.courseId] = tab.contacts;
      }
      return { unitDashboards, unitInfos, schedules, recordings, contacts };
    }),
  upsertDownload: (item) =>
    set((state) => ({
      downloads: [item, ...state.downloads.filter((x) => x.key !== item.key)],
    })),
  removeDownload: (key) =>
    set((state) => ({ downloads: state.downloads.filter((x) => x.key !== key) })),
  clearDownloads: () => set({ downloads: [] }),
  setReminderBanner: (banner) => set({ reminderBanner: banner }),
  updateSettings: (newSettings) =>
    set((state) => ({
      settings: { ...state.settings, ...newSettings },
    })),
  updateAllSyncedData: (data) =>
    set((state) => {
      const isFull = Boolean(data.fullRefresh);

      const mergeCourses = (incoming: Course[] | undefined, existing: Course[]): Course[] => {
        if (!incoming || incoming.length === 0) return existing;
        if (isFull) return incoming;
        const map = new Map<number, Course>();
        for (const item of existing) map.set(item.id, item);
        for (const item of incoming) {
          const prev = map.get(item.id);
          map.set(item.id, prev ? { ...prev, ...item } : item);
        }
        return Array.from(map.values());
      };

      const mergeResources = (incoming: Resource[] | undefined, existing: Resource[]): Resource[] => {
        if (!incoming || incoming.length === 0) return existing;
        if (isFull) return incoming;
        const map = new Map<string | number, Resource>();
        for (const item of existing) {
          const key = item.id || item.url || `${item.courseId}-${item.name}`;
          map.set(key, item);
        }
        for (const item of incoming) {
          const key = item.id || item.url || `${item.courseId}-${item.name}`;
          map.set(key, item);
        }
        return Array.from(map.values());
      };

      const mergeAssignments = (incoming: Assignment[] | undefined, existing: Assignment[]): Assignment[] => {
        if (!incoming || incoming.length === 0) return existing;
        const map = new Map<string | number, Assignment>();
        for (const item of existing) {
          const key = item.id || item.url || item.name;
          map.set(key, item);
        }
        for (const item of incoming) {
          const key = item.id || item.url || item.name;
          const prev = map.get(key);
          if (prev && !isFull) {
            map.set(key, {
              ...prev,
              ...item,
              // Preserve score and status if incoming skipped detail fetch
              grade: item.grade ?? prev.grade,
              status:
                item.status === "pending" && (prev.status === "graded" || prev.status === "submitted")
                  ? prev.status
                  : item.status,
              hasSubmissionStatus: item.hasSubmissionStatus || prev.hasSubmissionStatus,
            });
          } else {
            map.set(key, item);
          }
        }
        return Array.from(map.values());
      };

      const mergeAnnouncements = (incoming: Announcement[] | undefined, existing: Announcement[]): Announcement[] => {
        if (!incoming || incoming.length === 0) return existing;
        if (isFull) return incoming;
        const map = new Map<string | number, Announcement>();
        for (const item of existing) {
          const key = item.id || item.url || item.title;
          map.set(key, item);
        }
        for (const item of incoming) {
          const key = item.id || item.url || item.title;
          map.set(key, item);
        }
        return Array.from(map.values());
      };

      const updatedCourses = mergeCourses(data.courses, state.courses);
      const updatedResources = mergeResources(data.resources, state.allResources);
      const updatedAssignments = mergeAssignments(data.assignments, state.assignments);
      const updatedAnnouncements = mergeAnnouncements(data.announcements, state.announcements);

      // Adopt the aggregated per-course tab data (Dashboard / Unit Info / Schedule /
      // Recordings / Contacts) from the sync.
      const newUnitDashboards = { ...state.unitDashboards };
      const newUnitInfos = { ...state.unitInfos };
      const newSchedules = { ...state.schedules };
      const newRecordings = { ...state.recordings };
      const newContacts = { ...state.contacts };
      if (data.tabs && Array.isArray(data.tabs)) {
        for (const tab of data.tabs) {
          if (tab.dashboard) newUnitDashboards[tab.courseId] = tab.dashboard;
          if (tab.unitInfo) newUnitInfos[tab.courseId] = tab.unitInfo;
          if (tab.schedule) newSchedules[tab.courseId] = tab.schedule;
          if (tab.recordings && tab.recordings.length > 0) newRecordings[tab.courseId] = tab.recordings;
          if (tab.contacts && tab.contacts.length > 0) newContacts[tab.courseId] = tab.contacts;
        }
      }

      const newCourseResources = isFull ? {} : { ...state.courseResources };
      if (data.resources && Array.isArray(data.resources)) {
        const grouped: Record<number, Resource[]> = {};
        for (const res of data.resources) {
          if (res.courseId) {
            if (!grouped[res.courseId]) grouped[res.courseId] = [];
            grouped[res.courseId].push(res);
          }
        }
        for (const [courseIdStr, resList] of Object.entries(grouped)) {
          const cid = Number(courseIdStr);
          const existingForCourse = newCourseResources[cid] || [];
          newCourseResources[cid] = isFull ? resList : mergeResources(resList, existingForCourse);
        }
      }

      return {
        courses: updatedCourses,
        allResources: updatedResources,
        assignments: updatedAssignments,
        announcements: updatedAnnouncements,
        courseResources: newCourseResources,
        unitDashboards: newUnitDashboards,
        unitInfos: newUnitInfos,
        schedules: newSchedules,
        recordings: newRecordings,
        contacts: newContacts,
        syncStatus: {
          ...state.syncStatus,
          isRunning: false,
          lastSync: new Date().toISOString(),
        },
      };
    }),
  hideCourse: (courseId) =>
    set((state) => {
      const hidden = state.settings.hiddenCourseIds || [];
      if (hidden.includes(courseId)) return state;
      return {
        settings: {
          ...state.settings,
          hiddenCourseIds: [...hidden, courseId],
        },
      };
    }),
  unhideCourse: (courseId) =>
    set((state) => {
      const hidden = state.settings.hiddenCourseIds || [];
      return {
        settings: {
          ...state.settings,
          hiddenCourseIds: hidden.filter((id) => id !== courseId),
        },
      };
    }),
  togglePinCourse: (courseId) =>
    set((state) => {
      const pinned = state.settings.pinnedCourseIds || [];
      const next = pinned.includes(courseId)
        ? pinned.filter((id) => id !== courseId)
        : [...pinned, courseId];
      return {
        settings: {
          ...state.settings,
          pinnedCourseIds: next,
        },
      };
    }),
  reset: () =>
    set({
      user: null,
      isLoggedIn: false,
      courses: [],
      currentCourse: null,
      courseResources: {},
      allResources: [],
      summaries: {},
      assignments: [],
      announcements: [],
      readAnnouncementIds: [],
      syncStatus: defaultSyncStatus,
      unitDashboards: {},
      unitInfos: {},
      schedules: {},
      recordings: {},
      contacts: {},
      // Cross-course data belongs to the previous account/session: clear it too,
      // otherwise stale deadlines and grades survive a logout.
      calendarEvents: [],
      gradeOverview: [],
      downloads: [],
    }),
    }),
    {
      name: "muster-settings",
      // IndexedDB backend: localStorage (~5 MB WebView quota) overflowed once the
      // course cache (announcements / resources / unit tabs / summaries) grew past
      // it, crashing sync completion with "[unhandledrejection] quota exceeded".
      // IndexedDB quota is far larger and failed writes degrade silently.
      storage: createJSONStorage(() => idbStorage),
      // The persisted cache is the key to an "instant open": the Dashboard renders from this cache on mount,
      // and syncAll is deferred to a background refresh in an idle frame. So resources/assignments/announcements
      // must stay persisted, otherwise the first screen shows empty lists while waiting on the network, which is a worse experience.
      //
      // Per-course tab data follows the user's fetch strategy: unitInfos / schedules / contacts are
      // semester-fixed content — fetched once and persisted (cache), so regular logins skip them.
      // unitDashboards / recordings are dynamic (the dashboard's "current week" rolls weekly,
      // recordings appear per week) — fetched live on every login, kept in memory only.
      //
      // `user` and `isLoggedIn` are deliberately NOT persisted. The source of truth for auth is the
      // Rust-side keyring session, checked on startup by loadSavedSession(). Persisting the flag made
      // a fresh launch restore isLoggedIn:true and render the Dashboard against a long-dead session,
      // which then failed every backend command with "Not logged in".
      partialize: (state) => ({
        courses: state.courses,
        assignments: state.assignments,
        announcements: state.announcements,
        readAnnouncementIds: state.readAnnouncementIds,
        allResources: state.allResources,
        courseResources: state.courseResources,
        calendarEvents: state.calendarEvents,
        gradeOverview: state.gradeOverview,
        // Semester-fixed tabs (unit info / schedule / contacts) are cached: fetch once,
        // reuse across launches. The dynamic tabs (dashboard / recordings) are NOT
        // persisted — they are re-fetched live on every login.
        unitInfos: state.unitInfos,
        schedules: state.schedules,
        contacts: state.contacts,
        summaries: state.summaries,
        settings: state.settings,
      }),
      // Users on older versions don't have the newly added settings fields (e.g. accentColor) in localStorage,
      // and zustand's default shallow merge would replace the whole settings object with the old one, leaving new fields undefined.
      // Merge settings explicitly here so new fields always get their default value.
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<AppState>;
        // Older builds persisted user / isLoggedIn. Strip them on restore so a stale
        // "logged in" flag can never survive a restart; auth is re-derived from the
        // Rust keyring session via loadSavedSession(). Without this, the merge below
        // would spread the old true flag back in and render the Dashboard offline.
        const { user: _staleUser, isLoggedIn: _staleLoggedIn, ...rest } = p;
        void _staleUser;
        void _staleLoggedIn;
        return {
          ...current,
          ...rest,
          user: null,
          isLoggedIn: false,
          settings: { ...defaultSettings, ...(p.settings ?? {}) },
        };
      },
    },
  ),
);

/**
 * Build SyncOptions from current app state for incremental sync.
 */
export function getSyncOptions(
  state: {
    courses: Course[];
    courseResources: Record<number, Resource[]>;
    allResources: Resource[];
    assignments: Assignment[];
    unitInfos: Record<number, UnitInfo>;
    settings?: {
      hiddenCourseIds?: number[];
      pinnedCourseIds?: number[];
    };
  },
  fullRefresh = false
): SyncOptions {
  if (fullRefresh) {
    return {
      fullRefresh: true,
      includeFixedTabs: true,
      cachedWeeks: {},
      completedAssignmentIds: [],
    };
  }

  const hiddenIds = state.settings?.hiddenCourseIds || [];
  const pinnedIds = state.settings?.pinnedCourseIds || [];
  const activeSemesterKey = inferActiveSemesterKey(state.courses);

  // Identify target courses for incremental sync:
  // 1. Current active semester courses (or cross-semester units spanning it)
  // 2. Any pinned courses
  // 3. Any course that does NOT have cached resources yet (brand new)
  // Historical past-semester courses that already have full cached resources are bypassed.
  const targetCourseIds: number[] = [];
  for (const course of state.courses) {
    if (hiddenIds.includes(course.id)) continue;

    const res =
      state.courseResources[course.id] ||
      state.allResources.filter((r) => r.courseId === course.id);
    const hasCachedData = res && res.length > 0;

    if (!hasCachedData) {
      targetCourseIds.push(course.id);
      continue;
    }

    if (pinnedIds.includes(course.id)) {
      targetCourseIds.push(course.id);
      continue;
    }

    const sem = parseSemester(course.fullName || course.shortName || "");
    if (activeSemesterKey === "all" || isCourseInSemester(sem, activeSemesterKey)) {
      targetCourseIds.push(course.id);
    }
  }

  const cachedWeeks: Record<number, number[]> = {};
  for (const course of state.courses) {
    const res =
      state.courseResources[course.id] ||
      state.allResources.filter((r) => r.courseId === course.id);
    const weeks = Array.from(
      new Set(
        res
          .map((r) => r.weekNum)
          .filter((w): w is number => typeof w === "number" && w > 0)
      )
    );
    if (weeks.length > 0) {
      cachedWeeks[course.id] = weeks;
    }
  }

  const completedAssignmentIds = state.assignments
    .filter((a) => {
      // Completed: graded with valid grade text, or submitted and already marked
      if (a.status === "graded" && a.grade && a.grade !== "-") return true;
      return false;
    })
    .map((a) => a.id);

  const hasAnyFixedTabs =
    state.courses.length > 0 &&
    state.courses.some((c) => Boolean(state.unitInfos[c.id]));

  return {
    fullRefresh: false,
    includeFixedTabs: !hasAnyFixedTabs,
    cachedWeeks,
    completedAssignmentIds,
    targetCourseIds: targetCourseIds.length > 0 ? targetCourseIds : undefined,
  };
}
