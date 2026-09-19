import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const migrationsDir = join(process.cwd(), "supabase/migrations");
const chain = readdirSync(migrationsDir).filter(f => f.endsWith(".sql")).sort().map(f => readFileSync(join(migrationsDir, f), "utf8")).join("\n");
const route = (name: string) => readFileSync(join(process.cwd(), `src/routes/_society/${name}`), "utf8");
const finalClosure = readFileSync(join(process.cwd(), "drizzle/migrations/0008_finalize_stage3d_resident_authorization_and_audit_integrity.sql"), "utf8");
const auditLockdown = readFileSync(join(process.cwd(), "drizzle/migrations/0010_restore_universal_audit_log_immutability.sql"), "utf8");
const managedAuditLockdown = readFileSync(join(process.cwd(), "drizzle/migrations/0011_restore_universal_audit_log_immutability.sql"), "utf8");
const managedAuditAppendBoundary = readFileSync(join(process.cwd(), "drizzle/migrations/0012_restrict_audit_log_append_to_canonical_server_path.sql"), "utf8");

describe("Stage 3D canonical accounting foundation", () => {
  it("creates society-scoped accounts and immutable balanced journals", () => {
    expect(chain).toMatch(/CREATE TABLE public\.finance_accounts/);
    expect(chain).toMatch(/CREATE TABLE public\.finance_journal_entries/);
    expect(chain).toMatch(/CREATE TABLE public\.finance_journal_lines/);
    expect(chain).toMatch(/journal_unbalanced/);
    expect(chain).toMatch(/finance_journal_entries_immutable/);
  });

  it("posts source transitions idempotently and reverses by compensation", () => {
    expect(chain).toMatch(/CREATE TRIGGER payments_finance_posting/);
    expect(chain).toMatch(/CREATE TRIGGER income_finance_posting/);
    expect(chain).toMatch(/UNIQUE \(society_id, source_type, source_id\)/);
    expect(chain).toMatch(/reversal_of/);
    expect(chain).toMatch(/reverse_finance_expense/);
  });

  it("fails closed for unknown payment methods", () => {
    const correction = chain.slice(chain.lastIndexOf("CREATE OR REPLACE FUNCTION public._finance_payment_posting_trigger"));
    expect(correction).toMatch(/ELSE NULL/);
    expect(correction).toMatch(/unsupported_payment_method/);
    expect(correction).not.toMatch(/ELSE 'unsupported'/);
  });

  it("keeps internal journal and trigger helpers outside API roles", () => {
    for (const fn of ["_finance_post_entry", "_finance_payment_posting_trigger", "_finance_income_posting_trigger"])
      expect(chain).toMatch(new RegExp(`REVOKE ALL ON FUNCTION public\\.${fn}\\([^;]* FROM PUBLIC, anon, authenticated`, "i"));
  });

  it("removes direct financial CRUD and browser aggregation from migrated routes", () => {
    for (const file of ["society.accounts.tsx", "society.expenses.tsx", "society.ledger.tsx", "society.reports.tsx"]) {
      const source = route(file);
      expect(source).not.toMatch(/\.from\(["'](?:payments|bills|expenses|ledger_entries)["']\)/);
      expect(source).not.toMatch(/\.delete\(\)/);
    }
    for (const file of ["app.trust.tsx", "app.ledger.tsx"]) {
      const source = readFileSync(join(process.cwd(), `src/routes/_resident/${file}`), "utf8");
      expect(source).not.toMatch(/\.from\(["']ledger_entries["']\)/);
    }
  });

  it("uses only the canonical server RPC boundary", () => {
    const adapter = readFileSync(join(process.cwd(), "src/lib/finance-stage3d.functions.ts"), "utf8");
    expect(adapter).toMatch(/requireSupabaseAuth/);
    expect(adapter).toMatch(/\.strict\(\)/);
    for (const rpc of ["get_finance_overview", "get_resident_finance_transparency", "list_finance_book", "get_receivables_ageing", "create_finance_expense", "reverse_finance_expense"])
      expect(adapter).toContain(`"${rpc}"`);
  });

  it("serves resident transparency from a plan-gated, privacy-tiered journal projection", () => {
    const migration = readFileSync(join(migrationsDir, "20260918001600_secure_resident_finance_transparency.sql"), "utf8");
    expect(migration).toMatch(/resolve_financial_visibility\(_society_id\)/);
    expect(migration).toMatch(/_finance_plan_enabled\(_society_id\)/);
    expect(migration).toMatch(/finance_journal_entries/);
    expect(migration).not.toMatch(/ledger_entries/);
    expect(migration).toMatch(/v_visibility IN \('admin', 'detailed'\).*transactions\.rows/);
    expect(migration).toMatch(/REVOKE ALL ON FUNCTION public\.get_resident_finance_transparency[^;]+FROM PUBLIC, anon/i);
    const hardening = readFileSync(join(migrationsDir, "20260918004000_harden_finance_visibility_and_ageing_scope.sql"), "utf8");
    expect(hardening).toContain("fr.is_active = true");
    expect(hardening).toContain("f.society_id = _society_id");
    expect(hardening).toContain("p.society_id = b.society_id");
    expect(hardening).toContain("b.finalized_at::date");
    expect(finalClosure).toMatch(/sum\(credit - debit\) FILTER \(WHERE account_type = 'expense'\)/);
    expect(finalClosure).toMatch(/sum\(debit - credit\) FILTER \(WHERE account_type = 'expense'\)/);
    expect(finalClosure).toContain("fr.moved_out_at IS NULL");
    expect(finalClosure.indexOf("IF NOT v_is_admin AND NOT v_is_active_resident")).toBeLessThan(finalClosure.indexOf("_finance_plan_enabled(_society_id)"));
    expect(finalClosure).toContain("expense movement is negative, and reversals compensate the original movement");
  });

  it("ends with a strict society-admin helper that excludes block administrators", () => {
    const closure = readFileSync(join(process.cwd(), "drizzle/migrations/0006_close_stage3d_signs_and_admin_scope.sql"), "utf8");
    const definition = closure.slice(0, closure.indexOf("$$;", closure.indexOf("AS $$")) + 3);
    expect(definition).toContain("role = 'society_admin'::public.app_role");
    expect(definition).not.toContain("block_admin");
    expect(closure).toContain("Block administrators are intentionally excluded");
  });

  it("does not render finance hero failures as genuine zero values", () => {
    for (const file of ["society.accounts.tsx", "society.reports.tsx"]) {
      const source = route(file);
      expect(source).not.toMatch(/INR\.format\(o\?\.[a-z_]+\s*\?\?\s*0\)/);
      expect(source).toContain("Retry");
    }
  });

  it("removes block administrators from society-wide admin authorization", () => {
    const latest = chain.slice(chain.lastIndexOf("CREATE OR REPLACE FUNCTION public.is_society_admin_for"));
    const definition = latest.slice(0, latest.indexOf("$$;", latest.indexOf("AS $$")) + 3);
    expect(definition).toContain("role = 'society_admin'::public.app_role");
    expect(definition).not.toContain("block_admin");
    expect(definition).toContain("is_active");
  });

  it("validates journal sources and keeps posting helpers private", () => {
    const correction = readFileSync(join(migrationsDir, "20260917013000_harden_stage3d_accounting_and_admin_scope.sql"), "utf8");
    expect(correction).toMatch(/cross_society_finance_reference/);
    expect(correction).toMatch(/_source_type = 'payment'/);
    expect(correction).toMatch(/_source_type = 'income'/);
    expect(correction).toMatch(/_source_type = 'expense'/);
    expect(correction).toMatch(/REVOKE ALL ON FUNCTION public\._finance_post_entry\([^;]+FROM PUBLIC, anon, authenticated/i);
  });

  it("defines race-safe expense retry handling and explicit backfill execution", () => {
    const correction = readFileSync(join(migrationsDir, "20260917013000_harden_stage3d_accounting_and_admin_scope.sql"), "utf8");
    expect(correction).toMatch(/EXCEPTION WHEN unique_violation/);
    expect(correction).toMatch(/idempotency_conflict/);
    expect(correction).toMatch(/CREATE OR REPLACE FUNCTION public\.execute_finance_backfill/);
    expect(correction).toMatch(/pg_advisory_xact_lock/);
    expect(correction).toMatch(/finance\.backfill_executed/);
    expect(correction).not.toMatch(/ledger_entries[\s\S]*INSERT INTO public\.finance_journal_entries/i);
  });

  it("makes canonical audit history immutable", () => {
    expect(finalClosure).toMatch(/CREATE TRIGGER audit_log_immutable/);
    expect(finalClosure).toMatch(/BEFORE UPDATE OR DELETE ON public\.audit_log/);
    expect(finalClosure).toContain("audit_log_immutable");
    expect(finalClosure).toMatch(/REVOKE ALL ON FUNCTION public\._protect_audit_log_history\(\) FROM PUBLIC, anon, authenticated/);
    expect(auditLockdown).not.toContain("auth.role()");
    expect(auditLockdown).toMatch(/REVOKE UPDATE, DELETE ON TABLE public\.audit_log FROM PUBLIC, anon, authenticated, service_role/);
    expect(auditLockdown).toMatch(/GRANT SELECT, INSERT ON TABLE public\.audit_log TO service_role/);
    expect(auditLockdown).toContain("including requests made with service-role privileges");
    expect(managedAuditLockdown).not.toContain("auth.role()");
    expect(managedAuditLockdown).toMatch(/RAISE EXCEPTION 'audit_log_immutable'/);
    expect(managedAuditLockdown).toMatch(/REVOKE UPDATE, DELETE ON TABLE public\.audit_log FROM PUBLIC, anon, authenticated, service_role/);
    expect(managedAuditLockdown).toMatch(/GRANT SELECT, INSERT ON TABLE public\.audit_log TO service_role/);
    expect(managedAuditAppendBoundary).toMatch(/REVOKE INSERT ON TABLE public\.audit_log FROM PUBLIC, anon, authenticated/);
    expect(managedAuditAppendBoundary).toMatch(/GRANT SELECT, INSERT ON TABLE public\.audit_log TO service_role/);
  });
});
