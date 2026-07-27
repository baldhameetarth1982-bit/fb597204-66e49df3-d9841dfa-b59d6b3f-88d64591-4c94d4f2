/**
 * Stage 3C — IDEMPOTENCY + REFERENCE Sub-run A contract tests +
 * IDEMPOTENCY Sub-run B direct behavioral tests.
 *
 * Sub-run A tests are preserved verbatim (builder determinism, exact
 * exports, handler-map shape, matrix-context field/guard surface).
 *
 * Sub-run B behavioral tests execute the four IDEMPOTENCY handlers
 * against a lightweight in-memory mock of `Stage3CFixture` whose
 * `admin`, `actor.client` and `helpers.submitResidentBankTransferPayment`
 * surfaces match the exact call shape the shared resident core uses.
 * Every test observes real handler code — no source-regex substitutes.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  STAGE3C_IDEMPOTENCY_REFERENCE_CASE_IDS,
  STAGE3C_IDEMPOTENCY_REFERENCE_HANDLERS,
  IDEMPOTENCY_AMOUNT,
  IDEMPOTENCY_CONFLICT_AMOUNT,
  REFERENCE_AMOUNT,
  IDEMPOTENCY_BILL_TOTAL,
  IDEMPOTENCY_04_UNEXPECTED_SUCCESS_MESSAGE,
  buildStage3CIdempotencyReferenceInputs,
  idempotency01_initializeAndSubmit,
  idempotency02_exactReplay,
  idempotency03_singleMutationProof,
  idempotency04_conflictingReplayDenied,
  reference01_createUniqueReference,
  reference02_duplicateSameBillDenied,
  reference03_duplicateCanonicalScopeDenied,
  reference04_outsideScopeIsolation,
  assertCleanIdempotencyBaseline,
  assertIdempotencyPostSubmitTotals,
  assertCleanReferenceBaseline,
  assertReferencePostSubmitTotals,
  REFERENCE_BILL_PRIMARY_TOTAL,
  REFERENCE_BILL_SECONDARY_TOTAL,
  REFERENCE_BILL_OTHER_SOCIETY_TOTAL,
  REFERENCE_02_UNEXPECTED_SUCCESS_MESSAGE,
  REFERENCE_03_UNEXPECTED_SUCCESS_MESSAGE,
  type Stage3CIdempotencyReferenceCaseId,
} from "../helpers/stage3c-live-idempotency-reference-cases";
import {
  createStage3CLiveMatrixContext,
  requireIdempotencyBillId,
  requireIdempotencyPaymentId,
  requireIdempotencyAmount,
  requireIdempotencyReference,
  requireIdempotencyKey,
  requireIdempotencyInitialState,
  requireIdempotencyPostSubmitState,
  requireIdempotencyInitialSequences,
  requireReferencePrimaryBillId,
  requireReferenceSecondarySameSocietyBillId,
  requireReferenceOtherSocietyBillId,
  requireReferencePrimaryPaymentId,
  requireReferenceOtherSocietyPaymentId,
  requireReferenceAmount,
  requireReferenceValue,
  requireReferencePrimaryKey,
  requireReferenceDuplicateKey,
  requireReferenceCrossBillKey,
  requireReferenceOtherSocietyKey,
  requireReferencePrimaryInitialState,
  requireReferencePrimaryPostSubmitState,
  requireReferenceSecondaryInitialState,
  requireReferenceOtherSocietyInitialState,
  requireReferenceOtherSocietyPostSubmitState,
  requireReferenceInitialSequences,
  type Stage3CLiveMatrixContext,
} from "../helpers/stage3c-live-matrix-context";
import { STAGE3C_MATRIX_LIVE_HANDLERS } from "../helpers/stage3c-live-matrix-registry";

const CASES_SRC = readFileSync(
  resolve(process.cwd(), "tests/helpers/stage3c-live-idempotency-reference-cases.ts"),
  "utf8",
);

const CANONICAL_IDS: readonly Stage3CIdempotencyReferenceCaseId[] = [
  "IDEMPOTENCY-01",
  "IDEMPOTENCY-02",
  "IDEMPOTENCY-03",
  "IDEMPOTENCY-04",
  "REFERENCE-01",
  "REFERENCE-02",
  "REFERENCE-03",
  "REFERENCE-04",
];

const NAMED_EXPORTS = {
  "IDEMPOTENCY-01": idempotency01_initializeAndSubmit,
  "IDEMPOTENCY-02": idempotency02_exactReplay,
  "IDEMPOTENCY-03": idempotency03_singleMutationProof,
  "IDEMPOTENCY-04": idempotency04_conflictingReplayDenied,
  "REFERENCE-01": reference01_createUniqueReference,
  "REFERENCE-02": reference02_duplicateSameBillDenied,
  "REFERENCE-03": reference03_duplicateCanonicalScopeDenied,
  "REFERENCE-04": reference04_outsideScopeIsolation,
} as const;

// ===========================================================================
// Sub-run A — deterministic input builder (preserved)
// ===========================================================================

describe("Sub-run A — deterministic input builder", () => {
  it("exports exactly the seven required fields", () => {
    const inputs = buildStage3CIdempotencyReferenceInputs("run-A");
    expect(Object.keys(inputs).sort()).toEqual(
      [
        "idempotencyKey",
        "idempotencyReference",
        "referenceCrossBillKey",
        "referenceDuplicateKey",
        "referenceOtherSocietyKey",
        "referencePrimaryKey",
        "referenceValue",
      ].sort(),
    );
  });

  it("idempotencyReference uses the exact `IDEM-` prefix", () => {
    expect(buildStage3CIdempotencyReferenceInputs("abc").idempotencyReference).toMatch(/^IDEM-/);
  });
  it("idempotencyKey uses the exact `idem-key-` prefix", () => {
    expect(buildStage3CIdempotencyReferenceInputs("abc").idempotencyKey).toMatch(/^idem-key-/);
  });
  it("referenceValue uses the exact `REF-` prefix", () => {
    expect(buildStage3CIdempotencyReferenceInputs("abc").referenceValue).toMatch(/^REF-/);
  });
  it("referencePrimaryKey uses the exact `ref-primary-` prefix", () => {
    expect(buildStage3CIdempotencyReferenceInputs("abc").referencePrimaryKey).toMatch(/^ref-primary-/);
  });
  it("referenceDuplicateKey uses the exact `ref-duplicate-` prefix", () => {
    expect(buildStage3CIdempotencyReferenceInputs("abc").referenceDuplicateKey).toMatch(/^ref-duplicate-/);
  });
  it("referenceCrossBillKey uses the exact `ref-crossbill-` prefix", () => {
    expect(buildStage3CIdempotencyReferenceInputs("abc").referenceCrossBillKey).toMatch(/^ref-crossbill-/);
  });
  it("referenceOtherSocietyKey uses the exact `ref-other-society-` prefix", () => {
    expect(buildStage3CIdempotencyReferenceInputs("abc").referenceOtherSocietyKey).toMatch(
      /^ref-other-society-/,
    );
  });

  it("is deterministic — same identity produces the same object", () => {
    const a = buildStage3CIdempotencyReferenceInputs("run-A-1");
    const b = buildStage3CIdempotencyReferenceInputs("run-A-1");
    expect(a).toEqual(b);
  });

  it("contains no spaces in any produced value", () => {
    const inputs = buildStage3CIdempotencyReferenceInputs("stage 3c  run  Alpha");
    for (const v of Object.values(inputs)) {
      expect(v).not.toMatch(/\s/);
    }
  });

  it("bounds every value to a safe length", () => {
    const inputs = buildStage3CIdempotencyReferenceInputs("x".repeat(500));
    for (const v of Object.values(inputs)) {
      expect(v.length).toBeGreaterThan(0);
      expect(v.length).toBeLessThanOrEqual(60);
    }
  });

  it("all seven produced strings are pairwise distinct", () => {
    const inputs = buildStage3CIdempotencyReferenceInputs("abc");
    const values = Object.values(inputs);
    expect(new Set(values).size).toBe(values.length);
  });

  it("reference values remain distinct from keys", () => {
    const i = buildStage3CIdempotencyReferenceInputs("abc");
    expect(i.idempotencyReference).not.toBe(i.idempotencyKey);
    expect(i.referenceValue).not.toBe(i.referencePrimaryKey);
    expect(i.referenceValue).not.toBe(i.referenceDuplicateKey);
    expect(i.referenceValue).not.toBe(i.referenceCrossBillKey);
    expect(i.referenceValue).not.toBe(i.referenceOtherSocietyKey);
  });

  it("blank/symbol-only identities fall back to a nonblank suffix", () => {
    const inputs = buildStage3CIdempotencyReferenceInputs("!!!");
    for (const v of Object.values(inputs)) expect(v.length).toBeGreaterThan(0);
  });

  it("locks IDEMPOTENCY_AMOUNT to 250", () => {
    expect(IDEMPOTENCY_AMOUNT).toBe(250);
  });
  it("locks IDEMPOTENCY_CONFLICT_AMOUNT to 251", () => {
    expect(IDEMPOTENCY_CONFLICT_AMOUNT).toBe(251);
    expect(IDEMPOTENCY_CONFLICT_AMOUNT - IDEMPOTENCY_AMOUNT).toBe(1);
  });
  it("locks REFERENCE_AMOUNT to 200", () => {
    expect(REFERENCE_AMOUNT).toBe(200);
  });
  it("locks IDEMPOTENCY_BILL_TOTAL to 1000", () => {
    expect(IDEMPOTENCY_BILL_TOTAL).toBe(1000);
  });
});

// ===========================================================================
// Sub-run A — exact named exports + handler map (preserved)
// ===========================================================================

describe("Sub-run A — exact named exports and handler map", () => {
  it("exports the eight exact named handler functions", () => {
    for (const [id, fn] of Object.entries(NAMED_EXPORTS)) {
      expect(typeof fn, `${id} named export missing`).toBe("function");
    }
  });

  it("handler map has exactly eight ids in canonical order", () => {
    const keys = Object.keys(STAGE3C_IDEMPOTENCY_REFERENCE_HANDLERS);
    expect(keys.length).toBe(8);
    expect([...STAGE3C_IDEMPOTENCY_REFERENCE_CASE_IDS]).toEqual([...CANONICAL_IDS]);
  });

  it("every map value === the required exported function", () => {
    for (const id of CANONICAL_IDS) {
      expect(STAGE3C_IDEMPOTENCY_REFERENCE_HANDLERS[id]).toBe(NAMED_EXPORTS[id]);
    }
  });

  it("IDEMPOTENCY-01 and IDEMPOTENCY-02 are distinct functions (split)", () => {
    expect(idempotency01_initializeAndSubmit).not.toBe(idempotency02_exactReplay);
    expect(STAGE3C_IDEMPOTENCY_REFERENCE_HANDLERS["IDEMPOTENCY-01"]).not.toBe(
      STAGE3C_IDEMPOTENCY_REFERENCE_HANDLERS["IDEMPOTENCY-02"],
    );
  });

  it("matrix registry re-exposes the same eight handler references", () => {
    for (const id of CANONICAL_IDS) {
      expect(STAGE3C_MATRIX_LIVE_HANDLERS[id]).toBe(NAMED_EXPORTS[id]);
    }
  });

  it("uses the shared `Stage3CMatrixLiveHandler` type (no parallel type present)", () => {
    expect(CASES_SRC).not.toMatch(/Stage3CIdempotencyReferenceHandler\b/);
    expect(CASES_SRC).toMatch(
      /satisfies Record<\s*Stage3CIdempotencyReferenceCaseId\s*,\s*Stage3CMatrixLiveHandler\s*>/,
    );
  });

  it("the cases module does NOT import vitest", () => {
    expect(CASES_SRC).not.toMatch(/from ["']vitest["']/);
  });

  it("the cases module contains NO non-null assertions", () => {
    expect(CASES_SRC).not.toMatch(/\b[A-Za-z_][A-Za-z0-9_]*!\./);
    expect(CASES_SRC).not.toMatch(/\b[A-Za-z_][A-Za-z0-9_]*!\s*[,)\];]/);
  });

  it("loose lifecycle schemas are NOT exported anymore", () => {
    expect(CASES_SRC).not.toMatch(/IdempotencyLifecycleSnapshotSchema/);
    expect(CASES_SRC).not.toMatch(/ReferenceLifecycleSnapshotSchema/);
  });
});

// ===========================================================================
// Sub-run A — strict matrix context (preserved)
// ===========================================================================

const VALID_UUID = "cccccccc-cccc-cccc-cccc-cccccccccccc";
const OTHER_UUID = "dddddddd-dddd-dddd-dddd-dddddddddddd";

function freshCtx(): Stage3CLiveMatrixContext {
  return createStage3CLiveMatrixContext();
}

describe("Sub-run A — strict matrix context", () => {
  it("initialises every IDEMPOTENCY + REFERENCE Sub-run A field to null", () => {
    const c = freshCtx();
    const nullFields = [
      "idempotencyBillId",
      "idempotencyPaymentId",
      "idempotencyAmount",
      "idempotencyReference",
      "idempotencyKey",
      "idempotencyInitialState",
      "idempotencyPostSubmitState",
      "idempotencyInitialSequences",
      "idempotencyPostSubmitSequences",
      "referencePrimaryBillId",
      "referenceSecondarySameSocietyBillId",
      "referenceOtherSocietyBillId",
      "referencePrimaryPaymentId",
      "referenceOtherSocietyPaymentId",
      "referenceAmount",
      "referenceValue",
      "referencePrimaryKey",
      "referenceDuplicateKey",
      "referenceCrossBillKey",
      "referenceOtherSocietyKey",
      "referencePrimaryInitialState",
      "referencePrimaryPostSubmitState",
      "referenceSecondaryInitialState",
      "referenceOtherSocietyInitialState",
      "referenceOtherSocietyPostSubmitState",
      "referenceInitialSequences",
    ] as const;
    for (const f of nullFields) {
      expect((c as unknown as Record<string, unknown>)[f], `${f} not null`).toBeNull();
    }
  });

  it("accepts a valid lowercase canonical UUID", () => {
    const c = freshCtx();
    c.idempotencyBillId = VALID_UUID;
    expect(requireIdempotencyBillId(c)).toBe(VALID_UUID);
  });

  it("rejects an uppercase UUID", () => {
    const c = freshCtx();
    c.idempotencyBillId = VALID_UUID.toUpperCase();
    expect(() => requireIdempotencyBillId(c)).toThrow(/idempotencyBillId/);
  });

  it("rejects a blank string for text guards", () => {
    const c = freshCtx();
    c.idempotencyReference = "   ";
    expect(() => requireIdempotencyReference(c)).toThrow(/idempotencyReference/);
  });

  it("rejects overlong text inputs", () => {
    const c = freshCtx();
    c.idempotencyReference = "x".repeat(500);
    expect(() => requireIdempotencyReference(c)).toThrow(/idempotencyReference/);
  });

  it("rejects NaN amounts", () => {
    const c = freshCtx();
    c.idempotencyAmount = Number.NaN;
    expect(() => requireIdempotencyAmount(c)).toThrow(/idempotencyAmount/);
  });

  it("rejects Infinity amounts", () => {
    const c = freshCtx();
    c.referenceAmount = Number.POSITIVE_INFINITY;
    expect(() => requireReferenceAmount(c)).toThrow(/referenceAmount/);
  });

  it("rejects a loose object as a resident bill state snapshot", () => {
    const c = freshCtx();
    (c as unknown as { idempotencyInitialState: unknown }).idempotencyInitialState = {
      summary: {},
      paymentRows: [],
    };
    expect(() => requireIdempotencyInitialState(c)).toThrow(/idempotencyInitialState/);
  });

  it("rejects an array as a receipt sequence snapshot", () => {
    const c = freshCtx();
    (c as unknown as { idempotencyInitialSequences: unknown }).idempotencyInitialSequences = [];
    expect(() => requireIdempotencyInitialSequences(c)).toThrow(/idempotencyInitialSequences/);
  });

  it("rejects a loose object as a receipt sequence snapshot", () => {
    const c = freshCtx();
    (c as unknown as { referenceInitialSequences: unknown }).referenceInitialSequences = {
      foo: 1,
    };
    expect(() => requireReferenceInitialSequences(c)).toThrow(/referenceInitialSequences/);
  });

  it("guard error for an invalid UUID excludes the supplied UUID string", () => {
    const c = freshCtx();
    const supplied = "11111111-2222-3333-4444-555555555555";
    c.idempotencyBillId = supplied.toUpperCase();
    try {
      requireIdempotencyBillId(c);
      throw new Error("guard should have thrown");
    } catch (e) {
      const msg = (e as Error).message;
      expect(msg).not.toContain(supplied);
      expect(msg).not.toContain(supplied.toUpperCase());
    }
  });

  it("guard error for a bad key excludes the supplied key text", () => {
    const c = freshCtx();
    c.referencePrimaryKey = "supersecret-supplied-key-value";
    c.referencePrimaryKey = "supersecret-supplied-key-value".padEnd(500, "x");
    try {
      requireReferencePrimaryKey(c);
      throw new Error("guard should have thrown");
    } catch (e) {
      const msg = (e as Error).message;
      expect(msg).not.toContain("supersecret-supplied-key-value");
    }
  });

  it("guards throw a stable label when idempotency lifecycle state is missing", () => {
    const c = freshCtx();
    expect(() => requireIdempotencyBillId(c)).toThrow(/idempotencyBillId/);
    expect(() => requireIdempotencyPaymentId(c)).toThrow(/idempotencyPaymentId/);
    expect(() => requireIdempotencyAmount(c)).toThrow(/idempotencyAmount/);
    expect(() => requireIdempotencyReference(c)).toThrow(/idempotencyReference/);
    expect(() => requireIdempotencyKey(c)).toThrow(/idempotencyKey/);
    expect(() => requireIdempotencyInitialState(c)).toThrow(/idempotencyInitialState/);
    expect(() => requireIdempotencyPostSubmitState(c)).toThrow(/idempotencyPostSubmitState/);
    expect(() => requireIdempotencyInitialSequences(c)).toThrow(/idempotencyInitialSequences/);
  });

  it("guards throw a stable label when reference lifecycle state is missing", () => {
    const c = freshCtx();
    expect(() => requireReferencePrimaryBillId(c)).toThrow(/referencePrimaryBillId/);
    expect(() => requireReferenceSecondarySameSocietyBillId(c)).toThrow(
      /referenceSecondarySameSocietyBillId/,
    );
    expect(() => requireReferenceOtherSocietyBillId(c)).toThrow(/referenceOtherSocietyBillId/);
    expect(() => requireReferencePrimaryPaymentId(c)).toThrow(/referencePrimaryPaymentId/);
    expect(() => requireReferenceOtherSocietyPaymentId(c)).toThrow(/referenceOtherSocietyPaymentId/);
    expect(() => requireReferenceAmount(c)).toThrow(/referenceAmount/);
    expect(() => requireReferenceValue(c)).toThrow(/referenceValue/);
    expect(() => requireReferencePrimaryKey(c)).toThrow(/referencePrimaryKey/);
    expect(() => requireReferenceDuplicateKey(c)).toThrow(/referenceDuplicateKey/);
    expect(() => requireReferenceCrossBillKey(c)).toThrow(/referenceCrossBillKey/);
    expect(() => requireReferenceOtherSocietyKey(c)).toThrow(/referenceOtherSocietyKey/);
    expect(() => requireReferencePrimaryInitialState(c)).toThrow(/referencePrimaryInitialState/);
    expect(() => requireReferencePrimaryPostSubmitState(c)).toThrow(/referencePrimaryPostSubmitState/);
    expect(() => requireReferenceSecondaryInitialState(c)).toThrow(/referenceSecondaryInitialState/);
    expect(() => requireReferenceOtherSocietyInitialState(c)).toThrow(
      /referenceOtherSocietyInitialState/,
    );
    expect(() => requireReferenceOtherSocietyPostSubmitState(c)).toThrow(
      /referenceOtherSocietyPostSubmitState/,
    );
    expect(() => requireReferenceInitialSequences(c)).toThrow(/referenceInitialSequences/);
  });

  it("returns stored values once populated", () => {
    const c = freshCtx();
    c.idempotencyBillId = VALID_UUID;
    c.idempotencyPaymentId = OTHER_UUID;
    c.idempotencyReference = "IDEM-abc";
    c.idempotencyKey = "idem-key-abc";
    c.idempotencyAmount = 250;
    c.referencePrimaryBillId = VALID_UUID;
    c.referenceSecondarySameSocietyBillId = OTHER_UUID;
    c.referenceOtherSocietyBillId = VALID_UUID;
    c.referencePrimaryPaymentId = OTHER_UUID;
    c.referenceOtherSocietyPaymentId = VALID_UUID;
    c.referenceValue = "REF-abc";
    c.referenceAmount = 200;
    c.referencePrimaryKey = "ref-primary-abc";
    c.referenceDuplicateKey = "ref-duplicate-abc";
    c.referenceCrossBillKey = "ref-crossbill-abc";
    c.referenceOtherSocietyKey = "ref-other-society-abc";
    expect(requireIdempotencyBillId(c)).toBe(VALID_UUID);
    expect(requireIdempotencyReference(c)).toBe("IDEM-abc");
    expect(requireIdempotencyKey(c)).toBe("idem-key-abc");
    expect(requireIdempotencyAmount(c)).toBe(250);
    expect(requireReferenceValue(c)).toBe("REF-abc");
    expect(requireReferenceAmount(c)).toBe(200);
    expect(requireReferencePrimaryKey(c)).toBe("ref-primary-abc");
    expect(requireReferenceDuplicateKey(c)).toBe("ref-duplicate-abc");
    expect(requireReferenceCrossBillKey(c)).toBe("ref-crossbill-abc");
    expect(requireReferenceOtherSocietyKey(c)).toBe("ref-other-society-abc");
  });
});

// ===========================================================================
// Sub-run B — IDEMPOTENCY direct behavioral tests
// ===========================================================================

// Canonical lowercase UUIDs (safe for CanonicalStage3CUuidSchema).
const SOCIETY_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const SOCIETY_B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const IDEM_BILL = "1cccccc0-cccc-cccc-cccc-cccccccccccc";
const REF_BILL = "1dddddd0-dddd-dddd-dddd-dddddddddddd";
const REF_BILL_2 = "1eeeeee0-eeee-eeee-eeee-eeeeeeeeeeee";
const REF_BILL_3 = "1fffff00-ffff-ffff-ffff-ffffffffffff";
const RES_ID = "10000000-0000-0000-0000-000000000001";
const OTHER_RES = "10000000-0000-0000-0000-000000000002";
const PRIMARY_PAYMENT = "20000000-0000-0000-0000-00000000000a";
const OTHER_PAYMENT = "20000000-0000-0000-0000-00000000000b";
const RUN_PREFIX = "runB";
const DETERMINISTIC_DATE = "2026-01-15";
const DETERMINISTIC_TS = "2026-01-15T00:00:00.000Z";
const FLAT_ID = "30000000-0000-0000-0000-000000000001";

const BUILDER_INPUTS = buildStage3CIdempotencyReferenceInputs(RUN_PREFIX);

type PaymentFullRow = {
  id: string;
  bill_id: string;
  society_id: string;
  flat_id: string;
  submitted_by: string;
  amount: number;
  method: "bank_transfer";
  status: "pending" | "verified" | "rejected" | "reversed";
  source: "resident_submission" | "admin_entry";
  reference_no: string;
  idempotency_key: string;
  created_at: string;
  updated_at: string;
  paid_at: string;
  user_id: null;
  submitted_at: null;
  payment_date: null;
  notes: null;
  verified_by: null;
  verified_at: null;
  verification_notes: null;
  rejected_by: null;
  rejected_at: null;
  rejection_reason: null;
  reversed_by: null;
  reversed_at: null;
  reversal_reason: null;
  platform_fee_paise: null;
  platform_share_paise: null;
  society_share_paise: null;
  proof_url: null;
  razorpay_order_id: null;
  razorpay_payment_id: null;
  razorpay_signature: null;
};

interface BillMeta {
  societyId: string;
  total: number;
}

type ReceiptFullRow = {
  id: string;
  payment_id: string;
  society_id: string;
  receipt_number: string;
  status: string;
  issued_at: string;
  created_at: string;
  issued_by: null;
  voided_at: null;
  voided_by: null;
  void_reason: null;
  amount_snapshot: null;
  method_snapshot: null;
  reference_snapshot: null;
  bill_number_snapshot: null;
  verified_by: null;
  verified_at: null;
};

function buildReceipt(id: string, paymentId: string, societyId: string = SOCIETY_A): ReceiptFullRow {
  return {
    id,
    payment_id: paymentId,
    society_id: societyId,
    receipt_number: "R-0001",
    status: "issued",
    issued_at: DETERMINISTIC_TS,
    created_at: DETERMINISTIC_TS,
    issued_by: null,
    voided_at: null,
    voided_by: null,
    void_reason: null,
    amount_snapshot: null,
    method_snapshot: null,
    reference_snapshot: null,
    bill_number_snapshot: null,
    verified_by: null,
    verified_at: null,
  };
}

interface MockState {
  bills: Record<string, BillMeta>;
  payments: PaymentFullRow[];
  receipts: ReceiptFullRow[];
  yearly: { society_id: string; year: number; next_number: number }[];
  monthly: { society_id: string; year_month: string; next_number: number }[];
  submitCalls: unknown[];
  submitImpl: (input: unknown) => Promise<string>;
  trackedPaymentIds: string[];
}

function makeCleanState(): MockState {
  const state: MockState = {
    bills: {
      [IDEM_BILL]: { societyId: SOCIETY_A, total: IDEMPOTENCY_BILL_TOTAL },
      [REF_BILL]: { societyId: SOCIETY_A, total: 800 },
      [REF_BILL_2]: { societyId: SOCIETY_A, total: 700 },
      [REF_BILL_3]: { societyId: SOCIETY_B, total: 600 },
    },
    payments: [],
    receipts: [],
    yearly: [
      { society_id: SOCIETY_A, year: 2026, next_number: 1 },
      { society_id: SOCIETY_B, year: 2026, next_number: 1 },
    ],
    monthly: [
      { society_id: SOCIETY_A, year_month: "2026-01", next_number: 1 },
      { society_id: SOCIETY_B, year_month: "2026-01", next_number: 1 },
    ],
    submitCalls: [],
    submitImpl: async () => PRIMARY_PAYMENT,
    trackedPaymentIds: [],
  };
  // Default: insert a canonical row on submit (upsert by idempotency key).
  state.submitImpl = async (input: unknown) => {
    const i = input as {
      actor: { id: string };
      billId: string;
      amount: number;
      referenceNo: string;
      idempotencyKey: string;
    };
    const existing = state.payments.find((r) => r.idempotency_key === i.idempotencyKey);
    if (existing) return existing.id;
    const billMeta = state.bills[i.billId];
    if (!billMeta) throw new Error("bill_not_found");
    state.payments.push({
      id: PRIMARY_PAYMENT,
      bill_id: i.billId,
      society_id: billMeta.societyId,
      flat_id: "aaaaaaaa-1111-4222-8333-444444444444",
      submitted_by: i.actor.id,
      amount: i.amount,
      method: "bank_transfer",
      status: "pending",
      source: "resident_submission",
      reference_no: i.referenceNo,
      idempotency_key: i.idempotencyKey,
      created_at: `${DETERMINISTIC_DATE}T00:00:00Z`,
      updated_at: `${DETERMINISTIC_DATE}T00:00:00Z`,
      paid_at: `${DETERMINISTIC_DATE}T00:00:00Z`,
      user_id: null,
      submitted_at: null,
      payment_date: null,
      notes: null,
      verified_by: null,
      verified_at: null,
      verification_notes: null,
      rejected_by: null,
      rejected_at: null,
      rejection_reason: null,
      reversed_by: null,
      reversed_at: null,
      reversal_reason: null,
      platform_fee_paise: null,
      platform_share_paise: null,
      society_share_paise: null,
      proof_url: null,
      razorpay_order_id: null,
      razorpay_payment_id: null,
      razorpay_signature: null,
    });
    return PRIMARY_PAYMENT;
  };
  return state;
}

function summaryForBill(state: MockState, billId: string): Record<string, unknown> | null {
  const meta = state.bills[billId];
  if (!meta) return null;
  const rows = state.payments.filter((p) => p.bill_id === billId);
  const sum = (s: PaymentFullRow["status"]) =>
    rows.filter((r) => r.status === s).reduce((a, r) => a + r.amount, 0);
  const verified = sum("verified");
  const pending = sum("pending");
  const rejected = sum("rejected");
  const reversed = sum("reversed");
  const available = meta.total - verified - pending;
  const remaining = meta.total - verified;
  const cancelled = false;
  const status = verified === 0 && pending === 0 ? "unpaid" : "open";
  return {
    bill_id: billId,
    society_id: meta.societyId,
    total_payable: meta.total,
    verified_amount: verified,
    pending_amount: pending,
    rejected_amount: rejected,
    reversed_amount: reversed,
    available_to_submit: available,
    remaining_verified_balance: remaining,
    cancelled,
    status,
  };
}

function projectCols(row: Record<string, unknown>, cols: string): Record<string, unknown> {
  const keys = cols.split(",").map((c) => c.trim()).filter((c) => c.length > 0);
  const out: Record<string, unknown> = {};
  for (const k of keys) out[k] = row[k] ?? null;
  return out;
}

function makeAdmin(state: MockState) {
  return {
    from(table: string) {
      return {
        select(cols: string) {
          return {
            async eq(col: string, val: string) {
              if (table === "payments") {
                const filtered = state.payments.filter(
                  (r) => (col === "id" && r.id === val) || (col === "bill_id" && r.bill_id === val),
                );
                // Project only the requested columns so `.strict()` schemas
                // don't reject on unrelated columns from the mock row.
                return {
                  data: filtered.map((r) => projectCols(r as unknown as Record<string, unknown>, cols)),
                  error: null,
                };
              }
              if (table === "payment_receipts") {
                return {
                  data: state.receipts
                    .filter((r) => r.payment_id === val)
                    .map((r) => projectCols(r as unknown as Record<string, unknown>, cols)),
                  error: null,
                };
              }
              if (table === "payment_receipt_sequences") {
                return {
                  data: state.yearly
                    .filter((r) => r.society_id === val)
                    .map((r) => projectCols(r as unknown as Record<string, unknown>, cols)),
                  error: null,
                };
              }
              if (table === "payment_receipt_month_sequences") {
                return {
                  data: state.monthly
                    .filter((r) => r.society_id === val)
                    .map((r) => projectCols(r as unknown as Record<string, unknown>, cols)),
                  error: null,
                };
              }
              return { data: [], error: null };
            },
          };
        },
      };
    },
  };
}

function makeClient(state: MockState) {
  return {
    async rpc(name: string, args: Record<string, unknown>) {
      if (name === "get_bill_payment_summary") {
        const billId = String(args._bill_id);
        const summary = summaryForBill(state, billId);
        if (!summary) return { data: null, error: { message: "bill not found" } };
        return { data: summary, error: null };
      }
      return { data: null, error: { message: "unknown rpc" } };
    },
  };
}

function makeFixture(state: MockState): Stage3CFixtureShape {
  const admin = makeAdmin(state);
  const actorClient = makeClient(state);
  const unrelatedClient = makeClient(state);
  const activeResident = { id: RES_ID, email: "a@x", password: "x", client: actorClient };
  const unrelatedResident = { id: OTHER_RES, email: "b@x", password: "x", client: unrelatedClient };
  return {
    prefix: RUN_PREFIX,
    admin,
    societyA: SOCIETY_A,
    societyB: SOCIETY_B,
    idempotencyBillId: IDEM_BILL,
    referencePrimaryBillId: REF_BILL,
    referenceSecondarySameSocietyBillId: REF_BILL_2,
    referenceOtherSocietyBillId: REF_BILL_3,
    testPaymentDate: DETERMINISTIC_DATE,
    users: { activeResident, unrelatedResident },
    tracked: { paymentIds: state.trackedPaymentIds },
    helpers: {
      async submitResidentBankTransferPayment(input: unknown) {
        state.submitCalls.push(input);
        return state.submitImpl(input);
      },
    },
  };
}

// Minimal shape — cast to Stage3CFixture inside handlers via `as unknown as`.
type Stage3CFixtureShape = {
  prefix: string;
  admin: ReturnType<typeof makeAdmin>;
  societyA: string;
  societyB: string;
  idempotencyBillId: string;
  referencePrimaryBillId: string;
  referenceSecondarySameSocietyBillId: string;
  referenceOtherSocietyBillId: string;
  testPaymentDate: string;
  users: {
    activeResident: { id: string; email: string; password: string; client: ReturnType<typeof makeClient> };
    unrelatedResident: { id: string; email: string; password: string; client: ReturnType<typeof makeClient> };
  };
  tracked: { paymentIds: string[] };
  helpers: { submitResidentBankTransferPayment: (input: unknown) => Promise<string> };
};

function makeCtx(state: MockState): Stage3CLiveMatrixContext {
  const c = createStage3CLiveMatrixContext();
  (c as unknown as { fixture: unknown }).fixture = makeFixture(state);
  return c;
}

/** Seeds ctx with the canonical post-IDEM-01 state (for IDEM-02..04 tests). */
async function seedPostIdem01(state: MockState): Promise<Stage3CLiveMatrixContext> {
  const ctx = makeCtx(state);
  await idempotency01_initializeAndSubmit(ctx);
  // reset submit tracking so replay tests can observe their own single call
  state.submitCalls = [];
  return ctx;
}

