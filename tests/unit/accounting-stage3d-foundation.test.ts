import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const migrationsDir = join(process.cwd(), "supabase/migrations");
const chain = readdirSync(migrationsDir).filter(f => f.endsWith(".sql")).sort().map(f => readFileSync(join(migrationsDir, f), "utf8")).join("\n");
const route = (name: string) => readFileSync(join(process.cwd(), `src/routes/_society/${name}`), "utf8");

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
  });

  it("uses only the canonical server RPC boundary", () => {
    const adapter = readFileSync(join(process.cwd(), "src/lib/finance-stage3d.functions.ts"), "utf8");
    expect(adapter).toMatch(/requireSupabaseAuth/);
    expect(adapter).toMatch(/\.strict\(\)/);
    for (const rpc of ["get_finance_overview", "list_finance_book", "get_receivables_ageing", "create_finance_expense", "reverse_finance_expense"])
      expect(adapter).toContain(`"${rpc}"`);
  });
});
