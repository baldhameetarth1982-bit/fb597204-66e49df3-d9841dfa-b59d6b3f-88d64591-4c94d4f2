/** Client-safe types and helpers for the Super Admin platform overview. */
import { queryOptions } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type PlatformOverview = {
  status: "ok";
  generated_at: string;
  month_start: string;
  societies: { total: number; active: number; suspended: number; paid: number; trial: number; lapsed: number; new_30d: number; new_prev_30d: number };
  people: { users: number; residents: number; admins: number; guards: number; staff: number; auditors: number; active_7d: number; active_30d: number };
  subscriptions: { starter: number; growth: number; pro: number; custom: number; expiring_14d: number; mrr_estimate_inr: number; failed_payments_30d: number; stuck_payments: number };
  revenue: { gross_inr: number; refunds_inr: number; net_inr: number; test_mode_excluded: number; lifetime_net_inr: number };
  costs: { recorded_inr: number; recorded_categories: string[]; by_category: Record<string, number>; ai_rate_inr: number | null; ai_estimate_inr: number | null };
  ai: {
    month_total: number; month_ok: number; month_failed: number; month_refused: number; month_rate_limited: number;
    tokens_in: number | null; tokens_out: number | null; last_24h: number; avg_daily_prev_7d: number;
    by_feature: { feature: string; n: number; failed: number }[]; daily: { d: string; n: number }[]; tracking_since: string | null;
  };
  health: {
    jobs_24h: number; jobs_failed_24h: number; jobs_recovered_7d: number; jobs_stuck: number; last_job_at: string | null;
    webhooks_failed_7d: number; webhooks_unverified_7d: number; webhooks_last_at: string | null; razorpay_configured: boolean;
    security_events_7d: number; app_errors_24h: number; app_errors_prev_24h: number;
  };
};

export const platformOverviewQuery = queryOptions({
  queryKey: ["admin-platform-overview"],
  queryFn: async (): Promise<PlatformOverview> => {
    const { data, error } = await supabase.rpc("admin_platform_overview" as any);
    if (error || (data as any)?.status !== "ok") throw new Error("load_failed");
    return data as unknown as PlatformOverview;
  },
  staleTime: 60_000,
});

export const COST_CATEGORIES: { key: string; label: string }[] = [
  { key: "ai", label: "AI / model usage" },
  { key: "payment_processing", label: "Payment processing" },
  { key: "messaging", label: "Messaging (SMS, WhatsApp, email)" },
  { key: "storage", label: "Storage" },
  { key: "infrastructure", label: "Hosting & infrastructure" },
  { key: "other", label: "Other operating costs" },
];

export const AI_FEATURE_LABEL: Record<string, string> = {
  ai_secretary: "AI Secretary",
  ai_summary: "AI summaries",
  helpdesk_draft: "Helpdesk reply drafts",
  invoice_extraction: "Invoice reading",
  flat360_summary: "Flat 360 summaries",
  community_digest: "Community digest",
  income_category: "Income category suggestions",
  structure_plan: "Society structure planner",
  support_chat: "Support chat",
  id_check: "ID verification",
  platform_assistant: "Super Admin assistant",
};

export const inr = (n: number) => "₹" + Math.round(n).toLocaleString("en-IN");

/** Gross profit using only real sources; lists missing cost categories instead of pretending. */
export function grossProfit(o: PlatformOverview) {
  const aiCost = o.costs.by_category.ai ?? o.costs.ai_estimate_inr ?? null;
  const direct = o.costs.recorded_inr + (o.costs.by_category.ai ? 0 : o.costs.ai_estimate_inr ?? 0);
  const covered = new Set(o.costs.recorded_categories);
  if (aiCost !== null) covered.add("ai");
  const missing = COST_CATEGORIES.filter((c) => c.key !== "other" && !covered.has(c.key)).map((c) => c.label);
  const profit = o.revenue.net_inr - direct;
  const margin = o.revenue.net_inr > 0 ? (profit / o.revenue.net_inr) * 100 : null;
  return { direct, profit, margin, missing, aiCost };
}
