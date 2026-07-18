import { describe, it, expect } from "vitest";
import { mapBillingError } from "@/lib/billing-generate.functions";

describe("Stage 3B billing generate — mapBillingError", () => {
  it("maps cycle_not_found to a safe message", () => {
    expect(mapBillingError("cycle_not_found")).toMatch(/cycle not found/i);
  });
  it("maps cycle_not_ready", () => {
    expect(mapBillingError("cycle_not_ready")).toMatch(/ready/i);
  });
  it("maps template_not_active", () => {
    expect(mapBillingError("template_not_active")).toMatch(/activate the template/i);
  });
  it("maps duplicate_bills_for_cycle", () => {
    expect(mapBillingError("duplicate_bills_for_cycle")).toMatch(/already exist/i);
  });
  it("maps invalid_request_id", () => {
    expect(mapBillingError("invalid_request_id")).toMatch(/retry/i);
  });
  it("maps bill_not_found", () => {
    expect(mapBillingError("bill_not_found")).toMatch(/not found/i);
  });
  it("maps already_cancelled", () => {
    expect(mapBillingError("already_cancelled")).toMatch(/already cancelled/i);
  });
  it("maps bill_has_payments", () => {
    expect(mapBillingError("bill_has_payments")).toMatch(/payments/i);
  });
  it("never leaks unknown DB messages", () => {
    const out = mapBillingError("relation \"public.bills\" does not exist at line 42");
    expect(out).not.toMatch(/relation|public\.bills|line 42/i);
    expect(out).toMatch(/wrong/i);
  });
  it("falls back through mapError for shared codes", () => {
    expect(mapBillingError("template_overlap")).toMatch(/effective dates/i);
    expect(mapBillingError("unavailable")).toMatch(/isn't available/i);
  });
});

describe("Stage 3B — migration & source integrity", () => {
  it("finalize_bill_batch RPC exposes idempotency key contract", async () => {
    const src = await (await import("node:fs/promises")).readFile(
      "src/lib/billing-generate.functions.ts",
      "utf8",
    );
    expect(src).toMatch(/_request_id/);
    expect(src).toMatch(/idempotent_replay/);
    // No `as any` in Stage 3B source
    expect(src).not.toMatch(/\bas any\b/);
  });

  it("migration allocates structured bill numbers and enforces uniqueness", async () => {
    const glob = await import("node:fs/promises");
    const files = (await glob.readdir("supabase/migrations")).filter((f) =>
      f.endsWith(".sql"),
    );
    let found = false;
    for (const f of files) {
      const body = await glob.readFile(`supabase/migrations/${f}`, "utf8");
      if (body.includes("_allocate_bill_number") && body.includes("bills_society_bill_number_unique")) {
        found = true;
        expect(body).toMatch(/bill_generation_batches/);
        expect(body).toMatch(/UNIQUE\s*\(\s*society_id\s*,\s*cycle_config_id\s*,\s*request_id\s*\)/);
        expect(body).toMatch(/duplicate_bills_for_cycle/);
        expect(body).toMatch(/RR/);
        break;
      }
    }
    expect(found).toBe(true);
  });

  it("does not touch the protected society UUID", async () => {
    const fs = await import("node:fs/promises");
    const paths = [
      "src/lib/billing-generate.functions.ts",
      "src/routes/_society/society.bill-studio.generate.tsx",
    ];
    for (const p of paths) {
      const s = await fs.readFile(p, "utf8");
      expect(s).not.toContain("1907a918-c4b8-4f43-a837-450530cc7c34");
    }
  });

  it("generate route wires the Stage 3B server functions", async () => {
    const fs = await import("node:fs/promises");
    const s = await fs.readFile("src/routes/_society/society.bill-studio.generate.tsx", "utf8");
    expect(s).toMatch(/previewBillBatch/);
    expect(s).toMatch(/finalizeBillBatch/);
    expect(s).toMatch(/listBillBatches/);
    expect(s).toMatch(/useServerFn/);
    // The idempotency key must be built with a UUID, not a plain timestamp
    expect(s).toMatch(/crypto\.randomUUID\(\)/);
  });
});
