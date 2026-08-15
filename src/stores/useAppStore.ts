import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { AppSettings, SyncStatus, Summary } from "../types";
import type { Course, Resource, Assignment, Announcement, User, DownloadItem, CalendarEvent, GradeOverviewRow } from "../services/api";

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
  }) => void;
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
  downloadPath: "",
  openFolderAfterDownload: true,
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
      const updatedCourses = data.courses || state.courses;
      const updatedResources = data.resources || state.allResources;
      const updatedAssignments = data.assignments || state.assignments;
      const updatedAnnouncements = data.announcements || state.announcements;

      const newCourseResources = { ...state.courseResources };
      if (data.resources && Array.isArray(data.resources)) {
        const grouped: Record<number, Resource[]> = {};
        for (const res of data.resources) {
          if (res.courseId) {
            if (!grouped[res.courseId]) grouped[res.courseId] = [];
            grouped[res.courseId].push(res);
          }
        }
        for (const [courseIdStr, resList] of Object.entries(grouped)) {
          newCourseResources[Number(courseIdStr)] = resList;
        }
      }

      return {
        courses: updatedCourses,
        allResources: updatedResources,
        assignments: updatedAssignments,
        announcements: updatedAnnouncements,
        courseResources: newCourseResources,
        syncStatus: {
          ...state.syncStatus,
          isRunning: false,
          lastSync: new Date().toISOString(),
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
  downloads: [],
    }),
    }),
    {
      name: "muster-settings",
      // The persisted cache is the key to an "instant open": the Dashboard renders from this cache on mount,
      // and syncAll is deferred to a background refresh in an idle frame. So resources/assignments/announcements
      // must stay persisted, otherwise the first screen shows empty lists while waiting on the network, which is a worse experience.
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
