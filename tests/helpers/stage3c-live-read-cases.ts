/**
 * Stage 3C — READ-01..10 live case contracts + READ-01..04 behavior (Sub-run B1).
 *
 * Grounding sources (production shapes; do not duplicate):
 *   - src/lib/offline-payments.functions.ts
 *       * residentPaymentDetailSchema         → READ-02..04 payload shape
 *       * parsePaymentDetailResponse          → READ-04 parser input
 *       * ResidentPaymentRow (interface)      → READ-01 history row parity
 *       * mapPaymentError                     → denial category grounding
 *
 * Sub-run B1 replaces ONLY the bodies of READ-01..READ-04. READ-05..READ-10
 * remain fail-closed pending a later denial sub-run.
 */
import { z } from "zod";
import {
  residentPaymentDetailSchema,
  parsePaymentDetailResponse,
  type ResidentPaymentRow,
  type PaymentDetail,
} from "@/lib/offline-payments.functions";
import { CanonicalStage3CUuidSchema } from "./stage3c-runtime-fixtures";
import type { Stage3CMatrixLiveHandler } from "./stage3c-live-matrix-registry";
import type { Stage3CLiveMatrixContext } from "./stage3c-live-matrix-context";
import {
  requireReadPrimaryBillId,
  requireReadPrimaryPaymentId,
  requireReadTransport,
  requireReadExpectedHistoryRow,
  requireReadExpectedHistory,
  requireReadExpectedDetail,
  requireReadAcceptedDetail,
  requireReadAcceptedRawDetail,
} from "./stage3c-live-matrix-context";

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

export const Stage3CReadResidentAudienceSchema = z.literal("resident");
export type Stage3CReadResidentAudience = z.infer<
  typeof Stage3CReadResidentAudienceSchema
>;

/** Re-export of the real production schema — referential identity matters. */
export const ResidentPaymentDetailSchema = residentPaymentDetailSchema;
export type ResidentPaymentDetail = z.infer<typeof ResidentPaymentDetailSchema>;

/** Resident payment history row — mirrors production `ResidentPaymentRow`. */
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

// Compile-time parity with `ResidentPaymentRow`.
type _Parity = ResidentPaymentHistoryRow extends ResidentPaymentRow
  ? ResidentPaymentRow extends ResidentPaymentHistoryRow
    ? true
    : false
  : false;
const _RESIDENT_PAYMENT_HISTORY_ROW_PARITY: _Parity = true;
void _RESIDENT_PAYMENT_HISTORY_ROW_PARITY;

/** Denial grounding — copied verbatim from `mapPaymentError`. */
export const Stage3CReadDenialCategorySchema = z.enum([
  "not_authenticated",
  "not_authorized",
]);
export type Stage3CReadDenialCategory = z.infer<
  typeof Stage3CReadDenialCategorySchema
>;

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
// Read transport — dispatch abstraction the handler uses to reach the real
// production reads (`get_resident_payments_v1`, `get_payment_detail`).
// Production wires this to the resident's Supabase client; tests inject a
// deterministic fake. Handlers never touch a raw client directly.
// ---------------------------------------------------------------------------

export interface Stage3CReadHistoryInput {
  readonly limit?: number;
  readonly offset?: number;
}
export interface Stage3CReadDetailInput {
  readonly paymentId: string;
}
export interface Stage3CReadTransport {
  fetchResidentPaymentHistoryRaw(
    input: Stage3CReadHistoryInput,
  ): Promise<unknown>;
  fetchResidentPaymentDetailRaw(
    input: Stage3CReadDetailInput,
  ): Promise<unknown>;
}

// ---------------------------------------------------------------------------
// Static messages
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
// Behavioral helpers (static errors, no Vitest, no interpolation of secrets)
// ---------------------------------------------------------------------------

/** Structural deep equality via canonical JSON serialization. */
function stableStringify(value: unknown): string {
  const seen = new WeakSet<object>();
  const walk = (v: unknown): unknown => {
    if (v === null || typeof v !== "object") return v;
    if (seen.has(v as object)) throw new Error("[stage3c:READ] cyclic value");
    seen.add(v as object);
    if (Array.isArray(v)) return v.map(walk);
    const keys = Object.keys(v as Record<string, unknown>).sort();
    const out: Record<string, unknown> = {};
    for (const k of keys) out[k] = walk((v as Record<string, unknown>)[k]);
    return out;
  };
  return JSON.stringify(walk(value));
}

