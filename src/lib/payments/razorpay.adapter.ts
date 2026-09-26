import type { PaymentGateway } from "./gateway.interface";
import type {
  CreateSubscriptionInput,
  CreateSubscriptionResult,
  GatewayStatus,
  NormalizedWebhookEvent,
  WebhookVerifyInput,
} from "./types";
import { supabase } from "@/integrations/supabase/client";

/**
 * Legacy Razorpay adapter — kept read-only during the migration to PayU /
 * Cashfree. New subscriptions should NOT route here unless the super-admin
 * explicitly sets `pricing_settings.active_gateway = 'razorpay'`.
 */
export const razorpayAdapter: PaymentGateway = {
  name: "razorpay",

  async status(): Promise<GatewayStatus> {
    const { data } = await supabase.rpc("is_razorpay_live");
    const live = Boolean(data);
    return {
      gateway: "razorpay",
      enabled: live,
      live,
      reason: live ? undefined : "Razorpay merchant verification pending",
    };
  },

  async createSubscription(_input: CreateSubscriptionInput): Promise<CreateSubscriptionResult> {
    throw new Error("Razorpay checkout requires a server-created SaaS subscription order.");
  },

  async cancelSubscription() {
    return { ok: true };
  },

  async verifyWebhook(input: WebhookVerifyInput): Promise<NormalizedWebhookEvent> {
    return { gateway: "razorpay", type: "unknown", raw: input.rawBody };
  },
};
