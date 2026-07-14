# Stage 3A — Turn 3 Progress Report

## What shipped this turn

### 1. No-Dues workflow (Checkpoint G) — backend + UI **live**

- Migration `20260714165652` — additive:
  - Added `no_dues_certificates.verification_token_hash` (SHA-256 hex).
  - Added `blocked_by_dues` value to `no_dues_status` enum.
  - `verification_token` column made nullable (raw token no longer stored for new certs).
- Storage bucket `no-dues-certificates` created **private**.
- Server helpers `src/lib/no-dues.server.ts` (server-only file, `.server.ts` filename gate):
  - `generateRawToken()` — 32-byte crypto random, base64url.
  - `hashToken()` — SHA-256 hex.
  - `renderCertificatePdf()` — `pdf-lib` + `qrcode` (Worker-safe, pure JS).
- Server functions `src/lib/no-dues.functions.ts` (client-callable via `useServerFn`):
  - `checkNoDuesEligibility` — reads unpaid/overdue/partial bills + pending payments; RLS-scoped via the caller's Supabase client.
  - `submitNoDuesRequest` — verifies caller is an active resident of the flat; snapshots eligibility; status defaults to `submitted` or `blocked_by_dues`.
  - `listMyNoDuesRequests`, `listSocietyNoDuesRequests`.
  - `reviewNoDuesRequest` — society admin; re-verifies eligibility on approve; falls back to `blocked_by_dues` if new dues appeared.
  - `issueNoDuesCertificate` — idempotent (returns existing on retry); reserves unique cert number; renders PDF; uploads to private storage; cleans up storage on DB insert failure; audit row appended.
  - `getCertificateDownloadUrl` — 300-second signed URL; owner + society admin only.
  - `revokeNoDuesCertificate` — with reason.
- Explicit `ALLOWED_TRANSITIONS` map; server rejects invalid transitions.
- UI routes (Feature-Gated to `no_dues`):
  - `/society/no-dues` — admin list + approve/reject/issue actions.
  - `/app/no-dues` — resident request form + certificate download.
  - `/verify/no-dues/$token` — public verification page (no PII, no internal IDs).
- Public API route `/api/public/verify/no-dues/$token`:
  - Hashes incoming token, looks up by hash.
  - Returns generic invalid response for malformed **and** unknown tokens.
  - Cache disabled (`cache-control: no-store`).
  - Exposes only: certificate number, issue date, valid-until, society name/city, unit label, active/revoked/expired status. No resident PII, no storage path, no internal IDs.

### 2. Feature catalog corrections (Checkpoint A/D fix)

- Route-to-feature mapping added: `routes: string[]` alias per entry.
- `no_dues` flipped to `status: "available"`, `backendReady: true`, gained `/app/no-dues` and `/verify/no-dues/$token` aliases.
- `flat_360` gained `/society/flats/$id` alias.
- `billing` gained `/society/billing/generate`, `/society/bills/$id`, `/society/billing-settings`, `/society/maintenance` aliases.
- `residents` gained `/society/residents/$id`.
- 8 new **meaningful** feature entries (not 84 or 60):
  - `resident_dashboard` (Basic) — covers `/app/dashboard`, `/app/profile`, `/app/search`.
  - `resident_bills` (Basic) — covers `/app/bills`, `/app/dues`, `/app/ledger`.
  - `community_feed` (Pro) — covers `/app/feed`, `/app/feed/$postId`.
  - `family_members` (Basic).
  - `helpdesk` (Pro).
  - `notifications` (Basic).
  - `achievements_hub` (Pro) — covers `/app/achievements`, `/app/activity`, `/app/trust`.
  - `guard_visitor_entry` (Pro) — maps guard route to real capability.
- `platform_super_admin` (Basic + `planNeutral: true`) — bundles all 18 `/admin/*` routes under **one** feature, gated by platform role rather than subscription plan.
- Added `planNeutral?: boolean` to `FeatureCatalogEntry`; `hasFeature()` short-circuits gating when set.

**Final meaningful feature count: 46** (was 37). Well below the 84-route count, consistent with the rule that routes ≠ features.

### 3. Basic access preserved (Checkpoint 3 correction)

Basic still contains: `society_setup`, `society_profile`, `blocks`, `flats`, `residents`, `billing`, `announcements`, `notices`, plus the newly explicit `resident_dashboard`, `resident_bills`, `family_members`, `notifications`. No Basic feature was demoted to Pro.

### 4. Route classification

