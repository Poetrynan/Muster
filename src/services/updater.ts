/**
 * GitHub Release Update Service
 * Checks repository releases from GitHub API and compares SemVer versions.
 */

import { invoke } from "@tauri-apps/api/core";

export interface GitHubAsset {
  name: string;
  browser_download_url: string;
  size: number;
  content_type: string;
}

export interface ReleaseInfo {
  tagName: string;
  version: string;
  name: string;
  body: string;
  publishedAt: string;
  htmlUrl: string;
  downloadUrl?: string;
  installerName?: string;
}

export interface UpdateCheckResult {
  hasUpdate: boolean;
  currentVersion: string;
  latestRelease?: ReleaseInfo;
  error?: string;
  /** true when the repo exists but has no releases (or repo not found -> 404) */
  noReleases?: boolean;
}

export const GITHUB_REPO = "Poetrynan/Muster";

/**
 * Current app version, read from the runtime (tauri.conf.json via getVersion).
 * Never hardcoded: bumping the version in tauri.conf.json before packaging is
 * the single source of truth, so the About page, the update-check baseline and
 * the update banner can never display a stale version again.
 */
let cachedVersion: string | null = null;
export async function getCurrentAppVersion(): Promise<string> {
  if (cachedVersion) return cachedVersion;
  try {
    const { getVersion } = await import("@tauri-apps/api/app");
    cachedVersion = await getVersion();
  } catch {
    cachedVersion = "0.0.0";
  }
  return cachedVersion;
}

type DesktopPlatform = "macos" | "windows" | "other";
type DesktopArch = "aarch64" | "x86_64" | "other";

function getDesktopPlatform(): DesktopPlatform {
  if (typeof navigator === "undefined") return "other";
  const identity = `${navigator.platform || ""} ${navigator.userAgent || ""}`.toLowerCase();
  if (identity.includes("mac")) return "macos";
  if (identity.includes("win")) return "windows";
  return "other";
}

async function getDesktopArch(platform: DesktopPlatform): Promise<DesktopArch> {
  if (platform !== "macos") return "other";

  try {
    const arch = (await invoke<string>("get_target_arch")).toLowerCase();
    if (arch === "aarch64" || arch === "arm64") return "aarch64";
    if (arch === "x86_64" || arch === "x64" || arch === "amd64") return "x86_64";
  } catch (error) {
    console.warn("Could not determine desktop architecture:", error);
  }

  return "other";
}

/** Pick an installer for the current desktop without changing the GitHub release protocol. */
export function selectInstallerAsset(
  assets: GitHubAsset[],
  platform: DesktopPlatform = getDesktopPlatform(),
  arch: DesktopArch = "other"
): GitHubAsset | undefined {
  const lowerName = (asset: GitHubAsset) => asset.name.toLowerCase();

  if (platform === "macos") {
    const isDmg = (asset: GitHubAsset) => lowerName(asset).endsWith(".dmg");
    const isArm = (asset: GitHubAsset) =>
      isDmg(asset) && /(aarch64|arm64|apple[-_ ]?silicon)/.test(lowerName(asset));
    const isIntel = (asset: GitHubAsset) =>
      isDmg(asset) && /(x86[_-]?64|x64|amd64|intel)/.test(lowerName(asset));
    const isUniversal = (asset: GitHubAsset) =>
      isDmg(asset) && /universal/.test(lowerName(asset));

    if (arch === "aarch64") {
      return assets.find(isArm) || assets.find(isUniversal);
    }

    if (arch === "x86_64") {
      return assets.find(isIntel) || assets.find(isUniversal);
    }

    return (
      assets.find(isUniversal) ||
      assets.find(isArm) ||
      assets.find(isIntel) ||
      assets.find((asset) => lowerName(asset).endsWith(".app.tar.gz")) ||
      assets.find((asset) => lowerName(asset).endsWith(".zip"))
    );
  }

  if (platform === "windows") {
    return (
      assets.find((asset) => lowerName(asset).endsWith(".msi")) ||
      assets.find((asset) => lowerName(asset).endsWith(".exe")) ||
      assets.find((asset) => lowerName(asset).endsWith(".zip"))
    );
  }

  return assets.find((asset) => lowerName(asset).endsWith(".zip")) || assets[0];
}

