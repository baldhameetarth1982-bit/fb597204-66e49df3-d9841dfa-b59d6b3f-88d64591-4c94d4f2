import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Static safety contract for the Phase 4B database security harness and the
 * two fixes it exposed. Runtime proof comes from executing the harness on a
 * disposable database (scripts/run-phase4b-sql.sh); this file guarantees the
 * harness cannot commit data or touch non-synthetic records.
 */
const root = join(__dirname, "..", "..");
const harness = readFileSync(join(root, "tests/sql/phase4b-security-boundaries.sql"), "utf8");
const migDir = join(root, "drizzle/migrations");
const fixMigration = readdirSync(migDir).find((f) => f.includes("phase4b_fix_saas_column_guard"));

describe("Phase 4B SQL harness safety contract", () => {
  it("is a single DO block that always ends by raising (full rollback)", () => {
    expect(harness.match(/\bDO \$p4b\$/g)?.length).toBe(1);
    const tail = harness.slice(harness.lastIndexOf("RAISE EXCEPTION"));
    expect(tail).toMatch(/^RAISE EXCEPTION 'P4B_RESULT\|pass=%\|fail=%\|%'/);
    expect(tail).toMatch(/END\s*\$p4b\$;\s*$/);
    expect(harness).not.toMatch(/\bCOMMIT\b/i);
  });

  it("uses only synthetic 4b4b0000- UUIDs and .invalid emails", () => {
    const uuids = harness.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi) ?? [];
    const nonSynthetic = uuids.filter(
      (u) => !u.startsWith("4b4b0000-") && u !== "00000000-0000-0000-0000-000000000000",
    );
    expect(nonSynthetic).toEqual([]);
    expect(harness).toContain("@example.invalid");
    expect(harness).not.toMatch(/@(gmail|yahoo|outlook|sociohub|sociyohub)\./i);
  });

  it("labels every synthetic society as QA", () => {
    const names = harness.match(/'\[QA\][^']*'/g) ?? [];
    expect(names.length).toBeGreaterThanOrEqual(2);
    expect(harness).not.toMatch(/INSERT INTO public\.societies[^;]*'(?!\[QA\])[A-Z][a-z]+ Society'/);
  });

  it("does not accept a missing helper-function grant as 'hidden' data", () => {
    expect(harness).toContain("permission denied for (table|relation|schema)");
    expect(harness).not.toMatch(/'\^err:\(permission denied\|/);
  });

  it("keeps positive controls so denials cannot pass vacuously", () => {
    for (const name of [
      "ctl.grdA.approved_pass_visible",
      "ctl.resA.own_material_pass",
      "ctl.admA.own_society_non_plan_update",
      "scope.admA.decide_material_pass",
      "poll.resA.vote",
      "meet.resA.rsvp_own_society",
      "cls.resA.own_society_class",
      "cls.admA.own_society_class",
      "link.resA.own_bill_detail",
      "link.resA.election",
    ]) {
      expect(harness).toContain(`'${name}'`);
    }
  });

  it("asserts SaaS plan/trial/billing columns are protected from society admins", () => {
    for (const name of ["sa.admA.society_plan_columns", "sa.admA.society_trial_extend", "sa.admA.society_billing_active"]) {
      const row = harness.split("\n").find((l) => l.includes(`'${name}'`)) ?? "";
      expect(row).toContain("'err:protected_society_columns'");
    }
  });
});

describe("Phase 4C class-list and deep-link coverage", () => {
  it("covers cross-society, identifier-swap, moved-out and anon class reads", () => {
    for (const name of [
      "cls.resA.other_society_class_by_id", "cls.resA.other_society_by_amenity", "cls.resA.other_society_by_society",
      "cls.resB.society_a_class", "cls.resX.moved_out_resident", "cls.anon.class", "cls.admB.society_a_class",
      "link.resB.bill_detail_swapped_id", "link.resB.election_swapped_id", "link.admB.election_swapped_id",
    ]) {
      expect(harness).toContain(`'${name}'`);
    }
  });

  it("fixes the class policy through the caller-scoped wrapper, not a broad grant", () => {
    const f = readdirSync(migDir).find((x) => x.includes("phase4c_fix_amenity_classes_member_read"));
    expect(f).toBeTruthy();
    const sql = readFileSync(join(migDir, f!), "utf8");
    expect(sql).toMatch(/public\.authorize_membership\(auth\.uid\(\), society_id\)/);
    expect(sql).not.toMatch(/^\s*GRANT\b/im);
  });
});

describe("Phase 4B security fixes migration", () => {
  it("exists and makes the SaaS-column guard run as the caller", () => {
    expect(fixMigration).toBeTruthy();
    const sql = readFileSync(join(migDir, fixMigration!), "utf8");
    expect(sql).toMatch(/ALTER FUNCTION public\._societies_protect_saas_columns\(\) SECURITY INVOKER/);
  });

  it("grants only the caller-scoped guard helper to signed-in users (not anon/public)", () => {
    const sql = readFileSync(join(migDir, fixMigration!), "utf8");
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION public\._guard_role_society\(\) TO authenticated;/);
    expect(sql).not.toMatch(/TO (anon|public)\b/i);
    expect(sql).not.toMatch(/_authorize_membership_internal/);
  });
});
