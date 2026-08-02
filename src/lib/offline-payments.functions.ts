import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  buildRpcArgs,
  callBillingRpc,
  extractRpcId,
  mapError,
  toBillingRpcClient,
  type BillingRpcClient,
} from "./billing-config.functions";
import { residentSubmitInputSchema } from "./offline-payment-contracts";
import { submitResidentBankTransferWithClient } from "./offline-payment-resident-submit";

/**
 * Stage 3C — Offline payments (Cash / Bank Transfer only).
 *
 * All writes go through SECURITY DEFINER RPCs (submit/verify/reject/reverse).
 * All reads also go through SECURITY DEFINER RPCs that explicitly authorize
 * the caller (admin billing.manage / super_admin, or resident of the flat);
 * we do not rely on RLS alone for financial reads.
 *
 * `proof_url` is intentionally NOT exposed on any Stage 3C read/write
 * surface — the column is dormant until the secure signed-upload work
 * lands in a later stage.
 *
 * No online gateway, UPI, cards, wallets, Razorpay, PayU, Cashfree.
 * Legacy `success` payment rows are readable but cannot be transitioned
 * by any of these RPCs (invalid_transition).
 */

export type OfflinePaymentStatus =
  | "pending"
  | "verified"
  | "rejected"
  | "reversed"
  | "success"; // legacy read-only


/** Admin payment row shape used by `list_society_payments_v1`. */
export interface OfflinePaymentRow {
  id: string;
  bill_id: string | null;
  society_id: string;
  flat_id: string | null;
  amount: number;
  method: string;
  status: string;
  reference_no: string | null;
  notes: string | null;
  submitted_at: string | null;
  submitted_by: string | null;
  source: string | null;
  payment_date: string | null;
  verified_at: string | null;
  verified_by: string | null;
  verification_notes: string | null;
  rejected_at: string | null;
  rejection_reason: string | null;
  reversed_at: string | null;
  reversal_reason: string | null;
  created_at: string;
}

/** Resident-safe payment row shape used by `get_resident_payments_v1`. */
export interface ResidentPaymentRow {
  id: string;
  bill_id: string | null;
  society_id: string;
  flat_id: string | null;
  amount: number;
  method: string;
  status: string;
  reference_no: string | null;
  submitted_at: string | null;
  payment_date: string | null;
  verified_at: string | null;
  rejected_at: string | null;
  rejection_reason: string | null;
  reversed_at: string | null;
  reversal_reason: string | null;
  created_at: string;
}

/**
 * Common safe payment fields returned by `get_payment_detail` to every
 * audience. Admin callers additionally receive {@link AdminOnlyDetailFields}.
 */
export interface CommonDetailPaymentFields {
  id: string;
  bill_id: string | null;
  society_id: string;
  flat_id: string | null;
  amount: number;
  method: string;
  status: string;
  reference_no: string | null;
  submitted_at: string | null;
  source: string | null;
  payment_date: string | null;
  verified_at: string | null;
  rejected_at: string | null;
  rejection_reason: string | null;
  reversed_at: string | null;
  reversal_reason: string | null;
  created_at: string;
}

/** Admin-only payment fields; populated only when audience === 'admin'. */
export interface AdminOnlyDetailFields {
  notes: string | null;
  submitted_by: string | null;
  verified_by: string | null;
  verification_notes: string | null;
  rejected_by: string | null;
  reversed_by: string | null;
}

export type AdminDetailPayment = CommonDetailPaymentFields & AdminOnlyDetailFields;
export type ResidentDetailPayment = CommonDetailPaymentFields;

export type ReceiptStatus = "valid" | "void";

export interface PaymentReceiptLifecycle {
  id: string;
  payment_id: string;
  society_id: string;
  receipt_number: string;
  issued_at: string;
  status: ReceiptStatus;
  voided_at: string | null;
  voided_by: string | null;
  void_reason: string | null;
  amount_snapshot: number | null;
  method_snapshot: string | null;
  reference_snapshot: string | null;
  bill_number_snapshot: string | null;
  verified_by: string | null;
  verified_at: string | null;
}

export interface BillPaymentSummary {
  bill_id: string;
  society_id: string;
  total_payable: number;
  verified_amount: number;
  pending_amount: number;
  rejected_amount: number;
  reversed_amount: number;
  remaining_verified_balance: number;
  available_to_submit: number;
  status: string;
  cancelled: boolean;
}

/** Canonical bill payment summary. Every financial field is Zod-validated. */
const billPaymentSummarySchema = z.object({
  bill_id: z.string(),
  society_id: z.string(),
  total_payable: z.coerce.number(),
  verified_amount: z.coerce.number(),
  pending_amount: z.coerce.number(),
  rejected_amount: z.coerce.number(),
  reversed_amount: z.coerce.number(),
  remaining_verified_balance: z.coerce.number(),
  available_to_submit: z.coerce.number(),
  status: z.string(),
  cancelled: z.boolean(),
});


/** Extend billing mapError with Stage 3C codes. Never leaks raw DB messages. */
export function mapPaymentError(msg: string): string {
  const m = (msg || "").toLowerCase();
  if (m.includes("invalid_method")) return "Only Cash and Bank Transfer are supported.";
  if (m.includes("invalid_amount")) return "Enter a valid payment amount.";
  if (m.includes("invalid_idempotency_key")) return "Please retry your submission.";
  if (m.includes("invalid_actor_role")) return "Invalid submission context.";
  if (m.includes("resident_cash_not_allowed"))
    return "Residents can only submit Bank Transfer payments. Ask your admin to record cash.";
  if (m.includes("amount_exceeds_outstanding"))
    return "This amount exceeds the remaining bill balance. Reduce the amount and try again.";
  if (m.includes("duplicate_reference"))
    return "This reference number has already been used for another payment.";
  if (m.includes("idempotency_conflict"))
    return "This submission conflicts with an earlier one. Please refresh and try again.";
  if (m.includes("self_verification_not_allowed"))
    return "The person who submitted this payment cannot also verify it.";
  if (m.includes("payment_not_pending"))
    return "Only pending payments can be verified.";
  if (m.includes("bill_not_found")) return "Bill not found.";
  if (m.includes("bill_cancelled")) return "This bill has been cancelled.";
  if (m.includes("reference_required")) return "Reference number is required for bank transfers.";
  if (m.includes("not_authorized")) return "You are not allowed to perform this action.";
  if (m.includes("payment_not_found")) return "Payment not found.";
  if (m.includes("invalid_transition")) return "This payment cannot be updated from its current state.";
  if (m.includes("reason_required")) return "Please provide a reason.";
  if (m.includes("unauthenticated")) return "Please sign in and try again.";
  return mapError(msg);
}

