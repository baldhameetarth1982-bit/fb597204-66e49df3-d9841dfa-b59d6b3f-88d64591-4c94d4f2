/**
 * Super Admin (the app owner) is never forced to type a reason. Server rules
 * still require a non-blank reason for the audit history, so a blank answer
 * is recorded as this fixed note instead.
 */
export const SUPER_ADMIN_DEFAULT_REASON = "Done by Super Admin (no reason given)";

export function superAdminReason(reason: string | null | undefined): string {
  const r = (reason ?? "").trim();
  return r.length >= 5 ? r : r ? `${r} — by Super Admin` : SUPER_ADMIN_DEFAULT_REASON;
}
