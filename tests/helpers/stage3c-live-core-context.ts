/**
 * Stage 3C — Live core context (AUTH + PENDING + VERIFY).
 *
 * Strictly typed lifecycle state for the current 24-case core matrix.
 * Every field is initialized only by an earlier explicit case. Guard
 * helpers throw a labeled error when a required prior state is absent
 * so tests never quietly consume `undefined` fixture state.
 */
import type { Stage3CFixture } from "./stage3c-runtime-fixtures";

export interface BillSummarySnapshot {
  readonly pending_amount: number;
  readonly verified_amount: number;
  readonly available_to_submit: number;
  readonly total_payable: number;
}

export interface Stage3CLiveCoreContext {
  fixture: Stage3CFixture | null;
  /** The bill the AUTH/PENDING/VERIFY flow allocates against. */
  billId: string | null;
  baselineSummary: BillSummarySnapshot | null;
  /** Amount chosen (deterministic, below baseline available). */
  pendingAmount: number | null;
  pendingPaymentId: string | null;
  postPendingSummary: BillSummarySnapshot | null;
  postVerifySummary: BillSummarySnapshot | null;
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

export function parseBillSummary(raw: unknown): BillSummarySnapshot {
  if (!raw || typeof raw !== "object")
    throw new Error("[stage3c:core] bill summary payload is not an object");
  const r = raw as Record<string, unknown>;
  const num = (k: string) => {
    const v = r[k];
    if (v === null || v === undefined)
      throw new Error(`[stage3c:core] bill summary missing ${k}`);
    const n = typeof v === "number" ? v : Number(v);
    if (!Number.isFinite(n)) throw new Error(`[stage3c:core] bill summary ${k} not numeric`);
    return n;
  };
  return {
    pending_amount: num("pending_amount"),
    verified_amount: num("verified_amount"),
    available_to_submit: num("available_to_submit"),
    total_payable: num("total_payable"),
  };
}