| Class | Count | In catalog? |
|---|---|---|
| User-facing feature route | 46 primary + ~30 aliased | Yes (as `route` or `routes[]`) |
| Detail/sub-route of existing feature | ~14 | Yes, as `routes[]` alias |
| Public marketing/legal (`/`, `/pricing`, `/legal`, `/gdpr`, `/privacy`, `/terms`, `/refund`, `/contact`, `/support`) | 9 | Intentionally excluded |
| Authentication / onboarding / checkout (`/login`, `/onboarding.*`, `/verify-phone`, `/welcome`, `/settings`, `/checkout/$planId`) | 10 | Intentionally excluded |
| API / webhook / server (`/api/**`) | 5 | Intentionally excluded |
| System redirects (`/society/plan-required`, `/app/plan-required`) | 2 | Intentionally excluded |
| Super Admin platform | 18 | One bundled feature (`platform_super_admin`, plan-neutral) |
| Unreachable | 0 | Feature Directory surfaces every catalog entry |

### 5. Security posture (new work only)

- Every mutation re-verifies caller's society/flat membership; **client-supplied society_id, flat_id, request_id, and certificate_id are all cross-checked** against RLS (via the auth-middleware supabase client) before service-role is used.
- Service-role client (`supabaseAdmin`) is imported **inside** handlers only, after authorization checks pass. Not re-exported to the client.
- Token security: 32-byte random, base64url, SHA-256 stored, raw only in URL/QR. `getCertificateDownloadUrl` uses short-lived (300s) signed URLs, gated by owner OR society admin.
- Public verification endpoint returns identical shape for malformed and unknown tokens.
- No new SECURITY DEFINER functions created in this turn (server-fn approach used instead). Pre-existing 74 linter warnings are unchanged and remain technical debt for a dedicated pass.

## What is NOT done yet (queued for next turn)

- **Flat 360 (Checkpoint F)** — dashboard drill-in with dues/history/AI summary.
- **Gamification idempotent points ledger (Checkpoint H)** — schema is ready (`user_points.source_ref` unique index applied earlier); trigger update pending.
- **Checkpoint I** — end-to-end auth/RLS tests documented (not just policy-read).
- **Checkpoint J** — visual parity pass; still `reference-missing` because no screenshots attached.
- Society More navigation surfacing the No-Dues tile.

## Verification performed

- `bunx tsgo --noEmit` → 0 errors.
- Auto-generated `src/routeTree.gen.ts` picked up all 4 new routes (society, resident, public verify page, public verify API).
- Migration ran clean; linter surfaced only pre-existing WARN-level issues (74, unchanged).

## Confirmations

- No existing feature removed.
- No duplicate component/route/table created.
- No real society data modified.
- Firebase → Supabase authentication path preserved.
- Razorpay remains subscription-only.
- No platform fee exists.
- Maintenance remains Cash + Bank Transfer.

## Stage 3A · Turn 6 — Trusted-Actor Model, Atomic Transitions, Atomic Rate Limiter

**Problem:** Previous migration made the No-Dues privileged RPCs (`next_no_dues_cert_number`, `finalize_no_dues_issuance`, `revoke_no_dues_certificate`) service-role-only, but their bodies still relied on `auth.uid()`. Under `supabaseAdmin.rpc(...)` `auth.uid()` returns NULL — every issuance path would have failed at runtime with `UNAUTHENTICATED`. In addition, direct `supabase.rpc(...)` calls from client-authenticated context were now denied by `REVOKE EXECUTE`, so approve/reject/revoke code paths were entirely broken.

**Fix (migration `20260714175701_*`):**

1. Dropped the three legacy RPCs and replaced them with five actor-aware `_internal` RPCs:
   - `submit_no_dues_request_internal(_actor_id, _society_id, _flat_id, _purpose, _snapshot, _eligible)`
   - `transition_no_dues_request_internal(_actor_id, _request_id, _decision, _notes, _reason, _new_snapshot)` — approve / reject / block
   - `finalize_no_dues_issuance_internal(_actor_id, ..., _eligibility_snapshot, _eligible)` — re-checks eligibility inside the transaction; if false, flips to `blocked_by_dues` and returns
   - `revoke_no_dues_certificate_internal(_actor_id, _certificate_id, _reason)` — idempotent
   - `next_no_dues_cert_number_internal(_actor_id, _society_id)` — atomic counter
