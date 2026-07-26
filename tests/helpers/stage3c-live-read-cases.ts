/**
 * Stage 3C — READ-01..10 live case contracts (Sub-run A, structural only).
 *
 * Purpose:
 *   - lock the exact ten READ case ids and their canonical order;
 *   - declare the minimum typed model required by the manifest
 *     descriptions (resident payment detail, history row, audience,
 *     pagination, denial evidence);
 *   - expose ten named handler exports that satisfy the shared
 *     {@link Stage3CMatrixLiveHandler} contract and fail closed with a
 *     static, safe not-implemented message until behavioral Sub-run B
 *     replaces each body.
 *
 * Non-goals for this sub-run:
 *   - no live RPC calls, no database writes, no production mutation
 *     helpers, no PRIVACY logic, no registry composition changes.
 *
 * Canonical manifest descriptions (source of truth =
 * {@link ../helpers/stage3c-live-case-manifest.ts}):
 *   READ-01 Active resident sees their own payment history
 *   READ-02 Active resident sees their own payment detail
 *   READ-03 Resident payment detail carries audience = resident
 *   READ-04 Production parsePaymentDetailResponse accepts the live resident payload
 *   READ-05 Moved-out resident cannot fetch payment history
 *   READ-06 Moved-out resident cannot fetch payment detail
 *   READ-07 Unrelated resident cannot fetch another society's payment detail
 *   READ-08 Admin B (other society) cannot fetch Society A payment detail
 *   READ-09 Guard cannot fetch payment detail
 *   READ-10 Block Admin cannot fetch payment detail outside their scope
 */
import { z } from "zod";
import { CanonicalStage3CUuidSchema } from "./stage3c-runtime-fixtures";
import type { Stage3CMatrixLiveHandler } from "./stage3c-live-matrix-registry";

// ---------------------------------------------------------------------------
// Canonical case-id union + ordered list
// ---------------------------------------------------------------------------

export type Stage3CReadCaseId =
  | "READ-01"
  | "READ-02"
  | "READ-03"
  | "READ-04"
  | "READ-05"
  | "READ-06"
  | "READ-07"
  | "READ-08"
  | "READ-09"
  | "READ-10";

export const STAGE3C_READ_CASE_IDS: readonly Stage3CReadCaseId[] = [
  "READ-01",
  "READ-02",
  "READ-03",
  "READ-04",
  "READ-05",
  "READ-06",
  "READ-07",
  "READ-08",
  "READ-09",
  "READ-10",
] as const;

// ---------------------------------------------------------------------------
// Typed READ contract model — narrow strict schemas
// ---------------------------------------------------------------------------

/** Audience marker attached to every resident-facing payment payload. */
export const Stage3CReadAudienceSchema = z.enum(["resident", "admin"]);
export type Stage3CReadAudience = z.infer<typeof Stage3CReadAudienceSchema>;

/** Canonical payment status literals visible to READ contracts. */
export const Stage3CReadPaymentStatusSchema = z.enum([
  "pending",
  "verified",
  "rejected",
  "reversed",
]);
export type Stage3CReadPaymentStatus = z.infer<typeof Stage3CReadPaymentStatusSchema>;

/** Canonical payment method literals visible to READ contracts. */
export const Stage3CReadPaymentMethodSchema = z.enum(["cash", "bank_transfer"]);
export type Stage3CReadPaymentMethod = z.infer<typeof Stage3CReadPaymentMethodSchema>;

/** One row of the resident payment history projection (READ-01, READ-05). */
export const ResidentPaymentHistoryRowSchema = z
  .object({
    paymentId: CanonicalStage3CUuidSchema,
    billId: CanonicalStage3CUuidSchema,
    societyId: CanonicalStage3CUuidSchema,
    amount: z.number().finite().positive(),
    status: Stage3CReadPaymentStatusSchema,
    method: Stage3CReadPaymentMethodSchema,
    audience: Stage3CReadAudienceSchema,
  })
  .strict();
export type ResidentPaymentHistoryRow = z.infer<typeof ResidentPaymentHistoryRowSchema>;

/** Pagination metadata attached to a history page (READ-01). */
export const ResidentPaymentHistoryPaginationSchema = z
  .object({
    limit: z.number().int().positive(),
    offset: z.number().int().nonnegative(),
    total: z.number().int().nonnegative(),
  })
  .strict();
export type ResidentPaymentHistoryPagination = z.infer<
  typeof ResidentPaymentHistoryPaginationSchema
>;

/** Full history page projection (READ-01). */
export const ResidentPaymentHistoryPageSchema = z
  .object({
    rows: z.array(ResidentPaymentHistoryRowSchema).readonly(),
    pagination: ResidentPaymentHistoryPaginationSchema,
  })
  .strict();
export type ResidentPaymentHistoryPage = z.infer<typeof ResidentPaymentHistoryPageSchema>;

/**
 * Resident-facing payment detail projection (READ-02..04, denial cases
 * READ-06..10 compare denial vs this success shape). Deliberately narrow
 * — PRIVACY forbidden fields (proof_url, submitted_by, receipt.issued_by,
 * etc.) are enforced in the PRIVACY category, not here.
 */
