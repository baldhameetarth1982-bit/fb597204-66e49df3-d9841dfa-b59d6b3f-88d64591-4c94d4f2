/**
 * Stage 3C — Live matrix lifecycle context.
 *
 * Composes {@link createStage3CLiveCoreContext} and layers the strictly
 * typed resident-submit, idempotency and reference lifecycle state
 * that upcoming manifest cases will populate. Every new field starts
 * as `null` and is validated on retrieval by a labeled guard — no
 * fake defaults, no globalThis, no unknown state bags.
 *
 * IDEMPOTENCY / REFERENCE Sub-run A structural closure:
 *   - canonical strict lifecycle slots (no `unknown`, no loose
 *     `{ billId, rowCount }` snapshot bags);
 *   - dedicated guards for every field consumed by upcoming behavioral
 *     handlers (`require*`);
 *   - error messages are static — never interpolate stored UUIDs,
 *     amounts, references, keys or raw objects.
 */
import {
  createStage3CLiveCoreContext,
  type BillSummarySnapshot,
  type Stage3CLiveCoreContext,
} from "./stage3c-live-core-context";
import {
  ReceiptSequenceSnapshotSchema,
  type ReceiptSequenceSnapshot,
  type ResidentBillSummary,
  type ResidentBillStateSnapshot,
} from "./stage3c-live-resident-submit-contracts";
import {
  CanonicalStage3CUuidSchema,
  type Stage3CCleanupEvidence,
  type Stage3CCleanupObserver,
  type Stage3CFixture,
} from "./stage3c-runtime-fixtures";
import type {
  ResidentPaymentDetail,
  ResidentPaymentHistoryRow,
  Stage3CReadDenialEvidence,
} from "./stage3c-live-read-cases";
import type {
  Stage3CRejectionState,
  Stage3CReversalState,
} from "./stage3c-live-rejection-reversal-cases";



export interface Stage3CLiveMatrixContext extends Stage3CLiveCoreContext {
  // Resident-submit foundation slots (validator contract)
  residentBillId: string | null;
  residentBaselineSummary: BillSummarySnapshot | null;
  residentPostSubmitSummary: BillSummarySnapshot | null;
  residentPaymentId: string | null;
  residentAmount: number | null;
  residentReference: string | null;
  residentIdempotencyKey: string | null;

  // Resident-submit lifecycle slots (RESIDENT-SUBMIT-01..08)
  residentSubmitPaymentId: string | null;
  residentSubmitAmount: number | null;
  residentSubmitReference: string | null;
  residentSubmitIdempotencyKey: string | null;
  residentSubmitInitialSummary: ResidentBillSummary | null;
  residentSubmitPendingSummary: ResidentBillSummary | null;
  residentSubmitInitialReceiptSequences: ReceiptSequenceSnapshot | null;

  // Idempotency category (retained legacy slots)
  idempotencyBillAId: string | null;
  idempotencyBillBId: string | null;
  idempotencyOriginalPaymentId: string | null;
  idempotencyBaselinePaymentCount: number | null;
  idempotencyBaselineSummary: BillSummarySnapshot | null;
  idempotencyPostSummary: BillSummarySnapshot | null;

  // Idempotency lifecycle (Sub-run A canonical slots)
  idempotencyBillId: string | null;
  idempotencyPaymentId: string | null;
  idempotencyAmount: number | null;
  idempotencyReference: string | null;
  idempotencyKey: string | null;
  idempotencyInitialState: ResidentBillStateSnapshot | null;
  idempotencyPostSubmitState: ResidentBillStateSnapshot | null;
  idempotencyInitialSequences: ReceiptSequenceSnapshot | null;
  idempotencyPostSubmitSequences: ReceiptSequenceSnapshot | null;

  // Reference category (retained legacy slots)
  referenceBillId: string | null;
  canonicalReference: string | null;
  referenceOriginalPaymentId: string | null;
  referenceBaselinePaymentCount: number | null;
  referencePostOriginalSummary: BillSummarySnapshot | null;

