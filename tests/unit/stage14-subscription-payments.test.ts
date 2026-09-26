import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const read = (path: string) => readFileSync(resolve(root, path), "utf8");
const lifecycleMigration = read("drizzle/migrations/0062_stage14_subscription_payment_lifecycle.sql");
const orderMigration = read("drizzle/migrations/0063_stage14_subscription_order_idempotency.sql")
  + read("drizzle/migrations/0064_stage14_atomic_order_claim.sql");
const refundMigration = read("drizzle/migrations/0065_stage14_atomic_refund_claim.sql")
  + read("drizzle/migrations/0066_stage14_refund_submission_recovery.sql");
const checkout = read("src/lib/saas-subscription-payment.functions.ts");
const lifecycle = read("src/lib/saas-subscription-lifecycle.functions.ts");
const webhook = read("src/routes/api/public/hooks/razorpay.ts");
const residentBill = read("src/routes/_resident/app.bills.$id.tsx");
const offlineCard = read("src/components/billing/OfflinePaymentSubmitCard.tsx");
const offlineServer = read("src/lib/offline-payments.functions.ts");

describe("Stage 14 subscription payment security contracts", () => {
  it("uses an actor-bound request UUID and atomic order claim", () => {
    expect(checkout).toMatch(/requestId: z\.string\(\)\.uuid\(\)/);
    expect(checkout).toContain('"claim_saas_subscription_order"');
    expect(checkout).toContain('"complete_saas_subscription_order"');
    expect(orderMigration).toMatch(/UNIQUE \(requested_by, request_id\)/i);
    expect(orderMigration).toMatch(/GET DIAGNOSTICS v_inserted = ROW_COUNT/i);
    expect(orderMigration).toMatch(/IF v_inserted = 1 THEN/i);
  });

  it("keeps provider secrets and payment confirmation server-side", () => {
    expect(checkout).toContain('await import("@/lib/saas-payments/razorpay.server")');
    expect(checkout).toContain('"finalize_saas_subscription_payment"');
    expect(checkout).toMatch(/payment\.order_id !== data\.razorpayOrderId/);
    expect(checkout).toMatch(/payment\.amount !== pending\.amount_paise/);
    expect(checkout).toMatch(/payment\.status !== "captured"/);
  });

  it("persists signed webhook events before activation and rejects conflicting replay", () => {
    const insertAt = webhook.indexOf('.from("saas_payment_events")');
    const finalizeAt = webhook.indexOf('"finalize_saas_subscription_payment"');
    expect(insertAt).toBeGreaterThan(-1);
    expect(finalizeAt).toBeGreaterThan(insertAt);
    expect(webhook).toContain('priorEvent.payload_sha256 !== payloadHash');
    expect(webhook).toContain('processing_status === "processed"');
    expect(webhook).toContain('maintenance_mutation: false');
  });

  it("issues one immutable receipt from the canonical capture transaction", () => {
    expect(lifecycleMigration).toMatch(/payment_id uuid NOT NULL UNIQUE REFERENCES public\.saas_subscription_payments/i);
    expect(lifecycleMigration).toMatch(/ON CONFLICT \(payment_id\) DO NOTHING/i);
    expect(lifecycleMigration).toMatch(/GRANT SELECT ON public\.saas_subscription_receipts TO authenticated/i);
    expect(lifecycleMigration).toMatch(/current_user_has_society_permission\(society_id, 'society\.settings'/i);
    expect(lifecycleMigration).toMatch(/REVOKE ALL ON FUNCTION public\.finalize_saas_subscription_payment[^;]+FROM PUBLIC, anon, authenticated/is);
  });

  it("keeps refunds privileged, reasoned, idempotent, and append-only", () => {
    expect(lifecycle).toContain('rpc("current_user_is_super_admin")');
    expect(lifecycle).toMatch(/reason: z\.string\(\)\.trim\(\)\.min\(3\)\.max\(500\)/);
    expect(refundMigration).toMatch(/request_id uuid NOT NULL UNIQUE/i);
    expect(refundMigration).toMatch(/provider_refund_id = COALESCE\(provider_refund_id, _provider_refund_id\)/i);
    expect(lifecycleMigration).toMatch(/lifecycle_status = 'refunded'/i);
    expect(lifecycleMigration).toMatch(/UPDATE public\.saas_subscription_receipts[\s\S]+status = 'refunded'/i);
    expect(lifecycleMigration).not.toMatch(/DELETE FROM public\.saas_subscription_payments/i);
  });

  it("checks provider state before cancellation and lets captured payment win", () => {
    const cancelStart = lifecycle.indexOf("export const cancelPendingSaasSubscriptionOrder");
    const cancelSource = lifecycle.slice(cancelStart, lifecycle.indexOf("export const refundSaasSubscriptionPayment"));
    expect(cancelSource).toContain("fetchRazorpayOrder(data.orderId)");
    expect(cancelSource).toContain('providerOrder.status === "paid"');
    expect(cancelSource).toContain('"finalize_saas_subscription_payment"');
    expect(cancelSource.indexOf('providerOrder.status === "paid"')).toBeLessThan(cancelSource.indexOf('lifecycle_status: "cancelled"'));
  });

  it("preserves Cash and Bank Transfer-only maintenance payments", () => {
    const maintenance = `${residentBill}\n${offlineCard}\n${offlineServer}`;
    expect(maintenance).toMatch(/Cash/);
    expect(maintenance).toMatch(/Bank Transfer/);
    expect(maintenance).not.toMatch(/openRazorpayForOrder|createSaasSubscriptionOrder/);
    expect(webhook).not.toMatch(/from\("payments"\)|from\("bills"\)|finance_journal/i);
  });

  it("does not introduce a platform fee", () => {
    expect(`${lifecycleMigration}\n${orderMigration}\n${refundMigration}`).not.toMatch(/platform_fee|application_fee|commission_paise/i);
  });
});