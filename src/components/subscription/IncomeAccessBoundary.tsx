/**
 * Stage 1D — shared Income feature-access boundary.
 *
 * Guarantees that protected Income query/mutation hooks are structurally
 * unmounted for any caller whose access is not `allowed`. Basic, expired,
 * inactive, cancelled, past_due, missing-society, role-denied and loading
 * states all render a safe non-protected UI and execute zero protected
 * service calls.
 *
 * Consumers pass a render function that receives a resolved, non-null
 * `societyId: string`. That guarantee is what lets the authorized child
 * drop `societyId ?? ""` empty-string query keys and `societyId!`
 * non-null assertions.
 */
import type { ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { useSocietyId } from "@/hooks/useSocietyId";
import { useAuth } from "@/context/AuthContext";
import { ROLES } from "@/config/roles";
import { useFeatureAccess } from "@/hooks/useFeatureAccess";
import { UpgradePrompt } from "./UpgradePrompt";
import { Card, CardContent } from "@/components/ui/card";
import { ShieldAlert } from "lucide-react";

export type IncomeAccessState =
  | { kind: "loading" }
  | { kind: "allowed"; societyId: string }
  | { kind: "plan_locked" }
  | { kind: "role_denied" }
  | { kind: "society_unavailable" };

const INCOME_FEATURE = "non_member_payments" as const;

/**
 * Behavioral hook — the single source of truth for Income access.
 * Never returns `allowed` until society is resolved, plan is loaded, and
 * role is one of the finance-capable admin roles.
 */
export function useIncomeAccessState(): IncomeAccessState {
  const { isLoading: authLoading, hasRole } = useAuth();
  const { societyId, loading: sidLoading } = useSocietyId();
  const { plan: _plan, isLoading: planLoading, hasFeature } = useFeatureAccess();

  if (authLoading || sidLoading || planLoading) return { kind: "loading" };
  if (!societyId) return { kind: "society_unavailable" };
  // Society layout already gates SOCIETY_ADMIN / BLOCK_ADMIN, but keep the
  // check local so this boundary is safe in isolation and in unit tests.
  const isFinanceAdmin = hasRole(ROLES.SOCIETY_ADMIN) || hasRole(ROLES.BLOCK_ADMIN);
  if (!isFinanceAdmin) return { kind: "role_denied" };
  if (!hasFeature(INCOME_FEATURE)) return { kind: "plan_locked" };
  return { kind: "allowed", societyId };
}

interface Props {
  children: (societyId: string) => ReactNode;
}

/**
 * Renders `children(societyId)` ONLY when the caller is authorized. In every
 * other state, the authorized subtree is structurally unmounted so protected
 * queries and mutations cannot execute.
 */
export function IncomeAccessBoundary({ children }: Props) {
  const state = useIncomeAccessState();

  if (state.kind === "loading") {
    return (
      <div
        data-testid="income-access-loading"
        className="min-h-[40vh] grid place-items-center text-muted-foreground"
      >
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );
  }

  if (state.kind === "society_unavailable") {
    return (
      <div
        data-testid="income-access-society-unavailable"
        className="min-h-[40vh] grid place-items-center text-sm text-muted-foreground"
      >
        Select a society to view income & collections.
      </div>
    );
  }

  if (state.kind === "role_denied") {
    return (
      <Card
        data-testid="income-access-role-denied"
        className="rounded-3xl border border-destructive/20"
      >
        <CardContent className="p-6 flex items-start gap-3">
          <ShieldAlert className="h-5 w-5 text-destructive shrink-0" />
          <div className="text-sm">
            <div className="font-medium">Not available for your role</div>
            <div className="text-muted-foreground mt-1">
              Income & Collections is managed by the society finance admin.
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (state.kind === "plan_locked") {
    return (
      <div data-testid="income-access-plan-locked">
        <UpgradePrompt feature={INCOME_FEATURE} currentPlan={useFeatureAccess().plan} />
      </div>
    );
  }

  return <>{children(state.societyId)}</>;
}
