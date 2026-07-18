/**
 * Stage 3C — Offline payments, verification and receipts.
 *
 * Behavioral guards that:
 *  - The offline server functions expose the canonical write RPCs and
 *    only Cash / Bank Transfer methods.
 *  - The resident bill detail wires the offline submission card (no
 *    gateway CTA is reintroduced).
 *  - The admin payments route wires verify / reject / reverse via the
 *    server functions and never writes to `payments` directly.
 *  - The retired maintenance-pay module no longer calls Razorpay.
 *  - The protected society UUID is not referenced anywhere in the new
 *    Stage 3C surface.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const fnSrc = readFileSync("src/lib/offline-payments.functions.ts", "utf8");
const submitCard = readFileSync(
  "src/components/billing/OfflinePaymentSubmitCard.tsx",
  "utf8",
);
const residentDetail = readFileSync(
  "src/routes/_resident/app.bills.$id.tsx",
  "utf8",
);
const adminRoute = readFileSync(
  "src/routes/_society/society.payments.tsx",
  "utf8",
);
const maintenancePay = readFileSync(
  "src/lib/maintenance-pay.functions.ts",
  "utf8",
);

describe("Stage 3C — server functions expose the canonical RPCs", () => {
  it("exports the four write server functions", () => {
    expect(fnSrc).toMatch(/export const submitOfflinePayment\b/);
    expect(fnSrc).toMatch(/export const verifyOfflinePayment\b/);
    expect(fnSrc).toMatch(/export const rejectOfflinePayment\b/);
    expect(fnSrc).toMatch(/export const reverseOfflinePayment\b/);
  });

  it("routes each write through requireSupabaseAuth and callBillingRpc", () => {
    for (const name of [
      "submitOfflinePayment",
      "verifyOfflinePayment",
      "rejectOfflinePayment",
      "reverseOfflinePayment",
    ]) {
      const block =
        fnSrc.match(new RegExp(`export const ${name}[\\s\\S]{0,900}`))?.[0] ?? "";
      expect(block).toMatch(/requireSupabaseAuth/);
      expect(block).toMatch(/callBillingRpc/);
    }
  });


  it("targets the SECURITY DEFINER RPC names", () => {
    expect(fnSrc).toContain('"submit_offline_payment"');
    expect(fnSrc).toContain('"verify_offline_payment"');
    expect(fnSrc).toContain('"reject_offline_payment"');
    expect(fnSrc).toContain('"reverse_offline_payment"');
  });

  it("restricts method to cash / bank_transfer at the input schema", () => {
    expect(fnSrc).toMatch(/z\.enum\(\["cash", "bank_transfer"\]\)/);
  });

  it("requires a non-empty reason for reject and reverse", () => {
    // paymentWithReason: reason is trimmed and min(1)
    expect(fnSrc).toMatch(/reason: z\.string\(\)\.trim\(\)\.min\(1\)/);
  });

  it("maps invalid_method / invalid_transition / reference_required safely", () => {
    expect(fnSrc).toMatch(/Only Cash and Bank Transfer are supported\./);
    expect(fnSrc).toMatch(
      /This payment cannot be updated from its current state\./,
    );
    expect(fnSrc).toMatch(/Reference number is required for bank transfers\./);
  });

  it("never uses `as any`", () => {
    expect(fnSrc).not.toMatch(/\bas any\b/);
  });
});

describe("Stage 3C — resident submission card", () => {
  it("submits via submitOfflinePayment with useServerFn", () => {
    expect(submitCard).toMatch(/useServerFn\(submitOfflinePayment\)/);
  });

  it("offers no online / gateway / UPI / card / wallet payment method", () => {
    // Only Cash and Bank Transfer buttons should exist. We strip the JSX
    // <Card ...> and <CardContent> component names (a UI primitive) before
    // matching payment-method words to avoid false positives.
    const stripped = submitCard
      .replace(/<\/?Card[A-Za-z]*/g, "")
      .replace(/from ["'][^"']+["']/g, "");
    expect(stripped).not.toMatch(/UPI/i);
    expect(stripped).not.toMatch(/Razorpay/i);
    expect(stripped).not.toMatch(/\bcredit card|\bdebit card|card payment/i);
    expect(stripped).not.toMatch(/Wallet/i);
  });


  it("does not promise online payments or a future Pay button", () => {
    expect(submitCard).not.toMatch(/coming soon/i);
    expect(submitCard).not.toMatch(/Pay now/i);
    expect(submitCard).not.toMatch(/gateway/i);
  });

  it("generates a client-side idempotency key for the submission", () => {
    expect(submitCard).toMatch(/idempotencyKey/);
    expect(submitCard).toMatch(/idKey/);
  });

  it("waits for admin verification before showing a receipt number", () => {
    expect(submitCard).toMatch(/Pending admin verification/);
    expect(submitCard).toMatch(/Payment verified/);
    expect(submitCard).toMatch(/getPaymentReceipt/);
  });

  it("resident detail wires the submission card only for open bills", () => {
    expect(residentDetail).toMatch(/OfflinePaymentSubmitCard/);
    expect(residentDetail).toMatch(
      /!state\.isCancelled && !state\.isPaid && \(\s*<OfflinePaymentSubmitCard/,
    );
  });

  it("resident detail still exposes no gateway / Razorpay surface", () => {
    expect(residentDetail).not.toMatch(/Razorpay/i);
    expect(residentDetail).not.toMatch(/createMaintenanceOrder/);
    expect(residentDetail).not.toMatch(/openRazorpayForOrder/);
    expect(residentDetail).not.toMatch(/Pay now/i);
  });
});

