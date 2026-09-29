# Complete the SociyoHub Society OS expansion

## Goal
Complete the safely implementable gaps in the uploaded 53-module Society OS brief by extending existing SociyoHub domains, without replacing canonical systems or weakening security, finance, pricing, payment, or tenant boundaries.

## Current audit outcome
- Preserve and extend: authentication, role permissions, Flat 360, billing/ledger/payments, reconciliation, No-Dues, visitors, notifications, Services & Discovery, Surveys, Auditor Pack, migration, AI retrieval, scheduler, privacy, exports, and subscriptions.
- Newly completed foundation: society-scoped Amenities setup, resident booking/history, blocked dates, capacity-safe confirmation/waitlists, cancellations, no-shows, fairness reporting, audit events, RLS, server authorization, rate limits, and navigation.
- Genuine remaining gaps: tenant lifecycle, safe gate offline replay and deeper visitor operations, meetings/governance, staff/vendor/assets/procurement/budgets, document lifecycle/privacy requests, role-aware search and exception dashboards, and cross-module accessibility/performance closure.
- Externally blocked or deferred: unsupported gate hardware integrations, Play Store/Firebase/hosting owner operations, and online maintenance gateway payments.

## Delivery plan

### 1. Reconcile product truth and shared foundations
- Produce one requirement-to-implementation matrix from routes, RPCs, migrations, Feature Directory, roadmap, and the uploaded brief.
- Correct stale documentation to the approved Starter ₹8, Growth ₹10, Pro ₹12 per active flat/month model, with custom pricing above 300 flats.
- Keep server-derived society, role, permission, and plan authorization as the only access boundary.

### 2. Unit, occupancy, and tenant lifecycle
- Extend Flat 360 and existing resident relationships for invitations, lease dates, renewals, warnings, early termination, move-in/out, No-Dues checks, and automatic access expiry.
- Add safe multi-society switching that re-resolves access server-side.
- Add an optional accessible elder-mode resident home with high-frequency actions and no ads.

### 3. Gate, visitor, parking, and safety completion
- Extend the existing visitor state machine for recurring visitors, deliveries, movers/vendors, overstay, blacklist review, staff movement, incidents, and auditable overrides.
- Add a bounded, idempotent offline guard queue only for replay-safe actions, with explicit conflict and failure states.
- Extend temporary/visitor parking using existing parking and vehicle records.
- Keep hardware provider-neutral with manual fallback; never claim unsupported ANPR/RFID/biometric integrations.

### 4. Facilities, helpdesk, staff, vendors, and assets
- Extend helpdesk with assignment, SLA, waiting/escalation states, evidence, ratings, reopening, and recurring-issue evidence.
- Add constrained staff profiles, shifts, attendance/leave, and assigned-work views.
- Add canonical vendors, contracts/AMCs, assets, service history, QR references, and lightweight inventory thresholds.
- Link tickets, assets, vendors, and approved expenses instead of creating parallel systems.

### 5. Procurement and budgets through canonical finance
- Add request, quotations, approval, order, invoice, and authorized payment-reference stages.
- Post financial effects only through the existing ledger and reversal model.
- Add budget-versus-actual and auditor views over canonical records; never create a second ledger or gateway.

### 6. Governance, documents, and privacy
- Extend notices with targeting, scheduling, expiry, priority, acknowledgement, and truthful delivery/open states.
- Add meetings, agenda, RSVP, attendance, minutes, actions, resolutions, and server-enforced voting eligibility/privacy.
- Extend the existing Polls/Surveys system rather than duplicating it.
- Add a versioned private document vault and explicit resident export/delete-request workflows while preserving required finance, audit, and security records.

### 7. Finance and migration depth
- Extend billing previews, exceptions, approvals, arrears/interest, and immutable adjustment/reversal handling where genuinely missing.
- Expand Auditor Pack/export only with validated schemas; do not claim unsupported statutory or Tally compatibility.
- Extend migration staging, mappings, conflicts, retries, and dual-run comparison without forcing totals or overwriting canonical records.
- Keep maintenance payments Cash and Bank Transfer only; Razorpay remains SaaS subscriptions only.

### 8. Intelligence, automation, search, and role homes
- Extend permission-aware AI only for explainable drafts, summaries, suggestions, and exception explanations requiring human confirmation.
- Extend the existing scheduler with idempotency, duplicate-run protection, retries, failure states, and audit.
- Add server-authorized cross-domain search and deterministic “Needs attention” views per role.
- Reuse the unified notification store; external channels remain delivery adapters, not systems of record.

### 9. Accessibility, responsive quality, and performance
- Preserve the existing navy/teal design system and shared components; no broad redesign.
- Enforce 44px targets, keyboard/focus support, screen-reader status, reduced motion, safe areas, responsive tables, and unclipped INR values.
- Add honest loading, empty, denied, locked, offline, retry, conflict, and partial-success states.
- Use server pagination and measured indexes for large histories and exports.

### 10. Verification and release closure
- Validate signed-out, wrong-role, wrong-plan, and cross-society denial using authorized synthetic/demo fixtures only.
- Verify financial immutability, booking concurrency, tenant expiry, vote uniqueness/privacy, offline replay, export exclusions, scheduler idempotency, and AI boundaries.
- Run focused tests, TypeScript, database security checks, secret scan, and production build.
- Browser-check critical role flows at mobile, tablet, and desktop widths using authorized demo access only.
- Update Feature Directory and documentation from verified truth, and report external dependencies honestly.

## Hard boundaries
- Never touch `src/lib/utils.ts`.
- Never access or use the protected production society.
- No duplicate domain systems, destructive migration, fake evidence, real payment, interstitial ads, maintenance gateway, or unsupported hardware claims.
- Preserve append-only financial history, RLS, tenant isolation, server-authoritative permissions, current pricing, and existing feature availability unless an approved gate explicitly changes it.
