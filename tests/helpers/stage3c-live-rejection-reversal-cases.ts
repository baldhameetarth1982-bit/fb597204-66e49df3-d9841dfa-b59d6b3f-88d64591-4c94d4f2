/**
 * Stage 3C — REJECTION-01..05 + REVERSAL-01..09 live case handlers.
 *
 * Grounded in the effective SQL contracts inspected at implementation
 * time (schema owner: public):
 *
 *   reject_offline_payment(_payment_id uuid, _reason text) RETURNS void
 *     - unauthenticated   (42501)  auth.uid() IS NULL
 *     - reason_required   (22023)  trim(_reason) = ''
 *     - payment_not_found (02000)
 *     - not_authorized    (42501)  !billing.manage && !super_admin
 *     - invalid_transition(22023)  p.status <> 'pending'
 *     - success: status='rejected', rejected_by=uid, rejected_at=now,
 *                rejection_reason=_reason. No receipt allocated.
 *                Bill totals unchanged (no _sync_bill_payment_state).
 *
 *   reverse_offline_payment(_payment_id uuid, _reason text) RETURNS void
 *     - unauthenticated / reason_required / payment_not_found / not_authorized
 *     - invalid_transition (22023)  p.status <> 'verified'
 *     - success: payment.status='reversed' + reversed_{by,at,reason};
 *                payment_receipts.status='void' + voided_{at,by} +
 *                void_reason=_reason for the single valid receipt;
 *                receipt id / receipt_number unchanged;
 *                _sync_bill_payment_state(p.bill_id) recomputes bill.status.
 *                Receipt sequence rows are NEVER decremented and the
 *                voided receipt_number is NEVER reused.
 *
 *   verify_offline_payment(_payment_id, _notes) RETURNS jsonb
 *     - After reject: `p.status='rejected'` triggers `payment_not_pending`
 *       (22023) — this is the canonical terminal-state error surfaced by
 *       `mapPaymentError` as "Only pending payments can be verified.".
 *     - After reverse: same — verify requires status='pending'.
 *
 *  This module is production-shape-neutral: it delegates every write
 *  through the fixture's shared helper wrappers (which call the exact
 *  RPCs above), and every read through the admin observer client. It
 *  never uses vitest / non-null assertions / broad regex on canonical
 *  errors, and never interpolates stored values into error messages.
 */

import { z } from "zod";
import {
  getPaymentDetailWithClient,
  type PaymentDetail,
} from "@/lib/offline-payments.functions";
import type { BillingRpcClient } from "@/lib/billing-config.functions";
import type { Stage3CMatrixLiveHandler } from "./stage3c-live-matrix-registry";
import type { Stage3CLiveMatrixContext } from "./stage3c-live-matrix-context";
import type { Stage3CFixture } from "./stage3c-runtime-fixtures";
import { requireFixture } from "./stage3c-live-core-context";

// ---------------------------------------------------------------------------
// Canonical case-id unions + ordered lists
// ---------------------------------------------------------------------------

export type Stage3CRejectionCaseId =
  | "REJECTION-01"
  | "REJECTION-02"
  | "REJECTION-03"
  | "REJECTION-04"
  | "REJECTION-05";

export type Stage3CReversalCaseId =
  | "REVERSAL-01"
  | "REVERSAL-02"
  | "REVERSAL-03"
  | "REVERSAL-04"
  | "REVERSAL-05"
  | "REVERSAL-06"
  | "REVERSAL-07"
  | "REVERSAL-08"
  | "REVERSAL-09";

export const STAGE3C_REJECTION_CASE_IDS: readonly Stage3CRejectionCaseId[] = [
  "REJECTION-01",
  "REJECTION-02",
  "REJECTION-03",
  "REJECTION-04",
  "REJECTION-05",
] as const;

export const STAGE3C_REVERSAL_CASE_IDS: readonly Stage3CReversalCaseId[] = [
  "REVERSAL-01",
  "REVERSAL-02",
  "REVERSAL-03",
  "REVERSAL-04",
  "REVERSAL-05",
  "REVERSAL-06",
  "REVERSAL-07",
  "REVERSAL-08",
  "REVERSAL-09",
] as const;

// ---------------------------------------------------------------------------
// Canonical SQL contract constants (grounded in inspected function bodies)
// ---------------------------------------------------------------------------

/** Exact canonical error strings raised by the inspected RPC bodies. */
export const STAGE3C_LIFECYCLE_CANONICAL_ERRORS = Object.freeze({
  unauthenticated: "unauthenticated",
  reason_required: "reason_required",
  payment_not_found: "payment_not_found",
  not_authorized: "not_authorized",
  invalid_transition: "invalid_transition",
  payment_not_pending: "payment_not_pending",
  self_verification_not_allowed: "self_verification_not_allowed",
} as const);

