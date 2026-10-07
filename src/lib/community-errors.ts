import i18n from "@/lib/i18n";

// Maps server error codes from community/emergency RPCs to translated plain messages.
const CODES = [
  "forbidden", "rate_limited", "invalid_category", "invalid_expiry", "listing_removed",
  "not_found", "cannot_report_own", "own_listing", "invalid_message", "reason_required",
  "not_active", "invalid_block", "invalid_audience", "not_removed",
  "global_not_allowed", "no_home", "invalid_visibility",
] as const;

export function communityError(e: unknown): string {
  const msg = (e as { message?: string })?.message ?? "";
  for (const k of CODES) if (msg.includes(k)) return i18n.t(`communityErr.${k}`);
  if (msg.includes("check constraint")) return i18n.t("communityErr.check_constraint");
  if (typeof navigator !== "undefined" && !navigator.onLine) return i18n.t("communityErr.offline");
  return i18n.t("errors.generic");
}
