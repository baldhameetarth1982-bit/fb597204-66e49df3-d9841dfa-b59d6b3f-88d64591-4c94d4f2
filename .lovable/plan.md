# Society OS expansion: audited delivery plan

## Scope and current-state truth

The 53-module brief is a release program, not a single feature. Existing canonical systems will be extended rather than duplicated.

### Preserve as implemented foundations

- Auth, RLS, society/role permissions, audit logging, Flat 360 and resident relationships
- Canonical bills, ledger, cash/bank-transfer maintenance payments, expenses, reversals and reconciliation
- Razorpay for SociyoHub SaaS subscriptions only; ₹8/₹10/₹12 per active flat/month, custom above 300
- Visitors/gate state machine, parking/vehicles, notifications, helpdesk, notices and SOS
- Surveys, Services & Discovery, Smart QR, AI retrieval, scheduler, Auditor Pack, exports and migration
- Privacy controls, Custom Branding as Partial, Pro ad-free, and no interstitial advertising

### Started but not yet release-verified

- Amenities foundation: setup, availability, booking/history, waitlist, cancellation, no-show and fairness reporting
- Tenant lifecycle and safe society switching: lease dates/expiry, authorized switching, resident assignment/detail UI

These were started before this checkpoint was presented. The first implementation step will audit and stabilize them; they will not be called complete until authorization, function signatures, expiry behavior and focused source/SQL validation pass.

## Genuine implementation workstreams

### 1. Stabilize current foundations

- Resolve tenant expiry semantics where active `user_roles` could outlive an expired occupancy.
- Verify and remove unsafe/ambiguous resident-assignment RPC overloads.
- Verify society-switch authorization, current-society role filtering, audit behavior and client failure states.
- Close Amenities policy gaps such as defaulter eligibility and plan/role enforcement.

### 2. Resident, unit and tenant lifecycle

- Extend Flat 360 with invitations, renewal warnings, early termination, move-in/out and No-Dues-aware transitions.
- Add expiring-tenancy administration and automatic expiry through the existing scheduler.
- Add optional accessible elder mode without creating another resident app.

### 3. Gate, visitor, parking and safety

- Extend the existing visitor domain for recurring visitors, deliveries, movers/vendors, overstays, blacklist review, incidents and audited overrides.
- Add only a narrowly whitelisted, idempotent offline queue for replay-safe operations.
- Keep entry approval, SOS and security-sensitive transitions fail-closed offline.
- Reuse existing vehicle and parking records; hardware integrations remain provider/owner dependent.

### 4. Operations and facilities

- Extend helpdesk with assignment, SLA, waiting/escalation, evidence, ratings and reopen states.
- Add canonical staff, shifts, attendance/leave, vendors/contracts, assets/service history and inventory thresholds.
- Link tickets, assets, vendors and Smart QR rather than introducing parallel records.

### 5. Procurement and budgets

- Add request, quotation, approval, order and invoice states.
- Post authorized financial effects only through canonical expenses and ledger functions.
- Add budget-versus-actual and auditor views without a second accounting model.

### 6. Governance, documents and privacy

- Extend notices with targeting, scheduling, expiry, priority and truthful acknowledgement/delivery states.
- Add meetings, agendas, RSVP, attendance, minutes, actions and resolutions.
- Reuse Surveys for voting with server-enforced eligibility, uniqueness and privacy.
- Add versioned private documents plus export/deletion-request workflows that preserve mandatory finance, security and audit retention.

### 7. Finance, migration and builder handover depth

- Add billing preview/exception/approval depth and immutable adjustment/reversal workflows only where missing.
- Extend validated Auditor Pack and export schemas without unsupported statutory claims.
- Extend migration staging, mappings, conflicts, retries, dual-run comparison and handover evidence without overwriting canonical records.

### 8. Intelligence, automation and role homes

- Add server-authorized cross-domain search and deterministic “Needs attention” views.
- Extend AI only for permission-aware, explainable drafts/summaries/suggestions with human confirmation.
- Harden scheduler idempotency, retries and observable failure states.
- Reuse the notification store; external channels remain adapters.

### 9. Accessibility, responsive quality and performance

- Fix identified unlabeled controls and enforce keyboard/focus, screen-reader status, reduced-motion and 44px touch targets.
- Improve responsive tables, safe areas and unclipped INR values without redesigning the product.
- Measure before changing bundles/queries; lazy-load heavy libraries and add indexes/pagination only where evidence supports them.

### 10. Release closure

- Run focused TypeScript, source-contract, SQL authorization/tenant-boundary, concurrency, financial-integrity and secret checks.
- Use only authorized synthetic/demo fixtures; never the protected production society.
- Do not create unsafe accounts to fill unavailable roles; report unavailable live verification separately.
- Update Feature Directory, roadmap and documentation only from verified truth.

## Deferred or externally blocked

- Online maintenance gateway payments remain excluded; Cash and Bank Transfer only.
- ANPR/RFID/biometric hardware remains provider-dependent with manual fallback.
- Play Store, Firebase/domain and hosting-owner actions require owner credentials.
- Custom Branding stays Partial until authorized live resident checks are available.

## Non-negotiable boundaries

- Never touch `src/lib/utils.ts`.
- Never query or use the protected production society.
- No duplicate finance, visitor, notification, AI, migration, export or permission systems.
- Preserve strict auth, RLS, tenant isolation, append-only financial history and server-authoritative plan/permission checks.
- No fake evidence, real Razorpay charge, interstitial ads, unsupported claims or broad redesign.