  // Reference lifecycle (Sub-run A canonical slots)
  referencePrimaryBillId: string | null;
  referenceSecondarySameSocietyBillId: string | null;
  referenceOtherSocietyBillId: string | null;
  referencePrimaryPaymentId: string | null;
  referenceOtherSocietyPaymentId: string | null;
  referenceAmount: number | null;
  referenceValue: string | null;
  referencePrimaryKey: string | null;
  referenceDuplicateKey: string | null;
  referenceCrossBillKey: string | null;
  referenceOtherSocietyKey: string | null;
  referencePrimaryInitialState: ResidentBillStateSnapshot | null;
  referencePrimaryPostSubmitState: ResidentBillStateSnapshot | null;
  referenceSecondaryInitialState: ResidentBillStateSnapshot | null;
  referenceOtherSocietyInitialState: ResidentBillStateSnapshot | null;
  referenceOtherSocietyPostSubmitState: ResidentBillStateSnapshot | null;
  referenceInitialSequences: ReceiptSequenceSnapshot | null;

  // READ category (Sub-run B1 — READ-01..04 success behavior)
  // READ category (Sub-run B1 — READ-01..04 success behavior; Sub-run B2 — READ-05..10 denial)
  readPrimaryBillId: string | null;
  readPrimaryPaymentId: string | null;
  readHistoryBaselineCount: number | null;
  readExpectedHistoryRow: ResidentPaymentHistoryRow | null;
  readExpectedHistory: readonly ResidentPaymentHistoryRow[] | null;
  readExpectedDetail: ResidentPaymentDetail | null;
  readAcceptedDetail: ResidentPaymentDetail | null;
  // READ-10 out-of-scope resources (block admin denial target)
  readOtherBlockBillId: string | null;
  readOtherBlockPaymentId: string | null;
  // READ-05..10 evidence — one denial-evidence per denial case, set by handler.
  readDenialEvidence: {
    "READ-05": Stage3CReadDenialEvidence | null;
    "READ-06": Stage3CReadDenialEvidence | null;
    "READ-07": Stage3CReadDenialEvidence | null;
    "READ-08": Stage3CReadDenialEvidence | null;
    "READ-09": Stage3CReadDenialEvidence | null;
    "READ-10": Stage3CReadDenialEvidence | null;
  };

  // PRIVACY receipt-bearing detail (verified payment with issued receipt),
  // primed at fixture setup via primeStage3CReadContext.
  privacyReceiptPaymentId: string | null;
  privacyReceiptBillId: string | null;
  privacyReceiptDetail: ResidentPaymentDetail | null;

  // REJECTION lifecycle state — lazily populated by REJECTION-01 handler.
  rejectionState: Stage3CRejectionState | null;

  // REVERSAL lifecycle state — lazily populated by REVERSAL-01 handler.
  reversalState: Stage3CReversalState | null;

  // CLEANUP-01..03 post-teardown slots.
  //
  // `cleanupEvidence` is captured while the fixture is still alive and is
  // deliberately the ONLY source CLEANUP reads: the live tracker may be
  // mutated by teardown. `teardownCompletedAt` is set by the runtime
  // workflow after primary teardown returns, so a CLEANUP case can never
  // pass by running before teardown. `cleanupObserver` is an independent
  // disposable client, never the fixture's own admin client.
  cleanupEvidence: Stage3CCleanupEvidence | null;
  cleanupObserver: Stage3CCleanupObserver | null;
  teardownCompletedAt: string | null;
}