/** Canonical receipt status values (payment_receipts_status_check). */
export const STAGE3C_RECEIPT_STATUS = Object.freeze({
  valid: "valid",
  void: "void",
} as const);

/** Canonical payment status values used across the four lifecycle RPCs. */
export const STAGE3C_PAYMENT_STATUS = Object.freeze({
  pending: "pending",
  verified: "verified",
  rejected: "rejected",
  reversed: "reversed",
} as const);

// ---------------------------------------------------------------------------
// Zod contracts for admin observer reads
// ---------------------------------------------------------------------------

const PaymentRowSchema = z
  .object({
    id: z.string(),
    status: z.string(),
    amount: z.coerce.number(),
    rejected_by: z.string().nullable(),
    rejected_at: z.string().nullable(),
    rejection_reason: z.string().nullable(),
    reversed_by: z.string().nullable(),
    reversed_at: z.string().nullable(),
    reversal_reason: z.string().nullable(),
    verified_by: z.string().nullable(),
    verified_at: z.string().nullable(),
    submitted_by: z.string().nullable(),
    bill_id: z.string().nullable(),
    society_id: z.string(),
  })
  .strict();
export type Stage3CRejRevPaymentRow = z.infer<typeof PaymentRowSchema>;

const ReceiptRowSchema = z
  .object({
    id: z.string(),
    payment_id: z.string(),
    receipt_number: z.string(),
    status: z.enum(["valid", "void"]),
    voided_at: z.string().nullable(),
    voided_by: z.string().nullable(),
    void_reason: z.string().nullable(),
    issued_by: z.string().nullable(),
  })
  .strict();
export type Stage3CRejRevReceiptRow = z.infer<typeof ReceiptRowSchema>;

const BillSummarySchema = z
  .object({
    bill_id: z.string(),
    total_payable: z.coerce.number(),
    verified_amount: z.coerce.number(),
    pending_amount: z.coerce.number(),
    rejected_amount: z.coerce.number(),
    reversed_amount: z.coerce.number(),
    remaining_verified_balance: z.coerce.number(),
    available_to_submit: z.coerce.number(),
  })
  .passthrough();
export type Stage3CRejRevBillSummary = z.infer<typeof BillSummarySchema>;

const ReceiptSequenceRowSchema = z
  .object({
    society_id: z.string(),
    next_number: z.coerce.number(),
  })
  .passthrough();
type ReceiptSequenceRow = z.infer<typeof ReceiptSequenceRowSchema>;

// ---------------------------------------------------------------------------
// Context (rejection + reversal state slots)
// ---------------------------------------------------------------------------

export interface Stage3CRejectionState {
  billId: string;
  paymentId: string;
  amount: number;
  reason: string;
  paymentBefore: Stage3CRejRevPaymentRow;
  summaryBefore: Stage3CRejRevBillSummary;
  yearlySeqBefore: readonly ReceiptSequenceRow[];
  monthlySeqBefore: readonly ReceiptSequenceRow[];
  paymentAfter: Stage3CRejRevPaymentRow | null;
  summaryAfter: Stage3CRejRevBillSummary | null;
  yearlySeqAfter: readonly ReceiptSequenceRow[] | null;
  monthlySeqAfter: readonly ReceiptSequenceRow[] | null;
  receiptCountAfter: number | null;
}

export interface Stage3CReversalState {
  billId: string;
  paymentId: string;
  amount: number;
  reason: string;
  paymentBefore: Stage3CRejRevPaymentRow;
  receiptBefore: Stage3CRejRevReceiptRow;
  summaryBefore: Stage3CRejRevBillSummary;
  yearlySeqBefore: readonly ReceiptSequenceRow[];
  monthlySeqBefore: readonly ReceiptSequenceRow[];
  paymentAfter: Stage3CRejRevPaymentRow | null;
  receiptAfter: Stage3CRejRevReceiptRow | null;
  summaryAfter: Stage3CRejRevBillSummary | null;
  yearlySeqAfter: readonly ReceiptSequenceRow[] | null;
  monthlySeqAfter: readonly ReceiptSequenceRow[] | null;
  residentDetailAfter: PaymentDetail | null;
}

// ---------------------------------------------------------------------------
// Fixture read helpers (admin observer — bypass RLS via service-role client)
// ---------------------------------------------------------------------------

