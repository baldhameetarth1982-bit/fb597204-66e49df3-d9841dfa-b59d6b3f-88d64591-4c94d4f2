# SocioHub — Release Readiness (Source of Truth)

**Every future agent MUST read this file before claiming release status.**

## Permanent Rules

1. **No feature, security requirement, release requirement or Play Store
   requirement may be marked complete without implementation evidence AND test
   evidence. Typecheck alone is not completion.**
2. **Payment gateway and live payment integration remain the final
   implementation stage.** Earlier stages may prepare safe abstractions and UI
   placeholders but MUST NOT activate or replace payment providers, add
   platform fees, or change Cash + Bank Transfer maintenance behavior.
3. **Real production data (society "baldha Meetarth" etc.) is never modified
   for testing. Use ephemeral fixtures and clean them up.**

## State Vocabulary

- `not_started` — no code exists
- `partial` — some code, not usable end-to-end
- `implemented_unverified` — code exists, typecheck passes, no runtime test
- `tested` — automated or scripted runtime tests pass
- `security_verified` — RLS/authz penetration checks passed
- `visually_verified` — screenshot/Playwright parity checks passed
- `release_ready` — all above plus docs, monitoring, and rollback plan
- `blocked` — waiting on a missing secret, service, or decision

## Section Checklists

### 1. Approved Feature Delivery
| Feature | State | Evidence |
|---|---|---|
| Auth (Firebase → Supabase) | tested | Migrated Turn ≤ Stage 2 |
| Onboarding (create/join) | implemented_unverified | — |
| Maintenance (Cash + Bank Transfer only) | implemented_unverified | — |
| Bills / Ledger | implemented_unverified | — |
| Visitors / Guard | implemented_unverified | — |
| Announcements / Notices / Polls | implemented_unverified | — |
| No-Dues (workflow + verification) | implemented_unverified | Canonical DB eligibility fn `compute_no_dues_eligibility_internal` (service_role only). Submit/transition/finalize RPCs no longer accept `_eligible`/`_snapshot` from callers — each recomputes in-transaction. Runtime authz/eligibility/concurrency tests still pending. |
| No-Dues detail routes | implemented_unverified | `/society/no-dues/$id` and `/app/no-dues/$id` render request, blockers, timeline, certificate actions. Visual verification pending. |
| Flat 360 | not_started | Existing `/society/flats/$id` to be upgraded |
| Gamification | not_started | — |
| Feature Directory | implemented_unverified | — |

### 2. Backend Implementation
- Server functions via `createServerFn` — ✅ in use
- `_internal` RPCs receive trusted `_actor_id` from server session — ✅ No-Dues
- Service-role EXECUTE only on privileged RPCs — ✅ No-Dues
- Canonical DB-level eligibility function (`compute_no_dues_eligibility_internal`) — ✅ migrated Turn 8 (service_role only; unpaid/overdue/partial bills, pending cash + bank transfer payments, cancelled bills excluded, per-bill remaining = amount − sum successful payments, clamped ≥ 0)
- Atomic rate limiter (`touch_rate_limit` RPC) — ✅
- Never `auth.uid()` inside service-role RPC — ✅

### 3. Frontend Implementation
- Feature-gated routes via `FeatureGate` — ✅
- Mobile-first hero/section pattern — ✅
- No-Dues detail routes (`/society/no-dues/$id`, `/app/no-dues/$id`) — **not_started**

### 4. Multi-Tenant RLS/Security
- Every `public` table has explicit `GRANT` + RLS — audit pending
- `user_roles` in separate table with `has_role()` SECURITY DEFINER — ✅
- Society isolation checks in all eligibility/dues code — pending canonical DB fn
- Storage buckets private + short-lived signed URLs — ✅ no-dues-certificates
- Public verification endpoint returns identical shape for malformed/unknown — ✅

### 5. Advanced Production Security
- `RATE_LIMIT_HMAC_SECRET` required in production, fails closed — ✅ (Turn 7)
- Dual rate-limit buckets (general + invalid attempts) — ✅ (Turn 7)
- Raw IPs never stored (HMAC fingerprint) — ✅
- Raw verification tokens never logged — ✅
- Webhook signature verification (Razorpay) — implemented_unverified
- Endpoint-level input validation with Zod — ✅ where applied
- Content Security Policy — not_started
- Dependency audit (`bun audit`) — not_started
- RLS penetration tests — not_started
- Secrets scan of git history — not_started

### 6. Full UI/UX Usability
- Empty/loading/error states across every route — partial
- Old-age-friendly font sizing / contrast — not_started

### 7. Accessibility
- Focus states, ARIA labels, semantic landmarks — partial
- Keyboard navigation across critical flows — not_started