export function createStage3CLiveMatrixContext(): Stage3CLiveMatrixContext {
  return {
    ...createStage3CLiveCoreContext(),
    residentBillId: null,
    residentBaselineSummary: null,
    residentPostSubmitSummary: null,
    residentPaymentId: null,
    residentAmount: null,
    residentReference: null,
    residentIdempotencyKey: null,

    residentSubmitPaymentId: null,
    residentSubmitAmount: null,
    residentSubmitReference: null,
    residentSubmitIdempotencyKey: null,
    residentSubmitInitialSummary: null,
    residentSubmitPendingSummary: null,
    residentSubmitInitialReceiptSequences: null,

    idempotencyBillAId: null,
    idempotencyBillBId: null,
    idempotencyOriginalPaymentId: null,
    idempotencyBaselinePaymentCount: null,
    idempotencyBaselineSummary: null,
    idempotencyPostSummary: null,

    idempotencyBillId: null,
    idempotencyPaymentId: null,
    idempotencyAmount: null,
    idempotencyReference: null,
    idempotencyKey: null,
    idempotencyInitialState: null,
    idempotencyPostSubmitState: null,
    idempotencyInitialSequences: null,
    idempotencyPostSubmitSequences: null,

    referenceBillId: null,
    canonicalReference: null,
    referenceOriginalPaymentId: null,
    referenceBaselinePaymentCount: null,
    referencePostOriginalSummary: null,

    referencePrimaryBillId: null,
    referenceSecondarySameSocietyBillId: null,
    referenceOtherSocietyBillId: null,
    referencePrimaryPaymentId: null,
    referenceOtherSocietyPaymentId: null,
    referenceAmount: null,
    referenceValue: null,
    referencePrimaryKey: null,
    referenceDuplicateKey: null,
    referenceCrossBillKey: null,
    referenceOtherSocietyKey: null,
    referencePrimaryInitialState: null,
    referencePrimaryPostSubmitState: null,
    referenceSecondaryInitialState: null,
    referenceOtherSocietyInitialState: null,
    referenceOtherSocietyPostSubmitState: null,
    referenceInitialSequences: null,

    readPrimaryBillId: null,
    readPrimaryPaymentId: null,
    readHistoryBaselineCount: null,
    readExpectedHistoryRow: null,
    readExpectedHistory: null,
    readExpectedDetail: null,
    readAcceptedDetail: null,
    readOtherBlockBillId: null,
    readOtherBlockPaymentId: null,
    readDenialEvidence: {
      "READ-05": null,
      "READ-06": null,
      "READ-07": null,
      "READ-08": null,
      "READ-09": null,
      "READ-10": null,
    },

    privacyReceiptPaymentId: null,
    privacyReceiptBillId: null,
    privacyReceiptDetail: null,

    rejectionState: null,
    reversalState: null,
    cleanupEvidence: null,
    cleanupObserver: null,
    teardownCompletedAt: null,
  };
}



// ---------------------------------------------------------------------------
// Primitive guard helpers (static error messages — no stored value leaks)
// ---------------------------------------------------------------------------

const MAX_TEXT_LEN = 120;

function throwMissing(field: string, expectedFrom: string): never {
  // Field name is a compile-time literal — never a stored value.
  throw new Error(
    `[stage3c:matrix] required lifecycle field "${field}" not initialised — ${expectedFrom} must run first`,
  );
}

function throwInvalid(field: string, reason: string): never {
  throw new Error(`[stage3c:matrix] "${field}" invalid: ${reason}`);
}

function requireCanonicalUuid(
  value: string | null,
  field: string,
  expectedFrom: string,
): string {
  if (value === null) throwMissing(field, expectedFrom);
  const parsed = CanonicalStage3CUuidSchema.safeParse(value);
  if (!parsed.success) throwInvalid(field, "not a canonical UUID");
  return parsed.data;
}

function requireBoundedNonBlankText(
  value: string | null,
  field: string,
  expectedFrom: string,
): string {
  if (value === null) throwMissing(field, expectedFrom);
  const trimmed = value.trim();
  if (trimmed.length === 0) throwInvalid(field, "blank/whitespace");
  if (trimmed.length > MAX_TEXT_LEN)
    throwInvalid(field, `exceeds ${MAX_TEXT_LEN} characters`);
  return trimmed;
}

function requirePositiveFinite(
  value: number | null,
  field: string,
  expectedFrom: string,
): number {
  if (value === null) throwMissing(field, expectedFrom);
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0)
    throwInvalid(field, "must be a positive finite number");
  return value;
}

function requireNonNegativeInteger(
  value: number | null,
  field: string,
  expectedFrom: string,
): number {
  if (value === null) throwMissing(field, expectedFrom);
  if (!Number.isInteger(value) || value < 0)
    throwInvalid(field, "must be a non-negative integer");
  return value;
}

function requireLegacySummary(
  value: BillSummarySnapshot | null,
  field: string,
  expectedFrom: string,
): BillSummarySnapshot {
  if (value === null) throwMissing(field, expectedFrom);
  return value;
}

