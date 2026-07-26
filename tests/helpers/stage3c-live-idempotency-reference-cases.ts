/**
 * Stage 3C — IDEMPOTENCY-01..04 + REFERENCE-01..04 live case handlers
 * (Sub-run A — structural closure).
 *
 * Sub-run A repairs only:
 *   - shared handler typing (uses the canonical
 *     {@link Stage3CMatrixLiveHandler} from the matrix registry — no
 *     parallel type, no alias);
 *   - exact exported handler names (`idempotency01_initializeAndSubmit`
 *     ..`reference04_outsideScopeIsolation`);
 *   - deterministic input builder
 *     ({@link buildStage3CIdempotencyReferenceInputs}) — same
 *     `runIdentity` always yields the same object;
 *   - use of the strict matrix-context lifecycle fields and their
 *     `require*` guards.
 *
 * Sub-run A does NOT alter behavioral coverage beyond the minimum
 * rename / split required for compilation. Reference and idempotency
 * flows continue to delegate to the shared resident production Bank
 * Transfer core (`submitResidentBankTransferPayment`).
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
  requireIdempotencyKey,
  requireIdempotencyAmount,
  requireIdempotencyInitialState,
  requireReferencePrimaryBillId,
  requireReferencePrimaryPaymentId,
  requireReferenceValue,
  requireReferencePrimaryInitialState,
  type Stage3CLiveMatrixContext,
} from "./stage3c-live-matrix-context";
// Type-only import — erased at runtime, so no circular value cycle
// with `stage3c-live-matrix-registry.ts`.
import type { Stage3CMatrixLiveHandler } from "./stage3c-live-matrix-registry";

export type Stage3CIdempotencyReferenceCaseId =
  | "IDEMPOTENCY-01"
  | "IDEMPOTENCY-02"
  | "IDEMPOTENCY-03"
  | "IDEMPOTENCY-04"
  | "REFERENCE-01"
  | "REFERENCE-02"
  | "REFERENCE-03"
  | "REFERENCE-04";

/** Canonical amounts / literals used by this slice. */
export const IDEMPOTENCY_AMOUNT = 250;
export const IDEMPOTENCY_CONFLICT_AMOUNT = 251;
export const REFERENCE_AMOUNT = 200;

// ---------------------------------------------------------------------------
// Deterministic input builder
// ---------------------------------------------------------------------------

const MAX_SUFFIX_LEN = 24;

function safeSuffix(runIdentity: string): string {
  const cleaned = runIdentity.replace(/[^A-Za-z0-9]/g, "").slice(0, MAX_SUFFIX_LEN);
  return cleaned.length > 0 ? cleaned : "run";
}

export interface Stage3CIdempotencyReferenceInputs {
  readonly idempotencyReference: string;
  readonly idempotencyKey: string;
  readonly referenceValue: string;
  readonly referencePrimaryKey: string;
  readonly referenceDuplicateKey: string;
  readonly referenceCrossBillKey: string;
  readonly referenceOtherSocietyKey: string;
}

/**
 * Deterministic — the same `runIdentity` always produces the exact same
 * object. No `Date.now`, no randomness, no time-varying input. Every
 * value is nonblank, bounded and space-free. All five keys are
 * distinct from each other and from the two reference values.
 */
export function buildStage3CIdempotencyReferenceInputs(
  runIdentity: string,
): Stage3CIdempotencyReferenceInputs {
  const suffix = safeSuffix(runIdentity);
  return {
    idempotencyReference: `IDEM-${suffix}`,
    idempotencyKey: `idem-key-${suffix}`,
    referenceValue: `REF-${suffix}`,
    referencePrimaryKey: `ref-primary-${suffix}`,
    referenceDuplicateKey: `ref-duplicate-${suffix}`,
    referenceCrossBillKey: `ref-crossbill-${suffix}`,
    referenceOtherSocietyKey: `ref-other-society-${suffix}`,
  };
}

