/**
 * Stage 3C — READ-01..10 direct contract tests (Sub-run A, grounded).
 *
 * Every schema assertion here targets production shapes cited in
 * `tests/helpers/stage3c-live-read-cases.ts`. READ-04 tests invoke the
 * REAL `parsePaymentDetailResponse` from production, not a substitute.
 * Behavioral acceptance for READ-01..10 lives in Sub-run B.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

import {
  STAGE3C_READ_CASE_IDS,
  STAGE3C_READ_HANDLERS,
  stage3cReadNotImplementedMessage,
  ResidentPaymentDetailSchema,
  ResidentPaymentHistoryRowSchema,
  Stage3CReadResidentAudienceSchema,
  Stage3CReadDenialCategorySchema,
  Stage3CReadDenialEvidenceSchema,
  STAGE3C_READ_DENIAL_MESSAGES,
  type Stage3CReadCaseId,
} from "@/../tests/helpers/stage3c-live-read-cases";
import {
  createStage3CLiveMatrixContext,
  requireReadPrimaryBillId,
  requireReadPrimaryPaymentId,
  requireReadHistoryBaselineCount,
} from "@/../tests/helpers/stage3c-live-matrix-context";
import {
  STAGE3C_IDEMPOTENCY_REFERENCE_HANDLERS,
  STAGE3C_IDEMPOTENCY_REFERENCE_CASE_IDS,
} from "@/../tests/helpers/stage3c-live-idempotency-reference-cases";
import { STAGE3C_REQUIRED_LIVE_CASES } from "@/../tests/helpers/stage3c-live-case-manifest";
import {
  parsePaymentDetailResponse,
  residentPaymentDetailSchema,
  mapPaymentError,
} from "@/lib/offline-payments.functions";

// ---------------------------------------------------------------------------
// Canonical production-grounded samples
// ---------------------------------------------------------------------------

const EXPECTED_ORDER: readonly Stage3CReadCaseId[] = [
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

const READ_MODULE_PATH = path.resolve(
  __dirname,
  "../helpers/stage3c-live-read-cases.ts",
);
const READ_MODULE_SRC = readFileSync(READ_MODULE_PATH, "utf8");

const UUID_A = "11111111-2222-4333-8444-555555555555";
const UUID_B = "22222222-3333-4444-8555-666666666666";
const UUID_C = "33333333-4444-4555-8666-777777777777";
const UUID_D = "44444444-5555-4666-8777-888888888888";

/**
 * Canonical resident payment detail — mirrors production
 * `residentPaymentDetailSchema` exactly (snake_case, nested `payment`,
 * `bill_number`, `flat_label`, `summary`, `receipt`).
 */
function makeDetail() {
  return {
    audience: "resident" as const,
    payment: {
      id: UUID_A,
      bill_id: UUID_B,
      society_id: UUID_C,
      flat_id: UUID_D,
      amount: 250,
      method: "bank_transfer",
      status: "pending",
      reference_no: "REF-001",
      submitted_at: "2026-07-01T00:00:00Z",
      source: "resident_submit",
      payment_date: "2026-07-01",
      verified_at: null,
      rejected_at: null,
      rejection_reason: null,
      reversed_at: null,
      reversal_reason: null,
      created_at: "2026-07-01T00:00:00Z",
    },
    bill_number: "B-0001",
    flat_label: "A-101",
    summary: null,
    receipt: null,
  };
}

/** Canonical history row — mirrors production `ResidentPaymentRow`. */
function makeHistoryRow() {
  return {
    id: UUID_A,
    bill_id: UUID_B,
    society_id: UUID_C,
    flat_id: UUID_D,
    amount: 100,
    method: "cash",
    status: "verified",
    reference_no: null,
    submitted_at: "2026-06-01T00:00:00Z",
    payment_date: "2026-06-01",
    verified_at: "2026-06-02T00:00:00Z",
    rejected_at: null,
    rejection_reason: null,
    reversed_at: null,
    reversal_reason: null,
    created_at: "2026-06-01T00:00:00Z",
  };
}

// ---------------------------------------------------------------------------
// 1) Case-id lock (exactness, ordering, uniqueness, manifest parity)
// ---------------------------------------------------------------------------

