import { motion } from "framer-motion";
import { Check, Loader2, Send, Shield, X, ZoomIn, Paperclip, Image as ImageIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "./ui/button";
import { Card, CardContent } from "./ui/card";
import { Input } from "./ui/input";
import { useTranslation } from "../i18n/useTranslation";
import { useAppStore } from "../stores/useAppStore";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentAppVersion } from "../services/updater";
import { Dialog } from "./ui/dialog";

// Public submit-only endpoint. It carries no credential and grants no read access,
// so shipping it in an open-source client leaks nothing that isn't already public.
const FEEDBACK_ENDPOINT = "https://formspree.io/f/mkjwzlyq";

// Quiet period after a successful send. The monthly quota is small, so the realistic
// way to waste it is a real user sending the same thing several times over, not an
// attacker. 30s is long enough to break that habit, short enough not to feel punitive.
const COOLDOWN_SECONDS = 30;

// Image constraints: keep submissions small enough for Formspree's free tier (10MB cap).
const MAX_IMAGES = 5;
const COMPRESS_MAX_DIMENSION = 1280;             // shrink longest side to this many px
const COMPRESS_QUALITY = 0.7;                    // JPEG quality after resize

type FeedbackKind = "bug" | "idea" | "other";
type SendState = "idle" | "sending" | "success" | "error";

interface SystemInfo {
  os: string;
  arch: string;
  osVersion: string;
  isAppleSilicon: boolean;
  appVersion: string;
}
// Retryable and non-retryable failures need different copy: telling someone to check
// their connection when the real cause is a rate limit sends them into a retry loop.
type FailureKind = "network" | "rate" | "server";

interface AttachedImage {
  /** base64 data URL (image/jpeg) ready to embed in the JSON body */
  dataUrl: string;
  /** byte length of the original file, for the size caption */
  originalSize: number;
}

/**
 * Shrink + re-encode a raw image file so it stays well under Formspree's per-submission cap.
 * Steps: load into an Image → draw onto a canvas with the longest side <= MAX → toBlob JPEG.
 * Falls back to the original data URL if anything in the pipeline fails.
 */
async function compressImage(file: File): Promise<string> {
  // If it's already a reasonably sized JPEG, skip the (async, failure-prone) pipeline.
  if (file.size <= 500_000 && file.type === "image/jpeg") {
    return readAsDataUrl(file);
  }

  const objectUrl = URL.createObjectURL(file);
  try {
    const img = await loadImage(objectUrl);
    const { width, height } = fitInside(img.width, img.height, COMPRESS_MAX_DIMENSION);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return readAsDataUrl(file);
    ctx.drawImage(img, 0, 0, width, height);
    const blob: Blob | null = await new Promise((resolve) =>
      canvas.toBlob((b) => resolve(b), "image/jpeg", COMPRESS_QUALITY)
    );
    if (!blob) return readAsDataUrl(file);
    // If compression didn't help (rare), keep the smaller of the two.
    if (blob.size >= file.size) return readAsDataUrl(file);
    return await readAsDataUrl(new File([blob], "image/jpeg", { type: "image/jpeg" }));
  } catch {
    return readAsDataUrl(file);
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("img decode failed"));
    img.src = src;
  });
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result as string);
    fr.onerror = () => reject(fr.error);
    fr.readAsDataURL(file);
  });
}

/** Fit (w, h) inside maxBox on its longest side, preserving aspect ratio. */
function fitInside(w: number, h: number, maxBox: number): { width: number; height: number } {
  const longest = Math.max(w, h);
  if (longest <= maxBox) return { width: w, height: h };
  const scale = maxBox / longest;
  return { width: Math.round(w * scale), height: Math.round(h * scale) };
}

