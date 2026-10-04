import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const sql = readFileSync("drizzle/migrations/0184_finance_governance_integrity_batch.sql", "utf8");

describe("0184 finance/governance integrity batch", () => {
  it("keeps earlier notice wording in an append-only, committee-read table", () => {
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS public\.notice_versions/);
    expect(sql).toMatch(/notice_versions_append_only BEFORE UPDATE OR DELETE/);
    expect(sql).toMatch(/OLD\.status = 'published'/);
    expect(sql).not.toMatch(/GRANT (INSERT|UPDATE|DELETE)[^;]*notice_versions TO authenticated/);
  });

  it("locks recorded procurement references", () => {
    for (const k of ["order_ref_locked", "invoice_locked", "payment_ref_locked", "locked_after_approval", "expense_link_immutable"]) {
      expect(sql).toContain(k);
    }
  });

  it("allows only one confirmed invoice per purchase request and completes via the single expense link", () => {
    expect(sql).toMatch(/invoice_extractions_one_confirmed_per_procurement[\s\S]*WHERE status = 'confirmed'/);
    expect(sql).toMatch(/FROM public\.procurement_requests p WHERE p\.id = _procurement_request_id AND p\.society_id = r\.society_id FOR UPDATE/);
    expect(sql).toContain("procurement_already_closed");
    expect(sql).toContain("procurement_already_invoiced");
    expect(sql).toMatch(/SET status = 'completed', expense_id = \(v_res->>'expense_id'\)::uuid/);
  });
});
