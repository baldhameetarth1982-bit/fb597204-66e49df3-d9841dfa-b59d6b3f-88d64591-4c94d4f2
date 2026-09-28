# Complete the SociyoHub Society OS expansion

## Goal
Finish every safely implementable capability in the uploaded Society OS brief by extending current SociyoHub systems, while preserving strict tenant isolation, canonical financial history, current pricing and payment boundaries, and the existing role-specific experience.

## Delivery approach
This is **RELEASE-scale** work with **DEEP** handling for migrations, permissions, finance, offline synchronization, and external ingress. Existing features remain the source of truth; each workstream begins with a focused current-state check and only genuine gaps are changed.

### 1. Reconcile product truth and shared foundations
- Build one current-state matrix from the live routes, database functions, Feature Directory, roadmap, and uploaded brief; mark each requirement reused, extended, new, deferred, or externally blocked.
- Preserve existing Firebase-to-application-session authentication, society isolation, plan inheritance, audit log, notifications, AI retrieval, exports, visitor state machine, Flat 360, billing, payments/receipts/ledger, reconciliation, No-Dues, migration, Services & Discovery, and subscriptions.
- Extend the existing role/capability model for treasurer, secretary/committee, facility staff, read-only auditor, and builder/handover access only where a real workflow requires it. Every permission remains server-authoritative and society-scoped.
- Keep Starter ₹8, Growth ₹10, Pro ₹12 per active flat/month, custom pricing above 300 flats, no resident charge, no platform fee, and no maintenance gateway.

### 2. Complete the unit and resident operating lifecycle
- Extend Flat 360 as the authoritative unit dossier with permitted occupancy history, lease dates, billed-party context, parking/vehicles, documents, dues, complaints, visitors, approvals, No-Dues, and relevant audit events.
- Add the tenant lifecycle to the existing resident/family/occupancy model: invitation, acceptance, lease start/end, renewal, warning, early termination, move-in/out, dues/NOC checks, and automatic access expiry.
- Add safe multi-society switching that re-resolves society, role, capabilities, and plan on every switch; never treat browser selection as authorization.
- Add elder mode to the resident home using the existing design system: only high-frequency actions, large touch targets, high contrast, no ads, minimal motion.

### 3. Finish gate, visitor, parking, and safety operations
- Extend the single visitor state machine for recurring/frequent visitors, deliveries and leave-at-gate evidence, vendors/movers, blacklist review, expected exit/overstay, staff/domestic-help movement, and auditable overrides.
- Make the guard home task-first for expected arrivals, walk-ins, deliveries, staff, vehicles, incidents, and SOS, optimized for low-end Android and minimal typing.
- Add a bounded offline gate queue only for operations safe to replay, with idempotency keys, expiry, society/user binding, conflict handling, and explicit Offline/Syncing/Synced/Conflict/Failed states. Sensitive actions never show false success.
- Extend parking for temporary/visitor allocation, capacity and conflict checks using existing vehicle/parking records.
- Add incident and SOS workflows with restricted evidence, dispatch states, authorized notifications, and export controls.
- Add provider-neutral hardware boundaries only where they have a real secured contract and manual fallback; never claim ANPR/RFID/biometric/barrier connectivity without a provider.

### 4. Build the missing Amenities system
- Add society-scoped amenities, rules, availability, blocked dates, bookings, attendees/capacity, cancellations, waitlist, deposits/fees as configuration, and no-show state.
- Prevent overlapping or over-capacity bookings in the database, not only in the interface; use idempotent booking mutations and audited admin changes.
- Build resident calendar/booking/history and admin setup/operations views with immediate Available/Almost full/Full/Waitlist clarity.
- Build privacy-safe fairness reporting from actual booking data: household frequency, cancellations, no-shows, peak demand, waitlists, and block distribution. It informs admins but never auto-punishes residents.
- Add optional classes/coaches on shared calendar infrastructure without mixing class attendance with ordinary bookings.

### 5. Extend facilities, staff, vendors, assets, and helpdesk
- Extend the existing helpdesk rather than replace it: assignment, SLA, priority, waiting state, escalation, staff/vendor updates, before/after evidence, closure rating, reopening, safety-ticket bypass, and recurring-issue evidence.
- Add staff profiles, shifts, attendance/leave, constrained permissions, and a focused staff home showing only assigned work.
- Add canonical vendors, contracts/AMC/documents, assets with QR/service history/maintenance dates, and lightweight inventory thresholds.
- Link tickets, assets, vendors, approved expenses, and service history without creating a second finance or ticket system.
- Add procurement and budget-vs-actual only through the canonical ledger: request, quotations, approval, order, invoice, authorized payment reference, and financial posting. No payment bypass or duplicate ledger.

