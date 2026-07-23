/**
 * Stage 3C — Live IDEMPOTENCY-01..04 and REFERENCE-01..04 case handlers.
 *
 * Repaired slice (this run):
 *   - Uses the SHARED resident production Bank Transfer core for every
 *     REFERENCE path via `fixture.helpers.submitResidentBankTransferPayment`
 *     (which itself delegates to `submitResidentBankTransferWithClient`
 *     in `src/lib/offline-payment-resident-submit.ts`).
 *   - Uses the dedicated bills exposed by the fixture:
 *       Idempotency        → `idempotencyBillId`             (total 1000)
 *       Primary Reference  → `referencePrimaryBillId`        (total 800)
 *       Secondary Same-Soc → `referenceSecondarySameSocietyBillId` (total 700)
 *       Other-Society      → `referenceOtherSocietyBillId`   (total 600)
 *   - Canonical financial literals:
 *       IDEMPOTENCY_AMOUNT           = 250
 *       IDEMPOTENCY_CONFLICT_AMOUNT  = 251
 *       REFERENCE_AMOUNT             = 200
 *   - Every mutation and denial is bracketed by a real
 *     `snapshotResidentBillState` / `assertResidentBillStateUnchanged`
 *     pair (strict `ResidentBillStateSnapshot` — payments, summary,
 *     sequences). No `unknown` state bags.
 *   - Denial control flow: the RPC lives inside a try that only
 *     captures `{ caught, succeededData }`; the "unexpected success"
 *     assertion is thrown OUTSIDE the try/catch so it can never be
 *     consumed by `assertCanonicalError`.
 *   - No `!` non-null assertions. No `expect` / vitest imports. Every
 *     lifecycle value comes through a labeled `require*` guard.
 *
 * Manifest slot mapping (`stage3c-live-case-manifest.ts`):
 *   IDEMPOTENCY-01  primary submit + identical replay returns SAME id
 *                   (dedicated 1000 bill, amount 250)
 *   IDEMPOTENCY-02  same key + amount 251 → `idempotency_conflict`
 *   IDEMPOTENCY-03  proof-only: still exactly one payment row on the
 *                   idempotency bill; state unchanged since IDEMP-02
 *   IDEMPOTENCY-04  same key + same bill + amount 251 →
 *                   `idempotency_conflict` (explicit re-attempt)
 *   REFERENCE-01    unique bank reference on Society A primary ref bill
 *                   (activeResident, amount 200)
 *   REFERENCE-02    whitespace/case variant on SAME bill →
 *                   `duplicate_reference`
 *   REFERENCE-03    same normalized reference on a DIFFERENT bill in the
 *                   SAME society (secondary ref bill) → `duplicate_reference`
 *   REFERENCE-04    cross-society isolation: same normalized reference in
 *                   Society B via `unrelatedResident` SUCCEEDS
 */
import { z } from "zod";
import {
  trackUniqueId,
  CanonicalStage3CUuidSchema,
  type Stage3CFixture,
} from "./stage3c-runtime-fixtures";
import { STAGE3C_ERRORS, assertCanonicalError } from "./stage3c-live-errors";
import {
  snapshotResidentBillState,
  assertResidentBillStateUnchanged,
  type ResidentBillStateSnapshot,
} from "./stage3c-live-resident-submit-contracts";
import {
  requireMatrixFixture,
  requireIdempotencyBillId,
  requireIdempotencyPaymentId,
  requireIdempotencyReference,
  requireReferencePrimaryBillId,
  requireReferencePrimaryPaymentId,
  requireReferenceValue,
  requireReferencePrimaryInitialState,
  requireIdempotencyInitialState,
  type Stage3CLiveMatrixContext,
} from "./stage3c-live-matrix-context";

export type Stage3CIdempotencyReferenceCaseId =
  | "IDEMPOTENCY-01"
  | "IDEMPOTENCY-02"
  | "IDEMPOTENCY-03"
  | "IDEMPOTENCY-04"
  | "REFERENCE-01"
  | "REFERENCE-02"
  | "REFERENCE-03"
  | "REFERENCE-04";

export type Stage3CIdempotencyReferenceHandler = (
  ctx: Stage3CLiveMatrixContext,
) => Promise<void>;

/** Canonical amounts / literals used by this slice. */
export const IDEMPOTENCY_AMOUNT = 250;
export const IDEMPOTENCY_CONFLICT_AMOUNT = 251;
export const REFERENCE_AMOUNT = 200;

function safeSuffix(prefix: string): string {
  const cleaned = prefix.replace(/[^A-Za-z0-9]/g, "").slice(0, 24);
  return cleaned.length > 0 ? cleaned : "run";
}

function idempotencyKeyFor(prefix: string): string {
  return `idemp-${safeSuffix(prefix)}`;
}