function requireStrictResidentSummary(
  value: ResidentBillSummary | null,
  field: string,
  expectedFrom: string,
): ResidentBillSummary {
  if (value === null) throwMissing(field, expectedFrom);
  return value;
}

function requireResidentBillState(
  value: ResidentBillStateSnapshot | null,
  field: string,
  expectedFrom: string,
): ResidentBillStateSnapshot {
  if (value === null) throwMissing(field, expectedFrom);
  // Structural gate on the strict child schemas — every state snapshot
  // must at minimum have a valid receipt sequence bag.
  if (!ReceiptSequenceSnapshotSchema.safeParse(value.sequences).success)
    throwInvalid(field, "sequences failed strict schema");
  return value;
}

function requireReceiptSequenceSnapshot(
  value: ReceiptSequenceSnapshot | null,
  field: string,
  expectedFrom: string,
): ReceiptSequenceSnapshot {
  if (value === null) throwMissing(field, expectedFrom);
  const parsed = ReceiptSequenceSnapshotSchema.safeParse(value);
  if (!parsed.success) throwInvalid(field, "failed strict sequence schema");
  return parsed.data;
}

// ---------------------------------------------------------------------------
// Resident-submit foundation guards (retained)
// ---------------------------------------------------------------------------

export function requireMatrixFixture(ctx: Stage3CLiveMatrixContext): Stage3CFixture {
  if (!ctx.fixture) throw new Error("[stage3c:matrix] fixture not initialised");
  return ctx.fixture;
}

export const requireResidentBillId = (c: Stage3CLiveMatrixContext) =>
  requireCanonicalUuid(c.residentBillId, "residentBillId", "RESIDENT-SUBMIT-01");
export const requireResidentBaselineSummary = (c: Stage3CLiveMatrixContext) =>
  requireLegacySummary(c.residentBaselineSummary, "residentBaselineSummary", "RESIDENT-SUBMIT-01");
export const requireResidentPostSubmitSummary = (c: Stage3CLiveMatrixContext) =>
  requireLegacySummary(c.residentPostSubmitSummary, "residentPostSubmitSummary", "RESIDENT-SUBMIT-02");
export const requireResidentPaymentId = (c: Stage3CLiveMatrixContext) =>
  requireCanonicalUuid(c.residentPaymentId, "residentPaymentId", "RESIDENT-SUBMIT-02");
export const requireResidentAmount = (c: Stage3CLiveMatrixContext) =>
  requirePositiveFinite(c.residentAmount, "residentAmount", "RESIDENT-SUBMIT-01");
export const requireResidentReference = (c: Stage3CLiveMatrixContext) =>
  requireBoundedNonBlankText(c.residentReference, "residentReference", "RESIDENT-SUBMIT-01");
export const requireResidentIdempotencyKey = (c: Stage3CLiveMatrixContext) =>
  requireBoundedNonBlankText(c.residentIdempotencyKey, "residentIdempotencyKey", "RESIDENT-SUBMIT-01");

export const requireResidentSubmitPaymentId = (c: Stage3CLiveMatrixContext) =>
  requireCanonicalUuid(c.residentSubmitPaymentId, "residentSubmitPaymentId", "RESIDENT-SUBMIT-02");
export const requireResidentSubmitAmount = (c: Stage3CLiveMatrixContext) =>
  requirePositiveFinite(c.residentSubmitAmount, "residentSubmitAmount", "RESIDENT-SUBMIT-01");
export const requireResidentSubmitReference = (c: Stage3CLiveMatrixContext) =>
  requireBoundedNonBlankText(c.residentSubmitReference, "residentSubmitReference", "RESIDENT-SUBMIT-01");
export const requireResidentSubmitIdempotencyKey = (c: Stage3CLiveMatrixContext) =>
  requireBoundedNonBlankText(
    c.residentSubmitIdempotencyKey,
    "residentSubmitIdempotencyKey",
    "RESIDENT-SUBMIT-01",
  );
export const requireResidentSubmitInitialSummary = (c: Stage3CLiveMatrixContext) =>
  requireStrictResidentSummary(
    c.residentSubmitInitialSummary,
    "residentSubmitInitialSummary",
    "RESIDENT-SUBMIT-01",
  );
