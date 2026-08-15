import { motion } from "framer-motion";
import { Check, Loader2, Send, Shield } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "./ui/button";
import { Card, CardContent } from "./ui/card";
import { Input } from "./ui/input";
import { useTranslation } from "../i18n/useTranslation";
import { useAppStore } from "../stores/useAppStore";
import { APP_CURRENT_VERSION } from "../services/updater";

// Public submit-only endpoint. It carries no credential and grants no read access,
// so shipping it in an open-source client leaks nothing that isn't already public.
const FEEDBACK_ENDPOINT = "https://formspree.io/f/mkjwzlyq";

// Quiet period after a successful send. The monthly quota is small, so the realistic
// way to waste it is a real user sending the same thing several times over, not an
// attacker. 30s is long enough to break that habit, short enough not to feel punitive.
const COOLDOWN_SECONDS = 30;

type FeedbackKind = "bug" | "idea" | "other";
type SendState = "idle" | "sending" | "success" | "error";
// Retryable and non-retryable failures need different copy: telling someone to check
// their connection when the real cause is a rate limit sends them into a retry loop.
type FailureKind = "network" | "rate" | "server";

export function FeedbackPanel() {
  const { t } = useTranslation();
  const { settings } = useAppStore();

  const [kind, setKind] = useState<FeedbackKind>("bug");
  const [message, setMessage] = useState("");
  const [contact, setContact] = useState("");
  const [state, setState] = useState<SendState>("idle");
  const [failure, setFailure] = useState<FailureKind | null>(null);
  const [cooldown, setCooldown] = useState(0);
  const [isDuplicate, setIsDuplicate] = useState(false);

  // Last body we actually delivered. Kept in a ref because it must survive the
  // success screen and "write another" without triggering a re-render of its own.
  const lastSentRef = useRef<string>("");

  // Cooldown ticker. Cleared on unmount so leaving the tab mid-countdown does not
  // leave an interval running against a dead component.
  useEffect(() => {
    if (cooldown <= 0) return;
    const id = setInterval(() => setCooldown((s) => (s <= 1 ? 0 : s - 1)), 1000);
    return () => clearInterval(id);
  }, [cooldown]);

  // Built once and used for both the disclosure list and the request body, so what
  // the user is shown can never drift from what is actually sent.
  const meta = useMemo(
    () => ({
      version: APP_CURRENT_VERSION,
      language: settings.language || "en",
      platform: typeof navigator !== "undefined" ? navigator.userAgent : "unknown",
    }),
    [settings.language]
  );

  const kinds: { key: FeedbackKind; labelKey: Parameters<typeof t>[0] }[] = [
    { key: "bug", labelKey: "feedback.kind.bug" },
    { key: "idea", labelKey: "feedback.kind.idea" },
    { key: "other", labelKey: "feedback.kind.other" },
  ];

  const handleMessageChange = (value: string) => {
    setMessage(value);
    // Editing is the user's answer to "you already sent this" — drop the warning
    // the moment the text actually differs again.
    if (isDuplicate && value.trim() !== lastSentRef.current) setIsDuplicate(false);
    if (state === "error") setState("idle");
  };

  const handleSubmit = async () => {
    const body = message.trim();
    if (!body || state === "sending" || cooldown > 0) return;

    if (body === lastSentRef.current) {
      setIsDuplicate(true);
      return;
    }

    setState("sending");
    setFailure(null);
    try {
      const res = await fetch(FEEDBACK_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          type: kind,
          message: body,
          contact: contact.trim() || "(not provided)",
          appVersion: meta.version,
          language: meta.language,
          platform: meta.platform,
        }),
      });
      if (!res.ok) {
        // 429 covers both the per-minute rate limit and an exhausted monthly quota.
        setFailure(res.status === 429 ? "rate" : "server");
        setState("error");
        return;
      }
      lastSentRef.current = body;
      setCooldown(COOLDOWN_SECONDS);
      setState("success");
    } catch (err) {
      console.warn("feedback submit failed:", err);
      setFailure("network");
      setState("error");
    }
  };

  const handleWriteAnother = () => {
    setKind("bug");
    setMessage("");
    setContact("");
    setState("idle");
    setFailure(null);
    setIsDuplicate(false);
  };

  const failureKey =
    failure === "rate"
      ? "feedback.errorRate"
      : failure === "server"
        ? "feedback.errorServer"
        : "feedback.errorBody";


  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold mb-2">{t("feedback.title")}</h2>
        <p className="text-muted-foreground">{t("feedback.subtitle")}</p>
      </div>
      <div className="max-w-2xl mx-auto">
        <Card>
          <CardContent className="pt-6">
            {state === "success" ? (
              <div className="flex flex-col items-center justify-center py-8 text-center">
                <motion.div
                  initial={{ scale: 0.6, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  transition={{ type: "spring", stiffness: 300, damping: 18 }}
                  className="mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                >
                  <Check className="h-7 w-7" />
                </motion.div>
                <p className="text-sm font-medium">{t("feedback.successTitle")}</p>
                <p className="mt-1 text-xs text-muted-foreground">{t("feedback.successBody")}</p>
                <Button variant="outline" size="sm" onClick={handleWriteAnother} className="mt-5">
                  {t("feedback.writeAnother")}
                </Button>
              </div>
            ) : (
              <div className="space-y-4">
                {/* Feedback type */}
                <div className="flex flex-wrap gap-2">
                  {kinds.map((k) => (
                    <button
                      key={k.key}
                      type="button"
                      onClick={() => setKind(k.key)}
                      className={`rounded-full border px-3 py-1 text-xs font-medium transition-all active:scale-95 ${
                        kind === k.key
                          ? "border-primary/30 bg-primary/10 text-primary"
                          : "border-border bg-secondary text-muted-foreground hover:bg-secondary/80"
                      }`}
                    >
                      {t(k.labelKey)}
                    </button>
                  ))}
                </div>

                {/* Message */}
                <textarea
                  value={message}
                  onChange={(e) => handleMessageChange(e.target.value)}
                  rows={6}
                  placeholder={t("feedback.messagePlaceholder")}
                  className="flex w-full resize-none rounded-xl border border-input bg-background px-4 py-3 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20 focus-visible:ring-offset-2 transition-all duration-200"
                />

                {/* Optional contact */}
                <div>
                  <Input
                    type="email"
                    value={contact}
                    onChange={(e) => setContact(e.target.value)}
                    placeholder={t("feedback.contactPlaceholder")}
                  />
                  <p className="mt-1 px-1 text-[11px] text-muted-foreground">
                    {t("feedback.contactHint")}
                  </p>
                </div>

                {/* Transparency: exactly what leaves the machine */}
                <div className="rounded-xl border border-border bg-muted/40 p-3.5">
                  <p className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold text-foreground">
                    <Shield className="h-3.5 w-3.5" />
                    {t("feedback.attachedTitle")}
                  </p>
                  <ul className="space-y-1 text-[11px] text-muted-foreground">
                    <li>{t("feedback.attachedVersion", { version: meta.version })}</li>
                    <li>{t("feedback.attachedLanguage", { language: meta.language })}</li>
                    <li className="break-all">
                      {t("feedback.attachedPlatform", { platform: meta.platform })}
                    </li>
                  </ul>
                  <p className="mt-2 text-[11px] text-muted-foreground leading-relaxed">
                    {t("feedback.attachedNote")}
                  </p>
                </div>

                {state === "error" && (
                  <p className="text-xs text-destructive">{t(failureKey)}</p>
                )}

                {isDuplicate && (
                  <p className="text-xs text-amber-600 dark:text-amber-500">
                    {t("feedback.duplicate")}
                  </p>
                )}

                <div className="flex items-center justify-end gap-3 pt-1">
                  {cooldown > 0 && (
                    <span className="text-[11px] text-muted-foreground">
                      {t("feedback.cooldown", { seconds: String(cooldown) })}
                    </span>
                  )}
                  <Button
                    onClick={handleSubmit}
                    disabled={!message.trim() || state === "sending" || cooldown > 0}
                    className="gap-2"
                  >
                    {state === "sending" ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        {t("feedback.sending")}
                      </>
                    ) : (
                      <>
                        <Send className="h-4 w-4" />
                        {t("feedback.send")}
                      </>
                    )}
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
