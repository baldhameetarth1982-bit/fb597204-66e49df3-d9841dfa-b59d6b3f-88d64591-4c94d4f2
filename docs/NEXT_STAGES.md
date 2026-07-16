# Next Stages

## Immediately after Stage 3A closes

### Checkpoint F — Flat 360
Upgrade `src/routes/_society/society.flats.$id.tsx` in place (no duplicate route). Sections: Identity + Occupancy, Financial Summary, Occupancy History, Operations (vehicles, visitors, documents, approvals), No-Dues status, Deterministic Unit Summary + Lovable-AI Summary (Pro-gated, cached/rate-limited, deterministic fallback on failure). Real data only; honest empty states.

### Checkpoint G — No-Dues workflow (Pro)
- Migration (additive): `no_dues_requests`, `no_dues_certificates`, `no_dues_audit`, `check_no_dues_eligibility(unit_id)` RPC. RLS scoped to society + owner; server-side transitions only.
- Storage: private bucket `no-dues-certificates`.
- Server fns in `src/lib/no-dues.functions.ts`: `submitNoDuesRequest`, `reviewNoDuesRequest`, `approveAndIssue` (idempotent), `rejectRequest`, `revokeCertificate`, `listMyRequests`, `listSocietyRequests`. Certificates via `pdf-lib` + `qrcode`.
- Public route: `src/routes/api/public/verify/no-dues.$token.ts` (JSON, minimum data).
- Public page: `src/routes/verify.no-dues.$token.tsx`.
- Society Admin UI: `/society/no-dues`, `/society/no-dues/$id`.
- Resident UI: `/app/no-dues`, `/app/no-dues/$id`.

### Checkpoint H — Gamification (Pro)
- Migration (additive): `payment_points_ledger` (unique on `payment_id`), `society_settings.gamification_enabled`.
- Server fn awarding 2 points on verified on-time payment; reversal handling.
- Leaderboard route already exists — wire it to the new ledger.

### Checkpoint J — Whole-app visual parity
Iterate every route in the "Not touched in Stage 3A" section of `UI_REFERENCE_MAP.md`. Route-level visible changes required. Reference screenshots (user-provided) are source of truth; where absent, use SociyoHub tokens + primitives.

## Stage 3B — Non-Member Payments, AI Income Categorization, Reconciliation
All Pro. Feature keys: `non_member_payments`, `ai_income_categorization`, `reconciliation`.

## Stage 3C — AI Secretary / Society Knowledge Base
Pro. Document upload, indexing, source-cited answers from society-uploaded docs only. Feature key: `ai_secretary`.

## Stage 3D — Universal Smart QR, low-risk migration, privacy/transparency controls
All Pro. Feature keys: `smart_qr_collections`, `migration`, `privacy_controls`.

## Stage 3E — Premium enhancements
Advanced AI limits, deeper automation, advanced forecasting, custom branding, higher usage caps, priority support. Premium differentiation lives here — **not** by removing Pro workflows.

---

## Stage 4 — Remaining Feature Completion
Complaints/helpdesk, documents, approvals, notifications, communication, imports/exports, advanced reports across resident/admin/guard/super-admin.

## Stage 5 — Production Security Hardening
Dependency audit, secrets audit, endpoint rate limiting on remaining surfaces, strict schema validation, RLS penetration tests, upload security, audit logs, backups/recovery, export/deletion, session/device security.

## Stage 6 — UI/UX, Accessibility, Performance
Whole-app usability sweep, WCAG-level accessibility, performance budget, offline/error/empty/loading states, user onboarding polish, old-age-friendly usability.

## Stage 7 — Android / Play Store Readiness
PWA vs native wrapper decision, app icons, splash, deep links, notification permissions, Privacy/Data Safety forms, account deletion, legal pages, crash monitoring, release build, internal/closed testing.

## Final Stage — Payment Integration
Payment-provider review, live gateway integration, webhook verification, reconciliation, failure/refund handling, production payment testing. **Absolutely no payment activation before this stage.**

---

**Roadmap Lock:** Payment integration MUST remain the final stage. Any earlier
stage that touches payment activation, platform fees, or replaces
Cash + Bank Transfer maintenance behavior violates the lock. See
`docs/RELEASE_READINESS.md` for permanent rules.

---

## Stage 3B — Turn 18A status (2026-07-15)

Backend foundation for Non-Member Payments landed:

- Tables `society_income_categories`, `non_member_payers`, `society_income_records` (additive, admin-only RLS).
- Server functions in `src/lib/non-member-income.functions.ts` with strict Pro/Premium gating.
- 25 new unit tests; integration matrix scaffolded but honestly skipped without isolated fixtures.

Next (Turn 18B): Society Admin UI for categories, payers, income entry + verification/reversal, and Reports wiring. Still no online payment gateway.
Later Stage 3B turns: AI Income Categorization (server-side, Pro), Universal Smart QR, Reconciliation import.

## Stage 1E — completed

Authoritative SQL income reporting (`get_society_income_report`),
manual reconciliation foundation (`transition_income_reconciliation`
with atomic `audit_log`), server-paginated payer directory
(`list_non_member_payers_page`), and dashboard/detail UI wired to the
new sources. Verification and reconciliation are strictly independent
state machines. All privileged RPCs revoke PUBLIC/anon and grant
`authenticated` only.

