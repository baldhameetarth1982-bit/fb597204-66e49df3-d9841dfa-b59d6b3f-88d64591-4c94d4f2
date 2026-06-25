import { Outlet, createFileRoute, Navigate, useRouterState } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/context/AuthContext";
import { useSocietyId } from "@/hooks/useSocietyId";
import { supabase } from "@/integrations/supabase/client";
import { ROLES } from "@/config/roles";

/** Resident layout. All `/app/*` routes require an authenticated user and an active society plan. */
export const Route = createFileRoute("/_resident")({
  component: ResidentGuard,
});

function ResidentGuard() {
  const { isLoading, isAuthenticated, hasRole } = useAuth();
  const { societyId, loading: sLoading } = useSocietyId();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const isSuper = hasRole(ROLES.SUPER_ADMIN);

  const { data: access, isLoading: accessLoading } = useQuery({
    enabled: !!societyId && !isSuper,
    queryKey: ["society-access-resident", societyId],
    queryFn: async () => {
      const { data } = await supabase.rpc("society_has_access", { _society_id: societyId! });
      return Boolean(data);
    },
    staleTime: 30_000,
  });

  if (isLoading || sLoading || (!isSuper && societyId && accessLoading)) {
    return (
      <div className="min-h-[60vh] grid place-items-center text-muted-foreground">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  }
  if (!isAuthenticated) return <Navigate to="/login" />;
  if (!isSuper && societyId && access === false && !pathname.endsWith("/plan-required")) {
    return <Navigate to="/app/plan-required" />;
  }
  return <Outlet />;
}
