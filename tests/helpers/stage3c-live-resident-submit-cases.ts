/**
 * Stage 3C — Live RESIDENT-SUBMIT-01..RESIDENT-SUBMIT-08 case handlers.
 *
 * All submissions run through the same code path used by the production
 * `submitResidentBankTransfer` server function: the resident's own
 * authenticated Supabase client calls `submit_offline_payment` with
 * `_method` pinned to `bank_transfer` and `_actor_role` pinned to
 * `resident`. The fixture helper
 * `submitResidentBankTransferPayment` is that exact mirror — the
 * production TanStack server function's body is a thin wrapper over
 * the same RPC + pins, and cannot be invoked over HTTP from Vitest.
 *
 * The public schema (`residentSubmitInputSchema`) is used at the
 * boundary to reject any forbidden field the browser might attempt to
 * smuggle (method, actorRole, proofUrl, status, societyId, submittedBy,
 * verifiedAmount, receipt fields).
 *
 * Denial cases (RESIDENT-SUBMIT-04..07) never mutate database state:
 * the pending payment produced by RESIDENT-SUBMIT-02 remains the only
 * payment on the dedicated bill, and the dedicated other-flat bill is
 * left untouched.
 */
import { expect } from "vitest";
import {
  parseBillSummary,
  parsePaymentAssertionRow,
} from "./stage3c-live-core-context";
import { trackUniqueId } from "./stage3c-runtime-fixtures";
import { STAGE3C_ERRORS, assertCanonicalError } from "./stage3c-live-errors";
import { residentSubmitInputSchema } from "@/lib/offline-payment-contracts";
import {
  requireMatrixFixture,
  requireResidentSubmitAmount,
  requireResidentSubmitIdempotencyKey,
  requireResidentSubmitInitialSummary,
  requireResidentSubmitPaymentId,
  requireResidentSubmitReference,
  type Stage3CLiveMatrixContext,
} from "./stage3c-live-matrix-context";

export type Stage3CResidentSubmitCaseId =
  | "RESIDENT-SUBMIT-01"
  | "RESIDENT-SUBMIT-02"
  | "RESIDENT-SUBMIT-03"
  | "RESIDENT-SUBMIT-04"
  | "RESIDENT-SUBMIT-05"
  | "RESIDENT-SUBMIT-06"
  | "RESIDENT-SUBMIT-07"
  | "RESIDENT-SUBMIT-08";

export type Stage3CResidentSubmitHandler = (
  ctx: Stage3CLiveMatrixContext,
) => Promise<void>;

/** Canonical amount used by the resident-submit lifecycle. */
export const RESIDENT_SUBMIT_AMOUNT = 300;

/**
 * Derive bounded, run-unique but deterministic suffixes from the
 * fixture prefix (which already embeds Date.now + a random slug). The
 * fixture prefix is unique per test run and never contains protected
 * identity.
 */
function safeSuffix(prefix: string): string {
  return prefix.replace(/[^A-Za-z0-9]/g, "").slice(0, 24) || "run";
}

function residentReferenceFor(prefix: string): string {
  return `RS-${safeSuffix(prefix)}`;
}

function residentIdempotencyKeyFor(prefix: string): string {
  return `resident-submit-${safeSuffix(prefix)}`;
}

function assertCleanBaseline(
  summary: ReturnType<typeof parseBillSummary>,
  label: string,
): void {
  expect(summary.total_payable, `${label}: total_payable`).toBe(1200);
  expect(summary.verified_amount, `${label}: verified_amount`).toBe(0);
  expect(summary.pending_amount, `${label}: pending_amount`).toBe(0);
  expect(summary.available_to_submit, `${label}: available_to_submit`).toBe(1200);
}

function summaryField(raw: unknown, field: string, label: string): number {
  if (raw && typeof raw === "object") {
    const v = (raw as Record<string, unknown>)[field];
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (typeof v === "string" && v.trim().length > 0) {
      const n = Number(v);
      if (Number.isFinite(n)) return n;
    }
  }
  throw new Error(`[stage3c:${label}] missing/invalid summary field "${field}"`);
}

// ---------------------------------------------------------------------------
// RESIDENT-SUBMIT-01
// ---------------------------------------------------------------------------

