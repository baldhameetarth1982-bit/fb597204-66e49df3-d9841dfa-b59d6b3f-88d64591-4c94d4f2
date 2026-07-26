/**
 * Stage 3C — IDEMPOTENCY + REFERENCE Sub-run A focused contract tests.
 *
 * Sub-run A is a structural closure only. These tests execute the real
 * exported handler map, the deterministic input builder, the matrix-
 * context lifecycle fields and their `require*` guards. Behavioral
 * closure (row-level financial invariants, sequence deltas, cross-
 * society isolation) lands in Sub-run B against the live Supabase
 * stack.
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
  buildStage3CIdempotencyReferenceInputs,
  idempotency01_initializeAndSubmit,
  idempotency02_exactReplay,
  idempotency03_singleMutationProof,
  idempotency04_conflictingReplayDenied,
  reference01_createUniqueReference,
  reference02_duplicateSameBillDenied,
  reference03_duplicateCanonicalScopeDenied,
  reference04_outsideScopeIsolation,
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

// ---------------------------------------------------------------------------
// Deterministic input builder
// ---------------------------------------------------------------------------

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
});

// ---------------------------------------------------------------------------
// Exact named exports + shared handler typing
// ---------------------------------------------------------------------------

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
    // The parallel handler type from earlier runs must be absent from the
    // sources. `satisfies Record<..., Stage3CMatrixLiveHandler>` must be
    // in force.
    expect(CASES_SRC).not.toMatch(/Stage3CIdempotencyReferenceHandler\b/);
    expect(CASES_SRC).toMatch(
      /satisfies Record<\s*Stage3CIdempotencyReferenceCaseId\s*,\s*Stage3CMatrixLiveHandler\s*>/,
    );
  });

  it("the cases module does NOT import vitest", () => {
    expect(CASES_SRC).not.toMatch(/from ["']vitest["']/);
  });

  it("the cases module contains NO non-null assertions", () => {
    // Common non-null assertion shapes: `x!.`, `x!,`, `x!)`, `x!;`, `x!]`.
    expect(CASES_SRC).not.toMatch(/\b[A-Za-z_][A-Za-z0-9_]*!\./);
    expect(CASES_SRC).not.toMatch(/\b[A-Za-z_][A-Za-z0-9_]*!\s*[,)\];]/);
  });

  it("loose lifecycle schemas are NOT exported anymore", () => {
    expect(CASES_SRC).not.toMatch(/IdempotencyLifecycleSnapshotSchema/);
    expect(CASES_SRC).not.toMatch(/ReferenceLifecycleSnapshotSchema/);
  });
});

// ---------------------------------------------------------------------------
// Strict matrix context — fields, guards, error surface
// ---------------------------------------------------------------------------

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
    // Missing `sequences` — fails the strict schema gate.
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
    // Bounded guard — supply an overlong value.
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