/* ------------------------------ Schemas ------------------------------- */

/**
 * Stage 3C v5 — split resident/admin submission contracts. The generic
 * `submitOfflinePayment` server function has been REMOVED so that no
 * public API accepts a browser-supplied `actorRole`. Residents call
 * `submitResidentBankTransfer`; admins call `recordAdminOfflinePayment`.
 * Both fix `_actor_role` server-side.
 */
// Resident submission schema is the canonical exported schema from
// `./offline-payment-contracts` — single source of truth. Do not
// redeclare it here.
const residentSubmitInput = residentSubmitInputSchema;

const adminRecordInput = z.object({
  billId: z.string().uuid(),
  method: z.enum(["cash", "bank_transfer"]),
  amount: z.number().positive().max(10_000_000),
  paymentDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  referenceNo: z.string().trim().max(120).nullable().optional(),
  notes: z.string().trim().max(1000).nullable().optional(),
  idempotencyKey: z.string().trim().min(6).max(120),
});

const paymentIdOnly = z.object({ paymentId: z.string().uuid() });
const paymentWithReason = paymentIdOnly.extend({ reason: z.string().trim().min(1).max(500) });
const paymentWithOptionalNotes = paymentIdOnly.extend({
  notes: z.string().trim().max(500).nullable().optional(),
});

/* ------------------------------ Writes ------------------------------- */



/** Stage 3C v4 — resident Bank Transfer only. Method/actor fixed server-side.
 *  Delegates to the neutral shared core so production and fixture cannot drift. */
/** Safe provider-error message extractor. Never leaks object contents. */
function residentSubmitProviderErrorMessage(e: unknown): string {
  if (e && typeof e === "object" && "message" in e) {
    const m = (e as { message: unknown }).message;
    if (typeof m === "string" && m.length > 0) return m;
  }
  return "operation_failed";
}

export const submitResidentBankTransfer = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => residentSubmitInput.parse(i))
  .handler(async ({ data, context }) => {
    try {
      const paymentId = await submitResidentBankTransferWithClient(
        toBillingRpcClient(context),
        {
          billId: data.billId,
          amount: data.amount,
          paymentDate: data.paymentDate ?? null,
          referenceNo: data.referenceNo,
          notes: data.notes ?? null,
          idempotencyKey: data.idempotencyKey,
        },
      );
      return { paymentId };
    } catch (e) {
      throw new Error(mapPaymentError(residentSubmitProviderErrorMessage(e)));
    }
  });

/** Stage 3C v4 — admin-recorded Cash or Bank Transfer. Actor fixed server-side. */
export const recordAdminOfflinePayment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => adminRecordInput.parse(i))
  .handler(async ({ data, context }) => {
    try {
      const raw = await callBillingRpc(
        toBillingRpcClient(context),
        "submit_offline_payment",
        buildRpcArgs({
          _bill_id: data.billId,
          _method: data.method,
          _amount: data.amount,
          _payment_date: data.paymentDate ?? null,
          _reference_no: data.referenceNo ?? null,
          _notes: data.notes ?? null,
          _idempotency_key: data.idempotencyKey,
          _actor_role: "admin",
        }),
      );
      return { paymentId: extractRpcId(raw) };
    } catch (e) {
      throw new Error(mapPaymentError((e as Error).message));
    }
  });

/**
 * Stage 3C Checkpoint B Run C — GROUNDED receipt-number contract.
 *
 * Grounded in the effective allocator
 * `public._allocate_receipt_number_monthly(uuid, timestamptz)`:
 *
 *   RETURN 'RCPT/' || ym::text || '/' || LPAD((n - 1)::text, 4, '0');
 *
 * where `ym = year * 100 + month`. Therefore the canonical shape is
 * exactly three `/`-separated segments:
 *
 *   1. the literal prefix `RCPT`
 *   2. a 6-digit `YYYYMM` segment (year >= 1000, month 01..12)
 *   3. a zero-padded decimal sequence of at least 4 digits
 *      (LPAD pads to 4; a society past 9999 receipts in one month
 *      naturally widens the segment, so wider is valid, narrower is not)
 *
 * The sequence is `n - 1` where `n` is the post-increment value, so the
 * first receipt of a month is `0001`; `0000` is unreachable and rejected.
 *
 * NOTE: receipt numbers are NOT lexicographically comparable across
 * months, and the sequence segment width can change at the 9999 boundary.
 * Ordering comparisons MUST go through {@link parseReceiptNumber} and use
 * the numeric `yearMonth` / `sequence` fields — never raw string compare.
 */
export const RECEIPT_NUMBER_PREFIX = "RCPT";
const RECEIPT_NUMBER_PATTERN = /^RCPT\/(\d{6})\/(\d{4,})$/;

export interface ParsedReceiptNumber {
  readonly raw: string;
  /** `year * 100 + month`, exactly as the allocator computes it. */
  readonly yearMonth: number;
  readonly year: number;
  /** 1..12 */
  readonly month: number;
  /** Allocator sequence, >= 1. */
  readonly sequence: number;
}