export const residentSubmit01_initializeDedicatedResidentBill: Stage3CResidentSubmitHandler =
  async (ctx) => {
    const fixture = requireMatrixFixture(ctx);
    const billId = fixture.matrix.residentSubmitBillId;

    ctx.residentSubmitAmount = RESIDENT_SUBMIT_AMOUNT;
    ctx.residentSubmitReference = residentReferenceFor(fixture.prefix);
    ctx.residentSubmitIdempotencyKey = residentIdempotencyKeyFor(fixture.prefix);
    // Also populate the foundation resident slots (validator contract).
    ctx.residentBillId = billId;
    ctx.residentAmount = ctx.residentSubmitAmount;
    ctx.residentReference = ctx.residentSubmitReference;
    ctx.residentIdempotencyKey = ctx.residentSubmitIdempotencyKey;

    const rawSummary = await fixture.helpers.getBillSummary(fixture.users.adminA1, billId);
    const initial = parseBillSummary(rawSummary, "resident-submit-01");
    assertCleanBaseline(initial, "RESIDENT-SUBMIT-01");
    expect(summaryField(rawSummary, "rejected_amount", "RESIDENT-SUBMIT-01")).toBe(0);
    expect(summaryField(rawSummary, "reversed_amount", "RESIDENT-SUBMIT-01")).toBe(0);
    expect(
      summaryField(rawSummary, "remaining_verified_balance", "RESIDENT-SUBMIT-01"),
    ).toBe(1200);
    expect(
      Boolean((rawSummary as Record<string, unknown>).cancelled),
      "RESIDENT-SUBMIT-01: bill must not be cancelled",
    ).toBe(false);
    const status = String((rawSummary as Record<string, unknown>).status ?? "");
    expect(["unpaid", "open"], `RESIDENT-SUBMIT-01: canonical unpaid/open, got ${status}`).toContain(
      status,
    );

    ctx.residentSubmitInitialSummary = initial;
    ctx.residentBaselineSummary = initial;

    const preCount = await fixture.helpers.countPayments(billId);
    expect(preCount, "RESIDENT-SUBMIT-01: no pre-existing payments on dedicated bill").toBe(0);
  };

// ---------------------------------------------------------------------------
// RESIDENT-SUBMIT-02
// ---------------------------------------------------------------------------

export const residentSubmit02_submitBankTransfer: Stage3CResidentSubmitHandler = async (
  ctx,
) => {
  const fixture = requireMatrixFixture(ctx);
  const amount = requireResidentSubmitAmount(ctx);
  const reference = requireResidentSubmitReference(ctx);
  const idempotencyKey = requireResidentSubmitIdempotencyKey(ctx);
  const billId = fixture.matrix.residentSubmitBillId;

  // Public boundary: parse through the exact production schema. Only
  // resident-safe public fields cross the boundary.
  const parsed = residentSubmitInputSchema.parse({
    billId,
    amount,
    paymentDate: fixture.testPaymentDate,
    referenceNo: reference,
    idempotencyKey,
  });

  // Same code path as `submitResidentBankTransfer` in
  // src/lib/offline-payments.functions.ts — method pinned to
  // bank_transfer, actor role pinned to resident.
  const paymentId = await fixture.helpers.submitResidentBankTransferPayment({
    actor: fixture.users.activeResident,
    billId: parsed.billId,
    amount: parsed.amount,
    paymentDate: parsed.paymentDate ?? fixture.testPaymentDate,
    referenceNo: parsed.referenceNo,
    idempotencyKey: parsed.idempotencyKey,
  });

  ctx.residentSubmitPaymentId = paymentId;
  ctx.residentPaymentId = paymentId;
  trackUniqueId(fixture.tracked.paymentIds, paymentId, "residentSubmitPayment");
};

// ---------------------------------------------------------------------------
// RESIDENT-SUBMIT-03
// ---------------------------------------------------------------------------

