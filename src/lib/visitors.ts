// Shared visitor / gate helpers. Server RPCs are the source of truth; these
// only map states to labels and turn server errors into safe plain messages.

export type VisitorStatus =
  | "expected" | "pending" | "awaiting" | "approved" | "denied"
  | "inside" | "exited" | "cancelled" | "expired" | "rejected";

export const VISITOR_CATEGORIES = [
  { value: "guest", label: "Guest" },
  { value: "delivery", label: "Delivery" },
  { value: "service", label: "Service" },
  { value: "cab", label: "Cab" },
  { value: "other", label: "Other" },
] as const;

export function categoryLabel(c: string | null | undefined) {
  return VISITOR_CATEGORIES.find((x) => x.value === c)?.label ?? "Guest";
}

const META: Record<string, { label: string; className: string }> = {
  expected: { label: "Expected", className: "bg-primary/10 text-primary" },
  pending: { label: "Expected", className: "bg-primary/10 text-primary" },
  awaiting: { label: "Waiting for approval", className: "bg-warning/15 text-warning-foreground" },
  approved: { label: "Approved", className: "bg-success/15 text-success" },
  inside: { label: "Inside", className: "bg-success text-success-foreground" },
  exited: { label: "Left", className: "bg-muted text-muted-foreground" },
  denied: { label: "Denied", className: "bg-destructive/10 text-destructive" },
  rejected: { label: "Denied", className: "bg-destructive/10 text-destructive" },
  cancelled: { label: "Cancelled", className: "bg-muted text-muted-foreground" },
  expired: { label: "Expired", className: "bg-muted text-muted-foreground" },
};

export function statusMeta(s: string | null | undefined) {
  return META[s ?? "inside"] ?? META.inside;
}

/** Effective status for rows read directly (resident / admin views). */
export function effectiveStatus(v: { status: string | null; exit_at?: string | null; valid_until?: string | null }): string {
  if (v.exit_at) return "exited";
  const s = v.status ?? "inside";
  if ((s === "expected" || s === "pending") && v.valid_until && new Date(v.valid_until) < new Date()) return "expired";
  return s;
}

const MESSAGES: Record<string, string> = {
  invalid_name: "Please enter the visitor's name (at least 2 letters).",
  invalid_phone: "That phone number doesn't look right.",
  invalid_category: "Please pick a visitor type.",
  invalid_date: "Pick a date within the next 30 days.",
  not_your_flat: "You need an active home in this society to invite visitors.",
  flat_not_found: "No house found with that number. Check and try again.",
  invalid_code: "That pass code isn't valid, has expired, or was already used.",
  invalid_transition: "This visitor's status has already changed. Refreshing…",
  rate_limited: "Too many attempts. Please wait a few minutes.",
  forbidden: "You don't have access to the gate for this society.",
  not_found: "This record isn't available.",
  invalid_plate: "Enter at least 3 characters of the number plate.",
  invalid_label: "Enter a slot name, like P-12.",
  vehicle_not_found: "That vehicle isn't registered in this society.",
};

export function gateErrorMessage(err: unknown): string {
  const raw = String((err as { message?: string })?.message ?? "");
  for (const k of Object.keys(MESSAGES)) if (raw.includes(k)) return MESSAGES[k];
  if (/duplicate|unique/i.test(raw)) return "That already exists. Use a different name.";
  if (/fetch|network/i.test(raw)) return "You seem to be offline. Check your connection and retry.";
  return "Something went wrong. Please try again.";
}

export function fmtTime(iso: string | null | undefined) {
  if (!iso) return "";
  const d = new Date(iso);
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  return sameDay
    ? d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
    : d.toLocaleString([], { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
}