/**
 * Parse a receipt number produced by the effective monthly allocator.
 * Returns `null` for ANY value that the allocator could not have emitted:
 * malformed prefix, wrong segment count, non-6-digit year/month, an
 * impossible month, fewer than 4 sequence digits, a `0000` sequence,
 * whitespace padding, or a non-string input.
 */
export function parseReceiptNumber(value: unknown): ParsedReceiptNumber | null {
  if (typeof value !== "string") return null;
  const m = RECEIPT_NUMBER_PATTERN.exec(value);
  if (!m) return null;
  const ym = Number(m[1]);
  const year = Math.floor(ym / 100);
  const month = ym % 100;
  if (!Number.isInteger(year) || year < 1000) return null;
  if (month < 1 || month > 12) return null;
  const sequence = Number(m[2]);
  if (!Number.isSafeInteger(sequence) || sequence < 1) return null;
  return Object.freeze({ raw: value, yearMonth: ym, year, month, sequence });
}

/**
 * Strict allocator-grounded receipt-number Zod schema. Shared by the
 * production verification core and every Stage 3C proof so the format
 * is never re-invented from test literals.
 */
export const receiptNumberSchema = z
  .string()
  .refine((s) => parseReceiptNumber(s) !== null, {
    message: "invalid_receipt_number",
  });

/**
 * Strict UUID contract. `payments.id` and `payment_receipts.id` are
 * `uuid` columns, so the server can only ever return a canonical
 * lowercase-or-uppercase 8-4-4-4-12 hex string. Whitespace-padded or
 * otherwise malformed values are rejected rather than trimmed.
 */
const CANONICAL_UUID_PATTERN =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
export const strictUuidSchema = z
  .string()
  .regex(CANONICAL_UUID_PATTERN, { message: "invalid_uuid" });

/**
 * Stage 3C Checkpoint B Run C — STRICT success contract.
 *
 * `verify_offline_payment` returns exactly
 * `jsonb_build_object('payment_id', ..., 'receipt_number', ..., 'receipt_id', ...)`.
 * All three keys are mandatory, unknown keys are rejected, UUIDs must be
 * canonical, and the receipt number must satisfy the real allocator
 * format. A null / empty / malformed payload fails closed instead of
 * being silently defaulted from caller-supplied input.
 */
const verifyPaymentResultSchema = z
  .object({
    payment_id: strictUuidSchema,
    receipt_number: receiptNumberSchema,
    receipt_id: strictUuidSchema,
  })
  .strict();



/**
 * Stage 3C Checkpoint B Run A — shared production verification core.
 *
 * Single construction of the `verify_offline_payment` RPC used by both
 * the `verifyOfflinePayment` server function AND the Stage 3C live
 * REJECTION-05 / REVERSAL-09 matrix handlers, so production and tests
 * cannot drift. Canonical SQL error tokens (e.g. `payment_not_pending`)
 * are preserved verbatim so the outer server-function wrapper's
 * {@link mapPaymentError} can translate them into user-facing text.
 * Unknown provider failures are collapsed to `operation_failed` — raw
 * database/provider messages are NEVER re-thrown.
 */
export interface VerifyOfflinePaymentInput {
  readonly paymentId: string;
  readonly notes?: string | null;
}

export interface VerifyOfflinePaymentResult {
  readonly paymentId: string;
  readonly receiptNumber: string;
  readonly receiptId: string;
}

/**
 * Canonical error tokens raised by `verify_offline_payment` (grounded in
 * the effective PL/pgSQL body at implementation time). Exposed so tests
 * and callers share a single source of truth — never re-declared.
 */
export const VERIFY_OFFLINE_PAYMENT_CANONICAL_ERRORS = Object.freeze([
  "unauthenticated",
  "payment_not_found",
  "not_authorized",
  "payment_not_pending",
  "self_verification_not_allowed",
  "bill_not_found",
  "bill_cancelled",
  "amount_exceeds_outstanding",
] as const);

export type VerifyOfflinePaymentCanonicalError =
  (typeof VERIFY_OFFLINE_PAYMENT_CANONICAL_ERRORS)[number];

function escapeRegexToken(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Exact token match — NEVER a substring `includes()` test.
 *
 * The token must appear as a whole word: bounded on both sides by a
 * non-word character or a string edge, and never preceded by `_` (so
 * `not_authenticated` can never be read as `unauthenticated`, and
 * `xx_not_authorized_yy` can never be read as `not_authorized`).
 */
export function matchesVerifyCanonicalError(
  message: string,
  token: VerifyOfflinePaymentCanonicalError,
): boolean {
  if (typeof message !== "string" || message.length === 0) return false;
  const re = new RegExp(`(^|[^\\w])${escapeRegexToken(token)}(\\W|$)`, "i");
  return re.test(message);
}

/**
 * Stage 3C Checkpoint B Run C — unambiguous canonical classification.
 *
 * A provider message is only mapped to a canonical token when EXACTLY
 * ONE distinct canonical token matches. Rules:
 *
 *  - zero matches                  -> null (caller uses `operation_failed`)
 *  - exactly one distinct match    -> that token
 *  - two or more distinct matches  -> null (ambiguous; fail closed)
 *
 * This prevents array-order from silently deciding the meaning of a
 * message such as `payment_not_pending and not_authorized`. A single
 * token repeated several times in one message is still one distinct
 * match and remains unambiguous.
 */
export function classifyVerifyCanonicalError(
  message: unknown,
): VerifyOfflinePaymentCanonicalError | null {
  if (typeof message !== "string" || message.length === 0) return null;
  const matched = VERIFY_OFFLINE_PAYMENT_CANONICAL_ERRORS.filter((tok) =>
    matchesVerifyCanonicalError(message, tok),
  );
  const distinct = [...new Set<VerifyOfflinePaymentCanonicalError>(matched)];
  return distinct.length === 1 ? distinct[0]! : null;
}

async function callVerifyRpc(
  client: BillingRpcClient,
  args: Record<string, unknown>,
): Promise<unknown> {
  const { data, error } = await client.rpc("verify_offline_payment", args);
  if (error) {
    const raw = typeof error.message === "string" ? error.message : "";
    throw new Error(classifyVerifyCanonicalError(raw) ?? "operation_failed");
  }
  return data;
}


/**
 * Neutral shared production core. Invokes `verify_offline_payment` once
 * and parses the response through the STRICT canonical Zod schema.
 *
 * Fails closed (`operation_failed`) on a null, non-object, empty,
 * unknown-key or otherwise malformed success payload. Never substitutes
 * caller-supplied input for a missing server-returned identifier.
 */
export async function verifyOfflinePaymentWithClient(
  client: BillingRpcClient,
  input: VerifyOfflinePaymentInput,
): Promise<VerifyOfflinePaymentResult> {
  const raw = await callVerifyRpc(
    client,
    buildRpcArgs({ _payment_id: input.paymentId, _notes: input.notes ?? null }),
  );
  const parsed = verifyPaymentResultSchema.safeParse(raw);
  if (!parsed.success) throw new Error("operation_failed");
  return {
    paymentId: parsed.data.payment_id,
    receiptNumber: parsed.data.receipt_number,
    receiptId: parsed.data.receipt_id,
  };
}


export const verifyOfflinePayment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => paymentWithOptionalNotes.parse(i))
  .handler(async ({ data, context }) => {
    try {
      return await verifyOfflinePaymentWithClient(toBillingRpcClient(context), {
        paymentId: data.paymentId,
        notes: data.notes ?? null,
      });
    } catch (e) {
      throw new Error(mapPaymentError((e as Error).message));
    }
  });


