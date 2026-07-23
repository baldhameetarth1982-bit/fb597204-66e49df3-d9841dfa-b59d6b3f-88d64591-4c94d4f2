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
import {
  ResidentSubmitPaymentIdSchema,
  parseResidentSubmitPaymentId,
  submitResidentBankTransferWithClient,
  type ResidentSubmitRpcClient,
} from "@/lib/offline-payment-resident-submit";

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
    expect(residentSrc).toMatch(/assertNoReceiptForResidentPayment/);
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
    expect(residentSrc).toMatch(/assertReceiptSequencesExactlyEqual/);
    const contractsSrc = readFileSync(
      resolve(process.cwd(), "tests/helpers/stage3c-live-resident-submit-contracts.ts"),
      "utf8",
    );
    expect(contractsSrc).toMatch(/payment_receipt_sequences/);
    expect(contractsSrc).toMatch(/payment_receipt_month_sequences/);
  });

  it("routes redaction through safeStage3CErrorMessage", () => {
    expect(residentSrc).toMatch(/safeStage3CErrorMessage/);
  });
});

// ---------------------------------------------------------------------------
// Direct behavioral tests for the shared production core.
// ---------------------------------------------------------------------------

const CANON_ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

function makeClient(
  impl: (name: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>,
): { client: ResidentSubmitRpcClient; calls: Array<{ name: string; args: Record<string, unknown> }> } {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const client: ResidentSubmitRpcClient = {
    rpc: async (name, args) => {
      calls.push({ name, args });
      return impl(name, args);
    },
  };
  return { client, calls };
}

const baseInput = {
  billId: "11111111-2222-4333-8444-555555555555",
  amount: 300,
  paymentDate: "2026-06-15",
  referenceNo: "RS-abc",
  notes: "hi",
  idempotencyKey: "resident-submit-abc-123",
} as const;

describe("Stage 3C — shared core: RPC construction and pinning", () => {
  it("calls submit_offline_payment exactly once with pinned method/actor and forwarded fields", async () => {
    const { client, calls } = makeClient(async () => ({ data: CANON_ID, error: null }));
    const id = await submitResidentBankTransferWithClient(client, baseInput);
    expect(id).toBe(CANON_ID);
    expect(calls.length).toBe(1);
    expect(calls[0]!.name).toBe("submit_offline_payment");
    expect(calls[0]!.args).toEqual({
      _bill_id: baseInput.billId,
      _method: "bank_transfer",
      _amount: 300,
      _payment_date: "2026-06-15",
      _reference_no: "RS-abc",
      _notes: "hi",
      _idempotency_key: baseInput.idempotencyKey,
      _actor_role: "resident",
    });
  });

  it("returns a plain string (no wrapper object, no `raw`)", async () => {
    const { client } = makeClient(async () => ({ data: CANON_ID, error: null }));
    const result = await submitResidentBankTransferWithClient(client, baseInput);
    expect(typeof result).toBe("string");
    expect(result).toBe(CANON_ID);
    // Type-level: the value has no `.paymentId` / `.raw` since it is a string.
    expect((result as unknown as { raw?: unknown }).raw).toBeUndefined();
    expect((result as unknown as { paymentId?: unknown }).paymentId).toBeUndefined();
  });

  it("defaults paymentDate and notes to null when omitted", async () => {
    const { client, calls } = makeClient(async () => ({ data: CANON_ID, error: null }));
    await submitResidentBankTransferWithClient(client, {
      billId: baseInput.billId,
      amount: 300,
      referenceNo: "RS-abc",
      idempotencyKey: baseInput.idempotencyKey,
    });
    expect(calls[0]!.args._payment_date).toBeNull();
    expect(calls[0]!.args._notes).toBeNull();
  });
});

describe("Stage 3C — shared core: input boundary", () => {
  for (const forbidden of ["method", "actorRole", "proofUrl", "status", "societyId", "submittedBy", "verifiedAmount", "receiptNumber"] as const) {
    it(`rejects forbidden field "${forbidden}" BEFORE any RPC call`, async () => {
      const { client, calls } = makeClient(async () => ({ data: CANON_ID, error: null }));
      const bad = { ...baseInput, [forbidden]: "x" } as unknown as typeof baseInput;
      await expect(submitResidentBankTransferWithClient(client, bad)).rejects.toThrow();
      expect(calls.length).toBe(0);
    });
  }

  it("rejects malformed billId before any RPC call", async () => {
    const { client, calls } = makeClient(async () => ({ data: CANON_ID, error: null }));
    await expect(
      submitResidentBankTransferWithClient(client, { ...baseInput, billId: "not-a-uuid" }),
    ).rejects.toThrow();
    expect(calls.length).toBe(0);
  });
});

describe("Stage 3C — shared core: canonical payment ID schema", () => {
  it("accepts canonical lowercase UUID", () => {
    expect(ResidentSubmitPaymentIdSchema.safeParse(CANON_ID).success).toBe(true);
    expect(parseResidentSubmitPaymentId(CANON_ID)).toBe(CANON_ID);
  });

  it("rejects uppercase UUID", () => {
    const upper = CANON_ID.toUpperCase();
    expect(ResidentSubmitPaymentIdSchema.safeParse(upper).success).toBe(false);
    expect(() => parseResidentSubmitPaymentId(upper)).toThrow("operation_failed");
  });

  it("rejects malformed UUID", () => {
    expect(() => parseResidentSubmitPaymentId("not-a-uuid")).toThrow("operation_failed");
  });

  it("rejects blank string", () => {
    expect(() => parseResidentSubmitPaymentId("")).toThrow("operation_failed");
  });

  it("rejects whitespace-wrapped UUID", () => {
    expect(() => parseResidentSubmitPaymentId(` ${CANON_ID} `)).toThrow("operation_failed");
    expect(() => parseResidentSubmitPaymentId(`${CANON_ID}\n`)).toThrow("operation_failed");
  });

  it("rejects null", () => {
    expect(() => parseResidentSubmitPaymentId(null)).toThrow("operation_failed");
  });

  it("rejects undefined", () => {
    expect(() => parseResidentSubmitPaymentId(undefined)).toThrow("operation_failed");
  });

  it("rejects array", () => {
    expect(() => parseResidentSubmitPaymentId([CANON_ID])).toThrow("operation_failed");
  });

  it("rejects number", () => {
    expect(() => parseResidentSubmitPaymentId(42)).toThrow("operation_failed");
  });

  it("rejects undocumented object shape", () => {
    expect(() => parseResidentSubmitPaymentId({ id: CANON_ID })).toThrow("operation_failed");
    expect(() => parseResidentSubmitPaymentId({ paymentId: CANON_ID })).toThrow("operation_failed");
    expect(() => parseResidentSubmitPaymentId({})).toThrow("operation_failed");
  });

  it("does not include the invalid value in the error message", () => {
    try {
      parseResidentSubmitPaymentId("SECRET-VALUE-NOT-ALLOWED");
      throw new Error("expected throw");
    } catch (e) {
      expect((e as Error).message).toBe("operation_failed");
      expect((e as Error).message).not.toMatch(/SECRET/);
    }
  });
});

describe("Stage 3C — shared core: RPC result handling", () => {
  it("accepts canonical UUID scalar result", async () => {
    const { client } = makeClient(async () => ({ data: CANON_ID, error: null }));
    const id = await submitResidentBankTransferWithClient(client, baseInput);
    expect(id).toBe(CANON_ID);
  });

  it("rejects uppercase UUID result via operation_failed", async () => {
    const { client } = makeClient(async () => ({ data: CANON_ID.toUpperCase(), error: null }));
    await expect(submitResidentBankTransferWithClient(client, baseInput)).rejects.toThrow(
      "operation_failed",
    );
  });

  it("rejects null RPC result", async () => {
    const { client } = makeClient(async () => ({ data: null, error: null }));
    await expect(submitResidentBankTransferWithClient(client, baseInput)).rejects.toThrow(
      "operation_failed",
    );
  });

  it("rejects undefined RPC result", async () => {
    const { client } = makeClient(async () => ({ data: undefined, error: null }));
    await expect(submitResidentBankTransferWithClient(client, baseInput)).rejects.toThrow(
      "operation_failed",
    );
  });

  it("rejects object RPC result", async () => {
    const { client } = makeClient(async () => ({ data: { id: CANON_ID }, error: null }));
    await expect(submitResidentBankTransferWithClient(client, baseInput)).rejects.toThrow(
      "operation_failed",
    );
  });
});

describe("Stage 3C — shared core: provider error propagation", () => {
  it("re-throws the provider error object by identity", async () => {
    const providerErr = { code: "23514", message: "boom", details: "d" };
    const { client } = makeClient(async () => ({ data: null, error: providerErr }));
    let caught: unknown = null;
    try {
      await submitResidentBankTransferWithClient(client, baseInput);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBe(providerErr);
    // Not wrapped in a new Error, so the .code / .details survive.
    expect((caught as { code?: string }).code).toBe("23514");
    expect((caught as { details?: string }).details).toBe("d");
  });

  it("does not copy the provider message into a new Error", async () => {
    const providerErr = new Error("provider-only-message");
    const { client } = makeClient(async () => ({ data: null, error: providerErr }));
    let caught: unknown = null;
    try {
      await submitResidentBankTransferWithClient(client, baseInput);
    } catch (e) {
      caught = e;
    }
    // Same object identity — not a wrapper `new Error(error.message)`.
    expect(caught).toBe(providerErr);
  });
});

describe("Stage 3C — shared core: delegation ownership (source proof)", () => {
  it("production server function imports and calls the shared core", () => {
    const prod = readFileSync(resolve(process.cwd(), "src/lib/offline-payments.functions.ts"), "utf8");
    expect(prod).toMatch(/from ["']\.\/offline-payment-resident-submit["']/);
    expect(prod).toMatch(/submitResidentBankTransferWithClient\s*\(/);
  });

  it("fixture helper imports and calls the shared core", () => {
    const fx = readFileSync(resolve(process.cwd(), "tests/helpers/stage3c-runtime-fixtures.ts"), "utf8");
    expect(fx).toMatch(/from ["']@\/lib\/offline-payment-resident-submit["']/);
    expect(fx).toMatch(/submitResidentBankTransferWithClient\s*\(/);
  });

  it("exactly one owner of the pinned bank_transfer + resident RPC arguments", () => {
    const prod = readFileSync(resolve(process.cwd(), "src/lib/offline-payments.functions.ts"), "utf8");
    const core = readFileSync(resolve(process.cwd(), "src/lib/offline-payment-resident-submit.ts"), "utf8");
    const fx = readFileSync(resolve(process.cwd(), "tests/helpers/stage3c-runtime-fixtures.ts"), "utf8");
    // The shared core is the sole location where BOTH pins appear together
    // for a resident bank-transfer submission.
    const pinnedTogether = (src: string) =>
      /_method:\s*["']bank_transfer["']/.test(src) &&
      /_actor_role:\s*["']resident["']/.test(src);
    expect(pinnedTogether(core)).toBe(true);
    expect(pinnedTogether(prod)).toBe(false);
    expect(pinnedTogether(fx)).toBe(false);
  });
});


