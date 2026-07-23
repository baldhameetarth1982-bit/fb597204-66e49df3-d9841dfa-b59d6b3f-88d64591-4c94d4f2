/**
 * Stage 3C — Live RESIDENT-SUBMIT-01..RESIDENT-SUBMIT-08 case handlers.
 *
 * Every submission goes through the neutral shared production core
 * `submitResidentBankTransferWithClient` — the fixture helper
 * `submitResidentBankTransferPayment` is a thin wrapper over that same
 * core (see `src/lib/offline-payment-resident-submit.ts`), so the
 * production server function and the fixture cannot drift on method
 * or actor pinning.
 *
 * All Zod schemas, snapshot/comparison helpers, and no-receipt
 * assertions live in `./stage3c-live-resident-submit-contracts` — this
 * file contains only the case control flow.
 *
 * Denial cases (RESIDENT-SUBMIT-04..07) use a strict control-flow
 * pattern: the RPC is invoked inside a try/catch that ONLY records
 * `{ caught, succeededData }`; the "unexpected success" assertion is
 * thrown OUTSIDE the catch block so it can never be mistaken for a
 * canonical error and consumed by `assertCanonicalError`. Each denial
 * case snapshots the full bill state before and asserts it is byte-for
 * -byte unchanged after (summary + payment rows + receipt sequences).
 */
import { expect } from "vitest";
import { z } from "zod";
import {
  parseBillSummary,
  parsePaymentAssertionRow,
} from "./stage3c-live-core-context";
import { trackUniqueId } from "./stage3c-runtime-fixtures";
import { STAGE3C_ERRORS, assertCanonicalError } from "./stage3c-live-errors";
import { safeStage3CErrorMessage } from "./stage3c-error-redaction";