describe("Stage 3C — admin payments route", () => {
  it("wires verify / reject / reverse via useServerFn", () => {
    expect(adminRoute).toMatch(/useServerFn\(verifyOfflinePayment\)/);
    expect(adminRoute).toMatch(/useServerFn\(rejectOfflinePayment\)/);
    expect(adminRoute).toMatch(/useServerFn\(reverseOfflinePayment\)/);
    expect(adminRoute).toMatch(/useServerFn\(listSocietyPayments\)/);
  });

  it("does not perform direct browser writes to payments", () => {
    expect(adminRoute).not.toMatch(/from\(["']payments["']\)/);
    expect(adminRoute).not.toMatch(/from ["']@\/integrations\/supabase\/client["']/);
  });

  it("requires an explicit reason before reject or reverse", () => {
    expect(adminRoute).toMatch(/Enter a reason before rejecting/);
    expect(adminRoute).toMatch(/Enter a reason before reversing/);
  });

  it("tabs cover pending / verified / rejected / reversed", () => {
    for (const s of ["pending", "verified", "rejected", "reversed"]) {
      expect(adminRoute).toContain(`"${s}"`);
    }
  });
});

describe("Stage 3C — legacy maintenance-pay is retired", () => {
  it("no longer creates Razorpay orders", () => {
    expect(maintenancePay).not.toMatch(/api\.razorpay\.com/);
    expect(maintenancePay).not.toMatch(/orderPayload/);
    expect(maintenancePay).not.toMatch(/transfers:/);
    expect(maintenancePay).not.toMatch(/RAZORPAY_KEY_ID/);
  });

  it("throws a Stage 3C boundary message when invoked", () => {
    expect(maintenancePay).toMatch(
      /Online maintenance payments are not available/,
    );
  });
});

describe("Stage 3C — protected society is not referenced", () => {
  const paths = [
    "src/lib/offline-payments.functions.ts",
    "src/components/billing/OfflinePaymentSubmitCard.tsx",
    "src/routes/_society/society.payments.tsx",
  ];
  const protectedUuid = "1907a918-c4b8-4f43-a837-450530cc7c34";
  for (const p of paths) {
    it(`${p} has no protected society UUID`, () => {
      expect(readFileSync(p, "utf8")).not.toContain(protectedUuid);
    });
  }
});