// ---------------------------------------------------------------------------
// IDEMPOTENCY-01 — 17 tests
// ---------------------------------------------------------------------------

describe("Sub-run B — IDEMPOTENCY-01 initialize and submit", () => {
  it("(1) calls resident submit helper exactly once", async () => {
    const s = makeCleanState();
    await idempotency01_initializeAndSubmit(makeCtx(s));
    expect(s.submitCalls.length).toBe(1);
  });
  it("(2) uses the active resident", async () => {
    const s = makeCleanState();
    await idempotency01_initializeAndSubmit(makeCtx(s));
    const call = s.submitCalls[0] as { actor: { id: string } };
    expect(call.actor.id).toBe(RES_ID);
  });
  it("(3) uses the dedicated idempotency bill", async () => {
    const s = makeCleanState();
    await idempotency01_initializeAndSubmit(makeCtx(s));
    expect((s.submitCalls[0] as { billId: string }).billId).toBe(IDEM_BILL);
  });
  it("(4) uses amount 250", async () => {
    const s = makeCleanState();
    await idempotency01_initializeAndSubmit(makeCtx(s));
    expect((s.submitCalls[0] as { amount: number }).amount).toBe(250);
  });
  it("(5) uses the deterministic payment date", async () => {
    const s = makeCleanState();
    await idempotency01_initializeAndSubmit(makeCtx(s));
    expect((s.submitCalls[0] as { paymentDate: string }).paymentDate).toBe(DETERMINISTIC_DATE);
  });
  it("(6) uses the exact builder reference", async () => {
    const s = makeCleanState();
    await idempotency01_initializeAndSubmit(makeCtx(s));
    expect((s.submitCalls[0] as { referenceNo: string }).referenceNo).toBe(
      BUILDER_INPUTS.idempotencyReference,
    );
  });
  it("(7) uses the exact builder key", async () => {
    const s = makeCleanState();
    await idempotency01_initializeAndSubmit(makeCtx(s));
    expect((s.submitCalls[0] as { idempotencyKey: string }).idempotencyKey).toBe(
      BUILDER_INPUTS.idempotencyKey,
    );
  });
  it("(8) rejects a dirty baseline (nonzero pending)", async () => {
    const s = makeCleanState();
    s.payments.push(buildRow(OTHER_PAYMENT, IDEM_BILL, 50, "pending"));
    await expect(idempotency01_initializeAndSubmit(makeCtx(s))).rejects.toThrow(/baseline/);
  });
  it("(9) rejects an existing payment row on the target bill", async () => {
    const s = makeCleanState();
    s.payments.push(buildRow(OTHER_PAYMENT, IDEM_BILL, 0.01, "pending"));
    await expect(idempotency01_initializeAndSubmit(makeCtx(s))).rejects.toThrow(/baseline/);
  });
  it("(10) rejects an existing receipt for the new payment", async () => {
    const s = makeCleanState();
    s.receipts.push(buildReceipt("30000000-0000-0000-0000-00000000000a", PRIMARY_PAYMENT));
    await expect(idempotency01_initializeAndSubmit(makeCtx(s))).rejects.toThrow(/zero receipts/);
  });
  it("(11) rejects sequence mutation between snapshots", async () => {
    const s = makeCleanState();
    let calls = 0;
    const orig = s.submitImpl;
    s.submitImpl = async (i) => {
      const y = s.yearly.find((r) => r.society_id === SOCIETY_A);
      if (y) y.next_number += 1;
      calls++;
      return orig(i);
    };
    await expect(idempotency01_initializeAndSubmit(makeCtx(s))).rejects.toThrow(/sequence/);
    expect(calls).toBe(1);
  });
  it("(12) rejects a malformed returned payment ID", async () => {
    const s = makeCleanState();
    s.submitImpl = async () => "not-a-uuid";
    await expect(idempotency01_initializeAndSubmit(makeCtx(s))).rejects.toThrow();
  });
  it("(13) tracks the valid payment exactly once", async () => {
    const s = makeCleanState();
    await idempotency01_initializeAndSubmit(makeCtx(s));
    expect(s.trackedPaymentIds).toEqual([PRIMARY_PAYMENT]);
  });
  it("(14) stores the strict initial state", async () => {
    const s = makeCleanState();
    const ctx = makeCtx(s);
    await idempotency01_initializeAndSubmit(ctx);
    const init = requireIdempotencyInitialState(ctx);
    expect(init.paymentRows.length).toBe(0);
    expect(init.summary.total_payable).toBe(1000);
  });
  it("(15) stores the strict post-submit state", async () => {
    const s = makeCleanState();
    const ctx = makeCtx(s);
    await idempotency01_initializeAndSubmit(ctx);
    const post = requireIdempotencyPostSubmitState(ctx);
    expect(post.paymentRows.length).toBe(1);
    expect(post.summary.pending_amount).toBe(250);
  });
  it("(16) asserts pending delta +250", async () => {
    const s = makeCleanState();
    const ctx = makeCtx(s);
    await idempotency01_initializeAndSubmit(ctx);
    const post = requireIdempotencyPostSubmitState(ctx);
    const init = requireIdempotencyInitialState(ctx);
    expect(post.summary.pending_amount - init.summary.pending_amount).toBe(250);
  });
  it("(17) asserts available delta -250", async () => {
    const s = makeCleanState();
    const ctx = makeCtx(s);
    await idempotency01_initializeAndSubmit(ctx);
    const post = requireIdempotencyPostSubmitState(ctx);
    const init = requireIdempotencyInitialState(ctx);
    expect(init.summary.available_to_submit - post.summary.available_to_submit).toBe(250);
  });
});

