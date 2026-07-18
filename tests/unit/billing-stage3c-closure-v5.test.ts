/**
 * Stage 3C v5 — Final closure behavioral guards.
 *
 * These tests lock the closure contract: no generic public submission API,
 * admin bill-search + record path wired, Zod-validated payment detail,
 * and the search RPC gated by manage_billing.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

const fnSrc = readFileSync("src/lib/offline-payments.functions.ts", "utf8");
const adminRoute = readFileSync(
  "src/routes/_society/society.payments.tsx",
  "utf8",
);
const submitCard = readFileSync(
  "src/components/billing/OfflinePaymentSubmitCard.tsx",
  "utf8",
);

function allMigrations(): string {
  const dir = "supabase/migrations";
  return readdirSync(dir)
    .sort()
    .map((f) => readFileSync(path.join(dir, f), "utf8"))
    .join("\n\n");
}

describe("Stage 3C v5 — generic submission API is removed", () => {
  it("no submitOfflinePayment export exists", () => {
    expect(fnSrc).not.toMatch(/export const submitOfflinePayment\b/);
  });
  it("no actorRole is accepted or forwarded to the RPC", () => {
    expect(fnSrc).not.toMatch(/actorRole:\s*z\.enum/);
    expect(fnSrc).not.toMatch(/_actor_role:\s*data\.actorRole/);
  });
  it("split resident/admin contracts still exist and fix _actor_role server-side", () => {
    expect(fnSrc).toMatch(/export const submitResidentBankTransfer\b/);
    expect(fnSrc).toMatch(/export const recordAdminOfflinePayment\b/);
    expect(fnSrc).toMatch(/_actor_role: "resident"/);
    expect(fnSrc).toMatch(/_actor_role: "admin"/);
    expect(fnSrc).toMatch(/_method: "bank_transfer"/); // resident fixed method
  });
});

describe("Stage 3C v5 — admin route wires bill search + record", () => {
  it("imports searchOpenBillsForPayment and recordAdminOfflinePayment", () => {
    expect(adminRoute).toMatch(/searchOpenBillsForPayment/);
    expect(adminRoute).toMatch(/recordAdminOfflinePayment/);
  });
  it("uses useServerFn wrappers for both", () => {
    expect(adminRoute).toMatch(/useServerFn\(searchOpenBillsForPayment\)/);
    expect(adminRoute).toMatch(/useServerFn\(recordAdminOfflinePayment\)/);
  });
  it("does not read the payments table via the browser Supabase client", () => {
    expect(adminRoute).not.toMatch(/supabase\.from\(['"]payments['"]\)/);
  });
});

describe("Stage 3C v5 — getPaymentDetail is Zod-validated", () => {
  it("defines a paymentDetailSchema and parses the RPC response", () => {
    expect(fnSrc).toMatch(/paymentDetailSchema\s*=\s*z\.discriminatedUnion/);
    expect(fnSrc).toMatch(/paymentDetailSchema\.parse\(raw\)/);
  });
  it("returns a typed PaymentDetail (no bare `as any` cast)", () => {
    const block =
      fnSrc.match(/export const getPaymentDetail[\s\S]{0,1200}/)?.[0] ?? "";
    expect(block).not.toMatch(/as\s+any\b/);
    // v6: typed via explicit `const detail: PaymentDetail = { ... }` rather
    // than `... satisfies PaymentDetail` — either form is a real type check.
    expect(block).toMatch(/const detail:\s*PaymentDetail\s*=/);
  });
});


describe("Stage 3C v5 — searchOpenBillsForPayment is safe", () => {
  it("server function requires auth and calls the RPC", () => {
    const block =
      fnSrc.match(/export const searchOpenBillsForPayment[\s\S]{0,1600}/)?.[0] ??
      "";
    expect(block).toMatch(/requireSupabaseAuth/);
    expect(block).toMatch(/"search_society_open_bills"/);
  });

  it("migration creates the RPC with SECURITY DEFINER and manage_billing gate", () => {
    const sql = allMigrations();
    expect(sql).toMatch(
      /CREATE OR REPLACE FUNCTION public\.search_society_open_bills/,
    );
    const fnBlock =
      sql.match(
        /CREATE OR REPLACE FUNCTION public\.search_society_open_bills[\s\S]*?\$\$;/,
      )?.[0] ?? "";
    expect(fnBlock).toMatch(/SECURITY DEFINER/);
    expect(fnBlock).toMatch(/search_path\s*=\s*public/);
    expect(fnBlock).toMatch(/current_user_has_society_permission/);
    expect(fnBlock).toMatch(/'manage_billing'/);
    expect(fnBlock).toMatch(/RAISE EXCEPTION 'not_authorized'/);
  });

  it("migration revokes public execute and grants only to authenticated", () => {
    const sql = allMigrations();
    expect(sql).toMatch(
      /REVOKE ALL ON FUNCTION public\.search_society_open_bills[^;]*FROM PUBLIC/,
    );
    expect(sql).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.search_society_open_bills[^;]*TO authenticated/,
    );
  });
});

describe("Stage 3C v5 — resident submit card contract preserved", () => {
  it("still uses submitResidentBankTransfer, no actorRole, no proof_url", () => {
    expect(submitCard).toMatch(/submitResidentBankTransfer/);
    expect(submitCard).not.toMatch(/actorRole/);
    expect(submitCard).not.toMatch(/proof_url/i);
    expect(submitCard).not.toMatch(/proofUrl/);
  });
});

describe("Stage 3C v5 — protected society safety", () => {
  it("protected society UUID is not present in new Stage 3C sources", () => {
    const protectedId = "1907a918-c4b8-4f43-a837-450530cc7c34";
    expect(fnSrc).not.toContain(protectedId);
    expect(adminRoute).not.toContain(protectedId);
    expect(submitCard).not.toContain(protectedId);
  });
});
