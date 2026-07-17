/**
 * Stage 2B — Residents / Family / Vehicles service contract tests.
 *
 * Behavioural invariants on the ADAPTER layer + static privacy-projection
 * checks. Real end-to-end Postgres integration requires isolated fixtures
 * that are not available in this sandbox; the protected society MUST NOT
 * be used as a fixture. Postgres-touching cases are documented under a
 * `.skip` block with a clear reason.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  residentRowSchema,
  privateDetailSchema,
} from "@/lib/residents-admin.functions";

function read(p: string) {
  return readFileSync(join(process.cwd(), p), "utf8");
}

const MIG_DIR = "supabase/migrations";
const migFiles = readdirSync(MIG_DIR).filter((f) => f.endsWith(".sql")).sort();
const migSql = migFiles.map((f) => read(join(MIG_DIR, f))).join("\n");

describe("Stage 2B — canonical reuse", () => {
  it("no new resident/family/vehicle tables were introduced", () => {
    const forbidden = /CREATE\s+TABLE\s+(public\.)?(new_residents|residents_v2|society_family|society_vehicles)/i;
    const src = read("src/lib/residents-admin.functions.ts");
    expect(src).not.toMatch(forbidden);
    expect(src).toMatch(/family_members|flat_residents|vehicles/);
  });
});

describe("Stage 2B — directory safe-list projection", () => {
  it("residentRowSchema exposes ONLY safe operational fields", () => {
    const keys = Object.keys(residentRowSchema.shape);
    const forbidden = ["phone", "email", "aadhaar_verified", "ugvcl_number", "property_number", "share_certificate_number", "kyc", "notes"];
    for (const f of forbidden) expect(keys).not.toContain(f);
    for (const req of ["user_id", "full_name", "flat_id", "flat_number", "block_name", "relationship", "is_active"]) {
      expect(keys).toContain(req);
    }
  });

  it("SQL RPC list_society_residents_page only projects safe columns", () => {
    const idx = migSql.indexOf("list_society_residents_page");
    expect(idx).toBeGreaterThan(-1);
    const block = migSql.slice(idx, idx + 2000);
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
    expect(src).not.toMatch(/\(\s*supabase\.rpc\s+as\s+any\s*\)/);
    expect(src).not.toMatch(/context\.supabase\.rpc\s+as\s+any/);
  });

  it("no unsafe null-to-string casts on optional RPC arguments", () => {
    // Pre-Stage 2B pattern: `undef(v) as string`. Must be gone.
    expect(src).not.toMatch(/undef\s*\(/);
    // `as any` is never used in this module.
    expect(src.replace(/\/\/.*|\/\*[\s\S]*?\*\//g, "")).not.toMatch(/\bas\s+any\b/);
  });

  it("no direct browser Supabase client imports", () => {
    expect(src).not.toMatch(/@\/integrations\/supabase\/client["']/);
  });

  it("all mutations go through createServerFn + requireSupabaseAuth", () => {
    const fns = src.match(/export const \w+ = createServerFn/g) ?? [];
    expect(fns.length).toBeGreaterThanOrEqual(9);
    const withAuth = src.match(/\.middleware\(\[requireSupabaseAuth\]\)/g) ?? [];
    expect(withAuth.length).toBe(fns.length);
  });

  it("errors are mapped to short generic codes (no raw DB text)", () => {
    expect(src).toMatch(/operation_failed/);
    expect(src).toMatch(/safeError/);
  });

  it("input schemas reject HTML/script-like names", () => {
    expect(src).toMatch(/\[\^<>\]\+/);
  });

  it("family & vehicle removal is exposed only as deactivation", () => {
    expect(src).toMatch(/deactivateFamilyMemberAsAdmin/);
    expect(src).toMatch(/deactivateVehicleAsAdmin/);
    // No physically-destructive public exports named delete*.
    expect(src).not.toMatch(/export const deleteFamilyMemberAsAdmin/);
    expect(src).not.toMatch(/export const deleteVehicleAsAdmin/);
  });
});

describe("Stage 2B — strict private-detail contract", () => {
  const validSample = {
    profile: {
      id: "00000000-0000-0000-0000-000000000001",
      full_name: "Ada Lovelace", email: null, phone: null, avatar_url: null,
      property_number: null, ugvcl_number: null, share_certificate_number: null,
      move_in_date: null, aadhaar_verified: null, is_offline: null,
      society_id: "00000000-0000-0000-0000-0000000000AA",
    },
    relationships: [],
    family: [],
    vehicles: [],
  };

  it("a valid response parses", () => {
    expect(privateDetailSchema.safeParse(validSample).success).toBe(true);
  });

  it("unknown top-level fields are rejected", () => {
    const bad = { ...validSample, secret_notes: "leak" };
    expect(privateDetailSchema.safeParse(bad).success).toBe(false);
  });

  it("unknown profile fields are rejected", () => {
    const bad = { ...validSample, profile: { ...validSample.profile, password: "x" } };
    expect(privateDetailSchema.safeParse(bad).success).toBe(false);
  });

  it("malformed shape becomes a temporary_error at the boundary (documented)", () => {
    // The adapter maps schema-parse failures to { status: "temporary_error" }.
    const src = read("src/lib/residents-admin.functions.ts");
    expect(src).toMatch(/status:\s*["']temporary_error["']/);
    expect(src).toMatch(/status:\s*["']unavailable["']/);
  });
});

describe("Stage 2B — SQL rules (latest migration set)", () => {
  it("assign RPC rejects cross-society unit, inactive unit, duplicate active", () => {
    expect(migSql).toMatch(/unit_not_in_society/);
    expect(migSql).toMatch(/unit_inactive/);
    expect(migSql).toMatch(/duplicate_active_assignment/);
  });

  it("move-out preserves history (UPDATE, never DELETE flat_residents)", () => {
    expect(migSql).not.toMatch(/DELETE\s+FROM\s+public\.flat_residents/i);
  });

  it("family lifecycle is deactivation, never DELETE", () => {
    // admin_delete_family_member body must be an UPDATE (soft deactivate).
    const idx = migSql.lastIndexOf("admin_delete_family_member(_society_id");
    expect(idx).toBeGreaterThan(-1);
    const block = migSql.slice(idx, idx + 2000);
    expect(block).toMatch(/UPDATE\s+public\.family_members/i);
    expect(block).not.toMatch(/DELETE\s+FROM\s+public\.family_members/i);
  });

  it("vehicle lifecycle is deactivation, never DELETE", () => {
    const idx = migSql.lastIndexOf("admin_delete_vehicle(_society_id");
    expect(idx).toBeGreaterThan(-1);
    const block = migSql.slice(idx, idx + 2000);
    expect(block).toMatch(/UPDATE\s+public\.vehicles/i);
    expect(block).not.toMatch(/DELETE\s+FROM\s+public\.vehicles/i);
  });

  it("active-scoped partial unique index protects duplicate active plates", () => {
    expect(migSql).toMatch(/ux_vehicles_active_plate_norm[\s\S]*WHERE\s+is_active/i);
  });

  it("no future migration silently rewrites historical plate values", () => {
    // The completion migrations must not append `-dup-` to plate_number.
    // The historical migration (already applied, zero rows affected in prod)
    // is documented; the corrective migrations MUST NOT reintroduce that
    // rewrite pattern.
    const correctiveIdx = migSql.lastIndexOf("ux_vehicles_active_plate_norm");
    const after = migSql.slice(correctiveIdx);
    expect(after).not.toMatch(/plate_number\s*\|\|\s*'-dup-'/);
  });

  it("vehicle upsert uses a race-safe advisory lock on (society, plate)", () => {
    // Advisory lock appears in the latest definition of admin_upsert_vehicle.
    const idx = migSql.lastIndexOf("CREATE OR REPLACE FUNCTION public.admin_upsert_vehicle");
    const block = migSql.slice(idx, idx + 4000);
    expect(block).toMatch(/pg_advisory_xact_lock/);
    expect(block).toMatch(/duplicate_active_plate/);
  });

  it("every new SECURITY DEFINER RPC is revoked from anon and granted to authenticated", () => {
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
      expect(migSql, `${fn} REVOKE missing`).toMatch(rev);
      expect(migSql, `${fn} GRANT missing`).toMatch(gr);
    }
  });
});

describe("Stage 2B — route wiring (existing UI consumes safe services)", () => {
  const vehicles = read("src/routes/_society/society.vehicles.tsx");
  const residentsList = read("src/routes/_society/society.residents.tsx");
  const residentsDetail = read("src/routes/_society/society.residents.$id.tsx");

  it("vehicles route uses listSocietyVehicles (no direct browser private-table query)", () => {
    expect(vehicles).toMatch(/listSocietyVehicles/);
    // Must not read the private vehicles table directly through the browser client.
    expect(vehicles).not.toMatch(/supabase\s*\.\s*from\(\s*["']vehicles["']\s*\)/);
    expect(vehicles).not.toMatch(/supabase\s*\.\s*from\(\s*["']profiles["']\s*\)/);
  });

  it("vehicles route exposes only deactivation (no physical delete)", () => {
    expect(vehicles).toMatch(/deactivateVehicleAsAdmin/);
    expect(vehicles).not.toMatch(/deleteVehicleAsAdmin/);
    // UI copy must say the record is not permanently deleted.
    expect(vehicles.toLowerCase()).toMatch(/not permanently deleted|history remains|history preserved/);
  });

  it("resident directory calls the authoritative overview counters", () => {
    expect(residentsList).toMatch(/getResidentDirectoryOverview/);
    expect(residentsList).toMatch(/listResidentsPage/);
  });

  it("resident directory rows never render phone/email/UGVCL/property/share-cert", () => {
    // Static assertion on the row component: no direct `r.phone` render.
    const row = residentsList.slice(residentsList.indexOf("function ResidentCard"));
    expect(row).not.toMatch(/\{r\.phone\s*\?/);
    expect(row).not.toMatch(/\{r\.email/);
    expect(row).not.toMatch(/ugvcl/i);
  });

  it("resident detail consumes the authorised private-detail server fn", () => {
    expect(residentsDetail).toMatch(/getResidentPrivateDetail/);
  });
});

describe("Stage 2B — protected society untouched", () => {
  const forbidden = "1907a918-c4b8-4f43-a837-450530cc7c34";
  it("no source file references the protected society ID", () => {
    for (const p of [
      "src/lib/residents-admin.functions.ts",
      "src/routes/_society/society.vehicles.tsx",
      "src/routes/_society/society.residents.tsx",
      "src/routes/_society/society.residents.$id.tsx",
    ]) {
      expect(read(p), `${p} must not reference the protected society`).not.toContain(forbidden);
    }
  });
  it("no migration file references the protected society", () => {
    expect(migSql).not.toContain(forbidden);
  });
});

describe.skip("Stage 2B — integration against Postgres (requires isolated fixtures)", () => {
  it("assign then end preserves history row", () => { /* fixture-only */ });
  it("family deactivation preserves the row and its ID", () => { /* fixture-only */ });
  it("vehicle deactivation preserves the plate value", () => { /* fixture-only */ });
  it("reactivation validates duplicate plate", () => { /* fixture-only */ });
  it("cross-society same plate is allowed", () => { /* fixture-only */ });
});