export const ResidentPaymentDetailSchema = z
  .object({
    paymentId: CanonicalStage3CUuidSchema,
    billId: CanonicalStage3CUuidSchema,
    societyId: CanonicalStage3CUuidSchema,
    amount: z.number().finite().positive(),
    status: Stage3CReadPaymentStatusSchema,
    method: Stage3CReadPaymentMethodSchema,
    audience: Stage3CReadAudienceSchema,
  })
  .strict();
export type ResidentPaymentDetail = z.infer<typeof ResidentPaymentDetailSchema>;

/** Static denial-evidence contract for the six denial READ cases. */
export const Stage3CReadDenialTokenSchema = z.enum([
  "not_authenticated",
  "unauthenticated",
  "not_authorized",
]);
export type Stage3CReadDenialToken = z.infer<typeof Stage3CReadDenialTokenSchema>;

export const Stage3CReadDenialEvidenceSchema = z
  .object({
    caseId: z.enum([
      "READ-05",
      "READ-06",
      "READ-07",
      "READ-08",
      "READ-09",
      "READ-10",
    ]),
    token: Stage3CReadDenialTokenSchema,
    returnedRow: z.null(),
  })
  .strict();
export type Stage3CReadDenialEvidence = z.infer<typeof Stage3CReadDenialEvidenceSchema>;

// ---------------------------------------------------------------------------
// Static not-implemented messages (safe — no context values embedded)
// ---------------------------------------------------------------------------

const NOT_IMPLEMENTED: Readonly<Record<Stage3CReadCaseId, string>> = Object.freeze({
  "READ-01": "[stage3c:READ-01] behavior not implemented",
  "READ-02": "[stage3c:READ-02] behavior not implemented",
  "READ-03": "[stage3c:READ-03] behavior not implemented",
  "READ-04": "[stage3c:READ-04] behavior not implemented",
  "READ-05": "[stage3c:READ-05] behavior not implemented",
  "READ-06": "[stage3c:READ-06] behavior not implemented",
  "READ-07": "[stage3c:READ-07] behavior not implemented",
  "READ-08": "[stage3c:READ-08] behavior not implemented",
  "READ-09": "[stage3c:READ-09] behavior not implemented",
  "READ-10": "[stage3c:READ-10] behavior not implemented",
});

export function stage3cReadNotImplementedMessage(id: Stage3CReadCaseId): string {
  return NOT_IMPLEMENTED[id];
}

function notImplemented(id: Stage3CReadCaseId): never {
  throw new Error(NOT_IMPLEMENTED[id]);
}

// ---------------------------------------------------------------------------
// Ten named handler exports — one per canonical manifest description
// ---------------------------------------------------------------------------

export const read01_activeResidentSeesOwnPaymentHistory: Stage3CMatrixLiveHandler =
  async (_ctx) => {
    notImplemented("READ-01");
  };

export const read02_activeResidentSeesOwnPaymentDetail: Stage3CMatrixLiveHandler =
  async (_ctx) => {
    notImplemented("READ-02");
  };

export const read03_residentPaymentDetailCarriesResidentAudience: Stage3CMatrixLiveHandler =
  async (_ctx) => {
    notImplemented("READ-03");
  };

export const read04_productionParserAcceptsResidentPayload: Stage3CMatrixLiveHandler =
  async (_ctx) => {
    notImplemented("READ-04");
  };

export const read05_movedOutResidentDeniedPaymentHistory: Stage3CMatrixLiveHandler =
  async (_ctx) => {
    notImplemented("READ-05");
  };

export const read06_movedOutResidentDeniedPaymentDetail: Stage3CMatrixLiveHandler =
  async (_ctx) => {
    notImplemented("READ-06");
  };

export const read07_unrelatedResidentDeniedCrossSocietyDetail: Stage3CMatrixLiveHandler =
  async (_ctx) => {
    notImplemented("READ-07");
  };

export const read08_otherSocietyAdminDeniedSocietyADetail: Stage3CMatrixLiveHandler =
  async (_ctx) => {
    notImplemented("READ-08");
  };

export const read09_guardDeniedPaymentDetail: Stage3CMatrixLiveHandler = async (
  _ctx,
) => {
  notImplemented("READ-09");
};

export const read10_blockAdminDeniedOutOfScopeDetail: Stage3CMatrixLiveHandler =
  async (_ctx) => {
    notImplemented("READ-10");
  };

// ---------------------------------------------------------------------------
// Handler map — true compile-time exhaustiveness (`satisfies Record`)
// ---------------------------------------------------------------------------

export const STAGE3C_READ_HANDLERS = {
  "READ-01": read01_activeResidentSeesOwnPaymentHistory,
  "READ-02": read02_activeResidentSeesOwnPaymentDetail,
  "READ-03": read03_residentPaymentDetailCarriesResidentAudience,
  "READ-04": read04_productionParserAcceptsResidentPayload,
  "READ-05": read05_movedOutResidentDeniedPaymentHistory,
  "READ-06": read06_movedOutResidentDeniedPaymentDetail,
  "READ-07": read07_unrelatedResidentDeniedCrossSocietyDetail,
  "READ-08": read08_otherSocietyAdminDeniedSocietyADetail,
  "READ-09": read09_guardDeniedPaymentDetail,
  "READ-10": read10_blockAdminDeniedOutOfScopeDetail,
} satisfies Record<Stage3CReadCaseId, Stage3CMatrixLiveHandler>;
