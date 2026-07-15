/**
 * Flat 360 — strict types and pure helpers.
 *
 * Pure module: no I/O, no `any`, no untyped Supabase results. Tested in
 * `tests/unit/flat360-service.test.ts`.
 *
 * Section states are honoured:
 *   - `available` = query succeeded with rows (data present)
 *   - `empty`     = query succeeded, zero rows
 *   - `unsupported` = backend has no table/relationship for this section
 *   - `error`     = query failed at runtime
 *   - `locked`    = Basic plan; Pro section not fetched at all
 *
 * "unsupported" and "empty" are NEVER conflated with zero counts.
 */

import type { UnitSummary } from "@/lib/unit-summary";
import type { PlanKey } from "@/lib/plan-features";

/* ------------------------------------------------------------------ */
/*  Section state — discriminated union                                */
/* ------------------------------------------------------------------ */

export type SectionState<T> =
  | { status: "available"; data: T }
  | { status: "empty"; message?: string }
  | { status: "unsupported"; message: string }
  | { status: "error"; message: string }
  | { status: "locked"; requiredPlan: "pro" };

export const LOCKED: SectionState<never> = { status: "locked", requiredPlan: "pro" };

export function unsupported<T>(message = "Not available yet."): SectionState<T> {
  return { status: "unsupported", message };
}

export function errorState<T>(message: string): SectionState<T> {
  return { status: "error", message };
}

/* ------------------------------------------------------------------ */
/*  Viewer + identity                                                  */
/* ------------------------------------------------------------------ */

export type Flat360ViewerRole = "society_admin" | "block_admin" | "super_admin";

export type Flat360Viewer = {
  role: Flat360ViewerRole;
  plan: PlanKey;
  canViewAdvanced: boolean;
};

export type FlatIdentity = {
  id: string;
  society_id: string;
  society_name: string | null;
  block_id: string | null;
  block_name: string | null;
  flat_number: string | null;
  floor: number | null;
  tenancy_type: string | null;
  is_serial: boolean;
  unit_label: string;
};

/* ------------------------------------------------------------------ */
/*  Section payload types                                              */
/* ------------------------------------------------------------------ */

export type OccupancyKind =
  | "vacant"
  | "owner_occupied"
  | "tenant_occupied"
  | "multi_resident"
  | "unknown";

export type OccupancySection = {
  kind: OccupancyKind;
  active_count: number;
  residents: Array<{
    // NO phone/email/DOB/gov-id/emergency/bank fields.
    display_name: string | null;
    relationship: string | null;
    is_primary: boolean;
    is_active: boolean;
    moved_in_at: string | null;
  }>;
};

export type FamilyMember = {
  id: string;
  name: string;
  relationship: string | null;
};

export type OccupancyHistoryItem = {
  user_id: string;
  display_name: string | null;
  relationship: string | null;
  moved_in_at: string | null;
  moved_out_at: string | null;
  is_active: boolean;
};

export type BasicFinancialSection = {
  current_outstanding: number;
  overdue_count: number;
  unpaid_count: number;
  latest_bill: {
    id: string;
    bill_number: string | null;
    period_label: string | null;
    amount: number;
    due_date: string;
    status: string;
  } | null;
  recent_successful_payments: Array<{
    id: string;
    amount: number;
    paid_at: string | null;
    method_label: string; // safe label — never raw provider payload
  }>;
};

export type AdvancedFinancialSection = {
  total_outstanding: number;
  pending_payment_total: number;
  overdue_count: number;
  unpaid_count: number;
  partial_count: number;
  pending_verification_count: number;
  inconsistency_count: number;
  recent_bills: Array<{
    id: string;
    bill_number: string | null;
    period_label: string | null;
    amount: number;
    due_date: string;
    status: string;
  }>;
  reconciliation_warnings: string[];
};

export type SafePaymentItem = {
  id: string;
  amount: number;
  method_label: string; // e.g. "UPI", "Cash", "Bank Transfer" — never proof URL or gateway payload
  status: "success" | "pending" | "failed" | "unknown";
  paid_at: string | null;
};

export type VehicleItem = {
  id: string;
  display_plate: string; // never raw scanning payloads
  type: string | null;
  is_active: boolean;
};

export type VisitorSummary = {
  recent_count: number;
  latest_at: string | null;
};

export type ComplaintSummary = {
  open_count: number;
  latest_status: string | null;
  // NO complaint body — descriptions can contain PII / injection strings.
};

export type DocumentSummary = {
  count: number;
  verified_count: number;
  // NO storage paths, signed URLs, identity numbers.
};

export type ApprovalSummary = {
  pending_count: number;
  latest_type: string | null;
  latest_status: string | null;
};

export type NoticeItem = {
  id: string;
  title: string;
  published_at: string | null;
  category: string | null;
};

export type SafeNoDuesSection = {
  eligible: boolean;
  total_outstanding: number;
  pending_payment_total: number;
  blocker_count: number;
  blocker_labels: string[];
  latest_request: {
    id: string;
    status: string;
    submitted_at: string;
  } | null;
  latest_certificate: {
    id: string;
    certificate_number: string;
    issued_at: string;
    valid_until: string | null;
    revoked_at: string | null;
    verification_link_available: boolean;
    // NO token, token_hash, ciphertext, iv, key_version, storage path, or QR payload.
  } | null;
};

