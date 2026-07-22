/**
 * Stage 3C — Live PENDING-01..PENDING-08 case handlers.
 *
 * Uses the shared fixture's canonical `submitAdminCashPayment` helper —
 * method and actor role are pinned server-side. Baseline capture,
 * amount selection, and post-summary reads are owned by the numbered
 * cases below; there is no unnumbered lifecycle-only step.
 *
 * PENDING-05 asserts the exact canonical unchanged `verified_amount`
 * (a.k.a. balance_paid) — not just `bills.status != 'paid'`.
 */
import { expect } from "vitest";
import {
  parseBillSummary,
  parsePaymentAssertionRow,
  requireBaselineSummary,
  requireBillId,
  requireFixture,
  requirePendingAmount,
  requirePendingPaymentId,
  requirePostPendingSummary,
  type Stage3CLiveCoreContext,
} from "./stage3c-live-core-context";
import { trackUniqueId } from "./stage3c-runtime-fixtures";
import { STAGE3C_ERRORS, matchesCanonicalError } from "./stage3c-live-errors";

export async function pending01_adminA1RecordsCashPayment(
  ctx: Stage3CLiveCoreContext,
): Promise<void> {
  const fixture = requireFixture(ctx);
  ctx.billId = fixture.openBillId;
  const raw = await fixture.helpers.getBillSummary(fixture.users.adminA1, fixture.openBillId);
  const baseline = parseBillSummary(raw, "pending-01");
  if (baseline.available_to_submit <= 0)
    throw new Error("[stage3c:pending-01] available_to_submit must be positive");
  ctx.baselineSummary = baseline;
  const amount = Math.max(1, Math.floor(baseline.available_to_submit / 2));
  ctx.pendingAmount = amount;

  const id = await fixture.helpers.submitAdminCashPayment({
    actor: fixture.users.adminA1,
    billId: fixture.openBillId,
    amount,
    paymentDate: fixture.testPaymentDate,
    idempotencyKey: `${fixture.prefix}-core-pending-01`,
    notes: "core PENDING-01",
  });
  expect(typeof id, "PENDING-01: id string").toBe("string");
  ctx.pendingPaymentId = id;
  trackUniqueId(fixture.tracked.paymentIds, id, "PENDING-01:paymentId");
}

export async function pending02_ownershipMatchesActorSocietyBillMethod(
  ctx: Stage3CLiveCoreContext,
): Promise<void> {
  const fixture = requireFixture(ctx);
  const paymentId = requirePendingPaymentId(ctx);
  const billId = requireBillId(ctx);
  const { data, error } = await fixture.admin
    .from("payments")
    .select("society_id, flat_id, bill_id, method, submitted_by, status")
    .eq("id", paymentId)
    .single();
  expect(error, "PENDING-02: payment row must exist").toBeNull();
  const row = parsePaymentAssertionRow(data, "pending-02");
  expect(row.society_id, "PENDING-02: society_id").toBe(fixture.societyA);
  expect(row.flat_id, "PENDING-02: flat_id").toBe(fixture.flatA);
  expect(row.bill_id, "PENDING-02: bill_id").toBe(billId);
  expect(row.method.toLowerCase(), "PENDING-02: server-pinned Cash method").toBe("cash");
  expect(row.submitted_by, "PENDING-02: submitter is admin A1").toBe(fixture.users.adminA1.id);
}

export async function pending03_statusIsPending(ctx: Stage3CLiveCoreContext): Promise<void> {
  const fixture = requireFixture(ctx);
  const paymentId = requirePendingPaymentId(ctx);
  const { data, error } = await fixture.admin
    .from("payments")
    .select("society_id, flat_id, bill_id, method, submitted_by, status")
    .eq("id", paymentId)
    .single();
  expect(error).toBeNull();
  const row = parsePaymentAssertionRow(data, "pending-03");
  expect(row.status, "PENDING-03: status must be pending").toBe("pending");
  expect(row.bill_id, "PENDING-03: bill_id").toBe(requireBillId(ctx));
}

