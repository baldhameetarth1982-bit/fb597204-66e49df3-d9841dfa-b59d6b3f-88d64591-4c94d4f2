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
- No fake evidence, real Razorpay charge, interstitial ads, unsupported claims or broad redesign.                                                                                          FINAL EXECUTION RULES
  For every workstream, first inspect the current implementation and identify the genuine gap. Then implement, integrate, secure, validate, fix, and recheck it before considering that workstream complete.
  Do not stop after completing one workstream or after creating UI screens. Continue through every safely implementable genuine gap identified by the current-state audit. Do not declare the overall goal complete while a genuine implementation gap remains.
  Tenant/occupancy lifecycle must use explicit server-authoritative states and transitions (invited/pending/active/expiring/expired/terminated/archived as applicable). Expiry must consistently affect authorization/access; UI hiding alone is never sufficient.
  Offline Guard replay must use a narrowly allowlisted set of idempotent, low-risk operations only. Never queue role changes, financial actions, No-Dues decisions, permission changes, blacklist/security overrides, SOS, or entry approvals that cannot be server-authorized offline. Conflicts or failed replay must remain visible and fail safely rather than silently succeeding.
  Procurement is an operational workflow only:
  Request → Quotation → Approval → Order → Vendor Invoice → Authorized Payment Reference → Existing Expense/Ledger.
  Never create a second accounting or payment system.
  Governance voting must enforce eligibility and one-vote rules server-side. Voting configuration must freeze when voting opens. Where secret voting is enabled, individual voter choices must remain private while aggregate results remain auditable. Client state must never determine eligibility or totals.
  Communication states must always be truthful. Never mark a notice/message as delivered or opened unless the system has actually received that evidence. Otherwise use an explicit pending/unknown state.
  Preserve all existing canonical systems and security boundaries. Do not rebuild completed functionality, create duplicate systems, weaken RLS/tenant isolation, modify financial history, access the protected production society, or invent evidence.
  If something is genuinely blocked by missing owner credentials, unavailable role accounts, external hardware/provider access, or another external dependency, do not fake or bypass it. Implement everything safely possible, clearly record the remaining dependency, and continue with the rest of the release program.
  Do not mark the overall goal complete until the implementation has been rechecked against this entire plan and all safely implementable workstreams are genuinely complete.     Yes — **this Lovable plan is substantially better and is safe to execute**, but I would make a few final corrections **before pressing Build**. No need for another giant prompt.
  ### What is good
  It correctly:
  - Preserves existing canonical systems instead of rebuilding them.
  - Treats Amenities and tenant lifecycle as **started but not complete**, which is the right status.
  - Keeps **Razorpay SaaS-only** and maintenance **Cash + Bank Transfer**.
  - Protects the financial model and existing RLS/tenant boundaries.
  - Explicitly prevents protected-production-society access.
  - Handles offline guard functionality conservatively.
  - Keeps hardware integrations provider-dependent.
  - Avoids unsafe creation of fake accounts just to satisfy browser verification.
  - Preserves Custom Branding as Partial.
  - Includes actual release validation instead of declaring features complete merely because screens exist.
  ### I would add these 6 lines to the plan
  These are important because they prevent Lovable from stopping early or implementing ambiguous behavior:
  **1. Add a hard completion loop under Release closure:**
  > For every workstream, inspect the current implementation first, then implement only genuine gaps. Continue through all safely implementable gaps, including integration, authorization, failure states and focused validation. Do not declare the overall goal complete merely because the UI exists or one workstream is finished. Recheck each changed area before marking it complete.
  **2. Make tenant expiry an explicit state machine:**
  > Tenant/occupancy lifecycle must have explicit server-authoritative states and transitions (invited/pending/active/expiring/expired/terminated/archived as applicable). Expiry must affect authorization/access consistently; UI hiding alone is insufficient.
  **3. Tighten offline guard replay:**
  > Offline replay may contain only explicitly allowlisted, idempotent, low-risk operations. Never queue role changes, financial actions, No-Dues decisions, permission changes, blacklist/security overrides, SOS, or entry approvals whose authorization cannot be confirmed. Failed/conflicting replay must remain visible and require safe resolution rather than silently succeeding.
  **4. Clarify procurement's financial boundary:**
  > Procurement is an operational workflow only: Request → Quotation → Approval → Order → Vendor Invoice → authorized payment reference → existing Expense/Ledger truth. It must never create an independent payment/accounting system.
  **5. Clarify governance voting privacy:**
  > Voting configuration must freeze when voting opens; eligibility and one-vote enforcement are server-side. Where secret voting is enabled, results may be audited without exposing individual voter choices. Client state must never determine eligibility or vote totals.
  **6. Make communication states truthful:**
  > Never label a notice/message as delivered or opened unless the system has actually received that evidence. Otherwise use an explicit unknown/pending state.
  ### One other important observation
  The plan says:
  > “Add canonical staff, shifts, attendance/leave, vendors/contracts, assets/service history and inventory thresholds.”
  That is a **large workstream**. Lovable should extend existing foundations where available and avoid turning it into a giant parallel ERP/accounting system. Your later procurement rule correctly limits the financial side, so keep that boundary.
  ### Final verdict
  **I would approve this plan after those six additions.**
  It is now aligned with the actual SociyoHub direction:
  **existing system → audit → extend → integrate → secure → validate → only then mark complete.**