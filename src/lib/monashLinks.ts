import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";

/**
 * Monash-owned hosts that sign in through Monash SSO. Keep in sync with
 * `is_monash_host` in src-tauri/src/lib.rs, which enforces the same list.
 */
const MONASH_SUFFIXES = ["monash.edu", "monash.edu.au", "monash.edu.my", "student.monash"];

export function isMonashHost(host: string): boolean {
  const h = host.toLowerCase().replace(/\.$/, "");
  return MONASH_SUFFIXES.some((s) => h === s || h.endsWith(`.${s}`));
}

/** https link on a Monash host: these open in the in-app window that shares the login. */
export function opensInApp(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === "https:" && isMonashHost(u.hostname);
  } catch {
    return false;
  }
}

/**
 * Open a link the way that keeps the user signed in.
 *
 * The system browser has none of Muster's session, so Monash sites opened there ask the
 * user to sign in again. The in-app window shares the WebView storage the SSO login
 * filled (Okta + Moodle cookies), so Monash sites open already signed in. Everything
 * else, and any failure, falls back to the system browser.
 */
export async function openLink(url: string, title?: string): Promise<void> {
  if (opensInApp(url)) {
    try {
      await invoke("open_in_app_webview", { url, title });
      return;
    } catch (err) {
      console.warn("in-app open failed, using the system browser:", err);
    }
  }
  try {
    await openUrl(url);
  } catch {
    /* opening a link is non-critical */
  }
}
