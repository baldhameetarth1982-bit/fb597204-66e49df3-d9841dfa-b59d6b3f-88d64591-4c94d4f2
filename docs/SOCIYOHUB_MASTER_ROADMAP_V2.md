# SociyoHub Master Roadmap V2

> **Authoritative product, security, pricing and launch roadmap**  
> Updated: **2026-07-17**  
> Public brand: **SociyoHub**  
> Tagline: **Society management, simplified.**  
> Equal Co-Founders: **Meetarth Baldha** and **Divyaraj Vaghela**

The old nested Turn-based roadmap is historical only. Active work uses stages
1–16, with at most letters A–E. Do not create `.1`, repair, closure, slice or
hidden continuation stages. A problem found inside a letter is fixed inside the
same official letter.

## 1. Mission

Build the fastest, simplest, most private and most trustworthy society-management
SaaS in India. SociyoHub must beat larger competitors through fewer clicks,
transparent pricing, ad-free core experience, safe migration, Flat 360,
automated No-Dues, non-member collections, useful accounting and grounded AI.

The product must never win by using fake features, intrusive advertising,
resident-data monetisation, unsafe payment shortcuts or cluttered screens.

## 2. Validated customer needs that must not be lost

These requirements came from Reddit research, direct society-admin feedback and
competitor analysis:

1. **Flat 360:** owner, tenant, residents, family, bills, payments, dues,
   complaints, vehicles, visitors, documents, notices, approvals, No-Dues and
   AI summary in one unit view.
2. **Automated No-Dues:** eligibility, pending-dues check, approval chain,
   digital certificate, QR verification, audit and revocation.
3. **Non-member income/payments:** vendors, advertisers, coaches, organisers,
   shops, guests and temporary users.
4. **AI income categorisation:** maintenance, vendors, ads, fines, events,
   shops, coaches, promotions, amenities, deposits, donations and approved
   other income.
5. **Low-risk migration:** upload, mapping, validation, preview, conflicts,
   idempotent commit, real provenance and no fabricated identities.
6. **Privacy and transparency controls:** safe directory, household-only private
   data, role-based finance visibility and no cross-society exposure.
7. **Ad-free core resident experience:** no forced ads and no resident-data
   targeting.
8. **Fast admin workflows:** server pagination, global search, mobile usability,
   clear loading/error/empty states and no information split unnecessarily.
9. **Offline-first collections:** Cash and Bank Transfer work without forcing an
   online gateway.
10. **Grounded AI Secretary:** answers only from authorised society documents
    with source references.

## 3. Permanent product and payment invariants

- Razorpay is used only for **SociyoHub SaaS subscription payments**.
- Society maintenance and new offline income use **Cash** and **Bank Transfer**.
- Historical `other_offline` remains readable; it is not offered for new entries.
- No platform fee.
- No Stripe or Paddle.
- No forced society UPI/card/wallet gateway before Stage 14 approval.
- Verified financial history is not physically deleted or silently rewritten.
- Family, vehicle, occupancy, role and scope history use safe lifecycle states.
- Never fabricate auth users, email addresses, passwords or verified identities.
- Preserve legacy lowercase internal identifiers where already established.
- MCP/private integrations remain OAuth-protected; private data is never public.

## 4. Protected production society

Never use the following society for testing, fixtures, seeds, screenshots,
manual queries, probing, migration experiments or production verification:

- Name: **protected society**
- ID: `[REDACTED-PROTECTED-SOCIETY-ID]`
- Historical trial end: `2026-06-21`

Use isolated synthetic fixtures only.

## 5. Universal completion gate for every stage letter

A letter is complete only when all applicable conditions are satisfied.

### Product
- The full mandatory workflow works end-to-end.
- The production route consumes the real service/RPC.
- No disabled primary action, mock, placeholder or unused backend service remains.
- No mandatory work is moved to the next stage.

### Architecture and data
- Canonical tables and services are reused.
- No duplicate route/table/source of truth is created.
- Historical data is preserved.
- Applied migrations are corrected additively, not destructively edited.
- Legacy unsafe executable paths are revoked or retired.

### Security
- Authentication, society ownership, actor and sensitive state are derived
  server-side.
