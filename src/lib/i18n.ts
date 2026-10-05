import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import { LANG_INDEX, type Catalog } from "@/locales/types";
import { core } from "@/locales/core";
import { auth } from "@/locales/auth";
import { notifications } from "@/locales/notifications";
import { accounts } from "@/locales/accounts";
import { settings } from "@/locales/settings";
import { resident } from "@/locales/resident";
import { dashboard } from "@/locales/dashboard";
import { navhub } from "@/locales/navhub";

/**
 * The single SociyoHub localisation system (i18next). English, Hindi and
 * Gujarati are bundled from the tuple catalogs; every other language is a
 * validated JSON bundle in src/locales/extra/, loaded only when chosen.
 * Language is a per-device, per-user display preference — never authority.
 */
const CATALOGS: Catalog[] = [core, auth, notifications, accounts, settings, resident, dashboard, navhub];

function build(idx: number) {
  const out: Record<string, string> = {};
  for (const cat of CATALOGS) for (const [k, v] of Object.entries(cat)) out[k] = v[idx];
  return { translation: out };
}

type Script = "Latn" | "Deva" | "Gujr" | "Beng" | "Knda" | "Mlym" | "Orya" | "Guru" | "Taml" | "Telu" | "Olck" | "Arab";
type LangMeta = { code: string; english: string; native: string; locale: string; script: Script; dir: "ltr" | "rtl" };

/** Full registry of the 23 supported UI languages (English + the 22 Eighth-Schedule languages). */
export const LANGUAGE_REGISTRY: readonly LangMeta[] = [
  { code: "en", english: "English", native: "English", locale: "en-IN", script: "Latn", dir: "ltr" },
  { code: "as", english: "Assamese", native: "অসমীয়া", locale: "as-IN", script: "Beng", dir: "ltr" },
  { code: "bn", english: "Bengali", native: "বাংলা", locale: "bn-IN", script: "Beng", dir: "ltr" },
  { code: "brx", english: "Bodo", native: "बड़ो", locale: "brx-IN", script: "Deva", dir: "ltr" },
  { code: "doi", english: "Dogri", native: "डोगरी", locale: "doi-IN", script: "Deva", dir: "ltr" },
  { code: "gu", english: "Gujarati", native: "ગુજરાતી", locale: "gu-IN", script: "Gujr", dir: "ltr" },
  { code: "hi", english: "Hindi", native: "हिन्दी", locale: "hi-IN", script: "Deva", dir: "ltr" },
  { code: "kn", english: "Kannada", native: "ಕನ್ನಡ", locale: "kn-IN", script: "Knda", dir: "ltr" },
  { code: "ks", english: "Kashmiri", native: "کٲشُر", locale: "ks-IN", script: "Arab", dir: "rtl" },
  { code: "kok", english: "Konkani", native: "कोंकणी", locale: "kok-IN", script: "Deva", dir: "ltr" },
  { code: "ml", english: "Malayalam", native: "മലയാളം", locale: "ml-IN", script: "Mlym", dir: "ltr" },
  { code: "mni", english: "Manipuri", native: "মৈতৈলোন্", locale: "mni-IN", script: "Beng", dir: "ltr" },
  { code: "mr", english: "Marathi", native: "मराठी", locale: "mr-IN", script: "Deva", dir: "ltr" },
  { code: "mai", english: "Maithili", native: "मैथिली", locale: "mai-IN", script: "Deva", dir: "ltr" },
  { code: "ne", english: "Nepali", native: "नेपाली", locale: "ne-IN", script: "Deva", dir: "ltr" },
  { code: "or", english: "Odia", native: "ଓଡ଼ିଆ", locale: "or-IN", script: "Orya", dir: "ltr" },
  { code: "pa", english: "Punjabi", native: "ਪੰਜਾਬੀ", locale: "pa-IN", script: "Guru", dir: "ltr" },
  { code: "sa", english: "Sanskrit", native: "संस्कृतम्", locale: "sa-IN", script: "Deva", dir: "ltr" },
  { code: "sat", english: "Santali", native: "ᱥᱟᱱᱛᱟᱲᱤ", locale: "sat-IN", script: "Olck", dir: "ltr" },
  { code: "sd", english: "Sindhi", native: "سنڌي", locale: "sd-IN", script: "Arab", dir: "rtl" },
  { code: "ta", english: "Tamil", native: "தமிழ்", locale: "ta-IN", script: "Taml", dir: "ltr" },
  { code: "te", english: "Telugu", native: "తెలుగు", locale: "te-IN", script: "Telu", dir: "ltr" },
  { code: "ur", english: "Urdu", native: "اردو", locale: "ur-IN", script: "Arab", dir: "rtl" },
];