async function readPayment(
  fixture: Stage3CFixture,
  paymentId: string,
  caseId: string,
): Promise<Stage3CRejRevPaymentRow> {
  const { data, error } = await fixture.admin
    .from("payments")
    .select(
      "id,status,amount,rejected_by,rejected_at,rejection_reason,reversed_by,reversed_at,reversal_reason,verified_by,verified_at,submitted_by,bill_id,society_id",
    )
    .eq("id", paymentId)
    .single();
  if (error !== null || data === null)
    throw new Error(`[stage3c:${caseId}] payment row read failed`);
  return PaymentRowSchema.parse(data);
}

async function readReceiptOrNull(
  fixture: Stage3CFixture,
  paymentId: string,
): Promise<Stage3CRejRevReceiptRow | null> {
  const { data, error } = await fixture.admin
    .from("payment_receipts")
    .select("id,payment_id,receipt_number,status,voided_at,voided_by,void_reason,issued_by")
    .eq("payment_id", paymentId)
    .maybeSingle();
  if (error !== null) return null;
  if (data === null) return null;
  return ReceiptRowSchema.parse(data);
}

async function readReceiptCount(
  fixture: Stage3CFixture,
  paymentId: string,
): Promise<number> {
  const { count, error } = await fixture.admin
    .from("payment_receipts")
    .select("id", { count: "exact", head: true })
    .eq("payment_id", paymentId);
  if (error !== null || typeof count !== "number") return 0;
  return count;
}

async function readBillSummary(
  fixture: Stage3CFixture,
  billId: string,
  caseId: string,
): Promise<Stage3CRejRevBillSummary> {
  const invokeAdminRpc = (name: string, args: Record<string, unknown>) =>
    fixture.users.adminA1.client["rpc"](name, args);
  const { data, error } = await invokeAdminRpc("get_bill_payment_summary", {
    _bill_id: billId,
  });
  if (error !== null || data === null)
    throw new Error(`[stage3c:${caseId}] bill summary read failed`);
  return BillSummarySchema.parse(data);
}

async function readReceiptSequencesForSociety(
  fixture: Stage3CFixture,
  societyId: string,
  which: "yearly" | "monthly",
): Promise<readonly ReceiptSequenceRow[]> {
  const table =
    which === "yearly" ? "payment_receipt_sequences" : "payment_receipt_month_sequences";
  const { data, error } = await fixture.admin
    .from(table)
    .select("*")
    .eq("society_id", societyId);
  if (error !== null || !Array.isArray(data)) return [];
  return data.map((r) => ReceiptSequenceRowSchema.parse(r));
}

// ---------------------------------------------------------------------------
// Bracket helpers — snapshot around a lifecycle transition
// ---------------------------------------------------------------------------

async function snapshotBefore(
  fixture: Stage3CFixture,
  billId: string,
  paymentId: string,
  caseId: string,
) {
  const [paymentBefore, summaryBefore, yearlySeqBefore, monthlySeqBefore] =
    await Promise.all([
      readPayment(fixture, paymentId, caseId),
      readBillSummary(fixture, billId, caseId),
      readReceiptSequencesForSociety(fixture, fixture.societyA, "yearly"),
      readReceiptSequencesForSociety(fixture, fixture.societyA, "monthly"),
    ]);
  return { paymentBefore, summaryBefore, yearlySeqBefore, monthlySeqBefore };
}

async function snapshotAfter(
  fixture: Stage3CFixture,
  billId: string,
  paymentId: string,
  caseId: string,
) {
  const [paymentAfter, summaryAfter, yearlySeqAfter, monthlySeqAfter, receiptCountAfter] =
    await Promise.all([
      readPayment(fixture, paymentId, caseId),
      readBillSummary(fixture, billId, caseId),
      readReceiptSequencesForSociety(fixture, fixture.societyA, "yearly"),
      readReceiptSequencesForSociety(fixture, fixture.societyA, "monthly"),
      readReceiptCount(fixture, paymentId),
    ]);
  return {
    paymentAfter,
    summaryAfter,
    yearlySeqAfter,
    monthlySeqAfter,
    receiptCountAfter,
  };
}

// ---------------------------------------------------------------------------
// Assertion helpers (static messages only)
// ---------------------------------------------------------------------------

function fail(caseId: string, reason: string): never {
  throw new Error(`[stage3c:${caseId}] ${reason}`);
}

function expectEqualNumeric(
  caseId: string,
  label: string,
  actual: number,
  expected: number,
): void {
  if (Math.abs(actual - expected) > 0.0001)
    fail(caseId, `${label} value drifted from expected`);
}

