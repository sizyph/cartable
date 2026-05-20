import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import LanguageDetector from "i18next-browser-languagedetector";
import { enUS, fr, ja } from "date-fns/locale";
import type { Locale } from "date-fns";

import en from "./en.json";
import frJson from "./fr.json";
import jaJson from "./ja.json";

export const LANGUAGES = [
  { code: "en", name: "English" },
  { code: "fr", name: "Français" },
  { code: "ja", name: "日本語" },
] as const;
export type LangCode = (typeof LANGUAGES)[number]["code"];

const DATE_LOCALES: Record<LangCode, Locale> = {
  en: enUS,
  fr,
  ja,
};

export function dateFnsLocale(): Locale {
  const code = (i18n.language || "en").slice(0, 2) as LangCode;
  return DATE_LOCALES[code] ?? enUS;
}

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      en: { translation: en },
      fr: { translation: frJson },
      ja: { translation: jaJson },
    },
    fallbackLng: "en",
    supportedLngs: ["en", "fr", "ja"],
    interpolation: { escapeValue: false },
    detection: {
      order: ["localStorage", "navigator"],
      lookupLocalStorage: "cartable-language",
      caches: ["localStorage"],
    },
    returnObjects: false,
  });

export default i18n;
