# Society OS expansion: audited delivery plan

## Scope and current-state truth

The 53-module brief is a release program, not a single feature. Existing canonical systems will be extended rather than duplicated.

### Preserve as implemented foundations

- Authentication, society/role permissions, audit logging, Flat 360 and resident relationships
- Canonical bills, ledger, Cash/Bank Transfer maintenance payments, expenses, reversals and reconciliation
- Razorpay for SociyoHub subscriptions only; Starter ₹8, Growth ₹10 and Pro ₹12 per active flat/month, custom above 300
- Visitors/gate state machine, parking/vehicles, notifications, helpdesk, notices and SOS
- Surveys, Services & Discovery, Smart QR, AI retrieval, scheduler, Auditor Pack, exports and migration
- Privacy controls, Custom Branding as Partial, Pro ad-free, and no interstitial advertising

### Started during the audit; not yet release-complete

- Amenities setup, booking/history, waitlist, cancellation and fairness reporting
- Tenant lease dates/expiry, resident assignment details and authorized society switching
- Small accessibility fixes for unlabeled icon controls

The audit found and immediately closed specific safety gaps: expired tenancies now lose resident authorization when no other active home remains; amenity booking checks access expiry and canonical overdue maintenance eligibility; stale waitlists and tenancies are scheduled for expiry; and the legacy authenticated resident-assignment overload is retired. These changes still require the validation gates below before being called complete.

## Delivery workstreams

### 1. Stabilize the current foundations

- Validate tenant expiry, society-switch authorization, audit evidence and failure states.
- Verify the lease-aware assignment path and remove remaining ambiguous client calls.
- Complete Amenities settings, including the real defaulter policy and server-enforced owner/tenant eligibility.
- Add focused negative authorization, cross-society, concurrency and rollback checks.

### 2. Resident, unit and tenant lifecycle

- Extend Flat 360 with renewal warnings, early termination, move-in/out and No-Dues-aware transitions.
- Add expiring-tenancy administration through the existing scheduler.
- Add optional accessible elder mode without creating another resident application.

### 3. Gate, visitor, parking and safety

- Extend the existing visitor domain for recurring visitors, deliveries, movers/vendors, overstays, blacklist review, incidents and audited overrides.
- Add only a narrowly whitelisted, idempotent offline queue for replay-safe operations.
- Keep approval, SOS and security-sensitive transitions fail-closed offline.
- Reuse existing vehicle and parking records; hardware integrations remain external dependencies.

### 4. Operations and facilities

- Extend helpdesk with assignment, SLA, escalation, evidence, ratings and reopen states.
- Add canonical staff, shifts, attendance/leave, vendors/contracts, assets/service history and inventory thresholds.
- Link tickets, assets, vendors and Smart QR rather than creating parallel records.

### 5. Procurement and budgets

- Add request, quotation, approval, order and invoice states.
- Post authorized financial effects only through canonical expenses and ledger functions.
- Add budget-versus-actual and auditor views without a second accounting model.

### 6. Governance, documents and privacy

- Extend notices with targeting, scheduling, expiry, priority and truthful acknowledgement states.
- Add meetings, agendas, RSVP, attendance, minutes, actions and resolutions.
- Reuse Surveys for voting with server-enforced eligibility, uniqueness and privacy.
- Add private versioned documents and export/deletion-request workflows while retaining required finance, security and audit records.

### 7. Finance, migration and builder handover depth

- Add billing preview, exception and approval depth only where genuinely missing.
- Preserve immutable adjustment and reversal workflows.
- Extend validated Auditor Pack/export schemas without unsupported statutory claims.
- Extend migration staging, mappings, conflicts, retries, comparisons and handover evidence without overwriting canonical records.

### 8. Intelligence, automation and role homes

- Add server-authorized cross-domain search and deterministic “Needs attention” views.
- Extend AI only for permission-aware, explainable drafts, summaries and suggestions with human confirmation.
- Harden scheduler idempotency, retries and visible failure states.
- Reuse the existing notification store; external channels remain adapters.

### 9. Accessibility, responsive quality and measured performance

- Fix identified labels, keyboard/focus behavior, screen-reader status, reduced motion and 44px touch targets.
- Improve responsive tables, safe areas and unclipped INR values without redesigning the product.
- Measure before changing bundles or queries; add pagination/indexes only where evidence supports them.

### 10. Release closure

- Run focused TypeScript, source-contract, authorization, tenant-boundary, concurrency, financial-integrity and secret checks.
- Verify central flows only with authorized synthetic/demo fixtures; never access the protected production society.
- Report unavailable role checks separately rather than creating unsafe accounts.
- Update the Feature Directory, roadmap and documentation only from verified behavior.

## Deferred or externally blocked

- Online maintenance gateway payments remain excluded; Cash and Bank Transfer only.
- ANPR, RFID and biometric hardware remain provider-dependent with manual fallback.
- Play Store, Firebase/domain and hosting-owner actions require owner credentials.
- Custom Branding remains Partial until an authorized live resident check is available.

## Non-negotiable boundaries

- Never touch `src/lib/utils.ts`.
- Never query or use the protected production society.
- No duplicate finance, visitor, notification, AI, migration, export or permission systems.
- Preserve strict authorization, society isolation, append-only financial history and server-authoritative plan/permission checks.
- No fake evidence, real Razorpay charge, interstitial ads, unsupported claims or broad redesign.