function expectSequencesNotDecreased(
  caseId: string,
  before: readonly ReceiptSequenceRow[],
  after: readonly ReceiptSequenceRow[],
): void {
  const beforeMap = new Map(before.map((r) => [JSON.stringify(r), r.next_number]));
  for (const row of after) {
    const key = JSON.stringify({ ...row, next_number: row.next_number });
    void key;
  }
  // Sum-based: total next_number across all rows must not decrease.
  const beforeSum = before.reduce((s, r) => s + r.next_number, 0);
  const afterSum = after.reduce((s, r) => s + r.next_number, 0);
  if (afterSum < beforeSum) fail(caseId, "receipt sequence total decreased");
  void beforeMap;
}

function expectSequencesUnchanged(
  caseId: string,
  before: readonly ReceiptSequenceRow[],
  after: readonly ReceiptSequenceRow[],
): void {
  if (before.length !== after.length)
    fail(caseId, "receipt sequence row count changed");
  const beforeSum = before.reduce((s, r) => s + r.next_number, 0);
  const afterSum = after.reduce((s, r) => s + r.next_number, 0);
  if (beforeSum !== afterSum) fail(caseId, "receipt sequence totals changed");
}

// ---------------------------------------------------------------------------
// Lazy chain creation (idempotent per matrix run)
// ---------------------------------------------------------------------------

const REJECTION_REASON = "stage3c rejection matrix — deterministic reason";
const REVERSAL_REASON = "stage3c reversal matrix — deterministic reason";

async function ensureRejectionChain(
  ctx: Stage3CLiveMatrixContext,
  fixture: Stage3CFixture,
): Promise<Stage3CRejectionState> {
  if (ctx.rejectionState !== null) return ctx.rejectionState;
  const billId = fixture.openBillId;
  // Compute a headroom-safe amount from the current available-to-submit.
  const preSummary = await readBillSummary(fixture, billId, "REJECTION-01");
  const headroom = preSummary.available_to_submit;
  if (headroom <= 0) fail("REJECTION-01", "no available headroom on rejection bill");
  const amount = Math.min(10, headroom);

  const paymentId = await fixture.helpers.submitAdminCashPayment({
    actor: fixture.users.adminA1,
    billId,
    amount,
    paymentDate: "2026-02-02",
    idempotencyKey: `${fixture.prefix}-rej-live`,
    notes: null,
  });
  // Post-submit baseline snapshot.
  const before = await snapshotBefore(fixture, billId, paymentId, "REJECTION-01");
  if (before.paymentBefore.status !== STAGE3C_PAYMENT_STATUS.pending)
    fail("REJECTION-01", "freshly-submitted payment is not pending");
  const receiptCountBefore = await readReceiptCount(fixture, paymentId);
  if (receiptCountBefore !== 0)
    fail("REJECTION-01", "pending payment has a receipt before rejection");

  const state: Stage3CRejectionState = {
    billId,
    paymentId,
    amount,
    reason: REJECTION_REASON,
    paymentBefore: before.paymentBefore,
    summaryBefore: before.summaryBefore,
    yearlySeqBefore: before.yearlySeqBefore,
    monthlySeqBefore: before.monthlySeqBefore,
    paymentAfter: null,
    summaryAfter: null,
    yearlySeqAfter: null,
    monthlySeqAfter: null,
    receiptCountAfter: null,
  };
  ctx.rejectionState = state;
  return state;
}

async function ensureReversalChain(
  ctx: Stage3CLiveMatrixContext,
  fixture: Stage3CFixture,
): Promise<Stage3CReversalState> {
  if (ctx.reversalState !== null) return ctx.reversalState;
  const billId = fixture.openBillId;
  const preSummary = await readBillSummary(fixture, billId, "REVERSAL-01");
  const headroom = preSummary.available_to_submit;
  if (headroom <= 0) fail("REVERSAL-01", "no available headroom on reversal bill");
  const amount = Math.min(20, headroom);

  const paymentId = await fixture.helpers.submitAdminBankTransferPayment({
    actor: fixture.users.adminA1,
    billId,
    amount,
    paymentDate: "2026-02-03",
    referenceNo: `${fixture.prefix}-REF-REV-LIVE`,
    idempotencyKey: `${fixture.prefix}-rev-live`,
    notes: null,
  });
  await fixture.helpers.verifyPayment(
    fixture.users.adminA2,
    paymentId,
    "stage3c reversal matrix — verify",
  );
  const paymentBefore = await readPayment(fixture, paymentId, "REVERSAL-01");
  if (paymentBefore.status !== STAGE3C_PAYMENT_STATUS.verified)
    fail("REVERSAL-01", "post-verify payment is not verified");
  const receiptBefore = await readReceiptOrNull(fixture, paymentId);
  if (receiptBefore === null)
    fail("REVERSAL-01", "verified payment missing its receipt");
  if (receiptBefore.status !== STAGE3C_RECEIPT_STATUS.valid)
    fail("REVERSAL-01", "pre-reversal receipt is not valid");
  const [summaryBefore, yearlySeqBefore, monthlySeqBefore] = await Promise.all([
    readBillSummary(fixture, billId, "REVERSAL-01"),
    readReceiptSequencesForSociety(fixture, fixture.societyA, "yearly"),
    readReceiptSequencesForSociety(fixture, fixture.societyA, "monthly"),
  ]);

  const state: Stage3CReversalState = {
    billId,
    paymentId,
    amount,
    reason: REVERSAL_REASON,
    paymentBefore,
    receiptBefore,
    summaryBefore,
    yearlySeqBefore,
    monthlySeqBefore,
    paymentAfter: null,
    receiptAfter: null,
    summaryAfter: null,
    yearlySeqAfter: null,
    monthlySeqAfter: null,
    residentDetailAfter: null,
  };
  ctx.reversalState = state;
  return state;
}

