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

  it("core registry remains at 24, matrix registry is 50", () => {
    expect(STAGE3C_CORE_LIVE_CASE_IDS.length).toBe(24);
    expect(STAGE3C_MATRIX_LIVE_CASE_IDS.length).toBe(50);
    expect(Object.keys(STAGE3C_MATRIX_LIVE_HANDLERS).length).toBe(50);
  });


  it("matrix registry does not register uninmplemented later categories (REJECTION/REVERSAL/SEARCH/CLEANUP)", () => {
    for (const id of STAGE3C_MATRIX_LIVE_CASE_IDS) {
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

  it("asserts exact final summary delta via assertResidentPendingDelta helper", () => {
    expect(residentSrc).toMatch(/assertResidentPendingDelta\(\s*initial\s*,\s*finalSummary\s*,\s*amount/);
    expect(residentSrc).toMatch(/requireResidentSubmitInitialReceiptSequences/);
    expect(residentSrc).not.toMatch(/as ReceiptSequenceSnapshot/);
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

// ---------------------------------------------------------------------------
// Direct reader/state behavioral tests — real exported schemas & functions.
// ---------------------------------------------------------------------------
import {
  ReceiptSequenceSnapshotSchema,
  snapshotReceiptSequences,
  assertReceiptSequencesExactlyEqual,
  ResidentReceiptRowsSchema,
  ResidentBillSummarySchema,
  assertResidentBillStateUnchanged,
  assertCanonicalMovedOutRelationship,
  parseResidentPaymentStatusRows,
  type ReceiptSequenceReader,
  type ResidentBillStateSnapshot,
} from "../helpers/stage3c-live-resident-submit-contracts";
import { requireResidentSubmitInitialReceiptSequences } from "../helpers/stage3c-live-matrix-context";

const SOC_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SOC_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const BILL_A = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const PAY_A = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const PAY_B = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const REC_A = "abababab-cdcd-4efe-8faf-babababababa";
const USER_A = "22222222-3333-4444-8555-666666666666";
const FLAT_A = "33333333-4444-4555-8666-777777777777";

function makeReader(
  byTable: Record<string, { data: unknown; error: unknown }>,
): ReceiptSequenceReader {
  return {
    from: (table: string) => ({
      select: (_columns: string) => ({
        eq: async (_column: string, _value: string) => {
          const r = byTable[table];
          if (!r) return { data: [], error: null };
          return r;
        },
      }),
    }),
  };
}

const goodSummary = {
  bill_id: BILL_A,
  society_id: SOC_A,
  total_payable: 1200,
  verified_amount: 0,
  pending_amount: 0,
  rejected_amount: 0,
  reversed_amount: 0,
  available_to_submit: 1200,
  remaining_verified_balance: 1200,
  cancelled: false,
  status: "unpaid" as const,
};

describe("Stage 3C — direct reader/state behavioral coverage", () => {
  it("ReceiptSequenceSnapshotSchema rejects missing yearly array", () => {
    const res = ReceiptSequenceSnapshotSchema.safeParse({ monthly: [] });
    expect(res.success).toBe(false);
  });

  it("ReceiptSequenceSnapshotSchema rejects missing monthly array", () => {
    const res = ReceiptSequenceSnapshotSchema.safeParse({ yearly: [] });
    expect(res.success).toBe(false);
  });

  it("snapshotReceiptSequences rejects yearly data belonging to another society", async () => {
    const reader = makeReader({
      payment_receipt_sequences: {
        data: [{ society_id: SOC_B, year: 2026, next_number: 0 }],
        error: null,
      },
      payment_receipt_month_sequences: { data: [], error: null },
    });
    await expect(snapshotReceiptSequences(reader, SOC_A, "T")).rejects.toThrow(
      /wrong society scope/,
    );
  });

  it("snapshotReceiptSequences rejects monthly data belonging to another society", async () => {
    const reader = makeReader({
      payment_receipt_sequences: { data: [], error: null },
      payment_receipt_month_sequences: {
        data: [{ society_id: SOC_B, year_month: "2026-06", next_number: 0 }],
        error: null,
      },
    });
    await expect(snapshotReceiptSequences(reader, SOC_A, "T")).rejects.toThrow(
      /wrong society scope/,
    );
  });

  it("assertReceiptSequencesExactlyEqual rejects changed yearly key (and message excludes UUID + key)", () => {
    const before = ReceiptSequenceSnapshotSchema.parse({
      yearly: [{ society_id: SOC_A, year: 2026, next_number: 0 }],
      monthly: [],
    });
    const after = ReceiptSequenceSnapshotSchema.parse({
      yearly: [{ society_id: SOC_A, year: 2027, next_number: 0 }],
      monthly: [],
    });
    try {
      assertReceiptSequencesExactlyEqual(before, after, "T");
      throw new Error("expected throw");
    } catch (e) {
      const msg = (e as Error).message;
      expect(msg).toMatch(/yearly sequence row \d+ changed/);
      expect(msg).not.toContain(SOC_A);
      expect(msg).not.toContain("2026");
      expect(msg).not.toContain("2027");
    }
  });

  it("assertReceiptSequencesExactlyEqual rejects changed monthly key (and message excludes UUID + key)", () => {
    const before = ReceiptSequenceSnapshotSchema.parse({
      yearly: [],
      monthly: [{ society_id: SOC_A, year_month: "2026-06", next_number: 0 }],
    });
    const after = ReceiptSequenceSnapshotSchema.parse({
      yearly: [],
      monthly: [{ society_id: SOC_A, year_month: "2026-07", next_number: 0 }],
    });
    try {
      assertReceiptSequencesExactlyEqual(before, after, "T");
      throw new Error("expected throw");
    } catch (e) {
      const msg = (e as Error).message;
      expect(msg).toMatch(/monthly sequence row \d+ changed/);
      expect(msg).not.toContain(SOC_A);
      expect(msg).not.toContain("2026-06");
      expect(msg).not.toContain("2026-07");
    }
  });

  it("ResidentReceiptRowsSchema rejects an unknown extra property", () => {
    const res = ResidentReceiptRowsSchema.safeParse([
      { id: REC_A, payment_id: PAY_A, extra: "x" },
    ]);
    expect(res.success).toBe(false);
  });

  it("ResidentReceiptRowsSchema rejects duplicate receipt IDs", () => {
    const res = ResidentReceiptRowsSchema.safeParse([
      { id: REC_A, payment_id: PAY_A },
      { id: REC_A, payment_id: PAY_B },
    ]);
    expect(res.success).toBe(false);
  });

  it("ResidentReceiptRowsSchema rejects uppercase UUID", () => {
    const res = ResidentReceiptRowsSchema.safeParse([
      { id: REC_A.toUpperCase(), payment_id: PAY_A },
    ]);
    expect(res.success).toBe(false);
  });

  it("ResidentBillSummarySchema rejects missing bill_id", () => {
    const { bill_id: _b, ...rest } = goodSummary;
    expect(ResidentBillSummarySchema.safeParse(rest).success).toBe(false);
  });

  it("ResidentBillSummarySchema rejects missing society_id", () => {
    const { society_id: _s, ...rest } = goodSummary;
    expect(ResidentBillSummarySchema.safeParse(rest).success).toBe(false);
  });

  it("ResidentBillSummarySchema rejects empty numeric string", () => {
    expect(
      ResidentBillSummarySchema.safeParse({ ...goodSummary, total_payable: "" }).success,
    ).toBe(false);
  });

  it("ResidentBillSummarySchema rejects NaN numeric input", () => {
    expect(
      ResidentBillSummarySchema.safeParse({ ...goodSummary, total_payable: Number.NaN }).success,
    ).toBe(false);
  });

  it("ResidentBillSummarySchema rejects Infinity numeric input", () => {
    expect(
      ResidentBillSummarySchema.safeParse({
        ...goodSummary,
        total_payable: Number.POSITIVE_INFINITY,
      }).success,
    ).toBe(false);
  });

  it("assertResidentBillStateUnchanged rejects changed payment amount (message excludes IDs and amounts)", () => {
    const summary = ResidentBillSummarySchema.parse(goodSummary);
    const seq = ReceiptSequenceSnapshotSchema.parse({ yearly: [], monthly: [] });
    const beforeRow = fullLifecycleRow({
      id: PAY_A,
      bill_id: BILL_A,
      society_id: SOC_A,
      amount: 300,
    });
    const afterRow = { ...beforeRow, amount: 999 };
    const before: ResidentBillStateSnapshot = {
      summary,
      paymentRows: [
        beforeRow as unknown as import("../helpers/stage3c-live-resident-submit-contracts").ResidentBillPaymentLifecycleRow,
      ],
      receiptRows: [],
      sequences: seq,
    };
    const after: ResidentBillStateSnapshot = {
      summary,
      paymentRows: [
        afterRow as unknown as import("../helpers/stage3c-live-resident-submit-contracts").ResidentBillPaymentLifecycleRow,
      ],
      receiptRows: [],
      sequences: seq,
    };
    try {
      assertResidentBillStateUnchanged(before, after, "T");
      throw new Error("expected throw");
    } catch (e) {
      const msg = (e as Error).message;
      expect(msg).toMatch(/payment row \d+ field \w+ changed/);
      expect(msg).not.toContain(PAY_A);
      expect(msg).not.toContain("300");
      expect(msg).not.toContain("999");
    }
  });

  it("assertCanonicalMovedOutRelationship rejects an active row even when a historical row exists (message excludes user + flat IDs)", () => {
    const rows = [
      { id: REC_A, user_id: USER_A, flat_id: FLAT_A, is_active: true, moved_out_at: null },
      {
        id: PAY_A,
        user_id: USER_A,
        flat_id: FLAT_A,
        is_active: false,
        moved_out_at: "2026-01-01T00:00:00Z",
      },
    ];
    try {
      assertCanonicalMovedOutRelationship(
        rows,
        { expectedUserId: USER_A, expectedFlatId: FLAT_A },
        "T",
      );
      throw new Error("expected throw");
    } catch (e) {
      const msg = (e as Error).message;
      expect(msg).toMatch(/still has active residency/);
      expect(msg).not.toContain(USER_A);
      expect(msg).not.toContain(FLAT_A);
    }
  });

  it("requireResidentSubmitInitialReceiptSequences parses and sorts the snapshot (transforms into a new array)", () => {
    // Build an unsorted raw snapshot; the schema's transform returns a
    // deterministically sorted new array.
    const rawUnsorted = {
      yearly: [
        { society_id: SOC_B, year: 2026, next_number: 0 },
        { society_id: SOC_A, year: 2026, next_number: 0 },
      ],
      monthly: [
        { society_id: SOC_B, year_month: "2026-07", next_number: 0 },
        { society_id: SOC_A, year_month: "2026-06", next_number: 0 },
      ],
    };
    // Prove strict schema rejects duplicate-key snapshots up-front:
    expect(
      ReceiptSequenceSnapshotSchema.safeParse({
        yearly: [
          { society_id: SOC_A, year: 2026, next_number: 0 },
          { society_id: SOC_A, year: 2026, next_number: 1 },
        ],
        monthly: [],
      }).success,
    ).toBe(false);

    const ctx = createStage3CLiveMatrixContext();
    ctx.residentSubmitInitialReceiptSequences =
      rawUnsorted as unknown as import("../helpers/stage3c-live-resident-submit-contracts").ReceiptSequenceSnapshot;
    const guarded = requireResidentSubmitInitialReceiptSequences(ctx);
    // Sorted by society_id then year.
    expect(guarded.yearly.map((r) => r.society_id)).toEqual([SOC_A, SOC_B]);
    expect(guarded.monthly.map((r) => r.society_id)).toEqual([SOC_A, SOC_B]);
    // Guard result is not the same mutable array object as unsorted input.
    expect(guarded.yearly).not.toBe(rawUnsorted.yearly);
    expect(guarded.monthly).not.toBe(rawUnsorted.monthly);
  });

  it("parseResidentPaymentStatusRows rejects null", () => {
    expect(() => parseResidentPaymentStatusRows(null, "T")).toThrow(/absent/);
  });

  it("parseResidentPaymentStatusRows rejects an object", () => {
    expect(() => parseResidentPaymentStatusRows({}, "T")).toThrow(/not an array/);
  });

  it("parseResidentPaymentStatusRows rejects duplicate payment IDs", () => {
    expect(() =>
      parseResidentPaymentStatusRows(
        [
          { id: PAY_A, status: "pending", amount: 300 },
          { id: PAY_A, status: "pending", amount: 400 },
        ],
        "T",
      ),
    ).toThrow(/rejected/);
  });
});

// ---------------------------------------------------------------------------
// Full payment/receipt lifecycle schema + snapshot mutation-detection tests
// ---------------------------------------------------------------------------
import {
  ResidentBillPaymentLifecycleRowSchema,
  ResidentBillPaymentLifecycleRowsSchema,
  parseResidentBillPaymentLifecycleRows,
  ResidentBillReceiptLifecycleRowSchema,
  ResidentBillReceiptLifecycleRowsSchema,
  parseResidentBillReceiptLifecycleRows,
  RESIDENT_BILL_PAYMENT_LIFECYCLE_FIELDS,
  RESIDENT_BILL_RECEIPT_LIFECYCLE_FIELDS,
  snapshotResidentBillState,
  type ResidentBillPaymentLifecycleRow,
  type ResidentBillReceiptLifecycleRow,
  type ResidentBillStateReader,
  type ActorRpcClient,
} from "../helpers/stage3c-live-resident-submit-contracts";

const CANON_ID_1 = "11111111-2222-4333-8444-555555555555";
const CANON_ID_2 = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const CANON_BILL = "22222222-3333-4444-8555-666666666666";
const CANON_SOCIETY = "33333333-4444-4555-8666-777777777777";
const CANON_RECEIPT_1 = "44444444-5555-4666-8777-888888888888";
const CANON_RECEIPT_2 = "55555555-6666-4777-8888-999999999999";

function fullLifecycleRow(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    // Required
    id: CANON_ID_1,
    bill_id: CANON_BILL,
    society_id: CANON_SOCIETY,
    flat_id: CANON_ID_2,
    amount: 300,
    method: "bank_transfer",
    status: "pending",
    created_at: "2026-07-01T00:00:00Z",
    updated_at: "2026-07-01T00:00:00Z",
    paid_at: "2026-07-01T00:00:00Z",
    // Nullable — present as null
    user_id: null,
    submitted_by: null,
    submitted_at: null,
    source: null,
    reference_no: null,
    idempotency_key: null,
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
    ...overrides,
  };
}

function fullReceiptRow(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    // Required
    id: CANON_RECEIPT_1,
    payment_id: CANON_ID_1,
    society_id: CANON_SOCIETY,
    receipt_number: "RCPT-0001",
    status: "issued",
    issued_at: "2026-07-01T00:00:00Z",
    created_at: "2026-07-01T00:00:00Z",
    // Nullable — present as null
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
    ...overrides,
  };
}

describe("Stage 3C — payment lifecycle schema", () => {
  it("accepts a full-shape row (all required + all nullables as null)", () => {
    expect(ResidentBillPaymentLifecycleRowSchema.safeParse(fullLifecycleRow()).success).toBe(true);
  });
  it("rejects missing bill_id", () => {
    const r = fullLifecycleRow();
    delete r.bill_id;
    expect(ResidentBillPaymentLifecycleRowSchema.safeParse(r).success).toBe(false);
  });
  it("rejects missing society_id", () => {
    const r = fullLifecycleRow();
    delete r.society_id;
    expect(ResidentBillPaymentLifecycleRowSchema.safeParse(r).success).toBe(false);
  });
  it("rejects missing amount", () => {
    const r = fullLifecycleRow();
    delete r.amount;
    expect(ResidentBillPaymentLifecycleRowSchema.safeParse(r).success).toBe(false);
  });
  it("rejects missing method", () => {
    const r = fullLifecycleRow();
    delete r.method;
    expect(ResidentBillPaymentLifecycleRowSchema.safeParse(r).success).toBe(false);
  });
  it("rejects missing flat_id (required)", () => {
    const r = fullLifecycleRow();
    delete r.flat_id;
    expect(ResidentBillPaymentLifecycleRowSchema.safeParse(r).success).toBe(false);
  });
  it("rejects missing paid_at (required)", () => {
    const r = fullLifecycleRow();
    delete r.paid_at;
    expect(ResidentBillPaymentLifecycleRowSchema.safeParse(r).success).toBe(false);
  });
  it("rejects missing updated_at (required)", () => {
    const r = fullLifecycleRow();
    delete r.updated_at;
    expect(ResidentBillPaymentLifecycleRowSchema.safeParse(r).success).toBe(false);
  });
  it("rejects missing created_at (required)", () => {
    const r = fullLifecycleRow();
    delete r.created_at;
    expect(ResidentBillPaymentLifecycleRowSchema.safeParse(r).success).toBe(false);
  });
  it("rejects an unsupported status", () => {
    expect(
      ResidentBillPaymentLifecycleRowSchema.safeParse(fullLifecycleRow({ status: "unknown" })).success,
    ).toBe(false);
  });
  it("rejects negative amount", () => {
    expect(
      ResidentBillPaymentLifecycleRowSchema.safeParse(fullLifecycleRow({ amount: -1 })).success,
    ).toBe(false);
  });
  it("rejects unknown extra key", () => {
    expect(
      ResidentBillPaymentLifecycleRowSchema.safeParse(fullLifecycleRow({ rogue: "x" })).success,
    ).toBe(false);
  });
  it("accepts nullable verified_at/verified_by as null", () => {
    expect(
      ResidentBillPaymentLifecycleRowSchema.safeParse(
        fullLifecycleRow({ verified_at: null, verified_by: null }),
      ).success,
    ).toBe(true);
  });
  it("rejects nullable field when omitted (undefined not accepted)", () => {
    const r = fullLifecycleRow();
    delete r.verified_at;
    expect(ResidentBillPaymentLifecycleRowSchema.safeParse(r).success).toBe(false);
  });
  it("rejects nullable proof_url when omitted", () => {
    const r = fullLifecycleRow();
    delete r.proof_url;
    expect(ResidentBillPaymentLifecycleRowSchema.safeParse(r).success).toBe(false);
  });
  it("rejects nullable razorpay_signature when omitted", () => {
    const r = fullLifecycleRow();
    delete r.razorpay_signature;
    expect(ResidentBillPaymentLifecycleRowSchema.safeParse(r).success).toBe(false);
  });
  it("rejects non-canonical bill_id UUID", () => {
    expect(
      ResidentBillPaymentLifecycleRowSchema.safeParse(fullLifecycleRow({ bill_id: "not-a-uuid" })).success,
    ).toBe(false);
  });
  it("rows schema rejects duplicate payment ids", () => {
    const res = ResidentBillPaymentLifecycleRowsSchema.safeParse([
      fullLifecycleRow(),
      fullLifecycleRow(),
    ]);
    expect(res.success).toBe(false);
  });
  it("parseResidentBillPaymentLifecycleRows rejects null", () => {
    expect(() => parseResidentBillPaymentLifecycleRows(null, "T")).toThrow(/absent/);
  });
  it("parseResidentBillPaymentLifecycleRows rejects non-array", () => {
    expect(() => parseResidentBillPaymentLifecycleRows({}, "T")).toThrow(/not array/);
  });
  it("canonical field list has 34 entries (exact DB parity)", () => {
    expect(RESIDENT_BILL_PAYMENT_LIFECYCLE_FIELDS.length).toBe(34);
  });
});

describe("Stage 3C — receipt lifecycle schema", () => {
  it("accepts a full-shape row", () => {
    expect(ResidentBillReceiptLifecycleRowSchema.safeParse(fullReceiptRow()).success).toBe(true);
  });
  it("rejects missing id", () => {
    const r = fullReceiptRow();
    delete r.id;
    expect(ResidentBillReceiptLifecycleRowSchema.safeParse(r).success).toBe(false);
  });
  it("rejects missing payment_id", () => {
    const r = fullReceiptRow();
    delete r.payment_id;
    expect(ResidentBillReceiptLifecycleRowSchema.safeParse(r).success).toBe(false);
  });
  it("rejects missing society_id (now required)", () => {
    const r = fullReceiptRow();
    delete r.society_id;
    expect(ResidentBillReceiptLifecycleRowSchema.safeParse(r).success).toBe(false);
  });
  it("rejects missing receipt_number (required)", () => {
    const r = fullReceiptRow();
    delete r.receipt_number;
    expect(ResidentBillReceiptLifecycleRowSchema.safeParse(r).success).toBe(false);
  });
  it("rejects missing status (required)", () => {
    const r = fullReceiptRow();
    delete r.status;
    expect(ResidentBillReceiptLifecycleRowSchema.safeParse(r).success).toBe(false);
  });
  it("rejects missing issued_at (required)", () => {
    const r = fullReceiptRow();
    delete r.issued_at;
    expect(ResidentBillReceiptLifecycleRowSchema.safeParse(r).success).toBe(false);
  });
  it("rejects missing created_at (required)", () => {
    const r = fullReceiptRow();
    delete r.created_at;
    expect(ResidentBillReceiptLifecycleRowSchema.safeParse(r).success).toBe(false);
  });
  it("rejects unknown extra key", () => {
    expect(
      ResidentBillReceiptLifecycleRowSchema.safeParse(fullReceiptRow({ rogue: 1 })).success,
    ).toBe(false);
  });
  it("accepts nullable voided_at/void_reason", () => {
    expect(
      ResidentBillReceiptLifecycleRowSchema.safeParse(
        fullReceiptRow({ voided_at: null, void_reason: null }),
      ).success,
    ).toBe(true);
  });
  it("rejects nullable issued_by when omitted", () => {
    const r = fullReceiptRow();
    delete r.issued_by;
    expect(ResidentBillReceiptLifecycleRowSchema.safeParse(r).success).toBe(false);
  });
  it("rejects nullable voided_by when omitted", () => {
    const r = fullReceiptRow();
    delete r.voided_by;
    expect(ResidentBillReceiptLifecycleRowSchema.safeParse(r).success).toBe(false);
  });
  it("rows schema rejects duplicate receipt ids", () => {
    const res = ResidentBillReceiptLifecycleRowsSchema.safeParse([
      fullReceiptRow(),
      fullReceiptRow(),
    ]);
    expect(res.success).toBe(false);
  });
  it("parseResidentBillReceiptLifecycleRows rejects null", () => {
    expect(() => parseResidentBillReceiptLifecycleRows(null, "T")).toThrow(/absent/);
  });
  it("parseResidentBillReceiptLifecycleRows rejects non-array", () => {
    expect(() => parseResidentBillReceiptLifecycleRows({}, "T")).toThrow(/not array/);
  });
  it("canonical field list has 17 entries (exact DB parity)", () => {
    expect(RESIDENT_BILL_RECEIPT_LIFECYCLE_FIELDS.length).toBe(17);
  });
});

describe("Stage 3C — snapshotResidentBillState receipt/payment fetches", () => {
  const seq = { yearly: [], monthly: [] };
  const summary = {
    bill_id: CANON_BILL,
    society_id: CANON_SOCIETY,
    total_payable: 1000,
    verified_amount: 0,
    pending_amount: 0,
    rejected_amount: 0,
    reversed_amount: 0,
    available_to_submit: 1000,
    remaining_verified_balance: 1000,
    cancelled: false,
    status: "unpaid" as const,
  };
  function makeSnapReader(overrides: {
    payments?: unknown;
    receipts?: unknown;
  } = {}): ResidentBillStateReader {
    return {
      from: (table: string) => ({
        select: (_c: string) => ({
          eq: async (_col: string, _val: string) => {
            if (table === "payments")
              return { data: overrides.payments ?? [], error: null };
            if (table === "payment_receipts")
              return { data: overrides.receipts ?? [], error: null };
            if (table === "payment_receipt_sequences")
              return { data: seq.yearly, error: null };
            if (table === "payment_receipt_month_sequences")
              return { data: seq.monthly, error: null };
            return { data: [], error: null };
          },
        }),
      }),
    };
  }
  const actor: ActorRpcClient = {
    async rpc() {
      return { data: summary, error: null };
    },
  };
  it("returns receiptRows field on the snapshot", async () => {
    const snap = await snapshotResidentBillState(
      makeSnapReader(),
      actor,
      CANON_BILL,
      CANON_SOCIETY,
      "T",
    );
    expect(Array.isArray(snap.receiptRows)).toBe(true);
    expect(snap.receiptRows.length).toBe(0);
  });
  it("fetches and returns a real receipt row scoped to a payment", async () => {
    const payment = fullLifecycleRow();
    const receipt = fullReceiptRow();
    const snap = await snapshotResidentBillState(
      makeSnapReader({ payments: [payment], receipts: [receipt] }),
      actor,
      CANON_BILL,
      CANON_SOCIETY,
      "T",
    );
    expect(snap.paymentRows.length).toBe(1);
    expect(snap.receiptRows.length).toBe(1);
    expect(snap.receiptRows[0].id).toBe(CANON_RECEIPT_1);
  });
  it("rejects a receipt row whose payment_id does not match", async () => {
    const payment = fullLifecycleRow();
    const receipt = fullReceiptRow({ payment_id: CANON_ID_2 });
    await expect(
      snapshotResidentBillState(
        makeSnapReader({ payments: [payment], receipts: [receipt] }),
        actor,
        CANON_BILL,
        CANON_SOCIETY,
        "T",
      ),
    ).rejects.toThrow(/payment scope mismatch/);
  });
  it("rejects a receipt with wrong society scope", async () => {
    const payment = fullLifecycleRow();
    const receipt = fullReceiptRow({ society_id: CANON_ID_2 });
    await expect(
      snapshotResidentBillState(
        makeSnapReader({ payments: [payment], receipts: [receipt] }),
        actor,
        CANON_BILL,
        CANON_SOCIETY,
        "T",
      ),
    ).rejects.toThrow(/receipt society scope mismatch/);
  });
  it("rejects duplicate receipt ids across payments", async () => {
    const p1 = fullLifecycleRow({ id: CANON_ID_1 });
    const p2 = fullLifecycleRow({ id: CANON_ID_2 });
    // Both payments queried; mock returns same receipt row both times.
    const r = fullReceiptRow({ payment_id: CANON_ID_1 });
    let call = 0;
    const reader: ResidentBillStateReader = {
      from: (table: string) => ({
        select: (_c: string) => ({
          eq: async (_col: string, val: string) => {
            if (table === "payments") return { data: [p1, p2], error: null };
            if (table === "payment_receipts") {
              call++;
              // return a receipt whose payment_id matches the requested payment
              return { data: [{ ...r, payment_id: val }], error: null };
            }
            return { data: [], error: null };
          },
        }),
      }),
    };
    await expect(
      snapshotResidentBillState(reader, actor, CANON_BILL, CANON_SOCIETY, "T"),
    ).rejects.toThrow(/duplicate receipt id/);
    expect(call).toBeGreaterThan(0);
  });
  it("rejects a payment row whose bill_id does not match", async () => {
    const payment = fullLifecycleRow({ bill_id: CANON_ID_2 });
    await expect(
      snapshotResidentBillState(
        makeSnapReader({ payments: [payment] }),
        actor,
        CANON_BILL,
        CANON_SOCIETY,
        "T",
      ),
    ).rejects.toThrow(/payment row bill scope mismatch/);
  });
});

// ---------------------------------------------------------------------------
// Exhaustive per-field parity: every one of the 34 payment columns and 17
// receipt columns must be present. Deleting each key in turn must fail the
// row schema; changing each key's value must fail
// assertResidentBillStateUnchanged (via payment or receipt drift path).
// ---------------------------------------------------------------------------

const PAYMENT_MUTATION_VALUES: Record<string, unknown> = {
  id: CANON_ID_2,
  bill_id: CANON_ID_2,
  society_id: CANON_ID_2,
  flat_id: CANON_BILL,
  amount: 999,
  method: "cash",
  status: "verified",
  created_at: "2027-01-01T00:00:00Z",
  updated_at: "2027-01-01T00:00:00Z",
  paid_at: "2027-01-01T00:00:00Z",
  user_id: CANON_ID_2,
  submitted_by: CANON_ID_2,
  submitted_at: "2027-01-01T00:00:00Z",
  source: "admin_entry",
  reference_no: "MUT-REF",
  idempotency_key: "MUT-IDEM",
  payment_date: "2027-01-02",
  notes: "mutated",
  verified_by: CANON_ID_2,
  verified_at: "2027-01-03T00:00:00Z",
  verification_notes: "vn",
  rejected_by: CANON_ID_2,
  rejected_at: "2027-01-04T00:00:00Z",
  rejection_reason: "rr",
  reversed_by: CANON_ID_2,
  reversed_at: "2027-01-05T00:00:00Z",
  reversal_reason: "xr",
  platform_fee_paise: 42,
  platform_share_paise: 7,
  society_share_paise: 8,
  proof_url: "https://x.example/mut",
  razorpay_order_id: "rzp_ord_mut",
  razorpay_payment_id: "rzp_pay_mut",
  razorpay_signature: "sig_mut",
};

describe("Stage 3C — payment lifecycle exhaustive per-field parity (34 columns)", () => {
  const seq = ReceiptSequenceSnapshotSchema.parse({ yearly: [], monthly: [] });
  const summary = ResidentBillSummarySchema.parse({
    bill_id: CANON_BILL,
    society_id: CANON_SOCIETY,
    total_payable: 1000,
    verified_amount: 0,
    pending_amount: 0,
    rejected_amount: 0,
    reversed_amount: 0,
    available_to_submit: 1000,
    remaining_verified_balance: 1000,
    cancelled: false,
    status: "unpaid" as const,
  });

  for (const field of RESIDENT_BILL_PAYMENT_LIFECYCLE_FIELDS) {
    it(`schema rejects deletion of payment column "${String(field)}"`, () => {
      const row = fullLifecycleRow();
      delete row[field as string];
      expect(ResidentBillPaymentLifecycleRowSchema.safeParse(row).success).toBe(false);
    });

    it(`assertResidentBillStateUnchanged detects drift on payment column "${String(field)}"`, () => {
      const before = ResidentBillPaymentLifecycleRowsSchema.parse([fullLifecycleRow()]);
      const mutated = { ...fullLifecycleRow(), [field]: PAYMENT_MUTATION_VALUES[field as string] };
      const after = ResidentBillPaymentLifecycleRowsSchema.parse([mutated]);
      expect(() =>
        assertResidentBillStateUnchanged(
          { summary, paymentRows: before, receiptRows: [], sequences: seq },
          { summary, paymentRows: after, receiptRows: [], sequences: seq },
          "T",
        ),
      ).toThrow(/payment row \d+ field \w+ changed/);
    });
  }
});

const RECEIPT_MUTATION_VALUES: Record<string, unknown> = {
  id: CANON_RECEIPT_2,
  payment_id: CANON_ID_2,
  society_id: CANON_ID_2,
  receipt_number: "RCPT-MUT",
  status: "voided",
  issued_at: "2027-02-01T00:00:00Z",
  created_at: "2027-02-01T00:00:00Z",
  issued_by: CANON_ID_2,
  voided_at: "2027-02-02T00:00:00Z",
  voided_by: CANON_ID_2,
  void_reason: "mutation",
  amount_snapshot: 999,
  method_snapshot: "cash",
  reference_snapshot: "ref-mut",
  bill_number_snapshot: "BN-MUT",
  verified_by: CANON_ID_2,
  verified_at: "2027-02-03T00:00:00Z",
};

describe("Stage 3C — receipt lifecycle exhaustive per-field parity (17 columns)", () => {
  const seq = ReceiptSequenceSnapshotSchema.parse({ yearly: [], monthly: [] });
  const summary = ResidentBillSummarySchema.parse({
    bill_id: CANON_BILL,
    society_id: CANON_SOCIETY,
    total_payable: 1000,
    verified_amount: 0,
    pending_amount: 0,
    rejected_amount: 0,
    reversed_amount: 0,
    available_to_submit: 1000,
    remaining_verified_balance: 1000,
    cancelled: false,
    status: "unpaid" as const,
  });
  const baselinePayments = ResidentBillPaymentLifecycleRowsSchema.parse([
    fullLifecycleRow(),
  ]);

  for (const field of RESIDENT_BILL_RECEIPT_LIFECYCLE_FIELDS) {
    it(`schema rejects deletion of receipt column "${String(field)}"`, () => {
      const row = fullReceiptRow();
      delete row[field as string];
      expect(ResidentBillReceiptLifecycleRowSchema.safeParse(row).success).toBe(false);
    });

    it(`assertResidentBillStateUnchanged detects drift on receipt column "${String(field)}"`, () => {
      const before = ResidentBillReceiptLifecycleRowsSchema.parse([fullReceiptRow()]);
      const mutated = { ...fullReceiptRow(), [field]: RECEIPT_MUTATION_VALUES[field as string] };
      const after = ResidentBillReceiptLifecycleRowsSchema.parse([mutated]);
      expect(() =>
        assertResidentBillStateUnchanged(
          { summary, paymentRows: baselinePayments, receiptRows: before, sequences: seq },
          { summary, paymentRows: baselinePayments, receiptRows: after, sequences: seq },
          "T",
        ),
      ).toThrow(/receipt row \d+ field \w+ changed/);
    });
  }
});

describe("Stage 3C — assertResidentBillStateUnchanged has no non-null / cast escape hatches", () => {
  const src = readFileSync(
    resolve(process.cwd(), "tests/helpers/stage3c-live-resident-submit-contracts.ts"),
    "utf8",
  );
  const fnStart = src.indexOf("export function assertResidentBillStateUnchanged");
  const rest = src.slice(fnStart);
  const fnEnd = rest.indexOf("\n}\n");
  const body = rest.slice(0, fnEnd);

  it("locates the function body", () => {
    expect(fnStart).toBeGreaterThan(-1);
    expect(fnEnd).toBeGreaterThan(0);
  });
  it("does not use non-null assertions inside the function body", () => {
    expect(body).not.toMatch(/\]\s*!\s*[;,)]/);
    expect(body).not.toMatch(/\w!\./);
  });
  it("does not cast rows to Record<string, unknown> inside the function body", () => {
    expect(body).not.toMatch(/as\s+Record<\s*string\s*,\s*unknown\s*>/);
  });
  it("does not normalize undefined to null inside the function body", () => {
    expect(body).not.toMatch(/\?\?\s*null/);
  });
});


// ---------------------------------------------------------------------------
// Nullability partitions — exact required vs nullable field lists
// ---------------------------------------------------------------------------

const PAYMENT_REQUIRED_FIELDS = [
  "amount",
  "bill_id",
  "created_at",
  "flat_id",
  "id",
  "method",
  "paid_at",
  "society_id",
  "status",
  "updated_at",
] as const;

const PAYMENT_NULLABLE_FIELDS = [
  "idempotency_key",
  "notes",
  "payment_date",
  "platform_fee_paise",
  "platform_share_paise",
  "proof_url",
  "razorpay_order_id",
  "razorpay_payment_id",
  "razorpay_signature",
  "reference_no",
  "rejected_at",
  "rejected_by",
  "rejection_reason",
  "reversal_reason",
  "reversed_at",
  "reversed_by",
  "society_share_paise",
  "source",
  "submitted_at",
  "submitted_by",
  "user_id",
  "verification_notes",
  "verified_at",
  "verified_by",
] as const;

const RECEIPT_REQUIRED_FIELDS = [
  "created_at",
  "id",
  "issued_at",
  "payment_id",
  "receipt_number",
  "society_id",
  "status",
] as const;

const RECEIPT_NULLABLE_FIELDS = [
  "amount_snapshot",
  "bill_number_snapshot",
  "issued_by",
  "method_snapshot",
  "reference_snapshot",
  "verified_at",
  "verified_by",
  "void_reason",
  "voided_at",
  "voided_by",
] as const;

describe("Stage 3C — nullability partitions (payment)", () => {
  it("required field array has exactly 10 unique fields", () => {
    expect(PAYMENT_REQUIRED_FIELDS.length).toBe(10);
    expect(new Set(PAYMENT_REQUIRED_FIELDS).size).toBe(10);
  });
  it("nullable field array has exactly 24 unique fields", () => {
    expect(PAYMENT_NULLABLE_FIELDS.length).toBe(24);
    expect(new Set(PAYMENT_NULLABLE_FIELDS).size).toBe(24);
  });
  it("combined arrays exactly equal canonical 34-field list (as sorted set)", () => {
    const combined = [...PAYMENT_REQUIRED_FIELDS, ...PAYMENT_NULLABLE_FIELDS];
    expect(combined.length).toBe(34);
    expect(new Set(combined).size).toBe(34);
    const canonical = [...RESIDENT_BILL_PAYMENT_LIFECYCLE_FIELDS].sort();
    expect([...combined].sort()).toEqual(canonical);
  });

  for (const field of PAYMENT_REQUIRED_FIELDS) {
    it(`removing required payment field "${field}" fails closed`, () => {
      const row = fullLifecycleRow();
      delete row[field];
      expect(ResidentBillPaymentLifecycleRowSchema.safeParse(row).success).toBe(false);
    });
  }

  for (const field of PAYMENT_NULLABLE_FIELDS) {
    it(`removing nullable payment field "${field}" fails closed`, () => {
      const row = fullLifecycleRow();
      delete row[field];
      expect(ResidentBillPaymentLifecycleRowSchema.safeParse(row).success).toBe(false);
    });
    it(`explicit null accepted for nullable payment field "${field}"`, () => {
      const row = fullLifecycleRow({ [field]: null });
      expect(ResidentBillPaymentLifecycleRowSchema.safeParse(row).success).toBe(true);
    });
  }
});

describe("Stage 3C — nullability partitions (receipt)", () => {
  it("required field array has exactly 7 unique fields", () => {
    expect(RECEIPT_REQUIRED_FIELDS.length).toBe(7);
    expect(new Set(RECEIPT_REQUIRED_FIELDS).size).toBe(7);
  });
  it("nullable field array has exactly 10 unique fields", () => {
    expect(RECEIPT_NULLABLE_FIELDS.length).toBe(10);
    expect(new Set(RECEIPT_NULLABLE_FIELDS).size).toBe(10);
  });
  it("combined arrays exactly equal canonical 17-field list (as sorted set)", () => {
    const combined = [...RECEIPT_REQUIRED_FIELDS, ...RECEIPT_NULLABLE_FIELDS];
    expect(combined.length).toBe(17);
    expect(new Set(combined).size).toBe(17);
    const canonical = [...RESIDENT_BILL_RECEIPT_LIFECYCLE_FIELDS].sort();
    expect([...combined].sort()).toEqual(canonical);
  });

  for (const field of RECEIPT_REQUIRED_FIELDS) {
    it(`removing required receipt field "${field}" fails closed`, () => {
      const row = fullReceiptRow();
      delete row[field];
      expect(ResidentBillReceiptLifecycleRowSchema.safeParse(row).success).toBe(false);
    });
  }

  for (const field of RECEIPT_NULLABLE_FIELDS) {
    it(`removing nullable receipt field "${field}" fails closed`, () => {
      const row = fullReceiptRow();
      delete row[field];
      expect(ResidentBillReceiptLifecycleRowSchema.safeParse(row).success).toBe(false);
    });
    it(`explicit null accepted for nullable receipt field "${field}"`, () => {
      const row = fullReceiptRow({ [field]: null });
      expect(ResidentBillReceiptLifecycleRowSchema.safeParse(row).success).toBe(true);
    });
  }
});

// ---------------------------------------------------------------------------
// SELECT constant uniqueness — payment/receipt column projection lists
// ---------------------------------------------------------------------------

describe("Stage 3C — SELECT column lists (parity + uniqueness)", () => {
  const contractsSrc = readFileSync(
    resolve(process.cwd(), "tests/helpers/stage3c-live-resident-submit-contracts.ts"),
    "utf8",
  );

  function extractSelect(name: string): string[] {
    const re = new RegExp(`${name}\\s*=\\s*"([^"]+)"`);
    const m = contractsSrc.match(re);
    if (!m) throw new Error(`${name} not found`);
    return m[1].split(",").map((s) => s.trim()).filter((s) => s.length > 0);
  }

  const paymentList = extractSelect("PAYMENT_LIFECYCLE_SELECT");
  const receiptList = extractSelect("RECEIPT_LIFECYCLE_SELECT");

  it("PAYMENT_LIFECYCLE_SELECT has exactly 34 entries", () => {
    expect(paymentList.length).toBe(34);
  });
  it("PAYMENT_LIFECYCLE_SELECT has exactly 34 unique entries", () => {
    expect(new Set(paymentList).size).toBe(34);
  });
  it("PAYMENT_LIFECYCLE_SELECT sorted equals canonical payment field list sorted", () => {
    expect([...paymentList].sort()).toEqual(
      [...RESIDENT_BILL_PAYMENT_LIFECYCLE_FIELDS].sort(),
    );
  });
  for (const field of RESIDENT_BILL_PAYMENT_LIFECYCLE_FIELDS) {
    it(`PAYMENT_LIFECYCLE_SELECT contains "${String(field)}" exactly once`, () => {
      const occurrences = paymentList.filter((c) => c === field);
      expect(occurrences.length).toBe(1);
    });
  }

  it("RECEIPT_LIFECYCLE_SELECT has exactly 17 entries", () => {
    expect(receiptList.length).toBe(17);
  });
  it("RECEIPT_LIFECYCLE_SELECT has exactly 17 unique entries", () => {
    expect(new Set(receiptList).size).toBe(17);
  });
  it("RECEIPT_LIFECYCLE_SELECT sorted equals canonical receipt field list sorted", () => {
    expect([...receiptList].sort()).toEqual(
      [...RESIDENT_BILL_RECEIPT_LIFECYCLE_FIELDS].sort(),
    );
  });
  for (const field of RESIDENT_BILL_RECEIPT_LIFECYCLE_FIELDS) {
    it(`RECEIPT_LIFECYCLE_SELECT contains "${String(field)}" exactly once`, () => {
      const occurrences = receiptList.filter((c) => c === field);
      expect(occurrences.length).toBe(1);
    });
  }
});

// ---------------------------------------------------------------------------
// Complete-snapshot mutation coverage (insertion/deletion/sequence/etc.)
// ---------------------------------------------------------------------------

describe("Stage 3C — assertResidentBillStateUnchanged complete-snapshot coverage", () => {
  const seq0 = ReceiptSequenceSnapshotSchema.parse({ yearly: [], monthly: [] });
  const summary = ResidentBillSummarySchema.parse({
    bill_id: CANON_BILL,
    society_id: CANON_SOCIETY,
    total_payable: 1000,
    verified_amount: 0,
    pending_amount: 0,
    rejected_amount: 0,
    reversed_amount: 0,
    available_to_submit: 1000,
    remaining_verified_balance: 1000,
    cancelled: false,
    status: "unpaid" as const,
  });

  it("rejects payment row insertion (before empty, after 1 row)", () => {
    const after = ResidentBillPaymentLifecycleRowsSchema.parse([fullLifecycleRow()]);
    expect(() =>
      assertResidentBillStateUnchanged(
        { summary, paymentRows: [], receiptRows: [], sequences: seq0 },
        { summary, paymentRows: after, receiptRows: [], sequences: seq0 },
        "T",
      ),
    ).toThrow(/payment row count changed/);
  });

  it("rejects payment row deletion (before 1 row, after empty)", () => {
    const before = ResidentBillPaymentLifecycleRowsSchema.parse([fullLifecycleRow()]);
    expect(() =>
      assertResidentBillStateUnchanged(
        { summary, paymentRows: before, receiptRows: [], sequences: seq0 },
        { summary, paymentRows: [], receiptRows: [], sequences: seq0 },
        "T",
      ),
    ).toThrow(/payment row count changed/);
  });

  it("rejects receipt row insertion (before empty, after 1 row)", () => {
    const payments = ResidentBillPaymentLifecycleRowsSchema.parse([fullLifecycleRow()]);
    const receipts = ResidentBillReceiptLifecycleRowsSchema.parse([fullReceiptRow()]);
    expect(() =>
      assertResidentBillStateUnchanged(
        { summary, paymentRows: payments, receiptRows: [], sequences: seq0 },
        { summary, paymentRows: payments, receiptRows: receipts, sequences: seq0 },
        "T",
      ),
    ).toThrow(/receipt row count changed/);
  });

  it("rejects receipt row deletion (before 1 row, after empty)", () => {
    const payments = ResidentBillPaymentLifecycleRowsSchema.parse([fullLifecycleRow()]);
    const receipts = ResidentBillReceiptLifecycleRowsSchema.parse([fullReceiptRow()]);
    expect(() =>
      assertResidentBillStateUnchanged(
        { summary, paymentRows: payments, receiptRows: receipts, sequences: seq0 },
        { summary, paymentRows: payments, receiptRows: [], sequences: seq0 },
        "T",
      ),
    ).toThrow(/receipt row count changed/);
  });

  it("rejects yearly sequence next_number mutation", () => {
    const before = ReceiptSequenceSnapshotSchema.parse({
      yearly: [{ society_id: CANON_SOCIETY, year: 2026, next_number: 1 }],
      monthly: [],
    });
    const after = ReceiptSequenceSnapshotSchema.parse({
      yearly: [{ society_id: CANON_SOCIETY, year: 2026, next_number: 2 }],
      monthly: [],
    });
    expect(() =>
      assertResidentBillStateUnchanged(
        { summary, paymentRows: [], receiptRows: [], sequences: before },
        { summary, paymentRows: [], receiptRows: [], sequences: after },
        "T",
      ),
    ).toThrow(/yearly sequence row \d+ changed/);
  });

  it("rejects monthly sequence next_number mutation", () => {
    const before = ReceiptSequenceSnapshotSchema.parse({
      yearly: [],
      monthly: [{ society_id: CANON_SOCIETY, year_month: "2026-07", next_number: 1 }],
    });
    const after = ReceiptSequenceSnapshotSchema.parse({
      yearly: [],
      monthly: [{ society_id: CANON_SOCIETY, year_month: "2026-07", next_number: 2 }],
    });
    expect(() =>
      assertResidentBillStateUnchanged(
        { summary, paymentRows: [], receiptRows: [], sequences: before },
        { summary, paymentRows: [], receiptRows: [], sequences: after },
        "T",
      ),
    ).toThrow(/monthly sequence row \d+ changed/);
  });

  it("rejects a deliberately malformed runtime snapshot missing receiptRows", () => {
    const payments = ResidentBillPaymentLifecycleRowsSchema.parse([fullLifecycleRow()]);
    const broken = {
      summary,
      paymentRows: payments,
      // receiptRows intentionally omitted
      sequences: seq0,
    } as unknown as import("../helpers/stage3c-live-resident-submit-contracts").ResidentBillStateSnapshot;
    expect(() =>
      assertResidentBillStateUnchanged(
        { summary, paymentRows: payments, receiptRows: [], sequences: seq0 },
        broken,
        "T",
      ),
    ).toThrow();
  });

  it("rejects a nullable field omitted on one side vs explicit null on the other", () => {
    // Before: explicit null (valid). After: field omitted (invalid → parse fails).
    const before = ResidentBillPaymentLifecycleRowsSchema.parse([
      fullLifecycleRow({ verified_at: null }),
    ]);
    const afterRow = fullLifecycleRow({ verified_at: null });
    delete afterRow.verified_at;
    expect(() =>
      assertResidentBillStateUnchanged(
        { summary, paymentRows: before, receiptRows: [], sequences: seq0 },
        {
          summary,
          paymentRows: [afterRow] as unknown as import(
            "../helpers/stage3c-live-resident-submit-contracts"
          ).ResidentBillPaymentLifecycleRow[],
          receiptRows: [],
          sequences: seq0,
        },
        "T",
      ),
    ).toThrow();
  });

  it("receipt query provider failure surfaces via safeStage3CErrorMessage", async () => {
    const providerErr = { code: "PGRST42", message: "sql: SELECT secret FROM x WHERE y=$1" };
    const reader: import(
      "../helpers/stage3c-live-resident-submit-contracts"
    ).ResidentBillStateReader = {
      from: (table: string) => ({
        select: (_c: string) => ({
          eq: async (_col: string, _val: string) => {
            if (table === "payments") return { data: [fullLifecycleRow()], error: null };
            if (table === "payment_receipts")
              return { data: null, error: providerErr };
            return { data: [], error: null };
          },
        }),
      }),
    };
    const actor: import(
      "../helpers/stage3c-live-resident-submit-contracts"
    ).ActorRpcClient = {
      async rpc() {
        return {
          data: {
            bill_id: CANON_BILL,
            society_id: CANON_SOCIETY,
            total_payable: 1000,
            verified_amount: 0,
            pending_amount: 0,
            rejected_amount: 0,
            reversed_amount: 0,
            available_to_submit: 1000,
            remaining_verified_balance: 1000,
            cancelled: false,
            status: "unpaid",
          },
          error: null,
        };
      },
    };
    try {
      await snapshotResidentBillState(reader, actor, CANON_BILL, CANON_SOCIETY, "T");
      throw new Error("expected throw");
    } catch (e) {
      const msg = (e as Error).message;
      // safeStage3CErrorMessage must not include raw SQL fragments.
      expect(msg).not.toMatch(/SELECT/i);
      expect(msg).not.toContain("secret");
    }
  });

  it("assertion error excludes fixture UUIDs and altered values (payment field drift)", () => {
    const before = ResidentBillPaymentLifecycleRowsSchema.parse([
      fullLifecycleRow({ verified_at: "2026-07-01T00:00:00Z" }),
    ]);
    const after = ResidentBillPaymentLifecycleRowsSchema.parse([
      fullLifecycleRow({ verified_at: "2099-12-31T00:00:00Z" }),
    ]);
    try {
      assertResidentBillStateUnchanged(
        { summary, paymentRows: before, receiptRows: [], sequences: seq0 },
        { summary, paymentRows: after, receiptRows: [], sequences: seq0 },
        "T",
      );
      throw new Error("expected throw");
    } catch (e) {
      const msg = (e as Error).message;
      expect(msg).toMatch(/payment row \d+ field verified_at changed/);
      expect(msg).not.toContain(CANON_ID_1);
      expect(msg).not.toContain(CANON_BILL);
      expect(msg).not.toContain("2099-12-31");
    }
  });
});
