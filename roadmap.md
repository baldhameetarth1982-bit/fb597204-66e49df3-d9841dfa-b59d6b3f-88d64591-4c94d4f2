# Active roadmap

## Stage 17 — Security hardening

- [x] Inventory and threat-model authentication, public endpoints, uploads, AI, webhooks, financial/admin mutations, and exposed database functions.
- [x] Fix verified high-impact authorization, validation, rate-limit, replay, storage, error-redaction, and concurrency weaknesses with focused changes.
- [x] Add focused negative source contracts while preserving the existing tenant, webhook, AI-boundary, and financial-integrity regression suites.
- [x] Run database lint/security scans, dependency and bundle-secret scans, focused/full tests, type checking, and production build.
- [x] Close with fresh evidence and an explicit list of runtime checks that were unavailable.

## Stage 15 — Android and Google Play release preparation

- [x] Pin the SociyoHub TWA identity, production origin, version, branding, orientation, notifications, and Custom Tabs fallback.
- [x] Externalize Android signing and document one deterministic Bubblewrap release-build path.
- [x] Prepare fail-closed Digital Asset Links using the real Play signing fingerprint only.
- [x] Harden notification navigation and clear account-scoped browser state across account changes.
- [x] Verify mobile safe areas, touch targets, reduced motion, auth continuity, payment boundaries, release assets, and repository secrets.
- [ ] Owner-only external dependency: generate and sign the AAB with Android tooling, then upload it to Google Play Console.

## Stage 14 — Razorpay SaaS subscription payments

- [x] Preserve Cash and Bank Transfer-only society maintenance payments and zero platform fees.
- [x] Add idempotent subscription order creation, canonical capture, durable webhook replay records, and receipts.
- [x] Add authorized history, delayed confirmation recovery, audited pending-order cancellation, and Super Admin refunds.
- [x] Add focused lifecycle, tenant-boundary, maintenance-isolation, and secret-boundary tests.
- [x] Record final typecheck, build, full-suite, security-linter, and bundle-secret evidence.
- [x] Close the approved subscription-only scope without starting Stage 15 or enabling a maintenance gateway.

## Stage 13 — Final security and reliability closure

- [x] Review privileged database functions, grants, and tenant authorization.
- [x] Close verified rate-limit and server-validation gaps.
- [x] Review financial, payment, storage, AI, audit, error, race, and recovery boundaries.
- [x] Add 13 deterministic Flat 360 Society A/B service-boundary tests and activate the seven deferred source/SQL contract checks.
- [x] Run focused security, XLSX, full unit/integration, type, and bundle-secret checks.
- [x] Verify no Docker-free isolated backend exists, remove trusted-role authorization from Flat 360, and enforce the RLS/RPC boundary with executable migration/source contracts.
- [x] Record honest unavailable runtime/provider checks; do not begin Stage 14.

## Stage 12 — Premium UI/UX

- [x] Unify shared design tokens, typography, controls, panels, dialogs, tables, and motion.
- [x] Refine app shells and role navigation across mobile and desktop.
- [x] Fix stale public/auth claims and inconsistent sign-in presentation.
- [x] Refine representative dashboards and remaining legacy visual patterns.
- [x] Validate responsive layouts, accessibility, runtime, and build health.

