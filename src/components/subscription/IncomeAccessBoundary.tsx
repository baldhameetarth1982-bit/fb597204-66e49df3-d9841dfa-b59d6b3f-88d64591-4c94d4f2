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

export interface AccessInputs {
  authLoading: boolean;
  sidLoading: boolean;
  planLoading: boolean;
  societyId: string | null;
  hasFinanceRole: boolean;
  hasNonMemberPaymentsFeature: boolean;
}

/**
 * Pure decision function — the single source of truth for Income access.
 * Extracted so behavioral tests can exhaustively verify every plan/role
 * combination without a React renderer.
 */
export function computeIncomeAccess(i: AccessInputs): IncomeAccessState {
  if (i.authLoading || i.sidLoading || i.planLoading) return { kind: "loading" };
  if (!i.societyId) return { kind: "society_unavailable" };
  if (!i.hasFinanceRole) return { kind: "role_denied" };
  if (!i.hasNonMemberPaymentsFeature) return { kind: "plan_locked" };
  return { kind: "allowed", societyId: i.societyId };
}

/**
 * Behavioral hook — the single source of truth for Income access.
 *
 * The finance role is intentionally strict: it maps 1:1 to the server-side
 * `is_society_admin_for(...)` authorization used by every protected income
 * server function. BLOCK_ADMIN is NOT considered finance-capable because
 * SociyoHub has no canonical "block-scoped finance permission" table; the
 * server would reject any protected mutation from a block admin, so the UI
 * must not appear to allow it. Roles/permissions may only be added here
 * when a real backend permission exists to match.
 */
export function useIncomeAccessState(): IncomeAccessState {
  const { isLoading: authLoading, hasRole } = useAuth();
  const { societyId, loading: sidLoading } = useSocietyId();
  const { isLoading: planLoading, hasFeature } = useFeatureAccess();
  return computeIncomeAccess({
    authLoading,
    sidLoading,
    planLoading,
    societyId,
    hasFinanceRole: hasRole(ROLES.SOCIETY_ADMIN),
    hasNonMemberPaymentsFeature: hasFeature(INCOME_FEATURE),
  });
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
  const { plan } = useFeatureAccess();


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
        <UpgradePrompt feature={INCOME_FEATURE} currentPlan={plan} />
      </div>
    );
  }


  return <>{children(state.societyId)}</>;
}
