import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_resident/app/ledger")({
  head: () => ({ meta: [
    { title: "Financial Summary — SociyoHub" },
    { name: "description", content: "Open your resident bills and payment history in SociyoHub." },
    { property: "og:title", content: "Financial Summary — SociyoHub" },
    { property: "og:description", content: "Resident bills and payment history in SociyoHub." },
    { property: "og:type", content: "website" },
    { name: "twitter:card", content: "summary" },
  ] }),
  // Residents shouldn't see society-wide ledger. Send them back to their bills.
  beforeLoad: () => { throw redirect({ to: "/app/bills" }); },
  component: () => null,
});