- Strict society isolation and role checks exist in server/database layers.
- Unknown roles, capabilities and settings fail closed.
- Cross-society IDs return a non-enumerating unavailable/not-found result.
- `SECURITY DEFINER` functions use fixed `search_path` and minimum grants.
- PUBLIC/anon access is revoked where required.
- Service-role secrets never enter the frontend bundle.
- No known critical/high issue remains.

### UI/UX
- Loading, empty, no-results, error, denied, locked and populated states exist.
- Important screens are usable at 390px and 1280px when preview is available.
- Touch targets are at least 44px where relevant.
- Private fields are absent from unsafe list views.
- Real totals and statuses are used.

### Performance
- Large lists use server pagination and deterministic ordering.
- Search is bounded/debounced where appropriate.
- No unbounded full-society browser fetch or obvious N+1 path remains.
- Heavy modules are lazy-loaded where justified.

### Testing and release evidence
- Allowed, denied and cross-society behaviour is tested.
- Source-contract tests supplement, but do not replace, behavioural tests.
- No `expect(true)` placeholder tests.
- `git diff --check`, typecheck, focused tests, build and client secret scan pass.
- Unavailable integration/visual evidence is reported honestly.
- Documentation and stage status are synchronised.

## 6. Fast-finish rule

Repeat a stage only for critical/high security, cross-society exposure, data
loss, unsafe money changes, false canonical provenance, broken build, broken
primary flow, a stub presented as complete, mandatory UI not wired or a parallel
source of truth.

Move small visual inconsistencies, medium refactors, broad test-framework work,
minor accessibility polish and noncritical optimisation to Stages 12, 13 or 16.

---

# Stage 1 — Income & Collections

**Status: COMPLETE**

## 1A — Backend foundation
- Canonical society income categories.
- Non-member payer directory.
- Society income records.
- Cash/Bank Transfer only for new records.
- Strict RLS, role and plan enforcement.

## 1B — Read experience
- Dashboard, filtered list and record detail.
- Server pagination and strict amount parsing.
- Safe payer/category summaries.

## 1C — Verification and security
- Verify, reject and reverse transitions.
- Atomic database mutation and audit trail.
- Non-enumerating failures.
- Exact entitlement parity.

## 1D — Management and entry
- Category management.
- External-payer directory.
- Three-step offline income entry.
- Dashboard actions and validation.

## 1E — Reporting and closure
- Category, payer, method, date and status reports.
- Reconciliation foundation.
- Export and complete Stage 1 security/UI closure.

### Stage 1 exit gate
- Browser cannot mark money verified.
- Verified/reversed history is preserved.
- Duplicate transition and cross-society actions are denied.
- Real reports reconcile with canonical records.

---

# Stage 2 — Society Foundation, People and Migration

**Status: IN PROGRESS — Stage 2D active**

## 2A — Society structure and setup
**Accepted complete**

- Canonical `societies`, `blocks`, `flats`.
- Structured and serial modes.
- No fake block for serial societies.
- Safe mode conversion and active/inactive lifecycle.
- Canonical onboarding writes and paginated unit directory.

## 2B — Residents, family, occupancy and vehicles
**Accepted complete**

- Privacy-safe resident directory and separately authorised private detail.
- Occupancy assignment, move-out and history.
- Family member and vehicle soft lifecycle.
- Duplicate active vehicle protection without plate rewriting.
- Structured/serial labels and existing route wiring.

## 2C — Teams, roles and privacy
**Accepted complete**

- Super Admin, Society Admin, Block Admin, Resident and Guard.
- Canonical capability source and SQL/TypeScript parity.
- Unknown capability denied.
- Last active Society Admin protected.
- Multiple exact Block Admin scopes; null block denied.
- Privacy settings and financial visibility resolver.
- Safe team directory and audit history.

## 2D — Migration and bulk import
**CURRENT ACTIVE STAGE**

Completed foundation:
- Private CSV upload.
- Server-side CSV parsing and authoritative parsed rows.
- Mapping, validation and server-paginated preview.
- Transactional staging replacement concept.
- `/society/import` production route wiring.
- CSV-only stance; XLSX rejected honestly.

