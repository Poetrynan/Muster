import { motion } from "framer-motion";
import {
  AlertCircle,
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Loader2,
  PlugZap,
  Bell,
  BookOpen,
  Check,
  Download,
  ExternalLink,
  Eye,
  EyeOff,
  Heart,
  Key,
  MessageSquarePlus,
  MonitorSmartphone,
  Moon,
  Palette,
  RefreshCw,
  Shield,
  Sparkles,
  Sun,
  User,
  Wifi,
} from "lucide-react";
import { useEffect, useState } from "react";
import { Avatar } from "../components/ui/avatar";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card";
import { Input } from "../components/ui/input";
import { Dialog } from "../components/ui/dialog";
import { FeedbackPanel } from "../components/FeedbackPanel";
import { useAppStore } from "../stores/useAppStore";
import { useTranslation } from "../i18n/useTranslation";
import type { TranslationKey } from "../i18n/translations";
import { saveAiConfig, syncAll, logout, testAiConnection } from "../services/api";
import { showToast } from "../components/ui/toast";
import { buildAiUrl, splitAiUrl } from "../services/aiUrl";
import { requestNotificationPermission, clearReminded } from "../services/reminders";
import { checkForAppUpdates, APP_CURRENT_VERSION, type UpdateCheckResult } from "../services/updater";
import { ACCENT_COLORS, type AccentColor } from "../types";
import { open } from "@tauri-apps/plugin-dialog";
import appIcon from "../assets/app-icon.png";

interface SettingsPageProps {
  onBack: () => void;
}

type SettingsSection = "account" | "appearance" | "notifications" | "ai" | "sync" | "feedback" | "about";

// label uses an i18n key and is resolved with t() at render time, so language switches take effect immediately
const sidebarItems: { icon: typeof User; labelKey: TranslationKey; key: SettingsSection }[] = [
  { icon: User, labelKey: "settings.nav.account", key: "account" },
  { icon: Palette, labelKey: "settings.nav.appearance", key: "appearance" },
  { icon: Bell, labelKey: "settings.nav.notifications", key: "notifications" },
  { icon: Key, labelKey: "settings.nav.ai", key: "ai" },
  { icon: Wifi, labelKey: "settings.nav.sync", key: "sync" },
  { icon: MessageSquarePlus, labelKey: "settings.nav.feedback", key: "feedback" },
  { icon: BookOpen, labelKey: "settings.nav.about", key: "about" },
];

// Map raw AI connection errors to user-friendly messages; keep the raw payload for details.
function formatAiError(
  message: string,
  status: number | undefined,
  t: (k: any, vars?: Record<string, string | number>) => string
): { friendly: string; raw?: string } {
  if (!message) return { friendly: "" };
  const m = message.match(/HTTP\s+(\d{3})/);
  const code = status ?? (m ? parseInt(m[1], 10) : undefined);
  if (code === 401 || code === 403) return { friendly: t("settings.ai.errAuth"), raw: message };
  if (code === 404) return { friendly: t("settings.ai.errNotFound"), raw: message };
  if (code === 429) return { friendly: t("settings.ai.errRateLimit"), raw: message };
  if (code && code >= 500) return { friendly: t("settings.ai.errServer"), raw: message };
  if (code) return { friendly: t("settings.ai.errGeneric", { status: code }), raw: message };
  const lower = message.toLowerCase();
  if (lower.includes("timeout") || lower.includes("timed out") || lower.includes("request failed")
      || lower.includes("connect") || lower.includes("network") || lower.includes("dns")) {
    return { friendly: t("settings.ai.errNetwork"), raw: message };
  }
  return { friendly: t("settings.ai.errUnknown"), raw: message };
}