export const requireResidentSubmitPendingSummary = (c: Stage3CLiveMatrixContext) =>
  requireStrictResidentSummary(
    c.residentSubmitPendingSummary,
    "residentSubmitPendingSummary",
    "RESIDENT-SUBMIT-08",
  );

export function requireResidentSubmitInitialReceiptSequences(
  c: Stage3CLiveMatrixContext,
): ReceiptSequenceSnapshot {
  return requireReceiptSequenceSnapshot(
    c.residentSubmitInitialReceiptSequences,
    "residentSubmitInitialReceiptSequences",
    "RESIDENT-SUBMIT-01",
  );
}

// ---------------------------------------------------------------------------
// Legacy idempotency / reference guards (retained)
// ---------------------------------------------------------------------------

export const requireIdempotencyBillAId = (c: Stage3CLiveMatrixContext) =>
  requireCanonicalUuid(c.idempotencyBillAId, "idempotencyBillAId", "IDEMPOTENCY-01");
export const requireIdempotencyBillBId = (c: Stage3CLiveMatrixContext) =>
  requireCanonicalUuid(c.idempotencyBillBId, "idempotencyBillBId", "IDEMPOTENCY-01");
export const requireIdempotencyOriginalPaymentId = (c: Stage3CLiveMatrixContext) =>
  requireCanonicalUuid(
    c.idempotencyOriginalPaymentId,
    "idempotencyOriginalPaymentId",
    "IDEMPOTENCY-01",
  );
export const requireIdempotencyBaselinePaymentCount = (c: Stage3CLiveMatrixContext) =>
  requireNonNegativeInteger(
    c.idempotencyBaselinePaymentCount,
    "idempotencyBaselinePaymentCount",
    "IDEMPOTENCY-01",
  );
export const requireIdempotencyBaselineSummary = (c: Stage3CLiveMatrixContext) =>
  requireLegacySummary(c.idempotencyBaselineSummary, "idempotencyBaselineSummary", "IDEMPOTENCY-01");
export const requireIdempotencyPostSummary = (c: Stage3CLiveMatrixContext) =>
  requireLegacySummary(c.idempotencyPostSummary, "idempotencyPostSummary", "IDEMPOTENCY-02");

export const requireReferenceBillId = (c: Stage3CLiveMatrixContext) =>
  requireCanonicalUuid(c.referenceBillId, "referenceBillId", "REFERENCE-01");
export const requireCanonicalReference = (c: Stage3CLiveMatrixContext) =>
  requireBoundedNonBlankText(c.canonicalReference, "canonicalReference", "REFERENCE-01");
export const requireReferenceOriginalPaymentId = (c: Stage3CLiveMatrixContext) =>
  requireCanonicalUuid(
    c.referenceOriginalPaymentId,
    "referenceOriginalPaymentId",
    "REFERENCE-01",
  );
export const requireReferenceBaselinePaymentCount = (c: Stage3CLiveMatrixContext) =>
  requireNonNegativeInteger(
    c.referenceBaselinePaymentCount,
    "referenceBaselinePaymentCount",
    "REFERENCE-01",
  );
export const requireReferencePostOriginalSummary = (c: Stage3CLiveMatrixContext) =>
  requireLegacySummary(
    c.referencePostOriginalSummary,
    "referencePostOriginalSummary",
    "REFERENCE-01",
  );

// ---------------------------------------------------------------------------
// Sub-run A canonical IDEMPOTENCY guards
// ---------------------------------------------------------------------------

export const requireIdempotencyBillId = (c: Stage3CLiveMatrixContext) =>
  requireCanonicalUuid(c.idempotencyBillId, "idempotencyBillId", "IDEMPOTENCY-01");
export const requireIdempotencyPaymentId = (c: Stage3CLiveMatrixContext) =>
  requireCanonicalUuid(c.idempotencyPaymentId, "idempotencyPaymentId", "IDEMPOTENCY-01");
export const requireIdempotencyAmount = (c: Stage3CLiveMatrixContext) =>
  requirePositiveFinite(c.idempotencyAmount, "idempotencyAmount", "IDEMPOTENCY-01");
export const requireIdempotencyReference = (c: Stage3CLiveMatrixContext) =>
  requireBoundedNonBlankText(c.idempotencyReference, "idempotencyReference", "IDEMPOTENCY-01");