Mandatory before completion:
- Trusted internal mutation boundary.
- Authenticated callers cannot forge path, checksum, rows, totals or readiness.
- Atomic job/path creation.
- Real canonical commit in dependency order.
- Separate `migration_commit_requests` idempotency model.
- Real canonical IDs in provenance.
- Source type derived from the job.
- No staging/parsed ID used as canonical ID.
- Unresolved, conflict or error rows block completion.
- No auth-user fabrication.
- Final result UI with stored replayable counts.

## 2E — Onboarding, migration QA and Stage 2 closure
- Complete new-society setup journey.
- Admin/team configuration and setup checklist.
- Import recovery, resume, retry and conflict-correction UX.
- Cross-route consistency and duplicate-route retirement.
- Stage 2 end-to-end role/security tests.
- Documentation and final Stage 2 closure.

### Stage 2 exit gate
- No cross-society identity, role or import leak.
- No fake account or fake import success.
- No unsafe provenance.
- Block Admin remains strictly scoped.
- Privacy controls are enforced by real data services.

---

# Stage 3 — Billing & Accounting

## 3A — Bill Studio and billing configuration
- Charge heads, billing cycles and effective dates.
- Fixed, unit, area and approved variable rules.
- Draft bill preview and template lifecycle.

## 3B — Recurring bills, dues and reminders
- Idempotent monthly generation.
- Duplicate-run protection.
- Due dates, opening balances, late fees and waivers.
- Reminder schedules and defaulter workflow.

## 3C — Cash and Bank Transfer payments  **Status: COMPLETE (v5 closure 2026-07-18)**
- Partial, full and overpayment handling.
- Verification, receipt, reversal and reconciliation.
- Resident ledger and safe payment evidence.


## 3D — Ledger, expenses, transparency and reports
- Expenses, vendors, cash book, bank book and journal.
- Balanced accounting rules.
- Income/expense, ageing and period reports.
- Resident summary/detailed transparency settings.

## 3E — Accounting correctness and closure
- Period close/reopen controls.
- Reconciliation tests, large-society performance and exports.
- Full financial security and UI closure.

### Stage 3 exit gate
- No client-authoritative paid status.
- Duplicate bills/receipts are blocked.
- Verified financial history is immutable except controlled reversal.
- Cross-society bill/payment/ledger access is impossible.

---

# Stage 4 — Flat 360, No-Dues and Gamification

## 4A — Flat 360 core
- Owner, tenant, residents, family and occupancy.
- Bills, payments, dues, complaints and vehicles.
- Visitors, documents, notices and approvals.
- Fast global unit search.

## 4B — Automated No-Dues
- Eligibility and pending-dues validation.
- Configurable approval chain.
- Digital certificate and private PDF storage.
- Public-safe QR verification, revocation and audit.

## 4C — Trusted gamification
- Exactly +2 points for verified on-time maintenance payment.
- Idempotent by payment ID.
- Reversal neutralises points.
- Society-level enable/disable.

## 4D — Permission-safe AI unit summary
- Grounded only in authorised Flat 360 data.
- Clear AI label and deterministic fallback.
- Source links/redaction and cost/rate controls.

## 4E — Runtime, security and visual closure
- Aggregated permission tests.
- Large unit-history performance.
- Mobile/desktop closure and audit.

### Stage 4 exit gate
- Flat 360 aggregation cannot bypass underlying permissions.
- No-Dues cannot issue while blocking dues remain.
- QR exposes no PII.
- Points cannot be fabricated by browser payment state.

---

# Stage 5 — Complaints, Helpdesk and Approvals

## 5A — Complaints
- Categories, priority, attachments and status lifecycle.
- Resident and admin views with private internal notes.

## 5B — Assignment and conversation
- Staff/vendor assignment, SLA, escalation, conversation and reopening.
- Resolution evidence and resident rating.

## 5C — Service requests and approvals
- Move-in/out, renovation, NOC and configurable approvals.
- Server-side transition rules and audit timeline.

## 5D — Documents and operational timeline
- Request documents, versions, expiry and private storage.
- Full action timeline.

