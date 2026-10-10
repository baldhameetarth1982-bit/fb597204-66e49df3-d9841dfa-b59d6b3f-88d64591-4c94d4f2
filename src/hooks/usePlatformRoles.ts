import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/context/AuthContext";
import { ROLES } from "@/config/roles";

export type PlatformStaffRole = "operations" | "finance" | "marketing" | "support";

/**
 * Platform staff areas for the signed-in person. Read from the protected
 * platform_staff_roles table through a server function; this only decides
 * which menu items to show — every page and action re-checks on the server.
 */
export function usePlatformRoles() {
  const { isAuthenticated, user, hasRole } = useAuth();
  const isSuper = isAuthenticated && hasRole(ROLES.SUPER_ADMIN);
  const q = useQuery({
    queryKey: ["platform-staff-roles", user?.id],
    enabled: isAuthenticated && !!user?.id && !isSuper,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)("current_user_platform_roles");
      if (error) throw error;
      return ((data as string[] | null) ?? []) as PlatformStaffRole[];
    },
  });
  const roles = q.data ?? [];
  return {
    isSuper,
    roles,
    isStaff: roles.length > 0,
    isLoading: !isSuper && isAuthenticated && q.isLoading,
    can: (...areas: PlatformStaffRole[]) => isSuper || areas.some((a) => roles.includes(a)),
  };
}

/** Which staff areas may open each Super Admin page. Missing = Super Admin only. */
export const ADMIN_PAGE_AREAS: Record<string, PlatformStaffRole[]> = {
  "/admin/dashboard": ["operations", "finance"],
  "/admin/health": ["operations", "support", "finance"],
  "/admin/users": ["operations", "support"],
  "/admin/subscription-payments": ["finance"],
  "/admin/income": ["finance"],
  "/admin/ads": ["marketing"],
  "/admin/announcements": ["marketing"],
};

/** First Super Admin page a staff member can open. */
export function staffHome(roles: PlatformStaffRole[]): string {
  if (roles.includes("operations") || roles.includes("finance")) return "/admin/dashboard";
  if (roles.includes("support")) return "/admin/users";
  return "/admin/ads";
}
