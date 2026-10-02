/**
 * SociyoHub - Role-Based Access Control definitions.
 * Routes and UI are gated by these roles via the auth context.
 */
export const ROLES = {
  SUPER_ADMIN: "super_admin",
  SOCIETY_ADMIN: "society_admin",
  BLOCK_ADMIN: "block_admin",
  SECURITY: "security",
  RESIDENT: "resident",
  AUDITOR: "auditor",
  STAFF: "staff",
} as const;

export type Role = (typeof ROLES)[keyof typeof ROLES];

export const ROLE_HOME: Record<Role, string> = {
  [ROLES.SUPER_ADMIN]: "/admin/dashboard",
  [ROLES.SOCIETY_ADMIN]: "/society/dashboard",
  [ROLES.BLOCK_ADMIN]: "/society/dashboard",
  [ROLES.SECURITY]: "/app/guard",
  [ROLES.RESIDENT]: "/app/dashboard",
  [ROLES.AUDITOR]: "/auditor",
  [ROLES.STAFF]: "/staff",
};
