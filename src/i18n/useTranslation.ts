import { useCallback } from "react";
import { translations, TranslationKey, Language } from "./translations";
import { useAppStore } from "../stores/useAppStore";

export function useTranslation() {
  const { settings, updateSettings } = useAppStore();
  const lang: Language = settings.language || "en";

  // t("assignments.dueIn", { days: 5 }) → "5 days left" (localized per active language)
  // Supports {name} style placeholders; placeholders without a value are left as-is
  const t = useCallback(
    (key: TranslationKey, params?: Record<string, string | number>): string => {
      let str: string = translations[lang][key] || (key as string);
      if (params) {
        for (const [k, v] of Object.entries(params)) {
          str = str.replace(new RegExp(`\\{${k}\\}`, "g"), String(v));
        }
      }
      return str;
    },
    [lang]
  );

  const setLanguage = useCallback(
    (language: Language) => {
      updateSettings({ language });
    },
    [updateSettings]
  );

  return { t, lang, setLanguage };
}
