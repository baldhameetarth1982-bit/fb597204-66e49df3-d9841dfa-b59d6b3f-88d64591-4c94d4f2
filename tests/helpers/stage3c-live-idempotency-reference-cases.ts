/**
 * Stage 3C — IDEMPOTENCY-01..04 + REFERENCE-01..04 live case handlers.
 *
 * Sub-run A structural closure (preserved):
 *   - shared handler typing via {@link Stage3CMatrixLiveHandler};
 *   - eight exact named exports;
 *   - deterministic input builder;
 *   - strict matrix-context lifecycle fields + `require*` guards.
 *
 * Sub-run B — IDEMPOTENCY behavioral closure:
 *   - IDEMPOTENCY-01 asserts the exact clean baseline (total 1000, all
 *     amounts 0, zero payments, zero receipts, cancelled false,
 *     unpaid/open) and one canonical mutation (amount 250, status
 *     `pending`, source `resident_submission`, exact reference/key,
 *     no verified/rejected/reversal fields, sequences unchanged);
 *   - IDEMPOTENCY-02 exact replay returns the original ID with full
 *     pre/post state equality — no second track, no new row, no
 *     receipt, no sequence mutation;
 *   - IDEMPOTENCY-03 is observational only (zero submit calls) and
 *     proves exactly one canonical pending row + exact initial→current
 *     deltas;
 *   - IDEMPOTENCY-04 replays same bill/key/reference with amount 251,
 *     accepts only the canonical `idempotency_conflict` token, and
 *     throws a static safe message on unexpected success.
 */