export const rejectOfflinePayment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => paymentWithReason.parse(i))
  .handler(async ({ data, context }) => {
    try {
      await callBillingRpc(
        toBillingRpcClient(context),
        "reject_offline_payment",
        buildRpcArgs({ _payment_id: data.paymentId, _reason: data.reason }),
      );
      return { ok: true };
    } catch (e) {
      throw new Error(mapPaymentError((e as Error).message));
    }
  });

export const reverseOfflinePayment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => paymentWithReason.parse(i))
  .handler(async ({ data, context }) => {
    try {
      await callBillingRpc(
        toBillingRpcClient(context),
        "reverse_offline_payment",
        buildRpcArgs({ _payment_id: data.paymentId, _reason: data.reason }),
      );
      return { ok: true };
    } catch (e) {
      throw new Error(mapPaymentError((e as Error).message));
    }
  });

// (paymentDetailSchema is defined below with strong nested schemas.)



// paymentDetailSchema and getPaymentDetail are declared below,
// after paymentRowSchema and receiptLifecycleSchema.




/*
 * All Stage 3C reads route through SECURITY DEFINER RPCs that verify the
 * caller's authorization explicitly. Rows come back as jsonb; we validate
 * a minimal shape with Zod before returning strongly typed rows.
 */

const listInput = z.object({
  societyId: z.string().uuid(),
  status: z.enum(["pending", "verified", "rejected", "reversed", "all"]).default("pending"),
  limit: z.number().int().min(1).max(200).default(50),
  offset: z.number().int().min(0).default(0),
});


const paymentRowSchema = z.object({
  id: z.string(),
  bill_id: z.string().nullable(),
  society_id: z.string(),
  flat_id: z.string().nullable(),
  amount: z.coerce.number(),
  method: z.string(),
  status: z.string(),
  reference_no: z.string().nullable(),
  notes: z.string().nullable(),
  submitted_at: z.string().nullable(),
  submitted_by: z.string().nullable(),
  source: z.string().nullable(),
  payment_date: z.string().nullable(),
  verified_at: z.string().nullable(),
  verified_by: z.string().nullable(),
  verification_notes: z.string().nullable(),
  rejected_at: z.string().nullable(),
  rejection_reason: z.string().nullable(),
  reversed_at: z.string().nullable(),
  reversal_reason: z.string().nullable(),
  created_at: z.string(),
});

const residentPaymentSchema = z.object({
  id: z.string(),
  bill_id: z.string().nullable(),
  society_id: z.string(),
  flat_id: z.string().nullable(),
  amount: z.coerce.number(),
  method: z.string(),
  status: z.string(),
  reference_no: z.string().nullable(),
  submitted_at: z.string().nullable(),
  payment_date: z.string().nullable(),
  verified_at: z.string().nullable(),
  rejected_at: z.string().nullable(),
  rejection_reason: z.string().nullable(),
  reversed_at: z.string().nullable(),
  reversal_reason: z.string().nullable(),
  created_at: z.string(),
});

// Stage 3C v8 — split receipt schemas by audience. The resident receipt is
// intentionally the tightest projection possible: only display-safe fields.
// Internal actor UUIDs (verified_by / voided_by) and internal database IDs
// (receipt id, payment_id, society_id) MUST NOT appear on resident payloads.
const adminReceiptSchema = z
  .object({
    id: z.string(),
    payment_id: z.string(),
    society_id: z.string(),
    receipt_number: z.string(),
    issued_at: z.string(),
    status: z.enum(["valid", "void"]),
    voided_at: z.string().nullable(),
    voided_by: z.string().nullable(),
    void_reason: z.string().nullable(),
    amount_snapshot: z.coerce.number().nullable(),
    method_snapshot: z.string().nullable(),
    reference_snapshot: z.string().nullable(),
    bill_number_snapshot: z.string().nullable(),
    verified_by: z.string().nullable(),
    verified_at: z.string().nullable(),
  })
  .strict();

const residentReceiptSchema = z
  .object({
    receipt_number: z.string(),
    status: z.enum(["valid", "void"]),
    issued_at: z.string(),
    voided_at: z.string().nullable(),
    void_reason: z.string().nullable(),
    amount_snapshot: z.coerce.number().nullable(),
    method_snapshot: z.string().nullable(),
    reference_snapshot: z.string().nullable(),
    bill_number_snapshot: z.string().nullable(),
    verified_at: z.string().nullable(),
  })
  .strict();