/** Turn bytes into a short human string like "1.4 MB". */
function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/** Extract image files from a clipboard paste or drag event, in declared order. */
function extractImagesFromClipboard(e: React.ClipboardEvent | React.DragEvent): File[] {
  const files: File[] = [];
  const items = "clipboardData" in e ? e.clipboardData?.items : e.dataTransfer?.items;
  if (!items) return files;
  for (const item of Array.from(items)) {
    if (item.kind !== "file") continue;
    const type = item.type ?? "";
    if (!type.startsWith("image/")) continue;
    const file = item.getAsFile();
    if (file) files.push(file);
  }
  return files;
}

export function FeedbackPanel() {
  const { t } = useTranslation();
  const { settings, user, courses } = useAppStore();

  const [kind, setKind] = useState<FeedbackKind>("bug");
  const [message, setMessage] = useState("");
  const [contact, setContact] = useState(user?.email || "");
  const [state, setState] = useState<SendState>("idle");
  const [failure, setFailure] = useState<FailureKind | null>(null);
  const [cooldown, setCooldown] = useState(0);
  const [isDuplicate, setIsDuplicate] = useState(false);
  const [appVersion, setAppVersion] = useState("");
  const [systemInfo, setSystemInfo] = useState<SystemInfo | null>(null);
  const [images, setImages] = useState<AttachedImage[]>([]);
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);

  const trimmedEmail = contact.trim();
  const isEmailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Sync user email when user profile becomes available
  useEffect(() => {
    if (!contact && user?.email) {
      setContact(user.email);
    }
  }, [user?.email, contact]);

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

  // Resolve the current version from the runtime (tauri.conf.json).
  useEffect(() => {
    let cancelled = false;
    getCurrentAppVersion().then((v) => {
      if (!cancelled) setAppVersion(v);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Structured OS info reported from Rust (not parsed from a user-agent string).
  useEffect(() => {
    let cancelled = false;
    invoke<SystemInfo>("get_system_info")
      .then((info) => {
        if (!cancelled) setSystemInfo(info);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  // Built once and used for both the disclosure list and the request body, so what
  // the user is shown can never drift from what is actually sent.
  const meta = useMemo(
    () => ({
      version: appVersion,
      language: settings.language || "en",
      platform: systemInfo ? JSON.stringify(systemInfo) : "unknown",
    }),
    [settings.language, appVersion, systemInfo]
  );

  // Total compressed payload — kept below Formspree's 10 MB ceiling. Base64 inflates
  // by ~33 %, so 5 × 2 MB raw ≈ 13 MB base64; our 1280 px / 0.7 JPEG typically lands
  // each image around 150-300 KB, totalling well under the cap.
  const imagesTotalBytes = useMemo(
    () => images.reduce((sum, img) => sum + img.originalSize, 0),
    [images]
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

  // ---- Image ingestion ---------------------------------------------------

  const handlePaste = useCallback(
    async (e: React.ClipboardEvent) => {
      const files = extractImagesFromClipboard(e);
      if (files.length === 0) return; // let non-image paste through to the textarea
      e.preventDefault(); // prevent the browser from also inserting the image as text
      await ingestFiles(files);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [images]
  );

  const handleDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault();
      const files = extractImagesFromClipboard(e);
      if (files.length === 0) return;
      await ingestFiles(files);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [images]
  );

  const handleFilePick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (files.length > 0) await ingestFiles(files);
    e.target.value = ""; // re-arm the onChange for the same file
  };

  const ingestFiles = async (files: File[]) => {
    const remaining = MAX_IMAGES - images.length;
    if (remaining <= 0) return;
    const accepted = files.slice(0, remaining);
    const compressed: AttachedImage[] = [];
    for (const file of accepted) {
      try {
        const dataUrl = await compressImage(file);
        compressed.push({ dataUrl, originalSize: file.size });
      } catch {
        /* skip files that fail to compress */
      }
    }
    if (compressed.length > 0) setImages((prev) => [...prev, ...compressed]);
  };

  const removeImage = (index: number) => {
    setImages((prev) => prev.filter((_, i) => i !== index));
    // If the user removes the image being previewed, close the modal.
    setPreviewIndex((cur) => {
      if (cur === null) return null;
      if (cur === index) return null;
      if (cur > index) return cur - 1; // indices shift down after removal
      return cur;
    });
  };

  // ---- Submission ---------------------------------------------------------

  const handleSubmit = async () => {
    const body = message.trim();
    if (!body || !isEmailValid || state === "sending" || cooldown > 0) return;

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
          contact: trimmedEmail,
          appVersion: meta.version,
          language: meta.language,
          platform: meta.platform,
          courseCount: courses.length,
          coursesList:
            courses
              .map((c) => (c.shortName ? `${c.shortName} (${c.fullName})` : c.fullName))
              .join("; ") || "none",
          // Images arrive as base64 data URLs. Formspree stores them in the submission
          // JSON; you download them from the dashboard or fetch them via the API.
          imageCount: images.length,
          images: images.map((img) => img.dataUrl),
          imagesTotalSize: formatBytes(imagesTotalBytes),
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
    setContact(user?.email || "");
    setState("idle");
    setFailure(null);
    setIsDuplicate(false);
    setImages([]);
    setPreviewIndex(null);
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

                {/* Message textarea — accepts paste + drag-drop of images */}
                <div onDrop={handleDrop}>
                  <textarea
                    value={message}
                    onChange={(e) => handleMessageChange(e.target.value)}
                    onPaste={handlePaste}
                    rows={6}
                    placeholder={t("feedback.messagePlaceholder")}
                    className="flex w-full resize-none rounded-xl border border-input bg-background px-4 py-3 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20 focus-visible:ring-offset-2 transition-all duration-200"
                  />
                </div>

                {/* Attached images — thumbnails with remove + full-size preview */}
                {images.length > 0 && (
                  <div className="space-y-2">
                    <div className="flex items-center gap-2 flex-wrap">
                      {images.map((img, i) => (
                        <div
                          key={`${i}-${img.dataUrl.slice(-12)}`}
                          className="group relative h-20 w-20 shrink-0 overflow-hidden rounded-lg border border-border bg-muted"
                        >
                          <img
                            src={img.dataUrl}
                            alt={t("feedback.imageThumbAlt", { index: String(i + 1) })}
                            className="h-full w-full object-cover"
                          />
                          {/* Hover overlay: preview + remove */}
                          <div className="absolute inset-0 flex items-center justify-center gap-1 bg-black/50 opacity-0 transition-opacity group-hover:opacity-100">
                            <button
                              type="button"
                              onClick={() => setPreviewIndex(i)}
                              className="rounded-full bg-white/90 p-1.5 text-foreground transition-colors hover:bg-white"
                              aria-label={t("feedback.previewImage")}
                            >
                              <ZoomIn className="h-3.5 w-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => removeImage(i)}
                              className="rounded-full bg-white/90 p-1.5 text-foreground transition-colors hover:bg-white"
                              aria-label={t("feedback.removeImage")}
                            >
                              <X className="h-3.5 w-3.5" />
                            </button>
                          </div>
                          {/* Size caption */}
                          <span className="absolute bottom-0.5 left-0.5 rounded bg-black/60 px-1 text-[9px] text-white">
                            {formatBytes(img.originalSize)}
                          </span>
                        </div>
                      ))}
                      {/* Add-more tile — hidden when full */}
                      {images.length < MAX_IMAGES && (
                        <button
                          type="button"
                          onClick={() => fileInputRef.current?.click()}
                          className="flex h-20 w-20 shrink-0 flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-border bg-muted/50 text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground"
                        >
                          <Paperclip className="h-4 w-4" />
                          <span className="text-[9px] leading-none">
                            {t("feedback.addImage")}
                          </span>
                        </button>
                      )}
                    </div>
                    <p className="text-[11px] text-muted-foreground">
                      {t("feedback.imagesHint", {
                        count: String(images.length),
                        max: String(MAX_IMAGES),
                      })}
                      {imagesTotalBytes > 0 && ` · ${t("feedback.imagesTotal", { size: formatBytes(imagesTotalBytes) })}`}
                    </p>
                    {/* Hidden file input triggered by the add-more tile */}
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/*"
                      multiple
                      className="hidden"
                      onChange={handleFilePick}
                    />
                  </div>
                )}

                {/* When no images yet, show a subtle "you can attach" hint with an add button */}
                {images.length === 0 && (
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-dashed border-border px-3 py-1.5 text-[11px] text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground"
                    >
                      <ImageIcon className="h-3.5 w-3.5" />
                      {t("feedback.attachImageHint")}
                    </button>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/*"
                      multiple
                      className="hidden"
                      onChange={handleFilePick}
                    />
                  </div>
                )}

                {/* Required contact email */}
                <div>
                  <Input
                    type="email"
                    required
                    value={contact}
                    onChange={(e) => setContact(e.target.value)}
                    placeholder={t("feedback.contactPlaceholder")}
                    className={contact && !isEmailValid ? "border-destructive focus-visible:ring-destructive/20" : ""}
                  />
                  <p className={`mt-1 px-1 text-[11px] ${contact && !isEmailValid ? "text-destructive font-medium" : "text-muted-foreground"}`}>
                    {contact && !isEmailValid ? t("feedback.contactInvalid") : t("feedback.contactHint")}
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
                    <li>
                      {t("feedback.attachedCourses", {
                        count: String(courses.length),
                        courses:
                          courses
                            .map((c) => c.shortName || c.fullName)
                            .slice(0, 5)
                            .join(", ") + (courses.length > 5 ? "..." : "") || "none",
                      })}
                    </li>
                    {images.length > 0 && (
                      <li>
                        {t("feedback.attachedImages", {
                          count: String(images.length),
                          size: formatBytes(imagesTotalBytes),
                        })}
                      </li>
                    )}
                    <li className="break-all">
                      {t("feedback.attachedPlatform", {
                        platform: systemInfo
                          ? `${systemInfo.os} ${systemInfo.osVersion} (${systemInfo.arch})${systemInfo.isAppleSilicon ? " · Apple Silicon" : ""} · v${systemInfo.appVersion}`
                          : meta.platform,
                      })}
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
                    disabled={!message.trim() || !isEmailValid || state === "sending" || cooldown > 0}
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

      {/* Full-size image preview modal */}
      <Dialog open={previewIndex !== null} onClose={() => setPreviewIndex(null)}>
        {previewIndex !== null && images[previewIndex] && (
          <div className="space-y-4">
            <div className="relative flex items-center justify-center overflow-hidden rounded-xl bg-black/5">
              <img
                src={images[previewIndex].dataUrl}
                alt={t("feedback.previewImageAlt", { index: String(previewIndex + 1) })}
                className="max-h-[70vh] max-w-full object-contain"
              />
            </div>
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>
                {t("feedback.previewCounter", {
                  current: String(previewIndex + 1),
                  total: String(images.length),
                })}
              </span>
              <div className="flex items-center gap-3">
                {previewIndex > 0 && (
                  <button
                    type="button"
                    onClick={() => setPreviewIndex(previewIndex - 1)}
                    className="rounded-lg border border-border px-3 py-1 hover:bg-secondary"
                  >
                    {t("feedback.previewPrev")}
                  </button>
                )}
                {previewIndex < images.length - 1 && (
                  <button
                    type="button"
                    onClick={() => setPreviewIndex(previewIndex + 1)}
                    className="rounded-lg border border-border px-3 py-1 hover:bg-secondary"
                  >
                    {t("feedback.previewNext")}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setPreviewIndex(null)}
                  className="rounded-lg border border-border px-3 py-1 hover:bg-secondary"
                >
                  {t("common.close")}
                </button>
              </div>
            </div>
          </div>
        )}
      </Dialog>
    </div>
  );
}
