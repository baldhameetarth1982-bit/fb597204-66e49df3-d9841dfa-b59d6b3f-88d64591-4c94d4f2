import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useSocietyId } from "@/hooks/useSocietyId";
import {
  FEATURE_LABELS,
  FEATURE_MIN_PLAN,
  PLAN_LABELS,
  hasFeature as hasFeatureFn,
  normalizePlan,
  type FeatureKey,
  type PlanKey,
} from "@/lib/plan-features";

/**
 * Reads the current society's plan and exposes feature checks.
 * Single source of truth for entitlement decisions in the UI.
 */
export function useFeatureAccess() {
  const { societyId, loading: sidLoading } = useSocietyId();

  const { data, isLoading } = useQuery({
    enabled: !!societyId,
    queryKey: ["society-plan", societyId],
    staleTime: 60_000,
    queryFn: async () => {
      const { data } = await supabase
        .from("societies")
        .select("plan_id,plan_status,trial_ends_at")
        .eq("id", societyId!)
        .maybeSingle();
      return {
        plan_id: (data as any)?.plan_id as string | null,
        plan_status: (data as any)?.plan_status as string | null,
        trial_ends_at: (data as any)?.trial_ends_at as string | null,
      };
    },
  });

  const plan: PlanKey = normalizePlan(data?.plan_id, data?.plan_status, data?.trial_ends_at);
  const status = data?.plan_status ?? null;
  const loading = sidLoading || isLoading;

  function hasFeature(feature: FeatureKey): boolean {
    return hasFeatureFn(plan, feature);
  }

  function getLockedReason(feature: FeatureKey): string | null {
    if (hasFeature(feature)) return null;
    const required = FEATURE_MIN_PLAN[feature];
    return `${FEATURE_LABELS[feature]} is available on the ${PLAN_LABELS[required]} plan.`;
  }

  return {
    plan,
    status,
    isLoading: loading,
    hasFeature,
    getLockedReason,
  };
}
