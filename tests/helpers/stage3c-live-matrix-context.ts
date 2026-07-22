/**
 * Stage 3C — Live matrix lifecycle context.
 *
 * Composes {@link createStage3CLiveCoreContext} and layers the strictly
 * typed resident-submit, idempotency and reference lifecycle state
 * that upcoming manifest cases will populate. Every new field starts
 * as `null` and is validated on retrieval by a labeled guard — no
 * fake defaults, no globalThis, no unknown state bags.
 *
 * The `residentSubmit*` fields are the canonical lifecycle slots used
 * by the RESIDENT-SUBMIT-01..08 handlers implemented in this run. The
 * older, more general `resident*` fields are retained for the
 * foundation validator contract; they are unused by the resident-
 * submit handlers.
 */
import {
  createStage3CLiveCoreContext,
  type BillSummarySnapshot,
  type Stage3CLiveCoreContext,
} from "./stage3c-live-core-context";
import type { Stage3CFixture } from "./stage3c-runtime-fixtures";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface Stage3CLiveMatrixContext extends Stage3CLiveCoreContext {
  // Resident-submit foundation slots (validator contract)
  residentBillId: string | null;
  residentBaselineSummary: BillSummarySnapshot | null;
  residentPostSubmitSummary: BillSummarySnapshot | null;
  residentPaymentId: string | null;
  residentAmount: number | null;
  residentReference: string | null;
  residentIdempotencyKey: string | null;

  // Resident-submit lifecycle slots (this run — RESIDENT-SUBMIT-01..08)
  residentSubmitPaymentId: string | null;
  residentSubmitAmount: number | null;
  residentSubmitReference: string | null;
  residentSubmitIdempotencyKey: string | null;
  residentSubmitInitialSummary: BillSummarySnapshot | null;
  residentSubmitPendingSummary: BillSummarySnapshot | null;
  residentSubmitInitialReceiptSequences: unknown | null;


  // Idempotency category
  idempotencyBillAId: string | null;
  idempotencyBillBId: string | null;
  idempotencyKey: string | null;
  idempotencyAmount: number | null;
  idempotencyOriginalPaymentId: string | null;
  idempotencyBaselinePaymentCount: number | null;
  idempotencyBaselineSummary: BillSummarySnapshot | null;
  idempotencyPostSummary: BillSummarySnapshot | null;

  // Reference category
  referenceBillId: string | null;
  canonicalReference: string | null;
  referenceOriginalPaymentId: string | null;
  referenceBaselinePaymentCount: number | null;
  referencePostOriginalSummary: BillSummarySnapshot | null;
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

    idempotencyBillAId: null,
    idempotencyBillBId: null,
    idempotencyKey: null,
    idempotencyAmount: null,
    idempotencyOriginalPaymentId: null,
    idempotencyBaselinePaymentCount: null,
    idempotencyBaselineSummary: null,
    idempotencyPostSummary: null,

    referenceBillId: null,
    canonicalReference: null,
    referenceOriginalPaymentId: null,
    referenceBaselinePaymentCount: null,
    referencePostOriginalSummary: null,
  };
}

// ---------------------------------------------------------------------------
// Guards
// ---------------------------------------------------------------------------

function failGuard(field: string, expectedFrom: string): never {
  throw new Error(
    `[stage3c:matrix] required lifecycle field "${field}" not initialised — ${expectedFrom} must run first`,
  );
}

function requireUuid(value: string | null, field: string, expectedFrom: string): string {
  if (value === null) failGuard(field, expectedFrom);
  const trimmed = value.trim();
  if (trimmed.length === 0 || !UUID_RE.test(trimmed))
    throw new Error(`[stage3c:matrix] "${field}" is not a valid UUID`);
  return trimmed;
}

function requireNonBlank(value: string | null, field: string, expectedFrom: string): string {
  if (value === null) failGuard(field, expectedFrom);
  const trimmed = value.trim();
  if (trimmed.length === 0)
    throw new Error(`[stage3c:matrix] "${field}" is blank/whitespace`);
  return trimmed;
}

function requireBoundedNonBlank(
  value: string | null,
  field: string,
  expectedFrom: string,
  maxLen: number,
): string {
  const t = requireNonBlank(value, field, expectedFrom);
  if (t.length > maxLen)
    throw new Error(`[stage3c:matrix] "${field}" exceeds ${maxLen} characters`);
  return t;
}

function requirePositiveFinite(
  value: number | null,
  field: string,
  expectedFrom: string,
): number {
  if (value === null) failGuard(field, expectedFrom);
  if (!Number.isFinite(value) || value <= 0)
    throw new Error(`[stage3c:matrix] "${field}" must be a positive finite number`);
  return value;
}

function requireNonNegativeInteger(
  value: number | null,
  field: string,
  expectedFrom: string,
): number {
  if (value === null) failGuard(field, expectedFrom);
  if (!Number.isInteger(value) || value < 0)
    throw new Error(`[stage3c:matrix] "${field}" must be a non-negative integer`);
  return value;
}

function requireSummary(
  value: BillSummarySnapshot | null,
  field: string,
  expectedFrom: string,
): BillSummarySnapshot {
  if (value === null) failGuard(field, expectedFrom);
  return value;
}

