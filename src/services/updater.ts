/**
 * GitHub Release Update Service
 * Checks repository releases from GitHub API and compares SemVer versions.
 */

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
export const APP_CURRENT_VERSION = "0.1.0";

type DesktopPlatform = "macos" | "windows" | "other";

function getDesktopPlatform(): DesktopPlatform {
  if (typeof navigator === "undefined") return "other";
  const identity = `${navigator.platform || ""} ${navigator.userAgent || ""}`.toLowerCase();
  if (identity.includes("mac")) return "macos";
  if (identity.includes("win")) return "windows";
  return "other";
}

/** Pick an installer for the current desktop without changing the GitHub release protocol. */
export function selectInstallerAsset(
  assets: GitHubAsset[],
  platform: DesktopPlatform = getDesktopPlatform()
): GitHubAsset | undefined {
  const lowerName = (asset: GitHubAsset) => asset.name.toLowerCase();

  if (platform === "macos") {
    return (
      assets.find((asset) => {
        const name = lowerName(asset);
        return name.endsWith(".dmg") && /(aarch64|arm64|apple[-_ ]?silicon)/.test(name);
      }) ||
      assets.find((asset) => lowerName(asset).endsWith(".dmg")) ||
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
 * Check for updates via GitHub Releases API
 */
export async function checkForAppUpdates(
  currentVersion: string = APP_CURRENT_VERSION,
  repo: string = GITHUB_REPO
): Promise<UpdateCheckResult> {
  try {
    const response = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, {
      headers: {
        Accept: "application/vnd.github.v3+json",
      },
    });

    if (response.status === 404) {
      // No releases published yet on this repository (or repo not found).
      // Report it honestly instead of pretending the app is up to date.
      return {
        hasUpdate: false,
        currentVersion,
        noReleases: true,
      };
    }

    if (!response.ok) {
      throw new Error(`GitHub API returned HTTP ${response.status}`);
    }

    const data = await response.json();
    const tagName = data.tag_name || "";
    const cleanLatest = tagName.replace(/^v/i, "").trim();

    // Find the installer for the current desktop architecture/platform.
    const assets: GitHubAsset[] = data.assets || [];
    const installerAsset = selectInstallerAsset(assets);

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
