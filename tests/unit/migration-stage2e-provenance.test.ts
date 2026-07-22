/**
 * Stage 2E — Provenance conflict enforcement contract tests.
 *
 * Runtime PostgreSQL integration for commit_migration_job is deferred to
 * Stage 13's DB test harness. These are SQL contract tests that read the
 * final applied migration and prove:
 *
 *  1. No `ON CONFLICT DO NOTHING` remains inside commit_migration_job's
 *     provenance writes.
 *  2. Every migration_entity_links write inside commit_migration_job goes
 *     through _migration_link_or_conflict.
 *  3. The helper's body encodes the exact same-key/same-ID vs. different-ID
 *     rule with a MG001-rollback path.
 *  4. Family/vehicle links use family_members.id and vehicles.id, not the
 *     resident id (real canonical provenance).
 *  5. Resident lookup for family and vehicle is source_type-scoped.
 *  6. The protected society ID does not appear anywhere in the migration.
 *
 * Any regression on these invariants breaks silently at runtime; the file
 * check is the guardrail until the DB integration harness lands.
 */
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const MIG_DIR = join(process.cwd(), "supabase/migrations");
const PROTECTED_SOCIETY_ID = (process.env.SOCIOHUB_PROTECTED_SOCIETY_ID ?? "").trim();

function latestMigrationContaining(needle: string): string {
  const files = readdirSync(MIG_DIR).filter((f) => f.endsWith(".sql")).sort();
  for (let i = files.length - 1; i >= 0; i--) {
    const src = readFileSync(join(MIG_DIR, files[i]), "utf8");
    if (src.includes(needle)) return src;
  }
  throw new Error(`No migration contains "${needle}"`);
}

// Extract the body of CREATE OR REPLACE FUNCTION public.<name>(...) ... $$ ... $$
function extractFunctionBody(sql: string, name: string): string {
  const re = new RegExp(
    `CREATE OR REPLACE FUNCTION public\\.${name}[\\s\\S]*?AS \\$\\$([\\s\\S]*?)\\$\\$;`,
  );
  const m = sql.match(re);
  if (!m) throw new Error(`Could not extract ${name} body`);
  return m[1];
}

describe("Stage 2E — commit_migration_job provenance correctness", () => {
  const sql = latestMigrationContaining("CREATE OR REPLACE FUNCTION public.commit_migration_job");
  const body = extractFunctionBody(sql, "commit_migration_job");

  it("removes ON CONFLICT DO NOTHING from provenance writes inside commit_migration_job", () => {
    // The only remaining pattern in the effective function body must be
    // through _migration_link_or_conflict — no ON CONFLICT DO NOTHING at all
    // within the commit body.
    expect(body).not.toMatch(/ON\s+CONFLICT\s+DO\s+NOTHING/i);
  });

  it("routes every entity-links write through the explicit helper", () => {
    // Structure, unit, resident, family, vehicle — each calls the helper.
    const calls = body.match(/_migration_link_or_conflict\s*\(/g) ?? [];
    expect(calls.length).toBeGreaterThanOrEqual(5);
    for (const type of ["'structure'", "'unit'", "'resident'", "'family'", "'vehicle'"]) {
      expect(body).toContain(type);
    }
  });

  it("family provenance uses family_members.id (not resident id)", () => {
    // Family branch writes _family_id after RETURNING id INTO _family_id,
    // then hands _family_id to the helper — never _resident_id.
    const familyBlock = body.slice(body.indexOf("----- Family"), body.indexOf("----- Vehicles"));
    expect(familyBlock).toMatch(/RETURNING id INTO _family_id/);
    expect(familyBlock).toMatch(
      /_migration_link_or_conflict\([\s\S]*'family'[\s\S]*_family_id\)/,
    );
  });

  it("vehicle provenance uses vehicles.id (not resident id)", () => {
    const vehBlock = body.slice(body.indexOf("----- Vehicles"), body.indexOf("----- Completion"));
    expect(vehBlock).toMatch(/RETURNING id INTO _vehicle_id/);
    expect(vehBlock).toMatch(
      /_migration_link_or_conflict\([\s\S]*'vehicle'[\s\S]*_vehicle_id\)/,
    );
  });

  it("resident lookup for family/vehicle is scoped by source_type", () => {
    const familyBlock = body.slice(body.indexOf("----- Family"), body.indexOf("----- Vehicles"));
    const vehBlock = body.slice(body.indexOf("----- Vehicles"), body.indexOf("----- Completion"));
    for (const block of [familyBlock, vehBlock]) {
      expect(block).toMatch(/l\.source_type\s*=\s*_job\.source_type/);
      expect(block).toMatch(/l\.entity_type\s*=\s*'resident'/);
    }
  });

  it("pre-commit dedup exists for structure/unit/resident/family/vehicle", () => {
    // Each create branch reuses an existing canonical when a link already
    // points to a still-present record — protects re-imports from creating
    // duplicate canonical rows.
    const reuseHits = body.match(/_reuse_id\s*:=/g) ?? [];
    expect(reuseHits.length).toBeGreaterThanOrEqual(5);
  });
});

describe("Stage 2E — _migration_link_or_conflict helper contract", () => {
  const sql = latestMigrationContaining("CREATE OR REPLACE FUNCTION public._migration_link_or_conflict");
  const body = extractFunctionBody(sql, "_migration_link_or_conflict");

  it("encodes: no existing link → INSERT (same-key/same-ID replay is safe)", () => {
    expect(body).toMatch(/IF _existing IS NULL THEN[\s\S]*INSERT INTO public\.migration_entity_links/);
  });

  it("same-key + same canonical id → no-op RETURN (safe idempotent replay)", () => {
    expect(body).toMatch(/ELSIF _existing = _canonical_entity_id THEN[\s\S]*RETURN;/);
  });

  it("same-key + DIFFERENT canonical id → provenance_mismatch with MG001 rollback", () => {
    expect(body).toMatch(/ELSE[\s\S]*RAISE EXCEPTION 'provenance_mismatch'[\s\S]*ERRCODE\s*=\s*'MG001'/);
  });

  it("is SECURITY DEFINER with a fixed search_path and revoked from PUBLIC/anon/authenticated", () => {
    expect(sql).toMatch(/SECURITY DEFINER SET search_path = public/);
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\._migration_link_or_conflict[\s\S]*FROM PUBLIC/);
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\._migration_link_or_conflict[\s\S]*FROM anon/);
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\._migration_link_or_conflict[\s\S]*FROM authenticated/);
    // Only service_role can invoke it — never exposed as a browser RPC.
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION public\._migration_link_or_conflict[\s\S]*TO service_role/);
  });
});

describe("Stage 2E — protected society is not present in the migration", () => {
  const sql = latestMigrationContaining("CREATE OR REPLACE FUNCTION public.commit_migration_job");
  it.skipIf(!PROTECTED_SOCIETY_ID)("no runtime reference to the protected society uuid", () => {
    expect(sql).not.toContain(PROTECTED_SOCIETY_ID);
  });
});
