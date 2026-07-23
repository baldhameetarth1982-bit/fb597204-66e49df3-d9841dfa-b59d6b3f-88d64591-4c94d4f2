/**
 * Stage 3C — Live IDEMPOTENCY-01..04 and REFERENCE-01..04 case handlers.
 *
 * Contract:
 *   - Idempotency scope: per (submitted_by, idempotency_key). Exact
 *     replay returns the ORIGINAL payment id; any payload change under
 *     the same key raises the canonical `idempotency_conflict` token
 *     with NO mutation.
 *   - Bank-transfer reference scope: per (society_id, method='bank_transfer'),
 *     normalized via `upper(trim(reference_no))`. Duplicate within the
 *     same society raises `duplicate_reference`; the SAME normalized
 *     reference is allowed cross-society (society-scoped isolation).
 *
 * Denial control flow mirrors the resident-submit module: the RPC is
 * invoked inside a try/catch that ONLY records the caught error and
 * the (forbidden) success value. The "unexpected success" assertion is
 * thrown OUTSIDE the catch so it can never be consumed by
 * `assertCanonicalError`. Every denial snapshots the payment-row count
 * before and asserts it is unchanged after.
 */
import { expect } from "vitest";
import { z } from "zod";
import { trackUniqueId } from "./stage3c-runtime-fixtures";
import { STAGE3C_ERRORS, assertCanonicalError } from "./stage3c-live-errors";
import { CanonicalStage3CUuidSchema } from "./stage3c-runtime-fixtures";
import {
  requireMatrixFixture,
  requireIdempotencyPaymentId,
  requireIdempotencyReference,
  requireReferencePrimaryPaymentId,
  requireReferenceValue,
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
export const IDEMPOTENCY_AMOUNT = 200;
export const IDEMPOTENCY_CONFLICT_AMOUNT = 250;
export const REFERENCE_PRIMARY_AMOUNT = 100;
export const REFERENCE_DUPLICATE_AMOUNT = 50;

function safeSuffix(prefix: string): string {
  return prefix.replace(/[^A-Za-z0-9]/g, "").slice(0, 24) || "run";
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

/** Count payment rows on a bill via service-role admin (test-only). */
async function countRowsOnBill(
  fixture: ReturnType<typeof requireMatrixFixture>,
  billId: string,
): Promise<number> {
  return fixture.helpers.countPayments(billId);
}

// ---------------------------------------------------------------------------
// IDEMPOTENCY
// ---------------------------------------------------------------------------

async function idempotency01_primarySubmit(
  ctx: Stage3CLiveMatrixContext,
): Promise<void> {
  const f = requireMatrixFixture(ctx);
  const billId = f.referenceBillId; // dedicated 1100 unpaid bill on flatA
  const key = idempotencyKeyFor(f.prefix);
  const reference = `IDEMP-${safeSuffix(f.prefix)}`;

  const before = await countRowsOnBill(f, billId);

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

  const after = await countRowsOnBill(f, billId);
  expect(after - before).toBe(1);

  ctx.idempotencyPaymentId = validated;
  ctx.idempotencyReference = reference;
  ctx.idempotencyAmount = IDEMPOTENCY_AMOUNT;
  ctx.idempotencyKey = key;
  ctx.idempotencyBillAId = billId;
  ctx.idempotencyInitialState = { billId, rowCount: after };
}

async function idempotency02_identicalReplay(
  ctx: Stage3CLiveMatrixContext,
): Promise<void> {
  const f = requireMatrixFixture(ctx);
  const original = requireIdempotencyPaymentId(ctx);
  const key = ctx.idempotencyKey!;
  const reference = requireIdempotencyReference(ctx);
  const billId = ctx.idempotencyBillAId!;

  const before = await countRowsOnBill(f, billId);

  const replayId = await f.helpers.submitResidentBankTransferPayment({
    actor: f.users.activeResident,
    billId,
    amount: IDEMPOTENCY_AMOUNT,
    paymentDate: f.testPaymentDate,
    referenceNo: reference,
    idempotencyKey: key,
  });

  expect(CanonicalStage3CUuidSchema.parse(replayId)).toBe(original);

  const after = await countRowsOnBill(f, billId);
  expect(after).toBe(before);
}

async function assertIdempotencyConflictNoMutation(
  ctx: Stage3CLiveMatrixContext,
  label: string,
  attempt: () => Promise<string>,
): Promise<void> {
  const f = requireMatrixFixture(ctx);
  const billId = ctx.idempotencyBillAId!;
  const before = await countRowsOnBill(f, billId);

  let caught: unknown = undefined;
  let succeededData: string | undefined;
  try {
    succeededData = await attempt();
  } catch (e) {
    caught = e;
  }
  if (succeededData !== undefined) {
    throw new Error(`[${label}] unexpected success — conflicting replay must be denied`);
  }
  assertCanonicalError(caught, STAGE3C_ERRORS.IDEMPOTENCY_CONFLICT, label);

  const after = await countRowsOnBill(f, billId);
  expect(after).toBe(before);
  ctx.idempotencyPostSubmitState = { billId, rowCount: after };
}

async function idempotency03_conflictAmount(
  ctx: Stage3CLiveMatrixContext,
): Promise<void> {
  const f = requireMatrixFixture(ctx);
  await assertIdempotencyConflictNoMutation(ctx, "IDEMPOTENCY-03", () =>
    f.helpers.submitResidentBankTransferPayment({
      actor: f.users.activeResident,
      billId: ctx.idempotencyBillAId!,
      amount: IDEMPOTENCY_CONFLICT_AMOUNT,
      paymentDate: f.testPaymentDate,
      referenceNo: requireIdempotencyReference(ctx),
      idempotencyKey: ctx.idempotencyKey!,
    }),
  );
}

async function idempotency04_conflictBill(
  ctx: Stage3CLiveMatrixContext,
): Promise<void> {
  const f = requireMatrixFixture(ctx);
  await assertIdempotencyConflictNoMutation(ctx, "IDEMPOTENCY-04", () =>
    f.helpers.submitResidentBankTransferPayment({
      actor: f.users.activeResident,
      billId: f.referenceSecondarySameSocietyBillId,
      amount: IDEMPOTENCY_AMOUNT,
      paymentDate: f.testPaymentDate,
      referenceNo: requireIdempotencyReference(ctx),
      idempotencyKey: ctx.idempotencyKey!,
    }),
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
  const billId = f.referenceSecondarySameSocietyBillId;
  const before = await countRowsOnBill(f, billId);

  const paymentId = await f.helpers.submitAdminBankTransferPayment({
    actor: f.users.adminA1,
    billId,
    amount: REFERENCE_PRIMARY_AMOUNT,
    paymentDate: f.testPaymentDate,
    referenceNo: reference,
    idempotencyKey: `ref-primary-${safeSuffix(f.prefix)}`,
  });
  const validated = CanonicalStage3CUuidSchema.parse(paymentId);
  trackUniqueId(f.tracked.paymentIds, validated, "reference:primary");

  const after = await countRowsOnBill(f, billId);
  expect(after - before).toBe(1);

  ctx.referencePrimaryPaymentId = validated;
  ctx.referenceValue = reference;
  ctx.referenceAmount = REFERENCE_PRIMARY_AMOUNT;
  ctx.referencePrimaryKey = `ref-primary-${safeSuffix(f.prefix)}`;
  ctx.referencePrimaryInitialState = { billId, rowCount: after };
}

async function assertDuplicateReferenceDenied(
  ctx: Stage3CLiveMatrixContext,
  label: string,
  billId: string,
  key: string,
): Promise<void> {
  const f = requireMatrixFixture(ctx);
  const variant = whitespaceCaseVariant(requireReferenceValue(ctx));
  const before = await countRowsOnBill(f, billId);

  let caught: unknown = undefined;
  let succeededData: string | undefined;
  try {
    succeededData = await f.helpers.submitAdminBankTransferPayment({
      actor: f.users.adminA1,
      billId,
      amount: REFERENCE_DUPLICATE_AMOUNT,
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

  const after = await countRowsOnBill(f, billId);
  expect(after).toBe(before);
}

async function reference02_sameBillDuplicateDenied(
  ctx: Stage3CLiveMatrixContext,
): Promise<void> {
  const key = `ref-dup-same-bill-${safeSuffix(requireMatrixFixture(ctx).prefix)}`;
  ctx.referenceDuplicateKey = key;
  await assertDuplicateReferenceDenied(
    ctx,
    "REFERENCE-02",
    requireMatrixFixture(ctx).referenceSecondarySameSocietyBillId,
    key,
  );
}

async function reference03_sameSocietyDifferentBillDuplicateDenied(
  ctx: Stage3CLiveMatrixContext,
): Promise<void> {
  const f = requireMatrixFixture(ctx);
  const key = `ref-dup-same-soc-${safeSuffix(f.prefix)}`;
  await assertDuplicateReferenceDenied(
    ctx,
    "REFERENCE-03",
    f.referenceBillId!,
    key,
  );
}

async function reference04_crossSocietyIsolationSucceeds(
  ctx: Stage3CLiveMatrixContext,
): Promise<void> {
  const f = requireMatrixFixture(ctx);
  // Guard that primary reference exists; consumed even for the success path.
  requireReferencePrimaryPaymentId(ctx);
  const variant = whitespaceCaseVariant(requireReferenceValue(ctx));
  const billId = f.referenceOtherSocietyBillId;
  const key = `ref-cross-soc-${safeSuffix(f.prefix)}`;
  ctx.referenceOtherSocietyKey = key;

  const before = await countRowsOnBill(f, billId);
  const paymentId = await f.helpers.submitAdminBankTransferPayment({
    actor: f.users.adminB,
    billId,
    amount: REFERENCE_DUPLICATE_AMOUNT,
    paymentDate: f.testPaymentDate,
    referenceNo: variant,
    idempotencyKey: key,
  });
  const validated = CanonicalStage3CUuidSchema.parse(paymentId);
  trackUniqueId(f.tracked.paymentIds, validated, "reference:cross-society");

  const after = await countRowsOnBill(f, billId);
  expect(after - before).toBe(1);

  ctx.referenceOtherSocietyPaymentId = validated;
  ctx.referencePrimaryPostSubmitState = { billId, rowCount: after };
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

export const STAGE3C_IDEMPOTENCY_REFERENCE_HANDLERS = {
  "IDEMPOTENCY-01": idempotency01_primarySubmit,
  "IDEMPOTENCY-02": idempotency02_identicalReplay,
  "IDEMPOTENCY-03": idempotency03_conflictAmount,
  "IDEMPOTENCY-04": idempotency04_conflictBill,
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
