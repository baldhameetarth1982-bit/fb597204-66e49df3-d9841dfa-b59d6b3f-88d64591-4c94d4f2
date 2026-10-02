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
  { value: "vendor", label: "Vendor" },
  { value: "mover", label: "Movers" },
  { value: "other", label: "Other" },
] as const;

/** Guards may also log domestic staff walk-ins. */
export const GATE_CATEGORIES = [...VISITOR_CATEGORIES.slice(0, 5), { value: "staff", label: "Staff" }, VISITOR_CATEGORIES[6]] as const;

export const RECURRING_CATEGORIES = [
  { value: "staff", label: "Home help" },
  { value: "service", label: "Service" },
  { value: "delivery", label: "Delivery" },
  { value: "vendor", label: "Vendor" },
  { value: "other", label: "Other" },
] as const;

export function categoryLabel(c: string | null | undefined) {
  return [...VISITOR_CATEGORIES, ...RECURRING_CATEGORIES].find((x) => x.value === c)?.label ?? "Guest";
}

const META: Record<string, { label: string; className: string }> = {
  expected: { label: "Expected", className: "bg-primary/10 text-primary" },
  pending: { label: "Expected", className: "bg-primary/10 text-primary" },
  awaiting: { label: "Waiting for approval", className: "bg-warning/15 text-warning-foreground" },
  approved: { label: "Approved", className: "bg-success/15 text-success" },
  inside: { label: "Inside", className: "bg-success text-success-foreground" },
  overstayed: { label: "Overstayed", className: "bg-warning text-warning-foreground" },
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
  restricted_visitor: "This person is on the society's restricted list. The committee must decide.",
  needs_committee: "Movers and restricted visitors need a committee decision.",
  reason_required: "Please write a reason (at least 10 characters).",
  invalid_note: "Please add a short note (at least 5 characters).",
  pass_not_valid_now: "This regular pass isn't valid right now.",
  already_inside: "This person is already inside.",
  slot_taken: "That parking slot is already in use.",
  slot_not_found: "That visitor slot isn't available.",
  not_allowed_offline: "This needs a connection. Try again when you're online.",
  invalid_days: "Pick at least one day.",
  invalid_time: "End time must be after start time.",
  vehicle_not_found: "That vehicle isn't registered in this society.",
  reauth_required: "The committee signed out your gate session. Scan a new QR from them to continue.",
  session_unbound: "Please sign out and sign in again, then start your shift.",
  not_assigned: "This patrol round isn't assigned to you.",
  wrong_checkpoint_code: "That checkpoint code doesn't match. Check the sign at the checkpoint.",
  invalid_incident: "Pick a severity and add a short note (at least 5 characters).",
  invalid_schedule: "Check the start time, window (10–720 min) and number of days (1–14).",
  guard_not_in_society: "That guard isn't active in this society.",
  invalid_checkpoints: "Add between 1 and 30 checkpoints.",
  too_many_contacts: "You can save up to 5 safety contacts.",
  invalid_credential: "Enter the tag number (6–64 letters or digits).",
  already_registered: "That tag is already registered.",
  device_key_required: "Rotate the device key before activating.",
  invalid_status: "Pick a valid device status.",
};

/** Parking messages are checked first so longer codes win over generic ones. */
const PARKING_MESSAGES: Record<string, string> = {
  slot_already_allocated: "This slot is already assigned. Release it or use Reallocate.",
  slot_temporarily_allocated: "This slot has an active temporary allocation for another home.",
  overlapping_allocation: "Another temporary allocation overlaps that time on this slot.",
  visitor_slot_not_assignable: "Visitor slots stay for visitors and can't be assigned to homes.",
  slot_unavailable: "This slot is marked unavailable.",
  slot_has_allocation: "Release this slot's allocations first.",
  slot_in_use_by_visitor: "A visitor is parked in this slot right now.",
  slot_has_charger: "Remove the EV charger from this slot first.",
  slot_not_ev_capable: "Pick a slot marked as EV-capable.",
  vehicle_flat_mismatch: "That vehicle belongs to a different home.",
  no_current_occupant: "That home has no current resident, so parking can't be authorised.",
  holder_required: "Pick a home or a vehicle.",
  invalid_window: "The end time must be in the future and after the start.",
  window_too_long: "Temporary parking can last up to 30 days and start within 60 days.",
  invalid_purpose: "Pick why this temporary slot is needed.",
  invalid_effective_date: "The release date must be today or within the last 90 days.",
  slot_or_plate_required: "Pick a slot or enter the number plate.",
  already_closed: "This violation is already closed.",
  charger_unavailable: "This charger is offline, disabled or not set up.",
  charger_in_use: "This charger already has a charging session.",
  vehicle_already_charging: "This vehicle is already charging elsewhere.",
  invalid_energy: "Enter energy between 0 and 1000 kWh, or leave it empty.",
  invalid_range: "Pick a date range of up to one year.",
  block_not_found: "That block isn't in this society.",
  invalid_availability: "Pick a valid slot status.",
  vehicle_not_found: "That vehicle isn't registered in this society.",
};

export function gateErrorMessage(err: unknown): string {
  const raw = String((err as { message?: string })?.message ?? "");
  for (const k of Object.keys(PARKING_MESSAGES)) if (raw.includes(k)) return PARKING_MESSAGES[k];
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
