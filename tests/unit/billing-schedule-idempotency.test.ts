import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";

describe("Run billing now — database-enforced idempotency", () => {
  const dir = "drizzle/migrations";
  const file = readdirSync(dir).find((f) => f.includes("bills_schedule_run_idempotency"));
  const sql = file ? readFileSync(`${dir}/${file}`, "utf8") : "";

  it("migration exists", () => expect(file).toBeTruthy());
  it("serialises concurrent inserts per society + home + period", () => {
    expect(sql).toMatch(/pg_advisory_xact_lock/);
    expect(sql).toMatch(/NEW\.society_id[\s\S]*NEW\.flat_id[\s\S]*NEW\.period_start/);
  });
  it("rejects a second active bill but allows rebilling after cancellation", () => {
    expect(sql).toMatch(/<> 'cancelled'/);
    expect(sql).toMatch(/duplicate_bill_for_period/);
    expect(sql).toMatch(/BEFORE INSERT ON public\.bills/);
  });
  it("leaves Bill Studio cycle batches to their own guard", () => {
    expect(sql).toMatch(/cycle_config_id IS NOT NULL OR NEW\.generation_batch_id IS NOT NULL/);
  });
  it("server maps the race error without leaking DB text", () => {
    const src = readFileSync("src/lib/billing.functions.ts", "utf8");
    expect(src).toMatch(/duplicate_bill_for_period/);
    expect(src).not.toMatch(/: insErr\.message\);/);
  });
});
