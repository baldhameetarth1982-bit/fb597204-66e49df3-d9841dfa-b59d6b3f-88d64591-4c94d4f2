# SociyoHub — Release Readiness (Source of Truth)

**Every future agent MUST read this file before claiming release status.**

## Permanent Rules

1. **No feature, security requirement, release requirement or Play Store
   requirement may be marked complete without implementation evidence AND test
   evidence. Typecheck alone is not completion.**
2. **Payment gateway and live payment integration remain the final
   implementation stage.** Earlier stages may prepare safe abstractions and UI
   placeholders but MUST NOT activate or replace payment providers, add
   platform fees, or change Cash + Bank Transfer maintenance behavior.
3. **Real production data (society protected society etc.) is never modified
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
- `tests/billing-cron.mjs` — exists
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
- Documentation sweep across `SECURITY_REQUIREMENTS.md`, `FEATURE_MATRIX.md`, `UI_REFERENCE_MAP.md`, `NEXT_STAGES.md`, `SOCIYOHUB_MASTER_CONTEXT.md`, `DEVELOPMENT_HISTORY.md`.
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

## Stage 3A — Turn 14 (2026-07-14)

### Completed
- **Shared public-origin helper** — `src/lib/public-origin.server.ts` exports
  `getPublicAppOrigin()`, `buildNoDuesVerificationUrl(rawToken)`, and
  `constantTimeEqualHex(a, b)`. Production requires `PUBLIC_APP_URL` (HTTPS,
  non-local host), development falls back to `http://localhost:8080`,
  trailing slash normalized, no query / fragment.
- **Worker-compatible timing-safe compare** — `constantTimeEqualHex` is pure
  JavaScript (no `node:crypto.timingSafeEqual`). No early return after
  length validation, malformed hex fails safely. Unit tests in
  `tests/unit/public-origin.test.mjs`.
- **`no-dues.functions.ts` wired through the helper**:
  - `issueNoDuesCertificate` — QR URL now built via
    `buildNoDuesVerificationUrl`; the hardcoded `sociohub.live` fallback and
    the local `resolvePublicAppOrigin` helper are removed.
  - `getCertificateVerificationLink` — uses `constantTimeEqualHex` for
    hash integrity check (removes `node:crypto` dynamic import) and
    `buildNoDuesVerificationUrl` for URL emission, so the QR-encoded URL
    and the recovered URL are byte-identical for the same token.
- **Error reason mapping** for verification-link recovery narrowed to the
  documented safe set: `legacy_token_unavailable`, `encryption_unavailable`,
  `integrity_check_failed`, `temporarily_unavailable`. Cryptographic detail
  is never returned to the client.
- `bunx tsgo --noEmit` passes.

### Deferred to a follow-up turn
The following Turn 14 items were not completed in this turn and remain open.
None of them touch payments / Razorpay / Cash-Bank-Transfer / platform fees
/ real society data / Firebase→Supabase auth architecture.

1. Base-table lockdown migration for `public.no_dues_certificates`
   (REVOKE direct SELECT from anon/authenticated; safe metadata RPC or
   security-invoker view returning only non-sensitive columns).
2. Additive CHECK/trigger constraints ensuring new (post-rollout) rows have
   non-empty `verification_token_hash`, `ciphertext`, `iv`, positive
   `key_version`, storage path, and certificate-number format — while
   preserving legacy rows.
3. `scripts/backfill-certificate-token-encryption.ts` (DRY_RUN default,
   `ALLOW_CERTIFICATE_TOKEN_BACKFILL=true`, prod-approval flag, idempotent).
4. No-Dues AlertDialog/Dialog wrappers (Approve / Reject / Issue / Revoke /
   Resident Recheck) — currently inline confirms in
   `_society/society.no-dues.$id.tsx` and `_resident/app.no-dues.$id.tsx`.
5. Rate-limit fail-closed audit for public verification + resident recheck
   + AI Summary in production paths.
6. Full test infrastructure — `tests/unit/certificate-token.test.*`,
   `tests/integration/no-dues.integration.test.*`,
   `tests/integration/flat360.integration.test.*`,
   `tests/integration/certificate-access.integration.test.*`,
   `scripts/verify-client-bundle-secrets.*`, CI workflow.
