/**
 * Stage 3B — Turn 18A / 18B.1A
 * Unit tests for Non-Member Payments pure logic.
 */
import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  isNonMemberIncomeAllowed,
  canTransitionVerification,
  CreateCategoryInput,
  CreatePayerInput,
  CreateIncomeRecordInput,
  normalizeCategoryKey,
  toPublicPayerList,
  toPublicIncomeList,
  parseFinancialAmount,
  PAYER_TYPES,
  SUPPORTED_METHODS,
} from "@/lib/non-member-income.server";

const UUID = "11111111-1111-4111-8111-111111111111";
const UUID2 = "22222222-2222-4222-8222-222222222222";
const UUID3 = "33333333-3333-4333-8333-333333333333";

describe("plan gating", () => {
  it("1. denies Basic", () => {
    expect(isNonMemberIncomeAllowed("basic")).toBe(false);
  });
  it("2. allows Pro", () => {
    expect(isNonMemberIncomeAllowed("pro")).toBe(true);
  });
  it("3. Premium inherits Pro", () => {
    expect(isNonMemberIncomeAllowed("premium")).toBe(true);
  });
});

describe("category input validation", () => {
  it("8. accepts valid category", () => {
    const parsed = CreateCategoryInput.parse({
      societyId: UUID,
      key: "Vendor Income",
      display_name: "Vendor Income",
    });
    expect(parsed.key).toBe("vendor_income");
  });
  it("9. duplicate normalized keys reduce to same value", () => {
    const a = normalizeCategoryKey("Vendor Income");
    const b = normalizeCategoryKey("vendor-income!!");
    expect(a).toBe("vendor_income");
    expect(b).toBe("vendor-income");
    expect(normalizeCategoryKey("VENDOR_INCOME")).toBe(a);
  });
  it("rejects empty display name", () => {
    expect(() =>
      CreateCategoryInput.parse({ societyId: UUID, key: "x", display_name: "" }),
    ).toThrow();
  });
});

describe("non-member payer validation", () => {
  it("11. valid payer accepted", () => {
    const p = CreatePayerInput.parse({
      societyId: UUID,
      payer_type: "vendor",
      display_name: "Acme",
      phone: "+91 98765 43210",
      email: "acme@example.com",
    });
    expect(p.payer_type).toBe("vendor");
  });
  it("12. invalid payer_type rejected", () => {
    expect(() =>
      CreatePayerInput.parse({
        societyId: UUID,
        payer_type: "hacker" as unknown as (typeof PAYER_TYPES)[number],
        display_name: "Bad",
      }),
    ).toThrow();
  });
  it("13a. bad phone rejected", () => {
    expect(() =>
      CreatePayerInput.parse({
        societyId: UUID,
        payer_type: "vendor",
        display_name: "Acme",
        phone: "abc",
      }),
    ).toThrow();
  });
  it("13b. bad email rejected", () => {
    expect(() =>
      CreatePayerInput.parse({
        societyId: UUID,
        payer_type: "vendor",
        display_name: "Acme",
        email: "not-an-email",
      }),
    ).toThrow();
  });
});

describe("income record validation", () => {
  const base = {
    societyId: UUID,
    category_id: UUID2,
    payment_method: "cash" as (typeof SUPPORTED_METHODS)[number],
  };
  it("14. amount must be positive", () => {
    expect(() =>
      CreateIncomeRecordInput.parse({
        ...base,
        payer_kind: "anonymous",
        amount: 0,
      }),
    ).toThrow();
    expect(() =>
      CreateIncomeRecordInput.parse({
        ...base,
        payer_kind: "anonymous",
        amount: -5,
      }),
    ).toThrow();
  });
  it("17a. non_member requires payer id", () => {
    expect(() =>
      CreateIncomeRecordInput.parse({
        ...base,
        payer_kind: "non_member",
        amount: 100,
      }),
    ).toThrow();
  });
  it("17b. resident requires resident id", () => {
    expect(() =>
      CreateIncomeRecordInput.parse({
        ...base,
        payer_kind: "resident",
        amount: 100,
      }),
    ).toThrow();
  });
  it("17c. anonymous forbids ids", () => {
    expect(() =>
      CreateIncomeRecordInput.parse({
        ...base,
        payer_kind: "anonymous",
        amount: 100,
        non_member_payer_id: UUID3,
      }),
    ).toThrow();
  });
  it("18. Cash accepted", () => {
    const r = CreateIncomeRecordInput.parse({
      ...base,
      payer_kind: "anonymous",
      amount: 100,
    });
    expect(r.payment_method).toBe("cash");
  });
  it("19. Bank Transfer accepted", () => {
    const r = CreateIncomeRecordInput.parse({
      ...base,
      payment_method: "bank_transfer",
      payer_kind: "non_member",
      non_member_payer_id: UUID3,
      amount: 500,
    });
    expect(r.payment_method).toBe("bank_transfer");
  });
  it("20. online gateway method rejected", () => {
    expect(() =>
      CreateIncomeRecordInput.parse({
        ...base,
        payment_method: "razorpay" as unknown as (typeof SUPPORTED_METHODS)[number],
        payer_kind: "anonymous",
        amount: 100,
      }),
    ).toThrow();
  });
});