// Kept for the standalone `get_payment_receipt_lifecycle` admin fetcher.
const receiptLifecycleSchema = adminReceiptSchema;

// Stage 3C v7/v8 — payment detail is a discriminated union by audience.
// Resident-shaped rows use `.strict()` so any admin/internal key surfacing
// (proof_url, submitted_by, verified_by, voided_by, etc.) is rejected loudly
// instead of silently leaking to the browser.
const paymentDetailCommonPaymentSchema = z.object({
  id: z.string(),
  bill_id: z.string().nullable(),
  society_id: z.string(),
  flat_id: z.string().nullable(),
  amount: z.coerce.number(),
  method: z.string(),
  status: z.string(),
  reference_no: z.string().nullable(),
  submitted_at: z.string().nullable(),
  source: z.string().nullable(),
  payment_date: z.string().nullable(),
  verified_at: z.string().nullable(),
  rejected_at: z.string().nullable(),
  rejection_reason: z.string().nullable(),
  reversed_at: z.string().nullable(),
  reversal_reason: z.string().nullable(),
  created_at: z.string(),
});

export const adminDetailPaymentSchema = paymentDetailCommonPaymentSchema
  .extend({
    notes: z.string().nullable(),
    submitted_by: z.string().nullable(),
    verified_by: z.string().nullable(),
    verification_notes: z.string().nullable(),
    rejected_by: z.string().nullable(),
    reversed_by: z.string().nullable(),
  })
  .strict();

export const residentDetailPaymentSchema = paymentDetailCommonPaymentSchema.strict();

export const adminReceiptDetailSchema = adminReceiptSchema;
export const residentReceiptDetailSchema = residentReceiptSchema;

export const adminPaymentDetailSchema = z
  .object({
    audience: z.literal("admin"),
    payment: adminDetailPaymentSchema,
    bill_number: z.string().nullable(),
    flat_label: z.string().nullable(),
    summary: billPaymentSummarySchema.nullable(),
    receipt: adminReceiptSchema.nullable(),
  })
  .strict();

export const residentPaymentDetailSchema = z
  .object({
    audience: z.literal("resident"),
    payment: residentDetailPaymentSchema,
    bill_number: z.string().nullable(),
    flat_label: z.string().nullable(),
    summary: billPaymentSummarySchema.nullable(),
    receipt: residentReceiptSchema.nullable(),
  })
  .strict();

export const paymentDetailSchema = z.discriminatedUnion("audience", [
  adminPaymentDetailSchema,
  residentPaymentDetailSchema,
]);

/**
 * Production parser for a raw `get_payment_detail` RPC payload. Tests call this
 * to exercise the actual schema — never a test-only recreation.
 */
export function parsePaymentDetailResponse(raw: unknown): PaymentDetail {
  return paymentDetailSchema.parse(raw);
}

export interface AdminReceiptDetail {
  id: string;
  payment_id: string;
  society_id: string;
  receipt_number: string;
  issued_at: string;
  status: ReceiptStatus;
  voided_at: string | null;
  voided_by: string | null;
  void_reason: string | null;
  amount_snapshot: number | null;
  method_snapshot: string | null;
  reference_snapshot: string | null;
  bill_number_snapshot: string | null;
  verified_by: string | null;
  verified_at: string | null;
}

export interface ResidentReceiptDetail {
  receipt_number: string;
  status: ReceiptStatus;
  issued_at: string;
  voided_at: string | null;
  void_reason: string | null;
  amount_snapshot: number | null;
  method_snapshot: string | null;
  reference_snapshot: string | null;
  bill_number_snapshot: string | null;
  verified_at: string | null;
}

export interface PaymentDetailAdmin {
  audience: "admin";
  payment: AdminDetailPayment;
  bill_number: string | null;
  flat_label: string | null;
  summary: BillPaymentSummary | null;
  receipt: AdminReceiptDetail | null;
}

export interface PaymentDetailResident {
  audience: "resident";
  payment: ResidentDetailPayment;
  bill_number: string | null;
  flat_label: string | null;
  summary: BillPaymentSummary | null;
  receipt: ResidentReceiptDetail | null;
}

export type PaymentDetail = PaymentDetailAdmin | PaymentDetailResident;

/**
 * Stage 3C READ Sub-run B1 — neutral shared cores.
 *
 * These functions own the single construction of the resident-payment
 * read RPCs (`get_resident_payments_v1`, `get_payment_detail`). Both the
 * public server functions below and the Stage 3C live READ handlers
 * delegate to them so RPC name/arg/parsing behavior cannot drift.
 */

export interface ResidentPaymentsCoreInput {
  readonly limit?: number;
  readonly offset?: number;
}
export interface ResidentPaymentsCoreOutput {
  readonly payments: ResidentPaymentRow[];
}

/**
 * Internal — invoke a resident-facing read RPC directly (bypassing the
 * generic billing `callBillingRpc` error mapping) so canonical
 * authorization codes (`not_authorized`, `unauthenticated`) survive to
 * the outer server-function wrapper's `mapPaymentError` call. Any other
 * provider failure is collapsed to `operation_failed` to avoid leaking
 * raw DB text.
 */
async function callPaymentReadRpc(
  client: BillingRpcClient,
  name: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  const { data, error } = await client.rpc(name, args);
  if (error) {
    const raw = (error.message || "").toLowerCase();
    if (raw.includes("not_authorized")) throw new Error("not_authorized");
    if (raw.includes("unauthenticated")) throw new Error("unauthenticated");
    throw new Error("operation_failed");
  }
  return data;
}