// ---------------------------------------------------------------------------
// IDEMPOTENCY-02 — 11 tests
// ---------------------------------------------------------------------------

describe("Sub-run B — IDEMPOTENCY-02 exact replay", () => {
  it("(18) calls resident submit helper exactly once", async () => {
    const s = makeCleanState();
    const ctx = await seedPostIdem01(s);
    await idempotency02_exactReplay(ctx);
    expect(s.submitCalls.length).toBe(1);
  });
  it("(19) sends the exact same payload as IDEMPOTENCY-01", async () => {
    const s = makeCleanState();
    const ctx = await seedPostIdem01(s);
    await idempotency02_exactReplay(ctx);
    const call = s.submitCalls[0] as {
      billId: string;
      amount: number;
      paymentDate: string;
      referenceNo: string;
      idempotencyKey: string;
    };
    expect(call).toMatchObject({
      billId: IDEM_BILL,
      amount: 250,
      paymentDate: DETERMINISTIC_DATE,
      referenceNo: BUILDER_INPUTS.idempotencyReference,
      idempotencyKey: BUILDER_INPUTS.idempotencyKey,
    });
  });
  it("(20) requires the original payment ID from context", async () => {
    const s = makeCleanState();
    const ctx = makeCtx(s); // NOT seeded
    await expect(idempotency02_exactReplay(ctx)).rejects.toThrow(/idempotencyBillId/);
  });
  it("(21) accepts a replay that returns the same ID", async () => {
    const s = makeCleanState();
    const ctx = await seedPostIdem01(s);
    s.submitImpl = async () => PRIMARY_PAYMENT;
    await expect(idempotency02_exactReplay(ctx)).resolves.toBeUndefined();
  });
  it("(22) rejects a replay that returns a different ID", async () => {
    const s = makeCleanState();
    const ctx = await seedPostIdem01(s);
    s.submitImpl = async () => OTHER_PAYMENT;
    await expect(idempotency02_exactReplay(ctx)).rejects.toThrow(/replay-id/);
  });
  it("(23) does not track the replay", async () => {
    const s = makeCleanState();
    const ctx = await seedPostIdem01(s);
    const before = s.trackedPaymentIds.length;
    await idempotency02_exactReplay(ctx);
    expect(s.trackedPaymentIds.length).toBe(before);
  });
  it("(24) rejects a second payment row appearing during replay", async () => {
    const s = makeCleanState();
    const ctx = await seedPostIdem01(s);
    s.submitImpl = async () => {
      s.payments.push(buildRow(OTHER_PAYMENT, IDEM_BILL, 250, "pending"));
      return PRIMARY_PAYMENT;
    };
    await expect(idempotency02_exactReplay(ctx)).rejects.toThrow();
  });
  it("(25) rejects a changed payment amount during replay", async () => {
    const s = makeCleanState();
    const ctx = await seedPostIdem01(s);
    s.submitImpl = async () => {
      const p = s.payments.find((r) => r.id === PRIMARY_PAYMENT);
      if (p) p.amount = 999;
      return PRIMARY_PAYMENT;
    };
    await expect(idempotency02_exactReplay(ctx)).rejects.toThrow();
  });
  it("(26) rejects a changed summary during replay", async () => {
    const s = makeCleanState();
    const ctx = await seedPostIdem01(s);
    s.submitImpl = async () => {
      s.bills[IDEM_BILL] = { societyId: SOCIETY_A, total: 999 };
      return PRIMARY_PAYMENT;
    };
    await expect(idempotency02_exactReplay(ctx)).rejects.toThrow();
  });
  it("(27) rejects receipt creation during replay", async () => {
    const s = makeCleanState();
    const ctx = await seedPostIdem01(s);
    s.submitImpl = async () => {
      s.receipts.push({ id: "rcpt-1", payment_id: PRIMARY_PAYMENT });
      return PRIMARY_PAYMENT;
    };
    await expect(idempotency02_exactReplay(ctx)).rejects.toThrow();
  });
  it("(28) rejects sequence mutation during replay", async () => {
    const s = makeCleanState();
    const ctx = await seedPostIdem01(s);
    s.submitImpl = async () => {
      const y = s.yearly.find((r) => r.society_id === SOCIETY_A);
      if (y) y.next_number += 1;
      return PRIMARY_PAYMENT;
    };
    await expect(idempotency02_exactReplay(ctx)).rejects.toThrow(/sequence/);
  });
});

