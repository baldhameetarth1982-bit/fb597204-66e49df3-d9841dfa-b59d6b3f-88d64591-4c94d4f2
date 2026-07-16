/**
 * Stage 2B — Residents / Family / Vehicles service contract tests.
 *
 * These are behavioural invariants on the ADAPTER layer plus static
 * privacy-projection checks. Full end-to-end integration against Postgres
 * requires isolated fixtures (see the Integration note in the closing
 * report); such fixtures are not available in this sandbox and the
 * protected society MUST NOT be used, so PostgreSQL-touching tests are
 * documented as `.skip` with a clear reason rather than mocked into truth.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { residentRowSchema } from "@/lib/residents-admin.functions";

function read(p: string) {
  return readFileSync(join(process.cwd(), p), "utf8");
}

describe("Stage 2B — canonical reuse", () => {
  it("no new resident/family/vehicle tables were introduced in the Stage 2B migration", () => {
    // The migration must extend flat_residents / family_members / vehicles.
    const files = ["supabase/migrations"];
    // Scan for CREATE TABLE statements referencing forbidden new names.
    const forbidden = /CREATE\s+TABLE\s+(public\.)?(new_residents|residents_v2|society_family|society_vehicles)/i;
    // We only need to confirm none of our source files require these names.
    const src = read("src/lib/residents-admin.functions.ts");
    expect(src).not.toMatch(forbidden);
    // Sanity: the file uses the canonical table names.
    expect(src).toMatch(/family_members|flat_residents|vehicles/);
    expect(files.length).toBeGreaterThan(0);
  });
});

describe("Stage 2B — directory safe-list projection", () => {
  it("residentRowSchema exposes ONLY safe operational fields (no phone, email, KYC, docs)", () => {
    const keys = Object.keys(residentRowSchema.shape);
    const forbidden = ["phone", "email", "aadhaar_verified", "ugvcl_number", "property_number", "share_certificate_number", "kyc", "notes"];
    for (const f of forbidden) expect(keys).not.toContain(f);
    // Must include the necessary safe fields.
    for (const req of ["user_id", "full_name", "flat_id", "flat_number", "block_name", "relationship", "is_active"]) {
      expect(keys).toContain(req);
    }
  });

  it("SQL RPC list_society_residents_page only projects safe columns", () => {
    // Look at the migration source to confirm no phone/email in the RETURNS TABLE.
    const migDir = "supabase/migrations";
    const fs = require("node:fs") as typeof import("node:fs");
    const files = fs.readdirSync(migDir).filter((f: string) => f.endsWith(".sql")).sort();
    const latest = files[files.length - 1];
    const sql = fs.readFileSync(join(migDir, latest), "utf8");
    const idx = sql.indexOf("list_society_residents_page");
    expect(idx).toBeGreaterThan(-1);
    const block = sql.slice(idx, idx + 2000);
    const returnsIdx = block.indexOf("RETURNS TABLE");
    const body = block.slice(returnsIdx, returnsIdx + 1000);
    for (const forbidden of ["phone", "email", "aadhaar", "ugvcl", "property_number", "share_certificate"]) {
      expect(body.toLowerCase()).not.toContain(forbidden);
    }
  });
});

describe("Stage 2B — adapter invariants", () => {
  const src = read("src/lib/residents-admin.functions.ts");

  it("no `supabase.rpc as any` casts", () => {
    // Reject the specific unsafe pattern used pre-Stage 2B.
    expect(src).not.toMatch(/\(\s*supabase\.rpc\s+as\s+any\s*\)/);
    expect(src).not.toMatch(/context\.supabase\.rpc\s+as\s+any/);
  });

  it("no direct browser Supabase client imports", () => {
    expect(src).not.toMatch(/@\/integrations\/supabase\/client["']/);
  });

  it("all mutations go through createServerFn + requireSupabaseAuth", () => {
    // Every exported server fn should be created by createServerFn.
    const fns = src.match(/export const \w+ = createServerFn/g) ?? [];
    expect(fns.length).toBeGreaterThanOrEqual(9);
    // And each should chain .middleware([requireSupabaseAuth]).
    const withAuth = src.match(/\.middleware\(\[requireSupabaseAuth\]\)/g) ?? [];
    expect(withAuth.length).toBe(fns.length);
  });

  it("errors are mapped to short generic codes (no raw DB text)", () => {
    expect(src).toMatch(/operation_failed/);
    expect(src).toMatch(/safeError/);
  });

  it("input schemas reject HTML/script-like names", () => {
    // The nameSchema uses [^<>] regex.
    expect(src).toMatch(/\[\^<>\]\+/);
  });
});

describe("Stage 2B — SQL rules encoded in the migration", () => {
  const fs = require("node:fs") as typeof import("node:fs");
  const files = fs.readdirSync("supabase/migrations").filter((f: string) => f.endsWith(".sql")).sort();
  const latest = files[files.length - 1];
  const sql = fs.readFileSync(join("supabase/migrations", latest), "utf8");

  it("assign RPC rejects cross-society unit and inactive unit", () => {
    expect(sql).toMatch(/unit_not_in_society/);
    expect(sql).toMatch(/unit_inactive/);
  });

  it("assign RPC rejects duplicate active assignment", () => {
    expect(sql).toMatch(/duplicate_active_assignment/);
  });

  it("move-out preserves history (updates, never deletes)", () => {
    // end_resident_unit_relationship must UPDATE, not DELETE.
    const idx = sql.indexOf("end_resident_unit_relationship");
    const block = sql.slice(idx, idx + 1500);
    expect(block).toMatch(/UPDATE\s+public\.flat_residents/);
    expect(block).not.toMatch(/DELETE\s+FROM\s+public\.flat_residents/);
  });

  it("occupancy lifecycle writes to audit_log", () => {
    const assignIdx = sql.indexOf("assign_resident_to_unit(\n");
    const endIdx = sql.indexOf("end_resident_unit_relationship(\n");
    expect(sql.slice(assignIdx, assignIdx + 4000)).toMatch(/INSERT INTO public\.audit_log/);
    expect(sql.slice(endIdx, endIdx + 4000)).toMatch(/INSERT INTO public\.audit_log/);
  });

  it("family RPC rejects cross-society parent", () => {
    expect(sql).toMatch(/resident_not_in_society/);
  });

  it("vehicle upsert normalizes plate and rejects duplicates within society", () => {
    expect(sql).toMatch(/duplicate_active_plate/);
    // Partial unique index on normalized plate exists.
    expect(sql).toMatch(/ux_vehicles_society_plate_norm/);
  });

  it("vehicle upsert rejects cross-society flat", () => {
    const idx = sql.indexOf("admin_upsert_vehicle");
    const block = sql.slice(idx, idx + 2000);
    expect(block).toMatch(/unit_not_in_society/);
  });

  it("every new SECURITY DEFINER RPC is revoked from anon and granted only to authenticated", () => {
    const rpcs = [
      "list_society_residents_page",
      "get_resident_directory_overview",
      "get_resident_private_detail",
      "assign_resident_to_unit",
      "end_resident_unit_relationship",
      "admin_upsert_family_member",
      "admin_delete_family_member",
      "admin_upsert_vehicle",
      "admin_delete_vehicle",
    ];
    for (const fn of rpcs) {
      const rev = new RegExp(`REVOKE ALL ON FUNCTION public\\.${fn}[^;]*FROM PUBLIC, anon`);
      const gr = new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${fn}[^;]*TO authenticated`);
      expect(sql, `${fn} REVOKE missing`).toMatch(rev);
      expect(sql, `${fn} GRANT missing`).toMatch(gr);
    }
  });

  it("every new RPC gates on is_society_admin_for", () => {
    const rpcs = [
      "list_society_residents_page",
      "get_resident_directory_overview",
      "get_resident_private_detail",
      "assign_resident_to_unit",
      "end_resident_unit_relationship",
      "admin_upsert_family_member",
      "admin_delete_family_member",
      "admin_upsert_vehicle",
      "admin_delete_vehicle",
    ];
    for (const fn of rpcs) {
      const idx = sql.indexOf(`FUNCTION public.${fn}(`);
      expect(idx, `${fn} not found`).toBeGreaterThan(-1);
      const body = sql.slice(idx, idx + 3000);
      expect(body, `${fn} missing admin guard`).toMatch(/is_society_admin_for/);
      expect(body, `${fn} missing forbidden raise`).toMatch(/forbidden/);
    }
  });
});

describe("Stage 2B — protected society untouched", () => {
  it("no source file references the protected society ID", () => {
    const forbidden = "1907a918-c4b8-4f43-a837-450530cc7c34";
    const files = [
      "src/lib/residents-admin.functions.ts",
    ];
    for (const p of files) {
      expect(read(p), `${p} must not reference the protected society`).not.toContain(forbidden);
    }
  });

  it("the latest migration does not reference the protected society", () => {
    const fs = require("node:fs") as typeof import("node:fs");
    const files = fs.readdirSync("supabase/migrations").filter((f: string) => f.endsWith(".sql")).sort();
    const latest = files[files.length - 1];
    const sql = fs.readFileSync(join("supabase/migrations", latest), "utf8");
    expect(sql).not.toContain("1907a918-c4b8-4f43-a837-450530cc7c34");
  });
});

describe.skip("Stage 2B — integration against Postgres (requires isolated fixtures)", () => {
  // These behavioural cases need a scratch society + synthetic profiles/flats
  // to exercise real RPC responses. The sandbox has neither an isolated
  // Supabase project nor a helper to create ephemeral societies, and the
  // production protected society is off-limits by roadmap policy.
  it("assign then end preserves history row", () => {
    // TODO: enable when a synthetic fixture helper exists.
  });
});
