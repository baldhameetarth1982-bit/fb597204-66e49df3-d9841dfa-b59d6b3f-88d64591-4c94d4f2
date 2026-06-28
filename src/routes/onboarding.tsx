import { Outlet, createFileRoute, Navigate, useRouterState } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { useSocietyId } from "@/hooks/useSocietyId";
import { ROLES, ROLE_HOME } from "@/config/roles";

export const Route = createFileRoute("/onboarding")({
  component: OnboardingLayout,
});

function OnboardingLayout() {
  const { isLoading, isAuthenticated, primaryRole } = useAuth();
  const { societyId, loading: societyLoading } = useSocietyId();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  if (isLoading || (isAuthenticated && societyLoading)) {
    return (
      <div className="min-h-[60vh] grid place-items-center text-muted-foreground">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  }
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  if (primaryRole === ROLES.SUPER_ADMIN) return <Navigate to={ROLE_HOME[ROLES.SUPER_ADMIN]} replace />;
  // Existing members go to their dashboard — but allow plan picker and pending screen.
  const allowList = ["/onboarding/plan", "/onboarding/pending"];
  if (societyId && primaryRole && !allowList.includes(pathname)) {
    return <Navigate to={ROLE_HOME[primaryRole]} replace />;
  }
  return <Outlet />;
}
