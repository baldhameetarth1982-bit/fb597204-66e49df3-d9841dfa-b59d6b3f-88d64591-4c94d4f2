import { Outlet, createFileRoute, Navigate } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { ROLES, ROLE_HOME } from "@/config/roles";

/** Super Admin layout. All `/admin/*` routes require SUPER_ADMIN role. */
export const Route = createFileRoute("/_admin")({
  head: () => ({ meta: [{ name: "robots", content: "noindex, nofollow" }] }),
  component: AdminGuard,
});

function AdminGuard() {
  const { isLoading, isAuthenticated, primaryRole, hasRole } = useAuth();

  if (isLoading) {
    return (
      <div className="min-h-[60vh] grid place-items-center text-muted-foreground">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  }
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  if (!hasRole(ROLES.SUPER_ADMIN)) {
    return <Navigate to={primaryRole ? ROLE_HOME[primaryRole] : "/login"} replace />;
  }
  return <Outlet />;
}
