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


// ---------------------------------------------------------------------------
// Turn 18B.2A — Direct-RPC bypass + non-enumerating response closure
// ---------------------------------------------------------------------------

import { IncomeTransitionResultSchema } from "@/lib/non-member-income.server";

describe("IncomeTransitionResultSchema (Turn 18B.2A)", () => {
  it("accepts a fully-formed success payload", () => {
    const ok = IncomeTransitionResultSchema.safeParse({
      status: "success",
      recordId: UUID,
      verificationStatus: "verified",
      changedAt: "2026-07-15T12:00:00Z",
    });
    expect(ok.success).toBe(true);
  });
  it("accepts already_processed with a valid currentStatus", () => {
    const r = IncomeTransitionResultSchema.safeParse({
      status: "already_processed",
      currentStatus: "verified",
    });
    expect(r.success).toBe(true);
  });
  it("accepts non-enumerating not_found and plan_required", () => {
    expect(IncomeTransitionResultSchema.safeParse({ status: "not_found" }).success).toBe(true);
    expect(IncomeTransitionResultSchema.safeParse({ status: "plan_required" }).success).toBe(true);
  });
  it("rejects unknown status values", () => {
    expect(IncomeTransitionResultSchema.safeParse({ status: "hacked" }).success).toBe(false);
    expect(IncomeTransitionResultSchema.safeParse(null).success).toBe(false);
    expect(IncomeTransitionResultSchema.safeParse("success").success).toBe(false);
  });
  it("rejects success payload with malformed uuid or verificationStatus", () => {
    expect(
      IncomeTransitionResultSchema.safeParse({
        status: "success",
        recordId: "not-a-uuid",
        verificationStatus: "verified",
        changedAt: "2026-07-15T12:00:00Z",
      }).success,
    ).toBe(false);
    expect(
      IncomeTransitionResultSchema.safeParse({
        status: "success",
        recordId: UUID,
        verificationStatus: "pending",
        changedAt: "2026-07-15T12:00:00Z",
      }).success,
    ).toBe(false);
  });
  it("rejects extra top-level keys via .strict() (Turn 18B.2B)", () => {
    const parsed = IncomeTransitionResultSchema.safeParse({
      status: "not_found",
      society_id: "leak",
      amount: 999,
    });
    expect(parsed.success).toBe(false);
  });
  it("rejects success payloads whose changedAt is not an ISO datetime (Turn 18B.2B)", () => {
    expect(
      IncomeTransitionResultSchema.safeParse({
        status: "success",
        recordId: UUID,
        verificationStatus: "verified",
        changedAt: "not-a-datetime",
      }).success,
    ).toBe(false);
    expect(
      IncomeTransitionResultSchema.safeParse({
        status: "success",
        recordId: UUID,
        verificationStatus: "verified",
        changedAt: "2026-07-15T12:00:00+05:30",
      }).success,
    ).toBe(true);
  });
});