// ---------------------------------------------------------------------------
// Small local helpers
// ---------------------------------------------------------------------------

function assertEq(actual: unknown, expected: unknown, label: string): void {
  if (actual !== expected)
    throw new Error(`[stage3c:${label}] expected value equality (values redacted)`);
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

function whitespaceCaseVariant(value: string): string {
  return `  ${value.toLowerCase()}  `;
}

// ---------------------------------------------------------------------------
// IDEMPOTENCY handlers
// ---------------------------------------------------------------------------

export async function idempotency01_initializeAndSubmit(
  ctx: Stage3CLiveMatrixContext,
): Promise<void> {
  const f = requireMatrixFixture(ctx);
  const inputs = buildStage3CIdempotencyReferenceInputs(f.prefix);
  const billId = f.idempotencyBillId;

  const initial = await snapshot(
    f,
    f.users.activeResident,
    billId,
    f.societyA,
    "IDEMPOTENCY-01-initial",
  );

  const paymentId = await f.helpers.submitResidentBankTransferPayment({
    actor: f.users.activeResident,
    billId,
    amount: IDEMPOTENCY_AMOUNT,
    paymentDate: f.testPaymentDate,
    referenceNo: inputs.idempotencyReference,
    idempotencyKey: inputs.idempotencyKey,
  });
  const validated = CanonicalStage3CUuidSchema.parse(paymentId);
  trackUniqueId(f.tracked.paymentIds, validated, "idempotency:primary");

  const postSubmit = await snapshot(
    f,
    f.users.activeResident,
    billId,
    f.societyA,
    "IDEMPOTENCY-01-post",
  );
  const delta = postSubmit.paymentRows.length - initial.paymentRows.length;
  assertEq(delta, 1, "IDEMPOTENCY-01:row-delta");

  ctx.idempotencyBillId = billId;
  ctx.idempotencyPaymentId = validated;
  ctx.idempotencyReference = inputs.idempotencyReference;
  ctx.idempotencyKey = inputs.idempotencyKey;
  ctx.idempotencyAmount = IDEMPOTENCY_AMOUNT;
  ctx.idempotencyInitialState = initial;
  ctx.idempotencyPostSubmitState = postSubmit;
  ctx.idempotencyInitialSequences = initial.sequences;
  ctx.idempotencyPostSubmitSequences = postSubmit.sequences;
}

export async function idempotency02_exactReplay(
  ctx: Stage3CLiveMatrixContext,
): Promise<void> {
  const f = requireMatrixFixture(ctx);
  const billId = requireIdempotencyBillId(ctx);
  const reference = requireIdempotencyReference(ctx);
  const key = requireIdempotencyKey(ctx);
  const amount = requireIdempotencyAmount(ctx);
  const originalId = requireIdempotencyPaymentId(ctx);
  const before = requireIdempotencyInitialState(ctx);

  const replayId = await f.helpers.submitResidentBankTransferPayment({
    actor: f.users.activeResident,
    billId,
    amount,
    paymentDate: f.testPaymentDate,
    referenceNo: reference,
    idempotencyKey: key,
  });
  const replayValidated = CanonicalStage3CUuidSchema.parse(replayId);
  assertEq(replayValidated, originalId, "IDEMPOTENCY-02:replay-id");

  const after = await snapshot(
    f,
    f.users.activeResident,
    billId,
    f.societyA,
    "IDEMPOTENCY-02-post",
  );
  // Payment row count must remain identical to the post-primary snapshot.
  assertEq(
    after.paymentRows.length,
    (ctx.idempotencyPostSubmitState?.paymentRows.length ?? before.paymentRows.length + 1),
    "IDEMPOTENCY-02:row-count",
  );
  ctx.idempotencyPostSubmitState = after;
}

export async function idempotency03_singleMutationProof(
  ctx: Stage3CLiveMatrixContext,
): Promise<void> {
  const f = requireMatrixFixture(ctx);
  const billId = requireIdempotencyBillId(ctx);
  const originalPaymentId = requireIdempotencyPaymentId(ctx);
  // Purely observational — no submit call.
  const now = await snapshot(
    f,
    f.users.activeResident,
    billId,
    f.societyA,
    "IDEMPOTENCY-03",
  );
  const matches = now.paymentRows.filter((r) => r.id === originalPaymentId);
  assertEq(matches.length, 1, "IDEMPOTENCY-03:original-row-persists");
  ctx.idempotencyPostSubmitState = now;
}

export async function idempotency04_conflictingReplayDenied(
  ctx: Stage3CLiveMatrixContext,
): Promise<void> {
  const f = requireMatrixFixture(ctx);
  const billId = requireIdempotencyBillId(ctx);
  const reference = requireIdempotencyReference(ctx);
  const key = requireIdempotencyKey(ctx);
  const before = requireIdempotencyInitialState(ctx);

  let caught: unknown = undefined;
  let succeededData: string | undefined;
  try {
    succeededData = await f.helpers.submitResidentBankTransferPayment({
      actor: f.users.activeResident,
      billId,
      amount: IDEMPOTENCY_CONFLICT_AMOUNT,
      paymentDate: f.testPaymentDate,
      referenceNo: reference,
      idempotencyKey: key,
    });
  } catch (e) {
    caught = e;
  }
  if (succeededData !== undefined) {
    throw new Error("[IDEMPOTENCY-04] unexpected success — conflicting replay must be denied");
  }
  assertCanonicalError(caught, STAGE3C_ERRORS.IDEMPOTENCY_CONFLICT, "IDEMPOTENCY-04");

  const after = await snapshot(
    f,
    f.users.activeResident,
    billId,
    f.societyA,
    "IDEMPOTENCY-04-post",
  );
  assertResidentBillStateUnchanged(before, after, "IDEMPOTENCY-04");
  ctx.idempotencyPostSubmitState = after;
}

// ---------------------------------------------------------------------------
// REFERENCE handlers
// ---------------------------------------------------------------------------

export async function reference01_createUniqueReference(
  ctx: Stage3CLiveMatrixContext,
): Promise<void> {
  const f = requireMatrixFixture(ctx);
  const inputs = buildStage3CIdempotencyReferenceInputs(f.prefix);
  const billId = f.referencePrimaryBillId;

  const initial = await snapshot(
    f,
    f.users.activeResident,
    billId,
    f.societyA,
    "REFERENCE-01-initial",
  );

  const paymentId = await f.helpers.submitResidentBankTransferPayment({
    actor: f.users.activeResident,
    billId,
    amount: REFERENCE_AMOUNT,
    paymentDate: f.testPaymentDate,
    referenceNo: inputs.referenceValue,
    idempotencyKey: inputs.referencePrimaryKey,
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
  ctx.referenceSecondarySameSocietyBillId = f.referenceSecondarySameSocietyBillId;
  ctx.referenceOtherSocietyBillId = f.referenceOtherSocietyBillId;
  ctx.referencePrimaryPaymentId = validated;
  ctx.referenceValue = inputs.referenceValue;
  ctx.referenceAmount = REFERENCE_AMOUNT;
  ctx.referencePrimaryKey = inputs.referencePrimaryKey;
  ctx.referenceDuplicateKey = inputs.referenceDuplicateKey;
  ctx.referenceCrossBillKey = inputs.referenceCrossBillKey;
  ctx.referenceOtherSocietyKey = inputs.referenceOtherSocietyKey;
  ctx.referencePrimaryInitialState = initial;
  ctx.referencePrimaryPostSubmitState = post;
  ctx.referenceInitialSequences = initial.sequences;
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
  if (label === "REFERENCE-03") ctx.referenceSecondaryInitialState = attemptedAfter;
}

export async function reference02_duplicateSameBillDenied(
  ctx: Stage3CLiveMatrixContext,
): Promise<void> {
  const f = requireMatrixFixture(ctx);
  const inputs = buildStage3CIdempotencyReferenceInputs(f.prefix);
  ctx.referenceDuplicateKey = inputs.referenceDuplicateKey;
  await assertDuplicateReferenceDenied(
    ctx,
    "REFERENCE-02",
    requireReferencePrimaryBillId(ctx),
    inputs.referenceDuplicateKey,
  );
}

export async function reference03_duplicateCanonicalScopeDenied(
  ctx: Stage3CLiveMatrixContext,
): Promise<void> {
  const f = requireMatrixFixture(ctx);
  const inputs = buildStage3CIdempotencyReferenceInputs(f.prefix);
  ctx.referenceCrossBillKey = inputs.referenceCrossBillKey;
  await assertDuplicateReferenceDenied(
    ctx,
    "REFERENCE-03",
    f.referenceSecondarySameSocietyBillId,
    inputs.referenceCrossBillKey,
  );
}

export async function reference04_outsideScopeIsolation(
  ctx: Stage3CLiveMatrixContext,
): Promise<void> {
  const f = requireMatrixFixture(ctx);
  requireReferencePrimaryPaymentId(ctx);
  const primaryBillId = requireReferencePrimaryBillId(ctx);
  const primaryBefore = requireReferencePrimaryInitialState(ctx);
  const variant = whitespaceCaseVariant(requireReferenceValue(ctx));
  const inputs = buildStage3CIdempotencyReferenceInputs(f.prefix);
  const billId = f.referenceOtherSocietyBillId;
  ctx.referenceOtherSocietyKey = inputs.referenceOtherSocietyKey;

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
    idempotencyKey: inputs.referenceOtherSocietyKey,
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

  const primaryAfter = await snapshot(
    f,
    f.users.activeResident,
    primaryBillId,
    f.societyA,
    "REFERENCE-04-primary-post",
  );
  assertResidentBillStateUnchanged(primaryBefore, primaryAfter, "REFERENCE-04-primary");
  ctx.referenceOtherSocietyPaymentId = validated;
  ctx.referenceOtherSocietyInitialState = initial;
  ctx.referenceOtherSocietyPostSubmitState = post;
}

// ---------------------------------------------------------------------------
// Registry — canonical shared handler typing (`Stage3CMatrixLiveHandler`)
// ---------------------------------------------------------------------------

export const STAGE3C_IDEMPOTENCY_REFERENCE_HANDLERS = {
  "IDEMPOTENCY-01": idempotency01_initializeAndSubmit,
  "IDEMPOTENCY-02": idempotency02_exactReplay,
  "IDEMPOTENCY-03": idempotency03_singleMutationProof,
  "IDEMPOTENCY-04": idempotency04_conflictingReplayDenied,
  "REFERENCE-01": reference01_createUniqueReference,
  "REFERENCE-02": reference02_duplicateSameBillDenied,
  "REFERENCE-03": reference03_duplicateCanonicalScopeDenied,
  "REFERENCE-04": reference04_outsideScopeIsolation,
} satisfies Record<Stage3CIdempotencyReferenceCaseId, Stage3CMatrixLiveHandler>;

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

// Zod re-export kept only for downstream tests that already track the
// deterministic input contract; loose `{ billId, rowCount }` lifecycle
// schemas have been removed in Sub-run A.
export const Stage3CIdempotencyReferenceInputsSchema = z
  .object({
    idempotencyReference: z.string().min(1),
    idempotencyKey: z.string().min(1),
    referenceValue: z.string().min(1),
    referencePrimaryKey: z.string().min(1),
    referenceDuplicateKey: z.string().min(1),
    referenceCrossBillKey: z.string().min(1),
    referenceOtherSocietyKey: z.string().min(1),
  })
  .strict();
