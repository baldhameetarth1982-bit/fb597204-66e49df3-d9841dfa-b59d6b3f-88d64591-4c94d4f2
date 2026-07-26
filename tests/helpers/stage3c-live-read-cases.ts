/**
 * Stage 3C — READ-01..10 live case contracts (Sub-run A, structural only).
 *
 * Grounding sources (evidence-only; do not duplicate production shapes):
 *   - src/lib/offline-payments.functions.ts
 *       * residentPaymentDetailSchema         → READ-02..04 payload shape
 *       * parsePaymentDetailResponse          → READ-04 parser input
 *       * ResidentPaymentRow (interface)      → READ-01 history row parity
 *       * mapPaymentError                     → denial category grounding
 *
 * Non-goals for this sub-run: no live RPC calls, no database writes, no
 * PRIVACY logic. Every handler fails closed with a static message until
 * behavioral Sub-run B replaces its body.
 */
import { z } from "zod";
import {
  residentPaymentDetailSchema,
  type ResidentPaymentRow,
} from "@/lib/offline-payments.functions";
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
// Typed READ contract model — grounded in production shapes
// ---------------------------------------------------------------------------

/**
 * Resident audience literal. Grounded in `residentPaymentDetailSchema`
 * (audience: z.literal("resident")). READ-03 forbids "admin".
 */
export const Stage3CReadResidentAudienceSchema = z.literal("resident");
export type Stage3CReadResidentAudience = z.infer<
  typeof Stage3CReadResidentAudienceSchema
>;

/**
 * Resident payment detail schema (READ-02..04).
 * Re-exports the real production schema so tests validate the exact
 * production parser output shape, not a hand-written substitute.
 */
export const ResidentPaymentDetailSchema = residentPaymentDetailSchema;

/**
 * Resident payment history row (READ-01, READ-05).
 * Fields mirror `ResidentPaymentRow` exactly (see production file cited
 * above). A compile-time `satisfies` clause below wires the two together
 * so any production drift breaks the typecheck instead of silently
 * accepting stale rows.
 */
export const ResidentPaymentHistoryRowSchema = z
  .object({
    id: CanonicalStage3CUuidSchema,
    bill_id: CanonicalStage3CUuidSchema.nullable(),
    society_id: CanonicalStage3CUuidSchema,
    flat_id: CanonicalStage3CUuidSchema.nullable(),
    amount: z.number(),
    method: z.string(),
    status: z.string(),
    reference_no: z.string().nullable(),
    submitted_at: z.string().nullable(),
    payment_date: z.string().nullable(),
    verified_at: z.string().nullable(),
    rejected_at: z.string().nullable(),
    rejection_reason: z.string().nullable(),
    reversed_at: z.string().nullable(),
    reversal_reason: z.string().nullable(),
    created_at: z.string(),
  })
  .strict();
export type ResidentPaymentHistoryRow = z.infer<
  typeof ResidentPaymentHistoryRowSchema
>;

// Compile-time parity guard against `ResidentPaymentRow`. If production
// adds or renames a field, this line stops compiling.
type _ResidentPaymentHistoryRowParity = ResidentPaymentHistoryRow extends ResidentPaymentRow
  ? ResidentPaymentRow extends ResidentPaymentHistoryRow
    ? true
    : false
  : false;
const _RESIDENT_PAYMENT_HISTORY_ROW_PARITY: _ResidentPaymentHistoryRowParity = true;
void _RESIDENT_PAYMENT_HISTORY_ROW_PARITY;

/**
 * Denial category for the six denial READ cases.
 * Grounded strictly in `mapPaymentError` — the only two safe messages
 * the production error mapper emits for resident-facing read denial
 * paths (`unauthenticated`, `not_authorized`). No provider-specific
 * tokens are invented here.
 */
export const Stage3CReadDenialCategorySchema = z.enum([
  "not_authenticated",
  "not_authorized",
]);
export type Stage3CReadDenialCategory = z.infer<
  typeof Stage3CReadDenialCategorySchema
>;

/**
 * Exact production-safe messages `mapPaymentError` returns for each
 * denial category. Keys and values are copied verbatim from the
 * production error mapper.
 */
export const STAGE3C_READ_DENIAL_MESSAGES: Readonly<
  Record<Stage3CReadDenialCategory, string>
> = Object.freeze({
  not_authenticated: "Please sign in and try again.",
  not_authorized: "You are not allowed to perform this action.",
});

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
    category: Stage3CReadDenialCategorySchema,
    returnedRow: z.null(),
  })
  .strict();
export type Stage3CReadDenialEvidence = z.infer<
  typeof Stage3CReadDenialEvidenceSchema
>;

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
