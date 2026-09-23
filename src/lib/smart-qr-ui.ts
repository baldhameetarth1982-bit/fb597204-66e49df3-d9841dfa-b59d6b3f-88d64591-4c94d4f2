/** Client-safe helpers and plain-language messages for Smart QR screens. */
export const inr = (n: number) =>
  `₹${n.toLocaleString("en-IN", { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 })}`;

export const QR_CREATE_ERRORS: Record<string, string> = {
  not_authorized: "You don't have permission to create QR codes for this society.",
  plan_required: "Smart QR Collections is available on the Pro plan.",
  category_inactive: "That income category is turned off. Pick another one.",
  invalid_input: "Some details look wrong. Check the bank details and dates.",
  temporary_error: "Couldn't create the QR code right now. Please try again.",
};

export const REVIEW_ERRORS: Record<string, string> = {
  not_found: "This submission is no longer available.",
  plan_required: "Smart QR Collections is available on the Pro plan.",
  already_processed: "Someone already reviewed this submission.",
  reason_required: "Add a short reason (at least 3 characters).",
  category_inactive: "The income category for this QR is turned off. Turn it back on first.",
  not_authorized: "You don't have permission to do this.",
  idempotency_conflict: "This payment was already recorded with different details.",
  invalid_input: "This submission couldn't be recorded. Reject it instead.",
  temporary_error: "Couldn't save right now. Please try again.",
};

export const SUBMIT_MESSAGES: Record<string, string> = {
  not_found: "This QR code isn't valid.",
  inactive: "This collection is no longer accepting payments.",
  rate_limited: "Too many attempts. Please wait a few minutes and try again.",
  duplicate_reference: "This transaction reference was already submitted.",
  invalid_input: "Some details look wrong. Check the amount, date and reference.",
  temporary_error: "Couldn't send right now. Your details are kept — please try again.",
};

export function todayIST(): string {
  return new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
}
