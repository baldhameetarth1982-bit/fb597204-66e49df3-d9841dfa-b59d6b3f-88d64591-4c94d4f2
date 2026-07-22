/**
 * Stage 3C — Live core context (AUTH + PENDING + VERIFY).
 *
 * Strictly typed lifecycle state for the current 24-case core matrix.
 * Every field is initialized only by an earlier explicit case. Guard
 * helpers throw a labeled error when a required prior state is absent
 * so tests never quietly consume `undefined` fixture state.
 */
import { z } from "zod";
import type { Stage3CFixture } from "./stage3c-runtime-fixtures";

const NonNegativeFinite = z
  .number()
  .refine((n) => Number.isFinite(n) && n >= 0, "must be a finite non-negative number");

const BillSummarySchema = z
  .object({
    pending_amount: z.union([z.number(), z.string()]).transform((v) => Number(v)),
    verified_amount: z.union([z.number(), z.string()]).transform((v) => Number(v)),
    available_to_submit: z.union([z.number(), z.string()]).transform((v) => Number(v)),
    total_payable: z.union([z.number(), z.string()]).transform((v) => Number(v)),
  })
  .transform((v) => ({
    pending_amount: NonNegativeFinite.parse(v.pending_amount),
    verified_amount: NonNegativeFinite.parse(v.verified_amount),
    available_to_submit: NonNegativeFinite.parse(v.available_to_submit),
    total_payable: NonNegativeFinite.parse(v.total_payable),
  }));

export type BillSummarySnapshot = z.infer<typeof BillSummarySchema>;

const OpenBillRowSchema = z.object({
  bill_id: z.string().uuid(),
});
export type OpenBillRow = z.infer<typeof OpenBillRowSchema>;

const PaymentAssertionRowSchema = z.object({
  society_id: z.string().uuid(),
  flat_id: z.string().uuid(),
  bill_id: z.string().uuid(),
  method: z.string().min(1),
  submitted_by: z.string().uuid(),
  status: z.string().min(1).optional(),
});
export type PaymentAssertionRow = z.infer<typeof PaymentAssertionRowSchema>;

const ReceiptAssertionRowSchema = z.object({
  id: z.string().uuid(),
  receipt_number: z.string().regex(/^RCPT\/\d{6}\/\d{4}$/),
  status: z.string().min(1).optional(),
  created_at: z.string().min(1),
});
export type ReceiptAssertionRow = z.infer<typeof ReceiptAssertionRowSchema>;

export function parseBillSummary(raw: unknown, label = "core"): BillSummarySnapshot {
  const parsed = BillSummarySchema.safeParse(raw);
  if (!parsed.success)
    throw new Error(
      `[stage3c:${label}] bill summary payload failed schema: ${parsed.error.issues
        .map((i) => `${i.path.join(".")}:${i.message}`)
        .join("; ")}`,
    );
  return parsed.data;
}

export function parseOpenBillRows(raw: unknown, label = "core"): OpenBillRow[] {
  if (!Array.isArray(raw)) throw new Error(`[stage3c:${label}] open bill payload not an array`);
  return raw.map((r, i) => {
    const p = OpenBillRowSchema.safeParse(r);
    if (!p.success)
      throw new Error(
        `[stage3c:${label}] open bill row ${i} invalid: ${p.error.issues
          .map((s) => s.message)
          .join(";")}`,
      );
    return p.data;
  });
}

export function parsePaymentAssertionRow(raw: unknown, label = "core"): PaymentAssertionRow {
  const p = PaymentAssertionRowSchema.safeParse(raw);
  if (!p.success)
    throw new Error(
      `[stage3c:${label}] payment row invalid: ${p.error.issues
        .map((s) => `${s.path.join(".")}:${s.message}`)
        .join(";")}`,
    );
  return p.data;
}

export function parseReceiptAssertionRow(raw: unknown, label = "core"): ReceiptAssertionRow {
  const p = ReceiptAssertionRowSchema.safeParse(raw);
  if (!p.success)
    throw new Error(
      `[stage3c:${label}] receipt row invalid: ${p.error.issues
        .map((s) => `${s.path.join(".")}:${s.message}`)
        .join(";")}`,
    );
  return p.data;
}

export interface Stage3CLiveCoreContext {
  fixture: Stage3CFixture | null;
  billId: string | null;
  baselineSummary: BillSummarySnapshot | null;
  pendingAmount: number | null;
  pendingPaymentId: string | null;
  postPendingSummary: BillSummarySnapshot | null;
  postVerifySummary: BillSummarySnapshot | null;
  verifiedReceiptId: string | null;
  verifiedReceiptNumber: string | null;
  verifiedReceiptCreatedAt: string | null;
}

export function createStage3CLiveCoreContext(): Stage3CLiveCoreContext {
  return {
    fixture: null,
    billId: null,
    baselineSummary: null,
    pendingAmount: null,
    pendingPaymentId: null,
    postPendingSummary: null,
    postVerifySummary: null,
    verifiedReceiptId: null,
    verifiedReceiptNumber: null,
    verifiedReceiptCreatedAt: null,
  };
}

export function requireFixture(ctx: Stage3CLiveCoreContext): Stage3CFixture {
  if (!ctx.fixture) throw new Error("[stage3c:core] fixture not initialised");
  return ctx.fixture;
}

export function requireBillId(ctx: Stage3CLiveCoreContext): string {
  if (!ctx.billId) throw new Error("[stage3c:core] billId not initialised");
  return ctx.billId;
}

export function requireBaselineSummary(ctx: Stage3CLiveCoreContext): BillSummarySnapshot {
  if (!ctx.baselineSummary)
    throw new Error("[stage3c:core] baselineSummary not captured before PENDING-01");
  return ctx.baselineSummary;
}

export function requirePendingAmount(ctx: Stage3CLiveCoreContext): number {
  if (ctx.pendingAmount === null)
    throw new Error("[stage3c:core] pendingAmount not chosen before PENDING-01");
  return ctx.pendingAmount;
}

export function requirePendingPaymentId(ctx: Stage3CLiveCoreContext): string {
  if (!ctx.pendingPaymentId)
    throw new Error("[stage3c:core] pendingPaymentId not set — PENDING-01 must run first");
  return ctx.pendingPaymentId;
}

export function requirePostPendingSummary(ctx: Stage3CLiveCoreContext): BillSummarySnapshot {
  if (!ctx.postPendingSummary)
    throw new Error("[stage3c:core] postPendingSummary not captured before PENDING-06");
  return ctx.postPendingSummary;
}

export function requirePostVerifySummary(ctx: Stage3CLiveCoreContext): BillSummarySnapshot {
  if (!ctx.postVerifySummary)
    throw new Error("[stage3c:core] postVerifySummary not captured before VERIFY-04");
  return ctx.postVerifySummary;
}

export function requireVerifiedReceiptNumber(ctx: Stage3CLiveCoreContext): string {
  if (!ctx.verifiedReceiptNumber)
    throw new Error("[stage3c:core] verifiedReceiptNumber not set before VERIFY-07");
  return ctx.verifiedReceiptNumber;
}

export function requireVerifiedReceiptCreatedAt(ctx: Stage3CLiveCoreContext): string {
  if (!ctx.verifiedReceiptCreatedAt)
    throw new Error("[stage3c:core] verifiedReceiptCreatedAt not set before VERIFY-07");
  return ctx.verifiedReceiptCreatedAt;
}
