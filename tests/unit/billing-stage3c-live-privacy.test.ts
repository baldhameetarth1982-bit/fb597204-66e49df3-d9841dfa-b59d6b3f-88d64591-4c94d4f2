/**
 * Stage 3C — Checkpoint A: PRIVACY-01..16 direct behavioral tests.
 *
 * Every case is exercised via the exported handler map against a
 * deterministic in-memory context. No live Supabase. The suite proves:
 *
 *   - the forbidden-key wrapper is truly immutable (no add/delete/clear
 *     escape hatch);
 *   - PRIVACY-08..11 and 15..16 fail closed without a real receipt-bearing
 *     `privacyReceiptDetail` (no fallback to the ordinary READ payload);
 *   - PRIVACY-13 scans BOTH the ordinary READ payload AND the receipt
 *     payload recursively;
 *   - PRIVACY-14..16 clone a COMPLETE valid resident payload and inject
 *     one forbidden field — never a stub receipt;
 *   - PRIVACY-12 forbidden payer keys exist as real generated
 *     `payments` columns;
 *   - Original accepted context payloads are never mutated;
 *   - No handler invokes a write RPC (source scan).
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import {
  parsePaymentDetailResponse,
  residentPaymentDetailSchema,
} from "@/lib/offline-payments.functions";
import {
  STAGE3C_PRIVACY_CASE_IDS,
  STAGE3C_PRIVACY_HANDLERS,
  STAGE3C_FORBIDDEN_PAYMENT_KEYS,
  STAGE3C_FORBIDDEN_RECEIPT_KEYS,
  STAGE3C_FORBIDDEN_PAYER_KEYS,
  STAGE3C_FORBIDDEN_KEYS_ALL,
  findForbiddenKeyPath,
  type Stage3CPrivacyCaseId,
  type ImmutableStringSet,
} from "../helpers/stage3c-live-privacy-cases";
import {
  createStage3CLiveMatrixContext,
  type Stage3CLiveMatrixContext,
} from "../helpers/stage3c-live-matrix-context";
import type { ResidentPaymentDetail } from "../helpers/stage3c-live-read-cases";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PRIVACY_MODULE_SRC = readFileSync(
  resolve(__dirname, "../helpers/stage3c-live-privacy-cases.ts"),
  "utf8",
);
const GENERATED_TYPES_SRC = readFileSync(
  resolve(__dirname, "../../src/integrations/supabase/types.ts"),
  "utf8",
);

const UUID_A = "11111111-2222-4333-8444-555555555555";
const UUID_B = "22222222-3333-4444-8555-666666666666";
const UUID_C = "33333333-4444-4555-8666-777777777777";
const UUID_D = "44444444-5555-4666-8777-888888888888";

function makeDetail(overrides?: { withReceipt?: boolean }): ResidentPaymentDetail {
  const raw = {
    audience: "resident" as const,
    payment: {
      id: UUID_A,
      bill_id: UUID_B,
      society_id: UUID_C,
      flat_id: UUID_D,
      amount: 250,
      method: "bank_transfer",
      status: "verified",
      reference_no: "REF-001",
      submitted_at: "2026-07-01T00:00:00Z",
      source: "resident_submit",
      payment_date: "2026-07-01",
      verified_at: "2026-07-02T00:00:00Z",
      rejected_at: null,
      rejection_reason: null,
      reversed_at: null,
      reversal_reason: null,
      created_at: "2026-07-01T00:00:00Z",
    },
    bill_number: "B-0001",
    flat_label: "A-101",
    summary: null,
    receipt: overrides?.withReceipt
      ? {
          receipt_number: "RCPT/202607/0001",
          status: "valid" as const,
          issued_at: "2026-07-02T00:00:00Z",
          voided_at: null,
          void_reason: null,
          amount_snapshot: 250,
          method_snapshot: "bank_transfer",
          reference_snapshot: "REF-001",
          bill_number_snapshot: "B-0001",
          verified_at: "2026-07-02T00:00:00Z",
        }
      : null,
  };
  return residentPaymentDetailSchema.parse(raw);
}

function ctxWithBoth(): Stage3CLiveMatrixContext {
  const c = createStage3CLiveMatrixContext();
  c.readAcceptedDetail = makeDetail({ withReceipt: false });
  c.privacyReceiptDetail = makeDetail({ withReceipt: true });
  c.privacyReceiptPaymentId = UUID_A;
  c.privacyReceiptBillId = UUID_B;
  return c;
}

function ctxOnlyRead(): Stage3CLiveMatrixContext {
  const c = createStage3CLiveMatrixContext();
  c.readAcceptedDetail = makeDetail({ withReceipt: false });
  return c;
}

// ---------------------------------------------------------------------------
// 1) Registry / exhaustiveness
// ---------------------------------------------------------------------------

describe("PRIVACY registry", () => {
  const EXPECTED_ORDER: readonly Stage3CPrivacyCaseId[] = [
    "PRIVACY-01", "PRIVACY-02", "PRIVACY-03", "PRIVACY-04",
    "PRIVACY-05", "PRIVACY-06", "PRIVACY-07", "PRIVACY-08",
    "PRIVACY-09", "PRIVACY-10", "PRIVACY-11", "PRIVACY-12",
    "PRIVACY-13", "PRIVACY-14", "PRIVACY-15", "PRIVACY-16",
  ];

  it("exports exactly 16 case ids in canonical order", () => {
    expect(STAGE3C_PRIVACY_CASE_IDS).toEqual(EXPECTED_ORDER);
  });

  it("handler map has exactly 16 entries in canonical order", () => {
    expect(Object.keys(STAGE3C_PRIVACY_HANDLERS)).toEqual(EXPECTED_ORDER);
  });

  it("every handler is an async function", () => {
    for (const id of EXPECTED_ORDER) {
      expect(typeof STAGE3C_PRIVACY_HANDLERS[id]).toBe("function");
    }
  });
});

// ---------------------------------------------------------------------------
// 2) Truly immutable forbidden-key wrapper (defect #1)
// ---------------------------------------------------------------------------

describe("Forbidden key wrapper is truly immutable", () => {
  const cases: Array<[string, ImmutableStringSet]> = [
    ["STAGE3C_FORBIDDEN_PAYMENT_KEYS", STAGE3C_FORBIDDEN_PAYMENT_KEYS],
    ["STAGE3C_FORBIDDEN_RECEIPT_KEYS", STAGE3C_FORBIDDEN_RECEIPT_KEYS],
    ["STAGE3C_FORBIDDEN_PAYER_KEYS", STAGE3C_FORBIDDEN_PAYER_KEYS],
    ["STAGE3C_FORBIDDEN_KEYS_ALL", STAGE3C_FORBIDDEN_KEYS_ALL],
  ];

  for (const [label, set] of cases) {
    it(`${label}: wrapper object is frozen`, () => {
      expect(Object.isFrozen(set)).toBe(true);
    });

    it(`${label}: does not expose Set mutators`, () => {
      const escape = set as unknown as Record<string, unknown>;
      expect(escape.add).toBeUndefined();
      expect(escape.delete).toBeUndefined();
      expect(escape.clear).toBeUndefined();
    });

    it(`${label}: assigning add/delete/clear fails or is ignored`, () => {
      const escape = set as unknown as { add?: unknown; delete?: unknown; clear?: unknown };
      try { escape.add = () => 42; } catch { /* strict mode throws — ok */ }
      try { escape.delete = () => true; } catch { /* ok */ }
      try { escape.clear = () => undefined; } catch { /* ok */ }
      expect(escape.add).toBeUndefined();
      expect(escape.delete).toBeUndefined();
      expect(escape.clear).toBeUndefined();
    });

    it(`${label}: values array is frozen and mutating it does not affect has()`, () => {
      expect(Object.isFrozen(set.values)).toBe(true);
      const arr = set.values as string[];
      try { arr.push("bogus_key_xyz"); } catch { /* frozen — expected */ }
      try { arr[0] = "clobber"; } catch { /* frozen — expected */ }
      expect(set.has("bogus_key_xyz")).toBe(false);
    });

    it(`${label}: iterable yields at least one canonical key`, () => {
      const out = [...set];
      expect(out.length).toBeGreaterThan(0);
      expect(out.every((k) => typeof k === "string" && k.length > 0)).toBe(true);
    });

    it(`${label}: size matches values length`, () => {
      expect(set.size).toBe(set.values.length);
    });
  }

  it("combined forbidden set contains every payment-forbidden key", () => {
    for (const k of STAGE3C_FORBIDDEN_PAYMENT_KEYS) {
      expect(STAGE3C_FORBIDDEN_KEYS_ALL.has(k)).toBe(true);
    }
  });

  it("combined forbidden set contains receipt actors and sequence internals", () => {
    for (const k of ["issued_by", "voided_by", "sequence_key", "next_number"]) {
      expect(STAGE3C_FORBIDDEN_KEYS_ALL.has(k)).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// 3) PRIVACY-12 payer keys grounded in generated database types (defect #5)
// ---------------------------------------------------------------------------

describe("PRIVACY-12 payer keys are grounded in generated types", () => {
  it("every forbidden payer key is declared on payments Row", () => {
    // Slice the `payments:` block from generated types.
    const startIdx = GENERATED_TYPES_SRC.indexOf("payments: {");
    expect(startIdx).toBeGreaterThan(-1);
    const paymentsBlock = GENERATED_TYPES_SRC.slice(startIdx, startIdx + 4000);
    for (const key of STAGE3C_FORBIDDEN_PAYER_KEYS) {
      const re = new RegExp(`\\b${key}\\b\\s*:\\s*string`);
      expect(re.test(paymentsBlock)).toBe(true);
    }
  });

  it("does not include speculative names removed in Checkpoint A", () => {
    for (const speculative of ["payer_user_id", "payer_flat_id", "payer_resident_id"]) {
      expect(STAGE3C_FORBIDDEN_PAYER_KEYS.has(speculative)).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// 4) PRIVACY-01..06 payment field omissions
// ---------------------------------------------------------------------------

const PAYMENT_CASES: Array<[Stage3CPrivacyCaseId, string]> = [
  ["PRIVACY-01", "proof_url"],
  ["PRIVACY-02", "idempotency_key"],
  ["PRIVACY-03", "submitted_by"],
  ["PRIVACY-04", "verified_by"],
  ["PRIVACY-05", "rejected_by"],
  ["PRIVACY-06", "reversed_by"],
];

describe("PRIVACY-01..06 payment field omissions", () => {
  for (const [id, key] of PAYMENT_CASES) {
    it(`${id} passes on a clean payload`, async () => {
      await expect(STAGE3C_PRIVACY_HANDLERS[id](ctxOnlyRead())).resolves.toBeUndefined();
    });

    it(`${id} fails when payment includes ${key}`, async () => {
      const ctx = ctxOnlyRead();
      (ctx.readAcceptedDetail as unknown as { payment: Record<string, unknown> }).payment[key] =
        "leaked";
      await expect(STAGE3C_PRIVACY_HANDLERS[id](ctx)).rejects.toThrow(
        new RegExp(`resident payment payload must omit "${key}"`),
      );
    });

    it(`${id} never prints the leaked value on failure`, async () => {
      const ctx = ctxOnlyRead();
      (ctx.readAcceptedDetail as unknown as { payment: Record<string, unknown> }).payment[key] =
        "SECRET-LEAKED-VALUE-XYZ";
      try {
        await STAGE3C_PRIVACY_HANDLERS[id](ctx);
        throw new Error("should have thrown");
      } catch (e) {
        expect((e as Error).message.includes("SECRET-LEAKED-VALUE-XYZ")).toBe(false);
      }
    });
  }
});

describe("PRIVACY-07 admin actor/notes bundle", () => {
  it("passes on a clean resident payload", async () => {
    await expect(STAGE3C_PRIVACY_HANDLERS["PRIVACY-07"](ctxOnlyRead())).resolves.toBeUndefined();
  });

  for (const key of ["notes", "verification_notes"]) {
    it(`fails when ${key} is present`, async () => {
      const ctx = ctxOnlyRead();
      (ctx.readAcceptedDetail as unknown as { payment: Record<string, unknown> }).payment[key] = "x";
      await expect(STAGE3C_PRIVACY_HANDLERS["PRIVACY-07"](ctx)).rejects.toThrow(
        new RegExp(`must omit "${key}"`),
      );
    });
  }

  it("does not flag resident-visible rejection_reason", async () => {
    const ctx = ctxOnlyRead();
    (ctx.readAcceptedDetail as unknown as { payment: Record<string, unknown> }).payment.rejection_reason =
      "Bounced";
    await expect(STAGE3C_PRIVACY_HANDLERS["PRIVACY-07"](ctx)).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 5) PRIVACY-08..11 fail-closed on missing/null receipt-bearing detail
// ---------------------------------------------------------------------------

const RECEIPT_CASES: Array<[Stage3CPrivacyCaseId, string]> = [
  ["PRIVACY-08", "id"],
  ["PRIVACY-09", "issued_by"],
  ["PRIVACY-10", "voided_by"],
];

describe("PRIVACY-08..10 receipt field omissions (fail-closed contract)", () => {
  for (const [id, key] of RECEIPT_CASES) {
    it(`${id} passes on a real receipt-bearing payload`, async () => {
      await expect(STAGE3C_PRIVACY_HANDLERS[id](ctxWithBoth())).resolves.toBeUndefined();
    });

    it(`${id} FAILS CLOSED when privacyReceiptDetail is null (no fallback)`, async () => {
      const ctx = ctxOnlyRead();
      await expect(STAGE3C_PRIVACY_HANDLERS[id](ctx)).rejects.toThrow(
        /privacyReceiptDetail/,
      );
    });

    it(`${id} FAILS CLOSED when receipt is null on the primed detail`, async () => {
      const ctx = ctxWithBoth();
      (ctx.privacyReceiptDetail as unknown as { receipt: null }).receipt = null;
      await expect(STAGE3C_PRIVACY_HANDLERS[id](ctx)).rejects.toThrow(
        /must be a real issued receipt/,
      );
    });

    it(`${id} fails when receipt includes ${key}`, async () => {
      const ctx = ctxWithBoth();
      (ctx.privacyReceiptDetail as unknown as { receipt: Record<string, unknown> }).receipt[key] =
        "x";
      await expect(STAGE3C_PRIVACY_HANDLERS[id](ctx)).rejects.toThrow(
        new RegExp(`resident receipt payload must omit "${key}"`),
      );
    });
  }
});

describe("PRIVACY-11 receipt sequence internals (fail-closed contract)", () => {
  it("passes on a real receipt-bearing payload", async () => {
    await expect(
      STAGE3C_PRIVACY_HANDLERS["PRIVACY-11"](ctxWithBoth()),
    ).resolves.toBeUndefined();
  });

  it("FAILS CLOSED without privacyReceiptDetail", async () => {
    await expect(
      STAGE3C_PRIVACY_HANDLERS["PRIVACY-11"](ctxOnlyRead()),
    ).rejects.toThrow(/privacyReceiptDetail/);
  });

  for (const key of ["sequence_id", "sequence_key", "next_number", "year", "year_month"]) {
    it(`fails when receipt has ${key}`, async () => {
      const ctx = ctxWithBoth();
      (ctx.privacyReceiptDetail as unknown as { receipt: Record<string, unknown> }).receipt[key] =
        "x";
      await expect(STAGE3C_PRIVACY_HANDLERS["PRIVACY-11"](ctx)).rejects.toThrow(
        /sequence internal/,
      );
    });
  }
});

// ---------------------------------------------------------------------------
// 6) PRIVACY-12 payer identity keys
// ---------------------------------------------------------------------------

describe("PRIVACY-12 payer identity keys", () => {
  it("passes on a clean payload", async () => {
    await expect(
      STAGE3C_PRIVACY_HANDLERS["PRIVACY-12"](ctxOnlyRead()),
    ).resolves.toBeUndefined();
  });

  it("fails when payment.user_id is present", async () => {
    const ctx = ctxOnlyRead();
    (ctx.readAcceptedDetail as unknown as { payment: Record<string, unknown> }).payment.user_id =
      "x";
    await expect(STAGE3C_PRIVACY_HANDLERS["PRIVACY-12"](ctx)).rejects.toThrow(
      /payer identity key/,
    );
  });
});

// ---------------------------------------------------------------------------
// 7) PRIVACY-13 recursive scan of BOTH payloads (defect #6)
// ---------------------------------------------------------------------------

describe("PRIVACY-13 recursive scan (dual payload)", () => {
  it("passes on clean payloads", async () => {
    await expect(
      STAGE3C_PRIVACY_HANDLERS["PRIVACY-13"](ctxWithBoth()),
    ).resolves.toBeUndefined();
  });

  it("FAILS CLOSED without privacyReceiptDetail", async () => {
    await expect(
      STAGE3C_PRIVACY_HANDLERS["PRIVACY-13"](ctxOnlyRead()),
    ).rejects.toThrow(/privacyReceiptDetail/);
  });

  it("FAILS CLOSED without readAcceptedDetail", async () => {
    const c = createStage3CLiveMatrixContext();
    c.privacyReceiptDetail = makeDetail({ withReceipt: true });
    await expect(STAGE3C_PRIVACY_HANDLERS["PRIVACY-13"](c)).rejects.toThrow(
      /readAcceptedDetail/,
    );
  });

  it("detects leak in the ordinary READ payload", async () => {
    const ctx = ctxWithBoth();
    (ctx.readAcceptedDetail as unknown as { payment: Record<string, unknown> }).payment.proof_url =
      "x";
    await expect(STAGE3C_PRIVACY_HANDLERS["PRIVACY-13"](ctx)).rejects.toThrow(
      /read payload contains forbidden key "proof_url"/,
    );
  });

  it("detects leak in the receipt-bearing payload", async () => {
    const ctx = ctxWithBoth();
    (ctx.privacyReceiptDetail as unknown as { receipt: Record<string, unknown> }).receipt.issued_by =
      "u";
    await expect(STAGE3C_PRIVACY_HANDLERS["PRIVACY-13"](ctx)).rejects.toThrow(
      /receipt payload contains forbidden key "issued_by"/,
    );
  });

  it("finds forbidden keys inside nested arrays", () => {
    const root = { payment: { history: [{ ok: 1 }, { proof_url: "x" }] } };
    const hit = findForbiddenKeyPath(root, STAGE3C_FORBIDDEN_KEYS_ALL);
    expect(hit?.key).toBe("proof_url");
    expect(hit?.path).toContain("[1]");
  });

  it("finds forbidden keys at depth", () => {
    const root = { a: { b: { c: { verified_by: "u" } } } };
    const hit = findForbiddenKeyPath(root, STAGE3C_FORBIDDEN_KEYS_ALL);
    expect(hit?.key).toBe("verified_by");
    expect(hit?.path).toBe("$.a.b.c.verified_by");
  });

  it("does not scan string values as keys", () => {
    const root = { safe_field: "proof_url looks like a key but isn't" };
    expect(findForbiddenKeyPath(root, STAGE3C_FORBIDDEN_KEYS_ALL)).toBeNull();
  });

  it("does not flag safe similarly-named fields", () => {
    const root = { proof: "x", reference_no: "y", verification_at: "z" };
    expect(findForbiddenKeyPath(root, STAGE3C_FORBIDDEN_KEYS_ALL)).toBeNull();
  });

  it("tolerates cycles without infinite recursion", () => {
    const root: Record<string, unknown> = { a: 1 };
    root.self = root;
    expect(findForbiddenKeyPath(root, STAGE3C_FORBIDDEN_KEYS_ALL)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 8) PRIVACY-14..16 parser rejects a single injected field on a COMPLETE
//    valid cloned payload (defect #4)
// ---------------------------------------------------------------------------

describe("PRIVACY-14..16 production parser injection", () => {
  it("PRIVACY-14 rejects injected payment.proof_url", async () => {
    await expect(
      STAGE3C_PRIVACY_HANDLERS["PRIVACY-14"](ctxOnlyRead()),
    ).resolves.toBeUndefined();
  });

  it("PRIVACY-15 rejects injected receipt.issued_by (real receipt)", async () => {
    await expect(
      STAGE3C_PRIVACY_HANDLERS["PRIVACY-15"](ctxWithBoth()),
    ).resolves.toBeUndefined();
  });

  it("PRIVACY-15 FAILS CLOSED without privacyReceiptDetail", async () => {
    await expect(
      STAGE3C_PRIVACY_HANDLERS["PRIVACY-15"](ctxOnlyRead()),
    ).rejects.toThrow(/privacyReceiptDetail/);
  });

  it("PRIVACY-15 FAILS CLOSED when receipt on primed detail is null", async () => {
    const ctx = ctxWithBoth();
    (ctx.privacyReceiptDetail as unknown as { receipt: null }).receipt = null;
    await expect(STAGE3C_PRIVACY_HANDLERS["PRIVACY-15"](ctx)).rejects.toThrow(
      /must be a real issued receipt/,
    );
  });

  it("PRIVACY-16 rejects injected receipt.voided_by (real receipt)", async () => {
    await expect(
      STAGE3C_PRIVACY_HANDLERS["PRIVACY-16"](ctxWithBoth()),
    ).resolves.toBeUndefined();
  });

  it("PRIVACY-16 FAILS CLOSED without privacyReceiptDetail", async () => {
    await expect(
      STAGE3C_PRIVACY_HANDLERS["PRIVACY-16"](ctxOnlyRead()),
    ).rejects.toThrow(/privacyReceiptDetail/);
  });

  it("production parser rejects proof_url on the resident branch (direct)", () => {
    const raw = makeDetail({ withReceipt: true }) as unknown as Record<string, unknown>;
    const mutated = {
      ...raw,
      payment: { ...(raw.payment as Record<string, unknown>), proof_url: "x" },
    };
    expect(() => parsePaymentDetailResponse(mutated)).toThrow();
  });

  it("production parser rejects receipt.issued_by (direct)", () => {
    const raw = makeDetail({ withReceipt: true }) as unknown as Record<string, unknown>;
    const mutated = {
      ...raw,
      receipt: { ...(raw.receipt as Record<string, unknown>), issued_by: "u" },
    };
    expect(() => parsePaymentDetailResponse(mutated)).toThrow();
  });

  it("production parser rejects receipt.voided_by (direct)", () => {
    const raw = makeDetail({ withReceipt: true }) as unknown as Record<string, unknown>;
    const mutated = {
      ...raw,
      receipt: { ...(raw.receipt as Record<string, unknown>), voided_by: "u" },
    };
    expect(() => parsePaymentDetailResponse(mutated)).toThrow();
  });

  it("PRIVACY-14 does not mutate the accepted READ payload", async () => {
    const ctx = ctxOnlyRead();
    const snap = JSON.stringify(ctx.readAcceptedDetail);
    await STAGE3C_PRIVACY_HANDLERS["PRIVACY-14"](ctx);
    expect(JSON.stringify(ctx.readAcceptedDetail)).toBe(snap);
  });

  it("PRIVACY-15 does not mutate the receipt-bearing payload", async () => {
    const ctx = ctxWithBoth();
    const snap = JSON.stringify(ctx.privacyReceiptDetail);
    await STAGE3C_PRIVACY_HANDLERS["PRIVACY-15"](ctx);
    expect(JSON.stringify(ctx.privacyReceiptDetail)).toBe(snap);
  });

  it("PRIVACY-16 does not mutate the receipt-bearing payload", async () => {
    const ctx = ctxWithBoth();
    const snap = JSON.stringify(ctx.privacyReceiptDetail);
    await STAGE3C_PRIVACY_HANDLERS["PRIVACY-16"](ctx);
    expect(JSON.stringify(ctx.privacyReceiptDetail)).toBe(snap);
  });
});

// ---------------------------------------------------------------------------
// 9) Full-suite state invariance — no privacy handler mutates any context
// ---------------------------------------------------------------------------

describe("Privacy suite: complete state invariance", () => {
  it("running every handler leaves both context payloads byte-identical", async () => {
    const ctx = ctxWithBoth();
    const readSnap = JSON.stringify(ctx.readAcceptedDetail);
    const receiptSnap = JSON.stringify(ctx.privacyReceiptDetail);
    for (const id of STAGE3C_PRIVACY_CASE_IDS) {
      await STAGE3C_PRIVACY_HANDLERS[id](ctx);
    }
    expect(JSON.stringify(ctx.readAcceptedDetail)).toBe(readSnap);
    expect(JSON.stringify(ctx.privacyReceiptDetail)).toBe(receiptSnap);
  });
});

// ---------------------------------------------------------------------------
// 10) Source-level architectural prohibitions
// ---------------------------------------------------------------------------

describe("PRIVACY source validator", () => {
  it("does not import Vitest", () => {
    expect(/from\s+["']vitest["']/.test(PRIVACY_MODULE_SRC)).toBe(false);
  });

  it("does not perform Supabase RPC or table mutations", () => {
    for (const op of [".rpc(", ".insert(", ".update(", ".delete(", ".upsert("]) {
      expect(PRIVACY_MODULE_SRC.includes(op)).toBe(false);
    }
  });

  it("does not call payment mutation helpers", () => {
    for (const forbidden of [
      "submitOfflinePayment",
      "verifyOfflinePayment",
      "rejectOfflinePayment",
      "reverseOfflinePayment",
      "submitResidentBankTransfer",
    ]) {
      expect(PRIVACY_MODULE_SRC.includes(forbidden)).toBe(false);
    }
  });

  it("does not reference REJECTION/REVERSAL/SEARCH/CLEANUP or Stage 3D", () => {
    for (const forbidden of [
      "REJECTION-",
      "REVERSAL-",
      "SEARCH-",
      "CLEANUP-",
      "Stage 3D",
      "ledger",
      "reconciliation",
      "treasurer",
    ]) {
      expect(PRIVACY_MODULE_SRC.toLowerCase().includes(forbidden.toLowerCase())).toBe(false);
    }
  });

  it("does not use the old mutable-Set pattern", () => {
    // Object.freeze(new Set(...)) is not real immutability.
    expect(/Object\.freeze\s*\(\s*new\s+Set/.test(PRIVACY_MODULE_SRC)).toBe(false);
  });

  it("does not contain protected society identity", () => {
    const protectedId = process.env.SOCIOHUB_PROTECTED_SOCIETY_ID;
    if (protectedId && protectedId.length > 0) {
      expect(PRIVACY_MODULE_SRC.includes(protectedId)).toBe(false);
    }
    expect(PRIVACY_MODULE_SRC.includes("SOCIOHUB_PROTECTED_SOCIETY_ID")).toBe(false);
  });
});