**Preview inspection (Stage 1E):** Rendered preview inspected at 360,
390, 414, 768, and 1280 CSS widths for: Income dashboard populated,
dashboard empty, report loading, filtered record list, record detail
with reconcile / undo-reconciliation dialogs (verification note
visible), category page, payer page, Basic locked, and role denied.
No horizontal overflow, ₹ values not clipped, dialogs fit mobile,
44px touch targets on all primary actions, status pills distinguished
by shape+label (not color alone). Reduced motion respected.

**Non-critical debt deferred to Stage 13:**

- Optional server-side CSV export of the SQL report (no safe export
  subsystem exists yet).
- `needs_review` and `partially_matched` still surface but Stage 1E
  only ships the manual `matched` ↔ `unreconciled` transitions.
- Real bank-statement import, Smart QR, and AI auto-matching remain
  future stages.

## Next: Stage 2A — Society Structure Audit and Canonical Setup Model


---

# Stage 2A — Society Structure Audit and Canonical Setup Model — COMPLETE

**Canonical model:** `public.societies`, `public.blocks`, `public.flats` are the
authoritative structure/unit tables. `public.hierarchy_nodes` is retained for
backward compatibility only — it must not be a new independent write source.

## Migration (additive, safe)

- `societies.structure_mode` — `'structured' | 'serial'`, nullable for legacy.
- `blocks`: added `structure_kind` (`block|tower|wing`), `is_active`,
  `display_order`, generated `normalized_name`. Unique index
  `blocks_society_normalized_name_uidx` (society + normalized name).
- `flats`: `block_id` is now nullable; added `is_active`, `display_order`,
  generated `normalized_label`. Partial unique indexes:
  - structured — `(society_id, block_id, normalized_label)` where `block_id IS NOT NULL`
  - serial — `(society_id, normalized_label)` where `block_id IS NULL`
- Trigger `flats_enforce_structure_mode`:
  - structured → block_id required, block must belong to same society and be active.
  - serial → block_id must be NULL; floor forced NULL.
  - NULL mode → permissive (legacy).
- `commit_society_wizard` updated: sets `structure_mode`; serial layout writes
  units with `block_id = NULL` (no more synthetic "Houses" block).

## Authoritative RPCs (SECURITY DEFINER, REVOKE PUBLIC/anon, GRANT authenticated)

- `get_society_structure_overview(_society_id)`
- `configure_society_structure_mode(_society_id, _mode)` — blocks unsafe conversions.
- `list_society_units_page(...)` — server search / block / floor / unit_type / active filters, limit ≤ 100, default 25.
- `create_society_unit`, `update_society_unit`, `set_society_unit_active`, `set_society_block_active`.

## Authorization
- Society Admin & Super Admin only for their society (`is_society_admin_for` / `is_super_admin`).
- Block Admin / Resident / Guard / anon denied.
- Cross-society IDs return non-enumerating `{ ok: false, reason: 'not_found' }`.
- Fixed `SET search_path = public` on every new SECURITY DEFINER function.

## UI wiring (existing routes only — no duplicate navigation)
- `society.setup.tsx` — step 1 now offers the canonical Structured/Serial chooser,
  calls `configure_society_structure_mode`, and displays the live overview.
- `society.blocks.tsx` — hides itself in serial mode and points users to Units.
- `society.flats.tsx` — server-paginated unit list (25/page, ≤100), search + block
  filter, respects mode (hides block/floor fields in serial), gated on
  "Structure setup required" when unconfigured.
- `onboarding.create.tsx` — unchanged UI; the wizard payload now always writes
  canonical `blocks`/`flats` and sets `structure_mode`.

## Legacy data safety
- No automatic mode inference for ambiguous societies; they remain NULL and see
  "Structure setup required".
- Existing IDs, unit names, block names, and hierarchy_nodes rows are preserved.
- Conversion between structured ↔ serial with existing units is blocked
  (`reason: 'conversion_blocked_units_exist'`).

## Verification
- `bunx tsgo --noEmit` — clean.
- `bunx vitest run tests/unit` — **430/430 passing** (added focused
  `tests/unit/society-structure.test.ts`).
- `bun run build` — succeeded.
- `bun scripts/verify-client-bundle-secrets.ts` — OK, no server-only indicators.
- 390 px / 1280 px smoke: mode chooser, structured Units list, serial Units
  list, add-unit dialog, and serial-mode Blocks redirect all render without
  horizontal overflow; primary CTAs are ≥ 44 px minimum height.
- Protected society `1907a918-c4b8-4f43-a837-450530cc7c34` — **untouched**.

## Deferred (intentionally, per Stage 2A scope)
- Bulk unit generation → Stage 2D/2E.
- Full onboarding/import migration QA → Stage 2E.
- Product-wide premium redesign → Stage 12.
- Broad RLS/RBAC re-audit → Stage 13.
- Multi-breakpoint launch audit → Stage 16.

**Next:** Stage 2B — Residents, Family Members, Occupancy and Vehicles.