7. Complete Flat 360 UI at `_society/society.flats.$id.tsx` with section-
   level FeatureGate (Basic core preserved; Pro adds occupancy history,
   advanced finance, vehicles/visitors/complaints/documents/approvals,
   No-Dues, deterministic summary, AI Summary).
8. Strict Flat 360 types — remove `any` / `Record<string, any>` from
   `src/lib/flat360.functions.ts` and use generated DB types.
9. Deterministic Unit Summary pure function + tests.
10. Pro AI Summary server function through Lovable AI Gateway with
    entitlement check (`can_manage_flat_internal` + Pro/Premium), privacy-
    safe payload, prompt-injection hardening, cache + TTL + rate limit,
    deterministic fallback on provider failure.
11. Runtime security matrix execution (roles, encryption, no-dues, flat 360,
    AI) against an isolated test environment.
12. Visual verification screenshots at 360 / 390 / 414 / 1280 px.

### Confirmations (unchanged this turn)
- No payment integration touched.
- Razorpay unchanged.
- No platform fee introduced.
- Cash + Bank Transfer maintenance workflow preserved.
- No real society financial records modified.
- Firebase→Supabase auth architecture preserved.
- Basic flat detail route preserved.
- Flat 360 advanced sections remain Pro (unchanged; UI expansion deferred).
- Premium inherits all catalog features.

---

## Stage 3A — Turn 15 (No-Dues security closure)

### What actually ran this turn
| Command | Exit | Result |
|---|---|---|
| `git diff --check` | 0 | clean |
| `bunx tsgo --noEmit` | 0 | clean |
| `bunx vitest run tests/unit` | 0 | **21 passed / 0 failed / 0 skipped** across 3 files (`public-origin`, `certificate-token`, `certificate-backfill`) |
| `bun run build` (production) | 0 | `dist/client` + `dist/server` (Cloudflare Worker) generated |
| `bun scripts/verify-client-bundle-secrets.ts` | 0 | Scanned 882 `dist/client/` files — no server-only indicators |
| `supabase--migration` (token_storage_version + constraints + revoke SELECT) | applied | Linter reports pre-existing warnings on unrelated functions; no new issues from this migration |

### Certificate table access
- Base-table `SELECT` on `public.no_dues_certificates` **REVOKED** from `PUBLIC`, `anon`, `authenticated`.
- All authenticated table-level rights on `no_dues_certificates` **REVOKED** from `authenticated`.
- `service_role` retains `ALL` for internal RPCs and server functions.
- **Runtime penetration matrix (anon/auth/admin/block-admin/cross-society) NOT executed this turn** — no isolated test-database environment configured. Explicitly deferred; `implemented_unverified` for policy-level assertions, `implemented_unverified` for the GRANT changes themselves (schema-level verified only via migration).

### New encrypted certificate invariant
- `token_storage_version smallint NULL` added.
- `ck_no_dues_certificates_v1` constraint requires (for `version = 1`): plaintext `verification_token` NULL, `verification_token_hash ~ '^[0-9a-f]{64}$'`, non-empty ciphertext/IV, positive key version, non-empty storage_path, and non-null request/society/flat/certificate_number.
- Legacy rows (`token_storage_version IS NULL`) are preserved unchanged.
- Unique indexes: `no_dues_certificates_one_active_per_request` (partial, `revoked_at IS NULL`) and `no_dues_certificates_number_per_society`.
- `finalize_no_dues_issuance_internal` stamps `token_storage_version = 1` on every new row, validates hash format, rejects malformed IV/ciphertext/key version, and rejects storage paths containing `..`, `\`, or `http(s)://`.

### Verification-link recovery — legacy handling fixed
- `getCertificateVerificationLink` for legacy plaintext-only certs now returns `{ available: false, reason: "legacy_migration_required" }`. Recovered URL is **not** returned via runtime code.
- Hash-only certificates → `legacy_token_unavailable`.
- Encrypted certificates → constant-time hash check, then canonical URL via `buildNoDuesVerificationUrl`.

### Rate-limit failure policy
- `recheckAndResubmitNoDues`: rate-limit exceptions now **fail closed** in production (`NODE_ENV=production` → throw `RATE_LIMITED`). Dev/test fall open so local work isn't blocked.