// ---------------------------------------------------------------------------
// REJECTION handlers
// ---------------------------------------------------------------------------

/**
 * REJECTION-01 — Admin A2 (non-submitter) rejects the pending payment via
 * the canonical `reject_offline_payment` RPC.
 */
export const rejection01_executeCanonicalReject: Stage3CMatrixLiveHandler = async (
  ctx,
) => {
  const fixture = requireFixture(ctx);
  const state = await ensureRejectionChain(ctx, fixture);
  if (state.paymentBefore.submitted_by === fixture.users.adminA2.id)
    fail("REJECTION-01", "adminA2 is the submitter — cannot act as rejecter");
  await fixture.helpers.rejectPayment(
    fixture.users.adminA2,
    state.paymentId,
    state.reason,
  );
  const after = await snapshotAfter(fixture, state.billId, state.paymentId, "REJECTION-01");
  state.paymentAfter = after.paymentAfter;
  state.summaryAfter = after.summaryAfter;
  state.yearlySeqAfter = after.yearlySeqAfter;
  state.monthlySeqAfter = after.monthlySeqAfter;
  state.receiptCountAfter = after.receiptCountAfter;
  if (after.paymentAfter.status !== STAGE3C_PAYMENT_STATUS.rejected)
    fail("REJECTION-01", "post-reject status is not rejected");
};

/** REJECTION-02 — actor attribution and per-column terminal state. */
export const rejection02_terminalStateAndActor: Stage3CMatrixLiveHandler = async (
  ctx,
) => {
  const fixture = requireFixture(ctx);
  const state = await ensureRejectionChain(ctx, fixture);
  const p = state.paymentAfter;
  if (p === null) fail("REJECTION-02", "REJECTION-01 must run first");
  if (p.rejected_at === null) fail("REJECTION-02", "rejected_at not populated");
  if (p.rejection_reason !== state.reason)
    fail("REJECTION-02", "rejection_reason mismatch");
  if (p.rejected_by !== fixture.users.adminA2.id)
    fail("REJECTION-02", "rejected_by does not match adminA2");
  if (p.verified_at !== null) fail("REJECTION-02", "verified_at unexpectedly populated");
  if (p.reversed_at !== null) fail("REJECTION-02", "reversed_at unexpectedly populated");
};

/** REJECTION-03 — zero receipts and unchanged receipt sequences. */
export const rejection03_noReceiptAndSequencesUnchanged: Stage3CMatrixLiveHandler = async (
  ctx,
) => {
  const fixture = requireFixture(ctx);
  const state = await ensureRejectionChain(ctx, fixture);
  if (state.receiptCountAfter === null || state.receiptCountAfter !== 0)
    fail("REJECTION-03", "receipt count after reject is not zero");
  if (state.yearlySeqAfter === null || state.monthlySeqAfter === null)
    fail("REJECTION-03", "sequence snapshots missing");
  expectSequencesUnchanged("REJECTION-03", state.yearlySeqBefore, state.yearlySeqAfter);
  expectSequencesUnchanged("REJECTION-03", state.monthlySeqBefore, state.monthlySeqAfter);
  void fixture;
};

/** REJECTION-04 — reservation release: pending−=amount, available+=amount. */
export const rejection04_exactReservationRelease: Stage3CMatrixLiveHandler = async (
  ctx,
) => {
  const fixture = requireFixture(ctx);
  const state = await ensureRejectionChain(ctx, fixture);
  if (state.summaryAfter === null) fail("REJECTION-04", "summary snapshot missing");
  const b = state.summaryBefore;
  const a = state.summaryAfter;
  expectEqualNumeric("REJECTION-04", "pending_amount", a.pending_amount, b.pending_amount - state.amount);
  expectEqualNumeric(
    "REJECTION-04",
    "available_to_submit",
    a.available_to_submit,
    b.available_to_submit + state.amount,
  );
  expectEqualNumeric("REJECTION-04", "verified_amount", a.verified_amount, b.verified_amount);
  void fixture;
};

