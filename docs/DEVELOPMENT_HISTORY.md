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