### Admin & resident dialogs
- Approve / Reject / Issue → `Dialog` with confirm/cancel, pending state, disable-while-processing, mandatory reject reason (3–500 chars).
- Revoke → destructive `AlertDialog`, mandatory reason, revoked-visibility warning.
- Resident recheck → confirmation `Dialog` explaining that the existing request will be reused.

### Backfill script
- `scripts/backfill-certificate-token-encryption.ts` — guards: `ALLOW_CERTIFICATE_TOKEN_BACKFILL=true`, `BACKFILL_PROJECT_REF`, `BACKFILL_ENVIRONMENT`, defaults `DRY_RUN=true`, refuses known production ref without `ALLOW_PRODUCTION_CERTIFICATE_BACKFILL=true`, never prints tokens/hashes/ciphertext/IVs.
- Dry-run classifier logic covered by `tests/unit/certificate-backfill.test.ts` (4/4 pass).
- **Not executed** against real data this turn.

### Bundle secret scan
- `scripts/verify-client-bundle-secrets.ts` scans `dist/client/` (browser output only, **NOT** `dist/server/` Worker SSR).
- Indicators: `SUPABASE_SERVICE_ROLE_KEY`, `sb_secret_*`, `supabaseAdmin`, `RATE_LIMIT_HMAC_SECRET`, `CERTIFICATE_TOKEN_ENCRYPTION_KEY`, `encrypt/decryptCertificateToken`, Razorpay `key_secret`, Firebase `private_key`, `verification_token_hash|ciphertext|iv`, `storage_path: *.pdf`.
- Result: **clean** (0 hits over 882 files).

### Deferred to a subsequent turn (honest, not-done list)
- Runtime authorization penetration matrix (anon/auth/admin/block-admin/cross-society) against an isolated test project — no test project provisioned this turn.
- Backfill dry-run against an isolated staging environment.
- Integration test suite (`tests/integration/*`) — files not created; SKIPPED with reason "no `ALLOW_SOCIYOHUB_TEST_FIXTURES=true` isolated environment configured".
- Complete Flat 360 UI, deterministic summary, AI summary — next dedicated turn.

### Confirmations
- Razorpay untouched; no new gateway added; no platform fee; Cash + Bank Transfer maintenance workflows unchanged.
- No writes to real society data (protected society or otherwise) from this turn's tests or scripts.
- Firebase → Supabase auth architecture unchanged.
- Basic flat-detail functionality preserved; Flat 360 remains Pro; Premium inherits.

## Stage 3A · Turn 16 — Flat 360 deterministic summary + Turn 15 correctness

### Turn 15 correctness fixes
- `constantTimeEqualHex` now requires **exactly 64 hex characters** on both inputs (SHA-256). Malformed / 62 / 66 / odd / non-hex / empty inputs return `false`. Mixed-case supported. Every byte compared with no early exit after validation.
- Backfill pagination rewritten to **keyset (`ORDER BY id ASC, id > cursor LIMIT batch`)**. OFFSET is unsafe when write mode removes processed rows from the query. Cursor advances per row; final short batch terminates the loop.
- Classifier + pagination extracted to `src/lib/certificate-backfill.ts`; CLI script and unit tests now import the SAME implementation.

### Deterministic Unit Summary
- `src/lib/unit-summary.ts` — pure function `buildUnitSummary(input) → UnitSummary`. No AI, no randomness, no PII. `unsupported` never collapses into zero. Section errors surface as safe warnings. Actions only reference existing routes (`/society/billing`, `/society/accounts`, `/society/approvals`, `/society/no-dues`).
- `tests/unit/unit-summary.test.ts` — 21 scenarios (vacant, owner, tenant, multi, dues, overdue, partial, pending verify, inconsistency, complaints, approvals, blocked/eligible no-dues, unsupported, error, no PII, stable output, known routes only, serial vs structured).

### AI Summary slot (Pro)
- `src/components/flat360/AISummarySlot.tsx` — typed contract (`AISummaryContract`, `AISummaryProviderState`), Pro badge, dev-only "Coming in the next implementation stage" copy. **No fake generated text. No working-looking refresh button.** Provider integration deferred to the next dedicated turn.

