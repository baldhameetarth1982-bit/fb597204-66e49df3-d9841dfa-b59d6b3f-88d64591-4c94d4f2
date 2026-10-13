import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { FEATURE_MIN_PLAN } from "@/lib/plan-features";

const dir = "drizzle/migrations";
const file = readdirSync(dir).find((f) => f.includes("server_plan_gates_and_admin_step_checks"));
const sql = file ? readFileSync(`${dir}/${file}`, "utf8") : "";

const RANK = { basic: 0, pro: 1, premium: 2 } as const;
const gate = (table: string) => {
  const m = sql.match(new RegExp(`BEFORE INSERT ON public\\.${table} FOR EACH ROW EXECUTE FUNCTION public\\._trg_enforce_plan_feature\\('(\\d)'\\)`));
  return m ? Number(m[1]) : null;
};

describe("Server-side plan locks", () => {
  it("migration exists", () => expect(file).toBeTruthy());

  it("database locks match the app's plan matrix", () => {
    expect(gate("visitors")).toBe(RANK[FEATURE_MIN_PLAN.visitors]);
    expect(gate("vehicles")).toBe(RANK[FEATURE_MIN_PLAN.vehicles]);
    expect(gate("amenities")).toBe(RANK[FEATURE_MIN_PLAN.amenities]);
    expect(gate("amenity_bookings")).toBe(RANK[FEATURE_MIN_PLAN.resident_amenities]);
    expect(gate("polls")).toBe(RANK[FEATURE_MIN_PLAN.polls]);
    expect(gate("posts")).toBe(RANK[FEATURE_MIN_PLAN.community_feed]);
    expect(gate("post_comments")).toBe(RANK[FEATURE_MIN_PLAN.community_feed]);
    expect(gate("meetings")).toBe(RANK[FEATURE_MIN_PLAN.meetings]);
    expect(gate("agms")).toBe(RANK[FEATURE_MIN_PLAN.agm]);
    expect(gate("elections")).toBe(RANK[FEATURE_MIN_PLAN.elections]);
    // Formal votes are polls of kind 'vote' and need Pro.
    expect(RANK[FEATURE_MIN_PLAN.formal_votes]).toBe(2);
    expect(sql).toMatch(/coalesce\(NEW\.kind, 'poll'\) = 'vote' THEN v_min := 2/);
  });

  it("plan rank fails closed like normalizePlan", () => {
    expect(sql).toMatch(/s\.soc <> '' AND s\.soc <> 'active' THEN RETURN 0/);
    expect(sql).toMatch(/s\.trial_ends_at IS NOT NULL AND s\.trial_ends_at > now\(\) THEN 2 ELSE 0/);
    expect(sql).toMatch(/s\.plan_expires_at <= now\(\) THEN RETURN 0/);
    expect(sql).toMatch(/s\.pst <> '' AND s\.pst <> 'active' THEN RETURN 0/);
  });

  it("the trigger helper is not callable by browsers", () => {
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\._trg_enforce_plan_feature\(\) FROM PUBLIC, anon, authenticated/);
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\._society_plan_rank\(uuid\) FROM PUBLIC, anon/);
  });

  it("Super Admin power in permission helpers needs the full three-step sign-in", () => {
    expect(sql).toMatch(/IF public\.is_super_admin\(v_uid\) THEN RETURN true/);
    expect(sql).toMatch(/SELECT public\.is_super_admin\(auth\.uid\(\)\) OR EXISTS/);
    expect(sql).not.toMatch(/role = 'super_admin' AND COALESCE\(is_active, true\)\s*\)\s*THEN RETURN true/);
  });
});