export const residentSubmit03_pendingRowAndNoReceipt: Stage3CResidentSubmitHandler = async (
  ctx,
) => {
  const fixture = requireMatrixFixture(ctx);
  const paymentId = requireResidentSubmitPaymentId(ctx);
  const billId = fixture.matrix.residentSubmitBillId;
  const reference = requireResidentSubmitReference(ctx);
  const idempotencyKey = requireResidentSubmitIdempotencyKey(ctx);
  const amount = requireResidentSubmitAmount(ctx);

  const { data, error } = await fixture.admin
    .from("payments")
    .select(
      "id, bill_id, society_id, submitted_by, amount, method, status, reference_no, idempotency_key, verified_by, verified_at, rejected_by, rejected_at, rejection_reason, reversed_by, reversed_at, reversal_reason",
    )
    .eq("id", paymentId)
    .single();
  expect(error, "RESIDENT-SUBMIT-03: query error").toBeNull();
  expect(data, "RESIDENT-SUBMIT-03: row present").not.toBeNull();
  const row = data as Record<string, unknown>;

  const assertion = parsePaymentAssertionRow(
    {
      society_id: row.society_id,
      flat_id: fixture.flatA,
      bill_id: row.bill_id,
      method: row.method,
      submitted_by: row.submitted_by,
      status: row.status,
    },
    "resident-submit-03",
  );
  expect(assertion.society_id, "RESIDENT-SUBMIT-03: society").toBe(fixture.societyA);
  expect(assertion.bill_id, "RESIDENT-SUBMIT-03: bill").toBe(billId);
  expect(assertion.submitted_by, "RESIDENT-SUBMIT-03: submitter").toBe(
    fixture.users.activeResident.id,
  );
  expect(assertion.method, "RESIDENT-SUBMIT-03: server-pinned bank_transfer").toBe(
    "bank_transfer",
  );
  expect(assertion.status, "RESIDENT-SUBMIT-03: pending").toBe("pending");

  expect(Number(row.amount), "RESIDENT-SUBMIT-03: amount").toBe(amount);
  expect(row.reference_no, "RESIDENT-SUBMIT-03: reference").toBe(reference);
  expect(row.idempotency_key, "RESIDENT-SUBMIT-03: idempotency key").toBe(idempotencyKey);
  expect(row.verified_by, "RESIDENT-SUBMIT-03: verified_by null").toBeNull();
  expect(row.verified_at, "RESIDENT-SUBMIT-03: verified_at null").toBeNull();
  expect(row.rejected_by, "RESIDENT-SUBMIT-03: rejected_by null").toBeNull();
  expect(row.rejected_at, "RESIDENT-SUBMIT-03: rejected_at null").toBeNull();
  expect(row.rejection_reason, "RESIDENT-SUBMIT-03: rejection_reason null").toBeNull();
  expect(row.reversed_by, "RESIDENT-SUBMIT-03: reversed_by null").toBeNull();
  expect(row.reversed_at, "RESIDENT-SUBMIT-03: reversed_at null").toBeNull();
  expect(row.reversal_reason, "RESIDENT-SUBMIT-03: reversal_reason null").toBeNull();

  const receipts = await fixture.helpers.countReceipts(paymentId);
  expect(receipts, "RESIDENT-SUBMIT-03: no receipt for pending payment").toBe(0);
};

// ---------------------------------------------------------------------------
// RESIDENT-SUBMIT-04 — public schema strictness + resident_cash_not_allowed
// ---------------------------------------------------------------------------

