# Finish Stage 14 — Razorpay SaaS subscription payments

## Goal
Complete and harden SociyoHub’s Razorpay subscription lifecycle without enabling online society-maintenance payments. Cash and Bank Transfer remain unchanged, no platform fee is introduced, no real money is used, and no protected production society or live customer data is accessed.

## Confirmed scope
- **In scope:** SociyoHub SaaS plan purchase, renewal, delayed confirmation, failure, cancellation, subscription receipts, refund/reversal records, webhook replay protection, reconciliation visibility, audit history, recovery UX, security tests, accessibility checks, and release evidence.
- **Out of scope:** society-owned online maintenance payments. Founder/provider/legal approval is absent, so this remains disabled and fails closed.
- **Protected file:** `src/lib/utils.ts` remains untouched. It has six lines; the reported line-8 TS2322 diagnostic is stale and absent from current diagnostics.
- **Provider:** Razorpay only. Do not add or enable Stripe, Paddle, PayU, or Cashfree.

## Implementation

### 1. Establish one canonical subscription-payment model
- Extend the existing `saas_subscription_payments` foundation through additive migrations rather than creating a second payment system.
- Add explicit lifecycle states and timestamps for created, pending, captured, failed, cancelled, refund-pending, refunded, and reversed outcomes where supported.
- Add canonical provider event records with unique Razorpay event IDs, payload hashes, processing status, attempts, and safe failure metadata for replay protection and delayed/out-of-order recovery.
- Add immutable subscription receipt records tied to the canonical payment, society, purchaser, plan, amount, currency, and confirmation time.
- Add structured refund/reversal history without deleting or rewriting captured financial history.
- Keep all tables locked with explicit grants, RLS, tenant-scoped read policies, service-only mutation paths, and append-only audit evidence.

### 2. Centralize Razorpay server behavior
- Replace duplicated raw provider calls with one small server-only Razorpay module for order creation, payment lookup, signature verification, refund lookup/creation where already supported, and normalized provider errors.
- Keep credentials server-only and return only the publishable key ID plus canonical order details to the browser.
- Preserve the current authenticated server-function boundary and server-side plan-manager authorization.
- Remove or quarantine the unused PayU/Cashfree gateway abstraction and stale `pricing_settings.active_gateway` path so there is one payment source of truth and no accidental maintenance-payment activation.

### 3. Make creation, confirmation, and webhooks idempotent
- Add a client-generated request UUID for order creation, validated server-side and uniquely bound to actor, society, plan, amount, and environment.
- Repeated clicks or retries return the existing compatible order instead of creating another payment record.
- Confirmations verify callback signature, fetch the payment from Razorpay, and compare order ID, payment ID, amount, currency, capture state, society, plan, and purchaser before the canonical transaction runs.
- Webhooks verify the raw-body signature, require a stable event ID, reject malformed/oversized input, record each event once, and process valid transitions atomically.
- Delayed or duplicate callbacks/webhooks converge on the same payment and receipt; older events cannot overwrite a newer terminal state.
- Add bounded rate limits for order creation, confirmation/status recovery, receipt access, and refund/reversal actions. Webhook abuse is controlled through signature verification, size limits, replay records, and event-state validation without blocking normal provider retries.

### 4. Complete the subscription lifecycle
- Make the canonical database transaction the only operation that activates or renews a plan and issues a receipt.
- Implement status recovery so a user returning after refresh, interruption, or delayed webhook sees the current server state.
- Implement cancellation as a server-authoritative, audited subscription state change without deleting the purchased term.
- Implement refund/reversal only where the existing policy and provider state safely permit it; require privileged authorization and a written reason, preserve the original capture, and prevent duplicate correction records.
- Keep subscription accounting/reporting on the existing SaaS revenue path; do not touch the maintenance ledger or create a parallel accounting system.

### 5. Finish society and Super Admin experiences
- Update the subscription page and checkout to show reviewing, opening checkout, confirming, pending, captured, failed, cancelled, refunded, and recovery states honestly.
- Never show success or activate features until the canonical server transaction confirms capture.
- Add receipt access and payment history for authorized society plan managers.
- Extend the existing Super Admin payment screen with safe payment status, references, receipt, failure/refund state, reconciliation state, and audit history; sensitive actions require confirmation and written reasons.
- Preserve Sora/Manrope, semantic tokens, 44px+ targets, keyboard-safe dialogs, readable INR values, mobile layouts, and reduced motion. Generate no images.

### 6. Keep maintenance payments explicitly isolated
- Preserve resident Bank Transfer submission and admin Cash/Bank Transfer verification exactly as-is.
- Keep the online-maintenance order stub fail-closed.
- Correct stale documentation that suggests PayU/Cashfree or society maintenance gateway activation is currently available.
- Add regression tests proving maintenance UI, RPCs, and accepted methods remain offline-only and no platform fee is introduced.

## Technical details
- Use `createServerFn` with authenticated middleware for app-internal subscription actions and the existing `/api/public/hooks/razorpay` route for raw webhook requests.
- Use Zod strict schemas for every browser/provider payload and canonical minor-unit integer amounts for provider operations.
- Use additive managed migrations with explicit grants before RLS/policies for every new public table.
- Reuse the existing authorization RPC, rate-limit helper, audit log, subscription payment table, and plan-activation transaction.
- Update generated database types only through the supported backend type workflow; never hand-edit generated integration files.
- Record the final payment architecture decision in `AGENTS.md` and update payment/roadmap documentation to match shipped behavior.

## Verification and closure gates
- Baseline and final: TypeScript check, production build, full unit/integration suite, focused subscription/payment tests, migration contract checks, and client-bundle secret scan.
- Add deterministic tests for amount/plan tampering, cross-society access, unauthorized receipt access, duplicate creation, callback substitution, duplicate/replayed/out-of-order webhooks, failed capture, delayed confirmation, receipt idempotency, cancellation, refund/reversal, audit history, and maintenance-flow preservation.
- Exercise role-based UI with synthetic/demo accounts only; never use the injected real session or protected society.
- Inspect checkout, subscription history, receipt, and admin payment states at 360, 390, 414, 768, and 1280 widths, including keyboard and interruption recovery.
- If Razorpay test credentials are available, run the sandbox lifecycle only. If unavailable, mark provider execution unavailable and rely on deterministic server/provider-contract tests—never fabricate a real transaction.
- Run backend security linting and inspect all new grants, policies, functions, and constraints before closure.
- **Stage 14 closes only if all implementable gates pass with no known critical/high payment issue.** A real provider transaction or live-mode activation is not performed; unavailable external evidence is reported honestly rather than faked.