const BUNDLED = new Set(["en", "hi", "gu"]);
// Only bundles that passed validation are committed, so only those are selectable.
const EXTRA = import.meta.glob<{ default: Record<string, string> }>("../locales/extra/*.json");
const extraLoader = (code: string) => EXTRA[`../locales/extra/${code}.json`];

export type Lang = string;
export const SUPPORTED_LANGS = LANGUAGE_REGISTRY.filter((l) => BUNDLED.has(l.code) || extraLoader(l.code)).map((l) => ({
  code: l.code,
  label: l.code === "en" ? l.native : `${l.native} (${l.english})`,
}));

const META = new Map(LANGUAGE_REGISTRY.map((l) => [l.code, l]));
const STORAGE_KEY = "sociohub.lang";
const isLang = (v: unknown): v is Lang => typeof v === "string" && SUPPORTED_LANGS.some((l) => l.code === v);

if (!i18n.isInitialized) {
  // Always start in English so server and first client render match; the
  // stored choice is applied right after hydration by applyStoredLanguage().
  void i18n.use(initReactI18next).init({
    resources: { en: build(LANG_INDEX.en), hi: build(LANG_INDEX.hi), gu: build(LANG_INDEX.gu) },
    lng: "en",
    fallbackLng: "en",
    keySeparator: false,
    interpolation: { escapeValue: false },
    react: { useSuspense: false },
  });
}

const FONT_FAMILY: Partial<Record<Script, string>> = {
  Beng: "Noto+Sans+Bengali", Deva: "Noto+Sans+Devanagari", Gujr: "Noto+Sans+Gujarati", Knda: "Noto+Sans+Kannada",
  Mlym: "Noto+Sans+Malayalam", Orya: "Noto+Sans+Oriya", Guru: "Noto+Sans+Gurmukhi", Taml: "Noto+Sans+Tamil",
  Telu: "Noto+Sans+Telugu", Olck: "Noto+Sans+Ol+Chiki", Arab: "Noto+Nastaliq+Urdu",
};

/** Loads the script's Noto font only when that language is in use. */
function ensureFont(script: Script) {
  const fam = FONT_FAMILY[script];
  if (!fam || typeof document === "undefined") return;
  const id = `font-${script}`;
  if (document.getElementById(id)) return;
  const link = document.createElement("link");
  link.id = id;
  link.rel = "stylesheet";
  link.href = `https://fonts.googleapis.com/css2?family=${fam}:wght@400;600;700&display=swap`;
  document.head.appendChild(link);
}

function syncDocument(lang: Lang) {
  if (typeof document === "undefined") return;
  const m = META.get(lang);
  document.documentElement.lang = lang;
  document.documentElement.dir = m?.dir ?? "ltr";
  if (m) ensureFont(m.script);
}

async function ensureLoaded(lang: Lang) {
  if (i18n.hasResourceBundle(lang, "translation")) return;
  const load = extraLoader(lang);
  if (!load) return;
  const mod = await load();
  i18n.addResourceBundle(lang, "translation", mod.default, true, true);
}

export function currentLang(): Lang {
  const l = i18n.language;
  return isLang(l) ? l : "en";
}

export async function setLanguage(lang: Lang) {
  if (!isLang(lang)) return;
  await ensureLoaded(lang);
  await i18n.changeLanguage(lang);
  syncDocument(lang);
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
  void ensureLoaded(lang).then(() => {
    if (currentLang() !== lang) void i18n.changeLanguage(lang);
    syncDocument(lang);
  });
}

/** BCP-47 tag for Intl date formatting in the current language. */
export function localeTag(lang: Lang = currentLang()) {
  return META.get(lang)?.locale ?? "en-IN";
}

export default i18n;

/** Text direction of a language (rtl for Urdu, Kashmiri, Sindhi). */
export function langDir(lang: Lang = currentLang()): "ltr" | "rtl" {
  return META.get(lang)?.dir ?? "ltr";
}
