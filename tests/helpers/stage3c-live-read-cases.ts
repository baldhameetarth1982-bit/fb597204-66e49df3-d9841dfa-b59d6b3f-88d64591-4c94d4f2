/**
 * Stage 3C — READ-01..10 live case contracts + READ-01..04 behavior
 * (Sub-run B1 production-wiring repair).
 *
 * Handlers delegate to the neutral shared cores exported from
 * `src/lib/offline-payments.functions.ts`:
 *   - getResidentPaymentsWithClient  → resident history read
 *   - getPaymentDetailWithClient     → resident detail read
 * The public server functions delegate to the same cores, so RPC
 * construction has exactly one owner.
 *
 * READ-05..10 remain fail-closed pending Sub-run B2.
 */
import { z } from "zod";
import {
  residentPaymentDetailSchema,
  parsePaymentDetailResponse,
  getResidentPaymentsWithClient,
  getPaymentDetailWithClient,
  type ResidentPaymentRow,
  type PaymentDetail,
} from "@/lib/offline-payments.functions";
import type { BillingRpcClient } from "@/lib/billing-config.functions";
import { CanonicalStage3CUuidSchema } from "./stage3c-runtime-fixtures";
import type { Stage3CMatrixLiveHandler } from "./stage3c-live-matrix-registry";
import type { Stage3CLiveMatrixContext } from "./stage3c-live-matrix-context";
import {
  requireReadPrimaryBillId,
  requireReadPrimaryPaymentId,
  requireReadExpectedHistoryRow,
  requireReadExpectedHistory,
  requireReadExpectedDetail,
  requireReadAcceptedDetail,
} from "./stage3c-live-matrix-context";
import { requireFixture } from "./stage3c-live-core-context";
import {
  snapshotResidentBillState,
  assertResidentBillStateUnchanged,
  type ActorRpcClient,
  type ResidentBillStateReader,
} from "./stage3c-live-resident-submit-contracts";


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

export function assertReadStateUnchanged(before: unknown, after: unknown): void {
  if (!stage3cReadDeepEqual(before, after))
    throw new Error("[stage3c:READ] state changed during read operation");
}

/** Type-narrow a `PaymentDetail` to the resident variant. */
function narrowResidentDetail(
  detail: PaymentDetail | null,
  caseId: Stage3CReadCaseId,
): ResidentPaymentDetail {
  if (detail === null)
    throw new Error(`[stage3c:${caseId}] payment detail was null`);
  if (detail.audience !== "resident")
    throw new Error(`[stage3c:${caseId}] returned non-resident audience`);
  return detail;
}