function referenceValueFor(prefix: string): string {
  return `REF-${safeSuffix(prefix)}-A`;
}

/**
 * Whitespace + case variant of the canonical reference. The RPC
 * normalizes via `upper(trim(...))`, so all variants collide.
 */
function whitespaceCaseVariant(value: string): string {
  return `  ${value.toLowerCase()}  `;
}

function assertEq(actual: unknown, expected: unknown, label: string): void {
  if (actual !== expected)
    throw new Error(
      `[stage3c:${label}] expected value equality (values redacted)`,
    );
}

async function snapshot(
  fixture: Stage3CFixture,
  actor: Stage3CFixture["users"]["activeResident"],
  billId: string,
  societyId: string,
  label: string,
): Promise<ResidentBillStateSnapshot> {
  return snapshotResidentBillState(
    fixture.admin,
    actor.client,
    billId,
    societyId,
    label,
  );
}

// ---------------------------------------------------------------------------
// IDEMPOTENCY
// ---------------------------------------------------------------------------

async function idempotency01_primarySubmitAndReplay(
  ctx: Stage3CLiveMatrixContext,
): Promise<void> {
  const f = requireMatrixFixture(ctx);
  const billId = f.idempotencyBillId;
  const key = idempotencyKeyFor(f.prefix);
  const reference = `IDEMP-${safeSuffix(f.prefix)}`;

  const initial = await snapshot(f, f.users.activeResident, billId, f.societyA, "IDEMPOTENCY-01-initial");

  const paymentId = await f.helpers.submitResidentBankTransferPayment({
    actor: f.users.activeResident,
    billId,
    amount: IDEMPOTENCY_AMOUNT,
    paymentDate: f.testPaymentDate,
    referenceNo: reference,
    idempotencyKey: key,
  });
  const validated = CanonicalStage3CUuidSchema.parse(paymentId);
  trackUniqueId(f.tracked.paymentIds, validated, "idempotency:primary");

  // Identical replay — MUST return the original id and MUST NOT add a row.
  const replayId = await f.helpers.submitResidentBankTransferPayment({
    actor: f.users.activeResident,
    billId,
    amount: IDEMPOTENCY_AMOUNT,
    paymentDate: f.testPaymentDate,
    referenceNo: reference,
    idempotencyKey: key,
  });
  const replayValidated = CanonicalStage3CUuidSchema.parse(replayId);
  assertEq(replayValidated, validated, "IDEMPOTENCY-01:replay-id");

  const postSubmit = await snapshot(
    f,
    f.users.activeResident,
    billId,
    f.societyA,
    "IDEMPOTENCY-01-post",
  );
  // Exactly one new payment row on the idempotency bill.
  const delta = postSubmit.paymentRows.length - initial.paymentRows.length;
  assertEq(delta, 1, "IDEMPOTENCY-01:row-delta");

  ctx.idempotencyBillId = billId;
  ctx.idempotencyPaymentId = validated;
  ctx.idempotencyReference = reference;
  ctx.idempotencyAmountInput = IDEMPOTENCY_AMOUNT;
  ctx.idempotencyConflictAmountInput = IDEMPOTENCY_CONFLICT_AMOUNT;
  ctx.idempotencyKey = key;
  ctx.idempotencyInitialState = postSubmit;
}

async function attemptIdempotencyConflict(
  ctx: Stage3CLiveMatrixContext,
  label: string,
  billOverride: string | null,
  amount: number,
): Promise<void> {
  const f = requireMatrixFixture(ctx);
  const billId = billOverride ?? requireIdempotencyBillId(ctx);
  const reference = requireIdempotencyReference(ctx);
  const key = idempotencyKeyFor(f.prefix);
  const before = requireIdempotencyInitialState(ctx);

  let caught: unknown = undefined;
  let succeededData: string | undefined;
  try {
    succeededData = await f.helpers.submitResidentBankTransferPayment({
      actor: f.users.activeResident,
      billId,
      amount,
      paymentDate: f.testPaymentDate,
      referenceNo: reference,
      idempotencyKey: key,
    });
  } catch (e) {
    caught = e;
  }
  if (succeededData !== undefined) {
    throw new Error(`[${label}] unexpected success — conflicting replay must be denied`);
  }
  assertCanonicalError(caught, STAGE3C_ERRORS.IDEMPOTENCY_CONFLICT, label);

  const after = await snapshot(
    f,
    f.users.activeResident,
    requireIdempotencyBillId(ctx),
    f.societyA,
    `${label}-post`,
  );
  assertResidentBillStateUnchanged(before, after, label);
  ctx.idempotencyPostSubmitState = after;
}

async function idempotency02_sameKeyChangedAmount(
  ctx: Stage3CLiveMatrixContext,
): Promise<void> {
  await attemptIdempotencyConflict(ctx, "IDEMPOTENCY-02", null, IDEMPOTENCY_CONFLICT_AMOUNT);
}