export async function pending04_noReceiptYet(ctx: Stage3CLiveCoreContext): Promise<void> {
  const fixture = requireFixture(ctx);
  const paymentId = requirePendingPaymentId(ctx);
  const count = await fixture.helpers.countReceipts(paymentId);
  expect(count, "PENDING-04: no receipt at submission").toBe(0);
}

/**
 * PENDING-05 — Bill balance_paid does not change from a pending payment.
 *
 * `verified_amount` on `get_bill_payment_summary` is the canonical
 * balance-paid figure. The primary assertion is exact numeric equality
 * with the PENDING-01 baseline; the bill's terminal-status check is a
 * secondary assertion. The post-pending summary is also captured here
 * so PENDING-06 / PENDING-07 have a single canonical snapshot.
 */
export async function pending05_billNotPaid(ctx: Stage3CLiveCoreContext): Promise<void> {
  const fixture = requireFixture(ctx);
  const billId = requireBillId(ctx);
  const baseline = requireBaselineSummary(ctx);

  const raw = await fixture.helpers.getBillSummary(fixture.users.adminA1, billId);
  const after = parseBillSummary(raw, "pending-05");
  ctx.postPendingSummary = after;

  expect(
    after.verified_amount,
    "PENDING-05: verified_amount (balance_paid) must equal baseline exactly",
  ).toBeCloseTo(baseline.verified_amount, 6);

  const { data, error } = await fixture.admin
    .from("bills")
    .select("status")
    .eq("id", billId)
    .single();
  expect(error).toBeNull();
  const status = String((data as { status: string } | null)?.status ?? "");
  expect(status, "PENDING-05: bill must not transition to paid on a pending payment").not.toBe(
    "paid",
  );
}

export async function pending06_pendingAmountIncreasesExactly(
  ctx: Stage3CLiveCoreContext,
): Promise<void> {
  const baseline = requireBaselineSummary(ctx);
  const after = requirePostPendingSummary(ctx);
  const amount = requirePendingAmount(ctx);
  expect(after.pending_amount - baseline.pending_amount, "PENDING-06 delta").toBeCloseTo(
    amount,
    6,
  );
}

export async function pending07_availableDecreasesExactly(
  ctx: Stage3CLiveCoreContext,
): Promise<void> {
  const baseline = requireBaselineSummary(ctx);
  const after = requirePostPendingSummary(ctx);
  const amount = requirePendingAmount(ctx);
  expect(baseline.available_to_submit - after.available_to_submit, "PENDING-07 delta").toBeCloseTo(
    amount,
    6,
  );
}

export async function pending08_overAllocationRejected(
  ctx: Stage3CLiveCoreContext,
): Promise<void> {
  const fixture = requireFixture(ctx);
  const billId = requireBillId(ctx);
  const after = requirePostPendingSummary(ctx);
  const beforeCount = await fixture.helpers.countPayments(billId);
  const attempt = after.available_to_submit + 1;
  let threw = false;
  try {
    await fixture.helpers.submitAdminCashPayment({
      actor: fixture.users.adminA1,
      billId,
      amount: attempt,
      paymentDate: fixture.testPaymentDate,
      idempotencyKey: `${fixture.prefix}-core-pending-08-over`,
    });
  } catch (err) {
    threw = true;
    const msg = err instanceof Error ? err.message : String(err);
    expect(
      matchesCanonicalError(msg, STAGE3C_ERRORS.AMOUNT_EXCEEDS_AVAILABLE),
      `PENDING-08: canonical over-allocation "${STAGE3C_ERRORS.AMOUNT_EXCEEDS_AVAILABLE}", got: ${msg}`,
    ).toBe(true);
  }
  expect(threw, "PENDING-08: over-allocation must throw").toBe(true);
  const afterCount = await fixture.helpers.countPayments(billId);
  expect(afterCount, "PENDING-08: no new payment row from denied over-allocation").toBe(
    beforeCount,
  );
}