export const requireIdempotencyKey = (c: Stage3CLiveMatrixContext) =>
  requireBoundedNonBlankText(c.idempotencyKey, "idempotencyKey", "IDEMPOTENCY-01");
export const requireIdempotencyInitialState = (c: Stage3CLiveMatrixContext) =>
  requireResidentBillState(c.idempotencyInitialState, "idempotencyInitialState", "IDEMPOTENCY-01");
export const requireIdempotencyPostSubmitState = (c: Stage3CLiveMatrixContext) =>
  requireResidentBillState(
    c.idempotencyPostSubmitState,
    "idempotencyPostSubmitState",
    "IDEMPOTENCY-01",
  );
export const requireIdempotencyInitialSequences = (c: Stage3CLiveMatrixContext) =>
  requireReceiptSequenceSnapshot(
    c.idempotencyInitialSequences,
    "idempotencyInitialSequences",
    "IDEMPOTENCY-01",
  );

// ---------------------------------------------------------------------------
// Sub-run A canonical REFERENCE guards
// ---------------------------------------------------------------------------

export const requireReferencePrimaryBillId = (c: Stage3CLiveMatrixContext) =>
  requireCanonicalUuid(c.referencePrimaryBillId, "referencePrimaryBillId", "REFERENCE-01");
export const requireReferenceSecondarySameSocietyBillId = (c: Stage3CLiveMatrixContext) =>
  requireCanonicalUuid(
    c.referenceSecondarySameSocietyBillId,
    "referenceSecondarySameSocietyBillId",
    "REFERENCE-03",
  );
export const requireReferenceOtherSocietyBillId = (c: Stage3CLiveMatrixContext) =>
  requireCanonicalUuid(
    c.referenceOtherSocietyBillId,
    "referenceOtherSocietyBillId",
    "REFERENCE-04",
  );
export const requireReferencePrimaryPaymentId = (c: Stage3CLiveMatrixContext) =>
  requireCanonicalUuid(c.referencePrimaryPaymentId, "referencePrimaryPaymentId", "REFERENCE-01");
export const requireReferenceOtherSocietyPaymentId = (c: Stage3CLiveMatrixContext) =>
  requireCanonicalUuid(
    c.referenceOtherSocietyPaymentId,
    "referenceOtherSocietyPaymentId",
    "REFERENCE-04",
  );
export const requireReferenceAmount = (c: Stage3CLiveMatrixContext) =>
  requirePositiveFinite(c.referenceAmount, "referenceAmount", "REFERENCE-01");
export const requireReferenceValue = (c: Stage3CLiveMatrixContext) =>
  requireBoundedNonBlankText(c.referenceValue, "referenceValue", "REFERENCE-01");
export const requireReferencePrimaryKey = (c: Stage3CLiveMatrixContext) =>
  requireBoundedNonBlankText(c.referencePrimaryKey, "referencePrimaryKey", "REFERENCE-01");
export const requireReferenceDuplicateKey = (c: Stage3CLiveMatrixContext) =>
  requireBoundedNonBlankText(c.referenceDuplicateKey, "referenceDuplicateKey", "REFERENCE-02");
export const requireReferenceCrossBillKey = (c: Stage3CLiveMatrixContext) =>
  requireBoundedNonBlankText(c.referenceCrossBillKey, "referenceCrossBillKey", "REFERENCE-03");
export const requireReferenceOtherSocietyKey = (c: Stage3CLiveMatrixContext) =>
  requireBoundedNonBlankText(
    c.referenceOtherSocietyKey,
    "referenceOtherSocietyKey",
    "REFERENCE-04",
  );
export const requireReferencePrimaryInitialState = (c: Stage3CLiveMatrixContext) =>
  requireResidentBillState(
    c.referencePrimaryInitialState,
    "referencePrimaryInitialState",
    "REFERENCE-01",
  );
export const requireReferencePrimaryPostSubmitState = (c: Stage3CLiveMatrixContext) =>
  requireResidentBillState(
    c.referencePrimaryPostSubmitState,
    "referencePrimaryPostSubmitState",
    "REFERENCE-01",
  );