async function idempotency03_proofOnlySingleRow(
  ctx: Stage3CLiveMatrixContext,
): Promise<void> {
  const f = requireMatrixFixture(ctx);
  const before = requireIdempotencyInitialState(ctx);
  // Purely observational — snapshot again and prove state is still identical
  // to the post-primary snapshot (one row, same amount, same sequences).
  const now = await snapshot(
    f,
    f.users.activeResident,
    requireIdempotencyBillId(ctx),
    f.societyA,
    "IDEMPOTENCY-03",
  );
  assertResidentBillStateUnchanged(before, now, "IDEMPOTENCY-03");
  // Idempotency scope contract: exactly one payment row exists for the
  // (resident, idempotency-key) pair since IDEMPOTENCY-01.
  const originalPaymentId = requireIdempotencyPaymentId(ctx);
  const matches = now.paymentRows.filter((r) => r.id === originalPaymentId);
  assertEq(matches.length, 1, "IDEMPOTENCY-03:original-row-persists");
}

async function idempotency04_sameKeySameBillChangedAmount(
  ctx: Stage3CLiveMatrixContext,
): Promise<void> {
  // Same bill, same key, changed amount (251) → idempotency_conflict.
  await attemptIdempotencyConflict(
    ctx,
    "IDEMPOTENCY-04",
    requireIdempotencyBillId(ctx),
    IDEMPOTENCY_CONFLICT_AMOUNT,
  );
}

// ---------------------------------------------------------------------------
// REFERENCE
// ---------------------------------------------------------------------------

async function reference01_primaryUniqueSucceeds(
  ctx: Stage3CLiveMatrixContext,
): Promise<void> {
  const f = requireMatrixFixture(ctx);
  const reference = referenceValueFor(f.prefix);
  const billId = f.referencePrimaryBillId;

  const initial = await snapshot(
    f,
    f.users.activeResident,
    billId,
    f.societyA,
    "REFERENCE-01-initial",
  );

  const key = `ref-primary-${safeSuffix(f.prefix)}`;
  const paymentId = await f.helpers.submitResidentBankTransferPayment({
    actor: f.users.activeResident,
    billId,
    amount: REFERENCE_AMOUNT,
    paymentDate: f.testPaymentDate,
    referenceNo: reference,
    idempotencyKey: key,
  });
  const validated = CanonicalStage3CUuidSchema.parse(paymentId);
  trackUniqueId(f.tracked.paymentIds, validated, "reference:primary");

  const post = await snapshot(
    f,
    f.users.activeResident,
    billId,
    f.societyA,
    "REFERENCE-01-post",
  );
  const delta = post.paymentRows.length - initial.paymentRows.length;
  assertEq(delta, 1, "REFERENCE-01:row-delta");

  ctx.referencePrimaryBillId = billId;
  ctx.referencePrimaryPaymentId = validated;
  ctx.referenceValue = reference;
  ctx.referenceAmount = REFERENCE_AMOUNT;
  ctx.referencePrimaryKey = key;
  ctx.referencePrimaryInitialState = post;
}

async function assertDuplicateReferenceDenied(
  ctx: Stage3CLiveMatrixContext,
  label: string,
  billId: string,
  key: string,
): Promise<void> {
  const f = requireMatrixFixture(ctx);
  const variant = whitespaceCaseVariant(requireReferenceValue(ctx));
  const primaryBillId = requireReferencePrimaryBillId(ctx);
  const primaryBefore = requireReferencePrimaryInitialState(ctx);
  const attemptedBefore = await snapshot(
    f,
    f.users.activeResident,
    billId,
    f.societyA,
    `${label}-attempted-initial`,
  );

  let caught: unknown = undefined;
  let succeededData: string | undefined;
  try {
    succeededData = await f.helpers.submitResidentBankTransferPayment({
      actor: f.users.activeResident,
      billId,
      amount: REFERENCE_AMOUNT,
      paymentDate: f.testPaymentDate,
      referenceNo: variant,
      idempotencyKey: key,
    });
  } catch (e) {
    caught = e;
  }
  if (succeededData !== undefined) {
    throw new Error(`[${label}] unexpected success — duplicate reference must be denied`);
  }
  assertCanonicalError(caught, STAGE3C_ERRORS.DUPLICATE_REFERENCE, label);

  const attemptedAfter = await snapshot(
    f,
    f.users.activeResident,
    billId,
    f.societyA,
    `${label}-attempted-post`,
  );
  assertResidentBillStateUnchanged(attemptedBefore, attemptedAfter, `${label}-attempted`);
  const primaryAfter = await snapshot(
    f,
    f.users.activeResident,
    primaryBillId,
    f.societyA,
    `${label}-primary-post`,
  );
  assertResidentBillStateUnchanged(primaryBefore, primaryAfter, `${label}-primary`);
  ctx.referencePrimaryPostSubmitState = primaryAfter;
}

