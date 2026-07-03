/**
 * Pricing Engine client wrapper. Reads pricing decisions from the server
 * (`get_applicable_plans`, `get_society_access_status`, `start_society_trial`).
 * No hardcoded price tables — every value comes from `pricing_settings` /
 * `plans`.
 */
import { supabase } from "@/integrations/supabase/client";

export interface ApplicablePlan {
  tier: "standard" | "enterprise";
  plan_id: string;
  plan_name: string;
  price_monthly_inr: number | null;
  trial_days: number;
  features: string[];
  is_recommended: boolean;
  enterprise: boolean;
}

export async function getApplicablePlans(totalUnits: number | null): Promise<ApplicablePlan[]> {
  const { data, error } = await supabase.rpc("get_applicable_plans", {
    _total_units: (totalUnits ?? undefined) as any,
  });
  if (error) throw new Error(error.message);
  return ((data ?? []) as any[]).map((r) => ({
    tier: r.tier,
    plan_id: r.plan_id,
    plan_name: r.plan_name,
    price_monthly_inr: r.price_monthly_inr,
    trial_days: r.trial_days ?? 0,
    features: Array.isArray(r.features) ? r.features : [],
    is_recommended: Boolean(r.is_recommended),
    enterprise: Boolean(r.enterprise),
  }));
}

export type SocietyAccessStatus =
  | "trial"
  | "trial_expired"
  | "active"
  | "past_due"
  | "canceled"
  | "none"
  | "forbidden";

export interface SocietyAccess {
  status: SocietyAccessStatus;
  plan_id: string | null;
  trial_ends_at: string | null;
  plan_expires_at: string | null;
  trial_consumed_at: string | null;
}

export async function getSocietyAccessStatus(societyId: string): Promise<SocietyAccess> {
  const { data, error } = await supabase
    .rpc("get_society_access_status", { _society_id: societyId })
    .single();
  if (error) throw new Error(error.message);
  return data as SocietyAccess;
}

export async function startSocietyTrial(societyId: string): Promise<string> {
  const { data, error } = await supabase.rpc("start_society_trial", { _society_id: societyId });
  if (error) throw new Error(error.message);
  return data as string;
}

export interface PricingSettings {
  enterprise_threshold_units: number;
  trial_days: number;
  enterprise_contact_email: string | null;
  enterprise_contact_phone: string | null;
  active_gateway: string;
}

export async function getPricingSettings(): Promise<PricingSettings | null> {
  const { data } = await (supabase as any)
    .from("pricing_settings")
    .select(
      "enterprise_threshold_units, trial_days, enterprise_contact_email, enterprise_contact_phone, active_gateway",
    )
    .eq("id", 1)
    .maybeSingle();
  return (data as PricingSettings | null) ?? null;
}