### Flat detail route (section-level gating)
- `src/routes/_society/society.flats.$id.tsx` upgraded:
  - Header now uses `buildUnitLabel()` (`src/lib/unit-label.ts`), supporting both structured (`Tower B · Floor 7 · Flat 704`) and serial (`House 118`) societies.
  - **Basic** users retain all existing core sections (identity, current resident, outstanding, recent bills, occupancy history).
  - **Pro/Premium** users get the Deterministic Unit Summary card and AI Summary slot.
  - Basic users see a single `LockedFeatureCard` for the Pro sections — no aggressive repeated popups; whole route remains accessible.

### Verification results
| Check | Result | Notes |
|-------|--------|-------|
| `bunx vitest run tests/unit` | **54 / 54 passed** | public-origin (19), unit-summary (21), certificate-token (6), certificate-backfill (8) |
| `bunx tsgo --noEmit` | **pass** | no type errors |
| `bun scripts/verify-client-bundle-secrets.ts` | **clean** | 0 hits across 882 client-bundle files |
| Flat 360 integration harness | **SKIPPED** (expected) | `tests/integration/flat360.integration.test.ts` requires `ALLOW_SOCIYOHUB_TEST_FIXTURES=true` + isolated `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY`; file present, cases stubbed for the environment turn |

### Deferred (honest, not-done)
- Full strict rewrite of `flat360.functions.ts` `Snapshot` (SectionState<T> for every module). Current shape retains a narrow set of `any` casts on nested joined selects; refactor is the next Flat 360 turn together with the AI Summary provider.
- Lovable AI Gateway integration for the AI Summary slot — next dedicated turn (caching, rate limiting, provider fallback, prompt-injection resistance).
- Integration test bodies (fixture project not yet provisioned).
- Visual regression screenshots at 360 / 390 / 414 / 1280 px — not captured in this focused turn.

### Confirmations
- Razorpay untouched; no new gateway; no platform fee; Cash + Bank Transfer unchanged.
- No writes to real society data.
- Firebase → Supabase auth unchanged.
- Basic flat detail preserved; Flat 360 advanced sections remain Pro; Premium inherits.
- **AI Summary is NOT marked complete.** The slot is a typed placeholder only.

### Turn 17 — Sub-turn B: Flat 360 AI Server Core (complete, UI pending Sub-turn C)
- Provider: Lovable AI Gateway (`google/gemini-3.5-flash`, temperature 0.2, JSON-only).
- DTO: strict, PII-free, capped strings, recursive safety scanner.
- Output validation: Zod strict schema; disallows HTML, script, markdown links, emails,
  phones, UUIDs, token-like values, unknown action types, non-allow-listed routes.
- Cache: `public.flat360_ai_summary_cache` (service_role only, 6-hour TTL, keyed by
  society + flat + snapshot fingerprint + schema version).
- Rate limits: user_manual 10/h, per_flat 20/h, per_society 200/h. Limiter failure
  fails closed for new generation; cache still returns.
- Fallback: deterministic Unit Summary → `AISummaryResult` shape, `source: "deterministic_fallback"`.
- Tests: 149/149 unit tests pass; production build clean; bundle secret scan clean.

---

## Turn 17 — Sub-turn D: Final closure (audit, tests, docs)

Focus: audit and clean final Flat 360 UI source, add UI-logic tests, remove
unsafe route casts, complete Turn 17 documentation, and run the exit gate.

### Exit gate

| Command | Exit code | Notes |
|---|---|---|
| `bunx tsgo --noEmit` | 0 | Clean typecheck. |
| `bunx vitest run tests/unit` | 0 | **156 / 156 passed** across 10 files. New UI test file: `tests/unit/flat360-ui.test.ts` (7 tests). |
| `bun run build` | 0 | Production build passes (see build output for exact duration in this run). |
| `bun scripts/verify-client-bundle-secrets.ts` | 0 | Clean — 0 hits across 887 client-bundle files. |
| `bunx vitest run tests/integration/flat360.integration.test.ts` | SKIPPED — missing isolated fixture environment | Requires `ALLOW_SOCIYOHUB_TEST_FIXTURES=true` + isolated `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY`; will never run against real Society `[REDACTED-PROTECTED-SOCIETY-ID]`. |
| Playwright UI harness | SKIPPED — no Playwright config in project | The project does not currently configure Playwright. Visual regression evidence deferred to a dedicated verification turn. |
| Provider runtime smoke test | SKIPPED — provider credential unavailable to Sub-turn D | Requires a safe dev/test `LOVABLE_API_KEY` scoped to a non-production gateway. No such isolated credential is exposed to this sub-turn; production key is not usable for a smoke test that must not touch real cache/rate-limit state. |

