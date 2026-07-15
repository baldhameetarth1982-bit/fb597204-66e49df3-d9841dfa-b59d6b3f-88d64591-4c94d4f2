# SociyoHub Master Roadmap V2

> The old nested "Turn 17 / Turn 18B.x" roadmap is now **historical only**.
> Active work uses this flat, letter-scoped V2 roadmap.
>
> **Naming rule:** stages are numbered; each stage has at most letters A–E.
> No sub-turns, no `.1` / `.2`, no repair stages. Bugs found during a letter
> are fixed inside that same letter.

## Delivery rules (permanent)

Every stage letter must include:

1. Source-code audit
2. Implementation
3. Authorization & security
4. Responsive UI
5. Loading / empty / error states
6. Automated tests
7. Build verification
8. Secret scan
9. Documentation
10. Honest completion report

A letter is complete only when its full realistic scope ships. Placeholder
screens, fake buttons, fake calculations, fake AI, and fake integration
evidence never count as complete.

## Stage 1 — Income & Collections

- **A. Backend foundation.** `society_income_categories`, `non_member_payers`,
  `society_income_records`. Server functions, RLS, plan/role gating.
  _Status: implemented (originally Turn 18A)._
- **B. Read UI.** Income & Collections navigation entry, dashboard, filtered
  list, record detail. Read-only summaries, strict amount parsing.
  _Status: implemented (originally Turn 18B.1 / 18B.1A)._
- **C. Verify / reject / reverse + security.** Atomic transition RPC,
  entitlement-helper privacy, exact plan parity with `normalizePlan`, strict
  Zod result schema, non-enumerating `not_found` responses.
  _Status: implemented (originally Turn 18B.2 / 18B.2A / 18B.2B)._
- **D. Category management, payer directory, offline income entry.**
  Category CRUD screen, external-payer directory, three-step manual income
  entry, dashboard integration, plan/role gating, tests.
  _Status: in progress under this stage._
- **E. Reporting & closure.** Authoritative SQL dashboard aggregate,
  reconciliation foundation completion, direct PostgreSQL / runtime
  verification, complete Stage 1 visual consistency audit, final Stage 1
  release-readiness closure.

## Stage 2 — Society Setup & Migration

- A. Society onboarding & structure
- B. Blocks / towers / wings / floors / serial-number units
- C. Residents, family, occupancy, vehicles
- D. Team & Roles, privacy and approval permissions
- E. Excel / MyGate / ADDA / WhatsApp import + export + migration QA

## Stage 3 — Billing & Accounting

- A. Bill Studio & templates
- B. Recurring bills, dues, reminders
- C. Cash + Bank Transfer workflows
- D. Ledger, expenses, transparency, reports
- E. Accounting correctness + visual QA

## Stage 4 — Flat 360, No-Dues, Gamification

- A. Flat 360 core
- B. No-Dues certificate
- C. Trusted +2 on-time-payment points + leaderboard
- D. Permission-safe AI unit summary
- E. Runtime, security, visual closure

## Stage 5 — Complaints, Helpdesk, Approvals

A. complaints • B. assignments & conversations • C. service requests &
approvals • D. documents & timelines • E. SLA, notifications, QA

## Stage 6 — Visitors, Guards, Vehicles, Parking

A. visitors • B. guard access & sessions • C. approvals & history •
D. vehicle & parking • E. offline / mobile / security QA

## Stage 7 — Communication & Community

A. notices & announcements • B. polls & surveys • C. emergency
communication • D. push / email / in-app • E. archive, accessibility, QA

## Stage 8 — AI Secretary Knowledge Base

A. document ingestion • B. permission-aware retrieval •
C. cited answers • D. bill / notice / ledger / complaint assistance •
E. evaluation, safety, cost controls

## Stage 9 — AI Income Categorization & Reconciliation

A. taxonomy • B. AI suggestions • C. human approval •
D. bank-statement matching • E. reports & audit closure

## Stage 10 — Smart QR Collections

A. collection creation • B. QR generation • C. member + non-member
flow • D. allocations & reconciliation • E. gateway-ready security
closure

## Stage 11 — Super Admin & SaaS Operations

A. societies & approval • B. plans & subscriptions • C. support &
system health • D. audit, export, deletion, backup • E. SaaS analytics
and QA

## Stage 12 — Premium UI/UX System

A. unified design system • B. landing / login / onboarding •
C. all role dashboards & product screens • D. motion, accessibility,
loading, performance • E. every-screen responsive visual audit

## Stage 13 — Security & Reliability

A. full RLS + RBAC review • B. rate limits, validation, secrets,
dependencies • C. uploads, webhooks, safe errors •
D. backup / restore / offline / performance • E. full release audit

## Stage 14 — Final Payment Integration

A. Razorpay SociyoHub subscriptions • B. optional society-owned
gateway adapter • C. webhooks & idempotency • D. failures / refunds /
reconciliation • E. sandbox-to-live verification

## Stage 15 — Android & Play Store

A. app shell • B. push / camera / QR / files • C. offline / session
/ updates • D. signing, privacy, store assets • E. submission build

## Stage 16 — Launch Readiness

A. no-missing-feature audit • B. full role-based E2E • C. migration,
support, legal, docs • D. production deployment + monitoring •
E. final launch sign-off

## Product invariants (do not break)

- Public brand: **SociyoHub** (pronounced *So-see-oh Hub*).
- Tagline: *Society management, simplified.*
- Co-founders (equal): Meetarth Baldha, Divyaraj Vaghela. No CEO/CTO/sole
  founder / incorporation / trademark claims.
- Razorpay is used **only** for SociyoHub SaaS subscriptions.
- Maintenance = Cash + Bank Transfer. Non-member income = approved offline
  methods. No platform fee. No Paddle. No Stripe. No new online gateway
  outside Stage 14.
- Manual offline income begins as `pending` verification. Never labeled
  "Payment Successful" until the canonical verify workflow succeeds.
- MCP remains OAuth-protected and read-only. No service-role key in browser.
- Legacy internal identifiers (domain, storage keys, Firebase/Supabase IDs,
  migration filenames) are preserved even where the public brand renamed.
- The real society `baldha Meetarth`
  (`1907a918-c4b8-4f43-a837-450530cc7c34`) is never used or modified from
  code or tests.
