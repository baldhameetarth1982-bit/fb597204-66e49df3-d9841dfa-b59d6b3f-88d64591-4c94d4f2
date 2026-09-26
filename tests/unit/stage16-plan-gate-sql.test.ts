import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";

const dir = "drizzle/migrations";
const file = readdirSync(dir).find((f) => f.includes("close_plan_gate_expiry_suspension"));
const sql = file ? readFileSync(`${dir}/${file}`, "utf8") : "";

describe("Stage 16 database plan gates (Smart QR, gamification, finance)", () => {
  it("migration exists", () => expect(file).toBeTruthy());
  it("suspended societies are denied by both gates", () => {
    expect(sql).toMatch(/_finance_plan_enabled[\s\S]*coalesce\(s\.status,'active'\)\)\) = 'active'/);
    expect(sql).toMatch(/is_non_member_income_enabled_internal[\s\S]*s\.soc <> 'active'/);
  });
  it("expired paid plans are denied by both gates", () => {
    expect(sql).toMatch(/s\.plan_expires_at IS NULL OR s\.plan_expires_at > now\(\)/);
    expect(sql).toMatch(/s\.plan_expires_at <= now\(\) THEN RETURN false/);
  });
  it("trials need a future end date and unknown statuses fail closed", () => {
    expect(sql).toMatch(/s\.trial_ends_at IS NOT NULL AND s\.trial_ends_at > now\(\)/);
    expect(sql).toMatch(/s\.pst <> '' AND s\.pst <> 'active' THEN RETURN false/);
  });
});
