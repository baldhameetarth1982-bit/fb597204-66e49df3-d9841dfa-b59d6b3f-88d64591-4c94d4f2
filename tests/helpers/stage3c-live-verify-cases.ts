/**
 * Stage 3C — Live VERIFY-01..VERIFY-09 case handlers.
 *
 * Separation-of-duties: A1 (submitter) may never verify their own
 * payment. A2 verifies. Balance deltas are asserted against the
 * post-pending summary captured in PENDING-05. Receipt shape is
 * verified against an anchored regex tied to the receipt's UTC month.
 *
 * VERIFY-09 performs a genuine concurrent verification race against
 * a resident-submitted Bank Transfer payment (so BOTH A1 and A2 are
 * eligible verifiers), asserting exactly one success, exactly one
 * canonical `payment_not_pending` failure, and exactly one receipt.
 */
import { expect } from "vitest";
import {
  assertCanonicalReceiptStatus,
  parseBillSummary,
  parsePaymentAssertionRow,
  parseReceiptAssertionRow,
  requireBillId,
  requireFixture,
  requirePendingAmount,
  requirePendingPaymentId,
  requirePostPendingSummary,
  requirePostVerifySummary,
  requireVerifiedReceiptCreatedAt,
  requireVerifiedReceiptNumber,
  type ReceiptAssertionRow,
  type Stage3CLiveCoreContext,
} from "./stage3c-live-core-context";
import { confirmReceiptSequenceKey, trackUniqueId } from "./stage3c-runtime-fixtures";
import type { Stage3CFixture } from "./stage3c-runtime-fixtures";
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

/**
 * VERIFY-03 — Verified payment transitions to status = verified.
 * Uses the strict payment-row parser (no `data!` on a raw DB row) and
 * captures the post-verify summary for VERIFY-04 / VERIFY-05.
 */