/**
 * Compare two semver strings (e.g. "0.1.0" vs "0.2.0" or "v0.1.1")
 * Returns > 0 if v1 > v2, < 0 if v1 < v2, 0 if equal
 */
export function compareVersions(v1: string, v2: string): number {
  const clean1 = v1.replace(/^v/i, "").trim();
  const clean2 = v2.replace(/^v/i, "").trim();

  const parts1 = clean1.split(".").map((n) => parseInt(n, 10) || 0);
  const parts2 = clean2.split(".").map((n) => parseInt(n, 10) || 0);

  const len = Math.max(parts1.length, parts2.length);
  for (let i = 0; i < len; i++) {
    const num1 = parts1[i] ?? 0;
    const num2 = parts2[i] ?? 0;
    if (num1 > num2) return 1;
    if (num1 < num2) return -1;
  }
  return 0;
}

/**
 * fetch() with a hard timeout — GitHub API calls from mainland networks can
 * hang for tens of seconds; the update check must fail fast into the fallback.
 */
async function fetchJsonWithTimeout(url: string, ms = 8000): Promise<any> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    const r = await fetch(url, { signal: ctrl.signal });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Check for updates via GitHub Releases API
 */
export async function checkForAppUpdates(
  currentVersion?: string,
  repo: string = GITHUB_REPO
): Promise<UpdateCheckResult> {
  if (!currentVersion) {
    currentVersion = await getCurrentAppVersion();
  }
  try {
    let data: any;
    try {
      data = await fetchJsonWithTimeout(`https://api.github.com/repos/${repo}/releases/latest`);
      if (data?.message && String(data.message).includes("API rate limit")) {
        throw new Error("GitHub API rate limited");
      }
    } catch (apiErr: any) {
      // The API host is flaky from some networks (rate limits, blocked, timeouts).
      // Fall back to the static latest.json that the updater plugin itself uses —
      // it carries the version and platform installer URLs, which is all the
      // banner needs; release notes simply fall back to the release page.
      const lj = await fetchJsonWithTimeout(
        `https://github.com/${repo}/releases/latest/download/latest.json`
      );
      const version = String(lj?.version || "").replace(/^v/i, "").trim();
      if (!version) throw apiErr;
      const platform = getDesktopPlatform();
      const arch = await getDesktopArch(platform);
      const platforms = lj?.platforms || {};
      const want =
        platform === "windows"
          ? `windows-${arch === "x86_64" ? "x86_64" : arch}`
          : platform === "macos"
            ? `darwin-${arch === "aarch64" ? "aarch64" : "x86_64"}`
            : "";
      const entry = platforms[want] || Object.values(platforms)[0];
      const htmlUrl = `https://github.com/${repo}/releases/latest`;
      return {
        hasUpdate: compareVersions(version, currentVersion) > 0,
        currentVersion,
        latestRelease: {
          tagName: `v${version}`,
          version,
          name: `Muster v${version}`,
          body: lj?.notes || "",
          publishedAt: lj?.pub_date || "",
          htmlUrl,
          downloadUrl: entry?.url || htmlUrl,
          installerName: typeof entry?.url === "string" ? entry.url.split("/").pop() : undefined,
        },
      };
    }

    if (typeof data?.message === "string" && data.message.includes("Not Found")) {
      // No releases published yet on this repository (or repo not found).
      // Report it honestly instead of pretending the app is up to date.
      return {
        hasUpdate: false,
        currentVersion,
        noReleases: true,
      };
    }

    const tagName = data.tag_name || "";
    const cleanLatest = tagName.replace(/^v/i, "").trim();

    // Find the installer for the current desktop architecture/platform.
    const assets: GitHubAsset[] = data.assets || [];
    const platform = getDesktopPlatform();
    const arch = await getDesktopArch(platform);
    const installerAsset = selectInstallerAsset(assets, platform, arch);

    const releaseInfo: ReleaseInfo = {
      tagName,
      version: cleanLatest || tagName,
      name: data.name || tagName,
      body: data.body || "",
      publishedAt: data.published_at || "",
      htmlUrl: data.html_url || `https://github.com/${repo}/releases`,
      downloadUrl: installerAsset?.browser_download_url || data.html_url,
      installerName: installerAsset?.name,
    };

    const hasUpdate = compareVersions(cleanLatest, currentVersion) > 0;

    return {
      hasUpdate,
      currentVersion,
      latestRelease: releaseInfo,
    };
  } catch (err: any) {
    console.warn("Check for updates failed:", err);
    return {
      hasUpdate: false,
      currentVersion,
      error: err?.message || "Failed to check for updates",
    };
  }
}