describe("Wrapper input surface cannot forward caller-controlled auth (Turn 18B.2A)", () => {
  const src = fs.readFileSync(
    path.resolve(__dirname, "../..", "src/lib/non-member-income.functions.ts"),
    "utf8",
  );
  it("mutation wrappers accept only recordId (+ optional reason), never societyId/actorId/plan", () => {
    // The Zod schemas guarding the mutation surface.
    expect(src).toMatch(/const\s+RecordIdOnly\s*=\s*z\.object\(\{\s*recordId:\s*z\.string\(\)\.uuid\(\)\s*\}\)/);
    expect(src).toMatch(/const\s+RecordIdWithReason\s*=\s*z\.object\(\{\s*recordId:\s*z\.string\(\)\.uuid\(\),\s*reason:\s*IncomeTransitionReason,\s*\}\)/);
    // No mutation input accepts these caller-forgeable fields.
    expect(src).not.toMatch(/RecordId[A-Za-z]*\s*=\s*z\.object\(\{[^}]*societyId/);
    expect(src).not.toMatch(/RecordId[A-Za-z]*\s*=\s*z\.object\(\{[^}]*actorId/);
    expect(src).not.toMatch(/RecordId[A-Za-z]*\s*=\s*z\.object\(\{[^}]*plan\s*:/);
    expect(src).not.toMatch(/RecordId[A-Za-z]*\s*=\s*z\.object\(\{[^}]*currentStatus/);
  });
  it("wrapper collapses non-admin access to a non-enumerating not_found", () => {
    // The only 'not_authorized' left is unauthenticated-callers (RPC branch).
    // The wrapper must never return not_authorized for signed-in-but-wrong-society.
    const authorize = src.match(/async function authorizeMutation[\s\S]*?^\}/m)?.[0] ?? "";
    expect(authorize).toMatch(/status:\s*"not_found"/);
    expect(authorize).not.toMatch(/status:\s*"not_authorized"/);
  });
  it("callTransitionRpc validates result with the strict Zod schema", () => {
    const rpc = src.match(/async function callTransitionRpc[\s\S]*?^\}/m)?.[0] ?? "";
    expect(rpc).toMatch(/IncomeTransitionResultSchema\.safeParse/);
    expect(rpc).not.toMatch(/as\s+IncomeTransitionResult/);
  });
});

describe("Migration hardening (Turn 18B.2A)", () => {
  const migPath = path.resolve(
    __dirname,
    "../..",
    "supabase/migrations",
  );
  const files = fs.readdirSync(migPath).sort();
  const latest = files
    .filter((f) => f.endsWith(".sql"))
    .map((f) => ({ f, sql: fs.readFileSync(path.join(migPath, f), "utf8") }))
    .filter((x) => /transition_income_record/.test(x.sql));
  const hardening = latest[latest.length - 1];

  it("has an additive corrective migration for transition_income_record", () => {
    expect(hardening).toBeTruthy();
  });
  it("introduces the internal plan entitlement helper", () => {
    const all = latest.map((x) => x.sql).join("\n");
    expect(all).toMatch(/is_non_member_income_enabled_internal/);
  });
  it("RPC returns non-enumerating not_found for inaccessible records", () => {
    const sql = hardening.sql;
    // No branch returns bare 'not_authorized' when a record was found but
    // the caller lacks admin membership.
    const notAuthorizedForNonAdmin = /IF NOT \(public\.is_society_admin_for[\s\S]*?not_authorized/;
    expect(notAuthorizedForNonAdmin.test(sql)).toBe(false);
    expect(sql).toMatch(/IF NOT v_accessible[\s\S]*?not_found/);
  });
  it("RPC enforces plan entitlement inside the database", () => {
    expect(hardening.sql).toMatch(
      /is_non_member_income_enabled_internal\(v_rec\.society_id\)[\s\S]*?plan_required/,
    );
  });
  it("RPC does not accept plan/society/actor from arguments", () => {
    // Signature is exactly (_record_id uuid, _target_status text, _reason text).
    const sig = hardening.sql.match(
      /CREATE OR REPLACE FUNCTION public\.transition_income_record\(([\s\S]*?)\)\s*RETURNS/,
    );
    expect(sig).toBeTruthy();
    const args = sig![1];
    expect(args).toMatch(/_record_id\s+uuid/);
    expect(args).toMatch(/_target_status\s+text/);
    expect(args).toMatch(/_reason\s+text/);
    expect(args).not.toMatch(/_society_id/);
    expect(args).not.toMatch(/_actor_id/);
    expect(args).not.toMatch(/_plan\b/);
  });
  it("revokes execute from PUBLIC and anon; grants only to authenticated", () => {
    expect(hardening.sql).toMatch(/REVOKE ALL ON FUNCTION public\.transition_income_record[^;]*FROM PUBLIC/);
    expect(hardening.sql).toMatch(/REVOKE ALL ON FUNCTION public\.transition_income_record[^;]*FROM anon/);
    expect(hardening.sql).toMatch(/GRANT EXECUTE ON FUNCTION public\.transition_income_record[^;]*TO authenticated/);
  });
  it("removes the unused v_new_recon declaration from the RPC body", () => {
    // Scope the check to the CREATE OR REPLACE ... transition_income_record body.
    const body = hardening.sql.match(
      /CREATE OR REPLACE FUNCTION public\.transition_income_record[\s\S]*?\$\$;/,
    );
    expect(body).toBeTruthy();
    expect(body![0]).not.toMatch(/v_new_recon/);
  });
});

// ---------------------------------------------------------------------------
// Turn 18B.2B — canonical plan-parity matrix + helper-privacy migration
// ---------------------------------------------------------------------------

import { normalizePlan } from "@/lib/plan-features";

describe("normalizePlan canonical matrix (Turn 18B.2B)", () => {
  const future = new Date(Date.now() + 7 * 86400_000).toISOString();
  const past = new Date(Date.now() - 86400_000).toISOString();

  const cases: Array<{ raw: unknown; status: unknown; end?: string | null; expected: "basic" | "pro" | "premium"; label: string }> = [
    { raw: "basic", status: "active", expected: "basic", label: "Basic active" },
    { raw: "pro", status: "active", expected: "pro", label: "Pro active" },
    { raw: "premium", status: "active", expected: "premium", label: "Premium active" },
    { raw: "standard", status: "active", expected: "pro", label: "Standard alias -> pro" },
    { raw: "growth", status: "active", expected: "pro", label: "Growth alias -> pro" },
    { raw: "starter", status: "active", expected: "basic", label: "Starter alias -> basic" },
    { raw: "business", status: "active", expected: "premium", label: "Business alias -> premium" },
    { raw: "enterprise", status: "active", expected: "premium", label: "Enterprise alias -> premium" },
    { raw: "pro", status: "trial", expected: "premium", label: "Trial status inherits premium" },
    { raw: "pro", status: "trialing", expected: "premium", label: "Trialing status inherits premium" },
    { raw: "pro", status: "trial", end: future, expected: "premium", label: "Active trial (future end)" },
    { raw: "pro", status: "trial", end: past, expected: "basic", label: "Expired trial denied" },
    { raw: "pro", status: "trialing", end: past, expected: "basic", label: "Expired trialing denied" },
    { raw: "trial", status: "active", expected: "basic", label: "plan_id=trial alone denied" },
    { raw: "trial", status: null, expected: "basic", label: "plan_id=trial with missing status denied" },
    { raw: "pro", status: "cancelled", expected: "basic", label: "cancelled denied" },
    { raw: "pro", status: "canceled", expected: "basic", label: "canceled (US) denied" },
    { raw: "pro", status: "expired", expected: "basic", label: "expired denied" },
    { raw: "pro", status: "past_due", expected: "basic", label: "past_due denied" },
    { raw: "pro", status: "inactive", expected: "basic", label: "inactive denied" },
    { raw: null, status: null, expected: "basic", label: "missing plan denied" },
    { raw: "", status: "", expected: "basic", label: "empty strings denied" },
    { raw: "gold-super-plan", status: "active", expected: "basic", label: "unknown plan denied" },
    { raw: "pro", status: "  ACTIVE  ", expected: "pro", label: "whitespace/case normalized" },
    { raw: "  PREMIUM  ", status: "active", expected: "premium", label: "raw whitespace/case normalized" },
    { raw: "pro", status: "who-knows", expected: "pro", label: "unknown status falls to plan_id" },
  ];

  for (const c of cases) {
    it(c.label, () => {
      expect(
        normalizePlan(c.raw as string | null, c.status as string | null, c.end),
      ).toBe(c.expected);
    });
  }

  it("Premium inherits Pro entitlements", () => {
    expect(isNonMemberIncomeAllowed("premium")).toBe(true);
    expect(isNonMemberIncomeAllowed("pro")).toBe(true);
    expect(isNonMemberIncomeAllowed("basic")).toBe(false);
  });
});

describe("Turn 18B.2B migration — helper privacy + parity", () => {
  const migDir = path.resolve(__dirname, "../..", "supabase/migrations");
  const files = fs.readdirSync(migDir).filter((f) => f.endsWith(".sql")).sort();
  const b2b = files
    .map((f) => ({ f, sql: fs.readFileSync(path.join(migDir, f), "utf8") }))
    .filter((x) => /is_non_member_income_enabled_internal/.test(x.sql))
    .pop()!;

  it("has an additive Turn 18B.2B migration touching the helper", () => {
    expect(b2b).toBeTruthy();
  });

  it("revokes helper EXECUTE from PUBLIC, anon and authenticated", () => {
    expect(b2b.sql).toMatch(/REVOKE ALL ON FUNCTION public\.is_non_member_income_enabled_internal\(uuid\) FROM PUBLIC/);
    expect(b2b.sql).toMatch(/REVOKE ALL ON FUNCTION public\.is_non_member_income_enabled_internal\(uuid\) FROM anon/);
    expect(b2b.sql).toMatch(/REVOKE ALL ON FUNCTION public\.is_non_member_income_enabled_internal\(uuid\) FROM authenticated/);
  });

  it("does not re-grant helper EXECUTE to any caller-facing role", () => {
    expect(b2b.sql).not.toMatch(/GRANT EXECUTE ON FUNCTION public\.is_non_member_income_enabled_internal\(uuid\) TO (authenticated|anon|PUBLIC)/);
  });

  it("helper mirrors normalizePlan aliases exactly", () => {
    const body = b2b.sql.match(/CREATE OR REPLACE FUNCTION public\.is_non_member_income_enabled_internal[\s\S]*?\$\$;/)![0];
    expect(body).toMatch(/'pro','standard','growth','premium','business','enterprise'/);
    expect(body).toMatch(/'expired','cancelled','canceled','past_due','inactive'/);
    expect(body).toMatch(/'trial','trialing'/);
  });

  it("helper requires non-expired trial_ends_at for trial/trialing", () => {
    const body = b2b.sql.match(/CREATE OR REPLACE FUNCTION public\.is_non_member_income_enabled_internal[\s\S]*?\$\$;/)![0];
    expect(body).toMatch(/trial_ends_at/);
    expect(body).toMatch(/v_trial_ends IS NULL OR v_trial_ends > now\(\)/);
  });

  it("helper does not grant Premium for plan_id='trial' independently", () => {
    const body = b2b.sql.match(/CREATE OR REPLACE FUNCTION public\.is_non_member_income_enabled_internal[\s\S]*?\$\$;/)![0];
    // The bare `IF v_plan = 'trial' THEN RETURN true` branch from 18B.2A must be gone.
    expect(body).not.toMatch(/v_plan\s*=\s*'trial'\s*THEN\s*RETURN\s+true/i);
  });
});

describe("Turn 18B.2B — helper is not reachable from client code or MCP", () => {
  const root = path.resolve(__dirname, "../..");
  function scanDir(dir: string): string[] {
    const out: string[] = [];
    for (const name of fs.readdirSync(dir)) {
      const p = path.join(dir, name);
      const stat = fs.statSync(p);
      if (stat.isDirectory()) out.push(...scanDir(p));
      else if (/\.(ts|tsx)$/.test(name)) out.push(p);
    }
    return out;
  }
  const clientFiles = [
    ...scanDir(path.join(root, "src/routes")),
    ...scanDir(path.join(root, "src/components")),
    ...scanDir(path.join(root, "src/hooks")),
    ...scanDir(path.join(root, "src/lib/mcp")),
  ];

  it("no client, hook, component, or MCP tool references the helper", () => {
    const offenders = clientFiles.filter((f) =>
      /is_non_member_income_enabled_internal/.test(fs.readFileSync(f, "utf8")),
    );
    expect(offenders).toEqual([]);
  });

  it("MCP manifest exposes no write / entitlement-probe tool", () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(root, ".lovable/mcp/manifest.json"), "utf8"));
    const names: string[] = (manifest.tools ?? []).map((t: { name: string }) => t.name);
    for (const n of names) {
      expect(n).not.toMatch(/transition|is_non_member_income|entitle|verify|reject|reverse/i);
    }
  });
});