### 8. Performance
- Route-level code splitting — ✅ via TanStack
- Image lazy loading — partial
- Query staleness / cache tuning — partial
- Lighthouse ≥ 90 (published) — not_started

### 9. Automated Testing
- `tests/billing-cron.test.mjs` — exists
- Vitest unit coverage — minimal
- Playwright end-to-end flows — not_started
- No-Dues authz tests (deny anon RPC, deny cross-society admin, etc.) — not_started

### 10. Manual QA
- Full role matrix walk-through — not_started

### 11. Play Store Readiness
- PWA / native wrapper decision — not_started
- App icons + splash + adaptive icon — not_started
- Deep links — not_started
- Notification permissions flow — not_started
- Privacy / Data Safety form — not_started
- Account deletion flow — not_started
- Legal pages complete — partial

### 12. Privacy / Legal
- Terms + Privacy + Refund + GDPR — partial
- Export user data endpoint — not_started
- Delete user data endpoint — not_started

### 13. Monitoring / Backups / Recovery
- Error capture (`src/lib/error-capture.ts`) — implemented_unverified
- Uptime + latency dashboards — not_started
- DB backup schedule verified — not_started
- Restore drill — not_started

### 14. Final Payment Integration (LAST STAGE)
- **Not to be touched before Final Stage.** Existing Razorpay subscription
  path is preserved as-is.

### 15. Production Launch
- Rollback plan documented — not_started
- Feature-flag kill switches — not_started
- Post-launch on-call rota — not_started

## Update Rule

After every development turn, edit this file to reflect newly `tested` /
`security_verified` / `visually_verified` items. Never downgrade evidence;
never mark `release_ready` without linked commit + test output.

## Turn 9 update (2026-07-14)

**No-Dues eligibility v2**
- `compute_no_dues_eligibility_internal` rewritten: each bill appears at most once in the blocker list, with `primary_type` + `overdue`/`inconsistent`/`unknown_status`/`payment_state` flags. Deterministic ordering: overdue first, then earliest due date, then bill number.
- Bills marked `paid` with `remaining > 0` (or with an unknown-status payment) now surface as `financial_data_inconsistency` for admin review instead of silently certifying.
- Pending offline payments (all methods) remain a separate blocker (`pending_offline_payment`).
- Invalid flat/society pairs raise a server-side error rather than pretending the flat has dues.
- Grants: `service_role` only. `anon`/`authenticated` execution revoked (verified via last migration).

**Observed schema (via `psql \d`, `SELECT DISTINCT`)**
- `payments.status`: only `success` observed. Constraint permits any text (no CHECK on status). Function still classifies `success` / `pending` / `failed|rejected|cancelled|refunded|reversed` explicitly; anything else is treated as "unknown_status" and blocks with `financial_data_inconsistency`.
- `payments.method`: only `cash` observed. Constraint (`payments_method_chk`, NOT VALID) permits `razorpay | manual | online`. Eligibility no longer filters by method — any `status='pending'` row is a blocker regardless of method (defensive against wider method vocab used elsewhere in the app).
- `bills.status`: `paid`, `unpaid`, `cancelled`.
- **Source of truth chosen:** Remaining amount from valid payments is authoritative for balance. Bill `status='paid'` is treated as a *hint*, not the truth: if `remaining > 0`, we emit `financial_data_inconsistency` — never silently certify.

**UX**
- Human labels for status, audit actions, and every blocker type live in `src/lib/no-dues-labels.ts`. No raw identifiers (`pending_bank_transfer_payment`, `finalize_blocked`, …) reach the UI.
- Currency formatted via `formatCurrency` (₹, en-IN grouping).
- Resident + admin detail pages: friendly status explanation, structured blocker cards with resolution guidance, timeline with human action labels, copy-verify-link button for issued certificates.
- **Not yet done this turn:** AlertDialog wrappers for approve/reject/issue/revoke (dialogs still inline Textareas). Deferred to Turn 10.

**Flat 360**
- Typed data service added: `src/lib/flat360.functions.ts` → `getFlat360({ flatId })`.
- Society isolation enforced, auth: society admin/manager or active resident of the flat.
- Bundles: flat, society, occupants, family, vehicles, recent bills, recent payments, No-Dues eligibility (canonical), latest No-Dues request, latest certificate.
- Visitors/approvals scaffolded with honest zero counts pending further schema audit.
- Typecheck: **pass**.