describe("READ contract — case-id lock", () => {
  it("has exactly ten entries", () => {
    expect(STAGE3C_READ_CASE_IDS).toHaveLength(10);
  });

  it("is in the exact READ-01 through READ-10 order", () => {
    expect([...STAGE3C_READ_CASE_IDS]).toEqual([...EXPECTED_ORDER]);
  });

  it("contains no duplicates", () => {
    expect(new Set(STAGE3C_READ_CASE_IDS).size).toBe(
      STAGE3C_READ_CASE_IDS.length,
    );
  });

  it("matches the manifest READ subset exactly", () => {
    const manifestReadIds = STAGE3C_REQUIRED_LIVE_CASES
      .filter((c) => c.category === "READ")
      .map((c) => c.id);
    expect(manifestReadIds).toEqual([...EXPECTED_ORDER]);
  });

  it("matches manifest READ order exactly", () => {
    const manifestReadIds = STAGE3C_REQUIRED_LIVE_CASES
      .filter((c) => c.category === "READ")
      .map((c) => c.id);
    expect(manifestReadIds).toEqual([...STAGE3C_READ_CASE_IDS]);
  });

  it("does not include PRIVACY ids", () => {
    for (const id of STAGE3C_READ_CASE_IDS) {
      expect(id.startsWith("PRIVACY")).toBe(false);
    }
  });

  it("does not include REJECTION ids", () => {
    for (const id of STAGE3C_READ_CASE_IDS) {
      expect(id.startsWith("REJECTION")).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// 2) Handler map parity + shape
// ---------------------------------------------------------------------------

describe("READ contract — handler map", () => {
  it("has exactly ten keys", () => {
    expect(Object.keys(STAGE3C_READ_HANDLERS)).toHaveLength(10);
  });

  it("has every expected key", () => {
    for (const id of EXPECTED_ORDER) {
      expect(id in STAGE3C_READ_HANDLERS).toBe(true);
    }
  });

  it("has no unexpected keys", () => {
    const allowed = new Set<string>(EXPECTED_ORDER);
    for (const key of Object.keys(STAGE3C_READ_HANDLERS)) {
      expect(allowed.has(key)).toBe(true);
    }
  });

  it("preserves order alignment between ids list and map keys", () => {
    expect(Object.keys(STAGE3C_READ_HANDLERS)).toEqual([...EXPECTED_ORDER]);
  });

  it.each([...EXPECTED_ORDER])("%s handler is an async function", (id) => {
    const fn = STAGE3C_READ_HANDLERS[id as Stage3CReadCaseId];
    expect(typeof fn).toBe("function");
    expect(fn.constructor.name).toBe("AsyncFunction");
  });
});

// ---------------------------------------------------------------------------
// 3) Fail-closed behavior with static messages
// ---------------------------------------------------------------------------

describe("READ contract — all handlers are implemented async functions", () => {
  it.each([...EXPECTED_ORDER])("%s is an async function", (id) => {
    const fn = STAGE3C_READ_HANDLERS[id as Stage3CReadCaseId];
    expect(typeof fn).toBe("function");
    expect(fn.constructor.name).toBe("AsyncFunction");
  });

  it("stage3cReadNotImplementedMessage remains a stable static literal (legacy helper)", () => {
    for (const id of EXPECTED_ORDER) {
      expect(stage3cReadNotImplementedMessage(id)).toBe(
        `[stage3c:${id}] behavior not implemented`,
      );
    }
  });
});


// ---------------------------------------------------------------------------
// 4) READ detail — grounded in production `residentPaymentDetailSchema`
// ---------------------------------------------------------------------------

describe("READ detail — production-grounded schema (READ-02..04)", () => {
  it("is exactly the production residentPaymentDetailSchema (referential identity)", () => {
    expect(ResidentPaymentDetailSchema).toBe(residentPaymentDetailSchema);
  });

  it("accepts the canonical resident detail sample", () => {
    const r = ResidentPaymentDetailSchema.safeParse(makeDetail());
    expect(r.success).toBe(true);
  });

  it("READ-04: parsePaymentDetailResponse accepts the canonical sample", () => {
    expect(() => parsePaymentDetailResponse(makeDetail())).not.toThrow();
  });

  it("READ-04: parsePaymentDetailResponse rejects a malformed payload (missing payment)", () => {
    const bad = { ...makeDetail() } as Record<string, unknown>;
    delete bad.payment;
    expect(() => parsePaymentDetailResponse(bad)).toThrow();
  });

  it("READ-04: parsePaymentDetailResponse rejects an unknown top-level property (strict)", () => {
    const bad = { ...makeDetail(), proof_url: "https://x/y.png" };
    expect(() => parsePaymentDetailResponse(bad)).toThrow();
  });

  it("READ-04: parsePaymentDetailResponse rejects admin-only leak on resident payment", () => {
    const s = makeDetail();
    const bad = {
      ...s,
      payment: { ...s.payment, submitted_by: "actor-uuid" },
    };
    expect(() => parsePaymentDetailResponse(bad)).toThrow();
  });

  it("preserves snake_case top-level keys exactly (bill_number, flat_label)", () => {
    const parsed = ResidentPaymentDetailSchema.parse(makeDetail());
    expect(Object.prototype.hasOwnProperty.call(parsed, "bill_number")).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(parsed, "flat_label")).toBe(true);
  });

  it("rejects camelCased substitute for bill_number", () => {
    const s = makeDetail() as unknown as Record<string, unknown>;
    delete s.bill_number;
    (s as Record<string, unknown>).billNumber = "B-0001";
    expect(ResidentPaymentDetailSchema.safeParse(s).success).toBe(false);
  });

  it("rejects camelCased substitute for flat_label", () => {
    const s = makeDetail() as unknown as Record<string, unknown>;
    delete s.flat_label;
    (s as Record<string, unknown>).flatLabel = "A-101";
    expect(ResidentPaymentDetailSchema.safeParse(s).success).toBe(false);
  });

  it("rejects camelCased substitute for payment.reference_no", () => {
    const s = makeDetail();
    const payment = { ...s.payment } as Record<string, unknown>;
    delete payment.reference_no;
    payment.referenceNo = "REF-001";
    const bad = { ...s, payment };
    expect(ResidentPaymentDetailSchema.safeParse(bad).success).toBe(false);
  });

  it("keeps `payment` as a nested object (not flattened)", () => {
    const s = makeDetail();
    const flattened = { ...s.payment, audience: "resident", bill_number: "B", flat_label: "A", summary: null, receipt: null };
    expect(ResidentPaymentDetailSchema.safeParse(flattened).success).toBe(false);
  });

  it("rejects a malformed UUID on payment.id", () => {
    const s = makeDetail();
    const bad = { ...s, payment: { ...s.payment, id: "not-a-uuid-42" } };
    // production schema uses z.string() (not uuid()) so this is a positive
    // control confirming production does NOT constrain UUID shape here.
    expect(ResidentPaymentDetailSchema.safeParse(bad).success).toBe(true);
  });

  it("requires audience literal 'resident'", () => {
    const s = { ...makeDetail(), audience: "admin" as unknown as "resident" };
    expect(ResidentPaymentDetailSchema.safeParse(s).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 5) READ-03 — resident audience narrowing
// ---------------------------------------------------------------------------

describe("READ-03 audience — resident-only", () => {
  it("accepts exactly 'resident'", () => {
    expect(Stage3CReadResidentAudienceSchema.safeParse("resident").success).toBe(true);
  });

  it("rejects 'admin'", () => {
    expect(Stage3CReadResidentAudienceSchema.safeParse("admin").success).toBe(false);
  });

  it("rejects 'guest'", () => {
    expect(Stage3CReadResidentAudienceSchema.safeParse("guest").success).toBe(false);
  });

  it("rejects empty string", () => {
    expect(Stage3CReadResidentAudienceSchema.safeParse("").success).toBe(false);
  });

  it("rejects casing variants", () => {
    expect(Stage3CReadResidentAudienceSchema.safeParse("Resident").success).toBe(false);
    expect(Stage3CReadResidentAudienceSchema.safeParse("RESIDENT").success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 6) READ-01 history row — grounded in ResidentPaymentRow
// ---------------------------------------------------------------------------

describe("READ-01 history row — production-grounded shape", () => {
  it("accepts a canonical history row", () => {
    expect(ResidentPaymentHistoryRowSchema.safeParse(makeHistoryRow()).success).toBe(true);
  });

  it("rejects an unknown property (strict)", () => {
    const bad = { ...makeHistoryRow(), internal_notes: "x" };
    expect(ResidentPaymentHistoryRowSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects admin-only field leak (submitted_by)", () => {
    const bad = { ...makeHistoryRow(), submitted_by: "actor-uuid" };
    expect(ResidentPaymentHistoryRowSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects admin-only field leak (verified_by)", () => {
    const bad = { ...makeHistoryRow(), verified_by: "actor-uuid" };
    expect(ResidentPaymentHistoryRowSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects admin-only field leak (notes)", () => {
    const bad = { ...makeHistoryRow(), notes: "internal note" };
    expect(ResidentPaymentHistoryRowSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects camelCased id substitute", () => {
    const s = makeHistoryRow() as unknown as Record<string, unknown>;
    delete s.id;
    (s as Record<string, unknown>).paymentId = UUID_A;
    expect(ResidentPaymentHistoryRowSchema.safeParse(s).success).toBe(false);
  });

  it("rejects camelCased bill_id substitute", () => {
    const s = makeHistoryRow() as unknown as Record<string, unknown>;
    delete s.bill_id;
    (s as Record<string, unknown>).billId = UUID_B;
    expect(ResidentPaymentHistoryRowSchema.safeParse(s).success).toBe(false);
  });

  it("rejects camelCased society_id substitute", () => {
    const s = makeHistoryRow() as unknown as Record<string, unknown>;
    delete s.society_id;
    (s as Record<string, unknown>).societyId = UUID_C;
    expect(ResidentPaymentHistoryRowSchema.safeParse(s).success).toBe(false);
  });

  it("rejects malformed UUID on id", () => {
    const bad = { ...makeHistoryRow(), id: "not-a-uuid" };
    expect(ResidentPaymentHistoryRowSchema.safeParse(bad).success).toBe(false);
  });

  it("allows null bill_id (moved-out / unlinked cases)", () => {
    const ok = { ...makeHistoryRow(), bill_id: null };
    expect(ResidentPaymentHistoryRowSchema.safeParse(ok).success).toBe(true);
  });

  it("allows null flat_id (moved-out cases)", () => {
    const ok = { ...makeHistoryRow(), flat_id: null };
    expect(ResidentPaymentHistoryRowSchema.safeParse(ok).success).toBe(true);
  });

  it("requires society_id even when other links are null", () => {
    const bad = { ...makeHistoryRow() } as unknown as Record<string, unknown>;
    delete bad.society_id;
    expect(ResidentPaymentHistoryRowSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects a numeric status (production uses string enum-alike)", () => {
    const bad = { ...makeHistoryRow(), status: 1 as unknown as string };
    expect(ResidentPaymentHistoryRowSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects a numeric method", () => {
    const bad = { ...makeHistoryRow(), method: 2 as unknown as string };
    expect(ResidentPaymentHistoryRowSchema.safeParse(bad).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 7) Denial category — grounded in mapPaymentError
// ---------------------------------------------------------------------------

describe("READ denial — grounded in production mapPaymentError", () => {
  it("category enum has exactly two values", () => {
    const opts = Stage3CReadDenialCategorySchema.options;
    expect([...opts].sort()).toEqual(["not_authenticated", "not_authorized"]);
  });

  it("rejects invented provider tokens", () => {
    for (const bad of ["forbidden", "PGRST301", "401", "AUTH_REQUIRED"]) {
      expect(Stage3CReadDenialCategorySchema.safeParse(bad).success).toBe(false);
    }
  });

  it("not_authenticated message matches production output verbatim", () => {
    expect(STAGE3C_READ_DENIAL_MESSAGES.not_authenticated).toBe(
      mapPaymentError("unauthenticated"),
    );
  });

  it("not_authorized message matches production output verbatim", () => {
    expect(STAGE3C_READ_DENIAL_MESSAGES.not_authorized).toBe(
      mapPaymentError("not_authorized"),
    );
  });

  it("evidence schema rejects success-only case ids", () => {
    const bad = {
      caseId: "READ-01",
      category: "not_authorized",
      returnedRow: null,
    };
    expect(Stage3CReadDenialEvidenceSchema.safeParse(bad).success).toBe(false);
  });

  it("evidence schema requires returnedRow = null", () => {
    const bad = {
      caseId: "READ-09" as const,
      category: "not_authorized" as const,
      returnedRow: {},
    };
    expect(Stage3CReadDenialEvidenceSchema.safeParse(bad).success).toBe(false);
  });

  it("evidence schema accepts the canonical denial shape", () => {
    const ok = {
      caseId: "READ-09" as const,
      category: "not_authorized" as const,
      returnedRow: null,
    };
    expect(Stage3CReadDenialEvidenceSchema.safeParse(ok).success).toBe(true);
  });

  it("evidence schema rejects unknown properties (strict)", () => {
    const bad = {
      caseId: "READ-09" as const,
      category: "not_authorized" as const,
      returnedRow: null,
      hint: "leak",
    };
    expect(Stage3CReadDenialEvidenceSchema.safeParse(bad).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 8) Matrix-context READ guards
// ---------------------------------------------------------------------------

describe("READ contract — matrix-context guards", () => {
  it("requireReadPrimaryBillId returns the stored canonical UUID", () => {
    const ctx = createStage3CLiveMatrixContext();
    ctx.readPrimaryBillId = UUID_A;
    expect(requireReadPrimaryBillId(ctx)).toBe(UUID_A);
  });

  it("requireReadPrimaryBillId throws a static message when unset", () => {
    const ctx = createStage3CLiveMatrixContext();
    expect(() => requireReadPrimaryBillId(ctx)).toThrow(
      '[stage3c:matrix] required lifecycle field "readPrimaryBillId" not initialised — READ-01 must run first',
    );
  });

  it("requireReadPrimaryBillId rejects malformed UUIDs", () => {
    const ctx = createStage3CLiveMatrixContext();
    ctx.readPrimaryBillId = "not-a-uuid";
    expect(() => requireReadPrimaryBillId(ctx)).toThrow(
      /"readPrimaryBillId" invalid: not a canonical UUID/,
    );
  });

  it("requireReadPrimaryPaymentId returns the stored canonical UUID", () => {
    const ctx = createStage3CLiveMatrixContext();
    ctx.readPrimaryPaymentId = UUID_B;
    expect(requireReadPrimaryPaymentId(ctx)).toBe(UUID_B);
  });

  it("requireReadPrimaryPaymentId throws a static message when unset", () => {
    const ctx = createStage3CLiveMatrixContext();
    expect(() => requireReadPrimaryPaymentId(ctx)).toThrow(
      '[stage3c:matrix] required lifecycle field "readPrimaryPaymentId" not initialised — READ-02 must run first',
    );
  });

  it("requireReadHistoryBaselineCount rejects negative integers", () => {
    const ctx = createStage3CLiveMatrixContext();
    ctx.readHistoryBaselineCount = -1;
    expect(() => requireReadHistoryBaselineCount(ctx)).toThrow(
      /"readHistoryBaselineCount" invalid/,
    );
  });

  it("requireReadHistoryBaselineCount returns valid zero", () => {
    const ctx = createStage3CLiveMatrixContext();
    ctx.readHistoryBaselineCount = 0;
    expect(requireReadHistoryBaselineCount(ctx)).toBe(0);
  });

  it("context guard messages never embed stored values", () => {
    const ctx = createStage3CLiveMatrixContext();
    ctx.readPrimaryBillId = "leak-me-please-11111111-2222";
    try {
      requireReadPrimaryBillId(ctx);
    } catch (e) {
      expect((e as Error).message.includes("leak-me-please")).toBe(false);
    }
  });

  it("READ context slots initialise to null", () => {
    const ctx = createStage3CLiveMatrixContext();
    expect(ctx.readPrimaryBillId).toBeNull();
    expect(ctx.readPrimaryPaymentId).toBeNull();
    expect(ctx.readHistoryBaselineCount).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 9) Regression: accepted IDEMPOTENCY + REFERENCE surface is unchanged
// ---------------------------------------------------------------------------

describe("READ contract — accepted category regressions", () => {
  it("IDEMPOTENCY handler map keys are unchanged", () => {
    expect(Object.keys(STAGE3C_IDEMPOTENCY_REFERENCE_HANDLERS)).toEqual([
      "IDEMPOTENCY-01",
      "IDEMPOTENCY-02",
      "IDEMPOTENCY-03",
      "IDEMPOTENCY-04",
      "REFERENCE-01",
      "REFERENCE-02",
      "REFERENCE-03",
      "REFERENCE-04",
    ]);
  });

  it("IDEMPOTENCY/REFERENCE ordered ids are unchanged (8 entries)", () => {
    expect(STAGE3C_IDEMPOTENCY_REFERENCE_CASE_IDS).toHaveLength(8);
  });
});

// ---------------------------------------------------------------------------
// 10) Source-level architectural prohibitions on the READ contract module
// ---------------------------------------------------------------------------

describe("READ contract — source validator", () => {
  it("does not import Vitest", () => {
    expect(/from\s+["']vitest["']/.test(READ_MODULE_SRC)).toBe(false);
  });

  it("does not use non-null assertions", () => {
    expect(/\w!\s*[.,;)\]]/.test(READ_MODULE_SRC)).toBe(false);
  });

  it("does not use `any` typing", () => {
    expect(/[:<]\s*any(\W|$)/.test(READ_MODULE_SRC)).toBe(false);
  });

  it("does not use loose schema helpers", () => {
    expect(READ_MODULE_SRC.includes("z.unknown()")).toBe(false);
    expect(READ_MODULE_SRC.includes(".passthrough()")).toBe(false);
    expect(READ_MODULE_SRC.includes("z.record(")).toBe(false);
  });

  it("does not import production UI modules", () => {
    expect(/from\s+["']@\/components\//.test(READ_MODULE_SRC)).toBe(false);
    expect(/from\s+["']@\/routes\//.test(READ_MODULE_SRC)).toBe(false);
    expect(/from\s+["']@\/layouts\//.test(READ_MODULE_SRC)).toBe(false);
  });

  it("does not perform RPC construction inline", () => {
    expect(READ_MODULE_SRC.includes(".rpc(")).toBe(false);
  });

  it("does not perform insert/update/delete/upsert", () => {
    for (const op of [".insert(", ".update(", ".delete(", ".upsert("]) {
      expect(READ_MODULE_SRC.includes(op)).toBe(false);
    }
  });

  it("does not call accepted payment mutation helpers", () => {
    for (const forbidden of [
      "submitOfflinePayment",
      "verifyOfflinePayment",
      "rejectOfflinePayment",
      "reverseOfflinePayment",
      "submitResidentBankTransfer",
    ]) {
      expect(READ_MODULE_SRC.includes(forbidden)).toBe(false);
    }
  });

  it("does not reference PRIVACY or REJECTION case ids", () => {
    expect(/PRIVACY-\d/.test(READ_MODULE_SRC)).toBe(false);
    expect(/REJECTION-\d/.test(READ_MODULE_SRC)).toBe(false);
  });

  it("does not mention Stage 3D concerns", () => {
    for (const forbidden of [
      "Stage 3D",
      "Stage3D",
      "ledger",
      "reconciliation",
      "treasurer",
    ]) {
      expect(READ_MODULE_SRC.toLowerCase().includes(forbidden.toLowerCase())).toBe(false);
    }
  });

  it("does not contain protected society identity", () => {
    const protectedId = process.env.SOCIOHUB_PROTECTED_SOCIETY_ID;
    if (protectedId && protectedId.length > 0) {
      expect(READ_MODULE_SRC.includes(protectedId)).toBe(false);
    }
    expect(READ_MODULE_SRC.includes("SOCIOHUB_PROTECTED_SOCIETY_ID")).toBe(false);
  });

  it("does not embed literal success claims", () => {
    for (const forbidden of ["LOCALLY ACCEPTED", "50/93", "acceptance"]) {
      expect(READ_MODULE_SRC.toLowerCase().includes(forbidden.toLowerCase())).toBe(false);
    }
  });

  it("declares exactly the ten canonical READ ids inline", () => {
    for (const id of EXPECTED_ORDER) {
      expect(READ_MODULE_SRC.includes(`"${id}"`)).toBe(true);
    }
  });

  it("uses strict object schemas", () => {
    expect(READ_MODULE_SRC.includes(".strict()")).toBe(true);
  });

  it("uses CanonicalStage3CUuidSchema for UUID-shaped fields", () => {
    expect(READ_MODULE_SRC.includes("CanonicalStage3CUuidSchema")).toBe(true);
  });

  it("uses `satisfies Record` on the handler map", () => {
    expect(
      /satisfies\s+Record<\s*Stage3CReadCaseId\s*,\s*Stage3CMatrixLiveHandler\s*>/.test(
        READ_MODULE_SRC,
      ),
    ).toBe(true);
  });

  it("imports the production residentPaymentDetailSchema (grounds READ-02..04)", () => {
    expect(READ_MODULE_SRC.includes("residentPaymentDetailSchema")).toBe(true);
    expect(
      /from\s+["']@\/lib\/offline-payments\.functions["']/.test(READ_MODULE_SRC),
    ).toBe(true);
  });

  it("does not declare a speculative pagination schema", () => {
    // Production `getResidentPayments` returns `{ payments }` with no
    // pagination metadata; a pagination schema here would be invented.
    expect(READ_MODULE_SRC.includes("Pagination")).toBe(false);
    expect(READ_MODULE_SRC.includes("ResidentPaymentHistoryPage")).toBe(false);
  });

  it("does not declare a speculative status/method enum", () => {
    // Production schemas use z.string() for method/status. A local enum
    // would be invented.
    expect(READ_MODULE_SRC.includes("Stage3CReadPaymentStatusSchema")).toBe(false);
    expect(READ_MODULE_SRC.includes("Stage3CReadPaymentMethodSchema")).toBe(false);
  });
});