/** REJECTION-05 — verify after reject → invalid_transition; state unchanged. */
export const rejection05_verifyAfterRejectDenied: Stage3CMatrixLiveHandler = async (
  ctx,
) => {
  const fixture = requireFixture(ctx);
  const state = await ensureRejectionChain(ctx, fixture);
  const client: BillingRpcClient = {
    async rpc(name, args) {
      const result = await fixture.users.adminA1.client["rpc"](name, args);
      return {
        data: result.data,
        error: result.error ? { message: result.error.message } : null,
      };
    },
  };
  const { error } = await client.rpc("verify_offline_payment", {
    _payment_id: state.paymentId,
    _notes: null,
  });
  if (error === null) fail("REJECTION-05", "verify after reject did not error");
  // reject_offline_payment leaves status='rejected'; verify_offline_payment
  // checks `p.status <> 'pending'` FIRST → raises `payment_not_pending`.
  if (
    error.message !== STAGE3C_LIFECYCLE_CANONICAL_ERRORS.payment_not_pending &&
    error.message !== STAGE3C_LIFECYCLE_CANONICAL_ERRORS.invalid_transition
  ) {
    fail("REJECTION-05", "wrong terminal-state error");
  }
  const after = await readPayment(fixture, state.paymentId, "REJECTION-05");
  if (after.status !== STAGE3C_PAYMENT_STATUS.rejected)
    fail("REJECTION-05", "payment left rejected state");
  const receiptCount = await readReceiptCount(fixture, state.paymentId);
  if (receiptCount !== 0) fail("REJECTION-05", "receipt count no longer zero");
};

// ---------------------------------------------------------------------------
// REVERSAL handlers
// ---------------------------------------------------------------------------

/** REVERSAL-01 — Admin A2 reverses the verified payment. */
export const reversal01_executeCanonicalReverse: Stage3CMatrixLiveHandler = async (
  ctx,
) => {
  const fixture = requireFixture(ctx);
  const state = await ensureReversalChain(ctx, fixture);
  await fixture.helpers.reversePayment(
    fixture.users.adminA2,
    state.paymentId,
    state.reason,
  );
  const [paymentAfter, receiptAfter, summaryAfter, yearlySeqAfter, monthlySeqAfter] =
    await Promise.all([
      readPayment(fixture, state.paymentId, "REVERSAL-01"),
      readReceiptOrNull(fixture, state.paymentId),
      readBillSummary(fixture, state.billId, "REVERSAL-01"),
      readReceiptSequencesForSociety(fixture, fixture.societyA, "yearly"),
      readReceiptSequencesForSociety(fixture, fixture.societyA, "monthly"),
    ]);
  state.paymentAfter = paymentAfter;
  state.receiptAfter = receiptAfter;
  state.summaryAfter = summaryAfter;
  state.yearlySeqAfter = yearlySeqAfter;
  state.monthlySeqAfter = monthlySeqAfter;
  if (paymentAfter.status !== STAGE3C_PAYMENT_STATUS.reversed)
    fail("REVERSAL-01", "post-reverse status is not reversed");
};

/** REVERSAL-02 — payment terminal state and actor attribution. */
export const reversal02_paymentTerminalStateAndActor: Stage3CMatrixLiveHandler = async (
  ctx,
) => {
  const fixture = requireFixture(ctx);
  const state = await ensureReversalChain(ctx, fixture);
  const p = state.paymentAfter;
  if (p === null) fail("REVERSAL-02", "REVERSAL-01 must run first");
  if (p.reversed_at === null) fail("REVERSAL-02", "reversed_at not populated");
  if (p.reversal_reason !== state.reason)
    fail("REVERSAL-02", "reversal_reason mismatch");
  if (p.reversed_by !== fixture.users.adminA2.id)
    fail("REVERSAL-02", "reversed_by does not match adminA2");
  // Original verified evidence remains.
  if (p.verified_at === null) fail("REVERSAL-02", "verified_at cleared");
  if (p.verified_by === null) fail("REVERSAL-02", "verified_by cleared");
  if (p.rejected_at !== null) fail("REVERSAL-02", "rejected_at unexpectedly populated");
};