export function stage3cReadDeepEqual(a: unknown, b: unknown): boolean {
  return stableStringify(a) === stableStringify(b);
}

export function assertExactReadHistoryRow(
  found: ResidentPaymentHistoryRow,
  expected: ResidentPaymentHistoryRow,
): void {
  if (!stage3cReadDeepEqual(found, expected))
    throw new Error(
      "[stage3c:READ-01] history row does not exactly match expected row",
    );
}

export function assertHistoryOrderingStable(
  actual: readonly ResidentPaymentHistoryRow[],
  expected: readonly ResidentPaymentHistoryRow[],
): void {
  if (actual.length !== expected.length)
    throw new Error("[stage3c:READ-01] history length differs from expected");
  for (let i = 0; i < expected.length; i++) {
    if (actual[i].id !== expected[i].id)
      throw new Error("[stage3c:READ-01] history ordering does not match expected");
  }
}

export function assertReadResultsExactlyEqual(a: unknown, b: unknown): void {
  if (!stage3cReadDeepEqual(a, b))
    throw new Error("[stage3c:READ] repeated read results are not deeply equal");
}

export function assertResidentDetailMatchesExpected(
  actual: ResidentPaymentDetail,
  expected: ResidentPaymentDetail,
): void {
  if (!stage3cReadDeepEqual(actual, expected))
    throw new Error(
      "[stage3c:READ-02] resident detail does not deeply equal expected",
    );
}

export function assertResidentAudience(detail: ResidentPaymentDetail): void {
  if (detail.audience !== "resident")
    throw new Error("[stage3c:READ-03] payment detail audience is not resident");
}

export function assertReadStateUnchanged(
  before: unknown,
  after: unknown,
): void {
  if (!stage3cReadDeepEqual(before, after))
    throw new Error("[stage3c:READ] state changed during read operation");
}

/**
 * Parse history rows with the strict schema. Every row must pass; any
 * failure throws a static message.
 */
function parseHistoryRows(
  raw: unknown,
  caseId: Stage3CReadCaseId,
): ResidentPaymentHistoryRow[] {
  if (!Array.isArray(raw))
    throw new Error(`[stage3c:${caseId}] history payload is not an array`);
  const out: ResidentPaymentHistoryRow[] = [];
  for (const row of raw) {
    const parsed = ResidentPaymentHistoryRowSchema.safeParse(row);
    if (!parsed.success)
      throw new Error(`[stage3c:${caseId}] history row failed strict schema`);
    out.push(parsed.data);
  }
  return out;
}

// ---------------------------------------------------------------------------
// READ-01..READ-04 — behavioral implementations
// ---------------------------------------------------------------------------

/**
 * READ-01 — Active resident sees own payment history.
 *
 * Production entry point: `get_resident_payments_v1` (invoked here via the
 * injected `ctx.readTransport.fetchResidentPaymentHistoryRaw`; production
 * wires the transport to the real Supabase RPC).
 */