export const residentSubmit04_serverPinnedMethodAndActorRole: Stage3CResidentSubmitHandler =
  async (ctx) => {
    const fixture = requireMatrixFixture(ctx);
    const billId = fixture.matrix.residentSubmitBillId;
    const reference = requireResidentSubmitReference(ctx);
    const idempotencyKey = requireResidentSubmitIdempotencyKey(ctx);
    const amount = requireResidentSubmitAmount(ctx);

    // A. Public boundary rejection of forbidden fields.
    const baseValid = {
      billId,
      amount,
      paymentDate: fixture.testPaymentDate,
      referenceNo: reference,
      idempotencyKey,
    } as const;
    const forbidden: ReadonlyArray<readonly [string, Record<string, unknown>]> = [
      ["method", { method: "cash" }],
      ["actorRole", { actorRole: "admin" }],
      ["proofUrl", { proofUrl: "https://x/y" }],
      ["status", { status: "verified" }],
      ["societyId", { societyId: fixture.societyA }],
      ["submittedBy", { submittedBy: fixture.users.activeResident.id }],
    ];
    for (const [name, extra] of forbidden) {
      const attempt = { ...baseValid, ...extra };
      const res = residentSubmitInputSchema.safeParse(attempt);
      expect(res.success, `RESIDENT-SUBMIT-04: public schema must reject "${name}"`).toBe(
        false,
      );
    }

    // B. Direct RPC: cash as resident must be denied server-side.
    const preCount = await fixture.helpers.countPayments(billId);
    let threw = false;
    try {
      const { data, error } = await fixture.users.activeResident.client.rpc(
        "submit_offline_payment",
        {
          _bill_id: billId,
          _method: "cash",
          _amount: amount,
          _payment_date: fixture.testPaymentDate,
          _reference_no: null,
          _notes: null,
          _idempotency_key: `${fixture.prefix}-rs04-cash`,
          _actor_role: "resident",
        },
      );
      if (error) throw error;
      // If no error surfaced, treat the returned data as the (unexpected) success signal.
      throw new Error(
        `RESIDENT-SUBMIT-04: cash submission must be denied, got id: ${String(data ?? "")}`,
      );
    } catch (err) {
      threw = true;
      assertCanonicalError(err, STAGE3C_ERRORS.RESIDENT_CASH_NOT_ALLOWED, "RESIDENT-SUBMIT-04");
    }
    expect(threw, "RESIDENT-SUBMIT-04: cash attempt must throw").toBe(true);

    // No mutation.
    const postCount = await fixture.helpers.countPayments(billId);
    expect(postCount, "RESIDENT-SUBMIT-04: no new payment after cash denial").toBe(preCount);
    const pendingId = requireResidentSubmitPaymentId(ctx);
    expect(await fixture.helpers.countReceipts(pendingId)).toBe(0);
  };

// ---------------------------------------------------------------------------
// Shared denial helper for RESIDENT-SUBMIT-05..07
// ---------------------------------------------------------------------------

type DenialInput = {
  label: string;
  ctx: Stage3CLiveMatrixContext;
  actorClient: { rpc: (name: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }> };
  billId: string;
  suffix: string;
};

async function attemptResidentSubmitAndAssertDenied(input: DenialInput): Promise<void> {
  const { label, ctx, actorClient, billId, suffix } = input;
  const fixture = requireMatrixFixture(ctx);
  const amount = requireResidentSubmitAmount(ctx);

  const preBillCount = await fixture.helpers.countPayments(billId);
  const uniqueReference = `RS-${safeSuffix(fixture.prefix)}-${suffix}`;
  const uniqueKey = `resident-submit-${safeSuffix(fixture.prefix)}-${suffix}`;

  let threw = false;
  try {
    const { data, error } = await actorClient.rpc("submit_offline_payment", {
      _bill_id: billId,
      _method: "bank_transfer",
      _amount: amount,
      _payment_date: fixture.testPaymentDate,
      _reference_no: uniqueReference,
      _notes: null,
      _idempotency_key: uniqueKey,
      _actor_role: "resident",
    });
    if (error) throw error;
    throw new Error(`${label}: unexpected success payload: ${String(data ?? "")}`);
  } catch (err) {
    threw = true;
    assertCanonicalError(err, STAGE3C_ERRORS.NOT_AUTHORIZED, label);
  }
  expect(threw, `${label}: must throw`).toBe(true);

  const postBillCount = await fixture.helpers.countPayments(billId);
  expect(postBillCount, `${label}: no new payment on target bill`).toBe(preBillCount);
}

// ---------------------------------------------------------------------------
// RESIDENT-SUBMIT-05 — same-society other flat
// ---------------------------------------------------------------------------