## 5E — Notifications and closure
- SLA dashboard, workload, notifications, search/export and mobile QA.

### Stage 5 exit gate
- Attachments and internal notes are private.
- Assignment does not grant unrelated access.
- Approval transitions are server-authoritative and auditable.

---

# Stage 6 — Visitors, Guards, Vehicles and Parking

## 6A — Visitor management
- Pre-approval, QR/OTP/manual entry and host confirmation.
- Expected, inside and exited lifecycle.

## 6B — Guard application and sessions
- Guard authentication, shifts, handover and fast gate UI.
- Minimum resident data and low-bandwidth support.

## 6C — Deliveries, domestic help and history
- Deliveries, leave-at-gate, recurring help and attendance.
- Controlled blacklist/watchlist.

## 6D — Vehicle and parking
- Parking allocation, visitor parking and wrong-parking reports.
- Incident records and safe vehicle search.

## 6E — Offline/mobile/security closure
- Offline queue, duplicate scan protection, retention and load testing.

### Stage 6 exit gate
- Guard sees only minimum required information.
- Entry logs are tamper-resistant and society-isolated.
- Emergency override is explicit and audited.

---

# Stage 7 — Communication and Community

## 7A — Notices and announcements
- Draft, schedule, target, publish, expiry and archive.
- Attachments and read status.

## 7B — Polls and surveys
- Eligibility, anonymous modes, result visibility and duplicate-vote protection.

## 7C — Emergency communication
- Emergency notices and escalation with controlled preference override.

## 7D — Delivery channels
- In-app and push.
- Email/WhatsApp/SMS only through approved providers and transparent usage cost.

## 7E — Archive, accessibility and QA
- Gujarati/Hindi/English-ready architecture.
- Delivery logs, moderation, search and accessibility closure.

### Stage 7 exit gate
- Targeting and vote eligibility are server-enforced.
- Residents cannot publish official communication.
- Private attachments remain private.

---

# Stage 8 — AI Secretary Knowledge Base

## 8A — Document ingestion
- Society documents, OCR where required, chunking and version sync.
- Deletion/update propagation and permission metadata.

## 8B — Permission-aware retrieval
- Retrieve only documents the current user may access.
- Tenant isolation and prompt-injection defence.

## 8C — Cited answers
- Bylaws, notices, parking, move-in/out rules and FAQs.
- Every grounded answer links to sources.
- Honest “I do not know” behaviour.

## 8D — Workflow assistance
- Bill, notice, ledger and complaint explanations/drafts.
- No autonomous privileged mutation.

## 8E — Evaluation, safety and cost controls
- Hallucination tests, redaction, rate limits, cache and usage budgets.

### Stage 8 exit gate
- AI cannot access cross-society or unauthorised documents.
- No unsupported answer is presented as fact.
- AI failure never blocks the normal product workflow.

---

# Stage 9 — AI Income Categorisation & Reconciliation

## 9A — Taxonomy
- Maintenance, vendors, ads, fines, events, shops, coaches, promotions,
  amenities, deposits, donations and approved other categories.

## 9B — AI suggestions
- Category and explanation suggestion from authorised evidence.
- Confidence and source context.

## 9C — Human approval
- AI never posts financial mutations automatically.
- Approve, edit, reject and audit.

## 9D — Bank-statement matching
- Import, candidate matching, duplicate protection and manual confirmation.
- No raw banking credentials.

## 9E — Reports and audit closure
- Category trends, unmatched items, model quality and reconciliation reports.

### Stage 9 exit gate
- AI suggestions cannot alter verified records without human approval.
- Statement data is private and society-isolated.
- Matching/reconciliation never rewrites original evidence.

---

# Stage 10 — Smart QR Collections

## 10A — Collection creation
- Amenities, events, donations, vendors, coaches and approved temporary needs.

## 10B — QR generation
- Opaque collection token, expiry, amount rules and safe public metadata.

## 10C — Member and non-member flow
- Resident and external payer identification without fake accounts.
- Cash/Bank Transfer-first confirmation.

## 10D — Allocation and reconciliation
- Allocate to canonical category/payer/event.
- Verification, reversal and audit.