export const requireReferenceSecondaryInitialState = (c: Stage3CLiveMatrixContext) =>
  requireResidentBillState(
    c.referenceSecondaryInitialState,
    "referenceSecondaryInitialState",
    "REFERENCE-03",
  );
export const requireReferenceOtherSocietyInitialState = (c: Stage3CLiveMatrixContext) =>
  requireResidentBillState(
    c.referenceOtherSocietyInitialState,
    "referenceOtherSocietyInitialState",
    "REFERENCE-04",
  );
export const requireReferenceOtherSocietyPostSubmitState = (c: Stage3CLiveMatrixContext) =>
  requireResidentBillState(
    c.referenceOtherSocietyPostSubmitState,
    "referenceOtherSocietyPostSubmitState",
    "REFERENCE-04",
  );
export const requireReferenceInitialSequences = (c: Stage3CLiveMatrixContext) =>
  requireReceiptSequenceSnapshot(
    c.referenceInitialSequences,
    "referenceInitialSequences",
    "REFERENCE-01",
  );

// ---------------------------------------------------------------------------
// READ category guards (Sub-run B1 — success behavior for READ-01..04)
// ---------------------------------------------------------------------------

export const requireReadPrimaryBillId = (c: Stage3CLiveMatrixContext) =>
  requireCanonicalUuid(c.readPrimaryBillId, "readPrimaryBillId", "READ-01");
export const requireReadPrimaryPaymentId = (c: Stage3CLiveMatrixContext) =>
  requireCanonicalUuid(c.readPrimaryPaymentId, "readPrimaryPaymentId", "READ-02");
export const requireReadHistoryBaselineCount = (c: Stage3CLiveMatrixContext) =>
  requireNonNegativeInteger(
    c.readHistoryBaselineCount,
    "readHistoryBaselineCount",
    "READ-01",
  );


export function requireReadExpectedHistoryRow(
  c: Stage3CLiveMatrixContext,
): ResidentPaymentHistoryRow {
  if (c.readExpectedHistoryRow === null)
    throwMissing("readExpectedHistoryRow", "READ-01");
  return c.readExpectedHistoryRow;
}

export function requireReadExpectedHistory(
  c: Stage3CLiveMatrixContext,
): readonly ResidentPaymentHistoryRow[] {
  if (c.readExpectedHistory === null)
    throwMissing("readExpectedHistory", "READ-01");
  return c.readExpectedHistory;
}

export function requireReadExpectedDetail(
  c: Stage3CLiveMatrixContext,
): ResidentPaymentDetail {
  if (c.readExpectedDetail === null)
    throwMissing("readExpectedDetail", "READ-02");
  return c.readExpectedDetail;
}

export function requireReadAcceptedDetail(
  c: Stage3CLiveMatrixContext,
): ResidentPaymentDetail {
  if (c.readAcceptedDetail === null)
    throwMissing("readAcceptedDetail", "READ-03");
  return c.readAcceptedDetail;
}

// READ-10 out-of-scope resources
export const requireReadOtherBlockBillId = (c: Stage3CLiveMatrixContext) =>
  requireCanonicalUuid(c.readOtherBlockBillId, "readOtherBlockBillId", "READ-10");
export const requireReadOtherBlockPaymentId = (c: Stage3CLiveMatrixContext) =>
  requireCanonicalUuid(c.readOtherBlockPaymentId, "readOtherBlockPaymentId", "READ-10");

// PRIVACY receipt-bearing detail guards
export function requirePrivacyReceiptDetail(
  c: Stage3CLiveMatrixContext,
): ResidentPaymentDetail {
  if (c.privacyReceiptDetail === null)
    throwMissing("privacyReceiptDetail", "primeStage3CReadContext");
  return c.privacyReceiptDetail;
}
export const requirePrivacyReceiptPaymentId = (c: Stage3CLiveMatrixContext) =>
  requireCanonicalUuid(
    c.privacyReceiptPaymentId,
    "privacyReceiptPaymentId",
    "primeStage3CReadContext",
  );
export const requirePrivacyReceiptBillId = (c: Stage3CLiveMatrixContext) =>
  requireCanonicalUuid(
    c.privacyReceiptBillId,
    "privacyReceiptBillId",
    "primeStage3CReadContext",
  );