/* ------------------------------------------------------------------ *
 * In-app install (Tauri updater plugin)
 *
 * The GitHub API check above stays as-is: it is what powers the release
 * notes card and works even in the browser dev server. What follows is the
 * *install* half — it asks the updater plugin for the signed artifact listed
 * in `latest.json`, streams it down, verifies the minisign signature and
 * hands it to the platform installer. No browser, no manual download.
 * ------------------------------------------------------------------ */

export interface InstallProgress {
  /** Bytes received so far. */
  downloaded: number;
  /** Total bytes, when the server sent a Content-Length. */
  total?: number;
  /** 0-100, only meaningful once `total` is known. */
  percent?: number;
}

export type InstallOutcome =
  /** Downloaded, verified, installed. Caller should relaunch. */
  | { status: "installed"; version: string }
  /** Plugin says we are already current — nothing to do. */
  | { status: "upToDate" }
  /** No updater available (browser dev server, or a build without the plugin).
   *  Caller should fall back to opening the release page. */
  | { status: "unsupported"; reason: string };

/**
 * Download and install the pending update in place.
 *
 * Deliberately returns `unsupported` instead of throwing when the plugin is
 * missing: v0.1.7 and earlier were built without it, and the dev server has no
 * Tauri runtime at all. Callers keep the "open the download page" path alive
 * for those cases, so the button never becomes a dead end.
 */
export async function installUpdateInApp(
  onProgress?: (p: InstallProgress) => void
): Promise<InstallOutcome> {
  let check: typeof import("@tauri-apps/plugin-updater").check;
  try {
    ({ check } = await import("@tauri-apps/plugin-updater"));
  } catch (err: any) {
    return { status: "unsupported", reason: err?.message || "updater plugin not bundled" };
  }

  let update: Awaited<ReturnType<typeof check>>;
  try {
    update = await check();
  } catch (err: any) {
    // Missing `plugins.updater` config, an unreachable endpoint or a signature
    // mismatch all land here. Surfacing it lets the UI show the real reason.
    throw new Error(err?.message || String(err));
  }

  if (!update) return { status: "upToDate" };

  let downloaded = 0;
  let total: number | undefined;

  await update.downloadAndInstall((event) => {
    switch (event.event) {
      case "Started":
        total = event.data.contentLength;
        downloaded = 0;
        onProgress?.({ downloaded, total, percent: total ? 0 : undefined });
        break;
      case "Progress":
        downloaded += event.data.chunkLength;
        onProgress?.({
          downloaded,
          total,
          percent: total ? Math.min(100, Math.round((downloaded / total) * 100)) : undefined,
        });
        break;
      case "Finished":
        onProgress?.({ downloaded, total: total ?? downloaded, percent: 100 });
        break;
    }
  });

  return { status: "installed", version: update.version };
}

/**
 * installUpdateInApp with bounded retries: the check/download each make network
 * requests to github.com, which fail transiently more often than any local bug —
 * a single hiccup used to dump the user onto the release page. 3 attempts with
 * short backoff absorb the common case; the final error still propagates.
 */
export async function installUpdateInAppWithRetry(
  onProgress?: (p: InstallProgress) => void,
  attempts = 3
): Promise<InstallOutcome> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await installUpdateInApp(onProgress);
    } catch (err) {
      lastErr = err;
      if (i < attempts - 1) {
        await new Promise((r) => setTimeout(r, 2000 * (i + 1)));
      }
    }
  }
  throw lastErr;
}

/** Restart into the freshly installed version. No-op outside Tauri. */
export async function relaunchApp(): Promise<void> {
  const { relaunch } = await import("@tauri-apps/plugin-process");
  await relaunch();
}
