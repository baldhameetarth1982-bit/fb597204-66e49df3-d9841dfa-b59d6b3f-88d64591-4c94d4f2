/**
 * Stage 3C — 40-case matrix foundation behavioral tests.
 *
 * Foundation-only: verifies exported types, validators, guards,
 * canonical error tokens, the extracted resident submission schema
 * and its production integration. Does NOT register any new live
 * manifest case.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  validateStage3CMatrixResources,
  type Stage3CMatrixResources,
} from "../../tests/helpers/stage3c-runtime-fixtures";
import {
  createStage3CLiveMatrixContext,
  requireMatrixFixture,
  requireResidentBillId,
  requireResidentBaselineSummary,
  requireResidentPostSubmitSummary,
  requireResidentPaymentId,
  requireResidentAmount,
  requireResidentReference,
  requireResidentIdempotencyKey,
  requireIdempotencyBillAId,
  requireIdempotencyBillBId,
  requireIdempotencyKey,
  requireIdempotencyAmount,
  requireIdempotencyOriginalPaymentId,
  requireIdempotencyBaselinePaymentCount,
  requireIdempotencyBaselineSummary,
  requireIdempotencyPostSummary,
  requireReferenceBillId,
  requireCanonicalReference,
  requireReferenceOriginalPaymentId,
  requireReferenceBaselinePaymentCount,
  requireReferencePostOriginalSummary,
} from "../../tests/helpers/stage3c-live-matrix-context";
import {
  STAGE3C_ERRORS,
  matchesCanonicalError,
  assertCanonicalError,
} from "../../tests/helpers/stage3c-live-errors";
import { residentSubmitInputSchema } from "@/lib/offline-payment-contracts";

const U = (s: string) => `00000000-0000-4000-8000-00000000${s.padStart(4, "0")}`;

function validMatrix(): Stage3CMatrixResources {
  return {
    otherFlatA: U("0001"),
    residentSubmitBillId: U("0002"),
    otherFlatBillId: U("0003"),
    idempotencyBillAId: U("0004"),
    idempotencyBillBId: U("0005"),
    referenceBillId: U("0006"),
  };
}

function baseOwnership() {
  return {
    flatA: U("9999"),
    existingBillIds: [U("aaa1"), U("aaa2"), U("aaa3"), U("aaa4")] as [
      string,
      string,
      string,
      string,
    ],
  };
}

describe("Stage 3C foundation — matrix resource validation", () => {
  it("accepts a valid six-field resource object with ownership", () => {
    expect(validateStage3CMatrixResources(validMatrix(), baseOwnership())).toEqual(validMatrix());
  });
  it("rejects malformed UUIDs", () => {
    const bad = { ...validMatrix(), otherFlatA: "not-a-uuid" };
    expect(() => validateStage3CMatrixResources(bad, baseOwnership())).toThrow(/matrix/);
  });
  it("rejects unknown properties", () => {
    const bad = { ...validMatrix(), sneaky: "x" };
    expect(() => validateStage3CMatrixResources(bad, baseOwnership())).toThrow(/matrix/);
  });
  it("rejects duplicate dedicated bill IDs", () => {
    const bad = { ...validMatrix(), otherFlatBillId: validMatrix().residentSubmitBillId };
    expect(() => validateStage3CMatrixResources(bad, baseOwnership())).toThrow(/unique/);
  });
  it("rejects missing fields", () => {
    const bad: Record<string, unknown> = { ...validMatrix() };
    delete bad.referenceBillId;
    expect(() => validateStage3CMatrixResources(bad, baseOwnership())).toThrow(/matrix/);
  });
  it("rejects blank fields", () => {
    const bad = { ...validMatrix(), residentSubmitBillId: "   " };
    expect(() => validateStage3CMatrixResources(bad, baseOwnership())).toThrow(/matrix/);
  });
  it("rejects otherFlatA equal to flatA", () => {
    const v = validMatrix();
    expect(() =>
      validateStage3CMatrixResources(v, { ...baseOwnership(), flatA: v.otherFlatA }),
    ).toThrow(/otherFlatA must not equal flatA/);
  });
  it("rejects dedicated/core overlap", () => {
    const v = validMatrix();
    expect(() =>
      validateStage3CMatrixResources(v, {
        flatA: U("9999"),
        existingBillIds: [v.residentSubmitBillId, U("aaa2"), U("aaa3"), U("aaa4")],
      }),
    ).toThrow(/overlap/);
  });
  it("rejects ownership with fewer than four existing bill IDs", () => {
    expect(() =>
      validateStage3CMatrixResources(validMatrix(), {
        flatA: U("9999"),
        existingBillIds: [U("aaa1"), U("aaa2"), U("aaa3")] as unknown as [
          string,
          string,
          string,
          string,
        ],
      }),
    ).toThrow(/ownership|four/i);
  });
  it("rejects ownership with duplicate existingBillIds", () => {
    expect(() =>
      validateStage3CMatrixResources(validMatrix(), {
        flatA: U("9999"),
        existingBillIds: [U("aaa1"), U("aaa1"), U("aaa2"), U("aaa3")],
      }),
    ).toThrow(/ownership|unique/i);
  });
  it("rejects non-object input", () => {
    expect(() => validateStage3CMatrixResources(null, baseOwnership())).toThrow(/plain object/);
    expect(() => validateStage3CMatrixResources("x", baseOwnership())).toThrow(/plain object/);
    expect(() => validateStage3CMatrixResources([], baseOwnership())).toThrow(/plain object/);
  });
});

describe("Stage 3C foundation — matrix context initialization", () => {
  it("preserves core context fields", () => {
    const ctx = createStage3CLiveMatrixContext();
    expect(ctx.fixture).toBeNull();
    expect(ctx.billId).toBeNull();
    expect(ctx.baselineSummary).toBeNull();
  });
  it("initializes every new lifecycle field to null", () => {
    const ctx = createStage3CLiveMatrixContext();
    for (const key of [
      "residentBillId",
      "residentBaselineSummary",
      "residentPostSubmitSummary",
      "residentPaymentId",
      "residentAmount",
      "residentReference",
      "residentIdempotencyKey",
      "idempotencyBillAId",
      "idempotencyBillBId",
      "idempotencyKey",
      "idempotencyAmount",
      "idempotencyOriginalPaymentId",
      "idempotencyBaselinePaymentCount",
      "idempotencyBaselineSummary",
      "idempotencyPostSummary",
      "referenceBillId",
      "canonicalReference",
      "referenceOriginalPaymentId",
      "referenceBaselinePaymentCount",
      "referencePostOriginalSummary",
    ] as const) {
      expect(ctx[key]).toBeNull();
    }
  });
});

describe("Stage 3C foundation — matrix context guards", () => {
  const ctx = createStage3CLiveMatrixContext();
  it("every guard throws before initialization", () => {
    expect(() => requireMatrixFixture(ctx)).toThrow(/fixture/);
    expect(() => requireResidentBillId(ctx)).toThrow(/residentBillId/);
    expect(() => requireResidentPaymentId(ctx)).toThrow(/residentPaymentId/);
    expect(() => requireResidentAmount(ctx)).toThrow(/residentAmount/);
    expect(() => requireResidentReference(ctx)).toThrow(/residentReference/);
    expect(() => requireResidentIdempotencyKey(ctx)).toThrow(/residentIdempotencyKey/);
    expect(() => requireResidentBaselineSummary(ctx)).toThrow(/residentBaselineSummary/);
    expect(() => requireResidentPostSubmitSummary(ctx)).toThrow(/residentPostSubmitSummary/);
    expect(() => requireIdempotencyBillAId(ctx)).toThrow(/idempotencyBillAId/);
    expect(() => requireIdempotencyBillBId(ctx)).toThrow(/idempotencyBillBId/);
    expect(() => requireIdempotencyKey(ctx)).toThrow(/idempotencyKey/);
    expect(() => requireIdempotencyAmount(ctx)).toThrow(/idempotencyAmount/);
    expect(() => requireIdempotencyOriginalPaymentId(ctx)).toThrow(
      /idempotencyOriginalPaymentId/,
    );
    expect(() => requireIdempotencyBaselinePaymentCount(ctx)).toThrow(
      /idempotencyBaselinePaymentCount/,
    );
    expect(() => requireIdempotencyBaselineSummary(ctx)).toThrow(
      /idempotencyBaselineSummary/,
    );
    expect(() => requireIdempotencyPostSummary(ctx)).toThrow(/idempotencyPostSummary/);
    expect(() => requireReferenceBillId(ctx)).toThrow(/referenceBillId/);
    expect(() => requireCanonicalReference(ctx)).toThrow(/canonicalReference/);
    expect(() => requireReferenceOriginalPaymentId(ctx)).toThrow(
      /referenceOriginalPaymentId/,
    );
    expect(() => requireReferenceBaselinePaymentCount(ctx)).toThrow(
      /referenceBaselinePaymentCount/,
    );
    expect(() => requireReferencePostOriginalSummary(ctx)).toThrow(
      /referencePostOriginalSummary/,
    );
  });
  it("returns initialized values through guards", () => {
    const c = createStage3CLiveMatrixContext();
    c.residentBillId = U("0001");
    c.residentAmount = 500;
    c.residentReference = "REF-1";
    c.residentIdempotencyKey = "idem-key";
    c.idempotencyBaselinePaymentCount = 0;
    expect(requireResidentBillId(c)).toBe(U("0001"));
    expect(requireResidentAmount(c)).toBe(500);
    expect(requireResidentReference(c)).toBe("REF-1");
    expect(requireResidentIdempotencyKey(c)).toBe("idem-key");
    expect(requireIdempotencyBaselinePaymentCount(c)).toBe(0);
  });
  it("UUID guard rejects malformed UUID", () => {
    const c = createStage3CLiveMatrixContext();
    c.residentBillId = "not-a-uuid";
    expect(() => requireResidentBillId(c)).toThrow(/UUID/);
  });
  it("amount guard rejects non-positive/NaN/Infinity", () => {
    const c = createStage3CLiveMatrixContext();
    for (const v of [0, -1, NaN, Infinity, -Infinity]) {
      c.residentAmount = v;
      expect(() => requireResidentAmount(c)).toThrow();
    }
  });
  it("count guard rejects negative/non-integer", () => {
    const c = createStage3CLiveMatrixContext();
    for (const v of [-1, 1.5, NaN]) {
      c.idempotencyBaselinePaymentCount = v;
      expect(() => requireIdempotencyBaselinePaymentCount(c)).toThrow();
    }
  });
  it("blank string guard rejects whitespace", () => {
    const c = createStage3CLiveMatrixContext();
    c.residentReference = "   ";
    expect(() => requireResidentReference(c)).toThrow(/blank|whitespace/);
  });
});

describe("Stage 3C foundation — canonical error tokens", () => {
  it("exposes exactly the four new tokens (plus existing)", () => {
    expect(STAGE3C_ERRORS.RESIDENT_CASH_NOT_ALLOWED).toBe("resident_cash_not_allowed");
    expect(STAGE3C_ERRORS.IDEMPOTENCY_CONFLICT).toBe("idempotency_conflict");
    expect(STAGE3C_ERRORS.DUPLICATE_REFERENCE).toBe("duplicate_reference");
    expect(STAGE3C_ERRORS.REFERENCE_REQUIRED).toBe("reference_required");
  });
  it("matches exact tokens and rejects partial variants", () => {
    expect(matchesCanonicalError("ERROR: duplicate_reference", "duplicate_reference")).toBe(true);
    expect(matchesCanonicalError("ERROR: duplicate_reference_extra", "duplicate_reference")).toBe(
      false,
    );
    expect(
      matchesCanonicalError("ERROR: idempotency_conflict_old", "idempotency_conflict"),
    ).toBe(false);
    expect(
      matchesCanonicalError("ERROR: resident_cash_not_allowed_admin", "resident_cash_not_allowed"),
    ).toBe(false);
    expect(matchesCanonicalError("ERROR: not_authorized_admin", "not_authorized")).toBe(false);
  });
  it("does not confuse unauthenticated and not_authenticated", () => {
    expect(matchesCanonicalError("unauthenticated", "not_authenticated")).toBe(false);
    expect(matchesCanonicalError("not_authenticated", "unauthenticated")).toBe(false);
    expect(matchesCanonicalError("unauthenticated", "unauthenticated")).toBe(true);
    expect(matchesCanonicalError("not_authenticated", "not_authenticated")).toBe(true);
  });
  it("redacts JWT-shaped strings in assertion failures", () => {
    const jwt = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJmb28iOiJiYXIifQ.abcdef123456";
    try {
      assertCanonicalError({ message: `boom ${jwt}` }, "duplicate_reference", "test");
    } catch (e) {
      const msg = (e as Error).message;
      expect(msg).not.toContain(jwt);
      expect(msg).toContain("[REDACTED_JWT]");
      return;
    }
    throw new Error("should have thrown");
  });
});

describe("Stage 3C foundation — resident submission contract", () => {
  const base = {
    billId: U("0001"),
    amount: 100,
    referenceNo: "REF-1",
    idempotencyKey: "idem-key",
  };
  it("accepts a valid resident payload", () => {
    expect(residentSubmitInputSchema.safeParse(base).success).toBe(true);
  });
  it("rejects unknown fields", () => {
    expect(residentSubmitInputSchema.safeParse({ ...base, extra: 1 }).success).toBe(false);
  });
  it("rejects public method / actorRole / proofUrl fields", () => {
    for (const key of ["method", "actorRole", "proofUrl"]) {
      expect(
        residentSubmitInputSchema.safeParse({ ...base, [key]: "x" }).success,
      ).toBe(false);
    }
  });
  it("requires idempotencyKey", () => {
    const { idempotencyKey: _drop, ...rest } = base;
    void _drop;
    expect(residentSubmitInputSchema.safeParse(rest).success).toBe(false);
  });
  it("rejects empty reference and blank idempotency key", () => {
    expect(residentSubmitInputSchema.safeParse({ ...base, referenceNo: "" }).success).toBe(false);
    expect(
      residentSubmitInputSchema.safeParse({ ...base, idempotencyKey: "     " }).success,
    ).toBe(false);
  });
  it("rejects malformed date and UUID", () => {
    expect(
      residentSubmitInputSchema.safeParse({ ...base, paymentDate: "bad-date" }).success,
    ).toBe(false);
    expect(
      residentSubmitInputSchema.safeParse({ ...base, billId: "not-uuid" }).success,
    ).toBe(false);
  });
  it("rejects non-positive, NaN, Infinity amount", () => {
    for (const v of [0, -1, NaN, Infinity, -Infinity]) {
      expect(residentSubmitInputSchema.safeParse({ ...base, amount: v }).success).toBe(false);
    }
  });
});

describe("Stage 3C foundation — production integration", () => {
  const prodSrc = readFileSync(
    join(process.cwd(), "src/lib/offline-payments.functions.ts"),
    "utf8",
  );
  it("imports the shared resident schema from the contracts module", () => {
    expect(prodSrc).toMatch(/from\s+["']\.\/offline-payment-contracts["']/);
    expect(prodSrc).toContain("residentSubmitInputSchema");
  });
  it("no longer contains an inline resident schema declaration", () => {
    // Inline duplicate would redeclare positive().max(10_000_000).
    expect(prodSrc).not.toMatch(
      /const residentSubmitInput\s*=\s*z\.object\(\{[\s\S]{0,400}amount:\s*z\.number\(\)\.positive/,
    );
  });
  it("pins bank_transfer + resident on submitResidentBankTransfer", () => {
    expect(prodSrc).toMatch(/submitResidentBankTransfer[\s\S]{0,800}_method:\s*"bank_transfer"/);
    expect(prodSrc).toMatch(/submitResidentBankTransfer[\s\S]{0,800}_actor_role:\s*"resident"/);
  });
});

describe("Stage 3C foundation — fixture source shape", () => {
  const src = readFileSync(
    join(process.cwd(), "tests/helpers/stage3c-runtime-fixtures.ts"),
    "utf8",
  );
  it("exports Stage3CMatrixResources on the fixture", () => {
    expect(src).toContain("export type Stage3CMatrixResources");
    expect(src).toMatch(/matrix:\s*Stage3CMatrixResources/);
  });
  it("creates otherFlatA in Society A + blockA with tracking", () => {
    expect(src).toMatch(
      /insert:otherFlatA[\s\S]{0,400}society_id:\s*societyA[\s\S]{0,200}block_id:\s*blockA/,
    );
    expect(src).toMatch(/trackUniqueId\(tracked\.flatIds,\s*otherFlatARow\.id,\s*"otherFlatA"\)/);
  });
  it("declares exactly five dedicated bill identifiers", () => {
    for (const name of [
      "residentSubmitBillId",
      "otherFlatBillId",
      "idempotencyBillAId",
      "idempotencyBillBId",
      "referenceBillId",
    ]) {
      expect(src).toMatch(new RegExp(`const ${name} = await addBill\\(`));
    }
  });
  it("uses the canonical addBill helper with an object input", () => {
    expect(src).toMatch(/addBill\(\{ label: "open1"/);
    expect(src).toMatch(/flatId: otherFlatA/);
  });
  it("verifies matrix bills start clean", () => {
    expect(src).toContain("assertMatrixBillsStartClean(admin, matrix)");
  });
  it("no new payment is created for a dedicated bill in the fixture body", () => {
    // The dedicated matrix bills must not be submitted against during
    // foundation setup. Rough check: no `helpers.submit*` call whose
    // billId argument is one of the matrix bill identifiers.
    const risky = [
      /billId:\s*residentSubmitBillId/,
      /billId:\s*otherFlatBillId/,
      /billId:\s*idempotencyBillAId/,
      /billId:\s*idempotencyBillBId/,
      /billId:\s*referenceBillId/,
    ];
    for (const r of risky) expect(src).not.toMatch(r);
  });
});
