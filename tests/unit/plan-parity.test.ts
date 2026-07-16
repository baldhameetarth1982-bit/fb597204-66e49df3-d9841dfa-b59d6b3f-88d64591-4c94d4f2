/**
 * Stage 1D — plan parity between canonical TypeScript spec and SQL RPC.
 *
 * The test imports PLAN_NORMALIZATION_SPEC from src/lib/plan-features.ts
 * and asserts that the current create_non_member_income_record migration's
 * plan-check body contains EXACTLY the same alias/status sets.
 *
 * This fails if either side gains or loses a value without the other being
 * updated in the same change.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { PLAN_NORMALIZATION_SPEC, normalizePlan } from "@/lib/plan-features";

function loadLatestCreateFnMigration(): string {
  const dir = join(process.cwd(), "supabase", "migrations");
  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  let latest = "";
  for (const f of files) {
    const body = readFileSync(join(dir, f), "utf8");
    if (
      body.includes("FUNCTION public.create_non_member_income_record") &&
      body.includes("_plan_ok")
    ) {
      latest = body;
    }
  }
  if (!latest) throw new Error("no create_non_member_income_record migration found");
  return latest;
}

function extractInList(sql: string, marker: string): string[] {
  // Find the `lower(coalesce(_plan_XXX,'')) IN ('a','b',...)` line for the marker.
  const re = new RegExp(
    `lower\\(coalesce\\(${marker},''\\)\\)\\s+IN\\s*\\(([^)]+)\\)`,
    "i",
  );
  const m = sql.match(re);
  if (!m) return [];
  return m[1]
    .split(",")
    .map((s) => s.trim().replace(/^'/, "").replace(/'$/, "").toLowerCase())
    .filter(Boolean);
}

describe("Stage 1D — plan parity: SQL vs canonical spec", () => {
  const sql = loadLatestCreateFnMigration();

  it("SQL inactive-status set exactly equals canonical inactiveStatuses", () => {
    const sqlSet = new Set(extractInList(sql, "_plan_status"));
    const specSet = new Set<string>(PLAN_NORMALIZATION_SPEC.inactiveStatuses);
    expect([...sqlSet].sort()).toEqual([...specSet].sort());
  });

  it("SQL paid-plan alias set exactly equals canonical pro+premium aliases", () => {
    const sqlSet = new Set(extractInList(sql, "_plan_id"));
    const specSet = new Set<string>([
      ...PLAN_NORMALIZATION_SPEC.paidPlanAliases.pro,
      ...PLAN_NORMALIZATION_SPEC.paidPlanAliases.premium,
    ]);
    expect([...sqlSet].sort()).toEqual([...specSet].sort());
  });

  it("SQL trial branch requires non-null AND future trial_ends_at", () => {
    // Must include both an IS NOT NULL check and a > now() comparison for
    // trial_ends_at on the trial/trialing branch.
    expect(sql).toMatch(/_trial_ends_at\s+IS\s+NOT\s+NULL/i);
    expect(sql).toMatch(/_trial_ends_at\s*>\s*now\(\)/i);
    // Must NOT permit the previous permanent-trial rule.
    expect(sql).not.toMatch(/_trial_ends_at\s+IS\s+NULL\s+OR\s+_trial_ends_at\s*>\s*now\(\)/i);
  });
});

describe("Stage 1D — normalizePlan trial safety", () => {
  it("null trial_ends_at → basic", () => {
    expect(normalizePlan(null, "trialing")).toBe("basic");
    expect(normalizePlan(null, "trialing", null)).toBe("basic");
  });
  it("past trial_ends_at → basic", () => {
    const past = new Date(Date.now() - 60_000).toISOString();
    expect(normalizePlan(null, "trial", past)).toBe("basic");
  });
  it("future trial_ends_at → premium", () => {
    const future = new Date(Date.now() + 60_000).toISOString();
    expect(normalizePlan(null, "trialing", future)).toBe("premium");
  });
  it("malformed trial_ends_at → basic", () => {
    expect(normalizePlan(null, "trialing", "not-a-date")).toBe("basic");
  });
  it("unknown plan → basic", () => {
    expect(normalizePlan("gold-mystery", "active")).toBe("basic");
  });
  it("Pro/Premium aliases resolve", () => {
    for (const a of PLAN_NORMALIZATION_SPEC.paidPlanAliases.pro) {
      expect(normalizePlan(a, "active")).toBe("pro");
    }
    for (const a of PLAN_NORMALIZATION_SPEC.paidPlanAliases.premium) {
      expect(normalizePlan(a, "active")).toBe("premium");
    }
  });
});
