/**
 * Stage 3C — Core registry contract (24/93).
 *
 * Tests the actual registry object, the live suite's registry-driven
 * shape, and the strict parsers / duplicate-safe tracking helpers.
 * No cross-file source string scans of handler counts — the registry
 * is a typed literal tuple and enforces exhaustiveness at compile time.
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
} from "../helpers/stage3c-live-core-context";
import { trackUniqueId } from "../helpers/stage3c-runtime-fixtures";
import { STAGE3C_ERRORS, matchesCanonicalError } from "../helpers/stage3c-live-errors";

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

describe("Stage 3C — core registry", () => {
  it("has exactly 24 IDs, unique, split 7/8/9", () => {
    expect(STAGE3C_CORE_LIVE_CASE_IDS.length).toBe(24);
    const unique = new Set(STAGE3C_CORE_LIVE_CASE_IDS);
    expect(unique.size).toBe(24);
    expect(STAGE3C_CORE_LIVE_CASE_IDS.filter((i) => i.startsWith("AUTH-")).length).toBe(7);
    expect(STAGE3C_CORE_LIVE_CASE_IDS.filter((i) => i.startsWith("PENDING-")).length).toBe(8);
    expect(STAGE3C_CORE_LIVE_CASE_IDS.filter((i) => i.startsWith("VERIFY-")).length).toBe(9);
  });

  it("has exactly 24 handler entries matching the IDs", () => {
    expect(STAGE3C_CORE_LIVE_CASE_HANDLERS.length).toBe(24);
    const ids = STAGE3C_CORE_LIVE_CASE_HANDLERS.map((c) => c.id);
    expect(ids).toEqual([...STAGE3C_CORE_LIVE_CASE_IDS]);
    for (const c of STAGE3C_CORE_LIVE_CASE_HANDLERS) {
      expect(typeof c.execute, `${c.id} execute`).toBe("function");
      expect(c.description.length, `${c.id} description`).toBeGreaterThan(0);
    }
  });

  it("descriptions match the canonical 93-case manifest verbatim", () => {
    const manifestById = new Map(STAGE3C_REQUIRED_LIVE_CASES.map((c) => [c.id, c.description]));
    for (const c of STAGE3C_CORE_LIVE_CASE_HANDLERS) {
      const canonical = manifestById.get(c.id);
      expect(canonical, `manifest missing ${c.id}`).toBeDefined();
      expect(c.description, `description drift for ${c.id}`).toBe(canonical);
    }
  });
});

describe("Stage 3C — live suite shape", () => {
  it("imports and iterates the registry, with no manual per-case it() or pre-case titles", () => {
    expect(liveSuiteSrc).toContain('from "../helpers/stage3c-live-core-registry"');
    expect(liveSuiteSrc).toContain("STAGE3C_CORE_LIVE_CASE_HANDLERS");
    expect(liveSuiteSrc).toMatch(/for \(const caseDefinition of STAGE3C_CORE_LIVE_CASE_HANDLERS\)/);
    // No unnumbered lifecycle-only test titles.
    expect(liveSuiteSrc).not.toMatch(/pre-case/);
    expect(liveSuiteSrc).not.toMatch(/PENDING baseline captured/);
    expect(liveSuiteSrc).not.toMatch(/post-verify summary \+ receipt captured/);
    // No manual handler imports.
    expect(liveSuiteSrc).not.toMatch(/from "\.\.\/helpers\/stage3c-live-auth-cases"/);
    expect(liveSuiteSrc).not.toMatch(/from "\.\.\/helpers\/stage3c-live-pending-cases"/);
    expect(liveSuiteSrc).not.toMatch(/from "\.\.\/helpers\/stage3c-live-verify-cases"/);
    // Exactly one Vitest import.
    const vitestImports = liveSuiteSrc.match(/from "vitest"/g) ?? [];
    expect(vitestImports.length).toBe(1);
  });

  it("case files contain no broad denial regex, no stale date, no direct tracked-array pushes, no protected society literal", () => {
    for (const [name, src] of [
      ["auth", authSrc],
      ["pending", pendingSrc],
      ["verify", verifySrc],
    ] as const) {
      expect(src, `${name}: no stale 2026-02-10`).not.toContain("2026-02-10");
      expect(src, `${name}: no broad DENIAL alternation`).not.toMatch(
        /permission denied\|forbidden\|42501/,
      );
      expect(src, `${name}: no direct paymentIds.push`).not.toMatch(
        /fixture\.tracked\.paymentIds\.push/,
      );
      expect(src, `${name}: no direct paymentReceiptIds.push`).not.toMatch(
        /fixture\.tracked\.paymentReceiptIds\.push/,
      );
      expect(src, `${name}: no TODO`).not.toMatch(/\bTODO\b/);
      expect(src, `${name}: no placeholder`).not.toMatch(/\bplaceholder\b/i);
      expect(src, `${name}: no expect(true)`).not.toMatch(/expect\(\s*true\s*\)/);
    }
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
      status: "issued",
      created_at: "2026-06-15T10:00:00Z",
    });
    expect(ok.receipt_number).toBe("RCPT/202606/0001");
    expect(() =>
      parseReceiptAssertionRow({
        id: "55555555-5555-4555-8555-555555555555",
        receipt_number: "invalid",
        created_at: "2026-06-15T10:00:00Z",
      }),
    ).toThrow();
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
    expect(
      matchesCanonicalError("not_authorized_admin", STAGE3C_ERRORS.NOT_AUTHORIZED),
    ).toBe(false);
    expect(matchesCanonicalError("permission denied", STAGE3C_ERRORS.NOT_AUTHORIZED)).toBe(false);
  });
});
