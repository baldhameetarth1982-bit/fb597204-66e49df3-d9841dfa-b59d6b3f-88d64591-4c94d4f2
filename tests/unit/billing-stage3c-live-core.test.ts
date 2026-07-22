/**
 * Stage 3C — Core registry contract (24/93).
 *
 * Tests the actual registry object, the live suite's registry-driven
 * shape, the strict parsers / duplicate-safe tracking helpers, AND
 * every semantic parity requirement between manifest descriptions and
 * AUTH/PENDING/VERIFY handler bodies.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  STAGE3C_CORE_LIVE_CASE_HANDLERS,
  STAGE3C_CORE_LIVE_CASE_IDS,
} from "../helpers/stage3c-live-core-registry";
import { STAGE3C_REQUIRED_LIVE_CASES } from "../helpers/stage3c-live-case-manifest";
import {
  parseBillSummary,
  parsePaymentAssertionRow,
  parseReceiptAssertionRow,
  parseSearchRows,
  assertCanonicalReceiptStatus,
} from "../helpers/stage3c-live-core-context";
import { trackUniqueId } from "../helpers/stage3c-runtime-fixtures";
import { STAGE3C_ERRORS, matchesCanonicalError } from "../helpers/stage3c-live-errors";
import {
  STAGE3C_ACTIVE_RPCS,
  STAGE3C_ACTIVE_RPC_COUNT,
} from "../helpers/stage3c-live-rpc-contract";
import { extractHandlerBody } from "../../scripts/verify-stage3c-live-core-source";

const liveSuiteSrc = readFileSync(
  resolve(process.cwd(), "tests/integration/billing-stage3c-live.test.ts"),
  "utf8",
);
const pendingSrc = readFileSync(
  resolve(process.cwd(), "tests/helpers/stage3c-live-pending-cases.ts"),
  "utf8",
);
const verifySrc = readFileSync(
  resolve(process.cwd(), "tests/helpers/stage3c-live-verify-cases.ts"),
  "utf8",
);
const authSrc = readFileSync(
  resolve(process.cwd(), "tests/helpers/stage3c-live-auth-cases.ts"),
  "utf8",
);
const registrySrc = readFileSync(
  resolve(process.cwd(), "tests/helpers/stage3c-live-core-registry.ts"),
  "utf8",
);

describe("Stage 3C — core registry", () => {
  it("has exactly 24 IDs, unique, split 7/8/9", () => {
    expect(STAGE3C_CORE_LIVE_CASE_IDS.length).toBe(24);
    const unique = new Set(STAGE3C_CORE_LIVE_CASE_IDS);
    expect(unique.size).toBe(24);
    expect(STAGE3C_CORE_LIVE_CASE_IDS.filter((i) => i.startsWith("AUTH-")).length).toBe(7);
    expect(STAGE3C_CORE_LIVE_CASE_IDS.filter((i) => i.startsWith("PENDING-")).length).toBe(8);
    expect(STAGE3C_CORE_LIVE_CASE_IDS.filter((i) => i.startsWith("VERIFY-")).length).toBe(9);
  });

  it("has exactly 24 handler entries in canonical order", () => {
    expect(STAGE3C_CORE_LIVE_CASE_HANDLERS.length).toBe(24);
    const ids = STAGE3C_CORE_LIVE_CASE_HANDLERS.map((c) => c.id);
    expect(ids).toEqual([...STAGE3C_CORE_LIVE_CASE_IDS]);
    for (const c of STAGE3C_CORE_LIVE_CASE_HANDLERS) {
      expect(typeof c.execute, `${c.id} execute`).toBe("function");
      expect(c.description.length, `${c.id} description`).toBeGreaterThan(0);
    }
  });

  it("descriptions come from the canonical manifest (no duplication)", () => {
    const manifestById = new Map(STAGE3C_REQUIRED_LIVE_CASES.map((c) => [c.id, c.description]));
    for (const c of STAGE3C_CORE_LIVE_CASE_HANDLERS) {
      const canonical = manifestById.get(c.id);
      expect(canonical, `manifest missing ${c.id}`).toBeDefined();
      expect(c.description, `description drift for ${c.id}`).toBe(canonical);
    }
  });

  it("uses true compile-time exhaustiveness (satisfies), never `as Record`", () => {
    expect(registrySrc).toMatch(/satisfies Record<\s*Stage3CCoreLiveCaseId\s*,/);
    expect(registrySrc).not.toMatch(/as Record<\s*Stage3CCoreLiveCaseId/);
    // The registry must reference the manifest — descriptions cannot be
    // duplicated literals.
    expect(registrySrc).toContain("STAGE3C_REQUIRED_LIVE_CASES");
    expect(registrySrc).not.toContain("Anonymous client is denied every Stage 3C RPC");
    expect(registrySrc).not.toContain("Bill balance_paid does not change from a pending payment");
    expect(registrySrc).not.toContain("Receipt number remains unique across concurrent verifications");
  });
});

describe("Stage 3C — live suite shape", () => {
  it("registry-driven, no unnumbered pre-case tests", () => {
    // The live suite may consume the core registry directly OR the
    // matrix registry (which composes the core registry). Either shape
    // is registry-driven; imports of individual case-file modules are
    // still forbidden.
    const importsCore = liveSuiteSrc.includes("STAGE3C_CORE_LIVE_CASE_HANDLERS");
    const importsMatrix = liveSuiteSrc.includes("STAGE3C_MATRIX_LIVE_CASE_HANDLERS");
    expect(importsCore || importsMatrix, "core or matrix registry").toBe(true);
    const iteratesCore = /for \(const caseDefinition of STAGE3C_CORE_LIVE_CASE_HANDLERS\)/.test(
      liveSuiteSrc,
    );
    const iteratesMatrix = /for \(const caseDefinition of STAGE3C_MATRIX_LIVE_CASE_HANDLERS\)/.test(
      liveSuiteSrc,
    );
    expect(iteratesCore || iteratesMatrix, "iterates registry").toBe(true);
    expect(liveSuiteSrc).not.toMatch(/pre-case/);
    expect(liveSuiteSrc).not.toMatch(/from "\.\.\/helpers\/stage3c-live-auth-cases"/);
    expect(liveSuiteSrc).not.toMatch(/from "\.\.\/helpers\/stage3c-live-pending-cases"/);
    expect(liveSuiteSrc).not.toMatch(/from "\.\.\/helpers\/stage3c-live-verify-cases"/);
    expect(liveSuiteSrc).not.toMatch(/from "\.\.\/helpers\/stage3c-live-resident-submit-cases"/);
    const vitestImports = liveSuiteSrc.match(/from "vitest"/g) ?? [];
    expect(vitestImports.length).toBe(1);
  });

  it("case files contain no anti-patterns, no unsafe casts, no `data!.<x>`", () => {
    for (const [name, src] of [
      ["auth", authSrc],
      ["pending", pendingSrc],
      ["verify", verifySrc],
    ] as const) {
      expect(src, `${name}: no stale date`).not.toContain("2026-02-10");
      expect(src, `${name}: no broad denial regex`).not.toMatch(
        /permission denied\|forbidden\|42501/,
      );
      expect(src, `${name}: no direct tracked-array push`).not.toMatch(
        /fixture\.tracked\.paymentIds\.push/,
      );
      expect(src, `${name}: no receipt tracked-array push`).not.toMatch(
        /fixture\.tracked\.paymentReceiptIds\.push/,
      );
      expect(src, `${name}: no TODO`).not.toMatch(/\bTODO\b/);
      expect(src, `${name}: no expect(true)`).not.toMatch(/expect\(\s*true\s*\)/);
      expect(src, `${name}: no unsafe BillRow[] cast`).not.toMatch(/\bas BillRow\[\]/);
      expect(src, `${name}: no unsafe unknown[] cast on RPC output`).not.toMatch(
        /\)\s+as unknown\[\]/,
      );
      expect(src, `${name}: no unsafe data!.<x> non-null assertion`).not.toMatch(
        /\bdata!\.[A-Za-z_]+/,
      );
    }
  });
});

describe("Stage 3C — semantic parity (handler ↔ manifest description)", () => {
  it("AUTH-03 tests search AND verify denial", () => {
    const body = extractHandlerBody(authSrc, "auth03_adminBCannotSearchSocietyA");
    expect(body, "AUTH-03 body").not.toBeNull();
    expect(body).toMatch(/adminSearch\(|search_society_open_bills/);
    expect(body).toMatch(/actorVerify\(|verify_offline_payment/);
  });

  it("AUTH-05 tests search AND verify denial", () => {
    const body = extractHandlerBody(authSrc, "auth05_guardCannotUseAdminSearch");
    expect(body, "AUTH-05 body").not.toBeNull();
    expect(body).toMatch(/adminSearch\(|search_society_open_bills/);
    expect(body).toMatch(/actorVerify\(|verify_offline_payment/);
  });

  it("AUTH-06 covers search + verify + reject + reverse", () => {
    const body = extractHandlerBody(authSrc, "auth06_blockAdminCannotUseAdminSearch");
    expect(body, "AUTH-06 body").not.toBeNull();
    expect(body).toMatch(/adminSearch\(|search_society_open_bills/);
    expect(body).toMatch(/actorVerify\(|verify_offline_payment/);
    expect(body).toMatch(/actorReject\(|reject_offline_payment/);
    expect(body).toMatch(/actorReverse\(|reverse_offline_payment/);
  });

  it("AUTH-07 consumes the canonical active RPC contract exhaustively", () => {
    const body = extractHandlerBody(authSrc, "auth07_anonymousDenied");
    expect(body, "AUTH-07 body").not.toBeNull();
    expect(body).toContain("STAGE3C_ACTIVE_RPCS");
    expect(body).toMatch(/for \(const [A-Za-z]+ of STAGE3C_ACTIVE_RPCS/);
    // Contract must cover exactly 8 active Stage 3C RPCs.
    expect(STAGE3C_ACTIVE_RPC_COUNT).toBe(8);
    const rpcNames = STAGE3C_ACTIVE_RPCS.map((r) => r.name);
    for (const name of [
      "search_society_open_bills",
      "submit_offline_payment",
      "verify_offline_payment",
      "reject_offline_payment",
      "reverse_offline_payment",
      "get_payment_detail",
      "get_bill_payment_summary",
      "get_resident_payments_v1",
    ]) {
      expect(rpcNames, `AUTH-07 contract missing ${name}`).toContain(name);
    }
  });

  it("AUTH-01/02 use strict search-row parser (no `as BillRow[]`)", () => {
    const a1 = extractHandlerBody(authSrc, "auth01_adminA1SearchesSocietyA");
    const a2 = extractHandlerBody(authSrc, "auth02_adminA2SearchesSocietyA");
    for (const [label, body] of [
      ["AUTH-01", a1],
      ["AUTH-02", a2],
    ] as const) {
      expect(body, `${label} body`).not.toBeNull();
      expect(body).toContain("parseSearchRows");
      expect(body).not.toMatch(/\bas BillRow\[\]/);
    }
  });

  it("PENDING-03 uses parsePaymentAssertionRow", () => {
    const body = extractHandlerBody(pendingSrc, "pending03_statusIsPending");
    expect(body, "PENDING-03 body").not.toBeNull();
    expect(body).toContain("parsePaymentAssertionRow");
    expect(body).not.toMatch(/\bdata!\.[A-Za-z_]+/);
  });

  it("PENDING-05 asserts exact baseline verified_amount, not only bill status", () => {
    const body = extractHandlerBody(pendingSrc, "pending05_billNotPaid");
    expect(body, "PENDING-05 body").not.toBeNull();
    expect(body).toContain("parseBillSummary");
    expect(body).toContain("verified_amount");
    expect(body).toMatch(/baseline\.verified_amount|requireBaselineSummary/);
  });

  it("VERIFY-03 uses parsePaymentAssertionRow", () => {
    const body = extractHandlerBody(verifySrc, "verify03_statusVerified");
    expect(body, "VERIFY-03 body").not.toBeNull();
    expect(body).toContain("parsePaymentAssertionRow");
    expect(body).not.toMatch(/\bdata!\.[A-Za-z_]+/);
  });

  it("VERIFY-06 validates canonical valid receipt status via helper", () => {
    const body = extractHandlerBody(verifySrc, "verify06_exactlyOneReceipt");
    expect(body, "VERIFY-06 body").not.toBeNull();
    expect(body).toContain("assertCanonicalReceiptStatus");
    expect(body).toContain("parseReceiptAssertionRow");
    expect(body).not.toMatch(/\)\s+as unknown\[\]/);
  });

  it("VERIFY-09 performs a real Promise.allSettled race on a dedicated resident payment", () => {
    const body = extractHandlerBody(verifySrc, "verify09_receiptStillExactlyOne");
    expect(body, "VERIFY-09 body").not.toBeNull();
    expect(body).toContain("Promise.allSettled");
    expect(body).toContain("scenarios.pendingResidentBankTransferPaymentId");
    // Must not be a plain post-fact receipt count on the previously
    // verified payment.
    expect(body).toMatch(/adminA1\.client\.rpc\(\s*["']verify_offline_payment/);
    expect(body).toMatch(/adminA2\.client\.rpc\(\s*["']verify_offline_payment/);
  });
});

describe("Stage 3C — strict parsers", () => {
  it("parseBillSummary accepts a valid payload and rejects malformed", () => {
    const ok = parseBillSummary({
      pending_amount: 100,
      verified_amount: 0,
      available_to_submit: 200,
      total_payable: 300,
    });
    expect(ok.pending_amount).toBe(100);
    expect(() => parseBillSummary({})).toThrow();
    expect(() =>
      parseBillSummary({
        pending_amount: -1,
        verified_amount: 0,
        available_to_submit: 0,
        total_payable: 0,
      }),
    ).toThrow();
  });

  it("parseSearchRows requires the full search RPC shape", () => {
    const rows = parseSearchRows([
      {
        bill_id: "11111111-1111-4111-8111-111111111111",
        society_id: "22222222-2222-4222-8222-222222222222",
        flat_id: "33333333-3333-4333-8333-333333333333",
        total_payable: "500.00",
        verified_amount: "0",
        pending_amount: "0",
        available_to_submit: "500.00",
      },
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].total_payable).toBe(500);
    expect(() => parseSearchRows([{ bill_id: "nope" }])).toThrow();
    expect(() => parseSearchRows("not-an-array")).toThrow();
  });

  it("parsePaymentAssertionRow requires canonical UUIDs and method", () => {
    const ok = parsePaymentAssertionRow({
      society_id: "11111111-1111-4111-8111-111111111111",
      flat_id: "22222222-2222-4222-8222-222222222222",
      bill_id: "33333333-3333-4333-8333-333333333333",
      method: "cash",
      submitted_by: "44444444-4444-4444-8444-444444444444",
    });
    expect(ok.method).toBe("cash");
    expect(() => parsePaymentAssertionRow({ method: "cash" })).toThrow();
  });

  it("parseReceiptAssertionRow enforces receipt-number format", () => {
    const ok = parseReceiptAssertionRow({
      id: "55555555-5555-4555-8555-555555555555",
      receipt_number: "RCPT/202606/0001",
      status: "valid",
      created_at: "2026-06-15T10:00:00Z",
    });
    expect(ok.receipt_number).toBe("RCPT/202606/0001");
    expect(() =>
      parseReceiptAssertionRow({
        id: "55555555-5555-4555-8555-555555555555",
        receipt_number: "invalid",
        status: "valid",
        created_at: "2026-06-15T10:00:00Z",
      }),
    ).toThrow();
  });

  it("assertCanonicalReceiptStatus accepts valid, rejects anything else", () => {
    expect(() => assertCanonicalReceiptStatus("valid", "t")).not.toThrow();
    expect(() => assertCanonicalReceiptStatus("issued", "t")).not.toThrow();
    expect(() => assertCanonicalReceiptStatus("void", "t")).toThrow();
    expect(() => assertCanonicalReceiptStatus("", "t")).toThrow();
  });
});

describe("Stage 3C — duplicate-safe tracking", () => {
  it("adds a valid UUID once and refuses duplicates or malformed input", () => {
    const collection: string[] = [];
    const uuid = "66666666-6666-4666-8666-666666666666";
    trackUniqueId(collection, uuid, "test:one");
    trackUniqueId(collection, uuid, "test:dupe");
    expect(collection).toEqual([uuid]);
    expect(() => trackUniqueId(collection, "", "test:blank")).toThrow();
    expect(() => trackUniqueId(collection, "not-a-uuid", "test:bad")).toThrow();
    expect(() => trackUniqueId(collection, 42 as unknown as string, "test:nonstring")).toThrow();
  });
});

describe("Stage 3C — canonical errors", () => {
  it("matches whole-token, rejects partial matches", () => {
    expect(matchesCanonicalError("not_authorized", STAGE3C_ERRORS.NOT_AUTHORIZED)).toBe(true);
    expect(
      matchesCanonicalError("ERROR: not_authorized [42501]", STAGE3C_ERRORS.NOT_AUTHORIZED),
    ).toBe(true);
    expect(matchesCanonicalError("not_authorized_admin", STAGE3C_ERRORS.NOT_AUTHORIZED)).toBe(
      false,
    );
    expect(matchesCanonicalError("permission denied", STAGE3C_ERRORS.NOT_AUTHORIZED)).toBe(false);
  });

  it("disambiguates unauthenticated from not_authenticated", () => {
    expect(matchesCanonicalError("unauthenticated", STAGE3C_ERRORS.UNAUTHENTICATED)).toBe(true);
    expect(matchesCanonicalError("not_authenticated", STAGE3C_ERRORS.NOT_AUTHENTICATED)).toBe(true);
    // "not_authenticated" must not satisfy the UNAUTHENTICATED token.
    expect(matchesCanonicalError("not_authenticated", STAGE3C_ERRORS.UNAUTHENTICATED)).toBe(false);
  });
});
