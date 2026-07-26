/**
 * Stage 3C — READ-01..10 direct contract tests (Sub-run A).
 *
 * Structural-only: proves the READ contract module locks the exact ten
 * ids, exposes ten named handlers with the shared matrix contract, and
 * that every handler currently fails closed with a static, safe
 * not-implemented message. Also gates the READ contract module source
 * against Vitest imports, mutation APIs, `any`, non-null assertions,
 * loose schemas, protected-society identity, and Stage 3D leakage.
 *
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
  ResidentPaymentHistoryPageSchema,
  ResidentPaymentHistoryRowSchema,
  ResidentPaymentHistoryPaginationSchema,
  Stage3CReadAudienceSchema,
  Stage3CReadDenialEvidenceSchema,
  Stage3CReadDenialTokenSchema,
  Stage3CReadPaymentMethodSchema,
  Stage3CReadPaymentStatusSchema,
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

// ---------------------------------------------------------------------------
// Canonical inputs used by contract assertions
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

function makeDetail() {
  return {
    paymentId: UUID_A,
    billId: UUID_B,
    societyId: UUID_C,
    amount: 250,
    status: "pending" as const,
    method: "bank_transfer" as const,
    audience: "resident" as const,
  };
}

function makeHistoryRow() {
  return {
    paymentId: UUID_A,
    billId: UUID_B,
    societyId: UUID_C,
    amount: 100,
    status: "verified" as const,
    method: "cash" as const,
    audience: "resident" as const,
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

describe("READ contract — fail-closed handlers", () => {
  const ctx = createStage3CLiveMatrixContext();

  it.each([...EXPECTED_ORDER])(
    "%s currently throws the exact not-implemented message",
    async (id) => {
      const fn = STAGE3C_READ_HANDLERS[id as Stage3CReadCaseId];
      await expect(fn(ctx)).rejects.toThrow(
        stage3cReadNotImplementedMessage(id as Stage3CReadCaseId),
      );
    },
  );

  it("not-implemented message is a stable static literal per id", () => {
    for (const id of EXPECTED_ORDER) {
      expect(stage3cReadNotImplementedMessage(id)).toBe(
        `[stage3c:${id}] behavior not implemented`,
      );
    }
  });

  it.each([...EXPECTED_ORDER])(
    "%s message contains no UUID/amount/reference/key/actor",
    (id) => {
      const msg = stage3cReadNotImplementedMessage(id as Stage3CReadCaseId);
      // No UUID
      expect(/[0-9a-f]{8}-[0-9a-f]{4}/i.test(msg)).toBe(false);
      // No digits outside the case-id tag would indicate an amount/count leak.
      const withoutTag = msg.replace(/\[stage3c:READ-\d{2}\]/, "");
      expect(/\d/.test(withoutTag)).toBe(false);
      // No reference/idempotency/actor/provider mentions
      for (const forbidden of [
        "reference",
        "idempotency",
        "actor",
        "provider",
        "PGRST",
        "society_",
      ]) {
        expect(msg.toLowerCase().includes(forbidden.toLowerCase())).toBe(false);
      }
    },
  );
});

// ---------------------------------------------------------------------------
// 4) Typed READ contract model — strict schemas
// ---------------------------------------------------------------------------

describe("READ contract — typed model", () => {
  it("accepts a canonical resident payment detail sample", () => {
    expect(ResidentPaymentDetailSchema.safeParse(makeDetail()).success).toBe(true);
  });

  it("rejects an unknown property on the detail schema (strict)", () => {
    const bad = { ...makeDetail(), proof_url: "https://x/y.png" };
    expect(ResidentPaymentDetailSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects a malformed UUID on the detail schema", () => {
    const bad = { ...makeDetail(), paymentId: "not-a-uuid" };
    expect(ResidentPaymentDetailSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects an unsupported status literal", () => {
    const bad = { ...makeDetail(), status: "settled" };
    expect(ResidentPaymentDetailSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects an unsupported method literal", () => {
    const bad = { ...makeDetail(), method: "card" };
    expect(ResidentPaymentDetailSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects an unsupported audience literal", () => {
    const bad = { ...makeDetail(), audience: "public" };
    expect(ResidentPaymentDetailSchema.safeParse(bad).success).toBe(false);
  });

  it("requires audience on the detail schema", () => {
    const { audience: _a, ...missing } = makeDetail();
    expect(ResidentPaymentDetailSchema.safeParse(missing).success).toBe(false);
  });

  it("requires paymentId on the detail schema", () => {
    const { paymentId: _p, ...missing } = makeDetail();
    expect(ResidentPaymentDetailSchema.safeParse(missing).success).toBe(false);
  });

  it("rejects non-positive amount on the detail schema", () => {
    const bad = { ...makeDetail(), amount: 0 };
    expect(ResidentPaymentDetailSchema.safeParse(bad).success).toBe(false);
  });

  it("accepts a canonical history row", () => {
    expect(
      ResidentPaymentHistoryRowSchema.safeParse(makeHistoryRow()).success,
    ).toBe(true);
  });

  it("rejects an unknown property on the history row schema (strict)", () => {
    const bad = { ...makeHistoryRow(), internal_notes: "x" };
    expect(ResidentPaymentHistoryRowSchema.safeParse(bad).success).toBe(false);
  });

  it("accepts a canonical history page", () => {
    const page = {
      rows: [makeHistoryRow()],
      pagination: { limit: 20, offset: 0, total: 1 },
    };
    expect(ResidentPaymentHistoryPageSchema.safeParse(page).success).toBe(true);
  });

  it("rejects an unknown property on the history page schema (strict)", () => {
    const page = {
      rows: [makeHistoryRow()],
      pagination: { limit: 20, offset: 0, total: 1 },
      cursor: "x",
    };
    expect(ResidentPaymentHistoryPageSchema.safeParse(page).success).toBe(false);
  });

  it("rejects negative offset in pagination schema", () => {
    const bad = { limit: 20, offset: -1, total: 0 };
    expect(ResidentPaymentHistoryPaginationSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects zero limit in pagination schema", () => {
    const bad = { limit: 0, offset: 0, total: 0 };
    expect(ResidentPaymentHistoryPaginationSchema.safeParse(bad).success).toBe(false);
  });

  it("audience enum rejects unknown values", () => {
    expect(Stage3CReadAudienceSchema.safeParse("guest").success).toBe(false);
    expect(Stage3CReadAudienceSchema.safeParse("resident").success).toBe(true);
  });

  it("payment status enum rejects unknown values", () => {
    expect(Stage3CReadPaymentStatusSchema.safeParse("settled").success).toBe(false);
  });

  it("payment method enum rejects unknown values", () => {
    expect(Stage3CReadPaymentMethodSchema.safeParse("upi").success).toBe(false);
  });

  it("denial token schema rejects unknown tokens", () => {
    expect(Stage3CReadDenialTokenSchema.safeParse("forbidden").success).toBe(false);
    expect(Stage3CReadDenialTokenSchema.safeParse("not_authorized").success).toBe(true);
  });

  it("denial evidence schema requires returnedRow = null", () => {
    const bad = {
      caseId: "READ-09" as const,
      token: "not_authorized" as const,
      returnedRow: {},
    };
    expect(Stage3CReadDenialEvidenceSchema.safeParse(bad).success).toBe(false);
  });

  it("denial evidence schema rejects success-only case ids", () => {
    const bad = {
      caseId: "READ-01",
      token: "not_authorized" as const,
      returnedRow: null,
    };
    expect(Stage3CReadDenialEvidenceSchema.safeParse(bad).success).toBe(false);
  });

  it("denial evidence schema accepts canonical shape", () => {
    const ok = {
      caseId: "READ-09" as const,
      token: "not_authorized" as const,
      returnedRow: null,
    };
    expect(Stage3CReadDenialEvidenceSchema.safeParse(ok).success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 5) Matrix-context READ guards
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
    ctx.readPrimaryBillId = UUID_A;
    // The UUID is valid so requireReadPrimaryBillId returns it silently.
    // Now corrupt it and force the invalid path — message must not embed
    // the raw value.
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
// 6) Regression: accepted IDEMPOTENCY + REFERENCE surface is unchanged
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
// 7) Source-level architectural prohibitions on the READ contract module
// ---------------------------------------------------------------------------

describe("READ contract — source validator", () => {
  it("does not import Vitest", () => {
    expect(/from\s+["']vitest["']/.test(READ_MODULE_SRC)).toBe(false);
  });

  it("does not use non-null assertions", () => {
    // Detect `.!` or `something!` at line ends — a light heuristic that
    // rejects the obvious forms. Zero occurrences expected.
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
    // Only the env-var *name* is permitted, and only if a safety check
    // requires it — this module has no such requirement.
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
    // At least one `.strict()` call must exist in the schema declarations.
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
});