/** Neutral shared core — resident payment history. */
export async function getResidentPaymentsWithClient(
  client: BillingRpcClient,
  input: ResidentPaymentsCoreInput = {},
): Promise<ResidentPaymentsCoreOutput> {
  const limit = input.limit ?? 50;
  const offset = input.offset ?? 0;
  const raw = await callPaymentReadRpc(
    client,
    "get_resident_payments_v1",
    buildRpcArgs({ _limit: limit, _offset: offset }),
  );
  const arr = Array.isArray(raw) ? raw : [];
  const payments: ResidentPaymentRow[] = arr.map((row) =>
    residentPaymentSchema.parse(row),
  );
  return { payments };
}

/** Neutral shared core — payment detail (null for null/undefined raw). */
export async function getPaymentDetailWithClient(
  client: BillingRpcClient,
  input: { paymentId: string },
): Promise<PaymentDetail | null> {
  const raw = await callPaymentReadRpc(
    client,
    "get_payment_detail",
    buildRpcArgs({ _payment_id: input.paymentId }),
  );
  if (raw === null || raw === undefined) return null;
  return parsePaymentDetailResponse(raw);
}

/** Stage 3C v7 — explicit-auth payment detail; discriminated by audience. */
export const getPaymentDetail = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => paymentIdOnly.parse(i))
  .handler(async ({ data, context }) => {
    try {
      return await getPaymentDetailWithClient(toBillingRpcClient(context), {
        paymentId: data.paymentId,
      });
    } catch (e) {
      throw new Error(mapPaymentError((e as Error).message));
    }
  });




export const listSocietyPayments = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => listInput.parse(i))
  .handler(async ({ data, context }) => {
    try {
      const raw = await callBillingRpc(
        toBillingRpcClient(context),
        "list_society_payments_v1",
        buildRpcArgs({
          _society_id: data.societyId,
          _status: data.status,
          _limit: data.limit,
          _offset: data.offset,
        }),
      );
      const arr = Array.isArray(raw) ? raw : [];
      const payments: OfflinePaymentRow[] = arr.map((row) => paymentRowSchema.parse(row));
      return { payments };
    } catch (e) {
      throw new Error(mapPaymentError((e as Error).message));
    }
  });

export const getResidentPayments = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) =>
    z
      .object({
        limit: z.number().int().min(1).max(200).default(50),
        offset: z.number().int().min(0).default(0),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    try {
      return await getResidentPaymentsWithClient(toBillingRpcClient(context), {
        limit: data.limit,
        offset: data.offset,
      });
    } catch (e) {
      throw new Error(mapPaymentError((e as Error).message));
    }
  });


export const getPaymentReceipt = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => paymentIdOnly.parse(i))
  .handler(async ({ data, context }) => {
    try {
      const raw = await callBillingRpc(
        toBillingRpcClient(context),
        "get_payment_receipt_lifecycle",
        buildRpcArgs({ _payment_id: data.paymentId }),
      );
      if (raw === null || raw === undefined) return { receipt: null };
      const receipt: PaymentReceiptLifecycle = receiptLifecycleSchema.parse(raw);
      return { receipt };
    } catch (e) {
      throw new Error(mapPaymentError((e as Error).message));
    }
  });

export const getBillPaymentSummary = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ billId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    try {
      const raw = await callBillingRpc(
        toBillingRpcClient(context),
        "get_bill_payment_summary",
        buildRpcArgs({ _bill_id: data.billId }),
      );
      if (raw === null || raw === undefined) return { summary: null };
      const summary: BillPaymentSummary = billPaymentSummarySchema.parse(raw);
      return { summary };
    } catch (e) {
      throw new Error(mapPaymentError((e as Error).message));
    }
  });

/* --------------------- Admin: bill search for entry ------------------- */

/**
 * Canonical error tokens the search core may raise.
 *
 * `not_authenticated`, `not_authorized` and `invalid_search_input` are
 * raised verbatim by the effective SQL body of
 * `public.search_society_open_bills`; every other failure (provider
 * error, malformed payload, structural violation) collapses to
 * `operation_failed` so raw DB/provider text can never leak.
 */
export const SEARCH_OPEN_BILLS_CANONICAL_ERRORS = Object.freeze({
  not_authenticated: "not_authenticated",
  not_authorized: "not_authorized",
  invalid_search_input: "invalid_search_input",
  operation_failed: "operation_failed",
} as const);

export type SearchOpenBillsCanonicalError =
  (typeof SEARCH_OPEN_BILLS_CANONICAL_ERRORS)[keyof typeof SEARCH_OPEN_BILLS_CANONICAL_ERRORS];

/**
 * The exact input bounds enforced by the SQL body. TypeScript and SQL
 * MUST agree: a value TypeScript rejects must not be silently clamped
 * and accepted by a direct RPC call, and vice versa.
 */
export const SEARCH_OPEN_BILLS_INPUT_BOUNDS = Object.freeze({
  queryMaxLength: 120,
  limitMin: 1,
  limitMax: 50,
  limitDefault: 20,
  offsetMin: 0,
  offsetDefault: 0,
} as const);

/**
 * Bill statuses a search row may legitimately carry. The SQL `WHERE`
 * clause excludes `paid` and `cancelled`; the remaining canonical
 * `bills.status` vocabulary is the accepted set. Anything else is a
 * structural violation of the contract.
 */
export const SEARCH_OPEN_BILL_ALLOWED_STATUSES: readonly string[] = Object.freeze([
  "unpaid",
  "partially_paid",
  "overdue",
]);

/* --------------------------- literal wildcards ------------------------ */

/**
 * Mirror of the SQL escaping performed inside
 * `search_society_open_bills`. The escape character is escaped FIRST,
 * then the two LIKE metacharacters:
 *
 *   replace(q, '\', '\\') -> replace(_, '%', '\%') -> replace(_, '_', '\_')
 *
 * Exported so the SQL contract can be validated directly instead of
 * inferring wildcard behavior from an in-memory `.includes()` engine.
 */
export function escapeSearchLikeLiteral(raw: string): string {
  return raw.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
}

