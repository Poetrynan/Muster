import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Check, ChevronDown, Globe } from "lucide-react";
import { useTranslation } from "../i18n/useTranslation";
import { Language } from "../i18n/translations";

/** Language options: labels use each language's endonym, avoiding the mismatch of writing Japanese names in Chinese. */
const LANGUAGES: { code: Language; label: string; short: string }[] = [
  { code: "en", label: "English", short: "EN" },
  { code: "zh", label: "中文", short: "中文" },
  { code: "ja", label: "日本語", short: "日本語" },
  { code: "ko", label: "한국어", short: "한국어" },
];

/**
 * Custom language dropdown. Deliberately avoids the native <select>: in WebView2
 * the native control renders as a system popup whose font, corner radius and colors
 * do not match our design system.
 *
 * `variant` matches the surrounding chrome: "outline" is the bordered pill used on the
 * login screen, "ghost" is the borderless form that sits next to the Dashboard header's
 * icon buttons.
 */
export function LanguageSelect({ variant = "outline" }: { variant?: "outline" | "ghost" }) {
  const { lang, setLanguage } = useTranslation();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  const current = LANGUAGES.find((l) => l.code === lang) ?? LANGUAGES[0];

  // Close on outside click / Esc
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label="Select language"
        className={`inline-flex items-center gap-1.5 h-9 pl-2.5 pr-2 rounded-xl text-sm font-medium
                   text-foreground transition-colors duration-150 active:scale-[0.97]
                   focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2
                   ${variant === "outline" ? "border border-border bg-transparent hover:bg-muted" : "hover:bg-muted/50"}`}
      >
        <Globe className="w-4 h-4 shrink-0" />
        <span>{current.short}</span>
        <ChevronDown
          className={`w-3.5 h-3.5 shrink-0 opacity-60 transition-transform duration-200 ${open ? "rotate-180" : ""}`}
        />
      </button>

      <AnimatePresence>
        {open && (
          <motion.ul
            role="listbox"
            aria-label="Language"
            initial={{ opacity: 0, scale: 0.95, y: -4 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, y: -4 }}
            transition={{ duration: 0.15, ease: "easeOut" }}
            className="absolute right-0 top-full mt-2 z-50 w-40 p-1 rounded-xl origin-top-right
                       border border-border bg-card shadow-lg shadow-black/10"
          >
            {LANGUAGES.map((l) => {
              const active = l.code === lang;
              return (
                <li key={l.code} role="option" aria-selected={active}>
                  <button
                    type="button"
                    onClick={() => {
                      setLanguage(l.code);
                      setOpen(false);
                    }}
                    className={`w-full flex items-center justify-between gap-2 px-2.5 py-2 rounded-lg text-sm
                                transition-colors duration-150 hover:bg-muted
                                focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring
                                ${active ? "font-semibold text-foreground" : "text-muted-foreground"}`}
                  >
                    <span>{l.label}</span>
                    {active && <Check className="w-3.5 h-3.5 shrink-0" />}
                  </button>
                </li>
              );
            })}
          </motion.ul>
        )}
      </AnimatePresence>
    </div>
  );
}