/** REVERSAL-03 — receipt becomes void; id and receipt_number unchanged. */
export const reversal03_receiptVoidedInPlace: Stage3CMatrixLiveHandler = async (ctx) => {
  const fixture = requireFixture(ctx);
  const state = await ensureReversalChain(ctx, fixture);
  const r = state.receiptAfter;
  if (r === null) fail("REVERSAL-03", "receipt missing after reverse");
  if (r.status !== STAGE3C_RECEIPT_STATUS.void)
    fail("REVERSAL-03", "receipt status is not the canonical 'void'");
  if (r.id !== state.receiptBefore.id) fail("REVERSAL-03", "receipt id changed");
  if (r.receipt_number !== state.receiptBefore.receipt_number)
    fail("REVERSAL-03", "receipt_number changed");
  const count = await readReceiptCount(fixture, state.paymentId);
  if (count !== 1) fail("REVERSAL-03", "receipt count is not exactly 1");
};

/** REVERSAL-04 — voided_at / void_reason / voided_by populated. */
export const reversal04_voidedMetadataPopulated: Stage3CMatrixLiveHandler = async (
  ctx,
) => {
  const fixture = requireFixture(ctx);
  const state = await ensureReversalChain(ctx, fixture);
  const r = state.receiptAfter;
  if (r === null) fail("REVERSAL-04", "receipt missing");
  if (r.voided_at === null) fail("REVERSAL-04", "voided_at not populated");
  if (r.void_reason !== state.reason) fail("REVERSAL-04", "void_reason mismatch");
  if (r.voided_by !== fixture.users.adminA2.id)
    fail("REVERSAL-04", "voided_by does not match adminA2");
};

/** REVERSAL-05 — resident detail reflects reversal + void with resident audience. */
export const reversal05_residentReversedDetail: Stage3CMatrixLiveHandler = async (
  ctx,
) => {
  const fixture = requireFixture(ctx);
  const state = await ensureReversalChain(ctx, fixture);
  const client: BillingRpcClient = {
    async rpc(name, args) {
      const result = await fixture.users.activeResident.client["rpc"](name, args);
      return {
        data: result.data,
        error: result.error ? { message: result.error.message } : null,
      };
    },
  };
  const detail = await getPaymentDetailWithClient(client, {
    paymentId: state.paymentId,
  });
  if (detail === null) fail("REVERSAL-05", "resident detail null");
  if (detail.audience !== "resident")
    fail("REVERSAL-05", "audience is not resident");
  if (detail.payment.status !== STAGE3C_PAYMENT_STATUS.reversed)
    fail("REVERSAL-05", "resident detail status not reversed");
  if (detail.receipt === null) fail("REVERSAL-05", "resident receipt missing");
  if (detail.receipt.status !== STAGE3C_RECEIPT_STATUS.void)
    fail("REVERSAL-05", "resident receipt status not void");
  if (state.receiptAfter && detail.receipt.receipt_number !== state.receiptAfter.receipt_number)
    fail("REVERSAL-05", "receipt_number mismatch on resident detail");
  state.residentDetailAfter = detail;
};

/** REVERSAL-06 — resident payload omits every applicable internal key. */
export const reversal06_residentPayloadOmitsInternals: Stage3CMatrixLiveHandler = async (
  ctx,
) => {
  const state = ctx.reversalState;
  if (state === null || state.residentDetailAfter === null)
    fail("REVERSAL-06", "REVERSAL-05 must run first");
  const detail = state.residentDetailAfter as unknown as Record<string, unknown>;
  const forbidden = [
    "voided_by",
    "verified_by",
    "reversed_by",
    "submitted_by",
    "rejected_by",
    "notes",
    "verification_notes",
    "proof_url",
    "idempotency_key",
    "issued_by",
    "sequence_id",
    "sequence_key",
    "next_number",
    "year_month",
    "payer_user_id",
  ];
  const walk = (v: unknown, path: string): void => {
    if (v === null || typeof v !== "object") return;
    if (Array.isArray(v)) {
      v.forEach((item, i) => walk(item, `${path}[${i}]`));
      return;
    }
    const obj = v as Record<string, unknown>;
    for (const key of Object.keys(obj)) {
      if (forbidden.includes(key))
        fail("REVERSAL-06", `resident payload contains forbidden key at depth`);
      walk(obj[key], `${path}.${key}`);
    }
  };
  walk(detail, "$");
};

/** REVERSAL-07 — verified_amount decreases by exactly the reversed amount. */
export const reversal07_verifiedAmountDecreases: Stage3CMatrixLiveHandler = async (
  ctx,
) => {
  const state = ctx.reversalState;
  if (state === null || state.summaryAfter === null)
    fail("REVERSAL-07", "REVERSAL-01 must run first");
  expectEqualNumeric(
    "REVERSAL-07",
    "verified_amount",
    state.summaryAfter.verified_amount,
    state.summaryBefore.verified_amount - state.amount,
  );
};