export const residentSubmit05_otherFlatDenied: Stage3CResidentSubmitHandler = async (ctx) => {
  const fixture = requireMatrixFixture(ctx);
  const otherFlatBillId = fixture.matrix.otherFlatBillId;

  await attemptResidentSubmitAndAssertDenied({
    label: "RESIDENT-SUBMIT-05",
    ctx,
    actorClient: fixture.users.activeResident.client,
    billId: otherFlatBillId,
    suffix: "otherflat",
  });

  // otherFlat bill must remain at canonical clean 900.
  const raw = await fixture.helpers.getBillSummary(fixture.users.adminA1, otherFlatBillId);
  const summary = parseBillSummary(raw, "resident-submit-05");
  expect(summary.total_payable, "RESIDENT-SUBMIT-05: total").toBe(900);
  expect(summary.verified_amount, "RESIDENT-SUBMIT-05: verified").toBe(0);
  expect(summary.pending_amount, "RESIDENT-SUBMIT-05: pending").toBe(0);
  expect(summary.available_to_submit, "RESIDENT-SUBMIT-05: available").toBe(900);
  expect(summaryField(raw, "rejected_amount", "RESIDENT-SUBMIT-05")).toBe(0);
  expect(summaryField(raw, "reversed_amount", "RESIDENT-SUBMIT-05")).toBe(0);
  expect(summaryField(raw, "remaining_verified_balance", "RESIDENT-SUBMIT-05")).toBe(900);
  expect((raw as Record<string, unknown>).cancelled).toBe(false);
};

// ---------------------------------------------------------------------------
// RESIDENT-SUBMIT-06 — moved-out resident
// ---------------------------------------------------------------------------

export const residentSubmit06_movedOutResidentDenied: Stage3CResidentSubmitHandler = async (
  ctx,
) => {
  const fixture = requireMatrixFixture(ctx);
  const billId = fixture.matrix.residentSubmitBillId;
  const priorPendingId = requireResidentSubmitPaymentId(ctx);
  const priorCount = await fixture.helpers.countPayments(billId);

  await attemptResidentSubmitAndAssertDenied({
    label: "RESIDENT-SUBMIT-06",
    ctx,
    actorClient: fixture.users.movedOutResident.client,
    billId,
    suffix: "movedout",
  });

  // Only the pending payment from RESIDENT-SUBMIT-02 remains.
  const postCount = await fixture.helpers.countPayments(billId);
  expect(postCount, "RESIDENT-SUBMIT-06: payment count unchanged").toBe(priorCount);
  expect(postCount, "RESIDENT-SUBMIT-06: exactly one pending payment on dedicated bill").toBe(1);
  expect(await fixture.helpers.countReceipts(priorPendingId)).toBe(0);
};

// ---------------------------------------------------------------------------
// RESIDENT-SUBMIT-07 — cross-society (Society B) resident
// ---------------------------------------------------------------------------

export const residentSubmit07_crossSocietyResidentDenied: Stage3CResidentSubmitHandler = async (
  ctx,
) => {
  const fixture = requireMatrixFixture(ctx);
  const billId = fixture.matrix.residentSubmitBillId;
  const priorCount = await fixture.helpers.countPayments(billId);

  await attemptResidentSubmitAndAssertDenied({
    label: "RESIDENT-SUBMIT-07",
    ctx,
    actorClient: fixture.users.unrelatedResident.client,
    billId,
    suffix: "crosssoc",
  });

  const postCount = await fixture.helpers.countPayments(billId);
  expect(postCount, "RESIDENT-SUBMIT-07: payment count unchanged").toBe(priorCount);
  expect(postCount, "RESIDENT-SUBMIT-07: exactly one pending payment").toBe(1);
};

// ---------------------------------------------------------------------------
// RESIDENT-SUBMIT-08 — exact summary delta
// ---------------------------------------------------------------------------

