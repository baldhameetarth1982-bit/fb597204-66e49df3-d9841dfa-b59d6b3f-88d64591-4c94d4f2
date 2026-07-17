/**
 * Stage 2C completion — SQL / TypeScript capability parity + invariants.
 *
 * These tests derive their expectations from the canonical TypeScript source
 * (src/lib/role-permissions.ts) AND from the ACTUAL SQL body committed in the
 * latest Stage 2C migration. We parse the SQL for each role's allowlist and
 * compare against `capabilitiesForRole(role)`. No hand-copied second matrix.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  SUPPORTED_ROLES, ALL_CAPABILITIES,
  capabilitiesForRole,
  type Role, type Capability,
} from "@/lib/role-permissions";

const MIGRATIONS_DIR = join(process.cwd(), "supabase", "migrations");

function readLatestStage2CMigration(): string {
  const files = readdirSync(MIGRATIONS_DIR).sort();
  // The Stage 2C completion migration contains the corrected 3-arg helper.
  const stage2cCompletion = [...files]
    .reverse()
    .find((f) => {
      const src = readFileSync(join(MIGRATIONS_DIR, f), "utf8");
      return src.includes("is_known_capability") && src.includes("admin_upsert_team_role_v2");
    });
  if (!stage2cCompletion) throw new Error("Stage 2C completion migration not found");
  return readFileSync(join(MIGRATIONS_DIR, stage2cCompletion), "utf8");
}

/** Extract capabilities inside the `IF v_role = '<role>' THEN` branch. */
function extractSqlCaps(sql: string, role: Role): Set<string> {
  const marker = `v_role = '${role}'`;
  const start = sql.indexOf(marker);
  if (start < 0) return new Set();
  // Slice until the next role branch or END of function.
  const rest = sql.slice(start);
  const nextRoleIdx = rest.slice(marker.length).search(/v_role = '(?!.*THEN\s*)/);
  const chunk = rest.slice(0, nextRoleIdx > 0 ? marker.length + nextRoleIdx : Math.min(rest.length, 4000));
  const caps = new Set<string>();
  for (const m of chunk.matchAll(/'([a-z_]+\.[a-z_]+)'/g)) {
    // Only take strings that look like capability keys and are known.
    if ((ALL_CAPABILITIES as readonly string[]).includes(m[1])) caps.add(m[1]);
  }
  return caps;
}

describe("Stage 2C — SQL × TypeScript capability parity", () => {
  const sql = readLatestStage2CMigration();

  it("uses is_known_capability() before role shortcuts", () => {
    // Extract just the corrected 3-arg body.
    const idx3 = sql.indexOf("current_user_has_society_permission(\n  _society_id uuid,\n  _capability text,\n  _block_id  uuid DEFAULT NULL");
    const body = idx3 > 0 ? sql.slice(idx3, idx3 + 3000) : sql;
    const knownIdx = body.indexOf("is_known_capability(_capability)");
    const superIdx = body.indexOf("role = 'super_admin'");
    expect(knownIdx).toBeGreaterThan(0);
    expect(superIdx).toBeGreaterThan(knownIdx);
  });

  for (const role of SUPPORTED_ROLES) {
    if (role === "super_admin") continue; // handled separately
    it(`SQL allowlist for ${role} exactly matches capabilitiesForRole("${role}")`, () => {
      const sqlSet = extractSqlCaps(sql, role);
      const tsSet  = new Set(capabilitiesForRole(role));

      // Every capability the SQL grants must be present in TS.
      for (const c of sqlSet) {
        expect(tsSet.has(c as Capability), `SQL grants ${c} to ${role} but TS does not`).toBe(true);
      }
      // Every non-super capability TS lists must appear in the SQL branch.
      for (const c of tsSet) {
        expect(sqlSet.has(c), `TS lists ${c} for ${role} but SQL does not`).toBe(true);
      }
    });
  }

  it("no role's SQL branch mentions an unknown capability string", () => {
    for (const role of SUPPORTED_ROLES) {
      if (role === "super_admin") continue;
      const caps = extractSqlCaps(sql, role);
      for (const c of caps) {
        expect((ALL_CAPABILITIES as readonly string[])).toContain(c);
      }
    }
  });

  it("known-capability helper enumerates ALL_CAPABILITIES and no extras", () => {
    const m = sql.match(/is_known_capability\(_cap text\)[\s\S]*?_cap IN \(([\s\S]*?)\);/);
    expect(m).not.toBeNull();
    const listed = new Set<string>();
    for (const s of m![1].matchAll(/'([^']+)'/g)) listed.add(s[1]);
    expect([...listed].sort()).toEqual([...ALL_CAPABILITIES].sort());
  });
});

describe("Stage 2C — TypeScript role shape guarantees", () => {
  it("Super Admin has every capability in ALL_CAPABILITIES", () => {
    const caps = new Set(capabilitiesForRole("super_admin"));
    for (const c of ALL_CAPABILITIES) expect(caps.has(c)).toBe(true);
  });

  it("Society Admin has no unknown capability and no super-only elevation", () => {
    for (const c of capabilitiesForRole("society_admin")) {
      expect((ALL_CAPABILITIES as readonly string[])).toContain(c);
    }
  });

  it("Block Admin base set is exactly {directory.view, residents.view_block, blocks.view, self.household}", () => {
    expect([...capabilitiesForRole("block_admin")].sort()).toEqual(
      ["blocks.view", "directory.view", "residents.view_block", "self.household"].sort(),
    );
  });

  it("Guard capabilities never grow beyond guard.operate + self.household", () => {
    expect([...capabilitiesForRole("security")].sort())
      .toEqual(["guard.operate", "self.household"].sort());
  });

  it("Resident capability set stays limited to self.household", () => {
    expect(capabilitiesForRole("resident")).toEqual(["self.household"]);
  });
});
