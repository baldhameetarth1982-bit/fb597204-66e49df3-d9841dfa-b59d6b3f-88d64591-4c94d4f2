import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  buildRpcArgs,
  callBillingRpc,
  extractRpcId,
  mapError,
  toBillingRpcClient,
} from "./billing-config.functions";

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
const residentSubmitInput = z.object({
  billId: z.string().uuid(),
  amount: z.number().positive().max(10_000_000),
  paymentDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  referenceNo: z.string().trim().min(1).max(120),
  notes: z.string().trim().max(1000).nullable().optional(),
  idempotencyKey: z.string().trim().min(6).max(120),
});

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



/** Stage 3C v4 — resident Bank Transfer only. Method/actor fixed server-side. */
export const submitResidentBankTransfer = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => residentSubmitInput.parse(i))
  .handler(async ({ data, context }) => {
    try {
      const raw = await callBillingRpc(
        toBillingRpcClient(context),
        "submit_offline_payment",
        buildRpcArgs({
          _bill_id: data.billId,
          _method: "bank_transfer",
          _amount: data.amount,
          _payment_date: data.paymentDate ?? null,
          _reference_no: data.referenceNo,
          _notes: data.notes ?? null,
          _idempotency_key: data.idempotencyKey,
          _actor_role: "resident",
        }),
      );
      return { paymentId: extractRpcId(raw) };
    } catch (e) {
      throw new Error(mapPaymentError((e as Error).message));
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

const verifyPaymentResultSchema = z.object({
  payment_id: z.string().optional(),
  receipt_number: z.string().nullable().optional(),
  receipt_id: z.string().nullable().optional(),
});

export const verifyOfflinePayment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => paymentWithOptionalNotes.parse(i))
  .handler(async ({ data, context }) => {
    try {
      const raw = await callBillingRpc(
        toBillingRpcClient(context),
        "verify_offline_payment",
        buildRpcArgs({ _payment_id: data.paymentId, _notes: data.notes ?? null }),
      );
      const parsed = verifyPaymentResultSchema.parse(raw ?? {});
      return {
        paymentId: parsed.payment_id ?? data.paymentId,
        receiptNumber: parsed.receipt_number ?? null,
        receiptId: parsed.receipt_id ?? null,
      };
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

const receiptLifecycleSchema = z.object({
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
});

// Stage 3C v7 — payment detail is a discriminated union by audience.
// Resident-shaped rows are validated with `.strict()` so any admin/internal
// key surfacing (e.g. proof_url, submitted_by) is rejected loudly instead of
// silently leaking to the browser.
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

const paymentDetailAdminPaymentSchema = paymentDetailCommonPaymentSchema
  .extend({
    notes: z.string().nullable(),
    submitted_by: z.string().nullable(),
    verified_by: z.string().nullable(),
    verification_notes: z.string().nullable(),
    rejected_by: z.string().nullable(),
    reversed_by: z.string().nullable(),
  })
  .strict();

const paymentDetailResidentPaymentSchema = paymentDetailCommonPaymentSchema.strict();

const paymentDetailAdminSchema = z
  .object({
    audience: z.literal("admin"),
    payment: paymentDetailAdminPaymentSchema,
    bill_number: z.string().nullable(),
    flat_label: z.string().nullable(),
    summary: billPaymentSummarySchema.nullable(),
    receipt: receiptLifecycleSchema.nullable(),
  })
  .strict();

const paymentDetailResidentSchema = z
  .object({
    audience: z.literal("resident"),
    payment: paymentDetailResidentPaymentSchema,
    bill_number: z.string().nullable(),
    flat_label: z.string().nullable(),
    summary: billPaymentSummarySchema.nullable(),
    receipt: receiptLifecycleSchema.nullable(),
  })
  .strict();

const paymentDetailSchema = z.discriminatedUnion("audience", [
  paymentDetailAdminSchema,
  paymentDetailResidentSchema,
]);

export interface PaymentDetailAdmin {
  audience: "admin";
  payment: AdminDetailPayment;
  bill_number: string | null;
  flat_label: string | null;
  summary: BillPaymentSummary | null;
  receipt: PaymentReceiptLifecycle | null;
}

export interface PaymentDetailResident {
  audience: "resident";
  payment: ResidentDetailPayment;
  bill_number: string | null;
  flat_label: string | null;
  summary: BillPaymentSummary | null;
  receipt: PaymentReceiptLifecycle | null;
}

export type PaymentDetail = PaymentDetailAdmin | PaymentDetailResident;

/** Stage 3C v7 — explicit-auth payment detail; discriminated by audience. */
export const getPaymentDetail = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => paymentIdOnly.parse(i))
  .handler(async ({ data, context }) => {
    try {
      const raw = await callBillingRpc(
        toBillingRpcClient(context),
        "get_payment_detail",
        buildRpcArgs({ _payment_id: data.paymentId }),
      );
      if (raw === null || raw === undefined) return null;
      const parsed = paymentDetailSchema.parse(raw);
      const detail: PaymentDetail = parsed;
      return detail;
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
      const raw = await callBillingRpc(
        toBillingRpcClient(context),
        "get_resident_payments_v1",
        buildRpcArgs({ _limit: data.limit, _offset: data.offset }),
      );
      const arr = Array.isArray(raw) ? raw : [];
      const payments: ResidentPaymentRow[] = arr.map((row) => residentPaymentSchema.parse(row));
      return { payments };
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

const openBillSchema = z.object({
  bill_id: z.string(),
  bill_number: z.string().nullable(),
  society_id: z.string(),
  flat_id: z.string().nullable(),
  flat_label: z.string().nullable(),
  block_name: z.string().nullable(),
  period_label: z.string().nullable(),
  due_date: z.string().nullable(),
  status: z.string(),
  total_payable: z.coerce.number(),
  verified_amount: z.coerce.number(),
  pending_amount: z.coerce.number(),
  remaining_verified_balance: z.coerce.number(),
  available_to_submit: z.coerce.number(),
});

export type OpenBillForPayment = z.infer<typeof openBillSchema>;

/**
 * Stage 3C v6 — Admin bill search for offline payment entry. Server-side
 * authorization requires the canonical `billing.manage` capability (or
 * super_admin). Returns the same verified / pending / available balances
 * as `get_bill_payment_summary` — the admin form never relies on the raw
 * bill total.
 */
export const searchOpenBillsForPayment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) =>
    z
      .object({
        societyId: z.string().uuid(),
        query: z.string().trim().max(120).default(""),
        limit: z.number().int().min(1).max(50).default(20),
        offset: z.number().int().min(0).default(0),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    try {
      const raw = await callBillingRpc(
        toBillingRpcClient(context),
        "search_society_open_bills",
        buildRpcArgs({
          _society_id: data.societyId,
          _query: data.query,
          _limit: data.limit,
          _offset: data.offset,
        }),
      );
      const arr = Array.isArray(raw) ? raw : [];
      const bills: OpenBillForPayment[] = arr.map((r) => openBillSchema.parse(r));
      return { bills };
    } catch (e) {
      throw new Error(mapPaymentError((e as Error).message));
    }
  });