### Code audit — remaining safety casts

| Pattern | Location | Status |
|---|---|---|
| `as never` on route `<Link>` | 0 remaining | Removed from `AISummarySlot.tsx` and `society.flats.$id.tsx`; both now use `isAIAllowedRoute` guard + typed `AIAllowedRoute` union. |
| `as any` in AI cache queries | `src/lib/flat360-ai.functions.ts` (3 sites, all on `supabaseAdmin`) | Retained: the `flat360_ai_summary_cache` migration is present but the generated `supabase/types.ts` is not regenerated in this turn. Casts are scoped to a service_role-only table read/upsert, never crossing an RLS boundary. Tracked as a follow-up regen. |
| `Record<string, any>` in Flat 360 code | 0 remaining | Not found in audited files. |
| `HouseDetailPage` stale component | Not present in current tree. | — |
| Duplicate client-side Supabase Flat 360 queries | 0 | Route is a single `getFlat360` `useQuery` + one AI query + one manual refresh mutation. |

### UI tests added

`tests/unit/flat360-ui.test.ts` (7 tests) — pure logic coverage that does not
require a DOM environment:

1. `isAIAllowedRoute` accepts every listed route.
2. `isAIAllowedRoute` rejects unknown routes, `""`, `undefined`, `null`, and `javascript:` schemes.
3. `isAIAllowedRoute` narrows to `AIAllowedRoute` on the truthy branch (compile-time check).
4. `AI_ALLOWED_ROUTES` snapshot — any future change to the list surfaces as a visible diff.
5. `reasonCopy` returns friendly copy for each known reason (5 assertions).
6. `reasonCopy` never leaks snake_case codes, the word "error", or provider/model names.
7. `reasonCopy` returns `null` when no reason is provided.

### Deferred to a follow-up verification turn (documented, not-done)

- **Full React component rendering tests** (state-by-state matrix for
  `AISummarySlot` and the flat route): require `jsdom` + `@testing-library/react`
  which are not yet installed. Not added in this closure turn to keep the
  change footprint minimal and reversible; can be introduced in a dedicated
  test-infra turn.
- **Responsive screenshots** at 360/390/414/768/1280 px: require a Playwright
  visual harness route and Playwright config. Not present in this project;
  intentionally not scaffolded in this closure turn.
- **Provider runtime smoke test**: pending a safe isolated dev
  `LOVABLE_API_KEY` that will not pollute real cache or rate-limit counters.
- **Regenerate `src/integrations/supabase/types.ts`** to remove the three
  `supabaseAdmin as any` casts around `flat360_ai_summary_cache`.

### Confirmations (Sub-turn D)

- SociyoHub branding unchanged; both co-founders unchanged; founder SEO unchanged.
- Basic flat route remains fully useful (identity/occupancy/finance/latest bill).
- Basic never invokes any AI server function (locked state; no query enabled).
- Pro / Premium AI Summary path unchanged; refresh disabled while pending; typed `<Link>` only for allow-listed routes.
- No browser AI provider key introduced.
- No certificate secret, No-Dues token, or payment-proof URL exposed by the route or AI DTO.
- Razorpay untouched; no payment integration changes; no platform fee; Cash + Bank Transfer preserved.
- Firebase → Supabase authentication preserved; RLS preserved; No-Dues cryptography untouched.
- No writes to real society data during audit; Society `[REDACTED-PROTECTED-SOCIETY-ID]` never used as fixture.

## Turn 18A closure (Stage 3B foundation)

- New migrations: income categories, non-member payers, income records (RLS + trigger + revokes). Verified via `supabase--migration` linter (no new findings from Turn 18A tables; pre-existing 77 project-level linter items unchanged).
- Unit tests: **181 passed / 0 failed**. Build **exit 0**. Bundle secret scan **0 findings** across 886 files.
- Integration matrix skipped honestly (`ALLOW_SOCIOHUB_TEST_FIXTURES` not set). Fixtures deferred to Turn 18B.
- Untouched: SociyoHub branding, co-founders, Razorpay subscription checkout, Cash+Bank Transfer maintenance, no-platform-fee policy, Firebase→Supabase exchange, No-Dues cryptography, Flat 360.

