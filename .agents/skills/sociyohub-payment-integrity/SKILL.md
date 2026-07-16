---
name: sociyohub-payment-integrity
description: Use when SociyoHub work touches money — SaaS Razorpay subscriptions, maintenance Cash/Bank Transfer, offline non-member income, ledgers, No-Dues cryptography, refunds, adjustments, webhooks or reconciliation. Do not use for pure UI display of already-computed totals or for non-financial features.
---

# SociyoHub Payment Integrity

Money is auditable, idempotent, and never trusted from the client. This skill sets non-negotiable rules for every financial path in SociyoHub.

## Permanent scope

- **No platform fee.** SociyoHub does not take a cut of society maintenance or income.
- **Razorpay** is used only for SociyoHub SaaS subscriptions, and remains subscription-only until the final society-owned gateway stage.
- **Maintenance income** is collected today via Cash and Bank Transfer.
- **Approved offline non-member income** flows through the non-member income server functions and RLS-scoped tables.
- The society-owned gateway is deferred to its dedicated stage; do not pre-implement it.
- **No Stripe, no Paddle, no additional online gateway.** Do not add SDKs, adapters, or configuration for them.

## Explicit payment state machine

Every payment path defines its states and transitions in one canonical place:

- `pending → verified → reconciled` for online SaaS subscriptions.
- `unpaid → paid` (with `pending_confirmation` where cash/bank transfer requires admin confirmation) for maintenance.
- `draft → recorded → reversed` for offline non-member income adjustments, where reversal is a new record, not a delete.

Transitions are enforced by server functions or database constraints. UI reflects state; UI does not decide it.

## Verification separate from reconciliation

- **Verification** confirms the payer intent and gateway signature (Razorpay signature check for SaaS).
- **Reconciliation** confirms funds landed and matches against a bank statement or admin acknowledgement.

Never collapse the two into one boolean `paid` on the client's word. Reconciliation is an admin- or system-driven event, distinct from verification.

## Idempotency

Every write path that money crosses is idempotent by design:

- Use a stable idempotency key (Razorpay order/payment ID, admin-provided receipt reference, or a server-generated UUID passed back to the client).
- Repeated identical requests do not double-credit.
- Repeated webhook deliveries do not double-credit.

Test the second delivery explicitly.

## Webhook signatures

For every incoming webhook (Razorpay today):

- Verify HMAC signature against the raw request body before parsing.
- Reject on mismatch with a generic 4xx.
- Never trust `req.body` fields to route logic before signature verification.
- Store the raw body until verification is complete.

## Out-of-order webhooks

Assume webhooks may arrive:

- Duplicated.
- Out of order (`captured` before `authorized`).
- Delayed beyond the user's session.

Handlers use state transitions guarded by current status, not by naive overwrites. A later `authorized` after a `captured` does not regress state.

## Immutable audit evidence

Financial records carry:

- Created-at, updated-at timestamps.
- Actor identity (user or system).
- Prior status where relevant.
- Source event (webhook payload hash, admin action, cron job ID).

Audit rows are never deleted or edited in place. Corrections happen via new rows referencing the original.

## Controlled reversals

Reversals (refunds, cancellations, corrections):

- Are new rows or new state transitions, not `DELETE`.
- Require authorised roles (society admin for offline records; super admin for SaaS-side reversals).
- Are logged with reason and reference to the original record.

## No deletion of verified financial history

- Verified bills, verified payments, and reconciled income are not deletable via any user or admin UI.
- Even admin flows use reversals or annotations.
- Database-level: prefer soft-state via status columns and check constraints; never expose a `DELETE` policy on financial history to `authenticated`.

## No client-trusted amount, status or plan

The server:

- Computes amount due, discounts, and taxes.
- Verifies plan tier and entitlement.
- Sets status.

The client submits identifiers (bill ID, subscription ID) and receipts, not amounts or statuses.

## No JavaScript float assumptions

Money is handled in integer minor units (paise for INR) or via a decimal library, never as `number` arithmetic on rupees. Comparisons use integer equality. Formatting to `₹` happens at the presentation layer, never during arithmetic.

## Currency and locale

- INR is the default and primary currency.
- Amounts render with correct grouping (Indian numbering where the design calls for it) and the currency symbol from a shared formatter.
- Never mix currencies in a single ledger row.

## Rate limiting and abuse

- Payment initiation endpoints are rate-limited per user and per society.
- Failed verification attempts increment an abuse counter that can trigger a temporary block.
- Never expose granular failure reasons to unauthenticated callers.

## Testing floor

Payment changes require, at minimum:

- Unit tests on amount computation and state transitions.
- Integration tests that simulate:
  - a normal success path,
  - a duplicate webhook,
  - an out-of-order webhook,
  - a signature failure,
  - a plan-gated attempt by an ineligible society.
- Explicit assertion that the protected society is not touched.

Hand off to `sociyohub-verification-gate` before claiming a payment change complete.

## No shortcuts

If a proposed change would violate any rule above to ship faster, escalate through `sociyohub-agent-intelligence` and stop. Financial regressions are not recoverable by patch.