describe("verification state machine", () => {
  it("21. pending -> verified allowed", () => {
    expect(canTransitionVerification("pending", "verified")).toBe(true);
  });
  it("21b. pending -> rejected allowed", () => {
    expect(canTransitionVerification("pending", "rejected")).toBe(true);
  });
  it("verified -> reversed allowed", () => {
    expect(canTransitionVerification("verified", "reversed")).toBe(true);
  });
  it("22a. verified cannot go back to pending", () => {
    expect(canTransitionVerification("verified", "pending")).toBe(false);
  });
  it("22b. reversed is terminal", () => {
    expect(canTransitionVerification("reversed", "verified")).toBe(false);
    expect(canTransitionVerification("reversed", "pending")).toBe(false);
  });
  it("24. reversed cannot be verified again", () => {
    expect(canTransitionVerification("reversed", "verified")).toBe(false);
  });
});

describe("data minimization", () => {
  it("27+28. payer list excludes phone/email/notes", () => {
    const rows = [
      {
        id: UUID,
        society_id: UUID2,
        payer_type: "vendor",
        display_name: "Acme",
        organization_name: "Acme Inc",
        phone: "+919999999999",
        email: "hidden@example.com",
        reference_code: "R-1",
        notes: "internal only",
        is_active: true,
        created_at: "2026-01-01T00:00:00Z",
      },
    ];
    const projected = toPublicPayerList(rows);
    expect(projected[0]).not.toHaveProperty("phone");
    expect(projected[0]).not.toHaveProperty("email");
    expect(projected[0]).not.toHaveProperty("notes");
    expect(projected[0]).not.toHaveProperty("reference_code");
    expect(projected[0].display_name).toBe("Acme");
  });
  it("29+30. income list has no proof/bank fields and masks reference", () => {
    const projected = toPublicIncomeList([
      {
        id: UUID,
        society_id: UUID2,
        category_id: UUID3,
        payer_kind: "non_member",
        amount: "1234.50",
        payment_method: "bank_transfer",
        payment_status: "received",
        verification_status: "pending",
        reconciliation_status: "unreconciled",
        payment_date: "2026-05-01T00:00:00Z",
        reference_number: "TXN123456789",
      },
    ]);
    expect(projected[0].amount).toBe(1234.5);
    expect(projected[0].reference_suffix).toBe("••••6789");
    expect(projected[0]).not.toHaveProperty("payment_proof_url");
    expect(projected[0]).not.toHaveProperty("bank_account");
    expect(projected[0]).not.toHaveProperty("reference_number");
  });
});

// ---------------------------------------------------------------------------
// Turn 18B.1A — Strict amount parsing
// ---------------------------------------------------------------------------

