/**
 * Stage 3C — Live VERIFY-01..VERIFY-09 case handlers.
 *
 * Separation-of-duties: A1 (submitter) may never verify their own
 * payment. A2 verifies. Balance deltas are asserted against the
 * post-pending summary captured in PENDING-06. Receipt shape is
 * verified against an anchored regex tied to the receipt's UTC month.
 * There is no unnumbered lifecycle-only step — VERIFY-03 owns the post-verify
 * summary fetch and VERIFY-06 owns the receipt lookup.
 */
import { expect } from "vitest";
import {
  parseBillSummary,
  parseReceiptAssertionRow,
  requireBillId,
  requireFixture,
  requirePendingAmount,
  requirePendingPaymentId,
  requirePostPendingSummary,
  requirePostVerifySummary,
  requireVerifiedReceiptCreatedAt,
  requireVerifiedReceiptNumber,
  type Stage3CLiveCoreContext,
} from "./stage3c-live-core-context";
import { trackUniqueId } from "./stage3c-runtime-fixtures";
import { STAGE3C_ERRORS, matchesCanonicalError } from "./stage3c-live-errors";

const RECEIPT_NUMBER_RE = /^RCPT\/(\d{6})\/\d{4}$/;

function expectCanonical(err: unknown, token: string, label: string): void {
  expect(err, `${label}: must receive a real error`).not.toBeNull();
  const msg = String((err as { message?: unknown } | null)?.message ?? "");
  expect(
    matchesCanonicalError(msg, token as (typeof STAGE3C_ERRORS)[keyof typeof STAGE3C_ERRORS]),
    `${label}: expected canonical "${token}", got: ${msg}`,
  ).toBe(true);
}

export async function verify01_submitterCannotSelfVerify(
  ctx: Stage3CLiveCoreContext,
): Promise<void> {
  const fixture = requireFixture(ctx);
  const paymentId = requirePendingPaymentId(ctx);
  const { error } = await fixture.users.adminA1.client.rpc("verify_offline_payment", {
    _payment_id: paymentId,
    _notes: null,
  });
  expectCanonical(error, STAGE3C_ERRORS.SELF_VERIFICATION_NOT_ALLOWED, "VERIFY-01");
}

export async function verify02_adminA2Verifies(ctx: Stage3CLiveCoreContext): Promise<void> {
  const fixture = requireFixture(ctx);
  const paymentId = requirePendingPaymentId(ctx);
  await fixture.helpers.verifyPayment(fixture.users.adminA2, paymentId, "core VERIFY-02");
}

export async function verify03_statusVerified(ctx: Stage3CLiveCoreContext): Promise<void> {
  const fixture = requireFixture(ctx);
  const paymentId = requirePendingPaymentId(ctx);
  const { data, error } = await fixture.admin
    .from("payments")
    .select("status")
    .eq("id", paymentId)
    .single();
  expect(error).toBeNull();
  expect(data!.status, "VERIFY-03").toBe("verified");
  // Capture post-verify summary for VERIFY-04 / VERIFY-05.
  const billId = requireBillId(ctx);
  const raw = await fixture.helpers.getBillSummary(fixture.users.adminA1, billId);
  ctx.postVerifySummary = parseBillSummary(raw, "verify-03");
}

export async function verify04_pendingAmountDecreasesExactly(
  ctx: Stage3CLiveCoreContext,
): Promise<void> {
  const before = requirePostPendingSummary(ctx);
  const after = requirePostVerifySummary(ctx);
  const amount = requirePendingAmount(ctx);
  expect(before.pending_amount - after.pending_amount, "VERIFY-04").toBeCloseTo(amount, 6);
}

export async function verify05_verifiedAmountIncreasesExactly(
  ctx: Stage3CLiveCoreContext,
): Promise<void> {
  const before = requirePostPendingSummary(ctx);
  const after = requirePostVerifySummary(ctx);
  const amount = requirePendingAmount(ctx);
  expect(after.verified_amount - before.verified_amount, "VERIFY-05").toBeCloseTo(amount, 6);
}

export async function verify06_exactlyOneReceipt(ctx: Stage3CLiveCoreContext): Promise<void> {
  const fixture = requireFixture(ctx);
  const paymentId = requirePendingPaymentId(ctx);
  const { data, error } = await fixture.admin
    .from("payment_receipts")
    .select("id, receipt_number, status, created_at")
    .eq("payment_id", paymentId);
  expect(error, "VERIFY-06: receipt query must not error").toBeNull();
  const rows = (data ?? []) as unknown[];
  expect(rows.length, "VERIFY-06: exactly one receipt").toBe(1);
  const parsed = parseReceiptAssertionRow(rows[0], "verify-06");
  ctx.verifiedReceiptId = parsed.id;
  ctx.verifiedReceiptNumber = parsed.receipt_number;
  ctx.verifiedReceiptCreatedAt = parsed.created_at;
  trackUniqueId(fixture.tracked.paymentReceiptIds, parsed.id, "VERIFY-06:receiptId");
}

export async function verify07_receiptNumberFormat(ctx: Stage3CLiveCoreContext): Promise<void> {
  const number = requireVerifiedReceiptNumber(ctx);
  const createdAt = requireVerifiedReceiptCreatedAt(ctx);
  const m = number.match(RECEIPT_NUMBER_RE);
  expect(m, `VERIFY-07: receipt number ${number} must match RCPT/YYYYMM/####`).not.toBeNull();
  const yyyymm = m![1];
  const d = new Date(createdAt);
  const expected =
    d.getUTCFullYear().toString().padStart(4, "0") +
    (d.getUTCMonth() + 1).toString().padStart(2, "0");
  expect(yyyymm, "VERIFY-07: YYYYMM must match receipt created_at UTC month").toBe(expected);
}

export async function verify08_repeatedVerificationDenied(
  ctx: Stage3CLiveCoreContext,
): Promise<void> {
  const fixture = requireFixture(ctx);
  const paymentId = requirePendingPaymentId(ctx);
  const { error } = await fixture.users.adminA2.client.rpc("verify_offline_payment", {
    _payment_id: paymentId,
    _notes: null,
  });
  expectCanonical(error, STAGE3C_ERRORS.PAYMENT_NOT_PENDING, "VERIFY-08");
}

export async function verify09_receiptStillExactlyOne(
  ctx: Stage3CLiveCoreContext,
): Promise<void> {
  const fixture = requireFixture(ctx);
  const paymentId = requirePendingPaymentId(ctx);
  const count = await fixture.helpers.countReceipts(paymentId);
  expect(count, "VERIFY-09").toBe(1);
}
