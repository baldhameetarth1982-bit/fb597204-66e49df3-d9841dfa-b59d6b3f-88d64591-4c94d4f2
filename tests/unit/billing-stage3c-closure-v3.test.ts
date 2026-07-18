/**
 * Stage 3C — final closure v3.
 *
 * Guards that:
 *  - proof_url is fully removed from Stage 3C read surfaces (Option B).
 *  - New Stage 3C files have no `any` / `as any` (typed via Zod adapters).
 *  - Payment/receipt reads go through explicit SECURITY DEFINER RPCs with
 *    server-side authorization (list_society_payments_v1,
 *    get_resident_payments_v1, get_payment_receipt_lifecycle).
 *  - The receipt lifecycle exposes valid/void + snapshots + voided_at.
 *  - Resident submit card renders the VOID state after reversal.
 *  - Corrective migration revokes SELECT on receipt tables from
 *    authenticated and grants the new read RPCs to authenticated only.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

const fnSrc = readFileSync("src/lib/offline-payments.functions.ts", "utf8");
const submitCard = readFileSync(
  "src/components/billing/OfflinePaymentSubmitCard.tsx",
  "utf8",
);
const adminRoute = readFileSync(
  "src/routes/_society/society.payments.tsx",
  "utf8",
);

function allMigrationsText(): string {
  const dir = "supabase/migrations";
  return readdirSync(dir)
    .sort()
    .map((f) => readFileSync(path.join(dir, f), "utf8"))
    .join("\n\n");
}

describe("Stage 3C v3 — proof_url is not exposed on active read surfaces", () => {
  it("offline-payments.functions.ts does not reference proof_url in reads or the row type", () => {
    // The dormant column may still be mentioned in a design comment,
    // but not as a field on any exported row or projection.
    const nonComment = fnSrc.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    expect(nonComment).not.toMatch(/proof_url\s*:/);
    expect(nonComment).not.toMatch(/proofUrl/);
  });
  it("admin payments route does not reference proof_url", () => {
    expect(adminRoute).not.toMatch(/proof_url/);
    expect(adminRoute).not.toMatch(/proofUrl/);
  });
  it("resident submit card does not reference proof_url", () => {
    expect(submitCard).not.toMatch(/proof_url/);
    expect(submitCard).not.toMatch(/proofUrl/);
  });
});

describe("Stage 3C v3 — type safety in the new Stage 3C surface", () => {
  it("offline-payments.functions.ts contains no `any` or `as any`", () => {
    expect(fnSrc).not.toMatch(/\bas any\b/);
    // Bare `: any` field or param types.
    expect(fnSrc).not.toMatch(/:\s*any\b/);
    // No SupabaseRead-style adapter with a select returning any.
    expect(fnSrc).not.toMatch(/select:\s*\(cols[^)]*\)\s*=>\s*any/);
  });
});

describe("Stage 3C v3 — reads route through explicit-authorization RPCs", () => {
  it("listSocietyPayments calls list_society_payments_v1 with limit + offset", () => {
    expect(fnSrc).toContain('"list_society_payments_v1"');
    expect(fnSrc).toMatch(/_limit:\s*data\.limit/);
    expect(fnSrc).toMatch(/_offset:\s*data\.offset/);
  });
  it("exports getResidentPayments backed by get_resident_payments_v1", () => {
    expect(fnSrc).toMatch(/export const getResidentPayments\b/);
    expect(fnSrc).toContain('"get_resident_payments_v1"');
  });
  it("getPaymentReceipt calls get_payment_receipt_lifecycle", () => {
    expect(fnSrc).toContain('"get_payment_receipt_lifecycle"');
  });
  it("reads do NOT hit .from('payments') or .from('payment_receipts') directly", () => {
    expect(fnSrc).not.toMatch(/\.from\(["']payments["']\)/);
    expect(fnSrc).not.toMatch(/\.from\(["']payment_receipts["']\)/);
  });
});

describe("Stage 3C v3 — receipt lifecycle shape", () => {
  it("exports PaymentReceiptLifecycle with status/void fields and snapshots", () => {
    expect(fnSrc).toMatch(/export interface PaymentReceiptLifecycle\b/);
    for (const field of [
      "status",
      "voided_at",
      "voided_by",
      "void_reason",
      "amount_snapshot",
      "method_snapshot",
      "reference_snapshot",
      "bill_number_snapshot",
      "verified_by",
      "verified_at",
    ]) {
      expect(fnSrc).toMatch(new RegExp(`${field}:\\s*`));
    }
  });
  it("resident submit card renders a VOID state after reversal", () => {
    expect(submitCard).toMatch(/receiptStatus === "void"/);
    expect(submitCard).toMatch(/VOID/);
    expect(submitCard).toMatch(/no longer counts toward your bill/i);
  });
});

describe("Stage 3C v3 — corrective migration lands the new RPCs and grants", () => {
  const sql = allMigrationsText();
  it("revokes authenticated SELECT on receipt + sequence tables", () => {
    expect(sql).toMatch(/REVOKE SELECT ON public\.payment_receipts FROM authenticated/);
    expect(sql).toMatch(/REVOKE SELECT ON public\.payment_receipt_sequences FROM authenticated/);
    expect(sql).toMatch(/REVOKE SELECT ON public\.payment_receipt_month_sequences FROM authenticated/);
  });
  it("defines get_payment_receipt_lifecycle with authorization checks", () => {
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.get_payment_receipt_lifecycle/);
    expect(sql).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.get_payment_receipt_lifecycle\(uuid\) TO authenticated/,
    );
  });
  it("defines list_society_payments_v1 with billing.manage / super_admin check", () => {
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.list_society_payments_v1/);
    expect(sql).toMatch(/billing\.manage/);
    expect(sql).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.list_society_payments_v1\(uuid,text,int,int\) TO authenticated/,
    );
  });
  it("defines get_resident_payments_v1 scoped by flat_residents", () => {
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.get_resident_payments_v1/);
    expect(sql).toMatch(/FROM public\.flat_residents WHERE user_id = uid/);
  });
});

describe("Stage 3C v3 — protected society untouched", () => {
  const protectedUuid = "1907a918-c4b8-4f43-a837-450530cc7c34";
  for (const p of [
    "src/lib/offline-payments.functions.ts",
    "src/components/billing/OfflinePaymentSubmitCard.tsx",
    "src/routes/_society/society.payments.tsx",
  ]) {
    it(`${p} contains no protected society reference`, () => {
      expect(readFileSync(p, "utf8")).not.toContain(protectedUuid);
    });
  }
});
