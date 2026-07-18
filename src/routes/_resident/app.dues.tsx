import { createFileRoute, Navigate } from "@tanstack/react-router";

/**
 * Stage 3B — /app/dues retired.
 *
 * The legacy dues screen carried an active Razorpay maintenance-payment
 * flow and a "Pay now" CTA. Stage 3B is strictly read-only for residents:
 * no gateway, no online-payment promises, no payment order creation. The
 * canonical read-only surface is `/app/bills` and `/app/bills/$id`. This
 * route redirects to preserve deep links from notifications and older
 * clients.
 */
export const Route = createFileRoute("/_resident/app/dues")({
  head: () => ({ meta: [{ title: "Bills — SociyoHub" }] }),
  component: () => <Navigate to="/app/bills" replace />,
});
