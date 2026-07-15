/**
 * Stage 3B — Turn 18A
 *
 * Pure logic for Non-Member Payments / society income architecture.
 * This module contains ONLY:
 *   - Zod schemas
 *   - Verification / reconciliation state machines
 *   - Plan gating helpers
 *   - Public list-projection ("data minimization") helpers
 *
 * No Supabase client, no network. Safe to unit-test in isolation.
 * Server functions live in `non-member-income.functions.ts`.
 */
import { z } from "zod";
import { hasFeature, type PlanKey } from "@/lib/plan-features";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const NON_MEMBER_INCOME_FEATURE = "non_member_payments" as const;

export const PAYER_TYPES = [
  "vendor",
  "advertiser",
  "coach",
  "event_organizer",
  "shop",
  "guest",
  "temporary",
  "other",
] as const;

export const PAYER_KINDS = ["resident", "non_member", "anonymous"] as const;

export const SUPPORTED_METHODS = ["cash", "bank_transfer", "other_offline"] as const;

export const VERIFICATION_STATES = ["pending", "verified", "rejected", "reversed"] as const;

export const RECONCILIATION_STATES = [
  "unreconciled",
  "matched",
  "partially_matched",
  "needs_review",
  "reversed",
] as const;

export const DEFAULT_SYSTEM_CATEGORIES: Array<{
  key: string;
  display_name: string;
  category_group: string;
}> = [
  { key: "maintenance", display_name: "Maintenance", category_group: "core" },
  { key: "vendor_income", display_name: "Vendor Income", category_group: "commercial" },
  { key: "advertisements", display_name: "Advertisements", category_group: "commercial" },
  { key: "fines", display_name: "Fines", category_group: "compliance" },
  { key: "events", display_name: "Events", category_group: "community" },
  { key: "shops", display_name: "Shops", category_group: "commercial" },
  { key: "coaches", display_name: "Coaches", category_group: "commercial" },
  { key: "promotions", display_name: "Promotions", category_group: "commercial" },
  { key: "amenity_fees", display_name: "Amenity Fees", category_group: "core" },
  { key: "deposits", display_name: "Deposits", category_group: "core" },
  { key: "donations", display_name: "Donations", category_group: "community" },
  { key: "other", display_name: "Other Income", category_group: "core" },
];

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------

const emailSchema = z
  .string()
  .trim()
  .max(254)
  .email()
  .optional()
  .or(z.literal("").transform(() => undefined));

const phoneSchema = z
  .string()
  .trim()
  .regex(/^[+0-9 \-()]{6,20}$/u, "invalid_phone")
  .optional()
  .or(z.literal("").transform(() => undefined));

export const NormalizedKeySchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9](?:[a-z0-9_-]*[a-z0-9])?$/u, "invalid_key");

export const CreateCategoryInput = z.object({
  societyId: z.string().uuid(),
  key: z
    .string()
    .trim()
    .min(1)
    .max(64)
    .transform((v) => v.toLowerCase().replace(/[^a-z0-9_-]+/gu, "_"))
    .pipe(NormalizedKeySchema),
  display_name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).optional(),
  category_group: z.string().trim().max(64).optional(),
});
export type CreateCategoryInputT = z.infer<typeof CreateCategoryInput>;

export const UpdateCategoryInput = z.object({
  id: z.string().uuid(),
  societyId: z.string().uuid(),
  display_name: z.string().trim().min(1).max(120).optional(),
  description: z.string().trim().max(500).optional(),
  category_group: z.string().trim().max(64).optional(),
  is_active: z.boolean().optional(),
});
export type UpdateCategoryInputT = z.infer<typeof UpdateCategoryInput>;

export const CreatePayerInput = z.object({
  societyId: z.string().uuid(),
  payer_type: z.enum(PAYER_TYPES),
  display_name: z.string().trim().min(1).max(120),
  organization_name: z.string().trim().max(160).optional(),
  phone: phoneSchema,
  email: emailSchema,
  reference_code: z.string().trim().max(64).optional(),
  notes: z.string().trim().max(1000).optional(),
});
export type CreatePayerInputT = z.infer<typeof CreatePayerInput>;

export const UpdatePayerInput = CreatePayerInput.partial({
  payer_type: true,
  display_name: true,
}).extend({
  id: z.string().uuid(),
  societyId: z.string().uuid(),
  is_active: z.boolean().optional(),
});
export type UpdatePayerInputT = z.infer<typeof UpdatePayerInput>;

const AmountSchema = z
  .union([z.number(), z.string()])
  .transform((v) => (typeof v === "string" ? Number(v) : v))
  .refine((n) => Number.isFinite(n) && n > 0, "amount_must_be_positive")
  .refine((n) => n <= 1e11, "amount_too_large");

