import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../..");
const read = (path: string) => readFileSync(resolve(root, path), "utf8");
const migrationDir = resolve(root, "supabase/migrations");
const migrations = readdirSync(migrationDir)
  .filter((name) => name.endsWith(".sql"))
  .sort()
  .map((name) => readFileSync(resolve(migrationDir, name), "utf8"))
  .join("\n");

describe("Flat 360 database authorization source contract", () => {
  it("keeps every directly queried table behind RLS", () => {
    for (const table of [
      "flats",
      "flat_residents",
      "profiles",
      "family_members",
      "bills",
      "payments",
      "vehicles",
    ]) {
      expect(migrations).toMatch(new RegExp(`ALTER TABLE public\\.${table} ENABLE ROW LEVEL SECURITY`, "i"));
      expect(migrations).not.toMatch(new RegExp(`ALTER TABLE public\\.${table} DISABLE ROW LEVEL SECURITY`, "i"));
    }
  });

  it("binds society and block access to the authenticated user's assignments", () => {
    const policyMigration = read(
      "supabase/migrations/20260607195041_2a3c9bc3-e6d7-4c1d-924d-62e1c00eae07.sql",
    );
    expect(policyMigration).toContain("society_id IN (SELECT public.get_admin_society_ids(auth.uid()))");
    expect(policyMigration).toContain("block_id IN (SELECT public.get_admin_block_ids(auth.uid()))");
    expect(policyMigration).toContain(
      "flat_id IN (SELECT f.id FROM public.flats f WHERE f.block_id IN (SELECT public.get_admin_block_ids(auth.uid())))",
    );
  });

  it("keeps financial reads tenant-scoped and residents limited to assigned flats", () => {
    const billingMigration = read(
      "supabase/migrations/20260510002202_ab5bfc63-4fa5-4140-bf34-b1adfd77881e.sql",
    );
    expect(billingMigration).toMatch(/ON public\.bills FOR ALL TO authenticated[\s\S]*?role = 'society_admin'/);
    expect(billingMigration).toMatch(/ON public\.payments FOR ALL TO authenticated[\s\S]*?role = 'society_admin'/);
    expect(billingMigration).toMatch(/ON public\.bills FOR SELECT TO authenticated[\s\S]*?flat_id IN \([\s\S]*?user_id = auth\.uid\(\)/);
    expect(billingMigration).toMatch(/ON public\.payments FOR SELECT TO authenticated[\s\S]*?flat_id IN \([\s\S]*?user_id = auth\.uid\(\)/);
  });

  it("binds family and vehicle visibility to a society or owned record", () => {
    const familyMigration = read(
      "supabase/migrations/20260717161327_8b8a05d6-7396-4894-a4ef-14ee4e694b09.sql",
    );
    const guardMigration = read("drizzle/migrations/0056_stage11_guard_and_lockout_boundary.sql");
    expect(familyMigration).toMatch(/family admin society read[\s\S]*?current_user_is_society_admin_for\(society_id\)/);
    expect(guardMigration).toMatch(/admins view society vehicles[\s\S]*?ur\.user_id = auth\.uid\(\)[\s\S]*?ur\.society_id IS NOT NULL/);
    expect(guardMigration).not.toMatch(/admins view society vehicles[\s\S]*?role IN \([^)]*'security'/);
  });

  it("uses authenticated self-checks for roles and the trusted client only for eligibility", () => {
    const service = read("src/lib/flat360.functions.ts");
    const authSection = service.slice(
      service.indexOf("export function attachAuthorizationRpcs"),
      service.indexOf("/* ================================================================== */\n/*  Exported server function"),
    );
    expect(authSection).toContain('callBool(authenticated, "current_user_is_society_admin_for"');
    expect(authSection).toContain('callBool(authenticated, "current_user_can_manage_flat"');
    expect(authSection).toContain('callBool(authenticated, "current_user_is_super_admin"');
    expect(authSection).toContain('admin.rpc("compute_no_dues_eligibility_internal"');
    expect(authSection).not.toContain('admin.rpc("is_');
  });

  it("keeps eligibility pair-bound and unavailable to browser roles", () => {
    const eligibilityMigration = read(
      "supabase/migrations/20260714193908_5b40f978-98d6-49b1-8216-81f7d76deea1.sql",
    );
    expect(eligibilityMigration).toMatch(/f\.id = _flat_id AND f\.society_id = _society_id/);
    expect(eligibilityMigration).toMatch(/p\.society_id = _society_id AND p\.flat_id = _flat_id/);
    expect(eligibilityMigration).toMatch(/b\.society_id = _society_id[\s\S]*?b\.flat_id = _flat_id/);
    expect(eligibilityMigration).toContain(
      "REVOKE EXECUTE ON FUNCTION public.compute_no_dues_eligibility_internal(uuid, uuid) FROM anon, authenticated",
    );
    expect(eligibilityMigration).toContain(
      "GRANT EXECUTE ON FUNCTION public.compute_no_dues_eligibility_internal(uuid, uuid) TO service_role",
    );
  });
});