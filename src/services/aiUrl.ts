// Shared AI endpoint helpers: gateway-style "base URL + format".
// Both the Settings page (connection test) and the course AI summary must
// build the final endpoint the same way, otherwise the test passes while
// generation hits a bare base URL and 404s.
export type AiFormat = "openai" | "anthropic" | "custom";

export const AI_FORMAT_SUFFIX: Record<Exclude<AiFormat, "custom">, string> = {
  openai: "/chat/completions",
  anthropic: "/v1/messages",
};

export const splitAiUrl = (url: string): { base: string; format: AiFormat } => {
  const u = (url || "").trim();
  if (u.endsWith("/chat/completions")) {
    return { base: u.slice(0, -"/chat/completions".length), format: "openai" };
  }
  if (u.endsWith("/v1/messages")) {
    return { base: u.slice(0, -"/v1/messages".length), format: "anthropic" };
  }
  return { base: u, format: "custom" };
};

export const buildAiUrl = (base: string, format: AiFormat | string): string => {
  const b = base.trim().replace(/\/+$/, "");
  if (format === "custom") return base.trim();
  const suffix = AI_FORMAT_SUFFIX[format as Exclude<AiFormat, "custom">];
  if (!suffix) return base.trim();
  if (!b) return suffix;
  return b + suffix;
};