## 10E — Gateway-ready security closure
- Architecture may support a future society-owned gateway, but no live gateway
  activation occurs before Stage 14 approval.

### Stage 10 exit gate
- QR cannot expose private society/member data.
- Browser cannot mark collection paid.
- Duplicate allocations and cross-society tokens are denied.

---

# Stage 11 — Super Admin & SaaS Operations

## 11A — Societies and lifecycle
- Society creation, trial, activation, suspension and reactivation.
- Support access with explicit audit.

## 11B — Plans and subscriptions
- Four under-400 feature plans.
- Custom >400 pricing and society-specific override history.
- Razorpay subscription lifecycle, renewals and receipts.

## 11C — Support and system health
- Support tickets, SLA, incidents, service status and usage health.

## 11D — Audit, export, deletion and backup
- Data export/deletion workflow, retention and restore operations.

## 11E — SaaS analytics and closure
- MRR, churn, conversion, plan mix, unpaid subscriptions and customer health.

### Stage 11 exit gate
- Subscription success is webhook-verified and idempotent.
- Feature gates are server-authoritative.
- Downgrade never destroys historical data.
- Support impersonation/access is time-bound and audited.

---

# Stage 12 — Premium UI/UX System

## 12A — Unified design system
- SociyoHub colours, typography, spacing, radii, components and content patterns.
- Reuse current shared primitives; no duplicate design system.

## 12B — Public, auth and onboarding
- Premium landing, login and setup with clear trust/privacy messaging.

## 12C — Role dashboards and product screens
- Society Admin desktop productivity.
- Resident mobile simplicity.
- Guard one-hand speed.
- Super Admin operational clarity.

## 12D — Motion, accessibility, loading and performance
- Skeletons, reduced motion, keyboard support, visible focus and readable states.

## 12E — Every-screen responsive visual audit
- 360/390/414/mobile, tablet and 1280+.
- No overflow, clipped INR values or hidden actions.

### Stage 12 exit gate
- UI redesign does not weaken server security.
- Every route has honest loading/error/empty/denied states.
- Performance changes have measured before/after evidence.

---

# Stage 13 — Security & Reliability

## 13A — Full RLS and RBAC review
- Every society-owned table, storage bucket, RPC and role.
- Cross-society penetration matrix and legacy function retirement.

## 13B — Rate limits, validation, secrets and dependencies
- Endpoint-specific limits.
- Auth per-IP and per-account exponential backoff.
- Strict schema validation.
- Full secret and dependency audit.

## 13C — Uploads, webhooks and safe errors
- Extension/MIME/signature/content checks.
- Verified webhooks and replay protection.
- Generic user errors and server-only detailed logging.

## 13D — Backup, restore, offline and performance
- Backup schedule, restore drill, queue retry, observability and alerts.
- Large-society load and failure-mode testing.

## 13E — Full release security audit
- Threat model, privacy inventory, retention, export/deletion and penetration test.

### Stage 13 exit gate
- Zero known critical/high security issue.
- Restore is demonstrated, not only configured.
- No secret or service-only module appears in client output.
- Complete role/cross-society matrix passes.

---

# Stage 14 — Final Payment Integration

## 14A — Razorpay SociyoHub subscriptions
- Checkout, trial conversion, renewal, failure, cancellation and receipt.

## 14B — Optional society-owned gateway adapter
- Only after founder/provider/legal approval.
- Society-owned merchant account; SociyoHub does not silently become aggregator.

## 14C — Webhooks and idempotency
- Signature verification, replay protection, canonical event/request records.

## 14D — Failures, refunds and reconciliation
- Pending/failed/refunded states, support workflow and settlement reconciliation.

## 14E — Sandbox-to-live verification
- Sandbox matrix, controlled live test, monitoring and rollback.

### Stage 14 exit gate
- No client-authoritative payment success.
- No platform fee unless a later explicit founder decision changes it.
- Refund/reconciliation history is auditable.

---

# Stage 15 — Android & Play Store

## 15A — App shell
- PWA/native-wrapper decision, navigation, session and deep links.

## 15B — Device capabilities
- Push, camera, QR and file permissions with graceful denial states.

## 15C — Offline, session and updates
- Offline queues, sync conflicts, session expiry and update handling.