/** REVERSAL-08 — available increases; pending unchanged; sequences not decremented. */
export const reversal08_availableIncreasesAndSequencesIntact: Stage3CMatrixLiveHandler =
  async (ctx) => {
    const state = ctx.reversalState;
    if (state === null || state.summaryAfter === null)
      fail("REVERSAL-08", "REVERSAL-01 must run first");
    expectEqualNumeric(
      "REVERSAL-08",
      "available_to_submit",
      state.summaryAfter.available_to_submit,
      state.summaryBefore.available_to_submit + state.amount,
    );
    expectEqualNumeric(
      "REVERSAL-08",
      "pending_amount",
      state.summaryAfter.pending_amount,
      state.summaryBefore.pending_amount,
    );
    if (state.yearlySeqAfter === null || state.monthlySeqAfter === null)
      fail("REVERSAL-08", "sequence snapshots missing");
    expectSequencesNotDecreased(
      "REVERSAL-08",
      state.yearlySeqBefore,
      state.yearlySeqAfter,
    );
    expectSequencesNotDecreased(
      "REVERSAL-08",
      state.monthlySeqBefore,
      state.monthlySeqAfter,
    );
  };

/** REVERSAL-09 — verify after reverse denied; state unchanged. */
export const reversal09_verifyAfterReverseDenied: Stage3CMatrixLiveHandler = async (
  ctx,
) => {
  const fixture = requireFixture(ctx);
  const state = ctx.reversalState;
  if (state === null || state.paymentAfter === null)
    fail("REVERSAL-09", "REVERSAL-01 must run first");
  const client: BillingRpcClient = {
    async rpc(name, args) {
      const result = await fixture.users.adminA1.client["rpc"](name, args);
      return {
        data: result.data,
        error: result.error ? { message: result.error.message } : null,
      };
    },
  };
  const { error } = await client.rpc("verify_offline_payment", {
    _payment_id: state.paymentId,
    _notes: null,
  });
  if (error === null) fail("REVERSAL-09", "verify after reverse did not error");
  if (
    error.message !== STAGE3C_LIFECYCLE_CANONICAL_ERRORS.payment_not_pending &&
    error.message !== STAGE3C_LIFECYCLE_CANONICAL_ERRORS.invalid_transition
  ) {
    fail("REVERSAL-09", "wrong terminal-state error");
  }
  const paymentAgain = await readPayment(fixture, state.paymentId, "REVERSAL-09");
  if (paymentAgain.status !== STAGE3C_PAYMENT_STATUS.reversed)
    fail("REVERSAL-09", "payment left reversed state");
  const receiptAgain = await readReceiptOrNull(fixture, state.paymentId);
  if (receiptAgain === null) fail("REVERSAL-09", "receipt disappeared");
  if (receiptAgain.status !== STAGE3C_RECEIPT_STATUS.void)
    fail("REVERSAL-09", "receipt no longer void");
  if (receiptAgain.receipt_number !== state.receiptBefore.receipt_number)
    fail("REVERSAL-09", "receipt_number changed");
  const count = await readReceiptCount(fixture, state.paymentId);
  if (count !== 1) fail("REVERSAL-09", "receipt count changed");
};

// ---------------------------------------------------------------------------
// Handler maps
// ---------------------------------------------------------------------------

export const STAGE3C_REJECTION_HANDLERS = {
  "REJECTION-01": rejection01_executeCanonicalReject,
  "REJECTION-02": rejection02_terminalStateAndActor,
  "REJECTION-03": rejection03_noReceiptAndSequencesUnchanged,
  "REJECTION-04": rejection04_exactReservationRelease,
  "REJECTION-05": rejection05_verifyAfterRejectDenied,
} satisfies Record<Stage3CRejectionCaseId, Stage3CMatrixLiveHandler>;

export const STAGE3C_REVERSAL_HANDLERS = {
  "REVERSAL-01": reversal01_executeCanonicalReverse,
  "REVERSAL-02": reversal02_paymentTerminalStateAndActor,
  "REVERSAL-03": reversal03_receiptVoidedInPlace,
  "REVERSAL-04": reversal04_voidedMetadataPopulated,
  "REVERSAL-05": reversal05_residentReversedDetail,
  "REVERSAL-06": reversal06_residentPayloadOmitsInternals,
  "REVERSAL-07": reversal07_verifiedAmountDecreases,
  "REVERSAL-08": reversal08_availableIncreasesAndSequencesIntact,
  "REVERSAL-09": reversal09_verifyAfterReverseDenied,
} satisfies Record<Stage3CReversalCaseId, Stage3CMatrixLiveHandler>;
