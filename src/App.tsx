import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Dashboard } from "./pages/Dashboard";
import { LoginPage } from "./pages/LoginPage";
import { useAppStore } from "./stores/useAppStore";
import { ToastHost } from "./components/ui/toast";
import { loadSavedSession, onSessionExpired } from "./services/api";
import { ACCENT_COLORS } from "./types";

function App() {
  const { isLoggedIn, settings, setLoggedIn, setUser, reset } = useAppStore();
  // Startup gate: keep the login page hidden until the saved session has been restored.
  // Rendering LoginPage before loadSavedSession() resolves made an already-signed-in
  // user see a flash of the landing page on every launch.
  const [sessionChecked, setSessionChecked] = useState(false);

  // Apply theme to document
  useEffect(() => {
    const root = document.documentElement;
    
    if (settings.darkMode === "dark") {
      root.classList.add("dark");
    } else if (settings.darkMode === "light") {
      root.classList.remove("dark");
    } else {
      // System preference
      const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
      if (prefersDark) {
        root.classList.add("dark");
      } else {
        root.classList.remove("dark");
      }
    }
  }, [settings.darkMode]);

  // Apply the accent color: overrides the --color-primary family defined in @theme in index.css.
  // In dark mode use the light variant as the primary color (better contrast on dark backgrounds), in light mode use base.
  //
  // --color-accent must be overridden too: the Button ghost / outline variants use
  // `hover:bg-accent hover:text-accent-foreground` on hover, and --color-accent defaults to
  // amber orange. Without changing it, a user who picks a purple accent still gets an orange hover on the "Back" button.
  useEffect(() => {
    const root = document.documentElement;
    const accent = ACCENT_COLORS[settings.accentColor] ?? ACCENT_COLORS.blue;
    const isDark = root.classList.contains("dark");

    root.style.setProperty("--color-primary", isDark ? accent.light : accent.base);
    root.style.setProperty("--color-primary-hover", isDark ? accent.base : accent.hover);
    root.style.setProperty("--color-primary-light", accent.light);
    root.style.setProperty("--color-primary-foreground", isDark ? "#000000" : "#FFFFFF");
    root.style.setProperty("--color-ring", isDark ? accent.light : accent.base);

    // The "highlight surface" used on hover: light mode uses a light tint + dark text, dark mode the reverse
    root.style.setProperty("--color-accent", isDark ? accent.hover : accent.light);
    root.style.setProperty("--color-accent-foreground", isDark ? "#FFFFFF" : accent.hover);
  }, [settings.accentColor, settings.darkMode]);

  // P0-2: window + boot screen wrap-up — after React paints its first frame:
  //   1) show() the native window (tauri.conf.json already sets visible:true, this is a safety net)
  //   2) setFocus() to bring the window to the front — otherwise, if another window (e.g. File Explorer)
  //      is already in the foreground at startup, our window shows up behind it and gets partly covered
  //   3) notify the backend that the first frame is ready, cancelling the fallback timer in lib.rs
  //   4) call window.__bootDone() (defined in index.html) so the boot progress bar runs to 100% before fading out
  useEffect(() => {
    let cancelled = false;
    const mark = (window as unknown as { __bootMark?: (s: string, d?: string) => void }).__bootMark;
    mark?.("app-effect", "App mounted, first useEffect running");
    requestAnimationFrame(() => {
      if (cancelled) return;
      mark?.("app-raf", "requestAnimationFrame fired (first paint imminent)");
      const win = getCurrentWindow();
      win.show().catch(() => {});
      win.setFocus().catch(() => {});
      win.emit("app-ready").catch(() => {});
      (window as unknown as { __bootDone?: () => void }).__bootDone?.();
    });
    return () => { cancelled = true; };
  }, []);

  // Check for saved session silently in background without blocking UI
  useEffect(() => {
    loadSavedSession()
      .then((result) => {
        if (result.loggedIn) {
          setLoggedIn(true);
          if (result.user) {
            setUser(result.user);
          }
        } else {
          reset();
        }
      })
      .catch((err) => {
        console.log("Background session check error:", err);
      })
      .finally(() => {
        setSessionChecked(true);
      });
  }, [setLoggedIn, setUser, reset]);

  // Listen for session-expired event from Tauri backend
  useEffect(() => {
    const unlistenPromise = onSessionExpired(() => {
      console.log("Session expired event received, resetting app store");
      reset();
    });

    return () => {
      unlistenPromise.then((unlisten) => unlisten());
    };
  }, [reset]);

  if (!sessionChecked) {
    // The boot screen still covers the window at this point; render nothing but the
    // page background so a signed-in user never sees the landing page flash before
    // the Dashboard mounts.
    return <div className="min-h-screen bg-background" />;
  }

  return (
    <div className="min-h-screen bg-background">
      {isLoggedIn ? <Dashboard /> : <LoginPage />}
      {/* Global toast host: showToast() from anywhere */}
      <ToastHost />
    </div>
  );
}

export default App;