import {
  trackUniqueId,
  CanonicalStage3CUuidSchema,
  type Stage3CFixture,
} from "./stage3c-runtime-fixtures";
import { STAGE3C_ERRORS, assertCanonicalError } from "./stage3c-live-errors";
import { safeStage3CErrorMessage } from "./stage3c-error-redaction";
import {
  snapshotResidentBillState,
  assertResidentBillStateUnchanged,
  assertReceiptSequencesExactlyEqual,
  assertNoReceiptForResidentPayment,
  ResidentSubmittedPaymentRowSchema,
  type ResidentBillStateSnapshot,
  type ResidentSubmittedPaymentRow,
} from "./stage3c-live-resident-submit-contracts";
import {
  requireMatrixFixture,
  requireIdempotencyBillId,
  requireIdempotencyPaymentId,
  requireIdempotencyReference,
  requireIdempotencyKey,
  requireIdempotencyAmount,
  requireIdempotencyInitialState,
  requireIdempotencyPostSubmitState,
  requireIdempotencyInitialSequences,
  requireReferencePrimaryBillId,
  requireReferencePrimaryPaymentId,
  requireReferencePrimaryPostSubmitState,
  requireReferenceSecondarySameSocietyBillId,
  requireReferenceSecondaryInitialState,
  requireReferenceValue,
  requireReferenceDuplicateKey,
  requireReferenceCrossBillKey,
  requireReferenceOtherSocietyKey,
  requireReferenceInitialSequences,
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

/** Locked expected total for the dedicated idempotency bill. */
export const IDEMPOTENCY_BILL_TOTAL = 1000;

/** Static unexpected-success message for IDEMPOTENCY-04. */
export const IDEMPOTENCY_04_UNEXPECTED_SUCCESS_MESSAGE =
  "[stage3c:IDEMPOTENCY-04] unexpected successful mutation";

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

function assertTrue(cond: boolean, label: string): void {
  if (!cond) throw new Error(`[stage3c:${label}] invariant failed`);
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
// Baseline / state assertions (exported for direct behavioral tests)
// ---------------------------------------------------------------------------

/**
 * Locks the exact clean baseline the IDEMPOTENCY-01 handler requires
 * before it is allowed to submit its canonical mutation.
 *
 *   - `total_payable` === 1000;
 *   - every mutable amount === 0;
 *   - `available_to_submit` === 1000;
 *   - `remaining_verified_balance` === 1000;
 *   - `cancelled` === false;
 *   - `status` ∈ { unpaid, open };
 *   - zero payment rows.
 */
export function assertCleanIdempotencyBaseline(
  state: ResidentBillStateSnapshot,
  label: string,
): void {
  const s = state.summary;
  if (s.total_payable !== IDEMPOTENCY_BILL_TOTAL)
    throw new Error(`[stage3c:${label}] baseline total_payable must be 1000`);
  if (s.verified_amount !== 0)
    throw new Error(`[stage3c:${label}] baseline verified_amount must be 0`);
  if (s.pending_amount !== 0)
    throw new Error(`[stage3c:${label}] baseline pending_amount must be 0`);
  if (s.rejected_amount !== 0)
    throw new Error(`[stage3c:${label}] baseline rejected_amount must be 0`);
  if (s.reversed_amount !== 0)
    throw new Error(`[stage3c:${label}] baseline reversed_amount must be 0`);
  if (s.available_to_submit !== IDEMPOTENCY_BILL_TOTAL)
    throw new Error(`[stage3c:${label}] baseline available_to_submit must be 1000`);
  if (s.remaining_verified_balance !== IDEMPOTENCY_BILL_TOTAL)
    throw new Error(
      `[stage3c:${label}] baseline remaining_verified_balance must be 1000`,
    );
  if (s.cancelled !== false)
    throw new Error(`[stage3c:${label}] baseline cancelled must be false`);
  if (s.status !== "unpaid" && s.status !== "open")
    throw new Error(`[stage3c:${label}] baseline status must be unpaid/open`);
  if (state.paymentRows.length !== 0)
    throw new Error(`[stage3c:${label}] baseline must have zero payment rows`);
}

/**
 * Asserts the exact financial totals expected after a single 250-amount
 * pending resident submission on the dedicated 1000 idempotency bill.
 */
export function assertIdempotencyPostSubmitTotals(
  initial: ResidentBillStateSnapshot,
  post: ResidentBillStateSnapshot,
  label: string,
): void {
  const p = post.summary;
  if (p.total_payable !== IDEMPOTENCY_BILL_TOTAL)
    throw new Error(`[stage3c:${label}] total must remain 1000`);
  if (p.pending_amount !== IDEMPOTENCY_AMOUNT)
    throw new Error(`[stage3c:${label}] pending must become 250`);
  if (p.available_to_submit !== IDEMPOTENCY_BILL_TOTAL - IDEMPOTENCY_AMOUNT)
    throw new Error(`[stage3c:${label}] available must become 750`);
  if (p.verified_amount !== 0)
    throw new Error(`[stage3c:${label}] verified must remain 0`);
  if (p.rejected_amount !== 0)
    throw new Error(`[stage3c:${label}] rejected must remain 0`);
  if (p.reversed_amount !== 0)
    throw new Error(`[stage3c:${label}] reversed must remain 0`);
  if (p.remaining_verified_balance !== IDEMPOTENCY_BILL_TOTAL)
    throw new Error(
      `[stage3c:${label}] remaining_verified_balance must remain 1000`,
    );
  if (p.cancelled !== false)
    throw new Error(`[stage3c:${label}] cancelled must remain false`);
  if (p.status !== "unpaid" && p.status !== "open")
    throw new Error(`[stage3c:${label}] status must remain unpaid/open`);
  const rowDelta = post.paymentRows.length - initial.paymentRows.length;
  if (rowDelta !== 1)
    throw new Error(`[stage3c:${label}] payment-row delta must be +1`);
}

/**
 * Loads the fully-typed pending resident payment row via the admin
 * client and validates every field. Every mismatch throws a static
 * safe error — no supplied values are interpolated.
 */
export async function assertCanonicalPendingResidentRow(
  admin: Stage3CFixture["admin"],
  expected: {
    id: string;
    billId: string;
    societyId: string;
    submittedBy: string;
    amount: number;
    reference: string;
    key: string;
  },
  label: string,
): Promise<ResidentSubmittedPaymentRow> {
  const columns =
    "id, bill_id, society_id, submitted_by, amount, method, status, source, " +
    "reference_no, idempotency_key, verified_by, verified_at, rejected_by, " +
    "rejected_at, rejection_reason, reversed_by, reversed_at, reversal_reason";
  const r = await admin.from("payments").select(columns).eq("id", expected.id);
  if (r.error)
    throw new Error(safeStage3CErrorMessage(`${label}-payment-row`, r.error));
  if (!Array.isArray(r.data))
    throw new Error(`[stage3c:${label}] payments payload not array`);
  if (r.data.length !== 1)
    throw new Error(`[stage3c:${label}] expected exactly one payment row`);
  const parsed = ResidentSubmittedPaymentRowSchema.safeParse(r.data[0]);
  if (!parsed.success)
    throw new Error(`[stage3c:${label}] payment row failed strict schema`);
  const row = parsed.data;
  if (row.id !== expected.id)
    throw new Error(`[stage3c:${label}] payment row id mismatch`);
  if (row.bill_id !== expected.billId)
    throw new Error(`[stage3c:${label}] payment row bill scope mismatch`);
  if (row.society_id !== expected.societyId)
    throw new Error(`[stage3c:${label}] payment row society scope mismatch`);
  if (row.submitted_by !== expected.submittedBy)
    throw new Error(`[stage3c:${label}] payment row submitter mismatch`);
  if (row.amount !== expected.amount)
    throw new Error(`[stage3c:${label}] payment row amount mismatch`);
  if (row.reference_no !== expected.reference)
    throw new Error(`[stage3c:${label}] payment row reference mismatch`);
  if (row.idempotency_key !== expected.key)
    throw new Error(`[stage3c:${label}] payment row key mismatch`);
  // Schema already pins method/status/source and all verify/reject/reversal
  // fields to null, so no additional checks needed here.
  return row;
}

// ---------------------------------------------------------------------------
// IDEMPOTENCY handlers
// ---------------------------------------------------------------------------

export async function idempotency01_initializeAndSubmit(
  ctx: Stage3CLiveMatrixContext,
): Promise<void> {
  const f = requireMatrixFixture(ctx);
  const inputs = buildStage3CIdempotencyReferenceInputs(f.prefix);
  const billId = CanonicalStage3CUuidSchema.parse(f.idempotencyBillId);
  const societyId = CanonicalStage3CUuidSchema.parse(f.societyA);
  const actor = f.users.activeResident;

  // 1. Strict clean baseline + snapshot.
  const initial = await snapshot(f, actor, billId, societyId, "IDEMPOTENCY-01-initial");
  assertCleanIdempotencyBaseline(initial, "IDEMPOTENCY-01-baseline");

  // 2. Submit exactly once via the shared resident core.
  const paymentId = await f.helpers.submitResidentBankTransferPayment({
    actor,
    billId,
    amount: IDEMPOTENCY_AMOUNT,
    paymentDate: f.testPaymentDate,
    referenceNo: inputs.idempotencyReference,
    idempotencyKey: inputs.idempotencyKey,
  });
  const validated = CanonicalStage3CUuidSchema.parse(paymentId);
  trackUniqueId(f.tracked.paymentIds, validated, "idempotency:primary");

  // 3. Post-submit snapshot + exact financial invariants.
  const postSubmit = await snapshot(
    f,
    actor,
    billId,
    societyId,
    "IDEMPOTENCY-01-post",
  );
  assertIdempotencyPostSubmitTotals(initial, postSubmit, "IDEMPOTENCY-01");

  // 4. Exact row proof (full strict schema).
  await assertCanonicalPendingResidentRow(
    f.admin,
    {
      id: validated,
      billId,
      societyId,
      submittedBy: CanonicalStage3CUuidSchema.parse(actor.id),
      amount: IDEMPOTENCY_AMOUNT,
      reference: inputs.idempotencyReference,
      key: inputs.idempotencyKey,
    },
    "IDEMPOTENCY-01",
  );

  // 5. Zero receipts + sequences unchanged.
  await assertNoReceiptForResidentPayment(f.admin, validated, "IDEMPOTENCY-01");
  assertReceiptSequencesExactlyEqual(
    initial.sequences,
    postSubmit.sequences,
    "IDEMPOTENCY-01-sequences",
  );

  // 6. Store canonical context slots.
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
  const postSubmitBefore = requireIdempotencyPostSubmitState(ctx);
  const initialSequences = requireIdempotencyInitialSequences(ctx);
  const trackedBefore = f.tracked.paymentIds.length;
  const actor = f.users.activeResident;
  const societyId = CanonicalStage3CUuidSchema.parse(f.societyA);

  // Exact replay — same payload as IDEMPOTENCY-01.
  const replayId = await f.helpers.submitResidentBankTransferPayment({
    actor,
    billId,
    amount,
    paymentDate: f.testPaymentDate,
    referenceNo: reference,
    idempotencyKey: key,
  });
  const replayValidated = CanonicalStage3CUuidSchema.parse(replayId);
  assertEq(replayValidated, originalId, "IDEMPOTENCY-02:replay-id");
  // NOT tracking the replay — original occurrence must remain exactly one.
  assertEq(f.tracked.paymentIds.length, trackedBefore, "IDEMPOTENCY-02:no-new-track");

  // Full pre/post equality — no mutation at all.
  const after = await snapshot(f, actor, billId, societyId, "IDEMPOTENCY-02-post");
  assertResidentBillStateUnchanged(postSubmitBefore, after, "IDEMPOTENCY-02-state");
  assertReceiptSequencesExactlyEqual(
    initialSequences,
    after.sequences,
    "IDEMPOTENCY-02-sequences",
  );
  await assertNoReceiptForResidentPayment(f.admin, originalId, "IDEMPOTENCY-02");
  ctx.idempotencyPostSubmitState = after;
}

export async function idempotency03_singleMutationProof(
  ctx: Stage3CLiveMatrixContext,
): Promise<void> {
  const f = requireMatrixFixture(ctx);
  const billId = requireIdempotencyBillId(ctx);
  const originalPaymentId = requireIdempotencyPaymentId(ctx);
  const initial = requireIdempotencyInitialState(ctx);
  const initialSequences = requireIdempotencyInitialSequences(ctx);
  const reference = requireIdempotencyReference(ctx);
  const key = requireIdempotencyKey(ctx);
  const actor = f.users.activeResident;
  const societyId = CanonicalStage3CUuidSchema.parse(f.societyA);

  // Observational only — no submit call.
  const now = await snapshot(f, actor, billId, societyId, "IDEMPOTENCY-03");

  // Exactly one canonical pending row equal to the original.
  if (now.paymentRows.length !== 1)
    throw new Error(`[stage3c:IDEMPOTENCY-03] expected exactly one payment row`);
  const only = now.paymentRows[0];
  if (!only) throw new Error(`[stage3c:IDEMPOTENCY-03] payment row missing`);
  assertEq(only.id, originalPaymentId, "IDEMPOTENCY-03:row-id");
  assertEq(only.amount, IDEMPOTENCY_AMOUNT, "IDEMPOTENCY-03:row-amount");
  assertEq(only.status, "pending", "IDEMPOTENCY-03:row-status");

  // Full strict row + zero receipts + sequences unchanged.
  await assertCanonicalPendingResidentRow(
    f.admin,
    {
      id: originalPaymentId,
      billId,
      societyId,
      submittedBy: CanonicalStage3CUuidSchema.parse(actor.id),
      amount: IDEMPOTENCY_AMOUNT,
      reference,
      key,
    },
    "IDEMPOTENCY-03",
  );
  await assertNoReceiptForResidentPayment(f.admin, originalPaymentId, "IDEMPOTENCY-03");
  assertReceiptSequencesExactlyEqual(
    initialSequences,
    now.sequences,
    "IDEMPOTENCY-03-sequences",
  );

  // Exact initial→current deltas.
  const i = initial.summary;
  const c = now.summary;
  assertEq(c.total_payable - i.total_payable, 0, "IDEMPOTENCY-03:total-delta");
  assertEq(c.pending_amount - i.pending_amount, IDEMPOTENCY_AMOUNT, "IDEMPOTENCY-03:pending-delta");
  assertEq(i.available_to_submit - c.available_to_submit, IDEMPOTENCY_AMOUNT, "IDEMPOTENCY-03:available-delta");
  assertEq(c.verified_amount - i.verified_amount, 0, "IDEMPOTENCY-03:verified-delta");
  assertEq(c.rejected_amount - i.rejected_amount, 0, "IDEMPOTENCY-03:rejected-delta");
  assertEq(c.reversed_amount - i.reversed_amount, 0, "IDEMPOTENCY-03:reversed-delta");
  assertEq(
    c.remaining_verified_balance - i.remaining_verified_balance,
    0,
    "IDEMPOTENCY-03:remaining-delta",
  );
  assertEq(now.paymentRows.length - initial.paymentRows.length, 1, "IDEMPOTENCY-03:row-delta");
  assertTrue(c.cancelled === false, "IDEMPOTENCY-03:cancelled");
  assertTrue(c.status === "unpaid" || c.status === "open", "IDEMPOTENCY-03:status");
  ctx.idempotencyPostSubmitState = now;
}

export async function idempotency04_conflictingReplayDenied(
  ctx: Stage3CLiveMatrixContext,
): Promise<void> {
  const f = requireMatrixFixture(ctx);
  const billId = requireIdempotencyBillId(ctx);
  const reference = requireIdempotencyReference(ctx);
  const key = requireIdempotencyKey(ctx);
  const originalId = requireIdempotencyPaymentId(ctx);
  const trackedBefore = f.tracked.paymentIds.length;
  const actor = f.users.activeResident;
  const societyId = CanonicalStage3CUuidSchema.parse(f.societyA);

  // 1. Snapshot complete state before the request.
  const before = await snapshot(f, actor, billId, societyId, "IDEMPOTENCY-04-before");

  // 2. Call the shared resident core inside try; catch only provider failure.
  let caught: unknown = undefined;
  let succeeded = false;
  try {
    await f.helpers.submitResidentBankTransferPayment({
      actor,
      billId,
      amount: IDEMPOTENCY_CONFLICT_AMOUNT,
      paymentDate: f.testPaymentDate,
      referenceNo: reference,
      idempotencyKey: key,
    });
    succeeded = true;
  } catch (e) {
    caught = e;
  }
  // Throw unexpected-success outside catch — static message, no payload.
  if (succeeded) {
    throw new Error(IDEMPOTENCY_04_UNEXPECTED_SUCCESS_MESSAGE);
  }
  assertCanonicalError(caught, STAGE3C_ERRORS.IDEMPOTENCY_CONFLICT, "IDEMPOTENCY-04");

  // 3. Complete state unchanged.
  const after = await snapshot(f, actor, billId, societyId, "IDEMPOTENCY-04-after");
  assertResidentBillStateUnchanged(before, after, "IDEMPOTENCY-04-state");
  assertReceiptSequencesExactlyEqual(
    before.sequences,
    after.sequences,
    "IDEMPOTENCY-04-sequences",
  );
  await assertNoReceiptForResidentPayment(f.admin, originalId, "IDEMPOTENCY-04");
  assertEq(after.paymentRows.length, 1, "IDEMPOTENCY-04:row-count");
  const only = after.paymentRows[0];
  if (!only) throw new Error(`[stage3c:IDEMPOTENCY-04] payment row missing`);
  assertEq(only.id, originalId, "IDEMPOTENCY-04:original-id-preserved");
  assertEq(only.amount, IDEMPOTENCY_AMOUNT, "IDEMPOTENCY-04:original-amount-preserved");
  assertEq(only.status, "pending", "IDEMPOTENCY-04:original-status-preserved");
  assertEq(f.tracked.paymentIds.length, trackedBefore, "IDEMPOTENCY-04:no-new-track");
  ctx.idempotencyPostSubmitState = after;
}

// ---------------------------------------------------------------------------
// REFERENCE handlers (unchanged — Sub-run C will close behavioral)
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
];
