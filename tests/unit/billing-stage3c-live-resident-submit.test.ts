/**
 * Stage 3C — RESIDENT-SUBMIT-01..08 pure/behavioral contract tests.
 *
 * Uses real exported symbols where possible; source-regex checks are
 * backstops for shape invariants that cannot be observed at runtime.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  STAGE3C_RESIDENT_SUBMIT_HANDLERS,
  STAGE3C_RESIDENT_SUBMIT_CASE_IDS,
  RESIDENT_SUBMIT_AMOUNT,
  type Stage3CResidentSubmitCaseId,
} from "../helpers/stage3c-live-resident-submit-cases";
import {
  STAGE3C_MATRIX_LIVE_HANDLERS,
  STAGE3C_MATRIX_LIVE_CASE_IDS,
} from "../helpers/stage3c-live-matrix-registry";
import { STAGE3C_CORE_LIVE_CASE_IDS } from "../helpers/stage3c-live-core-registry";
import {
  createStage3CLiveMatrixContext,
  requireResidentSubmitPaymentId,
  requireResidentSubmitAmount,
  requireResidentSubmitReference,
  requireResidentSubmitIdempotencyKey,
  requireResidentSubmitInitialSummary,
  requireResidentSubmitPendingSummary,
  type Stage3CLiveMatrixContext,
} from "../helpers/stage3c-live-matrix-context";
import { residentSubmitInputSchema } from "@/lib/offline-payment-contracts";

const residentSrc = readFileSync(
  resolve(process.cwd(), "tests/helpers/stage3c-live-resident-submit-cases.ts"),
  "utf8",
);
const matrixRegistrySrc = readFileSync(
  resolve(process.cwd(), "tests/helpers/stage3c-live-matrix-registry.ts"),
  "utf8",
);

const VALID_BILL = "11111111-1111-4111-8111-111111111111";
const validInput = {
  billId: VALID_BILL,
  amount: 300,
  paymentDate: "2026-06-15",
  referenceNo: "RS-abc",
  idempotencyKey: "resident-submit-abc-123",
} as const;

describe("Stage 3C — RESIDENT-SUBMIT registry", () => {
  it("exposes exactly eight resident IDs in canonical order", () => {
    expect(STAGE3C_RESIDENT_SUBMIT_CASE_IDS.length).toBe(8);
    expect([...STAGE3C_RESIDENT_SUBMIT_CASE_IDS]).toEqual([
      "RESIDENT-SUBMIT-01",
      "RESIDENT-SUBMIT-02",
      "RESIDENT-SUBMIT-03",
      "RESIDENT-SUBMIT-04",
      "RESIDENT-SUBMIT-05",
      "RESIDENT-SUBMIT-06",
      "RESIDENT-SUBMIT-07",
      "RESIDENT-SUBMIT-08",
    ]);
  });

  it("registers exactly eight handlers with true Record completeness", () => {
    const keys = Object.keys(STAGE3C_RESIDENT_SUBMIT_HANDLERS);
    expect(keys.length).toBe(8);
    for (const id of STAGE3C_RESIDENT_SUBMIT_CASE_IDS) {
      const fn = STAGE3C_RESIDENT_SUBMIT_HANDLERS[id as Stage3CResidentSubmitCaseId];
      expect(typeof fn, `${id} handler`).toBe("function");
    }
  });

  it("core registry remains at 24, matrix registry is 32", () => {
    expect(STAGE3C_CORE_LIVE_CASE_IDS.length).toBe(24);
    expect(STAGE3C_MATRIX_LIVE_CASE_IDS.length).toBe(32);
    expect(Object.keys(STAGE3C_MATRIX_LIVE_HANDLERS).length).toBe(32);
  });

  it("matrix registry does not register later categories (IDEMPOTENCY/REFERENCE/…)", () => {
    for (const id of STAGE3C_MATRIX_LIVE_CASE_IDS) {
      expect(id.startsWith("IDEMPOTENCY")).toBe(false);
      expect(id.startsWith("REFERENCE")).toBe(false);
      expect(id.startsWith("READ")).toBe(false);
      expect(id.startsWith("REJECTION")).toBe(false);
      expect(id.startsWith("REVERSAL")).toBe(false);
      expect(id.startsWith("SEARCH")).toBe(false);
      expect(id.startsWith("CLEANUP")).toBe(false);
    }
  });
});

describe("Stage 3C — RESIDENT-SUBMIT matrix context", () => {
  const ctx: Stage3CLiveMatrixContext = createStage3CLiveMatrixContext();

  it("initializes every resident-submit field to null", () => {
    expect(ctx.residentSubmitPaymentId).toBeNull();
    expect(ctx.residentSubmitAmount).toBeNull();
    expect(ctx.residentSubmitReference).toBeNull();
    expect(ctx.residentSubmitIdempotencyKey).toBeNull();
    expect(ctx.residentSubmitInitialSummary).toBeNull();
    expect(ctx.residentSubmitPendingSummary).toBeNull();
  });

  it("guards throw labeled errors when their field is uninitialised", () => {
    const c = createStage3CLiveMatrixContext();
    expect(() => requireResidentSubmitPaymentId(c)).toThrow(/residentSubmitPaymentId/);
    expect(() => requireResidentSubmitAmount(c)).toThrow(/residentSubmitAmount/);
    expect(() => requireResidentSubmitReference(c)).toThrow(/residentSubmitReference/);
    expect(() => requireResidentSubmitIdempotencyKey(c)).toThrow(
      /residentSubmitIdempotencyKey/,
    );
    expect(() => requireResidentSubmitInitialSummary(c)).toThrow(
      /residentSubmitInitialSummary/,
    );
    expect(() => requireResidentSubmitPendingSummary(c)).toThrow(
      /residentSubmitPendingSummary/,
    );
  });

  it("guards accept well-formed values", () => {
    const c = createStage3CLiveMatrixContext();
    c.residentSubmitPaymentId = "22222222-2222-4222-8222-222222222222";
    c.residentSubmitAmount = 300;
    c.residentSubmitReference = "RS-abc";
    c.residentSubmitIdempotencyKey = "resident-submit-abc-123";
    c.residentSubmitInitialSummary = {
      pending_amount: 0,
      verified_amount: 0,
      available_to_submit: 1200,
      total_payable: 1200,
    };
    c.residentSubmitPendingSummary = {
      pending_amount: 300,
      verified_amount: 0,
      available_to_submit: 900,
      total_payable: 1200,
    };
    expect(requireResidentSubmitPaymentId(c)).toMatch(/^[0-9a-f-]{36}$/);
    expect(requireResidentSubmitAmount(c)).toBe(300);
    expect(requireResidentSubmitReference(c)).toBe("RS-abc");
    expect(requireResidentSubmitIdempotencyKey(c)).toBe("resident-submit-abc-123");
    expect(requireResidentSubmitInitialSummary(c).total_payable).toBe(1200);
    expect(requireResidentSubmitPendingSummary(c).pending_amount).toBe(300);
  });
});

describe("Stage 3C — RESIDENT-SUBMIT input contract", () => {
  it("canonical amount is 300", () => {
    expect(RESIDENT_SUBMIT_AMOUNT).toBe(300);
  });

  it("reference is bounded and different from idempotency key", () => {
    expect(validInput.referenceNo.length).toBeLessThanOrEqual(120);
    expect(validInput.idempotencyKey.length).toBeLessThanOrEqual(120);
    expect(validInput.idempotencyKey.length).toBeGreaterThanOrEqual(6);
    expect(validInput.referenceNo).not.toBe(validInput.idempotencyKey);
  });

  it("public schema accepts canonical resident input", () => {
    expect(() => residentSubmitInputSchema.parse(validInput)).not.toThrow();
  });

  for (const forbidden of ["method", "actorRole", "proofUrl", "status", "societyId", "submittedBy"]) {
    it(`public schema rejects forbidden field "${forbidden}"`, () => {
      const attempt = { ...validInput, [forbidden]: "cash" } as unknown;
      const res = residentSubmitInputSchema.safeParse(attempt);
      expect(res.success).toBe(false);
    });
  }
});

describe("Stage 3C — RESIDENT-SUBMIT handler source shape", () => {
  it("submits via activeResident authenticated client (production mirror)", () => {
    expect(residentSrc).toMatch(/fixture\.helpers\.submitResidentBankTransferPayment/);
    expect(residentSrc).toMatch(/fixture\.users\.activeResident/);
    expect(residentSrc).not.toMatch(/fixture\.users\.adminA1\.client\.rpc\(\s*["']submit_offline_payment/);
    expect(residentSrc).not.toMatch(/fixture\.admin\.rpc\(\s*["']submit_offline_payment/);
  });

  it("asserts server-pinned bank_transfer and pending status", () => {
    expect(residentSrc).toMatch(/server-pinned bank_transfer/);
    expect(residentSrc).toMatch(/RESIDENT-SUBMIT-03: pending/);
  });

  it("asserts no receipt for pending submission", () => {
    expect(residentSrc).toMatch(/no receipt for pending payment/);
    expect(residentSrc).toMatch(/no receipt exists/);
  });

  it("uses canonical RESIDENT_CASH_NOT_ALLOWED token", () => {
    expect(residentSrc).toMatch(/STAGE3C_ERRORS\.RESIDENT_CASH_NOT_ALLOWED/);
  });

  it("uses NOT_AUTHORIZED for other-flat, moved-out, cross-society denials", () => {
    // Only one common denial helper, referenced by three cases.
    expect(residentSrc).toMatch(/STAGE3C_ERRORS\.NOT_AUTHORIZED/);
    expect(residentSrc).toMatch(/RESIDENT-SUBMIT-05/);
    expect(residentSrc).toMatch(/RESIDENT-SUBMIT-06/);
    expect(residentSrc).toMatch(/RESIDENT-SUBMIT-07/);
  });

  it("asserts exact final summary delta (pending +300, available -300)", () => {
    expect(residentSrc).toMatch(/pending delta = \+amount/);
    expect(residentSrc).toMatch(/available delta = amount/);
    expect(residentSrc).toMatch(/\b900\b/);
    expect(residentSrc).toMatch(/\b1200\b/);
  });

  it("uses safe error redaction via assertCanonicalError only", () => {
    expect(residentSrc).toMatch(/assertCanonicalError/);
    expect(residentSrc).not.toMatch(/\$\{\s*err\.message\s*\}/);
    expect(residentSrc).not.toMatch(/\bconsole\.error\(\s*err\s*\)/);
  });

  it("matrix registry uses satisfies Record (no cast, no missing keys)", () => {
    expect(matrixRegistrySrc).toMatch(
      /satisfies Record<\s*Stage3CMatrixLiveCaseId\s*,\s*Stage3CMatrixLiveHandler\s*>/,
    );
    expect(matrixRegistrySrc).not.toMatch(/as Record<\s*Stage3CMatrixLiveCaseId/);
  });

  it("no false success state (no expect(true)) and no TODO", () => {
    expect(residentSrc).not.toMatch(/expect\(\s*true\s*\)/);
    expect(residentSrc).not.toMatch(/\bTODO\b/);
  });

  it("does not interpolate raw RPC data into error messages", () => {
    expect(residentSrc).not.toMatch(/\$\{\s*String\(\s*data/);
  });

  it("asserts server-pinned source column (actor_role proof)", () => {
    expect(residentSrc).toMatch(/ResidentSubmittedPaymentRowSchema/);
    expect(residentSrc).toMatch(/resident_submission/);
    expect(residentSrc).toMatch(/deriveActorRoleFromSource/);
  });

  it("snapshots receipt sequences and asserts they remain unchanged", () => {
    expect(residentSrc).toMatch(/snapshotReceiptSequences/);
    expect(residentSrc).toMatch(/assertReceiptSequencesUnchanged/);
    expect(residentSrc).toMatch(/payment_receipt_sequences/);
    expect(residentSrc).toMatch(/payment_receipt_month_sequences/);
  });

  it("routes redaction through safeStage3CErrorMessage", () => {
    expect(residentSrc).toMatch(/safeStage3CErrorMessage/);
  });
});

