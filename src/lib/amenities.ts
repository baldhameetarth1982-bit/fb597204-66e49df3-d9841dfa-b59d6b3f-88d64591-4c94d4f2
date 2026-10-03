export type AmenityType =
  | "clubhouse"
  | "court"
  | "pool"
  | "gym"
  | "guest_room"
  | "banquet"
  | "theatre"
  | "bbq"
  | "other";

export type AmenityStatus = "confirmed" | "waitlisted" | "cancelled" | "completed" | "no_show";

export interface Amenity {
  id: string;
  society_id: string;
  name: string;
  description: string | null;
  amenity_type: AmenityType;
  opens_at: string;
  closes_at: string;
  slot_minutes: number;
  capacity: number;
  advance_days: number;
  cancellation_hours: number;
  weekly_household_limit: number | null;
  owner_allowed: boolean;
  tenant_allowed: boolean;
  household_allowed?: boolean;
  defaulters_allowed: boolean;
  deposit_amount: number;
  fee_amount: number;
  is_active: boolean;
}

export interface AmenityBooking {
  id: string;
  amenity_id: string;
  flat_id: string;
  starts_at: string;
  ends_at: string;
  attendees: number;
  status: AmenityStatus;
  cancellation_reason: string | null;
  amenities?: { name: string } | null;
}

export const AMENITY_TYPE_LABELS: Record<AmenityType, string> = {
  clubhouse: "Clubhouse",
  court: "Court",
  pool: "Pool",
  gym: "Gym",
  guest_room: "Guest room",
  banquet: "Banquet",
  theatre: "Theatre",
  bbq: "BBQ",
  other: "Other",
};

export const AMENITY_STATUS_LABELS: Record<AmenityStatus, string> = {
  confirmed: "Confirmed",
  waitlisted: "Waitlisted",
  cancelled: "Cancelled",
  completed: "Completed",
  no_show: "No-show",
};

export function amenityError(error: unknown) {
  const raw = String((error as { message?: string })?.message ?? "").toLowerCase();
  if (raw.includes("tenant_not_allowed")) return "This amenity is not available to tenants.";
  if (raw.includes("owner_not_allowed")) return "This amenity is not available to owners.";
  if (raw.includes("household_not_allowed")) return "This amenity is only for the registered owner or tenant of a home.";
  if (raw.includes("tenancy_expired")) return "Your tenancy has ended, so you can't book this amenity.";
  if (raw.includes("dues_restricted")) return "This amenity is unavailable while your home has overdue maintenance.";
  if (raw.includes("weekly_limit")) return "Your household has reached this amenity's weekly booking limit.";
  if (raw.includes("blocked_date")) return "This amenity is unavailable on that date.";
  if (raw.includes("cancellation_closed")) return "The cancellation window for this booking has closed.";
  if (raw.includes("invalid_slot")) return "Choose an available time within the amenity's operating hours.";
  if (raw.includes("invalid_transition")) return "This booking has already changed. Refresh and try again.";
  if (raw.includes("not_authorized") || raw.includes("42501")) return "You don't have permission to do that.";
  if (raw.includes("rate_limited")) return "Too many requests. Please wait a few minutes.";
  if (raw.includes("network") || raw.includes("fetch")) return "You're offline. Reconnect and try again.";
  return "Something went wrong. Please try again.";
}

export const localDateTime = (value: string) =>
  new Date(value).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });