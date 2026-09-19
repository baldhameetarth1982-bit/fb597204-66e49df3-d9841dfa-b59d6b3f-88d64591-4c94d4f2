import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const migrationDirectory = join(process.cwd(), "supabase/migrations");
const migrationFiles = readdirSync(migrationDirectory)
  .filter((file) => file.endsWith(".sql"))
  .sort();
const migrations = migrationFiles.map((file) => ({
  file,
  sql: readFileSync(join(migrationDirectory, file), "utf8"),
}));
const migrationChain = migrations.map(({ sql }) => sql).join("\n");

const repairedFunctions = [
  "configure_society_structure_mode",
  "assign_resident_to_unit",
  "end_resident_unit_relationship",
  "admin_upsert_family_member",
  "admin_delete_family_member",
  "admin_upsert_vehicle",
  "admin_delete_vehicle",
  "submit_offline_payment",
  "verify_offline_payment",
  "reject_offline_payment",
  "reverse_offline_payment",
] as const;

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function functionDefinitions(sql: string, functionName: string) {
  const escapedName = escapeRegExp(functionName);
  const pattern = new RegExp(
    `CREATE\\s+OR\\s+REPLACE\\s+FUNCTION\\s+public\\.${escapedName}\\s*\\([\\s\\S]*?\\bAS\\s+(\\$[A-Za-z_]*\\$)[\\s\\S]*?\\1\\s*;`,
    "gi",
  );
  return [...sql.matchAll(pattern)].map((match) => match[0]);
}

function latestFunctionDefinition(functionName: string) {
  const definitions = functionDefinitions(migrationChain, functionName);
  return definitions.at(-1) ?? "";
}

function auditColumnLists(sql: string) {
  return [...sql.matchAll(/INSERT\s+INTO\s+(?:public\.)?audit_log\s*\(([^)]*)\)/gi)]
    .map((match) => match[1]?.split(",").map((column) => column.trim().toLowerCase()) ?? []);
}

describe("audit-log contract recovery", () => {
  it("keeps every effective repaired function on the canonical audit columns", () => {
    for (const functionName of repairedFunctions) {
      const definition = latestFunctionDefinition(functionName);
      expect(definition, functionName).not.toBe("");

      const columnLists = auditColumnLists(definition);
      expect(columnLists.length, functionName).toBeGreaterThan(0);
      for (const columns of columnLists) {
        expect(columns, functionName).toContain("target_table");
        expect(columns, functionName).toContain("target_id");
        expect(columns, functionName).toContain("metadata");
        expect(columns, functionName).not.toContain("entity_type");
        expect(columns, functionName).not.toContain("entity_id");
        expect(columns, functionName).not.toContain("meta");
      }
    }
  });

  it("fails the corrective migration when an installed noncanonical writer remains", () => {
    const repair = migrations.find(({ file }) => file.startsWith("20260916225548_"))?.sql ?? "";
    expect(repair).toMatch(/pg_get_functiondef\(p\.oid\)/);
    expect(repair).toMatch(/noncanonical audit_log writer remains/);
    expect(repair).toMatch(/entity_type\|entity_id\|meta/);
  });

  it("has an additive terminal migration that rejects audit updates and deletes", () => {
    const terminal = readFileSync(
      join(process.cwd(), "drizzle/migrations/0008_finalize_stage3d_resident_authorization_and_audit_integrity.sql"),
      "utf8",
    );
    expect(terminal).toMatch(/CREATE TRIGGER audit_log_immutable/);
    expect(terminal).toMatch(/BEFORE UPDATE OR DELETE ON public\.audit_log/);
    expect(terminal).toMatch(/RAISE EXCEPTION 'audit_log_immutable'/);
    const finalLockdown = readFileSync(
      join(process.cwd(), "drizzle/migrations/0010_restore_universal_audit_log_immutability.sql"),
      "utf8",
    );
    expect(finalLockdown).not.toContain("auth.role()");
    expect(finalLockdown).toMatch(/REVOKE ALL ON FUNCTION public\._protect_audit_log_history\(\) FROM PUBLIC, anon, authenticated, service_role/);
    expect(finalLockdown).toMatch(/REVOKE UPDATE, DELETE ON TABLE public\.audit_log FROM PUBLIC, anon, authenticated, service_role/);
    expect(finalLockdown).toMatch(/GRANT SELECT, INSERT ON TABLE public\.audit_log TO service_role/);
  });
});

describe("submit_offline_payment recovery", () => {
  const definition = latestFunctionDefinition("submit_offline_payment");

  it("requires an active, non-moved-out occupancy for the bill's flat", () => {
    expect(definition).toMatch(/flat_id\s*=\s*b\.flat_id/);
    expect(definition).toMatch(/user_id\s*=\s*uid/);
    expect(definition).toMatch(/is_active\s*=\s*true/);
    expect(definition).toMatch(/moved_out_at\s+IS\s+NULL/);
  });

  it("preserves server-authoritative actor, method, status, and bill-derived scope", () => {
    expect(definition).toMatch(/IF _actor_role = 'resident'/);
    expect(definition).toMatch(/IF _method <> 'bank_transfer'/);
    expect(definition).toMatch(/resident_cash_not_allowed/);
    expect(definition).toMatch(/VALUES \(b\.id, b\.society_id, b\.flat_id, uid, _amount, _method, 'pending'/);
    expect(definition).not.toMatch(/\b_status\b/);
  });

  it("preserves locking, authorization, idempotency, and amount checks", () => {
    expect(definition).toMatch(/auth\.uid\(\)/);
    expect(definition).toMatch(/WHERE id = _bill_id FOR UPDATE/);
    expect(definition).toMatch(/current_user_has_society_permission\(b\.society_id, 'billing\.manage'/);
    expect(definition).toMatch(/idempotency_conflict/);
    expect(definition).toMatch(/duplicate_reference/);
    expect(definition).toMatch(/amount_exceeds_outstanding/);
  });
});

describe("effective direct-payment mutation boundary", () => {
  it("neutralizes the later guarded legacy payment policy and grants", () => {
    const legacyIndex = migrationChain.lastIndexOf('CREATE POLICY "residents create their own payments"');
    const dropIndex = migrationChain.lastIndexOf('DROP POLICY IF EXISTS "residents create their own payments"');
    const grantIndex = migrationChain.lastIndexOf("GRANT SELECT, INSERT, UPDATE, DELETE ON public.payments TO authenticated");
    const revokeIndex = migrationChain.lastIndexOf("REVOKE INSERT, UPDATE, DELETE ON public.payments FROM authenticated");
    const unsafeDefaultIndex = migrationChain.lastIndexOf("status text NOT NULL DEFAULT 'success'");
    const safeDefaultIndex = migrationChain.lastIndexOf("ALTER COLUMN status SET DEFAULT 'pending'");

    expect(legacyIndex).toBeGreaterThanOrEqual(0);
    expect(dropIndex).toBeGreaterThan(legacyIndex);
    expect(revokeIndex).toBeGreaterThan(grantIndex);
    expect(safeDefaultIndex).toBeGreaterThan(unsafeDefaultIndex);
  });

  it("contains a fail-closed installed-policy and privilege check", () => {
    const recovery = migrations.find(({ file }) => file.startsWith("20260916230714_"))?.sql ?? "";
    expect(recovery).toMatch(/authenticated payment INSERT policy remains/);
    expect(recovery).toMatch(/has_table_privilege\('authenticated', 'public\.payments', 'INSERT'\)/);
    expect(recovery).toMatch(/authenticated direct payment mutation privilege remains/);
  });
});