import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_resident/app/ledger")({
  head: () => ({ meta: [{ title: "Financial Summary — SociyoHub" }] }),
  // Residents shouldn't see society-wide ledger. Send them back to their bills.
  beforeLoad: () => { throw redirect({ to: "/app/bills" }); },
  component: () => null,
});