## Stage 1D — correctness slice sign-off

- Transactional creation RPC in place; record + audit_log atomicity is
  a database guarantee, not a JS wrapper convention.
- Weak-hash fallback removed; SHA-256 (64 hex) enforced by RPC and by a
  `NOT VALID` CHECK constraint on new writes.
- 299/299 unit tests pass; build + secret scan clean.
- Runtime PostgreSQL integration is not exercised in this slice (no
  isolated fixtures). Remaining Stage 1D slices: query-key migration,
  premium categories/payers UI, responsive verification.

## Stage 1D correctness slice — authoritative RPC

- Old RPC signature (12 args, included `_canonical_payload text`):
  execute revoked and function dropped in the same migration.
- New RPC signature: 11 business args only; no canonical/hash inputs.
- Direct-RPC validation enforced in PL/pgSQL: creator via `auth.uid()`,
  amount ≤ 2 decimals, future dates refused, reference ≤128,
  description ≤500, cash/bank_transfer only, resident refused.
- Plan parity with `normalizePlan()` verified by source-invariant tests.
- Adapter is thin (auth + Zod + RPC + strict result parse); no direct
  TS INSERT into `society_income_records` or `audit_log`; no
  compensating DELETE.
- `git diff --check` clean; `tsgo` clean; `bunx vitest run tests/unit`
  = 328/328 pass; `bun run build` succeeds; secret bundle scan clean.
- Runtime PostgreSQL / direct-RPC integration coverage remains **not
  executed** (no isolated fixture harness available). protected society ([REDACTED-PROTECTED-SOCIETY-ID]) untouched.

## Stage 1D — Income access boundary correctness

- IncomeAccessBoundary structurally unmounts the protected subtree for
  Basic, expired, inactive, cancelled, past_due, missing-society, and
  role-denied callers.
- Zero protected service calls in loading, Basic, expired, inactive,
  cancelled, past_due, missing-society, or role-denied states (proven by
  spy-backed behavioural tests, not source-scan alone).
- Exactly one UpgradePrompt path per locked route (rendered by the shared
  boundary; individual routes no longer wrap FeatureGate).
- No empty-society query keys, no `societyId!` non-null assertions and no
  broad `["society-income"]` invalidations remain in any of the five
  income routes.
- RPC adapter drops every `as unknown as string` cast in favour of a
  nullable-honest `CreateIncomeRpcArgs` adapter type.

Verification: 408/408 unit tests pass; guarded integration suite skips
honestly with no fixtures; production build clean; secret scan clean.

## Stage 1E — SQL reporting + reconciliation foundation + payer pagination

- `get_society_income_report` returns authoritative aggregates from a
  single society-scoped SQL execution. Dashboard consumes SQL summary,
  by-category, by-method, and trend directly — no client-side reduction
  of the loaded record page for totals.
- `transition_income_reconciliation` performs an idempotent, transactional
  reconcile / unreconcile with atomic `audit_log` insert. Verification
  state is never mutated by this RPC. Reason (5–500, no HTML) required
  for unreconcile. Cross-society calls return `not_found`; Basic/expired
  return `plan_required`.
- `list_non_member_payers_page` enforces safe projection, limit clamp
  (1..100), and search/type/active filtering entirely in SQL and returns
  `{items, total, has_next}`. UI pagination and empty states are driven
  by the SQL response — no unbounded fetch and no client slicing of a
  full directory.
- Every new RPC revokes execute from `PUBLIC` and `anon` and grants
  only to `authenticated`.
- 421/421 unit tests pass (adds `income-report-contract.test.ts`).
  Guarded integration suite skipped honestly (no non-protected synthetic
  society fixture is provisioned in this environment; the protected
  society protected society must not be used). Production build clean.
  Secret scan clean.
- Preview inspected at 360 / 390 / 414 / 768 / 1280 CSS widths for the
  Income dashboard populated / empty / loading / error, filtered record
  list, record detail with reconcile & undo-reconciliation dialogs,
  Category page, Payer page, Basic-locked, and role-denied.
- protected society
  (`[REDACTED-PROTECTED-SOCIETY-ID]`) untouched.

**Stage 1 overall status: complete. Next: Stage 2A — Society Structure
Audit and Canonical Setup Model.**

## Stage 2A closure (canonical structure model)

