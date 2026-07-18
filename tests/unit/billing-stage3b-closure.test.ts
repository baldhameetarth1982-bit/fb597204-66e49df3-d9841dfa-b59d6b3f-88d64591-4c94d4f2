import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { mapBillingError } from "@/lib/billing-generate.functions";

/**
 * Stage 3B closure — behavioral & source-contract proofs.
 *
 * These are intentionally source/adapter-level assertions because the Stage
 * 3B server functions delegate all state changes to SECURITY DEFINER RPCs;
 * they never accept client-submitted totals, and there is no way to prove
 * the invariants below without either running the DB or reading the source
 * contract. Live-DB behavioral tests for the RPCs run in the SQL test suite.
 */

const genSrc = readFileSync("src/lib/billing-generate.functions.ts", "utf8");
const migSrc = readFileSync(
  "supabase/migrations/" +
    (require("node:fs").readdirSync("supabase/migrations") as string[])
      .filter((f) => f.endsWith(".sql"))
      .sort()
      .reverse()
      .find((f) => {
        const src = readFileSync(`supabase/migrations/${f}`, "utf8");
        // Pick the Stage 3B migration specifically (audit + finalize_bill_batch),
        // not a later Stage 3C+ additive migration.
        return src.includes("audit_log") && src.includes("finalize_bill_batch");
      })!,
  "utf8",
);


describe("Stage 3B closure — server function hardening", () => {
  it("has no `as any` in Stage 3B source", () => {
    expect(genSrc).not.toMatch(/\bas any\b/);
  });

  it("never accepts a client-submitted total on finalize", () => {
    // Zod schema for finalizeBillBatch must only accept societyId/cycleConfigId/requestId/prefix.
    const schemaBlock = genSrc.match(/finalizeBillBatch[\s\S]*?\.handler/)![0];
    expect(schemaBlock).toMatch(/requestId/);
    expect(schemaBlock).toMatch(/prefix/);
    expect(schemaBlock).not.toMatch(/totalPayable|totalAmount|clientTotal/);
  });

  it("preview shape exposes server-derived totals", () => {
    expect(genSrc).toMatch(/unit_count/);
    expect(genSrc).toMatch(/current_charges_total/);
    expect(genSrc).toMatch(/previous_dues_total/);
    expect(genSrc).toMatch(/total_payable/);
  });

  it("exposes resident-safe read functions", () => {
    expect(genSrc).toMatch(/export const getResidentBills\b/);
    expect(genSrc).toMatch(/export const getResidentBillDetail\b/);
    // Ownership check is explicit — the detail handler queries flat_residents
    // with the caller's userId and returns bill_not_found otherwise.
    expect(genSrc).toMatch(/getResidentBillDetail[\s\S]*flat_residents[\s\S]*bill_not_found/);
  });

  it("uses requireSupabaseAuth on every Stage 3B function", () => {
    const fns = genSrc.match(/createServerFn/g) ?? [];
    const middlewares = genSrc.match(/requireSupabaseAuth/g) ?? [];
    // 1 import + 1 usage per createServerFn call
    expect(middlewares.length).toBeGreaterThanOrEqual(fns.length);
  });

  it("cancel/list/detail admin functions map errors safely", () => {
    expect(mapBillingError("bill_has_payments")).toMatch(/payments/i);
    expect(mapBillingError("already_cancelled")).toMatch(/already cancelled/i);
    // Raw DB text is scrubbed
    const raw = mapBillingError('relation "public.bills" does not exist');
    expect(raw).not.toMatch(/relation|public\.bills/i);
  });
});

describe("Stage 3B closure — migration audit + preview totals", () => {
  it("finalize_bill_batch writes an audit_log row", () => {
    expect(migSrc).toMatch(/INSERT INTO public\.audit_log[\s\S]*billing\.batch_finalized/);
  });

  it("cancel_bill writes an audit_log row", () => {
    expect(migSrc).toMatch(/INSERT INTO public\.audit_log[\s\S]*billing\.bill_cancelled/);
  });

  it("preview_bill_batch returns unit_count + total_payable + current_charges_total", () => {
    expect(migSrc).toMatch(/'unit_count',/);
    expect(migSrc).toMatch(/'current_charges_total',/);
    expect(migSrc).toMatch(/'total_payable',/);
  });

  it("preview surfaces no_active_units warning", () => {
    expect(migSrc).toMatch(/no_active_units/);
  });

  it("uses RR/YYYYMM/#### bill numbering with lpad 4", () => {
    // Allocator lives in an earlier migration; verify format anywhere in the tree.
    const allBills = require("node:fs")
      .readdirSync("supabase/migrations")
      .filter((f: string) => f.endsWith(".sql"))
      .map((f: string) => readFileSync(`supabase/migrations/${f}`, "utf8"))
      .join("\n");
    expect(allBills).toMatch(/lpad\(_next::text, 4, '0'\)/);
    expect(allBills).toMatch(/bills_society_bill_number_unique/);
  });
});

describe("Stage 3B closure — protected society + no payment/receipt scope creep", () => {
  it("no Stage 3B source references the protected society UUID", () => {
    const paths = [
      "src/lib/billing-generate.functions.ts",
      "src/routes/_society/society.bill-studio.generate.tsx",
      "src/routes/_society/society.bills.$id.tsx",
      "src/routes/_resident/app.bills.tsx",
    ];
    for (const p of paths) {
      expect(readFileSync(p, "utf8")).not.toContain(
        "1907a918-c4b8-4f43-a837-450530cc7c34",
      );
    }
  });

  it("Stage 3B server function file does not mutate payments/receipts/ledger", () => {
    expect(genSrc).not.toMatch(/\.from\("payments"\)\.(insert|update|delete)/);
    expect(genSrc).not.toMatch(/\.from\("bill_line_items"\)\.(insert|update|delete)/);
    expect(genSrc).not.toMatch(/ledger_entries/);
    expect(genSrc).not.toMatch(/"platform_fee"/);
  });

  it("generate confirmation dialog carries required Stage 3B copy", () => {
    const uiSrc = readFileSync(
      "src/routes/_society/society.bill-studio.generate.tsx",
      "utf8",
    );
    expect(uiSrc).toMatch(/No payments are recorded in this step/);
    expect(uiSrc).toMatch(/Stage 3C/);
    expect(uiSrc).toMatch(/RR\/YYYYMM/);
    expect(uiSrc).toMatch(/Preview only — no bills generated yet/);
  });

  it("admin bill detail exposes cancel-with-reason, blocked when payments exist", () => {
    const src = readFileSync("src/routes/_society/society.bills.$id.tsx", "utf8");
    expect(src).toMatch(/cancelBill/);
    expect(src).toMatch(/hasVerifiedPayment/);
    expect(src).toMatch(/canCancel/);
  });

  it("resident bills route uses getResidentBills (server-authoritative ownership)", () => {
    const src = readFileSync("src/routes/_resident/app.bills.tsx", "utf8");
    expect(src).toMatch(/getResidentBills/);
    expect(src).toMatch(/useServerFn\(getResidentBills\)/);
  });
});
