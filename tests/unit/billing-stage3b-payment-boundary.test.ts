/**
 * Stage 3B — payment-boundary and bill-access correction.
 *
 * Proves that Stage 3B resident/admin bill routes carry no payment,
 * gateway or misleading "success" surfaces, and that admin reads go
 * through the server-authoritative getAdminBillDetail.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const residentList = readFileSync("src/routes/_resident/app.bills.tsx", "utf8");
const residentDetail = readFileSync("src/routes/_resident/app.bills.$id.tsx", "utf8");
const adminDetail = readFileSync("src/routes/_society/society.bills.$id.tsx", "utf8");
const genSrc = readFileSync("src/lib/billing-generate.functions.ts", "utf8");

describe("Stage 3B — resident routes are strictly read-only", () => {
  it("resident list has no Razorpay / order / pay-now imports", () => {
    expect(residentList).not.toMatch(/createMaintenanceOrder/);
    expect(residentList).not.toMatch(/openRazorpayForOrder/);
    expect(residentList).not.toMatch(/razorpay/i);
    expect(residentList).not.toMatch(/TransactionSummaryModal/);
    expect(residentList).not.toMatch(/PaymentSecurityBadge/);
    expect(residentList).not.toMatch(/society_payout_active/);
  });

  it("resident list uses getResidentBills and links to detail", () => {
    expect(residentList).toMatch(/getResidentBills/);
    expect(residentList).toMatch(/useServerFn\(getResidentBills\)/);
    expect(residentList).toMatch(/to="\/app\/bills\/\$id"/);
  });

  it("resident list shows no 'Pay now' button", () => {
    expect(residentList).not.toMatch(/Pay now/i);
    expect(residentList).not.toMatch(/Pay Now/);
  });

  it("resident detail route uses getResidentBillDetail server-authoritatively", () => {
    expect(residentDetail).toMatch(/getResidentBillDetail/);
    expect(residentDetail).toMatch(/useServerFn\(getResidentBillDetail\)/);
  });

  it("resident detail exposes no payment / gateway surface", () => {
    expect(residentDetail).not.toMatch(/Pay now|Pay Now/);
    expect(residentDetail).not.toMatch(/Razorpay/i);
    expect(residentDetail).not.toMatch(/openRazorpay/);
    expect(residentDetail).not.toMatch(/Payment successful/i);
  });
});

describe("Stage 3B — admin bill detail is server-authoritative", () => {
  it("uses getAdminBillDetail from server functions", () => {
    expect(adminDetail).toMatch(/getAdminBillDetail/);
    expect(adminDetail).toMatch(/useServerFn\(getAdminBillDetail\)/);
  });

  it("does not read bills/flats/societies/payments/profiles from the browser client", () => {
    expect(adminDetail).not.toMatch(/from\(["']bills["']\)/);
    expect(adminDetail).not.toMatch(/from\(["']flats["']\)/);
    expect(adminDetail).not.toMatch(/from\(["']societies["']\)/);
    expect(adminDetail).not.toMatch(/from\(["']payments["']\)/);
    expect(adminDetail).not.toMatch(/from\(["']profiles["']\)/);
    // No direct browser supabase client import.
    expect(adminDetail).not.toMatch(/from ["']@\/integrations\/supabase\/client["']/);
  });

  it("removes 'Payment successful' timeline copy", () => {
    expect(adminDetail).not.toMatch(/Payment successful/i);
  });

  it("cancel is gated by server-authoritative can_cancel", () => {
    expect(adminDetail).toMatch(/detail\.can_cancel/);
    expect(adminDetail).toMatch(/payment_summary/);
    expect(adminDetail).toMatch(/cancelBill/);
  });

  it("mentions Stage 3C boundary in timeline / info copy", () => {
    expect(adminDetail).toMatch(/Stage 3C/);
  });
});

describe("Stage 3B — getAdminBillDetail contract", () => {
  it("returns bill + lines + society + flat + resident + payment_summary + can_cancel", () => {
    expect(genSrc).toMatch(/export const getAdminBillDetail\b/);
    expect(genSrc).toMatch(/payment_summary/);
    expect(genSrc).toMatch(/can_cancel/);
    expect(genSrc).toMatch(/has_verified_payment/);
  });

  it("marks admin detail non-cancellable when a verified payment exists", () => {
    expect(genSrc).toMatch(/const can_cancel = !b\.cancelled_at && !has_verified_payment/);
  });

  it("uses requireSupabaseAuth (RLS scopes cross-society reads)", () => {
    // getAdminBillDetail must sit under requireSupabaseAuth like every Stage 3B fn.
    const block = genSrc.match(/getAdminBillDetail[\s\S]{0,400}/)?.[0] ?? "";
    expect(block).toMatch(/requireSupabaseAuth/);
  });

  it("does not use `as any` in Stage 3B source (typed adapter)", () => {
    expect(genSrc).not.toMatch(/\bas any\b/);
  });
});

describe("Stage 3B — protected society is not referenced anywhere in bill UI", () => {
  const paths = [
    "src/routes/_resident/app.bills.tsx",
    "src/routes/_resident/app.bills.$id.tsx",
    "src/routes/_society/society.bills.$id.tsx",
    "src/lib/billing-generate.functions.ts",
  ];
  for (const p of paths) {
    it(`${p} has no protected society UUID`, () => {
      expect(readFileSync(p, "utf8")).not.toContain(
        (process.env.SOCIOHUB_PROTECTED_SOCIETY_ID?.trim() || "__unset_protected_society_id__"),
      );
    });
  }
});
