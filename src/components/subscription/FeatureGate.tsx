import type { ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { useFeatureAccess } from "@/hooks/useFeatureAccess";
import type { FeatureKey } from "@/lib/plan-features";
import { UpgradePrompt } from "./UpgradePrompt";

interface Props {
  feature: FeatureKey;
  children: ReactNode;
  /** Optional custom fallback when locked. When omitted, renders <UpgradePrompt />. */
  fallback?: ReactNode;
  /**
   * "page" (default) — renders a full UpgradePrompt when locked (used to gate whole routes).
   * "inline" — renders the compact fallback prompt inline.
   * "hide" — renders nothing when locked (rare; prefer keeping the locked prompt visible).
   */
  mode?: "page" | "inline" | "hide";
}

export function FeatureGate({ feature, children, fallback, mode = "page" }: Props) {
  const { plan, hasFeature, isLoading } = useFeatureAccess();

  if (isLoading) {
    return (
      <div className="min-h-[40vh] grid place-items-center text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );
  }

  if (hasFeature(feature)) return <>{children}</>;

  if (mode === "hide") return null;
  if (fallback !== undefined) return <>{fallback}</>;

  return <UpgradePrompt feature={feature} currentPlan={plan} compact={mode === "inline"} />;
}
