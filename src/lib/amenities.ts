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

import i18n, { localeTag } from "@/lib/i18n";

const tr = (k: string, o?: Record<string, unknown>) => i18n.t(k, o) as string;

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

/** Translated labels for the current UI language; the English constants stay as data. */
export const amenityTypeLabel = (t: AmenityType) => tr(t === "other" ? "cm.other" : `am.type.${t}`);
export const amenityStatusLabel = (s: AmenityStatus) => tr(s === "cancelled" ? "billStatus.cancelled" : `am.st.${s}`);

export function amenityError(error: unknown) {
  const raw = String((error as { message?: string })?.message ?? "").toLowerCase();
  if (raw.includes("tenant_not_allowed")) return tr("am.err.tenant");
  if (raw.includes("owner_not_allowed")) return tr("am.err.owner");
  if (raw.includes("household_not_allowed")) return tr("am.err.household");
  if (raw.includes("tenancy_expired")) return tr("am.err.tenancy");
  if (raw.includes("dues_restricted")) return tr("am.err.dues");
  if (raw.includes("weekly_limit")) return tr("am.err.weekly");
  if (raw.includes("blocked_date")) return tr("am.err.date");
  if (raw.includes("cancellation_closed")) return tr("am.err.cancelClosed");
  if (raw.includes("invalid_slot")) return tr("am.err.slot");
  if (raw.includes("invalid_transition")) return tr("am.err.transition");
  if (raw.includes("not_authorized") || raw.includes("42501")) return tr("hd.err.denied");
  if (raw.includes("rate_limited")) return tr("am.err.rate");
  if (raw.includes("network") || raw.includes("fetch")) return tr("am.err.offline");
  return tr("errors.generic");
}

export const localDateTime = (value: string) =>
  new Date(value).toLocaleString(localeTag(), { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });