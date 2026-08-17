// Moodle-related type definitions
//
// Wire-format types (User, Course, Resource, Assignment, Announcement) live in
// `services/api.ts` as the single source of truth — they mirror the Rust serde
// output. Re-export them here so consumers can import from either location.
export type {
  User,
  Course,
  Resource,
  Assignment,
  Announcement,
} from "../services/api";

// Local import for in-file usage (ForumPost, SessionData)
import type { User, Resource } from "../services/api";

// Extended / spec-only types not present in the Rust wire format

export interface CourseSection {
  id: number;
  name: string;
  summary?: string;
  visible?: boolean;
  resources: Resource[];
}

export type ResourceType = "file" | "folder" | "url" | "page" | "assignment" | "quiz" | "forum" | "label";

export interface FileAttachment {
  fileName: string;
  fileSize: number;
  fileUrl: string;
  mimeType: string;
  timeModified?: number;
}

export interface Quiz {
  id: number;
  name: string;
  description?: string;
  openDate?: number;
  closeDate?: number;
  timeLimit?: number;
  maxAttempts?: number;
  courseId: number;
  courseName: string;
}

export interface Forum {
  id: number;
  name: string;
  description?: string;
  type?: string;
  courseId: number;
  courseName: string;
  posts?: ForumPost[];
}

export interface ForumPost {
  id: number;
  discussion: number;
  parent: number;
  author: User;
  subject: string;
  message: string;
  timeCreated: number;
  timeModified: number;
  attachments?: FileAttachment[];
}

export interface VideoResource {
  id: number;
  title: string;
  url: string;
  duration?: string;
  thumbnailUrl?: string;
  courseId: number;
  courseName: string;
  type: "panopto" | "youtube" | "other";
}

export interface Grade {
  id: number;
  courseId: number;
  courseName: string;
  itemName: string;
  grade: number | null;
  maxGrade: number;
  feedback?: string;
}

export interface Summary {
  id: string;
  courseId: number;
  courseName: string;
  createdAt: string;
  generatedAt?: string;
  provider?: string;
  model?: string;
  updatedThreads?: number;
  mode?: string;
  summaryLanguage?: string;
  content: string;
  markdown?: string;
}

// API response types
export interface ApiResponse<T> {
  data?: T;
  error?: string;
  success: boolean;
}

// Login-related
export interface LoginCredentials {
  username: string;
  password: string;
}

export interface SessionData {
  cookies: string;
  createdAt: number;
  expiresAt?: number;
  user?: User;
}

// Settings-related
export interface AppSettings {
  /** API protocol type: openai=OpenAI compatible (/v1/chat/completions), anthropic=Anthropic native (/v1/messages) */
  aiCompatType: "openai" | "anthropic";
  /** API base URL, filled in by the user. OpenAI compatible example: https://api.openai.com/v1/chat/completions; Anthropic example: https://api.anthropic.com/v1/messages */
  aiBaseUrl: string;
  /** API format for building the full endpoint: openai=Chat Completions (/chat/completions), anthropic=Messages (/v1/messages), custom=full URL as-is */
  aiFormat: "openai" | "anthropic" | "custom";
  /** API Key (DeepSeek / OpenAI / Anthropic / OpenRouter / self-hosted gateway, etc.) */
  aiApiKey: string;
  /** Model name, e.g. gpt-4o-mini / claude-3-5-sonnet-20241022 / deepseek-chat */
  aiModel: string;
  summaryLanguage: "zh-CN" | "en";
  /** Auto-generate an AI summary when opening course details */
  autoSummaryOnOpen: boolean;
  /** AI feature: course material summary toggle */
  aiFeatureSummary: boolean;
  /** AI feature: smart assignment reminder toggle */
  aiFeatureAssign: boolean;
  /** AI feature: study advice toggle */
  aiFeatureAdvice: boolean;
  syncEnabled: boolean;
  /** Sync once when the app launches (independent of interval) */
  syncOnLaunch: boolean;
  /** Auto-sync minimum interval in days. 0 = disabled. Default 7 (weekly). */
  autoSyncIntervalDays: number;
  /** ISO timestamp of last auto-sync run */
  lastAutoSyncAt?: string;
  darkMode: "light" | "dark" | "system";
  /** Accent color (primary color). Once written, App.tsx overrides the --color-primary family of CSS variables */
  accentColor: AccentColor;
  /** Course card sorting: term=by term, name=by name */
  courseSortBy: "term" | "name";
  downloadPath: string;
  /** Reveal downloaded file in file manager after download completes */
  openFolderAfterDownload: boolean;
  /** Downloads are organized into per-course subfolders (e.g. Downloads/FIT5215/...) */
  groupDownloadsByCourse: boolean;
  notifications: boolean;
  notificationSound: boolean;
  /** Notification: assignment due reminder */
  notifyAssignmentDue: boolean;
  /** Notification: new course material alert */
  notifyNewMaterial: boolean;
  /** Notification: course announcement update alert */
  notifyAnnouncement: boolean;
  /** Notification: grade release alert */
  notifyGrade: boolean;
  /** Sync: Wi-Fi only */
  syncWifiOnly: boolean;
  /** Download: auto-download new materials */
  autoDownloadNew: boolean;
  /** Reminder: assignment due reminder */
  notifyDueReminder: boolean;
  /** Reminder: days of lead time before the due date (1/3/7) */
  dueReminderDays: number;
  /** Reminder: new announcement */
  notifyNewAnnouncement: boolean;
  /** Reminder: new material */
  notifyNewResource: boolean;
  language: "en" | "zh" | "ja" | "ko";
  /** Minimize to tray when closing the window */
  minimizeToTray: boolean;
}

/** Available accent colors. Values map one-to-one to the ACCENT_COLORS table */
export type AccentColor = "blue" | "purple" | "green" | "orange" | "pink";

/**
 * Accent color palettes. Each palette provides three levels:
 * - base: primary color (buttons, selected-state background)
 * - hover: hover state
 * - light: light variant (used as the primary color in dark mode to keep contrast)
 * Maps to --color-primary / -hover / -light in src/index.css.
 */
export const ACCENT_COLORS: Record<
  AccentColor,
  { base: string; hover: string; light: string; label: string }
> = {
  blue:   { base: "#3B82F6", hover: "#2563EB", light: "#93C5FD", label: "蓝色" },
  purple: { base: "#8B5CF6", hover: "#7C3AED", light: "#C4B5FD", label: "紫色" },
  green:  { base: "#22C55E", hover: "#16A34A", light: "#86EFAC", label: "绿色" },
  orange: { base: "#F97316", hover: "#EA580C", light: "#FDBA74", label: "橙色" },
  pink:   { base: "#EC4899", hover: "#DB2777", light: "#F9A8D4", label: "粉色" },
};

// State-related
export interface SyncStatus {
  isRunning: boolean;
  currentCourse?: string;
  progress?: number;
  totalCourses?: number;
  processedCourses?: number;
  lastSync?: string;
  errors?: string[];
}
