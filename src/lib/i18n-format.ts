import { useTranslation } from "react-i18next";
import { localeTag } from "@/lib/i18n";

/** Plain-date strings (YYYY-MM-DD) are treated as India-local noon so they never shift a day. */
function toDate(v: string | Date) {
  if (v instanceof Date) return v;
  return new Date(v.length === 10 ? `${v}T12:00:00+05:30` : v);
}

/**
 * Locale-aware presentation for app-generated dates in the selected language.
 * Money stays in Indian ₹ format (en-IN digits) for every language; stored
 * values, bill numbers and voucher numbers are never altered.
 */
export function useLocaleFormat() {
  const { i18n } = useTranslation();
  const lang = i18n.language ?? "en";
  const tag = localeTag(lang);
  return {
    tag,
    date: (v: string | Date | null | undefined, opts: Intl.DateTimeFormatOptions = { day: "2-digit", month: "short", year: "numeric" }) =>
      v ? new Intl.DateTimeFormat(tag, { timeZone: "Asia/Kolkata", ...opts }).format(toDate(v)) : "—",
    time: (v: string | Date) =>
      new Intl.DateTimeFormat(tag, { hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" }).format(toDate(v)),
    monthShort: (i: number) => new Intl.DateTimeFormat(tag, { month: "short", timeZone: "UTC" }).format(new Date(Date.UTC(2024, i, 15))),
  };
}
