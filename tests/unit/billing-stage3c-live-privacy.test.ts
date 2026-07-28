/**
 * Stage 3C — PRIVACY-01..16 direct behavioral tests.
 *
 * Direct proofs against the production `residentPaymentDetailSchema` and
 * `parsePaymentDetailResponse`. No live Supabase, no fixture — every
 * assertion runs against the strict production parser or the exported
 * handler map.
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

function ctxWithDetail(detail: ResidentPaymentDetail): Stage3CLiveMatrixContext {
  const c = createStage3CLiveMatrixContext();
  c.readAcceptedDetail = detail;
  return c;
}

// ---------------------------------------------------------------------------
// 1) Registry / exhaustiveness
// ---------------------------------------------------------------------------

describe("PRIVACY registry", () => {
  const EXPECTED_ORDER: readonly Stage3CPrivacyCaseId[] = [
    "PRIVACY-01",
    "PRIVACY-02",
    "PRIVACY-03",
    "PRIVACY-04",
    "PRIVACY-05",
    "PRIVACY-06",
    "PRIVACY-07",
    "PRIVACY-08",
    "PRIVACY-09",
    "PRIVACY-10",
    "PRIVACY-11",
    "PRIVACY-12",
    "PRIVACY-13",
    "PRIVACY-14",
    "PRIVACY-15",
    "PRIVACY-16",
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

  it("forbidden key sets are frozen (immutable)", () => {
    expect(Object.isFrozen(STAGE3C_FORBIDDEN_PAYMENT_KEYS)).toBe(true);
    expect(Object.isFrozen(STAGE3C_FORBIDDEN_RECEIPT_KEYS)).toBe(true);
    expect(Object.isFrozen(STAGE3C_FORBIDDEN_PAYER_KEYS)).toBe(true);
    expect(Object.isFrozen(STAGE3C_FORBIDDEN_KEYS_ALL)).toBe(true);
  });

  it("combined forbidden key set includes payment/receipt/payer subsets", () => {
    for (const k of STAGE3C_FORBIDDEN_PAYMENT_KEYS) {
      expect(STAGE3C_FORBIDDEN_KEYS_ALL.has(k)).toBe(true);
    }
    for (const k of STAGE3C_FORBIDDEN_RECEIPT_KEYS) {
      expect(STAGE3C_FORBIDDEN_KEYS_ALL.has(k)).toBe(true);
    }
    for (const k of STAGE3C_FORBIDDEN_PAYER_KEYS) {
      expect(STAGE3C_FORBIDDEN_KEYS_ALL.has(k)).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// 2) PRIVACY-01..07 payment field omissions (positive + negative)
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
    it(`${id} passes when payment omits ${key}`, async () => {
      const ctx = ctxWithDetail(makeDetail({ withReceipt: true }));
      await expect(STAGE3C_PRIVACY_HANDLERS[id](ctx)).resolves.toBeUndefined();
    });

    it(`${id} fails when payment includes ${key} (post-parse mutation)`, async () => {
      const detail = makeDetail({ withReceipt: true });
      const leak = detail as unknown as { payment: Record<string, unknown> };
      leak.payment[key] = "leaked-value";
      const ctx = ctxWithDetail(detail);
      await expect(STAGE3C_PRIVACY_HANDLERS[id](ctx)).rejects.toThrow(
        new RegExp(`resident payment payload must omit "${key}"`),
      );
    });

    it(`${id} does not print leaked value on failure`, async () => {
      const detail = makeDetail({ withReceipt: true });
      const leak = detail as unknown as { payment: Record<string, unknown> };
      leak.payment[key] = "SECRET-LEAKED-VALUE-XYZ";
      const ctx = ctxWithDetail(detail);
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
    const ctx = ctxWithDetail(makeDetail({ withReceipt: true }));
    await expect(STAGE3C_PRIVACY_HANDLERS["PRIVACY-07"](ctx)).resolves.toBeUndefined();
  });

  for (const key of ["notes", "verification_notes"]) {
    it(`fails when ${key} is present`, async () => {
      const detail = makeDetail({ withReceipt: true });
      (detail as unknown as { payment: Record<string, unknown> }).payment[key] = "x";
      const ctx = ctxWithDetail(detail);
      await expect(STAGE3C_PRIVACY_HANDLERS["PRIVACY-07"](ctx)).rejects.toThrow(
        new RegExp(`must omit "${key}"`),
      );
    });
  }

  it("does not incorrectly flag rejection_reason (resident-safe field)", async () => {
    const detail = makeDetail({ withReceipt: true });
    (detail as unknown as { payment: Record<string, unknown> }).payment.rejection_reason =
      "Bounced";
    const ctx = ctxWithDetail(detail);
    await expect(STAGE3C_PRIVACY_HANDLERS["PRIVACY-07"](ctx)).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 3) PRIVACY-08..12 receipt / payer omissions
// ---------------------------------------------------------------------------

const RECEIPT_CASES: Array<[Stage3CPrivacyCaseId, string]> = [
  ["PRIVACY-08", "id"],
  ["PRIVACY-09", "issued_by"],
  ["PRIVACY-10", "voided_by"],
];

describe("PRIVACY-08..10 receipt field omissions", () => {
  for (const [id, key] of RECEIPT_CASES) {
    it(`${id} passes when receipt omits ${key}`, async () => {
      const ctx = ctxWithDetail(makeDetail({ withReceipt: true }));
      await expect(STAGE3C_PRIVACY_HANDLERS[id](ctx)).resolves.toBeUndefined();
    });

    it(`${id} is a no-op when receipt is null`, async () => {
      const ctx = ctxWithDetail(makeDetail({ withReceipt: false }));
      await expect(STAGE3C_PRIVACY_HANDLERS[id](ctx)).resolves.toBeUndefined();
    });

    it(`${id} fails when receipt includes ${key}`, async () => {
      const detail = makeDetail({ withReceipt: true });
      (detail as unknown as { receipt: Record<string, unknown> }).receipt[key] = "x";
      const ctx = ctxWithDetail(detail);
      await expect(STAGE3C_PRIVACY_HANDLERS[id](ctx)).rejects.toThrow(
        new RegExp(`resident receipt payload must omit "${key}"`),
      );
    });
  }
});

describe("PRIVACY-11 receipt sequence internals", () => {
  it("passes on a clean payload", async () => {
    const ctx = ctxWithDetail(makeDetail({ withReceipt: true }));
    await expect(STAGE3C_PRIVACY_HANDLERS["PRIVACY-11"](ctx)).resolves.toBeUndefined();
  });

  for (const key of ["sequence_id", "sequence_key", "next_number", "year", "year_month"]) {
    it(`fails when receipt has ${key}`, async () => {
      const detail = makeDetail({ withReceipt: true });
      (detail as unknown as { receipt: Record<string, unknown> }).receipt[key] = "x";
      const ctx = ctxWithDetail(detail);
      await expect(STAGE3C_PRIVACY_HANDLERS["PRIVACY-11"](ctx)).rejects.toThrow(
        /sequence internal/,
      );
    });
  }
});

describe("PRIVACY-12 payer snapshot / raw uuid", () => {
  it("passes on a clean payload", async () => {
    const ctx = ctxWithDetail(makeDetail({ withReceipt: true }));
    await expect(STAGE3C_PRIVACY_HANDLERS["PRIVACY-12"](ctx)).resolves.toBeUndefined();
  });

  for (const key of ["payer_snapshot_id", "payer_user_id", "user_id"]) {
    it(`fails when payment has ${key}`, async () => {
      const detail = makeDetail({ withReceipt: true });
      (detail as unknown as { payment: Record<string, unknown> }).payment[key] = "x";
      const ctx = ctxWithDetail(detail);
      await expect(STAGE3C_PRIVACY_HANDLERS["PRIVACY-12"](ctx)).rejects.toThrow(
        /payer identity key/,
      );
    });
  }
});

// ---------------------------------------------------------------------------
// 4) PRIVACY-13 recursive scan
// ---------------------------------------------------------------------------

describe("PRIVACY-13 recursive scan", () => {
  it("passes on a clean payload", async () => {
    const ctx = ctxWithDetail(makeDetail({ withReceipt: true }));
    await expect(STAGE3C_PRIVACY_HANDLERS["PRIVACY-13"](ctx)).resolves.toBeUndefined();
  });

  it("finds forbidden keys inside nested arrays", () => {
    const root = {
      payment: { history: [{ ok: 1 }, { proof_url: "x" }] },
    };
    const hit = findForbiddenKeyPath(root, STAGE3C_FORBIDDEN_KEYS_ALL);
    expect(hit).not.toBeNull();
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

  it("does not flag safe fields with similar names", () => {
    const root = { proof: "x", reference_no: "y", verification_at: "z" };
    expect(findForbiddenKeyPath(root, STAGE3C_FORBIDDEN_KEYS_ALL)).toBeNull();
  });

  it("tolerates cycles without throwing", () => {
    const root: Record<string, unknown> = { a: 1 };
    root.self = root;
    expect(findForbiddenKeyPath(root, STAGE3C_FORBIDDEN_KEYS_ALL)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 5) PRIVACY-14..16 production parser injection rejection
// ---------------------------------------------------------------------------

describe("PRIVACY-14..16 parser injection rejection", () => {
  it("PRIVACY-14 rejects injected payment.proof_url", async () => {
    const ctx = ctxWithDetail(makeDetail({ withReceipt: true }));
    await expect(STAGE3C_PRIVACY_HANDLERS["PRIVACY-14"](ctx)).resolves.toBeUndefined();
  });

  it("PRIVACY-15 rejects injected receipt.issued_by", async () => {
    const ctx = ctxWithDetail(makeDetail({ withReceipt: true }));
    await expect(STAGE3C_PRIVACY_HANDLERS["PRIVACY-15"](ctx)).resolves.toBeUndefined();
  });

  it("PRIVACY-15 works even with null receipt (injects one)", async () => {
    const ctx = ctxWithDetail(makeDetail({ withReceipt: false }));
    await expect(STAGE3C_PRIVACY_HANDLERS["PRIVACY-15"](ctx)).resolves.toBeUndefined();
  });

  it("PRIVACY-16 rejects injected receipt.voided_by", async () => {
    const ctx = ctxWithDetail(makeDetail({ withReceipt: true }));
    await expect(STAGE3C_PRIVACY_HANDLERS["PRIVACY-16"](ctx)).resolves.toBeUndefined();
  });

  it("production parser rejects proof_url on the resident branch (direct call)", () => {
    const raw = makeDetail({ withReceipt: true }) as unknown as Record<string, unknown>;
    const mutated = {
      ...raw,
      payment: { ...(raw["payment"] as Record<string, unknown>), proof_url: "x" },
    };
    expect(() => parsePaymentDetailResponse(mutated)).toThrow();
  });

  it("production parser rejects receipt.issued_by (direct call)", () => {
    const raw = makeDetail({ withReceipt: true }) as unknown as Record<string, unknown>;
    const mutated = {
      ...raw,
      receipt: { ...(raw["receipt"] as Record<string, unknown>), issued_by: "u" },
    };
    expect(() => parsePaymentDetailResponse(mutated)).toThrow();
  });

  it("production parser rejects receipt.voided_by (direct call)", () => {
    const raw = makeDetail({ withReceipt: true }) as unknown as Record<string, unknown>;
    const mutated = {
      ...raw,
      receipt: { ...(raw["receipt"] as Record<string, unknown>), voided_by: "u" },
    };
    expect(() => parsePaymentDetailResponse(mutated)).toThrow();
  });

  it("PRIVACY-14 does not mutate the accepted context payload", async () => {
    const detail = makeDetail({ withReceipt: true });
    const snapshot = JSON.stringify(detail);
    const ctx = ctxWithDetail(detail);
    await STAGE3C_PRIVACY_HANDLERS["PRIVACY-14"](ctx);
    expect(JSON.stringify(ctx.readAcceptedDetail)).toBe(snapshot);
  });

  it("PRIVACY-15 does not mutate the accepted context payload", async () => {
    const detail = makeDetail({ withReceipt: true });
    const snapshot = JSON.stringify(detail);
    const ctx = ctxWithDetail(detail);
    await STAGE3C_PRIVACY_HANDLERS["PRIVACY-15"](ctx);
    expect(JSON.stringify(ctx.readAcceptedDetail)).toBe(snapshot);
  });

  it("PRIVACY-16 does not mutate the accepted context payload", async () => {
    const detail = makeDetail({ withReceipt: true });
    const snapshot = JSON.stringify(detail);
    const ctx = ctxWithDetail(detail);
    await STAGE3C_PRIVACY_HANDLERS["PRIVACY-16"](ctx);
    expect(JSON.stringify(ctx.readAcceptedDetail)).toBe(snapshot);
  });
});

// ---------------------------------------------------------------------------
// 6) Missing/malformed context — fail closed
// ---------------------------------------------------------------------------

describe("PRIVACY fail-closed on missing context", () => {
  for (const id of STAGE3C_PRIVACY_CASE_IDS) {
    it(`${id} throws when readAcceptedDetail is null`, async () => {
      const ctx = createStage3CLiveMatrixContext();
      await expect(STAGE3C_PRIVACY_HANDLERS[id](ctx)).rejects.toThrow();
    });
  }
});

// ---------------------------------------------------------------------------
// 7) Source-level architectural prohibitions
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

  it("does not contain protected society identity", () => {
    const protectedId = process.env.SOCIOHUB_PROTECTED_SOCIETY_ID;
    if (protectedId && protectedId.length > 0) {
      expect(PRIVACY_MODULE_SRC.includes(protectedId)).toBe(false);
    }
    expect(PRIVACY_MODULE_SRC.includes("SOCIOHUB_PROTECTED_SOCIETY_ID")).toBe(false);
  });

  it("uses `satisfies Record` on the handler map", () => {
    expect(
      /satisfies\s+Record<\s*Stage3CPrivacyCaseId\s*,\s*Stage3CMatrixLiveHandler\s*>/.test(
        PRIVACY_MODULE_SRC,
      ),
    ).toBe(true);
  });

  it("declares exactly the sixteen canonical PRIVACY ids inline", () => {
    for (let i = 1; i <= 16; i++) {
      const id = `PRIVACY-${String(i).padStart(2, "0")}`;
      expect(PRIVACY_MODULE_SRC.includes(`"${id}"`)).toBe(true);
    }
  });

  it("imports the real production parser", () => {
    expect(PRIVACY_MODULE_SRC.includes("parsePaymentDetailResponse")).toBe(true);
    expect(
      /from\s+["']@\/lib\/offline-payments\.functions["']/.test(PRIVACY_MODULE_SRC),
    ).toBe(true);
  });
});
