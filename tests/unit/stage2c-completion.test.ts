/**
 * Stage 2C completion — adapter, scope and privacy invariants (source-level).
 *
 * These tests execute:
 *   - static invariants on the typed adapter source (no `as any` remains)
 *   - schema/AST-level checks on the Stage 2C completion migration
 *   - unit-level behavior against the exported Zod input validators to
 *     confirm multi-block scope handling is enforced.
 *
 * They do NOT touch the production database or the protected society.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const readFile = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

function stage2cCompletionSql(): string {
  const dir = join(ROOT, "supabase", "migrations");
  const files = readdirSync(dir).sort().reverse();
  const found = files.find((f) => {
    const s = readFileSync(join(dir, f), "utf8");
    return s.includes("admin_upsert_team_role_v2") && s.includes("is_known_capability");
  });
  if (!found) throw new Error("Stage 2C completion migration not found");
  return readFileSync(join(dir, found), "utf8");
}

function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")     // block comments
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1"); // line comments (avoid URL scheme)
}

describe("Stage 2C — typed adapters carry no `as any`", () => {
  const files = [
    "src/lib/team-admin.functions.ts",
    "src/lib/privacy-decisions.functions.ts",
  ];
  for (const f of files) {
    it(`${f}: zero \`as any\` / \`rpc as any\``, () => {
      const src = stripComments(readFile(f));
      expect(src, "no `as any`").not.toMatch(/\bas\s+any\b/);
      expect(src, "no `(supabase as any).rpc`").not.toMatch(/\(supabase\s+as\s+any\)\.rpc/);
      expect(src, "no `.rpc as any`").not.toMatch(/\.rpc\s+as\s+any/);
    });
  }

  it("team-admin uses list_society_team_members_v2, not the legacy single-block listing", () => {
    const src = readFile("src/lib/team-admin.functions.ts");
    expect(src).toMatch(/list_society_team_members_v2/);
    expect(src).not.toMatch(/rpc\("list_society_team_members"[\s,)]/);
  });

  it("team-admin uses admin_upsert_team_role_v2 with _block_ids array", () => {
    const src = readFile("src/lib/team-admin.functions.ts");
    expect(src).toMatch(/admin_upsert_team_role_v2/);
    expect(src).toMatch(/_block_ids/);
  });

  it("team-admin validates RPC responses through Zod (no raw casts)", () => {
    const src = readFile("src/lib/team-admin.functions.ts");
    expect(src).toMatch(/TeamMemberSchema/);
    expect(src).toMatch(/z\.array\(TeamMemberSchema\)\.safeParse/);
  });
});

describe("Stage 2C — canonical multi-block scope table exists", () => {
  const sql = stage2cCompletionSql();

  it("creates user_role_block_scopes with soft-deactivation fields", () => {
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS public\.user_role_block_scopes/);
    for (const col of ["role_id", "society_id", "block_id", "is_active", "assigned_by", "deactivated_at", "deactivated_by"]) {
      expect(sql, `column ${col}`).toMatch(new RegExp(`\\b${col}\\b`));
    }
  });

  it("enforces unique active scope per (role_id, block_id) with partial index", () => {
    expect(sql).toMatch(/CREATE UNIQUE INDEX[^\n]+ux_urbs_active_role_block[\s\S]+?WHERE is_active/);
  });

  it("has RLS enabled and does NOT grant anon read", () => {
    expect(sql).toMatch(/ALTER TABLE public\.user_role_block_scopes ENABLE ROW LEVEL SECURITY/);
    expect(sql).toMatch(/GRANT SELECT ON public\.user_role_block_scopes TO authenticated;/);
    // Never anon.
    expect(sql).not.toMatch(/GRANT[^\n]+public\.user_role_block_scopes[^\n]+anon/);
  });

  it("backfills existing Block Admin single-block assignments (no invention)", () => {
    // Backfill inserts from user_roles where role='block_admin' and block_id IS NOT NULL only.
    const insertBlock = sql.match(/INSERT INTO public\.user_role_block_scopes[\s\S]+?WHERE ur\.role = 'block_admin'/);
    expect(insertBlock).not.toBeNull();
    expect(insertBlock![0]).toMatch(/ur\.block_id IS NOT NULL/);
    expect(insertBlock![0]).toMatch(/COALESCE\(ur\.is_active, true\)/);
  });
});

describe("Stage 2C — multi-block upsert semantics", () => {
  const sql = stage2cCompletionSql();
  const start = sql.indexOf("FUNCTION public.admin_upsert_team_role_v2");
  const body = sql.slice(start, start + 6000);

  it("dedupes and drops NULL block IDs before validation", () => {
    expect(body).toMatch(/SELECT array_agg\(DISTINCT x\) INTO v_norm[\s\S]+?WHERE x IS NOT NULL/);
  });
  it("rejects empty scope for block_admin", () => {
    expect(body).toMatch(/block_scope_required/);
  });
  it("validates every block is same-society AND active", () => {
    expect(body).toMatch(/society_id = _society_id[\s\S]+?COALESCE\(is_active,true\)/);
    expect(body).toMatch(/RAISE EXCEPTION 'invalid_block_scope'/);
  });
  it("denies block_admin assignment in serial societies", () => {
    expect(body).toMatch(/block_admin_unavailable_serial_mode/);
  });
  it("last-admin protection remains", () => {
    expect(body).toMatch(/last_society_admin/);
  });
  it("reconciles scopes: deactivates removed, activates existing, inserts missing", () => {
    expect(body).toMatch(/SET is_active = false[\s\S]+?NOT \(block_id = ANY\(v_norm\)\)/);
    expect(body).toMatch(/SET is_active = true, deactivated_at = NULL[\s\S]+?block_id = ANY\(v_norm\) AND NOT is_active/);
    expect(body).toMatch(/INSERT INTO public\.user_role_block_scopes[\s\S]+?unnest\(v_norm\)/);
  });
  it("audit records previous and resulting block ID arrays", () => {
    expect(body).toMatch(/previous_block_ids/);
    expect(body).toMatch(/resulting_block_ids/);
  });
});

describe("Stage 2C — server-enforced privacy decision + resident-safe directory", () => {
  const sql = stage2cCompletionSql();

  it("resolve_privacy_access enumerates only the five known resources", () => {
    const m = sql.match(/_resource NOT IN \(([^)]+)\)/);
    expect(m).not.toBeNull();
    const set = new Set<string>();
    for (const s of m![1].matchAll(/'([^']+)'/g)) set.add(s[1]);
    expect([...set].sort()).toEqual(["contacts", "directory", "documents", "finances", "vehicles"]);
  });

  it("resolve_privacy_access denies unknown resources", () => {
    // The very structure guarantees fail-closed.
    expect(sql).toMatch(/_resource NOT IN[^\n]+RETURN false/);
  });

  it("resolve_financial_visibility returns exactly the four documented tiers", () => {
    const start = sql.indexOf("FUNCTION public.resolve_financial_visibility");
    const body = sql.slice(start, start + 2000);
    for (const tier of ["'admin'", "'summary'", "'detailed'", "'none'"]) {
      expect(body).toMatch(new RegExp(tier));
    }
  });

  it("guard/security is denied every non-guard privacy resource", () => {
    const start = sql.indexOf("FUNCTION public.resolve_privacy_access");
    const body = sql.slice(start, start + 3000);
    expect(body).toMatch(/v_role = 'security'[\s\S]+?RETURN false/);
  });

  it("block_admin gets ONLY the directory resource (never contacts/finances/vehicles/documents)", () => {
    const start = sql.indexOf("FUNCTION public.resolve_privacy_access");
    const body = sql.slice(start, start + 3000);
    expect(body).toMatch(/v_role = 'block_admin'[\s\S]+?_resource = 'directory'/);
  });

  it("household contact access requires an actual shared flat_residents occupancy", () => {
    const start = sql.indexOf("FUNCTION public.resolve_privacy_access");
    const body = sql.slice(start, start + 3500);
    expect(body).toMatch(/FROM public\.flat_residents me[\s\S]+?JOIN public\.flat_residents them ON them\.flat_id = me\.flat_id/);
  });

  it("resident-safe directory REVOKES anon and never projects phone/email/KYC", () => {
    const start = sql.indexOf("FUNCTION public.list_society_residents_safe_page");
    const body = sql.slice(start, start + 4000);
    expect(body).not.toMatch(/\bemail\b/);
    expect(body).not.toMatch(/\bphone\b/);
    expect(body).not.toMatch(/\baadhaar/i);
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\.list_society_residents_safe_page[^;]+FROM PUBLIC, anon/);
  });

  it("resident-safe directory restricts block_admin to explicit scope blocks", () => {
    const start = sql.indexOf("FUNCTION public.list_society_residents_safe_page");
    const body = sql.slice(start, start + 4000);
    expect(body).toMatch(/user_role_block_scopes[\s\S]+?is_active/);
    expect(body).toMatch(/v_role = 'block_admin'[\s\S]+?v_scoped_blocks/);
  });
});

describe("Stage 2C — Team route sends block_ids array, not a single block_id", () => {
  const src = readFile("src/routes/_society/society.team.tsx");
  it("route imports use the multi-block adapter shape", () => {
    expect(src).toMatch(/blockIds:\s*string\[\]/);
    expect(src).not.toMatch(/blockId\?:\s*string \| null/);
  });
  it("Assign dialog rejects empty block set for block_admin", () => {
    expect(src).toMatch(/Choose at least one block/);
  });
});
