/**
 * Stage 2C closure — SQL-level invariants for the final permission and
 * privacy hardening. These tests parse the actual committed migration bodies
 * for `current_user_has_society_permission`, `resolve_privacy_access`,
 * `list_society_team_members_v2`, `admin_upsert_team_role`,
 * `list_society_team_members`, `can_access_vehicle`, and the
 * `user_role_block_scopes` foreign keys. No database access.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const MIG = join(process.cwd(), "supabase", "migrations");

function readAllMigrations(): string {
  const files = readdirSync(MIG).sort();
  return files.map((f) => readFileSync(join(MIG, f), "utf8")).join("\n\n");
}

const ALL = readAllMigrations();

/** Return only the LAST body of a function definition (latest migration wins). */
function lastFunctionBody(fnHeaderPattern: RegExp): string {
  const matches: string[] = [];
  const re = new RegExp(
    `CREATE OR REPLACE FUNCTION ${fnHeaderPattern.source}[\\s\\S]*?\\$\\$;`,
    "g",
  );
  let m: RegExpExecArray | null;
  while ((m = re.exec(ALL)) !== null) matches.push(m[0]);
  if (matches.length === 0) throw new Error(`function not found: ${fnHeaderPattern}`);
  return matches[matches.length - 1];
}

describe("Stage 2C closure — three-arg permission helper", () => {
  const body = lastFunctionBody(
    /public\.current_user_has_society_permission\(\s*_society_id uuid,\s*_capability text,\s*_block_id uuid DEFAULT NULL/,
  );

  it("block_admin block-scoped capability with NULL _block_id returns false", () => {
    // The block_admin branch must contain `IF _block_id IS NULL THEN RETURN false; END IF;`
    // AFTER v_block_scoped is set.
    expect(body).toMatch(/v_block_scoped\s*:=\s*_capability IN \('directory\.view','residents\.view_block','blocks\.view'\)/);
    expect(body).toMatch(/IF _block_id IS NULL THEN RETURN false; END IF;/);
    // And must NOT contain the old "any scope" fallback.
    expect(body).not.toMatch(/IF _block_id IS NULL THEN\s*RETURN EXISTS/);
  });

  it("requested block must belong to _society_id and be active", () => {
    expect(body).toMatch(
      /FROM public\.blocks\s+WHERE id = _block_id AND society_id = _society_id AND COALESCE\(is_active,true\)/,
    );
  });

  it("caller must have an active exact-block scope", () => {
    expect(body).toMatch(/s\.is_active AND s\.block_id = _block_id/);
  });

  it("is_known_capability is enforced before role checks", () => {
    const idxKnown = body.indexOf("is_known_capability(_capability)");
    const idxSuper = body.indexOf("role = 'super_admin'");
    expect(idxKnown).toBeGreaterThan(0);
    expect(idxSuper).toBeGreaterThan(idxKnown);
  });
});

describe("Stage 2C closure — two-arg compatibility helper", () => {
  const body = lastFunctionBody(
    /public\.current_user_has_society_permission\(\s*_society_id uuid,\s*_capability text\s*\)/,
  );

  it("has its own body (does not directly SELECT the 3-arg with NULL for block-scoped caps)", () => {
    // It must special-case the block-scoped set explicitly.
    expect(body).toMatch(/_capability IN \('directory\.view','residents\.view_block','blocks\.view'\)/);
  });

  it("block_admin (and lower) return false for every block-scoped capability", () => {
    // Extract the block-scoped branch.
    const branch = body.split("IF _capability IN ('directory.view','residents.view_block','blocks.view')")[1] ?? "";
    // Society Admin allowed only directory.view/blocks.view.
    expect(branch).toMatch(/v_role = 'society_admin'/);
    // Non-super, non-society_admin fall through to RETURN false;
    expect(branch).toMatch(/RETURN false;\s*END IF;\s*RETURN public\.current_user_has_society_permission/);
  });
});

describe("Stage 2C closure — legacy team RPCs retired", () => {
  it("admin_upsert_team_role body raises deprecated_use_v2", () => {
    const body = lastFunctionBody(
      /public\.admin_upsert_team_role\(\s*_society_id uuid,\s*_target_user_id uuid,\s*_new_role public\.app_role,\s*_block_id uuid DEFAULT NULL/,
    );
    expect(body).toMatch(/RAISE EXCEPTION 'deprecated_use_v2'/);
    expect(body).not.toMatch(/INSERT INTO public\.user_roles/);
    expect(body).not.toMatch(/UPDATE public\.user_roles/);
  });

  it("list_society_team_members body raises deprecated_use_v2", () => {
    const body = lastFunctionBody(
      /public\.list_society_team_members\(\s*_society_id uuid,\s*_include_inactive boolean DEFAULT true\s*\)/,
    );
    expect(body).toMatch(/RAISE EXCEPTION 'deprecated_use_v2'/);
    expect(body).not.toMatch(/RETURN QUERY/);
  });

  it("REVOKEs execute from authenticated for both legacy signatures", () => {
    expect(ALL).toMatch(/REVOKE ALL ON FUNCTION public\.admin_upsert_team_role\(uuid, uuid, public\.app_role, uuid\)[^\n]*authenticated/);
    expect(ALL).toMatch(/REVOKE ALL ON FUNCTION public\.list_society_team_members\(uuid, boolean\)[^\n]*authenticated/);
  });
});

describe("Stage 2C closure — team directory email fallback removed", () => {
  const body = lastFunctionBody(
    /public\.list_society_team_members_v2\(\s*_society_id uuid,\s*_include_inactive boolean DEFAULT true\s*\)/,
  );

  it("uses a neutral label, not p.email, as the fallback", () => {
    expect(body).toMatch(/COALESCE\(NULLIF\(TRIM\(p\.full_name\), ''\), 'Unnamed team member'\)/);
    expect(body).not.toMatch(/COALESCE\(p\.full_name, p\.email/);
  });
});

describe("Stage 2C closure — resolve_privacy_access hardening", () => {
  const body = lastFunctionBody(
    /public\.resolve_privacy_access\(\s*_society_id uuid,\s*_resource text,\s*_subject_user_id uuid DEFAULT NULL/,
  );

  it("block_admin gets no unscoped directory decision", () => {
    expect(body).toMatch(/IF v_role = 'block_admin' THEN RETURN false; END IF;/);
    expect(body).not.toMatch(/IF v_role = 'block_admin' THEN RETURN _resource = 'directory'/);
  });

  it("household contact check is bound to flats.society_id = _society_id", () => {
    // Must join public.flats and constrain society.
    expect(body).toMatch(/JOIN public\.flats f ON f\.id = me\.flat_id/);
    expect(body).toMatch(/f\.society_id = _society_id/);
  });

  it("household check verifies subject membership in this society", () => {
    expect(body).toMatch(/user_id = _subject_user_id AND society_id = _society_id AND COALESCE\(is_active,true\)/);
  });

  it("vehicles and documents no longer accept caller-supplied subject as ownership proof", () => {
    // The old code path `_subject_user_id = v_uid` returning true is gone.
    const vehiclesBlock = body.split("IF _resource = 'contacts'")[1] ?? "";
    // After the contacts branch, no `RETURN _subject_user_id = v_uid;` remains.
    expect(vehiclesBlock).not.toMatch(/RETURN _subject_user_id = v_uid/);
  });
});

describe("Stage 2C closure — resource-derived vehicle access", () => {
  const body = lastFunctionBody(
    /public\.can_access_vehicle\(\s*_society_id uuid,\s*_vehicle_id uuid/,
  );

  it("derives society and owner from the vehicles row", () => {
    expect(body).toMatch(/SELECT user_id, society_id INTO v_owner, v_soc\s+FROM public\.vehicles WHERE id = _vehicle_id/);
  });

  it("returns false for cross-society vehicles (non-enumerating)", () => {
    expect(body).toMatch(/v_soc <> _society_id THEN RETURN false/);
  });

  it("denies block_admin and security regardless of privacy setting", () => {
    expect(body).toMatch(/v_role IN \('security','block_admin'\) THEN RETURN false/);
  });

  it("requires privacy_vehicles = 'owner_and_admins' before checking ownership", () => {
    expect(body).toMatch(/v_setting <> 'owner_and_admins' THEN RETURN false/);
    expect(body).toMatch(/RETURN v_owner = v_uid/);
  });
});

describe("Stage 2C closure — scope history preservation", () => {
  it("user_role_block_scopes role_id FK is ON DELETE RESTRICT (last written)", () => {
    // Find the last ADD CONSTRAINT block for role_id.
    const matches = [...ALL.matchAll(
      /ADD CONSTRAINT user_role_block_scopes_role_id_fkey\s+FOREIGN KEY \(role_id\)[^;]+;/g,
    )];
    expect(matches.length).toBeGreaterThan(0);
    expect(matches[matches.length - 1][0]).toMatch(/ON DELETE RESTRICT/);
  });

  it("user_role_block_scopes block_id FK is ON DELETE RESTRICT (last written)", () => {
    const matches = [...ALL.matchAll(
      /ADD CONSTRAINT user_role_block_scopes_block_id_fkey\s+FOREIGN KEY \(block_id\)[^;]+;/g,
    )];
    expect(matches.length).toBeGreaterThan(0);
    expect(matches[matches.length - 1][0]).toMatch(/ON DELETE RESTRICT/);
  });
});

describe("Stage 2C closure — client adapters", () => {
  const priv = readFileSync(join(process.cwd(), "src/lib/privacy-decisions.functions.ts"), "utf8");
  const team = readFileSync(join(process.cwd(), "src/lib/team-admin.functions.ts"), "utf8");

  it("privacy adapter exports canAccessVehicle bound to can_access_vehicle RPC", () => {
    expect(priv).toMatch(/export const canAccessVehicle = createServerFn/);
    expect(priv).toMatch(/rpc\(\s*"can_access_vehicle"/);
  });

  it("no Stage 2C adapter contains `as any`", () => {
    const strip = (s: string) => s
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
    for (const src of [strip(priv), strip(team)]) {
      expect(src).not.toMatch(/\bas\s+any\b/);
    }
  });

  it("app code does not call the legacy team RPCs", () => {
    expect(team).not.toMatch(/rpc\("list_society_team_members"[\s,)]/);
    expect(team).not.toMatch(/rpc\("admin_upsert_team_role"[\s,)]/);
  });
});