import { residentSubmitInputSchema } from "@/lib/offline-payment-contracts";
import {
  ResidentSubmittedPaymentRowSchema,
  ResidentBillSummarySchema,
  deriveActorRoleFromSource,
  snapshotReceiptSequences,
  assertReceiptSequencesExactlyEqual,
  snapshotResidentBillState,
  assertResidentBillStateUnchanged,
  assertNoReceiptForResidentPayment,
  assertResidentPendingDelta,
  assertCanonicalMovedOutRelationship,
  parseResidentPaymentStatusRows,
  type ReceiptSequenceSnapshot,
  type ResidentBillSummary,
} from "./stage3c-live-resident-submit-contracts";
import {
  requireMatrixFixture,
  requireResidentSubmitAmount,
  requireResidentSubmitIdempotencyKey,
  requireResidentSubmitInitialSummary,
  requireResidentSubmitInitialReceiptSequences,
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
  expect(summary.available_to_submit, `${label}: available_to_submit`).toBe(
    1200,
  );
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

// Re-exports kept for the 32-case validator + unit tests. Do NOT redeclare.
export {
  ResidentSubmittedPaymentRowSchema,
  deriveActorRoleFromSource,
  snapshotReceiptSequences,
  assertReceiptSequencesExactlyEqual,
  snapshotResidentBillState,
  assertResidentBillStateUnchanged,
  assertNoReceiptForResidentPayment,
  assertResidentPendingDelta,
  assertCanonicalMovedOutRelationship,
  parseResidentPaymentStatusRows,
};

// ---------------------------------------------------------------------------
// Denial control-flow: capture outcome, then assert OUTSIDE catch.
// ---------------------------------------------------------------------------

type RpcOutcome = {
  caught: unknown | null;
  succeededData: unknown | undefined;
};

async function invokeRpcCapturing(
  actorClient: {
    rpc: (
      name: string,
      args: Record<string, unknown>,
    ) => Promise<{ data: unknown; error: unknown }>;
  },
  args: Record<string, unknown>,
): Promise<RpcOutcome> {
  const outcome: RpcOutcome = { caught: null, succeededData: undefined };
  try {
    const { data, error } = await actorClient.rpc(
      "submit_offline_payment",
      args,
    );
    if (error !== null && error !== undefined) {
      outcome.caught = error;
    } else {
      outcome.succeededData = data;
    }
  } catch (thrown) {
    outcome.caught = thrown;
  }
  return outcome;
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
    ctx.residentBillId = billId;
    ctx.residentAmount = ctx.residentSubmitAmount;
    ctx.residentReference = ctx.residentSubmitReference;
    ctx.residentIdempotencyKey = ctx.residentSubmitIdempotencyKey;

    const rawSummary = await fixture.helpers.getBillSummary(
      fixture.users.adminA1,
      billId,
    );
    const initial = parseBillSummary(rawSummary, "resident-submit-01");
    assertCleanBaseline(initial, "RESIDENT-SUBMIT-01");
    const strictParsed = ResidentBillSummarySchema.safeParse(rawSummary);
    if (!strictParsed.success)
      throw new Error(
        "[stage3c:RESIDENT-SUBMIT-01] bill summary payload rejected by strict schema",
      );
    const strictInitial: ResidentBillSummary = strictParsed.data;
    if (strictInitial.bill_id !== billId)
      throw new Error(
        "[stage3c:RESIDENT-SUBMIT-01] summary bill_id identity mismatch",
      );
    if (strictInitial.society_id !== fixture.societyA)
      throw new Error(
        "[stage3c:RESIDENT-SUBMIT-01] summary society_id identity mismatch",
      );
    expect(strictInitial.total_payable).toBe(1200);
    expect(strictInitial.rejected_amount).toBe(0);
    expect(strictInitial.reversed_amount).toBe(0);
    expect(strictInitial.remaining_verified_balance).toBe(1200);
    expect(strictInitial.cancelled).toBe(false);
    expect(["unpaid", "open"]).toContain(strictInitial.status);

    ctx.residentSubmitInitialSummary = strictInitial;
    ctx.residentBaselineSummary = initial;

    ctx.residentSubmitInitialReceiptSequences = await snapshotReceiptSequences(
      fixture.admin,
      fixture.societyA,
      "RESIDENT-SUBMIT-01",
    );

    const preCount = await fixture.helpers.countPayments(billId);
    expect(
      preCount,
      "RESIDENT-SUBMIT-01: no pre-existing payments on dedicated bill",
    ).toBe(0);
  };

// ---------------------------------------------------------------------------
// RESIDENT-SUBMIT-02
// ---------------------------------------------------------------------------

export const residentSubmit02_submitBankTransfer: Stage3CResidentSubmitHandler =
  async (ctx) => {
    const fixture = requireMatrixFixture(ctx);
    const amount = requireResidentSubmitAmount(ctx);
    const reference = requireResidentSubmitReference(ctx);
    const idempotencyKey = requireResidentSubmitIdempotencyKey(ctx);
    const billId = fixture.matrix.residentSubmitBillId;

    const parsed = residentSubmitInputSchema.parse({
      billId,
      amount,
      paymentDate: fixture.testPaymentDate,
      referenceNo: reference,
      idempotencyKey,
    });

    // fixture.helpers.submitResidentBankTransferPayment delegates to
    // submitResidentBankTransferWithClient — identical code path to the
    // production server function.
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

export const residentSubmit03_pendingRowAndNoReceipt: Stage3CResidentSubmitHandler =
  async (ctx) => {
    const fixture = requireMatrixFixture(ctx);
    const paymentId = requireResidentSubmitPaymentId(ctx);
    const billId = fixture.matrix.residentSubmitBillId;
    const reference = requireResidentSubmitReference(ctx);
    const idempotencyKey = requireResidentSubmitIdempotencyKey(ctx);
    const amount = requireResidentSubmitAmount(ctx);

    const { data, error } = await fixture.admin
      .from("payments")
      .select(
        "id, bill_id, society_id, submitted_by, amount, method, status, source, reference_no, idempotency_key, verified_by, verified_at, rejected_by, rejected_at, rejection_reason, reversed_by, reversed_at, reversal_reason",
      )
      .eq("id", paymentId)
      .single();
    expect(error, "RESIDENT-SUBMIT-03: query error").toBeNull();
    expect(data, "RESIDENT-SUBMIT-03: row present").not.toBeNull();

    const parsedRow = ResidentSubmittedPaymentRowSchema.parse(data);
    expect(parsedRow.society_id, "RESIDENT-SUBMIT-03: society").toBe(
      fixture.societyA,
    );
    expect(parsedRow.bill_id, "RESIDENT-SUBMIT-03: bill").toBe(billId);
    expect(parsedRow.submitted_by, "RESIDENT-SUBMIT-03: submitter").toBe(
      fixture.users.activeResident.id,
    );
    expect(
      parsedRow.method,
      "RESIDENT-SUBMIT-03: server-pinned bank_transfer",
    ).toBe("bank_transfer");
    expect(parsedRow.status, "RESIDENT-SUBMIT-03: pending").toBe("pending");
    expect(
      parsedRow.source,
      "RESIDENT-SUBMIT-03: server-pinned source",
    ).toBe("resident_submission");
    expect(
      deriveActorRoleFromSource(parsedRow.source),
      "RESIDENT-SUBMIT-03: derived actor_role",
    ).toBe("resident");
    expect(parsedRow.amount, "RESIDENT-SUBMIT-03: amount").toBe(amount);
    expect(parsedRow.reference_no, "RESIDENT-SUBMIT-03: reference").toBe(
      reference,
    );
    expect(parsedRow.idempotency_key, "RESIDENT-SUBMIT-03: idempotency key").toBe(
      idempotencyKey,
    );

    const assertion = parsePaymentAssertionRow(
      {
        society_id: parsedRow.society_id,
        flat_id: fixture.flatA,
        bill_id: parsedRow.bill_id,
        method: parsedRow.method,
        submitted_by: parsedRow.submitted_by,
        status: parsedRow.status,
      },
      "resident-submit-03",
    );
    expect(assertion.status).toBe("pending");

    await assertNoReceiptForResidentPayment(
      fixture.admin,
      paymentId,
      "RESIDENT-SUBMIT-03",
    );
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
    const pendingId = requireResidentSubmitPaymentId(ctx);

    // A. Public boundary rejection.
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
      const res = residentSubmitInputSchema.safeParse({ ...baseValid, ...extra });
      expect(
        res.success,
        `RESIDENT-SUBMIT-04: public schema must reject "${name}"`,
      ).toBe(false);
    }

    // B. Cash-as-resident RPC denial — full bill-state snapshot pre/post.
    const before = await snapshotResidentBillState(
      fixture.admin,
      fixture.users.adminA1.client,
      billId,
      fixture.societyA,
      "RESIDENT-SUBMIT-04",
    );
    const outcome = await invokeRpcCapturing(fixture.users.activeResident.client, {
      _bill_id: billId,
      _method: "cash",
      _amount: amount,
      _payment_date: fixture.testPaymentDate,
      _reference_no: null,
      _notes: null,
      _idempotency_key: `${fixture.prefix}-rs04-cash`,
      _actor_role: "resident",
    });
    if (outcome.caught === null) {
      // Thrown OUTSIDE catch — cannot be misinterpreted as canonical error.
      const parsedId = z.string().uuid().safeParse(outcome.succeededData);
      throw new Error(
        `RESIDENT-SUBMIT-04: cash submission must be denied — unexpected success${
          parsedId.success ? " (id redacted)" : ""
        }: ${safeStage3CErrorMessage("RESIDENT-SUBMIT-04", "no server error surfaced")}`,
      );
    }
    assertCanonicalError(
      outcome.caught,
      STAGE3C_ERRORS.RESIDENT_CASH_NOT_ALLOWED,
      "RESIDENT-SUBMIT-04",
    );

    const after = await snapshotResidentBillState(
      fixture.admin,
      fixture.users.adminA1.client,
      billId,
      fixture.societyA,
      "RESIDENT-SUBMIT-04",
    );
    assertResidentBillStateUnchanged(before, after, "RESIDENT-SUBMIT-04");
    await assertNoReceiptForResidentPayment(
      fixture.admin,
      pendingId,
      "RESIDENT-SUBMIT-04",
    );
  };

// ---------------------------------------------------------------------------
// Shared denial helper for RESIDENT-SUBMIT-05..07
// ---------------------------------------------------------------------------

type DenialInput = {
  label: string;
  ctx: Stage3CLiveMatrixContext;
  actorClient: {
    rpc: (
      name: string,
      args: Record<string, unknown>,
    ) => Promise<{ data: unknown; error: unknown }>;
  };
  billId: string;
  suffix: string;
};

async function attemptResidentSubmitAndAssertDenied(
  input: DenialInput,
): Promise<void> {
  const { label, ctx, actorClient, billId, suffix } = input;
  const fixture = requireMatrixFixture(ctx);
  const amount = requireResidentSubmitAmount(ctx);

  const before = await snapshotResidentBillState(
    fixture.admin,
    fixture.users.adminA1.client,
    billId,
    fixture.societyA,
    label,
  );
  const outcome = await invokeRpcCapturing(actorClient, {
    _bill_id: billId,
    _method: "bank_transfer",
    _amount: amount,
    _payment_date: fixture.testPaymentDate,
    _reference_no: `RS-${safeSuffix(fixture.prefix)}-${suffix}`,
    _notes: null,
    _idempotency_key: `resident-submit-${safeSuffix(fixture.prefix)}-${suffix}`,
    _actor_role: "resident",
  });
  if (outcome.caught === null) {
    const parsedId = z.string().uuid().safeParse(outcome.succeededData);
    throw new Error(
      `${label}: unexpected success${parsedId.success ? " (id redacted)" : ""}: ${safeStage3CErrorMessage(
        label,
        "no server error surfaced",
      )}`,
    );
  }
  assertCanonicalError(outcome.caught, STAGE3C_ERRORS.NOT_AUTHORIZED, label);

  const after = await snapshotResidentBillState(
    fixture.admin,
    fixture.users.adminA1.client,
    billId,
    fixture.societyA,
    label,
  );
  assertResidentBillStateUnchanged(before, after, label);
}

// ---------------------------------------------------------------------------
// RESIDENT-SUBMIT-05 — same-society other flat
// ---------------------------------------------------------------------------

export const residentSubmit05_otherFlatDenied: Stage3CResidentSubmitHandler =
  async (ctx) => {
    const fixture = requireMatrixFixture(ctx);
    const otherFlatBillId = fixture.matrix.otherFlatBillId;

    await attemptResidentSubmitAndAssertDenied({
      label: "RESIDENT-SUBMIT-05",
      ctx,
      actorClient: fixture.users.activeResident.client,
      billId: otherFlatBillId,
      suffix: "otherflat",
    });

    const raw = await fixture.helpers.getBillSummary(
      fixture.users.adminA1,
      otherFlatBillId,
    );
    const summary = parseBillSummary(raw, "resident-submit-05");
    expect(summary.total_payable, "RESIDENT-SUBMIT-05: total").toBe(900);
    expect(summary.verified_amount, "RESIDENT-SUBMIT-05: verified").toBe(0);
    expect(summary.pending_amount, "RESIDENT-SUBMIT-05: pending").toBe(0);
    expect(summary.available_to_submit, "RESIDENT-SUBMIT-05: available").toBe(
      900,
    );
    expect(
      summaryField(raw, "rejected_amount", "RESIDENT-SUBMIT-05"),
    ).toBe(0);
    expect(
      summaryField(raw, "reversed_amount", "RESIDENT-SUBMIT-05"),
    ).toBe(0);
    expect(
      summaryField(raw, "remaining_verified_balance", "RESIDENT-SUBMIT-05"),
    ).toBe(900);
    expect((raw as Record<string, unknown>).cancelled).toBe(false);
  };

// ---------------------------------------------------------------------------
// RESIDENT-SUBMIT-06 — moved-out resident (prove via flat_residents)
// ---------------------------------------------------------------------------

export const residentSubmit06_movedOutResidentDenied: Stage3CResidentSubmitHandler =
  async (ctx) => {
    const fixture = requireMatrixFixture(ctx);
    const billId = fixture.matrix.residentSubmitBillId;
    const priorPendingId = requireResidentSubmitPaymentId(ctx);

    // Proof of moved-out state via strict schema (all rows for user+flat).
    const historic = await fixture.admin
      .from("flat_residents")
      .select("id, user_id, flat_id, is_active, moved_out_at")
      .eq("user_id", fixture.users.movedOutResident.id)
      .eq("flat_id", fixture.flatA);
    if (historic.error)
      throw new Error(
        safeStage3CErrorMessage(
          "RESIDENT-SUBMIT-06-flat_residents",
          historic.error,
        ),
      );
    assertCanonicalMovedOutRelationship(
      historic.data,
      {
        expectedUserId: fixture.users.movedOutResident.id,
        expectedFlatId: fixture.flatA,
      },
      "RESIDENT-SUBMIT-06",
    );

    await attemptResidentSubmitAndAssertDenied({
      label: "RESIDENT-SUBMIT-06",
      ctx,
      actorClient: fixture.users.movedOutResident.client,
      billId,
      suffix: "movedout",
    });

    const postCount = await fixture.helpers.countPayments(billId);
    expect(
      postCount,
      "RESIDENT-SUBMIT-06: exactly one pending payment on dedicated bill",
    ).toBe(1);
    await assertNoReceiptForResidentPayment(
      fixture.admin,
      priorPendingId,
      "RESIDENT-SUBMIT-06",
    );
  };

// ---------------------------------------------------------------------------
// RESIDENT-SUBMIT-07 — cross-society (Society B) resident
// ---------------------------------------------------------------------------

export const residentSubmit07_crossSocietyResidentDenied: Stage3CResidentSubmitHandler =
  async (ctx) => {
    const fixture = requireMatrixFixture(ctx);
    const billId = fixture.matrix.residentSubmitBillId;

    await attemptResidentSubmitAndAssertDenied({
      label: "RESIDENT-SUBMIT-07",
      ctx,
      actorClient: fixture.users.unrelatedResident.client,
      billId,
      suffix: "crosssoc",
    });

    const postCount = await fixture.helpers.countPayments(billId);
    expect(
      postCount,
      "RESIDENT-SUBMIT-07: exactly one pending payment",
    ).toBe(1);
  };

// ---------------------------------------------------------------------------
// RESIDENT-SUBMIT-08 — exact summary delta + sequences unchanged
// ---------------------------------------------------------------------------

export const residentSubmit08_exactSummaryDelta: Stage3CResidentSubmitHandler =
  async (ctx) => {
    const fixture = requireMatrixFixture(ctx);
    const billId = fixture.matrix.residentSubmitBillId;
    const initial = requireResidentSubmitInitialSummary(ctx);
    const amount = requireResidentSubmitAmount(ctx);
    const paymentId = requireResidentSubmitPaymentId(ctx);
    const initialSeq = requireResidentSubmitInitialReceiptSequences(ctx);

    const raw = await fixture.helpers.getBillSummary(
      fixture.users.adminA1,
      billId,
    );
    const parsed = ResidentBillSummarySchema.safeParse(raw);
    if (!parsed.success)
      throw new Error(
        "[stage3c:RESIDENT-SUBMIT-08] bill summary payload rejected by strict schema",
      );
    const finalSummary: ResidentBillSummary = parsed.data;
    if (finalSummary.bill_id !== billId)
      throw new Error(
        "[stage3c:RESIDENT-SUBMIT-08] summary bill_id identity mismatch",
      );
    if (finalSummary.society_id !== fixture.societyA)
      throw new Error(
        "[stage3c:RESIDENT-SUBMIT-08] summary society_id identity mismatch",
      );

    assertResidentPendingDelta(initial, finalSummary, amount, "RESIDENT-SUBMIT-08");

    // Strict payment status counts via parser (no filter fallbacks).
    const rowsRes = await fixture.admin
      .from("payments")
      .select("id, status")
      .eq("bill_id", billId);
    if (rowsRes.error)
      throw new Error(
        safeStage3CErrorMessage("RESIDENT-SUBMIT-08-payments", rowsRes.error),
      );
    const statusRows = parseResidentPaymentStatusRows(
      rowsRes.data,
      "RESIDENT-SUBMIT-08",
    );
    if (statusRows.length !== 1)
      throw new Error(
        `[stage3c:RESIDENT-SUBMIT-08] expected exactly 1 payment row, got ${statusRows.length}`,
      );
    if (statusRows[0]!.status !== "pending")
      throw new Error(
        `[stage3c:RESIDENT-SUBMIT-08] sole payment status must be pending, got ${statusRows[0]!.status}`,
      );
    if (statusRows[0]!.id !== paymentId)
      throw new Error(
        "[stage3c:RESIDENT-SUBMIT-08] sole payment id must equal residentSubmitPaymentId",
      );

    await assertNoReceiptForResidentPayment(
      fixture.admin,
      paymentId,
      "RESIDENT-SUBMIT-08",
    );

    const afterSeq = await snapshotReceiptSequences(
      fixture.admin,
      fixture.societyA,
      "RESIDENT-SUBMIT-08",
    );
    assertReceiptSequencesExactlyEqual(initialSeq, afterSeq, "RESIDENT-SUBMIT-08");

    ctx.residentSubmitPendingSummary = finalSummary;
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
