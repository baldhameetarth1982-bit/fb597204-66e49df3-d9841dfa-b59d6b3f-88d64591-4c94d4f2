import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");
const read = (path: string) => readFileSync(resolve(root, path), "utf8");

describe("Stage 11 security and payment boundaries", () => {
  it("keeps guards on masked, audited visitor and vehicle RPCs", () => {
    const migration = read("drizzle/migrations/0056_stage11_guard_and_lockout_boundary.sql");
    expect(migration).toContain('DROP POLICY IF EXISTS "guards & admins manage visitors in their society"');
    expect(migration).toContain('CREATE POLICY "admins manage visitors in their society"');
    expect(migration).toContain('DROP POLICY IF EXISTS "guards & admins view society vehicles"');
    expect(migration).toContain('CREATE POLICY "admins view society vehicles"');
    expect(migration).not.toMatch(/role IN \([^)]*'security'/);
  });

  it("requires an audited reason for final payout transitions", () => {
    const migration = read("drizzle/migrations/0057_stage11_reasoned_withdrawal_transition.sql");
    expect(migration).toContain("public.admin_transition_withdrawal");
    expect(migration).toContain("char_length(transition_reason) < 5");
    expect(migration).toContain("'reason', left(transition_reason, 300)");
    expect(migration).toContain("WHERE id = _withdrawal_id AND status = 'pending'");
  });

  it("keeps maintenance fee claims out of subscription checkout", () => {
    const checkout = read("src/routes/checkout.$planId.tsx");
    expect(checkout).toContain("Maintenance payments remain Cash or Bank Transfer with no platform fee");
    expect(checkout).not.toContain("transaction fee on maintenance");
    expect(checkout).not.toContain("txn_fee_pct");
  });

  it("requires reasons in both plan and payout actions", () => {
    const society = read("src/routes/_admin/admin.societies.$id.tsx");
    const withdrawals = read("src/routes/_admin/admin.withdrawals.tsx");
    expect(society).toContain("_reason: reason.trim()");
    expect(withdrawals).toContain('supabase.rpc("admin_transition_withdrawal"');
    expect(withdrawals).toContain("_reason: reason.trim()");
  });
});