describe("parseFinancialAmount (Turn 18B.1A)", () => {
  it("accepts a valid positive number", () => {
    expect(parseFinancialAmount(123.45)).toBe(123.45);
  });
  it("accepts a numeric string", () => {
    expect(parseFinancialAmount("500")).toBe(500);
  });
  it("accepts aggregate zero when allowZero", () => {
    expect(parseFinancialAmount(0, { allowZero: true })).toBe(0);
  });
  it("rejects zero for individual amounts by default", () => {
    expect(parseFinancialAmount(0)).toBeNull();
  });
  it("rejects NaN, Infinity, negatives, non-strings", () => {
    expect(parseFinancialAmount(NaN)).toBeNull();
    expect(parseFinancialAmount(Infinity)).toBeNull();
    expect(parseFinancialAmount(-1)).toBeNull();
    expect(parseFinancialAmount(-0.01, { allowZero: true })).toBeNull();
    expect(parseFinancialAmount("abc")).toBeNull();
    expect(parseFinancialAmount(null)).toBeNull();
    expect(parseFinancialAmount(undefined)).toBeNull();
    expect(parseFinancialAmount({} as unknown)).toBeNull();
    expect(parseFinancialAmount("")).toBeNull();
  });
  it("rejects absurdly large values", () => {
    expect(parseFinancialAmount(1e13)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Turn 18B.1A — Route files must not use handwritten `any` on Income code
// ---------------------------------------------------------------------------

describe("Income UI/service files: no handwritten `any` (Turn 18B.1A)", () => {
  const files = [
    "src/routes/_society/society.income.tsx",
    "src/routes/_society/society.income.$id.tsx",
  ];
  for (const rel of files) {
    it(`${rel} has no ": any" / "as any" / "Record<string, any>"`, () => {
      const src = fs.readFileSync(path.resolve(__dirname, "../..", rel), "utf8");
      // Strip line/block comments so allowed docs are not scanned.
      const stripped = src
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/\/\/[^\n]*/g, "");
      expect(stripped).not.toMatch(/:\s*any\b/);
      expect(stripped).not.toMatch(/\bas\s+any\b/);
      expect(stripped).not.toMatch(/Record<string,\s*any>/);
      expect(stripped).not.toMatch(/\[\]\s+as\s+any\[\]/);
    });
  }
});

// ---------------------------------------------------------------------------
// Turn 18B.2 — Transition input, state machine, safety
// ---------------------------------------------------------------------------

import { IncomeTransitionReason } from "@/lib/non-member-income.server";

describe("IncomeTransitionReason schema (Turn 18B.2)", () => {
  it("accepts a 5+ char trimmed reason", () => {
    expect(IncomeTransitionReason.parse("  duplicate entry ")).toBe("duplicate entry");
  });
  it("rejects short reasons", () => {
    expect(() => IncomeTransitionReason.parse("hi")).toThrow();
    expect(() => IncomeTransitionReason.parse("   ")).toThrow();
    expect(() => IncomeTransitionReason.parse("")).toThrow();
  });
  it("rejects oversized reasons", () => {
    expect(() => IncomeTransitionReason.parse("x".repeat(501))).toThrow();
  });
  it("rejects HTML in reason", () => {
    expect(() => IncomeTransitionReason.parse("bad <script>x</script>")).toThrow();
    expect(() => IncomeTransitionReason.parse("<b>nope</b>")).toThrow();
  });
});

describe("full canonical state machine (Turn 18B.2)", () => {
  it("verified cannot be verified again", () => {
    expect(canTransitionVerification("verified", "verified")).toBe(false);
  });
  it("rejected cannot be verified/reversed", () => {
    expect(canTransitionVerification("rejected", "verified")).toBe(false);
    expect(canTransitionVerification("rejected", "reversed")).toBe(false);
  });
  it("pending cannot be reversed directly", () => {
    expect(canTransitionVerification("pending", "reversed")).toBe(false);
  });
  it("reversed is fully terminal", () => {
    expect(canTransitionVerification("reversed", "verified")).toBe(false);
    expect(canTransitionVerification("reversed", "rejected")).toBe(false);
    expect(canTransitionVerification("reversed", "reversed")).toBe(false);
    expect(canTransitionVerification("reversed", "pending")).toBe(false);
  });
});

describe("mutation input surface is minimal (Turn 18B.2)", () => {
  it("browser-facing route file uses recordId-only mutation shape", () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, "../..", "src/routes/_society/society.income.$id.tsx"),
      "utf8",
    );
    expect(src).toMatch(/verifyIncomeRecordByIdFn/);
    expect(src).toMatch(/rejectIncomeRecordByIdFn/);
    expect(src).toMatch(/reverseIncomeRecordByIdFn/);
    expect(src).not.toMatch(/verified_by\s*:/);
    expect(src).not.toMatch(/rejected_by\s*:/);
    expect(src).not.toMatch(/reversed_by\s*:/);
  });
});

describe("safe-next path (preflight)", () => {
  it("rejects protocol-relative, absolute and encoded evil URLs", async () => {
    const { sanitizeNextPath } = await import("@/lib/safe-next");
    expect(sanitizeNextPath("//evil.com")).toBeUndefined();
    expect(sanitizeNextPath("http://evil.com")).toBeUndefined();
    expect(sanitizeNextPath("javascript:alert(1)")).toBeUndefined();
    expect(sanitizeNextPath("/\\evil.com")).toBeUndefined();
    expect(sanitizeNextPath("/ok/path")).toBe("/ok/path");
  });
});

