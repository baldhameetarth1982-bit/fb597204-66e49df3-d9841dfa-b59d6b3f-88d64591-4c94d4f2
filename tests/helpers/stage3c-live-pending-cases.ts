/**
 * Stage 3C — Live PENDING-01..PENDING-08 case handlers.
 *
 * Uses the shared fixture's canonical `submitAdminCashPayment` helper —
 * method and actor role are pinned server-side. Baseline and post
 * summaries flow through the typed core context so every delta
 * assertion has a real predecessor.
 */
import { expect } from "vitest";
import type { Stage3CFixture } from "./stage3c-runtime-fixtures";
import {
  parseBillSummary,
  requireBaselineSummary,
  requireBillId,
  requireFixture,
  requirePendingAmount,
  requirePendingPaymentId,
  requirePostPendingSummary,
  type Stage3CLiveCoreContext,
} from "./stage3c-live-core-context";

const OVER_ALLOC_MSG = /amount_exceeds_available|over_allocation|available|exceed/i;

export async function pending_captureBaselineAndPickAmount(
  ctx: Stage3CLiveCoreContext,
): Promise<void> {
  const fixture = requireFixture(ctx);
  ctx.billId = fixture.openBillId;
  const raw = await fixture.helpers.getBillSummary(fixture.users.adminA1, fixture.openBillId);
  const baseline = parseBillSummary(raw);
  if (baseline.available_to_submit <= 0)
    throw new Error("[stage3c:pending-baseline] available_to_submit must be positive");
  ctx.baselineSummary = baseline;
  // Deterministic amount: half of available (rounded down to whole rupees).
  const chosen = Math.max(1, Math.floor(baseline.available_to_submit / 2));
  ctx.pendingAmount = chosen;
}

export async function pending01_adminA1RecordsCashPayment(
  ctx: Stage3CLiveCoreContext,
): Promise<void> {
  const fixture = requireFixture(ctx);
  const billId = requireBillId(ctx);
  const amount = requirePendingAmount(ctx);
  const id = await fixture.helpers.submitAdminCashPayment({
    actor: fixture.users.adminA1,
    billId,
    amount,
    paymentDate: "2026-02-10",
    idempotencyKey: `${fixture.prefix}-core-pending-01`,
    notes: "core PENDING-01",
  });
  expect(typeof id).toBe("string");
  expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
  ctx.pendingPaymentId = id;
  fixture.tracked.paymentIds.push(id);
}

export async function pending02_ownershipMatchesActorSocietyBillMethod(
  ctx: Stage3CLiveCoreContext,
): Promise<void> {
  const fixture = requireFixture(ctx);
  const paymentId = requirePendingPaymentId(ctx);
  const billId = requireBillId(ctx);
  const { data, error } = await fixture.admin
    .from("payments")
    .select("society_id, flat_id, bill_id, method, submitted_by")
    .eq("id", paymentId)
    .single();
  expect(error, "PENDING-02: payment row must exist").toBeNull();
  expect(data, "PENDING-02: payment row present").toBeTruthy();
  expect(data!.society_id, "PENDING-02: society_id").toBe(fixture.societyA);
  expect(data!.flat_id, "PENDING-02: flat_id").toBe(fixture.flatA);
  expect(data!.bill_id, "PENDING-02: bill_id").toBe(billId);
  expect(String(data!.method).toLowerCase(), "PENDING-02: server-pinned Cash method").toBe("cash");
  expect(data!.submitted_by, "PENDING-02: submitter is admin A1").toBe(fixture.users.adminA1.id);
}

export async function pending03_statusIsPending(ctx: Stage3CLiveCoreContext): Promise<void> {
  const fixture = requireFixture(ctx);
  const paymentId = requirePendingPaymentId(ctx);
  const { data, error } = await fixture.admin
    .from("payments")
    .select("status")
    .eq("id", paymentId)
    .single();
  expect(error).toBeNull();
  expect(data!.status, "PENDING-03: status must be pending").toBe("pending");
}

export async function pending04_noReceiptYet(ctx: Stage3CLiveCoreContext): Promise<void> {
  const fixture = requireFixture(ctx);
  const paymentId = requirePendingPaymentId(ctx);
  const count = await fixture.helpers.countReceipts(paymentId);
  expect(count, "PENDING-04: no receipt at submission").toBe(0);
}

export async function pending05_billNotPaid(ctx: Stage3CLiveCoreContext): Promise<void> {
  const fixture = requireFixture(ctx);
  const billId = requireBillId(ctx);
  const { data, error } = await fixture.admin
    .from("bills")
    .select("status")
    .eq("id", billId)
    .single();
  expect(error).toBeNull();
  expect(data!.status, "PENDING-05: bill must not become paid from a pending payment").not.toBe(
    "paid",
  );
}

export async function pending_capturePostPendingSummary(
  ctx: Stage3CLiveCoreContext,
): Promise<void> {
  const fixture = requireFixture(ctx);
  const billId = requireBillId(ctx);
  const raw = await fixture.helpers.getBillSummary(fixture.users.adminA1, billId);
  ctx.postPendingSummary = parseBillSummary(raw);
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
      paymentDate: "2026-02-10",
      idempotencyKey: `${fixture.prefix}-core-pending-08-over`,
    });
  } catch (err) {
    threw = true;
    const msg = err instanceof Error ? err.message : String(err);
    expect(msg, "PENDING-08: canonical over-allocation error").toMatch(OVER_ALLOC_MSG);
  }
  expect(threw, "PENDING-08: over-allocation must throw").toBe(true);
  const afterCount = await fixture.helpers.countPayments(billId);
  expect(afterCount, "PENDING-08: no new payment row from denied over-allocation").toBe(
    beforeCount,
  );
}
