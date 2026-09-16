/**
 * Humanize AI API errors (UX rule: never dump raw API responses at users).
 * Maps common failure patterns to actionable, localized headlines; the raw
 * payload is kept as an optional collapsible "technical detail".
 */

export interface HumanizedError {
  headline: string;
  detail?: string;
}

import type { TranslationKey } from "../i18n/translations";

type TFn = (key: TranslationKey) => string;

const STATUS_RE = /"status"\s*:\s*(\d{3})/;
const BARE_STATUS_RE = /\b(401|403|404|429)\b/;

export function humanizeAiError(raw: unknown, t: TFn): HumanizedError {
  const text = typeof raw === "string" ? raw : raw instanceof Error ? raw.message : String(raw ?? "");
  const lower = text.toLowerCase();

  const statusMatch = text.match(STATUS_RE) ?? text.match(BARE_STATUS_RE);
  const status = statusMatch ? Number(statusMatch[1]) : 0;

  if (status === 401 || status === 403 || /invalid api key|unauthorized|incorrect api key|invalid_api_key|authentication/.test(lower)) {
    return { headline: t("aiHub.err.auth"), detail: text };
  }
  if (status === 404 || /not found/.test(lower)) {
    return { headline: t("aiHub.err.notFound"), detail: text };
  }
  if (status === 429 || /rate limit|too many requests|quota/.test(lower)) {
    return { headline: t("aiHub.err.rateLimit"), detail: text };
  }
  if (/timeout|timed out|network|failed to fetch|connection|dns|proxy/.test(lower)) {
    return { headline: t("aiHub.err.network"), detail: text };
  }
  if (status >= 500) {
    return { headline: t("aiHub.err.server"), detail: text };
  }
  return { headline: t("aiHub.err.generic"), detail: text };
}
