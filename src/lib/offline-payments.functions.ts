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
 * All writes go through SECURITY DEFINER RPCs. This file exposes:
 *   - submitOfflinePayment: resident-of-flat OR billing.manage admin.
 *   - verifyOfflinePayment / rejectOfflinePayment / reverseOfflinePayment: admin only.
 *   - listOfflinePayments (admin), getResidentPayments (resident own flats).
 *   - getPaymentDetail (server-authorized read).
 *
 * No online gateway, UPI, cards, wallets, Razorpay, PayU, Cashfree.
 * Legacy `success` payment rows are readable via the same read helpers
 * but cannot be transitioned by any of these RPCs (invalid_transition).
 */

export type OfflinePaymentStatus =
  | "pending"
  | "verified"
  | "rejected"
  | "reversed"
  | "success"; // legacy read-only

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
  proof_url: string | null;
  verified_at: string | null;
  verified_by: string | null;
  verification_notes: string | null;
  rejected_at: string | null;
  rejection_reason: string | null;
  reversed_at: string | null;
  reversal_reason: string | null;
  created_at: string;
}

export interface PaymentReceiptRow {
  id: string;
  payment_id: string;
  society_id: string;
  receipt_number: string;
  issued_at: string;
}

/** Extend billing mapError with Stage 3C codes. Never leaks raw DB messages. */
export function mapPaymentError(msg: string): string {
  const m = (msg || "").toLowerCase();
  if (m.includes("invalid_method")) return "Only Cash and Bank Transfer are supported.";
  if (m.includes("invalid_amount")) return "Enter a valid payment amount.";
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

const submitInput = z.object({
  billId: z.string().uuid(),
  method: z.enum(["cash", "bank_transfer"]),
  amount: z.number().positive().max(10_000_000),
  paymentDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  referenceNo: z.string().trim().max(120).nullable().optional(),
  notes: z.string().trim().max(1000).nullable().optional(),
  proofUrl: z.string().trim().max(1000).url().nullable().optional(),
  idempotencyKey: z.string().trim().min(6).max(120),
});

const paymentIdOnly = z.object({ paymentId: z.string().uuid() });
const paymentWithReason = paymentIdOnly.extend({ reason: z.string().trim().min(1).max(500) });
const paymentWithOptionalNotes = paymentIdOnly.extend({
  notes: z.string().trim().max(500).nullable().optional(),
});

/* ------------------------------ Writes ------------------------------- */

export const submitOfflinePayment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => submitInput.parse(i))
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
          _proof_url: data.proofUrl ?? null,
          _idempotency_key: data.idempotencyKey,
        }),
      );
      return { paymentId: extractRpcId(raw) };
    } catch (e) {
      throw new Error(mapPaymentError((e as Error).message));
    }
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
      const obj = (raw ?? {}) as {
        payment_id?: string;
        receipt_number?: string;
        receipt_id?: string;
      };
      return {
        paymentId: obj.payment_id ?? data.paymentId,
        receiptNumber: obj.receipt_number ?? null,
        receiptId: obj.receipt_id ?? null,
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

/* ------------------------------ Reads ------------------------------- */

type SupabaseRead = {
  from: (table: string) => {
    select: (cols: string) => any;
  };
};

export const listSocietyPayments = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) =>
    z
      .object({
        societyId: z.string().uuid(),
        status: z.enum(["pending", "verified", "rejected", "reversed", "all"]).default("pending"),
        limit: z.number().int().min(1).max(200).default(50),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    const sb = context.supabase as unknown as SupabaseRead;
    let q = sb
      .from("payments")
      .select(
        "id, bill_id, society_id, flat_id, amount, method, status, reference_no, notes, submitted_at, submitted_by, source, payment_date, proof_url, verified_at, verified_by, verification_notes, rejected_at, rejection_reason, reversed_at, reversal_reason, created_at",
      )
      .eq("society_id", data.societyId)
      .order("submitted_at", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false })
      .limit(data.limit);
    if (data.status !== "all") q = q.eq("status", data.status);
    const { data: rows, error } = await q;
    if (error) throw new Error(mapPaymentError(error.message));
    return { payments: (rows ?? []) as OfflinePaymentRow[] };
  });

export const getPaymentReceipt = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => paymentIdOnly.parse(i))
  .handler(async ({ data, context }) => {
    const sb = context.supabase as unknown as SupabaseRead;
    const { data: rec, error } = await sb
      .from("payment_receipts")
      .select("id, payment_id, society_id, receipt_number, issued_at")
      .eq("payment_id", data.paymentId)
      .maybeSingle();
    if (error) throw new Error(mapPaymentError(error.message));
    return { receipt: (rec ?? null) as PaymentReceiptRow | null };
  });
