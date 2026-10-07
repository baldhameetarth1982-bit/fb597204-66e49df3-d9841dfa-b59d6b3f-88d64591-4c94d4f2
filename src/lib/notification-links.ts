/**
 * Notification deep-link safety rules (resident notification centre).
 *
 * A notification may carry its own in-app destination. It is used only when
 * it is a plain same-app resident path (`/app/...`); anything else (external
 * URL, protocol-relative `//`, scripts, other areas) falls back to the
 * notification type's list page. Destinations always re-check access on the
 * server (RLS/RPC), so a link can never grant access by itself.
 */
const SAFE_RESIDENT_PATH = /^\/app\/[A-Za-z0-9/_\-?=&.]*$/;

export function safeResidentLink(link: unknown, fallback: string): string {
  return typeof link === "string" && SAFE_RESIDENT_PATH.test(link) && !link.includes("//") && !link.includes("..")
    ? link
    : fallback;
}

export type PersonalCategory = "notices" | "billing" | "visitors" | "helpdesk" | "parking";

/** Known notification kinds → list page. Unknown kinds stay in Notifications. */
export const PERSONAL_KIND_ROUTES: Record<string, { cat: PersonalCategory; to: string }> = {
  visitor_approval: { cat: "visitors", to: "/app/visitors" },
  visitor_entered: { cat: "visitors", to: "/app/visitors" },
  visitor_exited: { cat: "visitors", to: "/app/visitors" },
  helpdesk: { cat: "helpdesk", to: "/app/helpdesk" },
  parking: { cat: "parking", to: "/app/vehicles" },
};

export function personalKindRoute(kind: string): { cat: PersonalCategory; to: string } {
  return (
    PERSONAL_KIND_ROUTES[kind] ?? {
      cat: kind === "notice" ? "notices" : kind === "bill" || kind === "payment" ? "billing" : "helpdesk",
      to: "/app/notifications",
    }
  );
}