export const read01_activeResidentSeesOwnPaymentHistory: Stage3CMatrixLiveHandler =
  async (ctx: Stage3CLiveMatrixContext) => {
    const transport = requireReadTransport(ctx);
    const paymentId = requireReadPrimaryPaymentId(ctx);
    const billId = requireReadPrimaryBillId(ctx);
    const expectedRow = requireReadExpectedHistoryRow(ctx);
    const expectedHistory = requireReadExpectedHistory(ctx);

    if (expectedRow.id !== paymentId)
      throw new Error(
        "[stage3c:READ-01] expected row does not correspond to primary payment id",
      );
    if (expectedRow.bill_id !== billId)
      throw new Error(
        "[stage3c:READ-01] expected row does not correspond to primary bill id",
      );

    // Pre-read state fingerprint — production detail should be idempotent
    // across a history read. Any drift = mutation.
    const preDetailRaw = await transport.fetchResidentPaymentDetailRaw({
      paymentId,
    });

    const raw = await transport.fetchResidentPaymentHistoryRaw({});
    const parsed = parseHistoryRows(raw, "READ-01");

    // Prove ordering + exact equality vs expected snapshot.
    assertHistoryOrderingStable(parsed, expectedHistory);
    for (let i = 0; i < expectedHistory.length; i++) {
      if (!stage3cReadDeepEqual(parsed[i], expectedHistory[i]))
        throw new Error(
          "[stage3c:READ-01] history row deep equality failed against expected snapshot",
        );
    }

    // Prove the expected row appears exactly once.
    const matches = parsed.filter((r) => r.id === expectedRow.id);
    if (matches.length === 0)
      throw new Error(
        "[stage3c:READ-01] expected payment absent from resident history",
      );
    if (matches.length > 1)
      throw new Error(
        "[stage3c:READ-01] expected payment appears more than once in resident history",
      );
    assertExactReadHistoryRow(matches[0], expectedRow);

    // Society scoping — no row from another society may appear.
    for (const row of parsed) {
      if (row.society_id !== expectedRow.society_id)
        throw new Error(
          "[stage3c:READ-01] history contains a payment from another society",
        );
    }
    // Flat scoping — every row belongs to the resident's authorised flat.
    for (const row of parsed) {
      if (row.flat_id !== expectedRow.flat_id)
        throw new Error(
          "[stage3c:READ-01] history contains a payment from another flat",
        );
    }

    // Deterministic repeat — identical read is deeply equal.
    const rawAgain = await transport.fetchResidentPaymentHistoryRaw({});
    const parsedAgain = parseHistoryRows(rawAgain, "READ-01");
    assertReadResultsExactlyEqual(parsed, parsedAgain);

    // Post-read state — detail payload unchanged proves no mutation.
    const postDetailRaw = await transport.fetchResidentPaymentDetailRaw({
      paymentId,
    });
    assertReadStateUnchanged(preDetailRaw, postDetailRaw);
  };

/**
 * READ-02 — Active resident sees own payment detail.
 * Production entry: `get_payment_detail` → `parsePaymentDetailResponse`.
 */
export const read02_activeResidentSeesOwnPaymentDetail: Stage3CMatrixLiveHandler =
  async (ctx: Stage3CLiveMatrixContext) => {
    const transport = requireReadTransport(ctx);
    const paymentId = requireReadPrimaryPaymentId(ctx);
    const billId = requireReadPrimaryBillId(ctx);
    const expectedRow = requireReadExpectedHistoryRow(ctx);
    const expectedDetail = requireReadExpectedDetail(ctx);

    const preHistoryRaw = await transport.fetchResidentPaymentHistoryRaw({});

    const raw = await transport.fetchResidentPaymentDetailRaw({ paymentId });
    if (raw === null || raw === undefined)
      throw new Error("[stage3c:READ-02] detail payload was null/undefined");

    // Real production parser — never a substitute.
    const parsed: PaymentDetail = parsePaymentDetailResponse(raw);
    const strict = ResidentPaymentDetailSchema.safeParse(parsed);
    if (!strict.success)
      throw new Error("[stage3c:READ-02] parsed detail failed resident schema");
    const detail = strict.data;

    if (detail.audience !== "resident")
      throw new Error("[stage3c:READ-02] returned admin-audience payload");
    if (detail.payment.id !== paymentId)
      throw new Error("[stage3c:READ-02] returned payment id mismatch");
    if (detail.payment.bill_id !== billId)
      throw new Error("[stage3c:READ-02] returned bill id mismatch");
    if (detail.payment.society_id !== expectedRow.society_id)
      throw new Error("[stage3c:READ-02] returned society scope mismatch");
    if (detail.payment.flat_id !== expectedRow.flat_id)
      throw new Error("[stage3c:READ-02] returned flat scope mismatch");
    if (detail.payment.amount !== expectedRow.amount)
      throw new Error("[stage3c:READ-02] amount mismatch");
    if (detail.payment.status !== expectedRow.status)
      throw new Error("[stage3c:READ-02] status mismatch");

    assertResidentDetailMatchesExpected(detail, expectedDetail);

    // Store accepted values for READ-03 / READ-04.
    ctx.readAcceptedDetail = detail;
    ctx.readAcceptedRawDetail = raw;

    const postHistoryRaw = await transport.fetchResidentPaymentHistoryRaw({});
    assertReadStateUnchanged(preHistoryRaw, postHistoryRaw);
  };

/**
 * READ-03 — Resident payment detail carries the resident audience.
 * Re-invokes production detail, asserts audience, and proves the parser
 * rejects any non-`"resident"` audience mutation.
 */
