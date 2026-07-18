import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  getBillDisplayStatus,
  type BillDisplayInput,
} from "@/lib/bill-display-status";

const root = process.cwd();
const read = (p: string) => readFileSync(join(root, p), "utf8");

describe("Stage 3B closure — getBillDisplayStatus", () => {
  it("returns Cancelled when cancelled_at is set regardless of status", () => {
    const s = getBillDisplayStatus({
      status: "unpaid",
      cancelled_at: "2026-01-01T00:00:00Z",
      due_date: "2026-01-15",
    });
    expect(s.code).toBe("cancelled");
    expect(s.isCancelled).toBe(true);
    expect(s.isPaid).toBe(false);
    expect(s.tone).toBe("neutral");
  });

  it("returns Paid only for canonical status 'paid'", () => {
    const s = getBillDisplayStatus({ status: "paid", due_date: "2026-01-15" });
    expect(s.code).toBe("paid");
    expect(s.isPaid).toBe(true);
    expect(s.tone).toBe("success");
  });

  it("NEVER treats legacy 'success' status as Paid", () => {
    const s = getBillDisplayStatus(
      { status: "success", due_date: "2099-01-01" } as BillDisplayInput,
    );
    expect(s.isPaid).toBe(false);
    expect(s.code).not.toBe("paid");
    expect(s.label).not.toBe("Paid");
  });

  it("NEVER treats legacy 'captured' status as Paid", () => {
    const s = getBillDisplayStatus(
      { status: "captured", due_date: "2099-01-01" } as BillDisplayInput,
    );
    expect(s.isPaid).toBe(false);
    expect(s.label).not.toBe("Paid");
  });

  it("NEVER treats 'completed' status as Paid", () => {
    const s = getBillDisplayStatus(
      { status: "completed" } as BillDisplayInput,
    );
    expect(s.isPaid).toBe(false);
    expect(s.label).not.toBe("Paid");
  });

  it("returns Overdue for unpaid bills past due_date", () => {
    const s = getBillDisplayStatus(
      { status: "unpaid", due_date: "2020-01-01" },
      new Date("2026-01-01"),
    );
    expect(s.code).toBe("overdue");
    expect(s.tone).toBe("danger");
    expect(s.isOverdue).toBe(true);
  });

  it("returns Due for unpaid bills before due_date", () => {
    const s = getBillDisplayStatus(
      { status: "unpaid", due_date: "2099-01-01" },
      new Date("2026-01-01"),
    );
    expect(s.code).toBe("due");
    expect(s.tone).toBe("warning");
  });

  it("returns Partially paid for canonical partially_paid", () => {
    const s = getBillDisplayStatus({ status: "partially_paid" });
    expect(s.code).toBe("partially_paid");
    expect(s.label).toBe("Partially paid");
    expect(s.isPaid).toBe(false);
  });

  it("falls back safely for unknown status (never Paid)", () => {
    const s = getBillDisplayStatus({
      status: "weird_gateway_value",
      due_date: "2099-01-01",
    });
    expect(s.isPaid).toBe(false);
    expect(s.label).not.toBe("Paid");
  });
});

describe("Stage 3B closure — bill routes have no online-payment promises", () => {
  const forbiddenPhrases = [
    "coming soon",
    "Pay button",
    "we'll enable secure online payments",
    "Once online payments are enabled",
    "Payment Successful",
    "Payment successful",
  ];

  const billRoutes = [
    "src/routes/_resident/app.bills.tsx",
    "src/routes/_resident/app.bills.$id.tsx",
    "src/routes/_society/society.bills.$id.tsx",
  ];

  for (const path of billRoutes) {
    it(`${path} contains no unapproved online-payment copy`, () => {
      const src = read(path);
      for (const phrase of forbiddenPhrases) {
        expect(src.toLowerCase()).not.toContain(phrase.toLowerCase());
      }
    });

    it(`${path} does not treat 'success' as paid`, () => {
      const src = read(path);
      expect(src).not.toMatch(/status\s*===\s*['"]success['"]/);
    });
  }

  it("resident dues route is retired to a redirect (no Razorpay flow)", () => {
    const src = read("src/routes/_resident/app.dues.tsx");
    expect(src).not.toContain("createMaintenanceOrder");
    expect(src).not.toContain("openRazorpayForOrder");
    expect(src).toContain("Navigate");
    expect(src).toContain("/app/bills");
  });
});

describe("Stage 3B closure — getAdminBillDetail hardening", () => {
  const src = read("src/lib/billing-generate.functions.ts");

  it("requires billing.manage or super-admin authorization", () => {
    expect(src).toContain("current_user_has_society_permission");
    expect(src).toContain("billing.manage");
    expect(src).toContain("current_user_is_super_admin");
  });

  it("does not trust legacy payment statuses to determine paid state", () => {
    expect(src).not.toMatch(/verifiedStatuses\s*=\s*new Set/);
    // has_verified_payment must be derived from canonical bill.status,
    // NOT from a payments-table scan of "captured"/"success" rows.
    expect(src).toMatch(/has_verified_payment\s*=\s*canonical\s*===\s*['"]paid['"]/);
  });

  it("never selects payments rows to compute cancellation gating", () => {
    // The old block queried payments and checked status = success/captured.
    // Confirm that specific pattern is gone.
    expect(src).not.toContain('.from("payments")');
  });
});

describe("Stage 3B closure — dashboard removes payments-status trust", () => {
  const src = read("src/routes/_resident/app.dashboard.tsx");

  it("does not compute paid-this-year from payments.status='success'", () => {
    expect(src).not.toMatch(/\.eq\(['"]status['"],\s*['"]success['"]\)/);
  });

  it("no longer routes users to /app/dues from the primary CTA", () => {
    expect(src).not.toMatch(/navigate\(\{\s*to:\s*['"]\/app\/dues['"]/);
    // The quick-action bar no longer surfaces a "Pay" tile to /app/dues.
    expect(src).not.toMatch(/to:\s*['"]\/app\/dues['"]\s*,\s*label:\s*['"]Pay['"]/);
  });
});
