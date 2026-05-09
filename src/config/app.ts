/**
 * App-wide configuration constants.
 * Secrets/keys must be loaded from env vars (Lovable Cloud secrets), not hardcoded.
 */
export const APP_CONFIG = {
  name: "SocioHub",
  tagline: "Society management, simplified.",
  supportEmail: "support@sociohub.app",
  currency: "INR",
  locale: "en-IN",
} as const;

export const RAZORPAY_CONFIG = {
  // Public key id only. Secret key must live server-side.
  keyId: import.meta.env.VITE_RAZORPAY_KEY_ID ?? "",
  currency: "INR",
} as const;
