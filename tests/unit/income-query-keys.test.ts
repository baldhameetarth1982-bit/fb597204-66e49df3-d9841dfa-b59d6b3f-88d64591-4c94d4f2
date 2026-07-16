/**
 * Stage 1D — query-key centralization + RPC-adapter invariants.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  incomeKeys,
  incomeInvalidations,
} from "@/lib/income-query-keys";

const ROUTES = [
  "src/routes/_society/society.income.tsx",
  "src/routes/_society/society.income.$id.tsx",
  "src/routes/_society/society.income.categories.tsx",
  "src/routes/_society/society.income.payers.tsx",
  "src/routes/_society/society.income.new.tsx",
];

function read(f: string): string {
  return readFileSync(join(process.cwd(), f), "utf8");
}

describe("Stage 1D — income query key factory", () => {
  it("every key is society-scoped and prefixed", () => {
    const sid = "11111111-1111-1111-1111-111111111111";
    const keys = [
      incomeKeys.dashboard(sid),
      incomeKeys.records(sid, {}, 0),
      incomeKeys.record(sid, "r1"),
      incomeKeys.categories(sid),
      incomeKeys.activeCategories(sid),
      incomeKeys.payers(sid),
      incomeKeys.activePayers(sid),
      incomeKeys.payerDetail(sid, "p1"),
    ];
    for (const k of keys) {
      expect(k[0]).toBe("society-income");
      expect(k[1]).toBe(sid);
    }
  });

  it("different filters produce different record keys", () => {
    const sid = "sid";
    const a = JSON.stringify(incomeKeys.records(sid, { verification_status: "verified" }, 0));
    const b = JSON.stringify(incomeKeys.records(sid, { verification_status: "pending" }, 0));
    expect(a).not.toEqual(b);
  });

  it("society switch produces different key trees", () => {
    const a = JSON.stringify(incomeKeys.dashboard("s1"));
    const b = JSON.stringify(incomeKeys.dashboard("s2"));
    expect(a).not.toEqual(b);
  });

  it("category invalidations touch category tree only", () => {
    const keys = incomeInvalidations.category("sid");
    for (const k of keys) expect(k).toContain("categories");
  });

  it("payer invalidations touch payer tree only", () => {
    const keys = incomeInvalidations.payer("sid", "p1");
    for (const k of keys) {
      expect(k.some((s) => s === "payers" || s === "payer")).toBe(true);
    }
  });
});

describe("Stage 1D — all Stage 1 income routes use the factory", () => {
  for (const path of ROUTES) {
    it(`${path} imports incomeKeys`, () => {
      const src = read(path);
      expect(src).toMatch(/from ["']@\/lib\/income-query-keys["']/);
    });
    it(`${path} contains no ad-hoc bracketed "society-income" queryKey`, () => {
      const src = read(path);
      // Look for `["society-income"` literals in queryKey positions.
      // Allow the string only via factory calls (which are function calls).
      const adHoc = src.match(/queryKey:\s*\[\s*["']society-income["']/g);
      expect(adHoc, `found ad-hoc keys in ${path}`).toBeNull();
    });
  }
});

describe("Stage 1D — RPC adapter invariants", () => {
  const src = read("src/lib/non-member-income.functions.ts");

  it("no `supabase.rpc as any` in the creation adapter", () => {
    expect(src).not.toMatch(/\.rpc\s+as\s+any/);
  });

  it("adapter passes _creation_request_id and no canonical/hash args", () => {
    expect(src).toMatch(/_creation_request_id:\s*data\.creation_request_id/);
    expect(src).not.toMatch(/_canonical_payload/);
    expect(src).not.toMatch(/_payload_hash/);
    expect(src).not.toMatch(/_creation_payload_hash/);
  });
});

describe("Stage 1D — generated Supabase types match 11-arg RPC", () => {
  const types = read("src/integrations/supabase/types.ts");

  it("has exactly 11 args on create_non_member_income_record", () => {
    // Extract the Args block for that RPC.
    const idx = types.indexOf("create_non_member_income_record:");
    expect(idx).toBeGreaterThan(0);
    const slice = types.slice(idx, idx + 1200);
    const argsBlockMatch = slice.match(/Args:\s*\{([^}]+)\}/);
    expect(argsBlockMatch).not.toBeNull();
    const argsBody = argsBlockMatch![1];
    const argCount = argsBody.split("\n").filter((l) => /^\s*_/.test(l)).length;
    expect(argCount).toBe(11);
    expect(argsBody).not.toMatch(/_canonical_payload/);
    expect(argsBody).not.toMatch(/_payload_hash/);
    expect(argsBody).toMatch(/_creation_request_id/);
  });
});