export const CreateIncomeRecordInput = z
  .object({
    societyId: z.string().uuid(),
    category_id: z.string().uuid(),
    payer_kind: z.enum(PAYER_KINDS),
    resident_user_id: z.string().uuid().optional(),
    non_member_payer_id: z.string().uuid().optional(),
    amount: AmountSchema,
    payment_method: z.enum(SUPPORTED_METHODS),
    payment_date: z
      .string()
      .datetime({ offset: true })
      .optional()
      .or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/u).optional()),
    reference_number: z.string().trim().max(128).optional(),
    description: z.string().trim().max(500).optional(),
  })
  .superRefine((v, ctx) => {
    if (v.payer_kind === "resident") {
      if (!v.resident_user_id || v.non_member_payer_id) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "exactly_one_payer" });
      }
    } else if (v.payer_kind === "non_member") {
      if (!v.non_member_payer_id || v.resident_user_id) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "exactly_one_payer" });
      }
    } else if (v.payer_kind === "anonymous") {
      if (v.resident_user_id || v.non_member_payer_id) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "exactly_one_payer" });
      }
    }
  });
export type CreateIncomeRecordInputT = z.infer<typeof CreateIncomeRecordInput>;

export const VerifyRecordInput = z.object({
  societyId: z.string().uuid(),
  id: z.string().uuid(),
});
export const RejectRecordInput = z.object({
  societyId: z.string().uuid(),
  id: z.string().uuid(),
  reason: z.string().trim().min(1).max(500),
});
export const ReverseRecordInput = z.object({
  societyId: z.string().uuid(),
  id: z.string().uuid(),
  reason: z.string().trim().min(1).max(500),
});

// ---------------------------------------------------------------------------
// State machines
// ---------------------------------------------------------------------------

export type VerificationState = (typeof VERIFICATION_STATES)[number];
export type ReconciliationState = (typeof RECONCILIATION_STATES)[number];

/**
 * Allowed verification transitions. `reversed` is terminal.
 */
const VERIFICATION_TRANSITIONS: Record<VerificationState, VerificationState[]> = {
  pending: ["verified", "rejected"],
  verified: ["reversed"],
  rejected: ["pending"], // an admin may reopen a rejected record for correction
  reversed: [],
};

export function canTransitionVerification(
  from: VerificationState,
  to: VerificationState,
): boolean {
  return VERIFICATION_TRANSITIONS[from]?.includes(to) ?? false;
}

// ---------------------------------------------------------------------------
// Plan gating
// ---------------------------------------------------------------------------

export function isNonMemberIncomeAllowed(plan: PlanKey): boolean {
  return hasFeature(plan, NON_MEMBER_INCOME_FEATURE);
}

export class ForbiddenPlanError extends Error {
  code = "forbidden_plan" as const;
  constructor(public plan: PlanKey) {
    super("This feature requires a Pro or Premium plan.");
  }
}
export class ForbiddenSocietyError extends Error {
  code = "forbidden_society" as const;
  constructor() {
    super("You do not have permission for this society.");
  }
}
export class InvalidTransitionError extends Error {
  code = "invalid_transition" as const;
  constructor(from: string, to: string) {
    super(`Cannot transition ${from} -> ${to}`);
  }
}

// ---------------------------------------------------------------------------
// Data minimization — projections for default list responses
// ---------------------------------------------------------------------------

export interface PayerRow {
  id: string;
  society_id: string;
  payer_type: string;
  display_name: string;
  organization_name: string | null;
  phone: string | null;
  email: string | null;
  reference_code: string | null;
  notes: string | null;
  is_active: boolean;
  created_at: string;
}

export interface PublicPayerListItem {
  id: string;
  payer_type: string;
  display_name: string;
  organization_name: string | null;
  is_active: boolean;
}

export function toPublicPayerList(rows: PayerRow[]): PublicPayerListItem[] {
  return rows.map((r) => ({
    id: r.id,
    payer_type: r.payer_type,
    display_name: r.display_name,
    organization_name: r.organization_name,
    is_active: r.is_active,
  }));
}

export interface IncomeRecordRow {
  id: string;
  society_id: string;
  category_id: string;
  payer_kind: string;
  amount: number | string;
  payment_method: string;
  payment_status: string;
  verification_status: string;
  reconciliation_status: string;
  payment_date: string;
  reference_number: string | null;
}

export interface PublicIncomeListItem {
  id: string;
  category_id: string;
  payer_kind: string;
  amount: number;
  payment_method: string;
  payment_status: string;
  verification_status: string;
  reconciliation_status: string;
  payment_date: string;
  reference_suffix: string | null;
}

function maskReference(ref: string | null): string | null {
  if (!ref) return null;
  const trimmed = ref.trim();
  if (trimmed.length <= 4) return "•".repeat(trimmed.length);
  return `••••${trimmed.slice(-4)}`;
}

export function toPublicIncomeList(rows: IncomeRecordRow[]): PublicIncomeListItem[] {
  return rows.map((r) => ({
    id: r.id,
    category_id: r.category_id,
    payer_kind: r.payer_kind,
    amount: typeof r.amount === "string" ? Number(r.amount) : r.amount,
    payment_method: r.payment_method,
    payment_status: r.payment_status,
    verification_status: r.verification_status,
    reconciliation_status: r.reconciliation_status,
    payment_date: r.payment_date,
    reference_suffix: maskReference(r.reference_number),
  }));
}

/**
 * Normalize the free-form key into the DB canonical form. Exposed for tests.
 */
export function normalizeCategoryKey(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/gu, "_")
    .replace(/^_+|_+$/gu, "");
}
