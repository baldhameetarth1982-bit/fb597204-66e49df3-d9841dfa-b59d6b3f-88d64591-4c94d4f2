// Guard shift helpers for display only. The database decides whether a guard is
// on shift (public._guard_on_shift uses server time), so nothing here grants access.
import i18n, { localeTag } from "@/lib/i18n";

/** Postgres weekday numbers (0 = Sunday), shown Monday first. */
export const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0] as const;

export interface GuardShift { weekdays: number[]; start: string; end: string; timezone?: string }

export function weekdayName(dow: number, style: "short" | "long" = "short") {
  // 2023-01-01 was a Sunday.
  const d = new Date(Date.UTC(2023, 0, 1 + dow, 12));
  return d.toLocaleDateString(localeTag(), { weekday: style, timeZone: "UTC" });
}

export function timeLabel(hhmm: string) {
  const [h, m] = hhmm.split(":").map(Number);
  const d = new Date(Date.UTC(2023, 0, 1, h || 0, m || 0));
  return d.toLocaleTimeString(localeTag(), { hour: "numeric", minute: "2-digit", timeZone: "UTC", numberingSystem: "latn" });
}

export function shiftSummary(s: GuardShift) {
  const days = WEEK_ORDER.filter((d) => s.weekdays.includes(d)).map((d) => weekdayName(d)).join(", ");
  return i18n.t("ln.sh.hours", { days, start: timeLabel(s.start), end: timeLabel(s.end) }) as string;
}

export const isOvernight = (start: string, end: string) => !!start && !!end && end <= start;

const ERROR_KEYS = [
  "CODE_INVALID", "ALREADY_MEMBER", "NAME_REQUIRED", "GUARD_CANNOT_BE_RESIDENT",
  "SHIFT_DAYS_REQUIRED", "SHIFT_TIME_INVALID", "ALREADY_REVIEWED", "off_shift",
] as const;

/** Maps known server codes to friendly text; returns null for anything else. */
export function guardShiftError(err: unknown): string | null {
  const raw = String((err as { message?: string })?.message ?? "");
  const k = ERROR_KEYS.find((c) => raw.includes(c));
  return k ? (i18n.t(`ln.gje.${k}`) as string) : null;
}