/**
 * The exact `qlike` value the SQL body computes for a raw query, or
 * `null` when the trimmed query is empty (no text predicate at all).
 */
export function buildSearchLikePattern(raw: string): string | null {
  const q = raw.trim();
  if (q === "") return null;
  return `%${escapeSearchLikeLiteral(q)}%`;
}

/* ----------------------------- strict money --------------------------- */

/**
 * PostgREST emits `numeric` either as a JS number or as a decimal
 * string. Nothing else is a legitimate representation, so unrestricted
 * `z.coerce.number()` (which happily turns `null`, `""`, `[]`, `true`
 * and `"0x10"` into numbers) is not acceptable here.
 */
const SEARCH_DECIMAL_PATTERN = /^[+-]?(?:\d+(?:\.\d+)?|\.\d+)$/;

/** Money is stored at 2 decimal places; normalize to avoid FP drift. */
export function normalizeSearchMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Strict monetary acceptance. Returns the normalized finite
 * non-negative number, or `null` when the raw value is not an actual
 * PostgREST numeric representation.
 */
export function parseSearchMoney(raw: unknown): number | null {
  let n: number;
  if (typeof raw === "number") {
    n = raw;
  } else if (typeof raw === "string") {
    if (!SEARCH_DECIMAL_PATTERN.test(raw)) return null;
    n = Number(raw);
  } else {
    return null;
  }
  if (!Number.isFinite(n)) return null;
  const normalized = normalizeSearchMoney(n);
  if (normalized < 0) return null;
  return normalized;
}

const searchMoney = z
  .unknown()
  .transform((v, ctx) => {
    const parsed = parseSearchMoney(v);
    if (parsed === null) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "invalid_money" });
      return z.NEVER;
    }
    return parsed;
  });

/* ------------------------------ row shape ----------------------------- */

/** Strict `YYYY-MM-DD` acceptance — the value must be a real calendar date. */
export function isCanonicalSearchDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split("-").map((p) => Number(p));
  if (y === undefined || m === undefined || d === undefined) return false;
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return (
    dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d
  );
}

const searchDate = z
  .string()
  .refine(isCanonicalSearchDate, { message: "invalid_date" })
  .nullable();

const openBillSchema = z
  .object({
    bill_id: z.string().uuid(),
    bill_number: z.string().nullable(),
    society_id: z.string().uuid(),
    flat_id: z.string().uuid().nullable(),
    flat_label: z.string().nullable(),
    block_name: z.string().nullable(),
    period_label: z.string().nullable(),
    due_date: searchDate,
    status: z.string().refine((s) => SEARCH_OPEN_BILL_ALLOWED_STATUSES.includes(s), {
      message: "invalid_status",
    }),
    total_payable: searchMoney,
    verified_amount: searchMoney,
    pending_amount: searchMoney,
    remaining_verified_balance: searchMoney,
    available_to_submit: searchMoney,
  })
  .strict();

export type OpenBillForPayment = z.infer<typeof openBillSchema>;

/**
 * The exact arithmetic the SQL body performs. A row whose reported
 * balances disagree with these equations is a structural violation and
 * must never reach a caller.
 */
export function searchRowEquationsHold(row: OpenBillForPayment): boolean {
  const expectedRemaining = normalizeSearchMoney(
    Math.max(row.total_payable - row.verified_amount, 0),
  );
  const expectedAvailable = normalizeSearchMoney(
    Math.max(row.total_payable - row.verified_amount - row.pending_amount, 0),
  );
  if (row.remaining_verified_balance !== expectedRemaining) return false;
  if (row.available_to_submit !== expectedAvailable) return false;
  // A verified amount above the bill total is financially impossible.
  if (row.verified_amount > row.total_payable) return false;
  // A search row must carry real headroom; the SQL WHERE clause already
  // filters `available_to_submit <= 0`.
  if (!(row.available_to_submit > 0)) return false;
  return true;
}

/* --------------------------- input contract --------------------------- */

/** Canonical input contract for the search core (shared by fn + tests). */
export const searchOpenBillsInputSchema = z
  .object({
    societyId: z.string().uuid(),
    query: z.string().trim().max(SEARCH_OPEN_BILLS_INPUT_BOUNDS.queryMaxLength).default(""),
    limit: z
      .number()
      .int()
      .min(SEARCH_OPEN_BILLS_INPUT_BOUNDS.limitMin)
      .max(SEARCH_OPEN_BILLS_INPUT_BOUNDS.limitMax)
      .default(SEARCH_OPEN_BILLS_INPUT_BOUNDS.limitDefault),
    offset: z
      .number()
      .int()
      .min(SEARCH_OPEN_BILLS_INPUT_BOUNDS.offsetMin)
      .default(SEARCH_OPEN_BILLS_INPUT_BOUNDS.offsetDefault),
  })
  .strict();

export type SearchOpenBillsInput = z.input<typeof searchOpenBillsInputSchema>;
export type SearchOpenBillsParsedInput = z.output<typeof searchOpenBillsInputSchema>;

export interface SearchOpenBillsOutput {
  readonly bills: readonly OpenBillForPayment[];
}

/**
 * Parse-or-throw with the canonical static token. Never interpolates
 * the offending value, the society id or a Zod issue path.
 */
export function parseSearchOpenBillsInput(input: unknown): SearchOpenBillsParsedInput {
  const parsed = searchOpenBillsInputSchema.safeParse(input);
  if (!parsed.success)
    throw new Error(SEARCH_OPEN_BILLS_CANONICAL_ERRORS.invalid_search_input);
  return parsed.data;
}

/* --------------------------- error mapping ---------------------------- */

/**
 * Bounded canonical tokens the SQL body may raise, matched EXACTLY on a
 * token boundary — never by loose `.includes()`.
 */