/* ------------------------------------------------------------------ */
/*  Top-level snapshot                                                 */
/* ------------------------------------------------------------------ */

export type FinancialAvailability =
  | { status: "available" }
  | { status: "unsupported"; message: string }
  | { status: "error"; message: string };

export type Flat360Snapshot = {
  viewer: Flat360Viewer;
  identity: FlatIdentity;

  occupancy: OccupancySection;
  family: SectionState<FamilyMember[]>;
  occupancyHistory: SectionState<OccupancyHistoryItem[]>;

  // Whether the authoritative financial engine (eligibility) responded.
  // A zero in basicFinancial is only meaningful when this is "available".
  financialAvailability: FinancialAvailability;

  basicFinancial: BasicFinancialSection;
  advancedFinancial: SectionState<AdvancedFinancialSection>;
  payments: SectionState<SafePaymentItem[]>;

  vehicles: SectionState<VehicleItem[]>;
  visitors: SectionState<VisitorSummary>;
  complaints: SectionState<ComplaintSummary>;
  documents: SectionState<DocumentSummary>;
  approvals: SectionState<ApprovalSummary>;
  notices: SectionState<NoticeItem[]>;

  noDues: SectionState<SafeNoDuesSection>;
  deterministicSummary: SectionState<UnitSummary>;

  aiSummary: {
    entitlement: "available" | "locked";
    // AI generation happens through its own server function.
  };
};

/* ------------------------------------------------------------------ */
/*  Pure helpers (tested)                                              */
/* ------------------------------------------------------------------ */

/**
 * Whether the caller may see advanced Flat 360 sections.
 * Basic → false. Pro/Premium → true. Premium inherits Pro automatically.
 */
export function canViewAdvanced(plan: PlanKey): boolean {
  return plan === "pro" || plan === "premium";
}

/** Method label from a raw payment row — safe, never exposes proof URL. */
export function safeMethodLabel(method: string | null | undefined): string {
  const m = (method ?? "").toLowerCase();
  if (m.includes("cash")) return "Cash";
  if (m.includes("bank") || m.includes("neft") || m.includes("rtgs") || m.includes("imps")) return "Bank Transfer";
  if (m.includes("upi")) return "UPI";
  if (m.includes("razor") || m.includes("gateway") || m.includes("online")) return "Online";
  if (m.includes("cheque") || m.includes("check")) return "Cheque";
  return "Other";
}

/** Coerce a raw payment status to the safe union. */
export function safePaymentStatus(
  status: string | null | undefined,
): SafePaymentItem["status"] {
  const s = (status ?? "").toLowerCase();
  if (s === "success" || s === "paid" || s === "completed") return "success";
  if (s === "pending" || s === "processing" || s === "initiated") return "pending";
  if (s === "failed" || s === "rejected" || s === "cancelled") return "failed";
  return "unknown";
}

/**
 * Derive occupancy kind from the active-resident set.
 * Deterministic and PII-free.
 */
export function deriveOccupancyKind(
  residents: Array<{ relationship: string | null; is_active: boolean; is_primary: boolean }>,
): OccupancyKind {
  const active = residents.filter((r) => r.is_active);
  if (active.length === 0) return "vacant";
  if (active.length > 1) return "multi_resident";
  const rel = (active[0]?.relationship ?? "").toLowerCase();
  if (rel.includes("tenant") || rel.includes("rent")) return "tenant_occupied";
  if (rel.includes("owner") || rel.includes("self")) return "owner_occupied";
  return "unknown";
}

/**
 * Advanced section for Basic viewers — always locked. Ensures the server
 * response never carries Pro data when the plan is Basic, even if a caller
 * accidentally passes advanced data.
 */
export function lockAdvancedForBasic<T>(
  plan: PlanKey,
  build: () => SectionState<T>,
): SectionState<T> {
  if (!canViewAdvanced(plan)) return LOCKED as SectionState<T>;
  return build();
}

/** Whitelist of AI-safe action routes. Kept in one place so tests can import it. */
export const AI_ALLOWED_ROUTES: readonly string[] = [
  "/society/billing",
  "/society/accounts",
  "/society/approvals",
  "/society/no-dues",
  "/society/flats",
] as const;

/** Keys that MUST NEVER appear in the AI-safe DTO. Enforced by tests. */
export const AI_DTO_FORBIDDEN_KEYS: readonly string[] = [
  "phone",
  "email",
  "dob",
  "date_of_birth",
  "aadhaar",
  "pan",
  "govt_id",
  "government_id",
  "bank",
  "bank_account",
  "ifsc",
  "proof_url",
  "payment_proof",
  "storage_path",
  "signed_url",
  "token",
  "token_hash",
  "ciphertext",
  "iv",
  "key_version",
  "qr_payload",
  "full_name",
  "resident_name",
  "user_id",
  "flat_id",
  "society_id",
  "block_id",
] as const;