/** Coerce production-row array to strict history rows or throw. */
function assertHistoryRowsStrict(
  rows: readonly ResidentPaymentRow[],
  caseId: Stage3CReadCaseId,
): ResidentPaymentHistoryRow[] {
  const out: ResidentPaymentHistoryRow[] = [];
  for (const row of rows) {
    const parsed = ResidentPaymentHistoryRowSchema.safeParse(row);
    if (!parsed.success)
      throw new Error(`[stage3c:${caseId}] history row failed strict schema`);
    out.push(parsed.data);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Live-state bracketing helper — fixture-derived when available.
// ---------------------------------------------------------------------------

interface LiveReadBrackets {
  readonly client: BillingRpcClient;
  readonly assertUnchanged: () => Promise<void>;
}

async function openLiveReadBrackets(
  ctx: Stage3CLiveMatrixContext,
  caseId: Stage3CReadCaseId,
): Promise<LiveReadBrackets> {
  const injected = requireReadResidentRpcClient(ctx);
  const fixture = ctx.fixture;
  if (!fixture) {
    return { client: injected, assertUnchanged: async () => {} };
  }
  const billId = requireReadPrimaryBillId(ctx);
  const societyId = fixture.societyA;
  const actorClient = fixture.users.activeResident.client as unknown as {
    rpc: (name: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>;
  };
  const before = await snapshotResidentBillState(
    fixture.admin,
    actorClient,
    billId,
    societyId,
    caseId,
  );
  return {
    client: injected,
    assertUnchanged: async () => {
      const after = await snapshotResidentBillState(
        fixture.admin,
        actorClient,
        billId,
        societyId,
        caseId,
      );
      assertResidentBillStateUnchanged(before, after, caseId);
    },
  };
}



/**
 * READ-01 — Active resident sees own payment history.
 * Production entry: `getResidentPaymentsWithClient` → `get_resident_payments_v1`.
 */
export const read01_activeResidentSeesOwnPaymentHistory: Stage3CMatrixLiveHandler =
  async (ctx: Stage3CLiveMatrixContext) => {
    const brackets = await openLiveReadBrackets(ctx, "READ-01");
    const client = brackets.client;
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

    // Bracket with a detail read so any mutation shows up as drift.
    const preDetail = await getPaymentDetailWithClient(client, { paymentId });

    const first = await getResidentPaymentsWithClient(client, {
      limit: 50,
      offset: 0,
    });
    if (!first || typeof first !== "object" || !Array.isArray(first.payments))
      throw new Error("[stage3c:READ-01] history return shape is not { payments }");
    const parsed = assertHistoryRowsStrict(first.payments, "READ-01");

    assertHistoryOrderingStable(parsed, expectedHistory);
    for (let i = 0; i < expectedHistory.length; i++) {
      if (!stage3cReadDeepEqual(parsed[i], expectedHistory[i]))
        throw new Error(
          "[stage3c:READ-01] history row deep equality failed against expected snapshot",
        );
    }

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

    for (const row of parsed) {
      if (row.society_id !== expectedRow.society_id)
        throw new Error(
          "[stage3c:READ-01] history contains a payment from another society",
        );
      if (row.flat_id !== expectedRow.flat_id)
        throw new Error(
          "[stage3c:READ-01] history contains a payment from another flat",
        );
    }

    // Deterministic repeat.
    const second = await getResidentPaymentsWithClient(client, {
      limit: 50,
      offset: 0,
    });
    assertReadResultsExactlyEqual(first, second);

    const postDetail = await getPaymentDetailWithClient(client, { paymentId });
    assertReadStateUnchanged(preDetail, postDetail);
    await brackets.assertUnchanged();
  };

/**
 * READ-02 — Active resident sees own payment detail.
 * Production entry: `getPaymentDetailWithClient` → `get_payment_detail` →
 * `parsePaymentDetailResponse` (inside the core).
 */
export const read02_activeResidentSeesOwnPaymentDetail: Stage3CMatrixLiveHandler =
  async (ctx: Stage3CLiveMatrixContext) => {
    const brackets = await openLiveReadBrackets(ctx, "READ-02");
    const client = brackets.client;
    const paymentId = requireReadPrimaryPaymentId(ctx);
    const billId = requireReadPrimaryBillId(ctx);
    const expectedRow = requireReadExpectedHistoryRow(ctx);
    const expectedDetail = requireReadExpectedDetail(ctx);

    // Bracket with a history read to prove no mutation.
    const preHistory = await getResidentPaymentsWithClient(client, {
      limit: 50,
      offset: 0,
    });

    const detailAny = await getPaymentDetailWithClient(client, { paymentId });
    const detail = narrowResidentDetail(detailAny, "READ-02");

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

    ctx.readAcceptedDetail = detail;

    const postHistory = await getResidentPaymentsWithClient(client, {
      limit: 50,
      offset: 0,
    });
    assertReadStateUnchanged(preHistory, postHistory);
    await brackets.assertUnchanged();
  };

/**
 * READ-03 — Resident payment detail carries the resident audience.
 * Re-invokes the shared detail core and asserts audience + equality with
 * the READ-02 accepted detail.
 */
export const read03_residentPaymentDetailCarriesResidentAudience: Stage3CMatrixLiveHandler =
  async (ctx: Stage3CLiveMatrixContext) => {
    const brackets = await openLiveReadBrackets(ctx, "READ-03");
    const client = brackets.client;
    const paymentId = requireReadPrimaryPaymentId(ctx);
    const accepted = requireReadAcceptedDetail(ctx);

    const detailAny = await getPaymentDetailWithClient(client, { paymentId });
    const detail = narrowResidentDetail(detailAny, "READ-03");

    assertResidentAudience(detail);

    // Post-parse audience mutation must not yield a valid resident payload.
    for (const bad of ["admin", "", null, undefined, "Resident", "RESIDENT"]) {
      const mutated = { ...detail, audience: bad as unknown } as unknown;
      if (ResidentPaymentDetailSchema.safeParse(mutated).success)
        throw new Error(
          "[stage3c:READ-03] resident schema accepted an invalid audience mutation",
        );
    }

    assertResidentDetailMatchesExpected(detail, accepted);
    await brackets.assertUnchanged();
  };

/**
 * READ-04 — Shared detail core parses a fresh production-read payload.
 * Deep-equals the READ-02 accepted detail; snake_case/malformed/null
 * cases are pinned by direct-core tests in the behavioral suite.
 */
export const read04_productionParserAcceptsResidentPayload: Stage3CMatrixLiveHandler =
  async (ctx: Stage3CLiveMatrixContext) => {
    const brackets = await openLiveReadBrackets(ctx, "READ-04");
    const client = brackets.client;
    const paymentId = requireReadPrimaryPaymentId(ctx);
    const accepted = requireReadAcceptedDetail(ctx);

    const detailAny = await getPaymentDetailWithClient(client, { paymentId });
    const detail = narrowResidentDetail(detailAny, "READ-04");

    assertResidentDetailMatchesExpected(detail, accepted);
    await brackets.assertUnchanged();
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

// Re-export the client type so tests and consumers reference it without
// depending on the billing config module directly.
export type { BillingRpcClient };