export async function verify03_statusVerified(ctx: Stage3CLiveCoreContext): Promise<void> {
  const fixture = requireFixture(ctx);
  const paymentId = requirePendingPaymentId(ctx);
  const billId = requireBillId(ctx);
  const { data, error } = await fixture.admin
    .from("payments")
    .select("society_id, flat_id, bill_id, method, submitted_by, status")
    .eq("id", paymentId)
    .single();
  expect(error, "VERIFY-03: payment row must exist").toBeNull();
  const row = parsePaymentAssertionRow(data, "verify-03");
  expect(row.status, "VERIFY-03: status must be verified").toBe("verified");
  expect(row.bill_id, "VERIFY-03: bill_id ownership preserved").toBe(billId);
  expect(row.submitted_by, "VERIFY-03: submitter preserved").toBe(fixture.users.adminA1.id);

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

/**
 * VERIFY-06 — Exactly one payment_receipt row is created on verification.
 * Validates receipt canonical valid status via `assertCanonicalReceiptStatus`
 * (never a stringly-typed inline literal).
 */
export async function verify06_exactlyOneReceipt(ctx: Stage3CLiveCoreContext): Promise<void> {
  const fixture = requireFixture(ctx);
  const paymentId = requirePendingPaymentId(ctx);
  const { data, error } = await fixture.admin
    .from("payment_receipts")
    .select("id, receipt_number, status, created_at, payment_id")
    .eq("payment_id", paymentId);
  expect(error, "VERIFY-06: receipt query must not error").toBeNull();
  const rows = Array.isArray(data) ? data : [];
  expect(rows.length, "VERIFY-06: exactly one receipt").toBe(1);
  const parsed = parseReceiptAssertionRow(rows[0], "verify-06");
  const paymentIdOnRow = String((rows[0] as { payment_id?: unknown }).payment_id ?? "");
  expect(paymentIdOnRow, "VERIFY-06: receipt belongs to the verified payment").toBe(paymentId);
  assertCanonicalReceiptStatus(parsed.status, "verify-06");
  expect(parsed.receipt_number.length, "VERIFY-06: receipt number non-empty").toBeGreaterThan(0);
  expect(Number.isFinite(new Date(parsed.created_at).getTime()), "VERIFY-06 created_at").toBe(true);
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

/**
 * VERIFY-09 — Receipt number remains unique across concurrent verifications.
 *
 * Dedicated payment: `scenarios.pendingResidentBankTransferPaymentId`,
 * submitted by an active resident so BOTH A1 and A2 are eligible
 * (neither is the submitter). A1 and A2 race via `Promise.allSettled`
 * and only one may win; the loser must return the canonical
 * `payment_not_pending` error. Exactly one receipt row must exist.
 */
export async function verify09_receiptStillExactlyOne(
  ctx: Stage3CLiveCoreContext,
): Promise<void> {
  const fixture = requireFixture(ctx);
  const paymentId = fixture.scenarios.pendingResidentBankTransferPaymentId;

  // Pre-state: still pending, zero receipts.
  const preStatusRes = await fixture.admin
    .from("payments")
    .select("society_id, flat_id, bill_id, method, submitted_by, status")
    .eq("id", paymentId)
    .single();
  expect(preStatusRes.error, "VERIFY-09: pre-state read").toBeNull();
  const preRow = parsePaymentAssertionRow(preStatusRes.data, "verify-09:pre");
  expect(preRow.status, "VERIFY-09: dedicated payment must start pending").toBe("pending");
  expect(preRow.submitted_by, "VERIFY-09: submitter is the resident (not an admin)").toBe(
    fixture.users.activeResident.id,
  );
  expect(
    await fixture.helpers.countReceipts(paymentId),
    "VERIFY-09: zero receipts before race",
  ).toBe(0);

  // Real race: both admins fire concurrently.
  const raceResults = await Promise.allSettled([
    fixture.users.adminA1.client.rpc("verify_offline_payment", {
      _payment_id: paymentId,
      _notes: "VERIFY-09 race adminA1",
    }),
    fixture.users.adminA2.client.rpc("verify_offline_payment", {
      _payment_id: paymentId,
      _notes: "VERIFY-09 race adminA2",
    }),
  ]);

  const errors: unknown[] = raceResults.map((r) => {
    if (r.status === "rejected") return r.reason;
    const value = r.value as { error: unknown };
    return value?.error ?? null;
  });
  const successes = errors.filter((e) => e === null || e === undefined);
  const failures = errors.filter((e) => e !== null && e !== undefined);
  expect(successes.length, "VERIFY-09: exactly one successful verifier").toBe(1);
  expect(failures.length, "VERIFY-09: exactly one denied verifier").toBe(1);
  const failMsg = String((failures[0] as { message?: unknown } | null)?.message ?? failures[0] ?? "");
  expect(
    matchesCanonicalError(failMsg, STAGE3C_ERRORS.PAYMENT_NOT_PENDING),
    `VERIFY-09: race-loser canonical "${STAGE3C_ERRORS.PAYMENT_NOT_PENDING}", got: ${failMsg}`,
  ).toBe(true);

  // Post-state: verified + exactly one receipt (unique receipt number).
  const post = await fixture.admin
    .from("payments")
    .select("society_id, flat_id, bill_id, method, submitted_by, status")
    .eq("id", paymentId)
    .single();
  expect(post.error, "VERIFY-09: post-state read").toBeNull();
  const postRow = parsePaymentAssertionRow(post.data, "verify-09:post");
  expect(postRow.status, "VERIFY-09: payment must be verified").toBe("verified");

  const receipts = await fixture.admin
    .from("payment_receipts")
    .select("id, receipt_number, status, created_at, payment_id")
    .eq("payment_id", paymentId);
  expect(receipts.error, "VERIFY-09: receipt query").toBeNull();
  const receiptRows = Array.isArray(receipts.data) ? receipts.data : [];
  expect(receiptRows.length, "VERIFY-09: exactly one receipt after concurrent race").toBe(1);
  const receipt: ReceiptAssertionRow = parseReceiptAssertionRow(receiptRows[0], "verify-09");
  assertCanonicalReceiptStatus(receipt.status, "verify-09");

  const uniqueNumbers = new Set(receiptRows.map((r) => String((r as { receipt_number: string }).receipt_number)));
  expect(uniqueNumbers.size, "VERIFY-09: receipt numbers are unique").toBe(1);

  trackUniqueId(fixture.tracked.paymentReceiptIds, receipt.id, "VERIFY-09:receiptId");
  const seq = await confirmReceiptSequenceKey(
    (fixture as unknown as Stage3CFixture).admin,
    fixture.societyA,
    receipt.created_at,
    "VERIFY-09:sequence",
  );
  const seqKey = `${seq.society_id}:${seq.year_month}`;
  const alreadyTracked = fixture.tracked.receiptSequences.some(
    (s) => `${s.society_id}:${s.year_month}` === seqKey,
  );
  if (!alreadyTracked) fixture.tracked.receiptSequences.push(seq);
}