const SEARCH_BOUNDED_TOKENS: readonly SearchOpenBillsCanonicalError[] = Object.freeze([
  SEARCH_OPEN_BILLS_CANONICAL_ERRORS.not_authenticated,
  SEARCH_OPEN_BILLS_CANONICAL_ERRORS.not_authorized,
  SEARCH_OPEN_BILLS_CANONICAL_ERRORS.invalid_search_input,
]);

/**
 * Classify a raw provider message into exactly one canonical token.
 *
 * Fails closed:
 *   - a non-string / empty / malformed message -> `operation_failed`
 *   - an unrecognized message                  -> `operation_failed`
 *   - MORE THAN ONE distinct canonical token   -> `operation_failed`
 *
 * Only a message carrying exactly one recognized bounded token maps to
 * that token. Raw provider text is never propagated.
 */
export function classifySearchCanonicalError(raw: unknown): SearchOpenBillsCanonicalError {
  const message = typeof raw === "string" ? raw : "";
  if (message.trim().length === 0)
    return SEARCH_OPEN_BILLS_CANONICAL_ERRORS.operation_failed;
  const lower = message.toLowerCase();
  const matched = new Set<SearchOpenBillsCanonicalError>();
  for (const token of SEARCH_BOUNDED_TOKENS) {
    // Token boundary: not preceded/followed by another identifier char.
    const pattern = new RegExp(`(?<![a-z0-9_])${token}(?![a-z0-9_])`);
    if (pattern.test(lower)) matched.add(token);
  }
  if (matched.size !== 1) return SEARCH_OPEN_BILLS_CANONICAL_ERRORS.operation_failed;
  const [only] = [...matched];
  return only ?? SEARCH_OPEN_BILLS_CANONICAL_ERRORS.operation_failed;
}

/** Extract a provider error message without trusting its shape. */
function searchProviderMessage(error: unknown): string {
  if (typeof error === "string") return error;
  if (error && typeof error === "object" && "message" in error) {
    const m = (error as { message?: unknown }).message;
    if (typeof m === "string") return m;
  }
  return "";
}

/* ------------------------- payload acceptance ------------------------- */

/** Freeze the output object, the array, and every row. */
function freezeSearchOutput(bills: OpenBillForPayment[]): SearchOpenBillsOutput {
  for (const bill of bills) Object.freeze(bill);
  Object.freeze(bills);
  return Object.freeze({ bills });
}

/**
 * Structural acceptance of a decoded search payload. Fails closed on:
 *   - a non-array payload (including `null` / `undefined` / an object);
 *   - any row failing the strict row schema (unknown key, bad UUID,
 *     bad date, non-canonical status, non-numeric money);
 *   - duplicate `bill_id` values (the SQL body groups by bill);
 *   - a row belonging to a society other than the requested one;
 *   - any row whose balance arithmetic disagrees with the SQL body,
 *     including a row with no headroom.
 *
 * Every rejection raises the single opaque `operation_failed` token — no
 * row content, id or provider text is ever interpolated. Returned rows
 * are detached from the provider payload (Zod produces fresh objects)
 * and deeply frozen.
 */
export function acceptSearchOpenBillsPayload(
  societyId: string,
  raw: unknown,
): SearchOpenBillsOutput {
  if (!Array.isArray(raw)) throw new Error(SEARCH_OPEN_BILLS_CANONICAL_ERRORS.operation_failed);
  const bills: OpenBillForPayment[] = [];
  const seen = new Set<string>();
  for (const row of raw) {
    const parsed = openBillSchema.safeParse(row);
    if (!parsed.success) throw new Error(SEARCH_OPEN_BILLS_CANONICAL_ERRORS.operation_failed);
    const bill = parsed.data;
    if (bill.society_id !== societyId)
      throw new Error(SEARCH_OPEN_BILLS_CANONICAL_ERRORS.operation_failed);
    if (seen.has(bill.bill_id))
      throw new Error(SEARCH_OPEN_BILLS_CANONICAL_ERRORS.operation_failed);
    if (!searchRowEquationsHold(bill))
      throw new Error(SEARCH_OPEN_BILLS_CANONICAL_ERRORS.operation_failed);
    seen.add(bill.bill_id);
    bills.push(bill);
  }
  return freezeSearchOutput(bills);
}

/**
 * Neutral shared core — admin open-bill search.
 *
 * Owns the single construction of the `search_society_open_bills` RPC
 * call (name, argument names, pagination defaults, payload acceptance).
 * Both the public server function below and the Stage 3C live SEARCH
 * handlers delegate here so behavior cannot drift between production and
 * the acceptance matrix.
 */
export async function searchSocietyOpenBillsWithClient(
  client: BillingRpcClient,
  input: SearchOpenBillsInput,
): Promise<SearchOpenBillsOutput> {
  const { societyId, query, limit, offset } = parseSearchOpenBillsInput(input);
  let result: { data: unknown; error: { message: string } | null };
  try {
    result = await client.rpc(
      "search_society_open_bills",
      buildRpcArgs({
        _society_id: societyId,
        _query: query,
        _limit: limit,
        _offset: offset,
      }),
    );
  } catch (e) {
    throw new Error(classifySearchCanonicalError(searchProviderMessage(e)));
  }
  if (result.error) {
    throw new Error(classifySearchCanonicalError(searchProviderMessage(result.error)));
  }
  return acceptSearchOpenBillsPayload(societyId, result.data);
}

/**
 * Stage 3C v6 — Admin bill search for offline payment entry. Server-side
 * authorization requires the canonical `billing.manage` capability (or
 * super_admin). Returns the same verified / pending / available balances
 * as `get_bill_payment_summary` — the admin form never relies on the raw
 * bill total.
 */
export const searchOpenBillsForPayment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => parseSearchOpenBillsInput(i))
  .handler(async ({ data, context }) => {
    try {
      return await searchSocietyOpenBillsWithClient(toBillingRpcClient(context), data);
    } catch (e) {
      throw new Error(mapPaymentError((e as Error).message));
    }
  });



