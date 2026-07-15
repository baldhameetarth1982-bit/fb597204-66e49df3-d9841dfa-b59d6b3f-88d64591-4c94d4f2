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
    navy: "#0B2545",
    teal: "#00A896",
    tealAlt: "#06B6A4",
    bg: "#F6F8F7",
  },
  coFounders: [
    { name: "Meetarth Baldha", role: "Co-Founder" },
    { name: "Divyaraj Vaghela", role: "Co-Founder" },
  ],
} as const;

export type BrandCoFounder = (typeof BRAND.coFounders)[number];