export function requireMatrixFixture(ctx: Stage3CLiveMatrixContext): Stage3CFixture {
  if (!ctx.fixture) throw new Error("[stage3c:matrix] fixture not initialised");
  return ctx.fixture;
}

// Foundation resident guards (retained)
export const requireResidentBillId = (c: Stage3CLiveMatrixContext) =>
  requireUuid(c.residentBillId, "residentBillId", "RESIDENT-SUBMIT-01");
export const requireResidentBaselineSummary = (c: Stage3CLiveMatrixContext) =>
  requireSummary(c.residentBaselineSummary, "residentBaselineSummary", "RESIDENT-SUBMIT-01");
export const requireResidentPostSubmitSummary = (c: Stage3CLiveMatrixContext) =>
  requireSummary(c.residentPostSubmitSummary, "residentPostSubmitSummary", "RESIDENT-SUBMIT-02");
export const requireResidentPaymentId = (c: Stage3CLiveMatrixContext) =>
  requireUuid(c.residentPaymentId, "residentPaymentId", "RESIDENT-SUBMIT-02");
export const requireResidentAmount = (c: Stage3CLiveMatrixContext) =>
  requirePositiveFinite(c.residentAmount, "residentAmount", "RESIDENT-SUBMIT-01");
export const requireResidentReference = (c: Stage3CLiveMatrixContext) =>
  requireNonBlank(c.residentReference, "residentReference", "RESIDENT-SUBMIT-01");
export const requireResidentIdempotencyKey = (c: Stage3CLiveMatrixContext) =>
  requireNonBlank(c.residentIdempotencyKey, "residentIdempotencyKey", "RESIDENT-SUBMIT-01");

// Resident-submit lifecycle guards (this run)
export const requireResidentSubmitPaymentId = (c: Stage3CLiveMatrixContext) =>
  requireUuid(c.residentSubmitPaymentId, "residentSubmitPaymentId", "RESIDENT-SUBMIT-02");
export const requireResidentSubmitAmount = (c: Stage3CLiveMatrixContext) =>
  requirePositiveFinite(c.residentSubmitAmount, "residentSubmitAmount", "RESIDENT-SUBMIT-01");
export const requireResidentSubmitReference = (c: Stage3CLiveMatrixContext) =>
  requireBoundedNonBlank(c.residentSubmitReference, "residentSubmitReference", "RESIDENT-SUBMIT-01", 120);
export const requireResidentSubmitIdempotencyKey = (c: Stage3CLiveMatrixContext) =>
  requireBoundedNonBlank(
    c.residentSubmitIdempotencyKey,
    "residentSubmitIdempotencyKey",
    "RESIDENT-SUBMIT-01",
    120,
  );
export const requireResidentSubmitInitialSummary = (c: Stage3CLiveMatrixContext) =>
  requireSummary(
    c.residentSubmitInitialSummary,
    "residentSubmitInitialSummary",
    "RESIDENT-SUBMIT-01",
  );
export const requireResidentSubmitPendingSummary = (c: Stage3CLiveMatrixContext) =>
  requireSummary(
    c.residentSubmitPendingSummary,
    "residentSubmitPendingSummary",
    "RESIDENT-SUBMIT-08",
  );

// Idempotency guards
export const requireIdempotencyBillAId = (c: Stage3CLiveMatrixContext) =>
  requireUuid(c.idempotencyBillAId, "idempotencyBillAId", "IDEMPOTENCY-01");
export const requireIdempotencyBillBId = (c: Stage3CLiveMatrixContext) =>
  requireUuid(c.idempotencyBillBId, "idempotencyBillBId", "IDEMPOTENCY-01");
export const requireIdempotencyKey = (c: Stage3CLiveMatrixContext) =>
  requireNonBlank(c.idempotencyKey, "idempotencyKey", "IDEMPOTENCY-01");
export const requireIdempotencyAmount = (c: Stage3CLiveMatrixContext) =>
  requirePositiveFinite(c.idempotencyAmount, "idempotencyAmount", "IDEMPOTENCY-01");
export const requireIdempotencyOriginalPaymentId = (c: Stage3CLiveMatrixContext) =>
  requireUuid(
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
  requireSummary(c.idempotencyBaselineSummary, "idempotencyBaselineSummary", "IDEMPOTENCY-01");
export const requireIdempotencyPostSummary = (c: Stage3CLiveMatrixContext) =>
  requireSummary(c.idempotencyPostSummary, "idempotencyPostSummary", "IDEMPOTENCY-02");

// Reference guards
export const requireReferenceBillId = (c: Stage3CLiveMatrixContext) =>
  requireUuid(c.referenceBillId, "referenceBillId", "REFERENCE-01");
export const requireCanonicalReference = (c: Stage3CLiveMatrixContext) =>
  requireNonBlank(c.canonicalReference, "canonicalReference", "REFERENCE-01");
export const requireReferenceOriginalPaymentId = (c: Stage3CLiveMatrixContext) =>
  requireUuid(
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
  requireSummary(
    c.referencePostOriginalSummary,
    "referencePostOriginalSummary",
    "REFERENCE-01",
  );