**Verification not performed this turn (honest gaps)**
- Production `vite build` not executed (sandbox constraints).
- Runtime authorization matrix (service_role vs authenticated vs anon vs cross-society) not executed — deferred until a safe test-only fixture harness is defined that cannot touch real society data.
- Concurrency / idempotency tests (parallel issuance, rollback on audit failure) not executed.
- Rate-limit threshold tests (30/60s general, 10/60s invalid) not executed.
- Client-bundle secret leak scan not executed.

Anything marked `implemented_unverified` remains so until the above are executed.

**Confirmations**
- No payment integration changed. Razorpay untouched. No platform fee added. Cash + Bank Transfer maintenance flow preserved.
- No real society data modified. Firebase → Supabase auth flow untouched.

## Turn 10 — 2026-07-14

### Fixed
- **Eligibility double-count** (correctness): DB function `compute_no_dues_eligibility_internal` v3 now returns `total_outstanding` = bill remaining balances only, plus a separate informational `pending_payment_total`. Pending offline payments no longer inflate the outstanding total.
- **Missing role helpers** (critical runtime bug): `is_society_admin_for(_user_id, _society_id)` and `is_super_admin(_user_id)` were referenced by No-Dues admin auth and `payouts.functions.ts` but did not exist in the database — every admin authorization was silently failing. Both helpers are now defined (SECURITY DEFINER, scoped via `user_roles.society_id`) and executable by `authenticated`/`service_role` only.
- **Flat 360 authorization**: `getFlat360` no longer grants access on a broad `has_role(_,'admin')` global check. It authenticates the user, derives `society_id` from the flat, and requires one of: society-scoped admin (`is_society_admin_for`), super_admin, or an active resident of that flat. A viewer discriminator (`society_admin | super_admin | resident`) is returned for downstream UI decisions.
- **Flat 360 PII minimization**: default projection drops resident `phone`/`email` and family `dob`. Retained: display name, relationship, occupancy dates, vehicle plate.
- **Flat 360 honest section states**: `visitors`/`approvals`/`complaints`/`documents` return `{ status: "unsupported" }` instead of hardcoded `0` counts (a `0` falsely implied "no visitors ever").
- **Eligibility TypeScript shape** aligned with DB result (adds `pending_payment_total`).

### Verified this turn
- `bunx tsgo --noEmit` clean.
- Migration applied successfully. Pre-existing linter warnings on unrelated SECURITY DEFINER functions unchanged.

### Deferred (state: implemented_unverified / not_started)
- **Verification-link encryption**: encryption-at-rest for raw verification tokens + `getCertificateVerificationLink` server fn is NOT implemented. Certificate PDFs still embed the raw token via QR at issuance; there is no post-issuance recovery path. Requires `CERTIFICATE_TOKEN_ENCRYPTION_KEY` secret + additive migration.
- **Admin/resident dialogs** (Approve/Reject/Issue/Revoke/Resubmit): current UI uses buttons + toasts, no confirmation dialogs.
- **Flat 360 UI upgrade** of `/society/flats/$id`: still using the pre-Flat-360 direct-query layout; server function is upgraded but the route has not been switched over.
- **Deterministic + AI summary**: not implemented.
- **Integration test infrastructure** (`tests/integration/*`, CI workflow, client-bundle secret scanner): not created. No local Supabase test project available in this sandbox.
- **Runtime authorization matrix / eligibility scenarios / rate-limit thresholds**: not executed.
- **Pending-payment classification module** (settled / pending_offline_verification / pending_online / invalid / unknown centralization): DB function treats all `status='pending'` as pending offline; a dedicated classifier is not extracted.

### Constraints honored
- No payment integration changes. Razorpay untouched. No platform fee. Cash + Bank Transfer maintenance preserved. No real society data modified. Firebase→Supabase auth preserved. Flat 360 remains Pro (FeatureGate not touched).

## Turn 11 — 2026-07-14 (partial slice, honest)

Focused, narrow slice this turn — the full Turn 11 spec covers ~20 major work areas (dialogs, resubmit, full Flat 360 UI, deterministic + AI summaries, verification-link decrypt fn, test infra, CI, screenshots, runtime tests, doc sweeps) and cannot be truthfully completed in a single turn. What actually changed:

### Delivered
- **Role-helper security redesign (schema).** New internal (service_role only) trusted-actor helpers `is_society_admin_for_internal(_actor_id, _society_id)` and `is_super_admin_internal(_actor_id)`; new authenticated self-check wrappers `current_user_is_society_admin_for(_society_id)` and `current_user_is_super_admin()` that only reveal the caller's own permission (auth.uid()). Old arbitrary-user helpers `is_society_admin_for(_user_id, _society_id)` and `is_super_admin(_user_id)` are now REVOKED from `authenticated` (service_role only) — account-role probing from client sessions is no longer possible.
- **Flat 360 admin service hardened.** `getFlat360` now denies residents entirely (previously returned `viewer: "resident"` with the admin projection) and uses the new `_internal` trusted-actor helpers via `supabaseAdmin`. `Flat360Viewer` type is now `"society_admin" | "super_admin"` only.
- **Certificate encryption schema (additive).** `no_dues_certificates` gained `verification_token_ciphertext`, `verification_token_iv`, `verification_token_key_version`. Purely additive — no backfill, no drops, no impact on existing rows or existing PDF/QR flows.
- **Encryption key provisioned.** `CERTIFICATE_TOKEN_ENCRYPTION_KEY` generated (64 chars, server-only). No code reads it yet.

### Deferred to next turn(s) — NOT done this turn
- Verification-link recovery server function (`getCertificateVerificationLink`) — schema and key are in place; the encrypt-at-issuance + authorized-decrypt server code is not written yet.
- Encrypt-at-issuance wiring inside `finalize_no_dues_issuance_internal` / issuance server function.
- No-Dues Approve/Reject/Issue/Revoke AlertDialog wrappers.
- Resident "Recheck and Resubmit" flow for `blocked_by_dues`.
- Full `/society/flats/$id` Flat 360 UI (identity, occupancy, financial, occupancy history, vehicles, visitors, complaints, documents, approvals, notices, no-dues, deterministic summary, AI summary).
- Deterministic Unit Summary implementation.
- Pro-gated server-verified AI Summary (Lovable AI Gateway) with rate-limit + snapshot-hash cache + timeout + injection-safe prompt.
- Integration test infrastructure (`tests/integration/*`), CI workflow, client-bundle secret scanner.
- Runtime role/certificate/no-dues/flat-360/AI test matrix.
- Multi-viewport screenshot verification (360/390/414/1280).
- Documentation sweep across `SECURITY_REQUIREMENTS.md`, `FEATURE_MATRIX.md`, `UI_REFERENCE_MAP.md`, `NEXT_STAGES.md`, `SOCIOHUB_MASTER_CONTEXT.md`, `DEVELOPMENT_HISTORY.md`.
- Migration to remove/backfill the legacy plaintext `verification_token` column on `no_dues_certificates` (still present; not read by new code paths, but a follow-up migration should backfill encrypted columns from it and then drop it).

### Verification this turn
- `bunx tsgo --noEmit` — passes.
- Migration applied cleanly; linter warnings surfaced are pre-existing SECURITY DEFINER catalog signals, unchanged in scope by this migration.
- No production build, no runtime tests, no screenshots executed this turn.

### Constraints honored
- No payment integration changes. Razorpay untouched. No Cashfree/PayU activation. No platform fee. Cash + Bank Transfer maintenance behavior preserved. No real society data modified. Firebase→Supabase auth preserved. Flat 360 remains Pro; Premium inherits.


## Turn 12 — Role-Scope Correction, Certificate Encryption Wiring, UX Recheck

Status of items landed:

- **Block-admin scope fix (implemented)**: `is_society_admin_for_internal` now
  requires `role = 'society_admin'`. Added `is_block_admin_for_flat_internal`,
  `can_manage_flat_internal`, `current_user_can_manage_flat`.
  All No-Dues review / issue / revoke / detail / download paths now authorize
  via `can_manage_flat_internal(actor, flat_id)` instead of society-wide.
- **Old role-probe helpers revoked (implemented)**: `is_society_admin_for(uuid, uuid)`
  and `is_super_admin(uuid)` EXECUTE removed from `anon` and `authenticated`.
- **Certificate encryption wiring (implemented)**:
  - `src/lib/certificate-token.server.ts` — AES-GCM via Web Crypto, 32-byte key
    from `CERTIFICATE_TOKEN_ENCRYPTION_KEY` (hex-64 or base64 of 32 bytes),
    12-byte random IV per certificate, key-version tag.
  - `finalize_no_dues_issuance_internal` replaced to accept
    `_verification_token_ciphertext`, `_verification_token_iv`,
    `_verification_token_key_version`; recomputes eligibility and authorizes
    via `can_manage_flat_internal` inside the transaction.
  - `no_dues_certificates.verification_token` is now nullable; new
    certificates store encrypted-only (no plaintext).
  - `issueNoDuesCertificate` no longer returns the raw verification URL by
    default — clients call `getCertificateVerificationLink` instead.
- **Authorized verification-link recovery (implemented)**:
  `getCertificateVerificationLink` — decrypts server-side after checking
  requester-or-flat-manager authorization; returns `{ available: false,
  reason: "legacy_token_unavailable" }` for hash-only legacy certificates.