async function reference02_sameBillDuplicateDenied(
  ctx: Stage3CLiveMatrixContext,
): Promise<void> {
  const f = requireMatrixFixture(ctx);
  const key = `ref-dup-same-bill-${safeSuffix(f.prefix)}`;
  ctx.referenceDuplicateKey = key;
  await assertDuplicateReferenceDenied(ctx, "REFERENCE-02", requireReferencePrimaryBillId(ctx), key);
}

async function reference03_sameSocietyDifferentBillDuplicateDenied(
  ctx: Stage3CLiveMatrixContext,
): Promise<void> {
  const f = requireMatrixFixture(ctx);
  const key = `ref-dup-same-soc-${safeSuffix(f.prefix)}`;
  await assertDuplicateReferenceDenied(
    ctx,
    "REFERENCE-03",
    f.referenceSecondarySameSocietyBillId,
    key,
  );
}

async function reference04_crossSocietyIsolationSucceeds(
  ctx: Stage3CLiveMatrixContext,
): Promise<void> {
  const f = requireMatrixFixture(ctx);
  // Guard: primary reference must exist; also proves primary bill state
  // is unchanged by the cross-society submission.
  requireReferencePrimaryPaymentId(ctx);
  const primaryBillId = requireReferencePrimaryBillId(ctx);
  const primaryBefore = requireReferencePrimaryInitialState(ctx);
  const variant = whitespaceCaseVariant(requireReferenceValue(ctx));
  const billId = f.referenceOtherSocietyBillId;
  const key = `ref-cross-soc-${safeSuffix(f.prefix)}`;
  ctx.referenceOtherSocietyKey = key;

  const initial = await snapshot(
    f,
    f.users.unrelatedResident,
    billId,
    f.societyB,
    "REFERENCE-04-initial",
  );

  const paymentId = await f.helpers.submitResidentBankTransferPayment({
    actor: f.users.unrelatedResident,
    billId,
    amount: REFERENCE_AMOUNT,
    paymentDate: f.testPaymentDate,
    referenceNo: variant,
    idempotencyKey: key,
  });
  const validated = CanonicalStage3CUuidSchema.parse(paymentId);
  trackUniqueId(f.tracked.paymentIds, validated, "reference:cross-society");

  const post = await snapshot(
    f,
    f.users.unrelatedResident,
    billId,
    f.societyB,
    "REFERENCE-04-post",
  );
  const delta = post.paymentRows.length - initial.paymentRows.length;
  assertEq(delta, 1, "REFERENCE-04:row-delta");

  // Primary society-A bill state must remain identical.
  const primaryAfter = await snapshot(
    f,
    f.users.activeResident,
    primaryBillId,
    f.societyA,
    "REFERENCE-04-primary-post",
  );
  assertResidentBillStateUnchanged(primaryBefore, primaryAfter, "REFERENCE-04-primary");
  ctx.referenceOtherSocietyPaymentId = validated;
  ctx.referenceOtherSocietyInitialState = post;
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

export const STAGE3C_IDEMPOTENCY_REFERENCE_HANDLERS = {
  "IDEMPOTENCY-01": idempotency01_primarySubmitAndReplay,
  "IDEMPOTENCY-02": idempotency02_sameKeyChangedAmount,
  "IDEMPOTENCY-03": idempotency03_proofOnlySingleRow,
  "IDEMPOTENCY-04": idempotency04_sameKeySameBillChangedAmount,
  "REFERENCE-01": reference01_primaryUniqueSucceeds,
  "REFERENCE-02": reference02_sameBillDuplicateDenied,
  "REFERENCE-03": reference03_sameSocietyDifferentBillDuplicateDenied,
  "REFERENCE-04": reference04_crossSocietyIsolationSucceeds,
} satisfies Record<Stage3CIdempotencyReferenceCaseId, Stage3CIdempotencyReferenceHandler>;

export const STAGE3C_IDEMPOTENCY_REFERENCE_CASE_IDS: readonly Stage3CIdempotencyReferenceCaseId[] = [
  "IDEMPOTENCY-01",
  "IDEMPOTENCY-02",
  "IDEMPOTENCY-03",
  "IDEMPOTENCY-04",
  "REFERENCE-01",
  "REFERENCE-02",
  "REFERENCE-03",
  "REFERENCE-04",
] as const;

// Zod schemas for lifecycle snapshots (exported for validators/tests).
export const IdempotencyLifecycleSnapshotSchema = z.object({
  billId: z.string().uuid(),
  rowCount: z.number().int().nonnegative(),
});
export const ReferenceLifecycleSnapshotSchema = z.object({
  billId: z.string().uuid(),
  rowCount: z.number().int().nonnegative(),
});
