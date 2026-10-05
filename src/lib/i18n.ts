import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import { LANG_INDEX, type Catalog, type Lang } from "@/locales/types";
import { core } from "@/locales/core";
import { auth } from "@/locales/auth";
import { notifications } from "@/locales/notifications";
import { accounts } from "@/locales/accounts";
import { settings } from "@/locales/settings";
import { resident } from "@/locales/resident";

/**
 * The single SociyoHub localisation system (i18next). Catalogs keep the three
 * languages side by side so a key can't exist in one language only.
 * Language is a per-device, per-user display preference — never authority.
 */
const CATALOGS: Catalog[] = [core, auth, notifications, accounts, settings, resident];

function build(lang: Lang) {
  const out: Record<string, string> = {};
  const idx = LANG_INDEX[lang];
  for (const cat of CATALOGS) for (const [k, v] of Object.entries(cat)) out[k] = v[idx];
  return { translation: out };
}

export const SUPPORTED_LANGS = [
  { code: "en", label: "English" },
  { code: "gu", label: "ગુજરાતી (Gujarati)" },
  { code: "hi", label: "हिन्दी (Hindi)" },
] as const;

const STORAGE_KEY = "sociohub.lang";
const isLang = (v: unknown): v is Lang => v === "en" || v === "hi" || v === "gu";

if (!i18n.isInitialized) {
  // Always start in English so server and first client render match; the
  // stored choice is applied right after hydration by applyStoredLanguage().
  void i18n.use(initReactI18next).init({
    resources: { en: build("en"), hi: build("hi"), gu: build("gu") },
    lng: "en",
    fallbackLng: "en",
    keySeparator: false,
    interpolation: { escapeValue: false },
    react: { useSuspense: false },
  });
}

function syncDocumentLang(lang: Lang) {
  if (typeof document !== "undefined") document.documentElement.lang = lang;
}

export function currentLang(): Lang {
  const l = i18n.language?.slice(0, 2);
  return isLang(l) ? l : "en";
}

export function setLanguage(lang: Lang) {
  if (!isLang(lang)) return;
  void i18n.changeLanguage(lang);
  syncDocumentLang(lang);
  try {
    window.localStorage.setItem(STORAGE_KEY, lang);
  } catch {
    /* storage unavailable — keep in-memory choice */
  }
}

/** Reads the saved choice (browser only). Unknown/legacy values fall back to English. */
export function applyStoredLanguage() {
  if (typeof window === "undefined") return;
  let stored: string | null = null;
  try {
    stored = window.localStorage.getItem(STORAGE_KEY);
  } catch {
    stored = null;
  }
  const lang: Lang = isLang(stored) ? stored : "en";
  if (currentLang() !== lang) void i18n.changeLanguage(lang);
  syncDocumentLang(lang);
}

/** BCP-47 tag for Intl date formatting in the current language. */
export function localeTag(lang: Lang = currentLang()) {
  return lang === "hi" ? "hi-IN" : lang === "gu" ? "gu-IN" : "en-IN";
}

export default i18n;
