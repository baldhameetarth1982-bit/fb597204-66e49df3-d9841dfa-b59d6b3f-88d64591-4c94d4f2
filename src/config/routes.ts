/**
 * Centralized route paths. Use these constants instead of hardcoded strings
 * so renames stay in one place.
 */
export const ROUTES = {
  // Public
  landing: "/",
  login: "/login",
  register: "/register",
  forgotPassword: "/forgot-password",
  resetPassword: "/reset-password",
  onboarding: "/onboarding",

  // Super Admin
  superAdmin: {
    dashboard: "/admin/dashboard",
    societies: "/admin/societies",
    subscriptions: "/admin/subscriptions",
    settings: "/admin/settings",
  },

  // Society Admin
  societyAdmin: {
    dashboard: "/society/dashboard",
    directory: "/society/directory",
    billing: "/society/billing",
    announcements: "/society/announcements",
    helpdesk: "/society/helpdesk",
    settings: "/society/settings",
  },

  // Resident
  resident: {
    dashboard: "/app/dashboard",
    dues: "/app/dues",
    notices: "/app/notices",
    helpdesk: "/app/helpdesk",
    profile: "/app/profile",
  },
} as const;
