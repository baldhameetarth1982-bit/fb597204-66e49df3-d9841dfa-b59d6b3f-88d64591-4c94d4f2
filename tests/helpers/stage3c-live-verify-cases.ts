/**
 * Stage 3C — Live VERIFY-01..VERIFY-09 case handlers.
 *
 * Separation-of-duties enforcement: the submitting admin (A1) may never
 * verify their own payment. Admin A2 verifies. Balance deltas are
 * asserted against the post-pending summary. Receipt shape is checked
 * with an anchored regex tied to the receipt's actual UTC creation
 * month.
 */
import { expect } from "vitest";
import type { Stage3CFixture } from "./stage3c-runtime-fixtures";
import {
  parseBillSummary,
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

const SELF_VERIFY_MSG = /self_verification_not_allowed|self.verif|same_user/i;
const ALREADY_VERIFIED_MSG =
  /already_verified|invalid_status|not_pending|already_processed|payment_not_pending/i;
const RECEIPT_NUMBER_RE = /^RCPT\/(\d{6})\/\d{4}$/;

export async function verify01_submitterCannotSelfVerify(
  ctx: Stage3CLiveCoreContext,
): Promise<void> {
  const fixture = requireFixture(ctx);
  const paymentId = requirePendingPaymentId(ctx);
  const { error } = await fixture.users.adminA1.client.rpc("verify_offline_payment", {
    _payment_id: paymentId,
    _notes: null,
  });
  expect(error, "VERIFY-01: submitter self-verify must be denied").not.toBeNull();
  expect(error!.message, "VERIFY-01: canonical denial token").toMatch(SELF_VERIFY_MSG);
}

export async function verify02_adminA2Verifies(ctx: Stage3CLiveCoreContext): Promise<void> {
  const fixture = requireFixture(ctx);
  const paymentId = requirePendingPaymentId(ctx);
  await fixture.helpers.verifyPayment(fixture.users.adminA2, paymentId, "core VERIFY-02");
}

export async function verify_capturePostVerifySummaryAndReceipt(
  ctx: Stage3CLiveCoreContext,
): Promise<void> {
  const fixture = requireFixture(ctx);
  const billId = requireBillId(ctx);
  const paymentId = requirePendingPaymentId(ctx);
  const rawSummary = await fixture.helpers.getBillSummary(fixture.users.adminA1, billId);
  ctx.postVerifySummary = parseBillSummary(rawSummary);

  const { data, error } = await fixture.admin
    .from("payment_receipts")
    .select("id, receipt_number, created_at")
    .eq("payment_id", paymentId);
  expect(error, "post-verify receipt fetch must not error").toBeNull();
  const rows = (data ?? []) as Array<{ id: string; receipt_number: string; created_at: string }>;
  if (rows.length !== 1)
    throw new Error(
      `[stage3c:core] expected exactly one receipt after VERIFY-02, got ${rows.length}`,
    );
  ctx.verifiedReceiptNumber = rows[0].receipt_number;
  ctx.verifiedReceiptCreatedAt = rows[0].created_at;
  fixture.tracked.paymentReceiptIds.push(rows[0].id);
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
  const count = await fixture.helpers.countReceipts(paymentId);
  expect(count, "VERIFY-06").toBe(1);
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
  expect(error, "VERIFY-08: repeated verify must be denied").not.toBeNull();
  expect(error!.message).toMatch(ALREADY_VERIFIED_MSG);
}

export async function verify09_receiptStillExactlyOne(
  ctx: Stage3CLiveCoreContext,
): Promise<void> {
  const fixture = requireFixture(ctx);
  const paymentId = requirePendingPaymentId(ctx);
  const count = await fixture.helpers.countReceipts(paymentId);
  expect(count, "VERIFY-09").toBe(1);
}