export const residentSubmit08_exactSummaryDelta: Stage3CResidentSubmitHandler = async (ctx) => {
  const fixture = requireMatrixFixture(ctx);
  const billId = fixture.matrix.residentSubmitBillId;
  const initial = requireResidentSubmitInitialSummary(ctx);
  const amount = requireResidentSubmitAmount(ctx);
  const paymentId = requireResidentSubmitPaymentId(ctx);

  const raw = await fixture.helpers.getBillSummary(fixture.users.adminA1, billId);
  const finalSummary = parseBillSummary(raw, "resident-submit-08");

  expect(finalSummary.total_payable, "RESIDENT-SUBMIT-08: total unchanged").toBeCloseTo(
    initial.total_payable,
    6,
  );
  expect(
    finalSummary.pending_amount - initial.pending_amount,
    "RESIDENT-SUBMIT-08: pending delta = +amount",
  ).toBeCloseTo(amount, 6);
  expect(finalSummary.pending_amount, "RESIDENT-SUBMIT-08: pending absolute").toBeCloseTo(
    amount,
    6,
  );
  expect(
    initial.available_to_submit - finalSummary.available_to_submit,
    "RESIDENT-SUBMIT-08: available delta = amount",
  ).toBeCloseTo(amount, 6);
  expect(finalSummary.available_to_submit, "RESIDENT-SUBMIT-08: available absolute").toBeCloseTo(
    900,
    6,
  );
  expect(finalSummary.verified_amount, "RESIDENT-SUBMIT-08: verified unchanged").toBeCloseTo(
    initial.verified_amount,
    6,
  );
  expect(summaryField(raw, "rejected_amount", "RESIDENT-SUBMIT-08")).toBe(0);
  expect(summaryField(raw, "reversed_amount", "RESIDENT-SUBMIT-08")).toBe(0);
  expect(
    summaryField(raw, "remaining_verified_balance", "RESIDENT-SUBMIT-08"),
  ).toBeCloseTo(1200, 6);
  expect((raw as Record<string, unknown>).cancelled).toBe(false);
  const status = String((raw as Record<string, unknown>).status ?? "");
  expect(["unpaid", "open"], `RESIDENT-SUBMIT-08: unpaid/open, got ${status}`).toContain(status);

  // Exact payment counts on the dedicated bill.
  const totalPayments = await fixture.helpers.countPayments(billId);
  expect(totalPayments, "RESIDENT-SUBMIT-08: exactly one payment").toBe(1);
  const rowsRes = await fixture.admin
    .from("payments")
    .select("id, status")
    .eq("bill_id", billId);
  expect(rowsRes.error, "RESIDENT-SUBMIT-08: rows query").toBeNull();
  const rows = Array.isArray(rowsRes.data) ? rowsRes.data : [];
  const pending = rows.filter((r) => (r as { status?: string }).status === "pending");
  const verified = rows.filter((r) => (r as { status?: string }).status === "verified");
  const rejected = rows.filter((r) => (r as { status?: string }).status === "rejected");
  const reversed = rows.filter((r) => (r as { status?: string }).status === "reversed");
  expect(pending.length, "RESIDENT-SUBMIT-08: pending count").toBe(1);
  expect(verified.length, "RESIDENT-SUBMIT-08: verified count").toBe(0);
  expect(rejected.length, "RESIDENT-SUBMIT-08: rejected count").toBe(0);
  expect(reversed.length, "RESIDENT-SUBMIT-08: reversed count").toBe(0);

  const receipts = await fixture.helpers.countReceipts(paymentId);
  expect(receipts, "RESIDENT-SUBMIT-08: no receipt exists").toBe(0);

  ctx.residentSubmitPendingSummary = finalSummary;
  ctx.residentPostSubmitSummary = finalSummary;
};

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

export const STAGE3C_RESIDENT_SUBMIT_HANDLERS = {
  "RESIDENT-SUBMIT-01": residentSubmit01_initializeDedicatedResidentBill,
  "RESIDENT-SUBMIT-02": residentSubmit02_submitBankTransfer,
  "RESIDENT-SUBMIT-03": residentSubmit03_pendingRowAndNoReceipt,
  "RESIDENT-SUBMIT-04": residentSubmit04_serverPinnedMethodAndActorRole,
  "RESIDENT-SUBMIT-05": residentSubmit05_otherFlatDenied,
  "RESIDENT-SUBMIT-06": residentSubmit06_movedOutResidentDenied,
  "RESIDENT-SUBMIT-07": residentSubmit07_crossSocietyResidentDenied,
  "RESIDENT-SUBMIT-08": residentSubmit08_exactSummaryDelta,
} satisfies Record<Stage3CResidentSubmitCaseId, Stage3CResidentSubmitHandler>;

export const STAGE3C_RESIDENT_SUBMIT_CASE_IDS: readonly Stage3CResidentSubmitCaseId[] = [
  "RESIDENT-SUBMIT-01",
  "RESIDENT-SUBMIT-02",
  "RESIDENT-SUBMIT-03",
  "RESIDENT-SUBMIT-04",
  "RESIDENT-SUBMIT-05",
  "RESIDENT-SUBMIT-06",
  "RESIDENT-SUBMIT-07",
  "RESIDENT-SUBMIT-08",
] as const;