### 6. Complete governance, documents, privacy, and community separation
- Extend official notices for targeting, scheduling, expiry, pin/emergency priority, must-read acknowledgements, and delivery/open states where actually supported; keep official communication completely ad-free.
- Build meetings, agenda, RSVP, attendance, minutes, action owners/dates, resolutions, and server-enforced voting eligibility. Secret ballots protect individual choices and freeze election rules once opened.
- Extend current Polls/Surveys for truthful scheduling, targeting, anonymous/identified configuration, and society isolation.
- Add a private, versioned document vault using existing storage protections and signed access.
- Extend Privacy & Transparency with resident profile/contact/directory preferences and explicit export/delete-request workflows that preserve legally/operationally retained finance, audit, and security records.
- Keep community/discovery optional and distinct from official notices; private phone data stays hidden by default.

### 7. Strengthen finance and migration without parallel truth
- Extend current billing configuration for supported charge rules, preview/exception/approval flow, arrears/interest, immutable bill identity, and adjustments/reversals without replacing verified history.
- Extend the existing accounts center for vendor ledger, opening/closing balances, budgets, tower-authorized views, and auditor exports while retaining one underlying ledger.
- Extend Auditor Pack and full export only with validated formats; do not claim Tally/statutory compatibility without verified schemas.
- Extend migration staging for recognized CSV/XLSX formats, explicit mapping/conflicts/retry, and dual-run comparisons that never force canonical totals to match.
- Keep Razorpay isolated to SociyoHub subscriptions and Cash/Bank Transfer as maintenance modes.

### 8. Integrate intelligence, automation, search, and dashboards
- Extend the existing permission-aware AI retrieval layer for explainable helpdesk drafts, summaries, invoice-field suggestions, and exception explanations; all consequential actions require human confirmation through canonical workflows.
- Extend the existing scheduler only for supported reminders/escalations/reports, with token authorization, idempotency, duplicate-run protection, retries, failure state, and audit.
- Build role-aware server search over authorized records; client filtering is never an access boundary.
- Consolidate each role home around actions and exceptions, not vanity metrics, and add one “Needs attention” surface backed by deterministic states.
- Reuse the unified notification store with priority and preferences; external channels remain optional delivery adapters, never systems of record.

### 9. Product quality, accessibility, and performance
- Reuse SociyoHub’s navy/teal tokens, Sora/Manrope typography, shared cards, statuses, sheets, and controls; no redesign or generated images.
- Ensure 44px minimum targets, keyboard/focus support, screen-reader announcements, status beyond color, reduced motion, safe areas, no horizontal overflow, and unclipped INR values.
- Provide honest loading, empty, error, denied, locked, offline, retry, partial-success, and long-running states.
- Paginate and filter on the server for large histories, batch imports/exports, add only measured indexes, and keep authorization intact.

### 10. Verification and release closure
- For every changed protected domain, verify signed-out, wrong-role, wrong-plan, and cross-society denial using synthetic fixtures only; never access the protected production society.
- Verify finance immutability/canonical posting, booking concurrency/capacity, tenant expiry, vote uniqueness/privacy, gate replay/conflicts, export field exclusion, automation idempotency, and AI permission boundaries.
- Run focused tests, TypeScript, lint where applicable, database linter/security checks, bundle-secret scan, and production build; preserve the standing instruction not to touch the stale `src/lib/utils.ts` report.
- Browser-check critical resident, guard, admin, treasurer, staff, auditor, and Super Admin flows at 360, 390, 414, 768, and 1280 widths with the authorized demo account only.
- Update the Feature Directory and internal documentation from verified implementation truth. Report hardware/provider, Play Store, monitoring/backup, or legal-template dependencies as external—not complete.

## Code budget
- **Reuse:** current role permissions, feature catalog, route shells, shared UI, visitor state machine, notification helpers, finance RPCs, Flat 360, audit/rate-limit helpers, private storage, migration pipeline, AI retrieval, exports, and scheduler.
- **Expected change:** multiple existing domain files plus additive migrations and focused tests; group work by the ten sections above and keep each domain cohesive.
- **New files:** only genuine domain ownership for amenities, meetings/governance, staff/assets, safety, tenant lifecycle, and offline gate synchronization where no equivalent exists.
- **Dependencies:** none expected; use current React/TanStack, validation, PDF/CSV, QR, and design-system libraries.
- **Hard boundaries:** no duplicate systems, no destructive migration, no real payment, no production fixtures, no image generation, no maintenance gateway, no interstitial ads, no fake hardware/provider success.