// ---------------------------------------------------------------------------
// IDEMPOTENCY-03 — 12 tests
// ---------------------------------------------------------------------------

describe("Sub-run B — IDEMPOTENCY-03 single mutation proof", () => {
  it("(29) performs zero submit calls", async () => {
    const s = makeCleanState();
    const ctx = await seedPostIdem01(s);
    await idempotency03_singleMutationProof(ctx);
    expect(s.submitCalls.length).toBe(0);
  });
  it("(30) accepts exactly one canonical pending row", async () => {
    const s = makeCleanState();
    const ctx = await seedPostIdem01(s);
    await expect(idempotency03_singleMutationProof(ctx)).resolves.toBeUndefined();
  });
  it("(31) rejects zero rows", async () => {
    const s = makeCleanState();
    const ctx = await seedPostIdem01(s);
    s.payments = [];
    await expect(idempotency03_singleMutationProof(ctx)).rejects.toThrow(/exactly one payment row/);
  });
  it("(32) rejects two rows", async () => {
    const s = makeCleanState();
    const ctx = await seedPostIdem01(s);
    s.payments.push(buildRow(OTHER_PAYMENT, IDEM_BILL, 100, "pending"));
    await expect(idempotency03_singleMutationProof(ctx)).rejects.toThrow(/exactly one payment row/);
  });
  it("(33) rejects an altered payment ID", async () => {
    const s = makeCleanState();
    const ctx = await seedPostIdem01(s);
    const p = s.payments[0];
    if (p) p.id = OTHER_PAYMENT;
    await expect(idempotency03_singleMutationProof(ctx)).rejects.toThrow();
  });
  it("(34) rejects an altered amount", async () => {
    const s = makeCleanState();
    const ctx = await seedPostIdem01(s);
    const p = s.payments[0];
    if (p) p.amount = 999;
    await expect(idempotency03_singleMutationProof(ctx)).rejects.toThrow();
  });
  it("(35) rejects an altered source", async () => {
    const s = makeCleanState();
    const ctx = await seedPostIdem01(s);
    const p = s.payments[0];
    if (p) p.source = "admin_entry";
    await expect(idempotency03_singleMutationProof(ctx)).rejects.toThrow();
  });
  it("(36) rejects an altered reference", async () => {
    const s = makeCleanState();
    const ctx = await seedPostIdem01(s);
    const p = s.payments[0];
    if (p) p.reference_no = "DIFFERENT";
    await expect(idempotency03_singleMutationProof(ctx)).rejects.toThrow(/reference/);
  });
  it("(37) rejects an altered idempotency key", async () => {
    const s = makeCleanState();
    const ctx = await seedPostIdem01(s);
    const p = s.payments[0];
    if (p) p.idempotency_key = "different-key";
    await expect(idempotency03_singleMutationProof(ctx)).rejects.toThrow(/key/);
  });
  it("(38) rejects receipt creation", async () => {
    const s = makeCleanState();
    const ctx = await seedPostIdem01(s);
    s.receipts.push({ id: "30000000-0000-0000-0000-00000000000b", payment_id: PRIMARY_PAYMENT });
    await expect(idempotency03_singleMutationProof(ctx)).rejects.toThrow(/zero receipts/);
  });
  it("(39) rejects sequence mutation", async () => {
    const s = makeCleanState();
    const ctx = await seedPostIdem01(s);
    const y = s.yearly.find((r) => r.society_id === SOCIETY_A);
    if (y) y.next_number += 1;
    await expect(idempotency03_singleMutationProof(ctx)).rejects.toThrow(/sequence/);
  });
  it("(40) proves exact initial-to-current deltas", async () => {
    const s = makeCleanState();
    const ctx = await seedPostIdem01(s);
    await idempotency03_singleMutationProof(ctx);
    const post = requireIdempotencyPostSubmitState(ctx);
    const init = requireIdempotencyInitialState(ctx);
    expect(post.summary.pending_amount - init.summary.pending_amount).toBe(250);
    expect(init.summary.available_to_submit - post.summary.available_to_submit).toBe(250);
    expect(post.paymentRows.length - init.paymentRows.length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// IDEMPOTENCY-04 — 15 tests
// ---------------------------------------------------------------------------

describe("Sub-run B — IDEMPOTENCY-04 conflicting replay denied", () => {
  async function seedWithConflict(): Promise<{ ctx: Stage3CLiveMatrixContext; state: MockState }> {
    const state = makeCleanState();
    const ctx = await seedPostIdem01(state);
    state.submitImpl = async () => {
      throw new Error("idempotency_conflict: conflicting payload");
    };
    return { ctx, state };
  }

  it("(41) sends amount 251 to the resident core", async () => {
    const { ctx, state } = await seedWithConflict();
    await expect(idempotency04_conflictingReplayDenied(ctx)).resolves.toBeUndefined();
    expect((state.submitCalls[0] as { amount: number }).amount).toBe(251);
  });
  it("(42) sends the same bill", async () => {
    const { ctx, state } = await seedWithConflict();
    await idempotency04_conflictingReplayDenied(ctx);
    expect((state.submitCalls[0] as { billId: string }).billId).toBe(IDEM_BILL);
  });
  it("(43) sends the same idempotency key", async () => {
    const { ctx, state } = await seedWithConflict();
    await idempotency04_conflictingReplayDenied(ctx);
    expect((state.submitCalls[0] as { idempotencyKey: string }).idempotencyKey).toBe(
      BUILDER_INPUTS.idempotencyKey,
    );
  });
  it("(44) sends the same reference", async () => {
    const { ctx, state } = await seedWithConflict();
    await idempotency04_conflictingReplayDenied(ctx);
    expect((state.submitCalls[0] as { referenceNo: string }).referenceNo).toBe(
      BUILDER_INPUTS.idempotencyReference,
    );
  });
  it("(45) accepts the canonical idempotency_conflict token", async () => {
    const { ctx } = await seedWithConflict();
    await expect(idempotency04_conflictingReplayDenied(ctx)).resolves.toBeUndefined();
  });
  it("(46) rejects a wrong error token", async () => {
    const state = makeCleanState();
    const ctx = await seedPostIdem01(state);
    state.submitImpl = async () => {
      throw new Error("some other unrelated error");
    };
    await expect(idempotency04_conflictingReplayDenied(ctx)).rejects.toThrow(/idempotency_conflict/);
  });
  it("(47) full state remains unchanged after denial", async () => {
    const { ctx, state } = await seedWithConflict();
    const beforeRows = state.payments.length;
    await idempotency04_conflictingReplayDenied(ctx);
    expect(state.payments.length).toBe(beforeRows);
  });
  it("(48) no new payment is tracked", async () => {
    const { ctx, state } = await seedWithConflict();
    const before = state.trackedPaymentIds.length;
    await idempotency04_conflictingReplayDenied(ctx);
    expect(state.trackedPaymentIds.length).toBe(before);
  });
  it("(49) unexpected success throws the exact static message", async () => {
    const state = makeCleanState();
    const ctx = await seedPostIdem01(state);
    state.submitImpl = async () => OTHER_PAYMENT; // provider "accepted"
    await expect(idempotency04_conflictingReplayDenied(ctx)).rejects.toThrow(
      IDEMPOTENCY_04_UNEXPECTED_SUCCESS_MESSAGE,
    );
  });
  it("(50) unexpected-success message excludes the success payload", async () => {
    const state = makeCleanState();
    const ctx = await seedPostIdem01(state);
    state.submitImpl = async () => OTHER_PAYMENT;
    try {
      await idempotency04_conflictingReplayDenied(ctx);
      throw new Error("should have thrown");
    } catch (e) {
      const msg = (e as Error).message;
      expect(msg).not.toContain(OTHER_PAYMENT);
      expect(msg).toBe(IDEMPOTENCY_04_UNEXPECTED_SUCCESS_MESSAGE);
    }
  });
  it("(51) safe error excludes IDs", async () => {
    const state = makeCleanState();
    const ctx = await seedPostIdem01(state);
    state.submitImpl = async () => {
      throw new Error(`idempotency_conflict at bill ${IDEM_BILL} for user ${RES_ID}`);
    };
    try {
      await idempotency04_conflictingReplayDenied(ctx);
    } catch (e) {
      // Assertion path itself must not leak IDs in its own thrown text.
      const msg = (e as Error).message;
      expect(msg).not.toContain(IDEM_BILL);
      expect(msg).not.toContain(RES_ID);
    }
  });
  it("(52) safe error excludes reference and key on assertion failure", async () => {
    const state = makeCleanState();
    const ctx = await seedPostIdem01(state);
    state.submitImpl = async () => {
      throw new Error("nothing_conflict");
    };
    try {
      await idempotency04_conflictingReplayDenied(ctx);
    } catch (e) {
      const msg = (e as Error).message;
      expect(msg).not.toContain(BUILDER_INPUTS.idempotencyReference);
      expect(msg).not.toContain(BUILDER_INPUTS.idempotencyKey);
    }
  });
  it("(53) safe error excludes amounts on assertion failure", async () => {
    const state = makeCleanState();
    const ctx = await seedPostIdem01(state);
    state.submitImpl = async () => {
      throw new Error("wrong_token");
    };
    try {
      await idempotency04_conflictingReplayDenied(ctx);
    } catch (e) {
      const msg = (e as Error).message;
      expect(msg).not.toContain("251");
    }
  });
  it("(54) receipt remains absent after denial", async () => {
    const { ctx, state } = await seedWithConflict();
    await idempotency04_conflictingReplayDenied(ctx);
    expect(state.receipts.length).toBe(0);
  });
  it("(55) sequences remain unchanged after denial", async () => {
    const { ctx, state } = await seedWithConflict();
    const before = JSON.stringify(state.yearly) + JSON.stringify(state.monthly);
    await idempotency04_conflictingReplayDenied(ctx);
    const after = JSON.stringify(state.yearly) + JSON.stringify(state.monthly);
    expect(after).toBe(before);
  });
});

// ---------------------------------------------------------------------------
// Exported baseline helpers — direct unit tests
// ---------------------------------------------------------------------------

describe("Sub-run B — exported IDEMPOTENCY assertion helpers", () => {
  it("assertCleanIdempotencyBaseline accepts a canonical 1000-clean state", () => {
    const s = makeCleanState();
    const summary = summaryForBill(s, IDEM_BILL);
    expect(() =>
      assertCleanIdempotencyBaseline(
        {
          summary: summary as unknown as import("../helpers/stage3c-live-resident-submit-contracts").ResidentBillSummary,
          paymentRows: [],
          receiptRows: [],
          sequences: { yearly: [], monthly: [] } as unknown as import("../helpers/stage3c-live-resident-submit-contracts").ReceiptSequenceSnapshot,
        },
        "test",
      ),
    ).not.toThrow();
  });
  it("assertCleanIdempotencyBaseline rejects nonzero pending", () => {
    const s = makeCleanState();
    s.payments.push(buildRow(OTHER_PAYMENT, IDEM_BILL, 1, "pending"));
    const summary = summaryForBill(s, IDEM_BILL);
    expect(() =>
      assertCleanIdempotencyBaseline(
        {
          summary: summary as unknown as import("../helpers/stage3c-live-resident-submit-contracts").ResidentBillSummary,
          paymentRows: [],
          receiptRows: [],
          sequences: { yearly: [], monthly: [] } as unknown as import("../helpers/stage3c-live-resident-submit-contracts").ReceiptSequenceSnapshot,
        },
        "test",
      ),
    ).toThrow(/pending_amount/);
  });
  it("assertIdempotencyPostSubmitTotals accepts canonical post totals", () => {
    const s = makeCleanState();
    const initial = {
      summary: summaryForBill(s, IDEM_BILL) as unknown as import("../helpers/stage3c-live-resident-submit-contracts").ResidentBillSummary,
      paymentRows: [],
      receiptRows: [],
      sequences: { yearly: [], monthly: [] } as unknown as import("../helpers/stage3c-live-resident-submit-contracts").ReceiptSequenceSnapshot,
    };
    s.payments.push(buildRow(PRIMARY_PAYMENT, IDEM_BILL, 250, "pending"));
    const post = {
      summary: summaryForBill(s, IDEM_BILL) as unknown as import("../helpers/stage3c-live-resident-submit-contracts").ResidentBillSummary,
      paymentRows: [
        { id: PRIMARY_PAYMENT, status: "pending", amount: 250 } as unknown as import("../helpers/stage3c-live-resident-submit-contracts").ResidentBillPaymentLifecycleRow,
      ],
      receiptRows: [],
      sequences: initial.sequences,
    };
    expect(() => assertIdempotencyPostSubmitTotals(initial, post, "t")).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Local test builders
// ---------------------------------------------------------------------------

function buildRow(
  id: string,
  billId: string,
  amount: number,
  status: PaymentFullRow["status"],
): PaymentFullRow {
  return {
    id,
    bill_id: billId,
    society_id: SOCIETY_A,
    flat_id: FLAT_ID,
    submitted_by: RES_ID,
    amount,
    method: "bank_transfer",
    status,
    source: "resident_submission",
    reference_no: BUILDER_INPUTS.idempotencyReference,
    idempotency_key: BUILDER_INPUTS.idempotencyKey,
    created_at: DETERMINISTIC_TS,
    updated_at: DETERMINISTIC_TS,
    paid_at: DETERMINISTIC_TS,
    user_id: null,
    submitted_at: null,
    payment_date: null,
    notes: null,
    verified_by: null,
    verified_at: null,
    verification_notes: null,
    rejected_by: null,
    rejected_at: null,
    rejection_reason: null,
    reversed_by: null,
    reversed_at: null,
    reversal_reason: null,
    platform_fee_paise: null,
    platform_share_paise: null,
    society_share_paise: null,
    proof_url: null,
    razorpay_order_id: null,
    razorpay_payment_id: null,
    razorpay_signature: null,
  };
}

// ===========================================================================
// Sub-run C — REFERENCE direct behavioral tests
// ===========================================================================

const REF_VARIANT = `  ${BUILDER_INPUTS.referenceValue.toLowerCase()}  `;

/** Seeds ctx by running REFERENCE-01 and resets submit tracking. */
async function seedPostRef01(state: MockState): Promise<Stage3CLiveMatrixContext> {
  const ctx = makeCtx(state);
  await reference01_createUniqueReference(ctx);
  state.submitCalls = [];
  return ctx;
}

function duplicateThrower(state: MockState): void {
  state.submitImpl = async () => {
    throw new Error("duplicate_reference");
  };
}

/** Seeds ctx by running REFERENCE-01 then REFERENCE-03 (duplicate denied)
 *  so REFERENCE-04 prerequisites (secondary initial state) are populated. */
async function seedPostRef03(state: MockState): Promise<Stage3CLiveMatrixContext> {
  const ctx = makeCtx(state);
  await reference01_createUniqueReference(ctx);
  duplicateThrower(state);
  await reference03_duplicateCanonicalScopeDenied(ctx);
  state.submitCalls = [];
  return ctx;
}

// ---------------------------------------------------------------------------
// REFERENCE-01 — 18 tests
// ---------------------------------------------------------------------------

describe("Sub-run C — REFERENCE-01 create unique reference", () => {
  it("(56) calls resident submit helper exactly once", async () => {
    const s = makeCleanState();
    await reference01_createUniqueReference(makeCtx(s));
    expect(s.submitCalls.length).toBe(1);
  });
  it("(57) uses the active resident", async () => {
    const s = makeCleanState();
    await reference01_createUniqueReference(makeCtx(s));
    expect((s.submitCalls[0] as { actor: { id: string } }).actor.id).toBe(RES_ID);
  });
  it("(58) uses the dedicated Society A primary reference bill", async () => {
    const s = makeCleanState();
    await reference01_createUniqueReference(makeCtx(s));
    expect((s.submitCalls[0] as { billId: string }).billId).toBe(REF_BILL);
  });
  it("(59) uses amount 200", async () => {
    const s = makeCleanState();
    await reference01_createUniqueReference(makeCtx(s));
    expect((s.submitCalls[0] as { amount: number }).amount).toBe(200);
  });
  it("(60) uses the deterministic payment date", async () => {
    const s = makeCleanState();
    await reference01_createUniqueReference(makeCtx(s));
    expect((s.submitCalls[0] as { paymentDate: string }).paymentDate).toBe(DETERMINISTIC_DATE);
  });
  it("(61) uses the exact builder reference value", async () => {
    const s = makeCleanState();
    await reference01_createUniqueReference(makeCtx(s));
    expect((s.submitCalls[0] as { referenceNo: string }).referenceNo).toBe(
      BUILDER_INPUTS.referenceValue,
    );
  });
  it("(62) uses the exact primary idempotency key", async () => {
    const s = makeCleanState();
    await reference01_createUniqueReference(makeCtx(s));
    expect((s.submitCalls[0] as { idempotencyKey: string }).idempotencyKey).toBe(
      BUILDER_INPUTS.referencePrimaryKey,
    );
  });
  it("(63) rejects a dirty baseline (nonzero pending)", async () => {
    const s = makeCleanState();
    s.payments.push(buildRow(OTHER_PAYMENT, REF_BILL, 10, "pending"));
    await expect(reference01_createUniqueReference(makeCtx(s))).rejects.toThrow(/baseline/);
  });
  it("(64) rejects an existing payment row on the target bill", async () => {
    const s = makeCleanState();
    s.payments.push(buildRow(OTHER_PAYMENT, REF_BILL, 0.01, "pending"));
    await expect(reference01_createUniqueReference(makeCtx(s))).rejects.toThrow(/baseline/);
  });
  it("(65) rejects a pre-existing receipt for the new payment", async () => {
    const s = makeCleanState();
    s.receipts.push({ id: "30000000-0000-0000-0000-00000000000a", payment_id: PRIMARY_PAYMENT });
    await expect(reference01_createUniqueReference(makeCtx(s))).rejects.toThrow(/zero receipts/);
  });
  it("(66) rejects sequence mutation during the submit call", async () => {
    const s = makeCleanState();
    const orig = s.submitImpl;
    s.submitImpl = async (i) => {
      const y = s.yearly.find((r) => r.society_id === SOCIETY_A);
      if (y) y.next_number += 1;
      return orig(i);
    };
    await expect(reference01_createUniqueReference(makeCtx(s))).rejects.toThrow(/sequence/);
  });
  it("(67) rejects a malformed returned payment ID", async () => {
    const s = makeCleanState();
    s.submitImpl = async () => "not-a-uuid";
    await expect(reference01_createUniqueReference(makeCtx(s))).rejects.toThrow();
  });
  it("(68) tracks the valid payment exactly once", async () => {
    const s = makeCleanState();
    await reference01_createUniqueReference(makeCtx(s));
    expect(s.trackedPaymentIds).toEqual([PRIMARY_PAYMENT]);
  });
  it("(69) stores strict initial state (800 total, 0 pending)", async () => {
    const s = makeCleanState();
    const ctx = makeCtx(s);
    await reference01_createUniqueReference(ctx);
    const init = requireReferencePrimaryInitialState(ctx);
    expect(init.summary.total_payable).toBe(REFERENCE_BILL_PRIMARY_TOTAL);
    expect(init.summary.pending_amount).toBe(0);
    expect(init.paymentRows.length).toBe(0);
  });
  it("(70) stores strict post-submit state (pending 200, available 600)", async () => {
    const s = makeCleanState();
    const ctx = makeCtx(s);
    await reference01_createUniqueReference(ctx);
    const post = requireReferencePrimaryPostSubmitState(ctx);
    expect(post.summary.pending_amount).toBe(200);
    expect(post.summary.available_to_submit).toBe(600);
    expect(post.paymentRows.length).toBe(1);
  });
  it("(71) populates all seven canonical context slots on success", async () => {
    const s = makeCleanState();
    const ctx = makeCtx(s);
    await reference01_createUniqueReference(ctx);
    expect(requireReferencePrimaryBillId(ctx)).toBe(REF_BILL);
    expect(requireReferenceSecondarySameSocietyBillId(ctx)).toBe(REF_BILL_2);
    expect(requireReferenceOtherSocietyBillId(ctx)).toBe(REF_BILL_3);
    expect(requireReferencePrimaryPaymentId(ctx)).toBe(PRIMARY_PAYMENT);
    expect(requireReferenceValue(ctx)).toBe(BUILDER_INPUTS.referenceValue);
    expect(requireReferenceAmount(ctx)).toBe(200);
    expect(requireReferencePrimaryKey(ctx)).toBe(BUILDER_INPUTS.referencePrimaryKey);
  });
  it("(72) records all three duplicate/cross keys for downstream cases", async () => {
    const s = makeCleanState();
    const ctx = makeCtx(s);
    await reference01_createUniqueReference(ctx);
    expect(requireReferenceDuplicateKey(ctx)).toBe(BUILDER_INPUTS.referenceDuplicateKey);
    expect(requireReferenceCrossBillKey(ctx)).toBe(BUILDER_INPUTS.referenceCrossBillKey);
    expect(requireReferenceOtherSocietyKey(ctx)).toBe(BUILDER_INPUTS.referenceOtherSocietyKey);
  });
  it("(73) asserts +200 pending / -200 available deltas", async () => {
    const s = makeCleanState();
    const ctx = makeCtx(s);
    await reference01_createUniqueReference(ctx);
    const init = requireReferencePrimaryInitialState(ctx);
    const post = requireReferencePrimaryPostSubmitState(ctx);
    expect(post.summary.pending_amount - init.summary.pending_amount).toBe(200);
    expect(init.summary.available_to_submit - post.summary.available_to_submit).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// REFERENCE-02 — 13 tests
// ---------------------------------------------------------------------------

describe("Sub-run C — REFERENCE-02 duplicate on same bill denied", () => {
  it("(74) calls the resident core exactly once", async () => {
    const s = makeCleanState();
    const ctx = await seedPostRef01(s);
    duplicateThrower(s);
    await reference02_duplicateSameBillDenied(ctx);
    expect(s.submitCalls.length).toBe(1);
  });
  it("(75) submits the whitespace/case variant of the reference", async () => {
    const s = makeCleanState();
    const ctx = await seedPostRef01(s);
    duplicateThrower(s);
    await reference02_duplicateSameBillDenied(ctx);
    expect((s.submitCalls[0] as { referenceNo: string }).referenceNo).toBe(REF_VARIANT);
  });
  it("(76) submits the duplicate idempotency key", async () => {
    const s = makeCleanState();
    const ctx = await seedPostRef01(s);
    duplicateThrower(s);
    await reference02_duplicateSameBillDenied(ctx);
    expect((s.submitCalls[0] as { idempotencyKey: string }).idempotencyKey).toBe(
      BUILDER_INPUTS.referenceDuplicateKey,
    );
  });
  it("(77) targets the primary reference bill", async () => {
    const s = makeCleanState();
    const ctx = await seedPostRef01(s);
    duplicateThrower(s);
    await reference02_duplicateSameBillDenied(ctx);
    expect((s.submitCalls[0] as { billId: string }).billId).toBe(REF_BILL);
  });
  it("(78) accepts the canonical duplicate_reference token", async () => {
    const s = makeCleanState();
    const ctx = await seedPostRef01(s);
    duplicateThrower(s);
    await expect(reference02_duplicateSameBillDenied(ctx)).resolves.toBeUndefined();
  });
  it("(79) rejects a wrong error token", async () => {
    const s = makeCleanState();
    const ctx = await seedPostRef01(s);
    s.submitImpl = async () => {
      throw new Error("some_other_error");
    };
    await expect(reference02_duplicateSameBillDenied(ctx)).rejects.toThrow(/duplicate_reference/);
  });
  it("(80) unexpected success throws the exact static message", async () => {
    const s = makeCleanState();
    const ctx = await seedPostRef01(s);
    s.submitImpl = async () => OTHER_PAYMENT;
    await expect(reference02_duplicateSameBillDenied(ctx)).rejects.toThrow(
      REFERENCE_02_UNEXPECTED_SUCCESS_MESSAGE,
    );
  });
  it("(81) unexpected-success message excludes the success payload", async () => {
    const s = makeCleanState();
    const ctx = await seedPostRef01(s);
    s.submitImpl = async () => OTHER_PAYMENT;
    try {
      await reference02_duplicateSameBillDenied(ctx);
      throw new Error("should have thrown");
    } catch (e) {
      const msg = (e as Error).message;
      expect(msg).not.toContain(OTHER_PAYMENT);
      expect(msg).toBe(REFERENCE_02_UNEXPECTED_SUCCESS_MESSAGE);
    }
  });
  it("(82) primary payment row remains exactly one", async () => {
    const s = makeCleanState();
    const ctx = await seedPostRef01(s);
    duplicateThrower(s);
    await reference02_duplicateSameBillDenied(ctx);
    expect(s.payments.filter((r) => r.bill_id === REF_BILL).length).toBe(1);
  });
  it("(83) tracked payment count does not change", async () => {
    const s = makeCleanState();
    const ctx = await seedPostRef01(s);
    duplicateThrower(s);
    const before = s.trackedPaymentIds.length;
    await reference02_duplicateSameBillDenied(ctx);
    expect(s.trackedPaymentIds.length).toBe(before);
  });
  it("(84) no receipt appears for the original payment", async () => {
    const s = makeCleanState();
    const ctx = await seedPostRef01(s);
    duplicateThrower(s);
    await reference02_duplicateSameBillDenied(ctx);
    expect(s.receipts.length).toBe(0);
  });
  it("(85) sequences remain unchanged", async () => {
    const s = makeCleanState();
    const ctx = await seedPostRef01(s);
    duplicateThrower(s);
    const before = JSON.stringify(s.yearly) + JSON.stringify(s.monthly);
    await reference02_duplicateSameBillDenied(ctx);
    const after = JSON.stringify(s.yearly) + JSON.stringify(s.monthly);
    expect(after).toBe(before);
  });
  it("(86) rejects sequence mutation during the attempt", async () => {
    const s = makeCleanState();
    const ctx = await seedPostRef01(s);
    s.submitImpl = async () => {
      const y = s.yearly.find((r) => r.society_id === SOCIETY_A);
      if (y) y.next_number += 1;
      throw new Error("duplicate_reference");
    };
    await expect(reference02_duplicateSameBillDenied(ctx)).rejects.toThrow(/sequence/);
  });
});

// ---------------------------------------------------------------------------
// REFERENCE-03 — 13 tests
// ---------------------------------------------------------------------------

describe("Sub-run C — REFERENCE-03 duplicate cross-bill same-society denied", () => {
  it("(87) calls the resident core exactly once", async () => {
    const s = makeCleanState();
    const ctx = await seedPostRef01(s);
    duplicateThrower(s);
    await reference03_duplicateCanonicalScopeDenied(ctx);
    expect(s.submitCalls.length).toBe(1);
  });
  it("(88) targets the secondary same-society bill", async () => {
    const s = makeCleanState();
    const ctx = await seedPostRef01(s);
    duplicateThrower(s);
    await reference03_duplicateCanonicalScopeDenied(ctx);
    expect((s.submitCalls[0] as { billId: string }).billId).toBe(REF_BILL_2);
  });
  it("(89) uses the cross-bill idempotency key", async () => {
    const s = makeCleanState();
    const ctx = await seedPostRef01(s);
    duplicateThrower(s);
    await reference03_duplicateCanonicalScopeDenied(ctx);
    expect((s.submitCalls[0] as { idempotencyKey: string }).idempotencyKey).toBe(
      BUILDER_INPUTS.referenceCrossBillKey,
    );
  });
  it("(90) submits the whitespace/case variant of the reference", async () => {
    const s = makeCleanState();
    const ctx = await seedPostRef01(s);
    duplicateThrower(s);
    await reference03_duplicateCanonicalScopeDenied(ctx);
    expect((s.submitCalls[0] as { referenceNo: string }).referenceNo).toBe(REF_VARIANT);
  });
  it("(91) rejects a dirty secondary baseline", async () => {
    const s = makeCleanState();
    const ctx = await seedPostRef01(s);
    duplicateThrower(s);
    s.payments.push(buildRow(OTHER_PAYMENT, REF_BILL_2, 5, "pending"));
    await expect(reference03_duplicateCanonicalScopeDenied(ctx)).rejects.toThrow(/baseline/);
  });
  it("(92) stores the strict secondary initial state", async () => {
    const s = makeCleanState();
    const ctx = await seedPostRef01(s);
    duplicateThrower(s);
    await reference03_duplicateCanonicalScopeDenied(ctx);
    const sec = requireReferenceSecondaryInitialState(ctx);
    expect(sec.summary.total_payable).toBe(REFERENCE_BILL_SECONDARY_TOTAL);
    expect(sec.summary.pending_amount).toBe(0);
  });
  it("(93) accepts the canonical duplicate_reference token", async () => {
    const s = makeCleanState();
    const ctx = await seedPostRef01(s);
    duplicateThrower(s);
    await expect(reference03_duplicateCanonicalScopeDenied(ctx)).resolves.toBeUndefined();
  });
  it("(94) rejects a wrong error token", async () => {
    const s = makeCleanState();
    const ctx = await seedPostRef01(s);
    s.submitImpl = async () => {
      throw new Error("something_else");
    };
    await expect(reference03_duplicateCanonicalScopeDenied(ctx)).rejects.toThrow(/duplicate_reference/);
  });
  it("(95) unexpected success throws the exact static message", async () => {
    const s = makeCleanState();
    const ctx = await seedPostRef01(s);
    s.submitImpl = async () => OTHER_PAYMENT;
    await expect(reference03_duplicateCanonicalScopeDenied(ctx)).rejects.toThrow(
      REFERENCE_03_UNEXPECTED_SUCCESS_MESSAGE,
    );
  });
  it("(96) unexpected-success message excludes the success payload", async () => {
    const s = makeCleanState();
    const ctx = await seedPostRef01(s);
    s.submitImpl = async () => OTHER_PAYMENT;
    try {
      await reference03_duplicateCanonicalScopeDenied(ctx);
      throw new Error("should have thrown");
    } catch (e) {
      const msg = (e as Error).message;
      expect(msg).not.toContain(OTHER_PAYMENT);
      expect(msg).toBe(REFERENCE_03_UNEXPECTED_SUCCESS_MESSAGE);
    }
  });
  it("(97) primary payment row remains exactly one and unchanged", async () => {
    const s = makeCleanState();
    const ctx = await seedPostRef01(s);
    duplicateThrower(s);
    await reference03_duplicateCanonicalScopeDenied(ctx);
    const primaryRows = s.payments.filter((r) => r.bill_id === REF_BILL);
    expect(primaryRows.length).toBe(1);
    expect(primaryRows[0]?.id).toBe(PRIMARY_PAYMENT);
    expect(primaryRows[0]?.amount).toBe(200);
  });
  it("(98) no new payment row appears on the secondary bill", async () => {
    const s = makeCleanState();
    const ctx = await seedPostRef01(s);
    duplicateThrower(s);
    await reference03_duplicateCanonicalScopeDenied(ctx);
    expect(s.payments.filter((r) => r.bill_id === REF_BILL_2).length).toBe(0);
  });
  it("(99) tracked payment count does not change", async () => {
    const s = makeCleanState();
    const ctx = await seedPostRef01(s);
    duplicateThrower(s);
    const before = s.trackedPaymentIds.length;
    await reference03_duplicateCanonicalScopeDenied(ctx);
    expect(s.trackedPaymentIds.length).toBe(before);
  });
});

// ---------------------------------------------------------------------------
// REFERENCE-04 — 15 tests
// ---------------------------------------------------------------------------

function seedOtherSocietySuccess(state: MockState): void {
  state.submitImpl = async (input: unknown) => {
    const i = input as {
      actor: { id: string };
      billId: string;
      amount: number;
      referenceNo: string;
      idempotencyKey: string;
    };
    const existing = state.payments.find((r) => r.idempotency_key === i.idempotencyKey);
    if (existing) return existing.id;
    const billMeta = state.bills[i.billId];
    if (!billMeta) throw new Error("bill_not_found");
    state.payments.push({
      id: OTHER_PAYMENT,
      bill_id: i.billId,
      society_id: billMeta.societyId,
      flat_id: FLAT_ID,
      submitted_by: i.actor.id,
      amount: i.amount,
      method: "bank_transfer",
      status: "pending",
      source: "resident_submission",
      reference_no: i.referenceNo,
      idempotency_key: i.idempotencyKey,
      created_at: DETERMINISTIC_TS,
      updated_at: DETERMINISTIC_TS,
      paid_at: DETERMINISTIC_TS,
      user_id: null,
      submitted_at: null,
      payment_date: null,
      notes: null,
      verified_by: null,
      verified_at: null,
      verification_notes: null,
      rejected_by: null,
      rejected_at: null,
      rejection_reason: null,
      reversed_by: null,
      reversed_at: null,
      reversal_reason: null,
      platform_fee_paise: null,
      platform_share_paise: null,
      society_share_paise: null,
      proof_url: null,
      razorpay_order_id: null,
      razorpay_payment_id: null,
      razorpay_signature: null,
    });
    return OTHER_PAYMENT;
  };
}

describe("Sub-run C — REFERENCE-04 outside-scope isolation", () => {
  it("(100) calls the resident core exactly once", async () => {
    const s = makeCleanState();
    const ctx = await seedPostRef03(s);
    seedOtherSocietySuccess(s);
    await reference04_outsideScopeIsolation(ctx);
    expect(s.submitCalls.length).toBe(1);
  });
  it("(101) uses the unrelated Society B resident", async () => {
    const s = makeCleanState();
    const ctx = await seedPostRef03(s);
    seedOtherSocietySuccess(s);
    await reference04_outsideScopeIsolation(ctx);
    expect((s.submitCalls[0] as { actor: { id: string } }).actor.id).toBe(OTHER_RES);
  });
  it("(102) targets the Society B other bill", async () => {
    const s = makeCleanState();
    const ctx = await seedPostRef03(s);
    seedOtherSocietySuccess(s);
    await reference04_outsideScopeIsolation(ctx);
    expect((s.submitCalls[0] as { billId: string }).billId).toBe(REF_BILL_3);
  });
  it("(103) uses amount 200 and the whitespace variant reference", async () => {
    const s = makeCleanState();
    const ctx = await seedPostRef03(s);
    seedOtherSocietySuccess(s);
    await reference04_outsideScopeIsolation(ctx);
    const call = s.submitCalls[0] as { amount: number; referenceNo: string };
    expect(call.amount).toBe(200);
    expect(call.referenceNo).toBe(REF_VARIANT);
  });
  it("(104) uses the dedicated other-society idempotency key", async () => {
    const s = makeCleanState();
    const ctx = await seedPostRef03(s);
    seedOtherSocietySuccess(s);
    await reference04_outsideScopeIsolation(ctx);
    expect((s.submitCalls[0] as { idempotencyKey: string }).idempotencyKey).toBe(
      BUILDER_INPUTS.referenceOtherSocietyKey,
    );
  });
  it("(105) rejects a payment id equal to the primary payment id", async () => {
    const s = makeCleanState();
    const ctx = await seedPostRef03(s);
    s.submitImpl = async () => PRIMARY_PAYMENT;
    await expect(reference04_outsideScopeIsolation(ctx)).rejects.toThrow(/must differ/);
  });
  it("(106) rejects a dirty Society B baseline", async () => {
    const s = makeCleanState();
    const ctx = await seedPostRef03(s);
    seedOtherSocietySuccess(s);
    s.payments.push(buildRow(PRIMARY_PAYMENT, REF_BILL_3, 5, "pending"));
    // fix society scope for pushed row
    s.payments[s.payments.length - 1]!.society_id = SOCIETY_B;
    await expect(reference04_outsideScopeIsolation(ctx)).rejects.toThrow(/baseline/);
  });
  it("(107) tracks the cross-society payment id", async () => {
    const s = makeCleanState();
    const ctx = await seedPostRef03(s);
    seedOtherSocietySuccess(s);
    const before = s.trackedPaymentIds.length;
    await reference04_outsideScopeIsolation(ctx);
    expect(s.trackedPaymentIds.length).toBe(before + 1);
    expect(s.trackedPaymentIds.includes(OTHER_PAYMENT)).toBe(true);
  });
  it("(108) stores strict initial state (Society B, total 600)", async () => {
    const s = makeCleanState();
    const ctx = await seedPostRef03(s);
    seedOtherSocietySuccess(s);
    await reference04_outsideScopeIsolation(ctx);
    const init = requireReferenceOtherSocietyInitialState(ctx);
    expect(init.summary.society_id).toBe(SOCIETY_B);
    expect(init.summary.total_payable).toBe(REFERENCE_BILL_OTHER_SOCIETY_TOTAL);
    expect(init.paymentRows.length).toBe(0);
  });
  it("(109) stores strict post-submit state (pending 200, available 400)", async () => {
    const s = makeCleanState();
    const ctx = await seedPostRef03(s);
    seedOtherSocietySuccess(s);
    await reference04_outsideScopeIsolation(ctx);
    const post = requireReferenceOtherSocietyPostSubmitState(ctx);
    expect(post.summary.pending_amount).toBe(200);
    expect(post.summary.available_to_submit).toBe(400);
    expect(post.paymentRows.length).toBe(1);
  });
  it("(110) stores the canonical other-society payment id", async () => {
    const s = makeCleanState();
    const ctx = await seedPostRef03(s);
    seedOtherSocietySuccess(s);
    await reference04_outsideScopeIsolation(ctx);
    expect(requireReferenceOtherSocietyPaymentId(ctx)).toBe(OTHER_PAYMENT);
  });
  it("(111) Society A primary bill remains exactly unchanged", async () => {
    const s = makeCleanState();
    const ctx = await seedPostRef03(s);
    seedOtherSocietySuccess(s);
    const primaryBefore = JSON.stringify(
      s.payments.filter((r) => r.bill_id === REF_BILL),
    );
    await reference04_outsideScopeIsolation(ctx);
    const primaryAfter = JSON.stringify(
      s.payments.filter((r) => r.bill_id === REF_BILL),
    );
    expect(primaryAfter).toBe(primaryBefore);
  });
  it("(112) Society A secondary bill remains exactly unchanged (0 rows)", async () => {
    const s = makeCleanState();
    const ctx = await seedPostRef03(s);
    seedOtherSocietySuccess(s);
    await reference04_outsideScopeIsolation(ctx);
    expect(s.payments.filter((r) => r.bill_id === REF_BILL_2).length).toBe(0);
  });
  it("(113) no receipt created for the cross-society payment", async () => {
    const s = makeCleanState();
    const ctx = await seedPostRef03(s);
    seedOtherSocietySuccess(s);
    await reference04_outsideScopeIsolation(ctx);
    expect(s.receipts.length).toBe(0);
  });
  it("(114) Society B sequences remain unchanged", async () => {
    const s = makeCleanState();
    const ctx = await seedPostRef03(s);
    seedOtherSocietySuccess(s);
    const before = JSON.stringify(s.yearly.filter((r) => r.society_id === SOCIETY_B)) +
      JSON.stringify(s.monthly.filter((r) => r.society_id === SOCIETY_B));
    await reference04_outsideScopeIsolation(ctx);
    const after = JSON.stringify(s.yearly.filter((r) => r.society_id === SOCIETY_B)) +
      JSON.stringify(s.monthly.filter((r) => r.society_id === SOCIETY_B));
    expect(after).toBe(before);
  });
});

// ---------------------------------------------------------------------------
// Exported REFERENCE assertion helpers — direct unit tests
// ---------------------------------------------------------------------------

describe("Sub-run C — exported REFERENCE assertion helpers", () => {
  function makeBillState(billId: string, societyId: string, s: MockState) {
    const summary = summaryForBill(s, billId);
    return {
      summary: summary as unknown as import("../helpers/stage3c-live-resident-submit-contracts").ResidentBillSummary,
      paymentRows: [] as unknown as readonly import("../helpers/stage3c-live-resident-submit-contracts").ResidentBillPaymentLifecycleRow[],
      receiptRows: [] as unknown as readonly import("../helpers/stage3c-live-resident-submit-contracts").ResidentBillReceiptLifecycleRow[],
      sequences: { yearly: [], monthly: [] } as unknown as import("../helpers/stage3c-live-resident-submit-contracts").ReceiptSequenceSnapshot,
    };
  }
  it("(115) assertCleanReferenceBaseline accepts clean 800 state", () => {
    const s = makeCleanState();
    expect(() =>
      assertCleanReferenceBaseline(makeBillState(REF_BILL, SOCIETY_A, s), 800, "t"),
    ).not.toThrow();
  });
  it("(116) assertCleanReferenceBaseline rejects nonzero pending", () => {
    const s = makeCleanState();
    s.payments.push(buildRow(OTHER_PAYMENT, REF_BILL, 1, "pending"));
    expect(() =>
      assertCleanReferenceBaseline(makeBillState(REF_BILL, SOCIETY_A, s), 800, "t"),
    ).toThrow(/pending_amount/);
  });
  it("(117) assertCleanReferenceBaseline rejects total mismatch", () => {
    const s = makeCleanState();
    expect(() =>
      assertCleanReferenceBaseline(makeBillState(REF_BILL, SOCIETY_A, s), 999, "t"),
    ).toThrow(/total_payable mismatch/);
  });
  it("(118) assertReferencePostSubmitTotals accepts canonical +200 delta", () => {
    const s = makeCleanState();
    const initial = makeBillState(REF_BILL, SOCIETY_A, s);
    s.payments.push(buildRow(PRIMARY_PAYMENT, REF_BILL, 200, "pending"));
    const post = {
      summary: summaryForBill(s, REF_BILL) as unknown as import("../helpers/stage3c-live-resident-submit-contracts").ResidentBillSummary,
      paymentRows: [
        { id: PRIMARY_PAYMENT, status: "pending", amount: 200 } as unknown as import("../helpers/stage3c-live-resident-submit-contracts").ResidentBillPaymentLifecycleRow,
      ],
      receiptRows: [],
      sequences: initial.sequences,
    };
    expect(() =>
      assertReferencePostSubmitTotals(initial, post, 800, "t"),
    ).not.toThrow();
  });
});