- Canonical: `societies` + `blocks` + `flats`. `hierarchy_nodes` is legacy compatibility only.
- `societies.structure_mode` is `'structured' | 'serial'` (nullable for legacy).
- `flats.block_id` is nullable in serial mode; a BEFORE-trigger enforces mode rules.
- New RPCs (SECURITY DEFINER, authenticated-only): `get_society_structure_overview`, `configure_society_structure_mode`, `list_society_units_page`, `create_society_unit`, `update_society_unit`, `set_society_unit_active`, `set_society_block_active`.
- Unsafe mode conversions with existing units are blocked; ambiguous legacy data left unchanged.
- `commit_society_wizard` writes canonical rows and no longer creates a fake "Houses" block for serial.

## Stage 2B (2026-07-16) — Residents, Family, Occupancy, Vehicles
- 10 new SECURITY DEFINER RPCs; all `REVOKE FROM PUBLIC, anon`,
  `GRANT EXECUTE TO authenticated`, gated by `is_society_admin_for`.
- Vehicle plates normalized (uppercase, whitespace stripped) and unique
  per society via partial index `ux_vehicles_society_plate_norm`.
- Occupancy duplicates blocked via `ux_flat_residents_active_triplet`.
- Directory list projection is privacy-safe — no phone/email/KYC/docs.
- Private detail is a separately-authorized JSONB bundle; missing rows
  return NULL (non-enumerating).
- 449/450 unit tests pass (1 honest integration skip). Build OK. Secret
  scan OK. Protected society untouched.

## Stage 2C (2026-07-17) — Teams, Roles and Privacy Controls
- Canonical `role_permissions.ts` is the single source of truth for
  role × capability mapping. SQL helper
  `current_user_has_society_permission(_society_id, _capability,
  _block_id uuid DEFAULT NULL)` validates the capability against
  `is_known_capability()` BEFORE any role shortcut — unknown
  capabilities return false for every role (including Super Admin).
- Multi-block Block Admin scope lives in
  `public.user_role_block_scopes` with soft-deactivation history and a
  partial unique active index on (role_id, block_id). Existing single
  block_id assignments were backfilled without invention.
  `admin_upsert_team_role_v2` accepts an array of blocks, dedupes,
  validates same-society + active, reconciles scopes transactionally
  and audits previous/resulting arrays.
- Stage 2C server adapters
  (`src/lib/team-admin.functions.ts`,
   `src/lib/privacy-decisions.functions.ts`)
  are generated-type-safe: RPC args use
  `satisfies Database["public"]["Functions"][fn]["Args"]` and RPC
  responses are Zod-validated. Zero `as any` remains in Stage 2C
  domain code.
- Server-enforced privacy: `resolve_privacy_access` (directory,
  contacts, finances, vehicles, documents), `resolve_financial_visibility`
  (admin | detailed | summary | none) and the resident-safe directory
  `list_society_residents_safe_page`. Block Admins are limited to
  their assigned blocks; residents see the directory only when
  `privacy_directory = 'residents_safe'`; phone / email / KYC /
  documents are never projected.
- Last-active-Society-Admin protection preserved; role changes remain
  transactional and audited.
- 509/509 unit tests pass (5 honest integration skips). Build OK.
  Secret scan OK. Protected society untouched.


## Stage 2C closure (2026-07-17)

- Block-scoped permission checks require exact block ID; NULL block → false for Block Admin.
- Two-arg permission helper fails closed for Block Admin block-scoped capabilities.
- Legacy `admin_upsert_team_role`/`list_society_team_members` retired (revoked, body raises `deprecated_use_v2`).
- Team directory no longer falls back to email; assignment candidates keep email under a separate authorization.
- Privacy contacts household check is bound to `flats.society_id`; vehicles/documents require resource-specific `can_access_vehicle`.
- `user_role_block_scopes` role/block FKs are `ON DELETE RESTRICT` — scope history preserved.
- 532 unit tests pass; tsgo clean; build green; client-bundle secret scan clean.
- Protected society `[REDACTED-PROTECTED-SOCIETY-ID]` untouched.


## Stage 2D — Upload hardening (2026-07-17)

Status: IN PROGRESS. Upload path, server parsing, transactional staging,
and grant hardening are complete. Canonical commit, commit idempotency
records, real provenance, XLSX parser, and final result UI remain.
