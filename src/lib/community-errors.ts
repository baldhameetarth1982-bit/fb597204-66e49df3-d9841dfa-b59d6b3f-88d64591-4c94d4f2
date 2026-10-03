// Maps server error codes from community/emergency RPCs to plain messages.
const MAP: Record<string, string> = {
  forbidden: "You don't have permission to do this.",
  rate_limited: "Too many attempts. Please wait a little and try again.",
  invalid_category: "Pick a valid category.",
  invalid_expiry: "Pick a valid expiry.",
  listing_removed: "This listing was removed by the committee.",
  not_found: "This item is no longer available.",
  cannot_report_own: "You can't report your own listing.",
  own_listing: "This is your own listing.",
  invalid_message: "Write 3–200 characters without < > { }.",
  reason_required: "Please give a short reason.",
  not_active: "This broadcast is no longer active.",
  invalid_block: "Pick a valid block.",
  invalid_audience: "Pick who should get reminders.",
  not_removed: "Only removed listings can be restored.",
};

export function communityError(e: unknown): string {
  const msg = (e as { message?: string })?.message ?? "";
  for (const k of Object.keys(MAP)) if (msg.includes(k)) return MAP[k];
  if (msg.includes("check constraint")) return "Some details aren't allowed. Remove < > { } and use full https:// links or 8–15 digit phones.";
  if (typeof navigator !== "undefined" && !navigator.onLine) return "You're offline. Reconnect and try again.";
  return "Something went wrong. Please try again.";
}