export function SettingsPage({ onBack }: SettingsPageProps) {
  const [activeSection, setActiveSection] = useState<SettingsSection>("account");
  const { user, settings, updateSettings } = useAppStore();
  const { t } = useTranslation();

  // GitHub Release update check state
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [updateResult, setUpdateResult] = useState<UpdateCheckResult | null>(null);
  const [showUpToDateToast, setShowUpToDateToast] = useState(false);

  // Sync "minimize to tray on close" to the Rust side (the window close event reads it); degrades silently in the browser dev environment
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        if (!cancelled) await invoke("set_close_to_tray", { enabled: settings.minimizeToTray });
      } catch {
        /* Not a Tauri environment: ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [settings.minimizeToTray]);

  // Selective clear-data modal: the user chooses WHAT to clear instead of wiping everything at once
  const [clearOpen, setClearOpen] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [clearSelection, setClearSelection] = useState({
    data: true,
    downloads: false,
    session: false,
    settings: false,
  });

  const toggleClearOption = (key: keyof typeof clearSelection) =>
    setClearSelection((prev) => ({ ...prev, [key]: !prev[key] }));

  // Delete-resources modal: explicit checkboxes instead of one-click wipe
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteSelection, setDeleteSelection] = useState({
    courses: true,
    resources: true,
    assignments: true,
    announcements: false,
  });
  const toggleDeleteOption = (key: keyof typeof deleteSelection) =>
    setDeleteSelection((prev) => ({ ...prev, [key]: !prev[key] }));
  const handleDeleteSelected = async () => {
    if (deleting) return;
    if (!Object.values(deleteSelection).some(Boolean)) return;
    setDeleting(true);
    try {
      const { setCourses, setAllResources, setAssignments, setAnnouncements } = useAppStore.getState();
      if (deleteSelection.courses) setCourses([]);
      if (deleteSelection.resources) setAllResources([]);
      if (deleteSelection.assignments) setAssignments([]);
      if (deleteSelection.announcements) setAnnouncements([]);
      setDeleteOpen(false);
      showToast(t("settings.deleteModal.done"));
    } finally {
      setDeleting(false);
    }
  };

  const handleClearSelected = async () => {
    if (clearing) return;
    if (!Object.values(clearSelection).some(Boolean)) return;
    setClearing(true);
    try {
      if (clearSelection.data) {
        const { setCourses, setAllResources, setAssignments, setAnnouncements } = useAppStore.getState();
        setCourses([]);
        setAllResources([]);
        setAssignments([]);
        setAnnouncements([]);
        clearReminded();
      }
      if (clearSelection.session) {
        try {
          await logout();
        } catch (err) {
          console.warn("logout failed:", err);
        }
      }
      if (clearSelection.settings) {
        useAppStore.persist.clearStorage();
        useAppStore.getState().reset();
      }
      if (clearSelection.downloads) {
        try {
          const { invoke } = await import("@tauri-apps/api/core");
          await invoke("clear_downloads", { savePath: settings.downloadPath || "" });
        } catch (err) {
          console.warn("clear downloads failed:", err);
        }
      }
      setClearOpen(false);
      showToast(t("settings.clearModal.done"));
    } finally {
      setClearing(false);
    }
  };

  const handleCheckUpdate = async () => {
    setCheckingUpdate(true);
    setUpdateResult(null);
    setShowUpToDateToast(false);

    try {
      const res = await checkForAppUpdates(APP_CURRENT_VERSION);
      setUpdateResult(res);
      if (!res.hasUpdate && !res.error) {
        setShowUpToDateToast(true);
        setTimeout(() => setShowUpToDateToast(false), 4000);
      }
    } catch (e: any) {
      setUpdateResult({
        hasUpdate: false,
        currentVersion: APP_CURRENT_VERSION,
        error: e?.message || "Failed to check",
      });
    } finally {
      setCheckingUpdate(false);
    }
  };

  const handleOpenReleaseUrl = async (url: string) => {
    try {
      const { openUrl } = await import("@tauri-apps/plugin-opener");
      await openUrl(url);
    } catch (err) {
      console.error("Failed to open release URL:", err);
    }
  };

  const effectiveAiFormat: "openai" | "anthropic" | "custom" =
    settings.aiFormat ?? splitAiUrl(settings.aiBaseUrl || "").format;

  // Migrate legacy "full endpoint URL" values into base + format once (old persisted settings)
  useEffect(() => {
    const { base, format } = splitAiUrl(settings.aiBaseUrl || "");
    const patch: Partial<typeof settings> = {};
    if (format !== "custom") {
      if (settings.aiFormat !== format) patch.aiFormat = format;
      if (settings.aiBaseUrl !== base) patch.aiBaseUrl = base;
    }
    if (Object.keys(patch).length > 0) updateSettings(patch);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Connection test state + handler
  const [aiTest, setAiTest] = useState<{ status: "idle" | "testing" | "ok" | "error"; message?: string; raw?: string }>({
    status: "idle",
  });
  const [showApiKey, setShowApiKey] = useState(false);

  const handleTestAiConnection = async () => {
    if (aiTest.status === "testing") return;
    if (!settings.aiApiKey?.trim() || !settings.aiBaseUrl?.trim()) {
      setAiTest({ status: "error", message: t("settings.ai.testMissing") });
      return;
    }
    setAiTest({ status: "testing" });
    try {
      const fullUrl = buildAiUrl(settings.aiBaseUrl || "", effectiveAiFormat);
      const res = await testAiConnection(settings.aiApiKey, fullUrl, settings.aiModel || "");
            const mapped = res.ok
        ? { status: "ok" as const, message: res.message, raw: undefined }
        : { status: "error" as const, ...formatAiError(res.message, res.status, t), raw: res.message };
      setAiTest(mapped);
    } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
      setAiTest({ status: "error", ...formatAiError(msg, undefined, t), raw: msg });
    }
  };


  const renderContent = () => {
    switch (activeSection) {
      case "account":
        return (
          <div className="space-y-6">
            <div>
              <h2 className="text-2xl font-bold mb-2">{t("settings.account.title")}</h2>
              <p className="text-muted-foreground">{t("settings.account.subtitle")}</p>
            </div>

            <div className="max-w-2xl mx-auto space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle>{t("settings.account.profile")}</CardTitle>
                  <CardDescription>{t("settings.account.profileDesc")}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex items-center gap-4">
                    <Avatar size="xl" fallback={user?.fullName ?? "Student"} />
                    <div>
                      <h3 className="font-semibold text-lg">{user?.fullName ?? "Monash Student"}</h3>
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                        {t("settings.account.ssoVerified")}
                      </span>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="text-sm font-medium mb-1 block text-muted-foreground">
                        {t("settings.account.username")}
                      </label>
                      <Input value={user?.username ?? "student"} readOnly className="bg-muted/50" />
                    </div>
                    <div>
                      <label className="text-sm font-medium mb-1 block text-muted-foreground">
                        {t("settings.account.email")}
                      </label>
                      <Input value={user?.email ?? "student@monash.edu"} readOnly className="bg-muted/50" />
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>{t("settings.account.ssoTitle")}</CardTitle>
                  <CardDescription>{t("settings.account.ssoDesc")}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="p-3.5 rounded-lg border bg-card/50 space-y-2 text-sm">
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">{t("settings.account.authMode")}</span>
                      <span className="font-medium text-foreground">{t("settings.account.authModeValue")}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">{t("settings.account.credStorage")}</span>
                      <span className="font-medium text-foreground">{t("settings.account.credStorageValue")}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">{t("settings.account.encryption")}</span>
                      <span className="font-medium text-emerald-600 dark:text-emerald-400">{t("settings.account.encryptionValue")}</span>
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    {t("settings.account.ssoNote")}
                  </p>
                </CardContent>
              </Card>
            </div>
          </div>
        );

      case "appearance":
        return (
          <div className="space-y-6">
            <div>
              <h2 className="text-2xl font-bold mb-2">{t("settings.appearance.title")}</h2>
              <p className="text-muted-foreground">{t("settings.appearance.subtitle")}</p>
            </div>

            <div className="max-w-2xl mx-auto space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle>{t("settings.theme")}</CardTitle>
                  <CardDescription>{t("settings.themeDesc")}</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-3 gap-4">
                    {(["light", "dark", "system"] as const).map((theme) => (
                      <button
                        key={theme}
                        onClick={() => updateSettings({ darkMode: theme })}
                        className={`p-4 rounded-xl border-2 transition-all ${
                          settings.darkMode === theme
                            ? "border-primary bg-primary/5"
                            : "border-border hover:border-primary/50"
                        }`}
                      >
                        <div className="flex flex-col items-center gap-2">
                          {theme === "light" ? (
                            <Sun className="w-6 h-6" />
                          ) : theme === "dark" ? (
                            <Moon className="w-6 h-6" />
                          ) : (
                            <MonitorSmartphone className="w-6 h-6" />
                          )}
                          <span className="text-sm font-medium">
                            {theme === "light"
                              ? t("settings.themeLight")
                              : theme === "dark"
                              ? t("settings.themeDark")
                              : t("settings.themeSystem")}
                          </span>
                        </div>
                      </button>
                    ))}
                  </div>

                  <div className="flex items-center justify-between py-2 mt-3 border-t border-border/60">
                    <div>
                      <p className="font-medium">{t("settings.ai.autoSummary")}</p>
                      <p className="text-sm text-muted-foreground">{t("settings.ai.autoSummaryDesc")}</p>
                    </div>
                    <label className="relative inline-flex items-center cursor-pointer">
                      <input
                        type="checkbox"
                        checked={settings.autoSummaryOnOpen}
                        onChange={(e) => updateSettings({ autoSummaryOnOpen: e.target.checked })}
                        className="sr-only peer"
                      />
                      <div className="w-11 h-6 bg-secondary peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary" />
                    </label>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>{t("settings.accentColor")}</CardTitle>
                  <CardDescription>{t("settings.accentColorDesc")}</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="flex gap-3">
                    {(Object.keys(ACCENT_COLORS) as AccentColor[]).map((color) => {
                      const selected = settings.accentColor === color;
                      return (
                        <button
                          key={color}
                          type="button"
                          onClick={() => updateSettings({ accentColor: color })}
                          aria-label={ACCENT_COLORS[color].label}
                          aria-pressed={selected}
                          title={ACCENT_COLORS[color].label}
                          className={`relative w-10 h-10 rounded-full transition-all duration-150 ring-offset-2 ring-offset-background hover:scale-110 active:scale-95 ${
                            selected ? "ring-2 ring-foreground" : "ring-0"
                          }`}
                          style={{ backgroundColor: ACCENT_COLORS[color].base }}
                        >
                          {selected && (
                            <Check
                              className="absolute inset-0 m-auto w-5 h-5 text-white drop-shadow"
                              strokeWidth={3}
                            />
                          )}
                        </button>
                      );
                    })}
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>{t("settings.language")}</CardTitle>
                  <CardDescription>{t("settings.languageDesc")}</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-2 gap-4">
                    {(["en", "zh", "ja", "ko"] as const).map((lang) => (
                      <button
                        key={lang}
                        onClick={() => updateSettings({ language: lang })}
                        className={`p-4 rounded-xl border-2 transition-all ${
                          settings.language === lang
                            ? "border-primary bg-primary/5 font-semibold"
                            : "border-border hover:border-primary/50"
                        }`}
                      >
                        <div className="text-center">
                          <span className="text-base">
                            {lang === "en" ? "English" : lang === "zh" ? "简体中文" : lang === "ja" ? "日本語" : "한국어"}
                          </span>
                        </div>
                      </button>
                    ))}
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>{t("settings.trayTitle")}</CardTitle>
                  <CardDescription>{t("settings.trayDesc")}</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="flex items-center justify-between py-2">
                    <div>
                      <p className="font-medium">{t("settings.minimizeToTray")}</p>
                      <p className="text-sm text-muted-foreground">{t("settings.minimizeToTrayDesc")}</p>
                    </div>
                    <label className="relative inline-flex items-center cursor-pointer">
                      <input
                        type="checkbox"
                        checked={settings.minimizeToTray}
                        onChange={(e) => updateSettings({ minimizeToTray: e.target.checked })}
                        className="sr-only peer"
                      />
                      <div className="w-11 h-6 bg-secondary peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary" />
                    </label>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>{t("settings.courseSort")}</CardTitle>
                  <CardDescription>{t("settings.courseSortDesc")}</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-2 gap-2">
                    {([
                      { v: "term" as const, label: t("settings.courseSortTerm") },
                      { v: "name" as const, label: t("settings.courseSortName") },
                    ]).map((opt) => (
                      <button
                        key={opt.v}
                        onClick={() => updateSettings({ courseSortBy: opt.v })}
                        className={`p-3 rounded-lg border-2 text-sm transition-all ${
                          settings.courseSortBy === opt.v
                            ? "border-primary bg-primary/5"
                            : "border-border hover:border-primary/50"
                        }`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        );

      case "notifications":
        return (
          <div className="space-y-6">
            <div>
              <h2 className="text-2xl font-bold mb-2">{t("settings.notifications.pageTitle")}</h2>
              <p className="text-muted-foreground">{t("settings.notifications.pageSubtitle")}</p>
            </div>

            <div className="max-w-2xl mx-auto space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle>{t("settings.notifications.dueTitle")}</CardTitle>
                  <CardDescription>{t("settings.notifications.dueDesc")}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex items-center justify-between py-2">
                    <div>
                      <p className="font-medium">{t("settings.notifications.dueReminder")}</p>
                      <p className="text-sm text-muted-foreground">{t("settings.notifications.dueReminderDesc")}</p>
                    </div>
                    <label className="relative inline-flex items-center cursor-pointer">
                      <input
                        type="checkbox"
                        checked={settings.notifyDueReminder}
                        onChange={(e) => {
                          updateSettings({ notifyDueReminder: e.target.checked });
                          if (e.target.checked) requestNotificationPermission();
                        }}
                        className="sr-only peer"
                      />
                      <div className="w-11 h-6 bg-secondary peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary" />
                    </label>
                  </div>
                  <div>
                    <label className="text-sm font-medium mb-1 block">{t("settings.notifications.remindDays")}</label>
                    <div className="grid grid-cols-3 gap-2">
                      {[1, 3, 7].map((d) => (
                        <button
                          key={d}
                          onClick={() => updateSettings({ dueReminderDays: d })}
                          className={`p-2 rounded-lg border-2 text-sm transition-all ${
                            settings.dueReminderDays === d
                              ? "border-primary bg-primary/5"
                              : "border-border hover:border-primary/50"
                          }`}
                        >
                          {t(d === 1 ? "settings.notifications.remindDays1" : d === 3 ? "settings.notifications.remindDays3" : "settings.notifications.remindDays7")}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="flex items-center justify-between py-2">
                    <div>
                      <p className="font-medium">{t("settings.notifications.newAnnouncement")}</p>
                      <p className="text-sm text-muted-foreground">{t("settings.notifications.newAnnouncementDesc")}</p>
                    </div>
                    <label className="relative inline-flex items-center cursor-pointer">
                      <input
                        type="checkbox"
                        checked={settings.notifyNewAnnouncement}
                        onChange={(e) => {
                          updateSettings({ notifyNewAnnouncement: e.target.checked });
                          if (e.target.checked) requestNotificationPermission();
                        }}
                        className="sr-only peer"
                      />
                      <div className="w-11 h-6 bg-secondary peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary" />
                    </label>
                  </div>
                  <div className="flex items-center justify-between py-2">
                    <div>
                      <p className="font-medium">{t("settings.notifications.newResource")}</p>
                      <p className="text-sm text-muted-foreground">{t("settings.notifications.newResourceDesc")}</p>
                    </div>
                    <label className="relative inline-flex items-center cursor-pointer">
                      <input
                        type="checkbox"
                        checked={settings.notifyNewResource}
                        onChange={(e) => {
                          updateSettings({ notifyNewResource: e.target.checked });
                          if (e.target.checked) requestNotificationPermission();
                        }}
                        className="sr-only peer"
                      />
                      <div className="w-11 h-6 bg-secondary peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary" />
                    </label>
                  </div>
                  <p className="text-xs text-muted-foreground leading-relaxed pt-2 border-t border-border/60">
                    {t("settings.notifications.systemNote")}
                  </p>
                </CardContent>
              </Card>
            </div>
          </div>
        );

      case "ai": {
        return (
          <div className="space-y-6">
            <div>
              <h2 className="text-2xl font-bold mb-2">{t("settings.ai.pageTitle")}</h2>
              <p className="text-muted-foreground">{t("settings.ai.pageSubtitle")}</p>
            </div>

            <div className="max-w-2xl mx-auto space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle>{t("settings.ai.title")}</CardTitle>
                  <CardDescription>{t("settings.ai.subtitle")}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <label className="text-sm font-medium mb-1 block">{t("settings.ai.format")}</label>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                      {([
                        { v: "openai" as const, label: t("settings.ai.formatOpenAI"), sub: "/chat/completions" },
                        { v: "anthropic" as const, label: t("settings.ai.formatAnthropic"), sub: "/v1/messages" },
                        { v: "custom" as const, label: t("settings.ai.formatCustom"), sub: t("settings.ai.formatCustomSub") },
                      ]).map((opt) => (
                        <button
                          key={opt.v}
                          type="button"
                          onClick={() => {
                            const fmt = opt.v;
                            const patch: Partial<typeof settings> = { aiFormat: fmt };
                            const knownBases = ["https://api.openai.com/v1", "https://api.anthropic.com/v1"];
                            const curBase = splitAiUrl(settings.aiBaseUrl || "").base;
                            if (fmt !== "custom") {
                              patch.aiCompatType = fmt;
                              const newBase = fmt === "anthropic" ? "https://api.anthropic.com/v1" : "https://api.openai.com/v1";
                              if (!curBase || knownBases.includes(curBase)) patch.aiBaseUrl = newBase;
                            }
                            updateSettings(patch);
                          }}
                          className={`p-3 rounded-xl border-2 text-left transition-all ${
                            effectiveAiFormat === opt.v
                              ? "border-primary bg-primary/5"
                              : "border-border hover:border-primary/40"
                          }`}
                        >
                          <span className="block text-sm font-medium">{opt.label}</span>
                          <span className="block text-xs text-muted-foreground mt-0.5 font-mono">{opt.sub}</span>
                        </button>
                      ))}
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">{t("settings.ai.formatDesc")}</p>
                  </div>
                  <div>
                    <label className="text-sm font-medium mb-1 block">{t("settings.ai.baseUrl")}</label>
                    <Input
                      placeholder="https://api.longcat.chat/openai/v1"
                      value={settings.aiBaseUrl || ""}
                      onChange={(e) => updateSettings({ aiBaseUrl: e.target.value })}
                    />
                    <p className="text-xs text-muted-foreground mt-1">
                      {t("settings.ai.baseUrlDesc")}
                    </p>
                  </div>
                  <div>
                    <label className="text-sm font-medium mb-1 block">{t("settings.ai.apiKey")}</label>
                    <div className="relative">
                      <Input
                        type={showApiKey ? "text" : "password"}
                        placeholder="sk-..."
                        className="pr-10"
                        value={settings.aiApiKey || ""}
                        onChange={(e) => updateSettings({ aiApiKey: e.target.value })}
                      />
                      <button
                        type="button"
                        onClick={() => setShowApiKey((v) => !v)}
                        className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-muted-foreground hover:text-foreground transition-colors"
                        aria-label={showApiKey ? t("settings.ai.hideKey") : t("settings.ai.showKey")}
                        title={showApiKey ? t("settings.ai.hideKey") : t("settings.ai.showKey")}
                      >
                        {showApiKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">
                      {t("settings.ai.apiKeyDesc")}
                    </p>
                  </div>
                  <div>
                    <label className="text-sm font-medium mb-1 block">{t("settings.ai.model")}</label>
                    <Input
                      placeholder={
                        settings.aiCompatType === "anthropic"
                          ? t("settings.ai.modelPlaceholderAnthropic")
                          : t("settings.ai.modelPlaceholderOpenAI")
                      }
                      value={settings.aiModel || ""}
                      onChange={(e) => updateSettings({ aiModel: e.target.value })}
                    />
                  </div>
                  {/* Connection test */}
                  <div className="flex items-center gap-3 flex-wrap">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleTestAiConnection}
                      disabled={aiTest.status === "testing"}
                    >
                      {aiTest.status === "testing" ? (
                        <>
                          <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                          {t("settings.ai.testing")}
                        </>
                      ) : (
                        <>
                          <PlugZap className="w-4 h-4 mr-2" />
                          {t("settings.ai.test")}
                        </>
                      )}
                    </Button>
                    {aiTest.status === "ok" && (
                      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-600 dark:text-emerald-400 break-all">
                        <CheckCircle2 className="w-4 h-4 shrink-0" />
                        {t("settings.ai.testOk")} · {aiTest.message}
                      </span>
                    )}
                    {aiTest.status === "error" && (
                      <div className="text-xs font-medium text-destructive break-all">
                        <span className="inline-flex items-center gap-1.5">
                          <AlertCircle className="w-4 h-4 shrink-0" />
                          {aiTest.message}
                        </span>
                        {aiTest.raw && aiTest.raw !== aiTest.message && (
                          <details className="mt-1.5 text-muted-foreground">
                            <summary className="cursor-pointer select-none">{t("settings.ai.errRawToggle")}</summary>
                            <pre className="mt-1 whitespace-pre-wrap break-all font-mono text-[11px] leading-relaxed bg-muted/50 rounded-lg p-2 max-h-40 overflow-auto">{aiTest.raw}</pre>
                          </details>
                        )}
                      </div>
                    )}
                  </div>

                  <Button
                    onClick={async () => {
                      if (!settings.aiApiKey?.trim() || !settings.aiBaseUrl?.trim()) {
                        showToast(t("settings.ai.testMissing"));
                        return;
                      }
                      const fullUrl = buildAiUrl(settings.aiBaseUrl || "", effectiveAiFormat);
                      const defaultModel = effectiveAiFormat === "anthropic"
                        ? "claude-3-5-sonnet-20241022"
                        : "gpt-4o-mini";
                      try {
                        await saveAiConfig(
                          settings.aiApiKey || "",
                          fullUrl,
                          settings.aiModel || defaultModel
                        );
                        showToast(t("settings.ai.saved"));
                      } catch (e) {
                        showToast(e instanceof Error ? e.message : String(e));
                      }
                    }}
                  >
                    <Check className="w-4 h-4 mr-1.5" />
                    {t("settings.ai.save")}
                  </Button>

                </CardContent>
              </Card>

              

              
            </div>
          </div>
        );
      }

      case "sync":
        return (
          <div className="space-y-6">
            <div>
              <h2 className="text-2xl font-bold mb-2">{t("settings.sync.pageTitle")}</h2>
              <p className="text-muted-foreground">{t("settings.sync.pageSubtitle")}</p>
            </div>

            <div className="max-w-2xl mx-auto space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle>{t("settings.sync.autoTitle")}</CardTitle>
                  <CardDescription>{t("settings.sync.autoDesc")}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <label className="text-sm font-medium mb-1 block">{t("settings.sync.frequency")}</label>
                    <select
                      className="w-full h-10 rounded-xl border border-input bg-background text-foreground px-4 py-2"
                      value={String(settings.autoSyncIntervalDays ?? 7)}
                      onChange={(e) =>
                        updateSettings({ autoSyncIntervalDays: Number(e.target.value) })
                      }
                    >
                      <option value="0">{t("settings.sync.freqOff")}</option>
                      <option value="3">{t("settings.sync.freq3d")}</option>
                      <option value="7">{t("settings.sync.freqWeekly")}</option>
                    </select>
                    <p className="text-xs text-muted-foreground mt-1">
                      {t("settings.sync.frequencyDesc")}
                    </p>
                  </div>

                  <div className="flex items-center justify-between py-2 mt-3 border-t border-border/60">
                    <div>
                      <p className="font-medium">{t("settings.sync.onLaunch")}</p>
                      <p className="text-sm text-muted-foreground">{t("settings.sync.onLaunchDesc")}</p>
                    </div>
                    <label className="relative inline-flex items-center cursor-pointer">
                      <input
                        type="checkbox"
                        checked={settings.syncOnLaunch}
                        onChange={(e) => updateSettings({ syncOnLaunch: e.target.checked })}
                        className="sr-only peer"
                      />
                      <div className="w-11 h-6 bg-secondary peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary" />
                    </label>
                  </div>
                  
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>{t("settings.download.title")}</CardTitle>
                  <CardDescription>{t("settings.download.desc")}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <label className="text-sm font-medium mb-1 block">{t("settings.download.pathLabel")}</label>
                    <div className="flex gap-2">
                      <Input
                        value={settings.downloadPath}
                        placeholder={t("settings.download.pathPlaceholder")}
                        onChange={(e) => updateSettings({ downloadPath: e.target.value })}
                      />
                      <Button
                        variant="outline"
                        onClick={async () => {
                          try {
                            const picked = await open({
                              directory: true,
                              multiple: false,
                              title: t("settings.download.pickTitle"),
                              defaultPath: settings.downloadPath || undefined,
                            });
                            if (typeof picked === "string" && picked) {
                              updateSettings({ downloadPath: picked });
                            }
                          } catch (err) {
                            console.error("Failed to open folder picker:", err);
                          }
                        }}
                      >
                        {t("settings.download.browse")}
                      </Button>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">
                      {t("settings.download.pathHint")}
                    </p>
                  </div>

                  <div className="flex items-center justify-between py-2 mt-3 border-t border-border/60">
                    <div>
                      <p className="font-medium">{t("settings.download.openFolder")}</p>
                      <p className="text-sm text-muted-foreground">{t("settings.download.openFolderDesc")}</p>
                    </div>
                    <label className="relative inline-flex items-center cursor-pointer">
                      <input
                        type="checkbox"
                        checked={settings.openFolderAfterDownload}
                        onChange={(e) => updateSettings({ openFolderAfterDownload: e.target.checked })}
                        className="sr-only peer"
                      />
                      <div className="w-11 h-6 bg-secondary peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary" />
                    </label>
                  </div>
                  
                </CardContent>
              </Card>

              <div className="flex gap-3">
                <Button onClick={() => { useAppStore.getState().updateSettings({ lastAutoSyncAt: new Date().toISOString() }); syncAll().catch(console.error); }}>
                  <Download className="w-4 h-4 mr-2" />
                  {t("dashboard.sync")}
                </Button>
                <Button variant="outline" onClick={() => setDeleteOpen(true)}>
                  {t("common.delete")} {t("dashboard.resources")}
                </Button>
                <Button variant="destructive" onClick={() => setClearOpen(true)}>
                  {t("settings.sync.clearAll")}
                </Button>
              </div>
            </div>
          </div>
        );

      case "feedback":
        return <FeedbackPanel />;

      case "about":
        return (
          <div className="space-y-6">
            <div>
              <h2 className="text-2xl font-bold mb-2">{t("settings.about.pageTitle")}</h2>
              <p className="text-muted-foreground">{t("settings.about.pageSubtitle")}</p>
            </div>

            <div className="max-w-2xl mx-auto space-y-6">
              <Card>
                <CardContent className="pt-6">
                  <div className="flex flex-col items-center text-center">
                    <img
                      src={appIcon}
                      alt="Muster App Icon"
                      className="w-20 h-20 rounded-2xl shadow-xl ring-1 ring-border/30 object-cover mb-4"
                    />
                    <h3 className="text-xl font-bold mb-1.5">Muster</h3>
                    <div className="flex flex-wrap items-center justify-center gap-2 mb-3">
                      <span className="text-xs px-2.5 py-0.5 rounded-full bg-secondary text-muted-foreground border">
                        {t("settings.about.version", { version: APP_CURRENT_VERSION })}
                      </span>
                      <span className="text-xs px-2.5 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20 font-medium">
                        {t("settings.about.authorBadge", { author: "Poetrynan" })}
                      </span>
                      <span className="text-xs px-2.5 py-0.5 rounded-full bg-secondary text-muted-foreground border">
                        {t("settings.about.license")}
                      </span>
                      <button
                        type="button"
                        onClick={handleCheckUpdate}
                        disabled={checkingUpdate}
                        className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium bg-secondary hover:bg-secondary/80 text-foreground border transition-all active:scale-95 disabled:opacity-60 cursor-pointer"
                      >
                        <RefreshCw className={`w-3 h-3 ${checkingUpdate ? "animate-spin text-primary" : ""}`} />
                        {checkingUpdate ? t("settings.about.checkingUpdates") : t("settings.about.checkUpdates")}
                      </button>
                    </div>

                    {showUpToDateToast && (
                      <div className="mb-3 inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 animate-in fade-in zoom-in duration-200">
                        <Check className="w-3.5 h-3.5" />
                        {t("settings.about.upToDate", { version: APP_CURRENT_VERSION })}
                      </div>
                    )}

                    <p className="text-sm text-muted-foreground max-w-md">
                      {t("settings.about.description")}
                    </p>
                  </div>
                </CardContent>
              </Card>

              {/* New version found card */}
              {updateResult?.hasUpdate && updateResult.latestRelease && (
                <Card className="border-primary/40 bg-gradient-to-br from-primary/5 via-card to-card shadow-lg ring-1 ring-primary/20 animate-in fade-in slide-in-from-top-3 duration-300">
                  <CardHeader className="pb-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="p-1.5 rounded-lg bg-primary/10 text-primary">
                          <Sparkles className="w-4 h-4 animate-pulse" />
                        </span>
                        <div>
                          <CardTitle className="text-base">
                            {t("settings.about.updateAvailable")}
                          </CardTitle>
                          <CardDescription className="text-xs">
                            {updateResult.latestRelease.name || updateResult.latestRelease.tagName}
                          </CardDescription>
                        </div>
                      </div>
                      <span className="px-2.5 py-1 rounded-full text-xs font-bold bg-primary text-primary-foreground shadow-sm">
                        {t("settings.about.updateTag", { version: updateResult.latestRelease.version })}
                      </span>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {updateResult.latestRelease.body && (
                      <div className="p-3.5 rounded-xl bg-background/60 border text-xs text-muted-foreground whitespace-pre-wrap max-h-48 overflow-y-auto leading-relaxed">
                        <p className="font-semibold text-foreground mb-1.5">{t("settings.about.releaseNotes")}:</p>
                        {updateResult.latestRelease.body}
                      </div>
                    )}
                    <div className="flex flex-wrap gap-2.5 pt-1">
                      {updateResult.latestRelease.downloadUrl && (
                        <Button
                          size="sm"
                          onClick={() => handleOpenReleaseUrl(updateResult.latestRelease!.downloadUrl!)}
                          className="gap-2 shadow-sm font-medium"
                        >
                          <Download className="w-4 h-4" />
                          {t("settings.about.downloadUpdate")}
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleOpenReleaseUrl(updateResult.latestRelease!.htmlUrl)}
                        className="gap-2"
                      >
                        <ExternalLink className="w-4 h-4" />
                        {t("settings.about.viewRelease")}
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* No releases published yet notice */}
              {updateResult?.noReleases && (
                <div className="p-3 rounded-xl bg-muted/50 border border-border text-muted-foreground text-xs flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{t("settings.about.noReleases")}</span>
                </div>
              )}

              {/* Check failed notice */}
              {updateResult?.error && (
                <div className="p-3 rounded-xl bg-destructive/10 border border-destructive/20 text-destructive text-xs flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{t("settings.about.updateFailed")} ({updateResult.error})</span>
                </div>
              )}

              <Card>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <div>
                      <CardTitle>{t("settings.about.disclaimerTitle")}</CardTitle>
                      <CardDescription>{t("settings.about.disclaimerDesc")}</CardDescription>
                    </div>
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-secondary text-muted-foreground border">
                      <Shield className="w-3.5 h-3.5" />
                      {t("settings.about.disclaimerBadge")}
                    </span>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3 text-xs text-muted-foreground leading-relaxed">
                  <p>
                    {t("settings.about.disclaimer1")}
                  </p>
                  <p>
                    {t("settings.about.disclaimer2")}
                  </p>
                  <p>
                    {t("settings.about.disclaimer3")}
                  </p>
                  <p>
                    {t("settings.about.disclaimer4")}
                  </p>
                </CardContent>
              </Card>

              {/* Author and copyright footer */}
              <div className="pt-4 pb-2 text-center space-y-1.5 select-none">
                <div className="inline-flex items-center gap-1.5 text-xs text-muted-foreground font-medium">
                  <span>{t("settings.about.craftedBy")}</span>
                  <span className="font-semibold text-foreground bg-secondary/80 px-2 py-0.5 rounded-md border border-border/50">
                    Poetrynan
                  </span>
                  <Heart className="w-3.5 h-3.5 text-rose-500 fill-rose-500 inline-block" aria-hidden="true" />
                </div>
                <p className="text-[11px] text-muted-foreground">
                  {t("settings.about.copyright", { year: "2026", author: "Poetrynan" })}
                </p>
              </div>
            </div>
          </div>
        );
    }
  };

  return (
    <div className="min-h-screen bg-background flex">
      {/* Sidebar */}
      <motion.aside
        initial={{ x: -280 }}
        animate={{ x: 0 }}
        transition={{ duration: 0.4, ease: [0.25, 0.1, 0.25, 1] }}
        className="w-64 glass border-r flex flex-col"
      >
        <div className="p-4 border-b">
          <Button variant="ghost" onClick={onBack} className="gap-2">
            <ArrowLeft className="w-4 h-4" />
            {t("common.back")}
          </Button>
        </div>
        <nav className="flex-1 p-4 space-y-1">
          {sidebarItems.map((item) => (
            <button
              key={item.key}
              onClick={() => setActiveSection(item.key)}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200 ${
                activeSection === item.key
                  ? "bg-primary text-primary-foreground"
                  : "hover:bg-secondary text-muted-foreground hover:text-foreground"
              }`}
            >
              <item.icon className="w-5 h-5" />
              <span className="font-medium">{t(item.labelKey)}</span>
            </button>
          ))}
        </nav>
      </motion.aside>

      {/* Main content area */}
      <main className="flex-1 overflow-auto p-8">
        <motion.div
          key={activeSection}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
          className="max-w-4xl w-full"
        >
          {renderContent()}
        </motion.div>
      </main>

      {/* Clear-data modal: explicit choices instead of one-click wipe-all */}
      <Dialog open={clearOpen} onClose={() => setClearOpen(false)}>
        <div className="space-y-4">
          <div className="flex items-start gap-3">
            <span className="p-2 rounded-xl bg-destructive/10 text-destructive shrink-0">
              <AlertTriangle className="w-5 h-5" />
            </span>
            <div>
              <h3 className="text-lg font-bold">{t("settings.clearModal.title")}</h3>
              <p className="text-sm text-muted-foreground mt-0.5">{t("settings.clearModal.desc")}</p>
            </div>
          </div>

          <div className="space-y-2">
            {([
              { key: "data" as const, label: t("settings.clearModal.optionData"), desc: t("settings.clearModal.optionDataDesc") },
              { key: "downloads" as const, label: t("settings.clearModal.optionDownloads"), desc: t("settings.clearModal.optionDownloadsDesc") },
              { key: "session" as const, label: t("settings.clearModal.optionSession"), desc: t("settings.clearModal.optionSessionDesc") },
              { key: "settings" as const, label: t("settings.clearModal.optionSettings"), desc: t("settings.clearModal.optionSettingsDesc") },
            ]).map((opt) => (
              <label
                key={opt.key}
                className={`flex items-start gap-3 p-3 rounded-xl border-2 cursor-pointer transition-all ${
                  clearSelection[opt.key]
                    ? "border-destructive/50 bg-destructive/5"
                    : "border-border hover:border-primary/40"
                }`}
              >
                <input
                  type="checkbox"
                  className="mt-0.5 w-4 h-4 accent-destructive"
                  checked={clearSelection[opt.key]}
                  onChange={() => toggleClearOption(opt.key)}
                />
                <span>
                  <span className="block text-sm font-medium">{opt.label}</span>
                  <span className="block text-xs text-muted-foreground mt-0.5">{opt.desc}</span>
                </span>
              </label>
            ))}
          </div>

          <p className="text-xs text-destructive/90 leading-relaxed">{t("settings.clearModal.note")}</p>

          <div className="flex justify-end gap-3 pt-1">
            <Button variant="outline" onClick={() => setClearOpen(false)} disabled={clearing}>
              {t("settings.clearModal.cancel")}
            </Button>
            <Button
              variant="destructive"
              onClick={handleClearSelected}
              disabled={clearing || !Object.values(clearSelection).some(Boolean)}
            >
              {clearing ? "…" : t("settings.clearModal.confirm")}
            </Button>
          </div>
        </div>
      </Dialog>

      {/* Delete-resources modal: explicit checkboxes instead of one-click wipe */}
      <Dialog open={deleteOpen} onClose={() => setDeleteOpen(false)}>
        <div className="space-y-4">
          <div className="flex items-start gap-3">
            <span className="p-2 rounded-xl bg-destructive/10 text-destructive shrink-0">
              <AlertTriangle className="w-5 h-5" />
            </span>
            <div>
              <h3 className="text-lg font-bold">{t("settings.deleteModal.title")}</h3>
              <p className="text-sm text-muted-foreground mt-0.5">{t("settings.deleteModal.desc")}</p>
            </div>
          </div>

          <div className="space-y-2">
            {([
              { key: "courses" as const, label: t("settings.deleteModal.optionCourses"), desc: t("settings.deleteModal.optionCoursesDesc") },
              { key: "resources" as const, label: t("settings.deleteModal.optionResources"), desc: t("settings.deleteModal.optionResourcesDesc") },
              { key: "assignments" as const, label: t("settings.deleteModal.optionAssignments"), desc: t("settings.deleteModal.optionAssignmentsDesc") },
              { key: "announcements" as const, label: t("settings.deleteModal.optionAnnouncements"), desc: t("settings.deleteModal.optionAnnouncementsDesc") },
            ]).map((opt) => (
              <label
                key={opt.key}
                className={`flex items-start gap-3 p-3 rounded-xl border-2 cursor-pointer transition-all ${
                  deleteSelection[opt.key]
                    ? "border-destructive/50 bg-destructive/5"
                    : "border-border hover:border-primary/40"
                }`}
              >
                <input
                  type="checkbox"
                  className="mt-0.5 w-4 h-4 accent-destructive"
                  checked={deleteSelection[opt.key]}
                  onChange={() => toggleDeleteOption(opt.key)}
                />
                <span>
                  <span className="block text-sm font-medium">{opt.label}</span>
                  <span className="block text-xs text-muted-foreground mt-0.5">{opt.desc}</span>
                </span>
              </label>
            ))}
          </div>

          <p className="text-xs text-destructive/90 leading-relaxed">{t("settings.deleteModal.note")}</p>

          <div className="flex justify-end gap-3 pt-1">
            <Button variant="outline" onClick={() => setDeleteOpen(false)} disabled={deleting}>
              {t("settings.deleteModal.cancel")}
            </Button>
            <Button
              variant="destructive"
              onClick={handleDeleteSelected}
              disabled={deleting || !Object.values(deleteSelection).some(Boolean)}
            >
              {deleting ? "…" : t("settings.deleteModal.confirm")}
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}