## 15D — Signing, privacy and store assets
- App ID, signing, icons, splash, screenshots, privacy/data-safety forms.

## 15E — Submission build
- Internal/closed testing, crash monitoring, account deletion and release build.

### Stage 15 exit gate
- No sensitive token stored insecurely.
- Deep links and notification actions respect role/tenant access.
- Store disclosures match real data behaviour.

---

# Stage 16 — Launch Readiness

## 16A — No-missing-feature audit
- Compare product against this roadmap, feature matrix and validated customer needs.

## 16B — Full role-based E2E
- Super Admin, Society Admin, Block Admin, Resident and Guard.
- Allowed, denied and cross-society critical journeys.

## 16C — Migration, support, legal and documentation
- Fresh setup/import/retry/export/restore.
- Terms/privacy drafts, training, support and incident process.

## 16D — Production deployment and monitoring
- Monitoring, alerts, backup, rollback, status communication and load readiness.

## 16E — Final launch sign-off
- Zero critical/high defect.
- Founder approval.
- Pricing/trial/support ready.
- 30/60/90-day launch plan.

### Stage 16 exit gate
- Security, backup/restore, performance and support gates are green.
- No fake, unreachable or disabled marketed feature.
- Production rollback and incident response are ready.

---

# 7. Authoritative pricing and revenue model

## Societies up to 400 flats

Pricing is **fixed by feature/payment capability**, not charged per flat.

### Basic — ₹499/month
- Structure, units, residents, households and vehicles.
- Basic maintenance bill generation.
- Cash and Bank Transfer entries and receipts.
- Notices, basic complaints and basic reports.
- Core privacy, security, audit and data export.

### Standard — ₹999/month
Everything in Basic, plus:
- Recurring billing, dues, reminders and partial payments.
- Expenses, income categories and basic ledger.
- Documents, polls and stronger reports.
- Resident self-service workflows.

### Advanced — ₹1,999/month
Everything in Standard, plus:
- Visitor and guard management.
- Amenities and operations.
- Non-member income/payment workflows.
- No-Dues certificate and QR verification.
- Roles, privacy controls and CSV migration.
- Flat 360 core and advanced accounting/reports.

### Premium AI — ₹2,999/month
Everything in Advanced, plus:
- AI Secretary.
- AI income/accounting suggestions.
- AI Flat 360 summary.
- Smart QR collection workflows.
- Advanced automation, analytics and priority support.
- Higher AI/usage limits and approved custom branding.

Security, tenant isolation, privacy, audit history and data export are never
weakened or removed from a lower-priced plan.

## Societies above 400 flats

Public wording:

> **Custom pricing — contact SociyoHub for a personalised quotation.**

Internal negotiation range:
- ₹10 per flat/month opening quote.
- ₹9 per flat/month standard negotiation.
- ₹8 per flat/month strategic floor when commercially justified.

The final rate depends on:
- flat count,
- selected features,
- billing/payment/accounting complexity,
- visitor/guard usage,
- AI allowance,
- migration effort,
- support level,
- and contract duration.

Do not publish a guaranteed ₹8 rate. Keep large-society pricing personal and
negotiated.

## Additional income outside subscriptions

Extra revenue is not included in the core plan-MRR target:
- Paid onboarding/migration.
- Premium support and training.
- WhatsApp/SMS usage margin.
- Hardware/QR/guard-device partnerships.
- Custom integrations/reports.
- Optional society-approved local sponsorships/ads.

Ads are disabled by default, clearly labelled, society-approved and never
targeted using private resident data.

## Revenue target reality

- 50 societies can reach ₹2 lakh/month only with a large-society-heavy mix,
  enterprise services or strong add-on revenue.
- Around 75–100 societies is the healthier path to ₹2–₹3 lakh monthly recurring
  subscription income.
- Ads and other services remain upside, not required to make the base SaaS work.

# 8. Current next position

Current active work remains:

> **Stage 2D — Migration and Bulk Import**

Do not start Stage 2E until trusted internal mutations, real canonical commit,
separate idempotency, real provenance, unresolved-row blocking and final result
UI are complete with no known critical/high issue.
