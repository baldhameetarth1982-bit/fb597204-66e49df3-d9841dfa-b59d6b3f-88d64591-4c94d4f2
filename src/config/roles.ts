/**
 * SocioHub - Role-Based Access Control definitions.
 * Routes and UI are gated by these roles via the auth context.
 */
export const ROLES = {
  SUPER_ADMIN: "super_admin",
  SOCIETY_ADMIN: "society_admin",
  RESIDENT: "resident",
} as const;

export type Role = (typeof ROLES)[keyof typeof ROLES];

export const ROLE_HOME: Record<Role, string> = {
  [ROLES.SUPER_ADMIN]: "/admin/dashboard",
  [ROLES.SOCIETY_ADMIN]: "/society/dashboard",
  [ROLES.RESIDENT]: "/app/dashboard",
};
