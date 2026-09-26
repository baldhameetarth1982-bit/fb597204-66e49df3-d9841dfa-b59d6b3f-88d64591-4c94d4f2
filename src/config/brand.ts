/**
 * SociyoHub — canonical brand source of truth.
 * All user-facing brand references should read from here.
 */
export const BRAND = {
  name: "SociyoHub",
  pronunciation: "So-see-oh Hub",
  displayCompanyName: "SociyoHub Technologies",
  tagline: "Society management, simplified.",
  supportEmail: "support@sociohub.live",
  domain: "sociohub.live",
  colors: {
    navy: "#123047",
    teal: "#0C8F82",
    tealAlt: "#0C8F82",
    bg: "#F7FAF9",
  },
  coFounders: [
    { name: "Meetarth Baldha", role: "Co-Founder" },
    { name: "Divyaraj Vaghela", role: "Co-Founder" },
  ],
} as const;

export type BrandCoFounder = (typeof BRAND.coFounders)[number];