- [x] Audit the current Stage 3D tree against Prompt #36.
- [x] Correct resident transaction signs, explicit active-resident authorization, and audit immutability.
- [x] Expand disposable authorization, audit-integrity, and canonical payment-state verification without changing Stage 3C.
- [x] Complete metadata for the affected finance routes only.
- [x] Run all locally available Stage 3D, Stage 3C-preservation, build, type, migration, and secret validations.
- [x] Make every Stage 3D runtime entry point fail closed on missing or skipped evidence.
- [ ] Observe fresh-reset 11/0/0 runtime and authenticated visual/accessibility evidence.
- [x] Record exact evidence and blockers; keep Stage 3E not started.
- [x] Restore audit-log immutability for every database role with an additive terminal migration.
- [x] Separate the Stage 3D live opt-in and exact 11-case gate from Stage 3C.
- [x] Re-run locally available Stage 3D and Stage 3C-preservation validations.
- [x] Record current evidence honestly; keep Stage 3E unstarted.
- [x] Remove Stage 3D's hidden Stage 3C opt-in through a neutral disposable-runtime guard.
- [x] Preserve the Stage 3C 93-case source contract and independent workflow opt-in.
- [x] Apply the terminal audit lock through the managed database migration path (`0011`) without rewriting history.
- [x] Restrict direct audit-log append access to the canonical server-side role through managed migration `0012`.
- [x] Reconcile the managed production migration track with the CLI fresh-reset `supabase/migrations/` replay track through one forward-only equivalent security migration.
- [x] Remove immutable audit history from fixture cleanup obligations and reject direct or obvious indirect audit-cleanup bypasses.
- [x] Split Stage 3C and Stage 3D CI into independent disposable database jobs.
- [x] Bind exact Stage 3D runtime reports to the expected full commit SHA.
- [x] Require callers to supply the expected SHA; remove stale generated reports and run fixture safety checks in both local and CI preflights.
- [x] Add the smallest forward-only fresh-reset migration that converges the final Stage 3D authorization and audit-security state.
- [x] Add positive cross-track security assertions and rerun all locally available Prompt #45 verification gates.
- [x] Record only observed fresh-reset/runtime evidence and keep Stage 3E unstarted.
- [x] Remove the unused non-atomic income transition path and retain only the canonical transactional RPC.
- [x] Add semantic audit RLS, privilege, append-boundary, resident-authorization, and cross-society source checks.
- [x] Correct the master roadmap to show Stage 3D as implemented_unverified and Stage 3E unstarted.
- [x] Converge managed and fresh-reset audit TRUNCATE denial through forward-only migrations and positive source checks.
- [x] Add an executable Stage 3D external runtime handoff and require fixture-source validation in its independent CI job.

## Full-app button sweep (requested 2026-09-27)
- [x] Society admin: every screen opens without errors (demo society "QA Demo Society (test only)")
- [ ] Society admin: press every button/form on each screen
- [ ] Resident: switch test account to resident in demo society, sweep screens + buttons
- [ ] Guard: switch test account to guard, sweep
- [ ] Super admin: needs owner approval to grant super admin to test account

## Society OS complete expansion (requested 2026-09-28)
- [x] Reconcile the uploaded 53-module brief against current canonical systems and approved product decisions.
- [x] Stabilize Amenities and tenant/society-switch foundations (Workstream 1 closed; guard live check external).
- [ ] Implement every safe in-platform gap without duplicate society, finance, visitor, notification, AI, migration, or export systems.
- [ ] Complete focused security, role/plan, finance, offline, accessibility, responsive, and release verification.
- [ ] Report external hardware/provider and owner-only release dependencies honestly.

## Workstream 2 — Resident, unit & tenant lifecycle
- [x] Derived lifecycle states, renew / move-out / early end / archive with server checks and audit
- [x] No-Dues-gated move-out with reasoned override; scheduled move-outs end access via daily job
- [x] Idempotent renewal reminders on the existing scheduler; configurable warning days
- [x] Flat 360 occupancy panel, residents Tenancies tabs, resident Easy view
- [x] Live checks (self-rolled-back, QA Demo Society)
- [x] Legacy "End relationship" limited to audited admin correction (reason, permission, dues-blocked)
- [x] Returning to the same flat creates a new record; overlapping active occupancy blocked
- [x] Preview look at Flat occupancy panel and Residents → Tenancies (QA admin, read-only)
- [ ] Guard live check — blocked: no legitimate guard account

## Workstream 3 — Gate, visitor, parking & safety
- [x] Recurring passes, movers/vendors/staff, restricted list, committee decisions, overrides with reason, incidents, overstay, visitor parking, SOS, bounded offline guard queue (rollback-tested in QA Demo Society)
- [ ] Live guard-account check — blocked: no legitimate guard account exists

- [x] Workstream 4 Operations & Facilities — built, server-tested and preview-checked; attachment click-through unavailable because the authorized demo society has no Helpdesk ticket and no supported safe attachment-deletion path; resident/staff previews unavailable without legitimate accounts

## Workstream 5 — Procurement & Budgets
- [x] Procurement workflow + server transitions, separation of duties, audit (rollback-tested)
- [x] Budgets with revision history; actuals from posted expenses (rollback-tested)
- [x] Auditor Pack procurement/budget section + CSV
- [x] Quotation/invoice file attachments — private storage, stage-locked, reasoned soft-remove, audit (rollback-tested); live file click-through not done (no genuine demo record)
- Workstream 5 COMPLETE. Workstream 6 not started.
- [x] Preview check of Purchases/Budgets screens (phone + desktop, no errors/overflow)