export const read03_residentPaymentDetailCarriesResidentAudience: Stage3CMatrixLiveHandler =
  async (ctx: Stage3CLiveMatrixContext) => {
    const transport = requireReadTransport(ctx);
    const paymentId = requireReadPrimaryPaymentId(ctx);
    const accepted = requireReadAcceptedDetail(ctx);

    const raw = await transport.fetchResidentPaymentDetailRaw({ paymentId });
    if (raw === null || raw === undefined)
      throw new Error("[stage3c:READ-03] detail payload was null/undefined");

    const parsed = parsePaymentDetailResponse(raw);
    const strict = ResidentPaymentDetailSchema.safeParse(parsed);
    if (!strict.success)
      throw new Error("[stage3c:READ-03] parsed detail failed resident schema");
    const detail = strict.data;

    assertResidentAudience(detail);

    // Mutating audience post-parse must not yield a valid resident payload.
    for (const bad of ["admin", "", null, undefined, "Resident", "RESIDENT"]) {
      const mutated = { ...detail, audience: bad as unknown } as unknown;
      if (ResidentPaymentDetailSchema.safeParse(mutated).success)
        throw new Error(
          "[stage3c:READ-03] resident schema accepted an invalid audience mutation",
        );
    }

    // Detail must still deeply equal READ-02's accepted detail.
    assertResidentDetailMatchesExpected(detail, accepted);

    // No mutation: fresh raw payload equals accepted raw payload.
    const acceptedRaw = requireReadAcceptedRawDetail(ctx);
    assertReadStateUnchanged(acceptedRaw, raw);
  };

/**
 * READ-04 — Production parser accepts the resident-read payload.
 * Fetches a fresh raw payload and pipes it through the real parser.
 */
export const read04_productionParserAcceptsResidentPayload: Stage3CMatrixLiveHandler =
  async (ctx: Stage3CLiveMatrixContext) => {
    const transport = requireReadTransport(ctx);
    const paymentId = requireReadPrimaryPaymentId(ctx);
    const accepted = requireReadAcceptedDetail(ctx);
    const acceptedRaw = requireReadAcceptedRawDetail(ctx);

    const raw = await transport.fetchResidentPaymentDetailRaw({ paymentId });
    if (raw === null || raw === undefined)
      throw new Error("[stage3c:READ-04] detail payload was null/undefined");

    // Raw payload must retain production snake_case + nested shape.
    if (typeof raw !== "object" || Array.isArray(raw))
      throw new Error("[stage3c:READ-04] raw payload is not a plain object");
    const rawObj = raw as Record<string, unknown>;
    for (const camel of [
      "billNumber",
      "flatLabel",
      "audienceType",
      "paymentDetails",
    ]) {
      if (camel in rawObj)
        throw new Error(
          "[stage3c:READ-04] raw payload contains a forbidden camelCase key",
        );
    }
    for (const snake of [
      "audience",
      "payment",
      "bill_number",
      "flat_label",
      "summary",
      "receipt",
    ]) {
      if (!(snake in rawObj))
        throw new Error(
          "[stage3c:READ-04] raw payload is missing a required snake_case key",
        );
    }
    const paymentField = rawObj["payment"];
    if (
      paymentField === null ||
      typeof paymentField !== "object" ||
      Array.isArray(paymentField)
    )
      throw new Error("[stage3c:READ-04] raw payment field is not an object");

    // Snapshot raw before parser call to prove no manual field insertion.
    const rawFingerprint = stableStringify(raw);
    const parsed = parsePaymentDetailResponse(raw);
    if (stableStringify(raw) !== rawFingerprint)
      throw new Error(
        "[stage3c:READ-04] raw payload was mutated before/during parser call",
      );

    const strict = ResidentPaymentDetailSchema.safeParse(parsed);
    if (!strict.success)
      throw new Error(
        "[stage3c:READ-04] parser output failed resident schema validation",
      );
    assertResidentDetailMatchesExpected(strict.data, accepted);

    // No mutation: accepted raw payload deep-equal to fresh raw.
    assertReadStateUnchanged(acceptedRaw, raw);
  };

// ---------------------------------------------------------------------------
// READ-05..READ-10 — remain fail-closed (denial Sub-run B2)
// ---------------------------------------------------------------------------

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
// Handler map
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
