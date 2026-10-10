import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { userMessage } from "@/lib/user-error";
import { toSafeFinanceMessage } from "@/lib/finance-safe-error";

describe("launch gap rules", () => {
  it("adding a flat past the purchased quantity explains the flat limit", () => {
    expect(userMessage(new Error("flat_capacity_reached"))).toMatch(/^Flat limit reached/);
  });

  it("a second bill for the same home and month is explained, not hidden", () => {
    expect(toSafeFinanceMessage(new Error("duplicate_bill_for_period"))).toMatch(/already has a bill for that month/);
  });

  it("standard plan checkout amount is base plus GST from the platform setting", () => {
    const sql = readFileSync("drizzle/migrations/0230_standard_plan_quote_adds_gst.sql", "utf8");
    expect(sql).toMatch(/taxes->>'gst_percent'/);
    expect(sql).toMatch(/'amount_paise', CASE WHEN v_quotable THEN v_base \+ v_tax END/);
  });
});