- **Resident recheck & resubmit (implemented)**:
  `recheck_no_dues_request_internal` DB RPC + `recheckAndResubmitNoDues`
  server fn (rate-limited 5/10 min per user+request). Only `blocked_by_dues`
  requests can transition; DB recomputes eligibility, never trusts client
  snapshot.
- **UI**:
  - Society detail: verify link now fetched via authorized server fn (no more
    fabricated `cert.verification_url`).
  - Resident detail: same server fn + "Recheck and resubmit" button for
    `blocked_by_dues`, with friendly messaging for still-pending dues.

### Still deferred / not yet delivered this turn

- Full AlertDialog wrappers on approve / reject / issue / revoke (current UI
  keeps inline textareas + confirm buttons; destructive semantics preserved).
- Runtime authorization matrix and encryption-tampering tests (documented,
  test harness not yet added).
- Legacy plaintext-token backfill script gated by
  `ALLOW_CERTIFICATE_TOKEN_BACKFILL=true`.
- Base-table certificate SELECT hardening (safe view + revoke direct SELECT).

### Constraints preserved

- No payment integration changes; Razorpay untouched; Cash + Bank Transfer
  workflow untouched; no platform fee added.
- No real society financial records modified — only schema functions and a
  nullable-column relaxation on `no_dues_certificates.verification_token`.
- Firebase→Supabase auth architecture unchanged.
- Flat 360 remains Pro; Premium continues to inherit all features.

---

## Turn 13 — Function ACL hardening + token integrity check

### Delivered

- **Function ACL hardening migration** applied. Additive, idempotent
  REVOKE/GRANT pass over every No-Dues / Flat 360 helper:
  - Internal trusted-actor + privileged mutation RPCs (`*_internal`,
    `touch_rate_limit`, legacy `is_society_admin_for`, `is_super_admin`) —
    REVOKE from PUBLIC/anon/authenticated, GRANT EXECUTE to `service_role`
    only.
  - Current-user wrappers (`current_user_is_society_admin_for`,
    `current_user_is_super_admin`, `current_user_can_manage_flat`) — REVOKE
    from PUBLIC/anon, GRANT EXECUTE to `authenticated` + `service_role`.
  - Verified via `pg_proc.proacl` before migration; belt-and-suspenders even
    where defaults already matched.
- **Decrypted-token integrity check** in `getCertificateVerificationLink`:
  1. Format-validates recovered raw token (`^[A-Za-z0-9_-]{32,128}$`).
  2. SHA-256 hashes the recovered token and constant-time compares
     (`node:crypto.timingSafeEqual`) against stored `verification_token_hash`.
  3. Returns `{ available: false, reason: "integrity_check_failed" }` on
     mismatch, malformed token, or hash error — no URL leaked, no
     hash/token logged.
  Protects against ciphertext copied between rows, mismatched fields,
  corrupted legacy backfill.
- **Public app origin validated** (`resolvePublicAppOrigin`): production
  requires `PUBLIC_APP_URL` (HTTPS, non-localhost). Missing/invalid in
  production fails closed. Dev falls back to `http://localhost:8080`. Origin
  is normalized (no trailing slash) so QR + recovered URL match.

### Still deferred (documented)

- The unified origin helper is currently local to `no-dues.functions.ts`;
  issuance path still reads `process.env.PUBLIC_APP_URL ?? "https://sociohub.live"`
  inline. Both paths use the same env var, but the shared helper has not yet
  been extracted to a `.server.ts` module and reused by issuance / QR /
  public verify route.
- Column-level SELECT hardening on `no_dues_certificates` (safe columns only
  to `authenticated`) — not yet applied.
- Legacy plaintext-token backfill script + integration test harness — not yet
  added; documented as gated by `ALLOW_CERTIFICATE_TOKEN_BACKFILL=true`.
- Full No-Dues AlertDialog wrappers — inline confirm UI still in place.
- Flat 360 UI upgrade of `/society/flats/$id`, deterministic Unit Summary,
  and AI Summary — not implemented this turn.
- Runtime auth matrix (Society A vs B, block-scope, resident-denied, anon-
  denied) — verified via ACL inspection only; live-client tests not yet run.
- Rate-limit fail-closed policy in production — server helper already fails
  closed on limiter outage; explicit production/dev branching not audited
  this turn.

### Constraints preserved

- No payment integration changes; Razorpay untouched; Cash + Bank Transfer
  workflow untouched; no platform fee.
- No real society data modified — migration is ACL-only, no table changes.
- Firebase→Supabase auth architecture unchanged.
- Flat 360 remains Pro; Premium continues to inherit all features.