2. Every RPC is `EXECUTE service_role` only. Each independently re-verifies `_actor_id` against `is_society_admin_for(...)` / `is_super_admin(...)` / active flat residency. `_actor_id` is always the trusted `userId` from `requireSupabaseAuth`, never a browser-supplied field.
3. Direct client `INSERT` on `no_dues_requests` was revoked and the resident submit policy dropped. All submissions must now go through `submitNoDuesRequest` server function which calls the internal RPC via service role.
4. `touch_rate_limit(_bucket, _subject, _limit, _window_seconds)` added — atomic `INSERT ... ON CONFLICT DO UPDATE` on `rate_limits`, returning `allowed / remaining / retry_after_seconds`. Old SELECT-then-UPDATE race in `checkRateLimit` removed.

**Server code:** `src/lib/no-dues.functions.ts` rewritten so every state-changing path goes through service-role `_internal` RPCs with `_actor_id = userId`. `src/lib/rate-limit.server.ts` rewritten to call `touch_rate_limit` and to HMAC-fingerprint IPs (`fingerprintSubject`) so raw IPs never persist. Public verification route (`/api/public/verify/no-dues/$token`) uses the fingerprint and returns `Retry-After` from the RPC.

**Canonical status model:** enum values unchanged (`draft`, `submitted`, `under_review`, `approved`, `rejected`, `issued`, `revoked`, `blocked_by_dues`); canonical flow is `submitted → approved → issued → revoked`, with `submitted → rejected` and `submitted → blocked_by_dues → submitted` side branches. `draft` and `under_review` are accepted as legacy source statuses in `transition_no_dues_request_internal` but no new code produces them.

**Verification:** `bunx tsgo --noEmit` — 0 errors.

**Deferred to next turn** (explicitly gated by user's Turn 6 instructions on runtime auth tests passing): No-Dues detail routes, Flat 360, Gamification, Checkpoint I runtime tests, Checkpoint J visual audit.

## Stage 3A — Turn 8 (2026-07-14)

**Canonical No-Dues Eligibility + Trusted-Server-Only RPC Rewrite**

Migration `20260714_compute_eligibility_and_rpc_rewrite`:
- Added `public.compute_no_dues_eligibility_internal(_society_id, _flat_id)` — sole authoritative eligibility source. Service-role EXECUTE only.
- Dropped and recreated `submit_no_dues_request_internal`, `transition_no_dues_request_internal`, `finalize_no_dues_issuance_internal` **without** the caller-supplied `_eligible` / `_snapshot` / `_new_snapshot` / `_eligibility_snapshot` parameters. Each RPC now derives eligibility itself inside the transaction.
- Finalization performs an independent eligibility recheck in the same transaction; if blocked, sets request → `blocked_by_dues` and returns before creating the certificate (server compensates by removing the staged PDF).

Billing schema (real, audited):
- `bills`: status text ∈ {paid, unpaid, cancelled}; amount numeric; cancelled_at nullable; paid_at nullable.
- `payments`: status text (observed: pending, success); method text (observed: cash + bank transfer variants); bill_id nullable.
- Remaining balance formula (canonical): `GREATEST(0, bill.amount - Σ payments.amount WHERE bill_id = bill.id AND status='success')` — clamped ≥ 0; excludes cancelled bills and non-success payments.

Files:
- `supabase/migrations/20260714_*` (new eligibility fn + 3 RPC replacements)
- `src/lib/no-dues.functions.ts` (removed local `computeEligibility`; all eligibility comes from the DB fn via a service-role wrapper; submit/review/issue calls updated to new RPC signatures)
- `src/routes/_society/society.no-dues.$id.tsx` (new admin detail route with blockers, timeline, approve/reject/issue/revoke/download)
- `src/routes/_resident/app.no-dues.$id.tsx` (new resident detail route with blockers, timeline, download)
- `docs/RELEASE_READINESS.md` (canonical eligibility marked ✅; detail routes noted implemented_unverified)

Verification performed:
- `bunx tsgo --noEmit` → exit 0

Verification NOT yet performed (honestly `implemented_unverified`, not `tested`):
- runtime eligibility test matrix (parts 10.1–10.10 of the turn spec)
- authorization negative tests (10.11–10.18)
- transaction rollback / concurrency tests (10.19–10.28)
- rate-limit threshold tests (10.29–10.31)
- production `bun run build`
- client-bundle secret scan
- visual verification of the two new routes

No payment integration changed. Razorpay untouched. Cash + Bank Transfer maintenance behavior unchanged. No platform fee added. No real society data modified.
