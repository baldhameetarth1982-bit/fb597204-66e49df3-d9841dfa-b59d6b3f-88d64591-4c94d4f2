import { useEffect, type ReactNode } from "react";
import { Navigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/context/AuthContext";
import { ROLE_HOME, ROLES } from "@/config/roles";

function FullScreenLoader() {
  return (
    <div className="min-h-dvh grid place-items-center bg-background text-muted-foreground">
      <span className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
    </div>
  );
}

function HardRedirectToLogin() {
  const queryClient = useQueryClient();
  useEffect(() => {
    queryClient.cancelQueries();
    queryClient.clear();
    window.location.replace("/login");
  }, [queryClient]);
  return <FullScreenLoader />;
}

export function ProtectedRoute({ pathname, children }: { pathname: string; children: ReactNode }) {
  const { isLoading, isCheckingProfile, isAuthenticated, primaryRole, profile } = useAuth();

  if (isLoading || isCheckingProfile) return <FullScreenLoader />;
  if (!isAuthenticated) return <HardRedirectToLogin />;

  if (pathname === "/admin") return <Navigate to="/admin/dashboard" replace />;
  if (pathname === "/society") return <Navigate to="/society/dashboard" replace />;
  if (pathname === "/app") return <Navigate to="/app/dashboard" replace />;

  if (pathname === "/dashboard" || pathname.startsWith("/dashboard/")) {
    return <Navigate to={primaryRole ? ROLE_HOME[primaryRole] : "/onboarding"} replace />;
  }

  if (pathname.startsWith("/admin") && primaryRole !== ROLES.SUPER_ADMIN) {
    return <Navigate to={primaryRole ? ROLE_HOME[primaryRole] : "/login"} replace />;
  }

  if (pathname.startsWith("/society") && primaryRole !== ROLES.SOCIETY_ADMIN && primaryRole !== ROLES.BLOCK_ADMIN) {
    return <Navigate to={primaryRole ? ROLE_HOME[primaryRole] : "/login"} replace />;
  }

  if (pathname.startsWith("/app") && primaryRole !== ROLES.RESIDENT && primaryRole !== ROLES.SECURITY) {
    return <Navigate to={primaryRole ? ROLE_HOME[primaryRole] : "/login"} replace />;
  }

  if (pathname.startsWith("/onboarding")) {
    if (primaryRole === ROLES.SUPER_ADMIN) return <Navigate to={ROLE_HOME[ROLES.SUPER_ADMIN]} replace />;
    if (profile?.society_id && primaryRole && pathname !== "/onboarding/plan") {
      return <Navigate to={ROLE_HOME[primaryRole]} replace />;
    }
  }

  return <>{children}</>;
}