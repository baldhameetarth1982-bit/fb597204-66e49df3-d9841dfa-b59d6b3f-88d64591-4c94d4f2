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

---

## Stage 3A — Turn 17 Sub-turn A.1 (Flat 360 server-core closure)

### Authorization model (final)
- Society Admin: `is_society_admin_for_internal(_actor_id, _society_id)`.
- Block Admin: `is_block_admin_for_flat_internal(_actor_id, _flat_id)` (already
  present in the schema; `user_roles` has `society_id` and `block_id`). No
  society-wide fallback; unassigned block admins are denied.
- Super Admin: `is_super_admin_internal(_actor_id)`.
- Viewer role in the snapshot is the actual role (`society_admin` /
  `block_admin` / `super_admin`), not a blanket "society_admin".

### Server plan enforcement
- `normalizePlan()` now degrades `expired`, `cancelled`, `past_due`, `inactive`
  to `basic`. Trial/trialing remains Premium.
- Basic returns `locked` for advanced-financial, payments, vehicles, occupancy
  history, visitors, complaints, documents, approvals, notices, No-Dues, and
  the deterministic Unit Summary. Advanced DB reads are not issued for Basic.
- Premium inherits Pro via `canViewAdvanced`.

### Data honesty
- `inconsistency_count` comes from the canonical
  `compute_no_dues_eligibility_internal` counts (`inconsistent + unknown_status`)
  and its Zod-validated JSON payload — never fabricated `0`.
- Eligibility failure surfaces as `error` / `unsupported`, never as `₹0`.
- No-Dues section never queries `no_dues_certificates`; certificate secrets,
  tokens, hashes, IVs, key versions, storage paths, and QR payloads are absent
  from the snapshot by construction.

### Typing & tests
- `flat360.functions.ts` and `flat360-types.ts` contain zero `any` and zero
  `no-explicit-any` disables; the service is dependency-injected via a typed
  `Flat360Deps` contract with typed row shapes.
- `tests/unit/flat360-service.test.ts` now covers authorization matrix, plan
  gating (Basic query suppression, Pro/Premium execution, expired/missing
  plan), data safety (no PII/secret keys, no fabricated zeros, honest
  section states), and structured/serial unit labeling. 98/98 unit tests pass.
- `tests/integration/flat360.integration.test.ts` remains honestly skipped
  unless `ALLOW_SOCIOHUB_TEST_FIXTURES=true` and isolated Supabase creds.

### Exit gate (this closure)
- `bunx tsgo --noEmit` — clean.
- `bunx vitest run tests/unit` — 98 passed / 0 failed.
- `bunx vitest run tests/integration/flat360.integration.test.ts` — 13 skipped.
- `bun run build` — succeeded (`✓ built in 57.02s`).
- `bun scripts/verify-client-bundle-secrets.ts` — clean (885 files, 0 findings).

No migration was required — the block-admin helper and `user_roles.block_id`
already existed.

## Turn 17 — Sub-turn B: Secure Pro/Premium AI Unit Summary Server Core

### Preflight fix — financial-unknown never collapses to zero
- Added `FinancialAvailability` discriminator on `Flat360Snapshot` (`available` / `unsupported` / `error`).
- `Flat360SummaryInput.financial` gained an optional `status` field; `buildUnitSummary` now
  emits "Financial data could not be loaded." (or "not available") instead of "No outstanding dues."
  when the authoritative eligibility engine is unavailable.
- Deterministic Unit Summary forwards this status; AI DTO consumes it directly and omits
  numeric fields when the status is not `available`.

### New server modules
- `src/lib/flat360-ai.server.ts` — pure AI core:
  - AI-safe DTO builder (`buildAiDto`) with 180-char string capping.
  - Recursive forbidden-key / PII scanner (`assertAiSafe`).
  - Zod-strict output contract (`AISummaryResultSchema`) with allow-listed action types
    and routes drawn from `AI_ALLOWED_ROUTES`.
  - Deterministic fallback conversion.
  - Deterministic SHA-256 snapshot fingerprint (32 hex chars) — scoped by AI-safe DTO only.
  - Injected `generateFlat360AISummary({snapshot, actorId, forceRefresh?}, {cache, limiter, provider})`.
- `src/lib/flat360-ai.functions.ts` — TanStack server function boundary:
  - `requireSupabaseAuth` middleware; input = `{flatId, forceRefresh?}` only.
  - Reuses `loadFlat360Snapshot` for authorization + plan derivation.
  - Real cache adapter → `public.flat360_ai_summary_cache` (service_role only).
  - Real rate limiter → `checkRateLimit` (user_manual 10/h, per_flat 20/h, per_society 200/h).
  - Real provider → Lovable AI Gateway (`google/gemini-3.5-flash`, temperature 0.2, structured JSON only).

### Migration
- `public.flat360_ai_summary_cache` — private cache table:
  columns `society_id`, `flat_id`, `snapshot_fingerprint`, `schema_version`,
  `result_json`, `generated_at`, `expires_at`; unique
  `(society_id, flat_id, snapshot_fingerprint, schema_version)`; RLS enabled with no
  policies; service_role only.
- TTL: 6 hours. Fingerprint change causes a natural cache miss even before TTL.

### Prompt-injection defence
- System prompt states data is untrusted; only structured JSON facts sent; no complaint bodies,
  notice HTML, resident notes, browser prompt, or rejection reasons reach the provider.
- Every string in the DTO capped to 180 chars.

### Client-bundle secret scan indicators added
- `LOVABLE_API_KEY`, `Flat 360 operational summarizer` prompt marker, and
  `createLovableAiGatewayProvider` identifier — all confirmed absent from client bundle.

### Exit gate (Sub-turn B)
- `bunx tsgo --noEmit` — clean (exit 0).
- `bunx vitest run tests/unit` — 149 passed / 0 failed / 0 skipped (9 files).
  - `flat360-ai-dto.test.ts`: 18 tests.
  - `flat360-ai-validation.test.ts`: 18 tests.
  - `flat360-ai-plan-cache.test.ts`: 15 tests.
- `bun run build` — succeeded (`✓ built in 56.74s`).
- `bun scripts/verify-client-bundle-secrets.ts` — 885 files scanned, 0 findings.

### Scope guarantees
- SociyoHub branding, co-founder pages, Razorpay/Cash/Bank Transfer, Firebase→Supabase auth,
  No-Dues cryptography — all unchanged.
- No real society data written; Basic denied at server without any provider call.

## Turn 17 — Sub-turn D (final closure)

- Introduced strict `AIAllowedRoute` union + `isAIAllowedRoute` runtime guard in `src/lib/flat360-types.ts`.
- Removed both remaining `<Link to={... as never}>` casts (`AISummarySlot.tsx`, `society.flats.$id.tsx`); typed `<Link>` now always resolves against a real route.
- Raised action-button min touch target from 36 → 44 px in `AISummarySlot` and the flat route.
- Exported `reasonCopy` from `AISummarySlot` for direct unit coverage.
- Added `tests/unit/flat360-ui.test.ts` — 7 UI-logic tests (allow-list guard + reason copy safety). Unit total: **156 / 156** passing.
- Documented Sub-turn D exit gate, remaining `as any` scope (service-role-only cache upsert, gated by types regen), and honestly-skipped items (Playwright screenshots, provider runtime smoke, full RTL rendering) in `docs/RELEASE_READINESS.md`.
- No changes to Razorpay, payments, founders, branding, sitemap, robots, RLS, or No-Dues crypto.

## Stage 3B — Turn 18A (Non-Member Payment Foundation)

**Backend/domain only. No UI, no AI, no online gateway.**

### Canonical income architecture
- `society_income_categories` — society-scoped taxonomy (`key` unique per society, active/inactive flag, system defaults allowed but seeding deferred).
- `non_member_payers` — society-scoped external payer directory (vendor/advertiser/coach/event_organizer/shop/guest/temporary/other). Contact fields optional; no gov-ID, no bank fields.
- `society_income_records` — canonical income record with strict payer XOR check, positive amount, method in `cash | bank_transfer | other_offline`, verification (`pending | verified | rejected | reversed`), reconciliation (`unreconciled | matched | partially_matched | needs_review | reversed`), reversal audit fields.
- Cross-table society consistency trigger `enforce_income_record_society_consistency` rejects records whose category or payer belongs to another society.
- No DELETE grant on income records to `authenticated` — reversal is the only removal path.

### RLS
- All three new tables: `is_society_admin_for(auth.uid(), society_id) OR is_super_admin(auth.uid())` for SELECT/INSERT/UPDATE (+DELETE on categories/payers). No `anon`, no resident, no guard access.
- Trigger + `updated_at` helpers are `SET search_path = public` and `REVOKE EXECUTE ... FROM PUBLIC, anon, authenticated`.

### Server functions (`src/lib/non-member-income.functions.ts`)
- `listIncomeCategoriesFn`, `createIncomeCategoryFn`, `updateIncomeCategoryFn`
- `listNonMemberPayersFn`, `createNonMemberPayerFn`, `updateNonMemberPayerFn`
- `createNonMemberIncomeRecordFn`, `verifyNonMemberIncomeRecordFn`, `rejectNonMemberIncomeRecordFn`, `reverseIncomeRecordFn`, `listIncomeRecordsFn`
- Every function re-verifies society admin AND Pro/Premium plan server-side via `is_society_admin_for` RPC + `normalizePlan(plan_id, plan_status)`. Basic/expired/cancelled → denied.
- Verification transitions gated by `canTransitionVerification` state machine; `reversed` is terminal.
- Every state-change writes an `audit_log` entry (`income_record.created/verified/rejected/reversed`).

### Pure logic (`src/lib/non-member-income.server.ts`)
- Zod schemas, `PAYER_TYPES`, `PAYER_KINDS`, `SUPPORTED_METHODS`, `VERIFICATION_STATES`, `RECONCILIATION_STATES`.
- `toPublicPayerList` / `toPublicIncomeList` data-minimization projections: default list responses exclude phone, email, notes, reference_code, raw reference number (replaced by `••••<last4>` suffix). No payment-proof URL, no bank fields exposed anywhere.

### Tests
- `tests/unit/non-member-income.test.ts` — **25 tests** covering plan gating (3), category validation & normalization (3), payer validation (4), income record validation incl. payer XOR / cash / bank_transfer / rejected online method (6), state machine (6), and data minimization (2). Suite: **181 / 181** passing.
- `tests/integration/non-member-income.integration.test.ts` — guarded by `ALLOW_SOCIOHUB_TEST_FIXTURES=true` + `SOCIOHUB_TEST_SOCIETY_A/B`. Skips honestly when isolated env missing. Matrix items filed as `it.todo` for Turn 18B fixture provisioning.

### Exit gate
- `bunx tsgo --noEmit` — exit **0**.
- `bunx vitest run tests/unit` — 11 files, **181 passed**.
- `bunx vitest run tests/integration/non-member-income.integration.test.ts` — 12 tests, 1 pass + 11 todo, 0 failed (fixtures absent as expected).
- `bun run build` — exit **0** (`✓ built in 49.92s`).
- `bun scripts/verify-client-bundle-secrets.ts` — **886 files, 0 findings**.

### Scope guarantees
- Turn 17 unchanged. SociyoHub branding, both co-founders, founder SEO, Razorpay subscription billing, Cash+Bank Transfer maintenance flow, no-platform-fee policy, Firebase→Supabase auth, RLS, Flat 360, No-Dues cryptography — all untouched.
- No real society (`1907a918-…`) data read or written by this turn.
- Deferred to later turns: Turn 18B admin UI, later Stage 3B AI income categorization, final payment stage for any online gateway.

## Turn 18B.1A — Income Read UI Strictness (2026-07-15)

Focused strictness closure on Turn 18B.1:

- **Strict types**: added `IncomeVerificationStatus`, `IncomeReconciliationStatus`, `IncomePaymentMethod`, `IncomePayerKind`, `IncomeSort`, `IncomeCategoryTotal`, `IncomeMethodTotal`, `IncomeReconciliationTotal`, `IncomeDashboardResult`, `IncomeRecordListItem`, `IncomeRecordDetail`, `IncomeRecordDetailResult`, `MetricState<T>` in `src/lib/non-member-income.server.ts`. Both income route files (`society.income.tsx`, `society.income.$id.tsx`) are now fully typed — handwritten `any` count went from 12 to 0 (verified by an automated test that scans these files).
- **Honest metrics**: `activePayerCount` is now a `MetricState<number>` — a failed count query returns `{ status: "error" }` instead of silently rendering zero.
- **Strict amount parsing**: new `parseFinancialAmount(value, { allowZero })` helper — invalid DB amounts propagate as errors, never silently `₹0`. Used by dashboard aggregation and detail.
- **Detail discriminated union**: `getIncomeRecordDetailFn` returns `{ status: "available" | "not_found" | "error" }`. Database errors are now surfaced as errors, not fake not-found. Category / payer lookup errors are also honestly surfaced.
- **Complete filter UI**: This Month / Last Month / Last 90 / Custom Range (with validated from ≤ to), category, payer kind, method, verification, reconciliation, sort (newest / oldest / amount desc / amount asc), reset action. All filter values are typed enums (no `as any`).
- **Real pagination**: 25 records per page. Previous / Next buttons, disabled correctly on first / last page. Total-count indicator when available. Filters reset to page 0. 44px touch targets.
- **Safe payer label in list**: `IncomeRecordListItem` now includes `payer_display_name` and `category_display_name`, populated via batched authorized lookups. No phone / email / notes / reference_code / bank data returned to the client.
- **Dashboard truncation**: `truncated: boolean` + `aggregateSource: "javascript_scan" | "sql_rpc"` flags so the UI can honestly warn when the 5000-row JavaScript scan cap is hit. **SQL RPC aggregate deferred** to a follow-up turn — the JavaScript scan is retained with an honest truncation flag rather than shipping an under-reviewed SECURITY DEFINER migration.
- **Tests**: 202 unit tests passing (was 194). New tests cover strict amount parsing (7 cases), no-`any` regression scan on both income route files.

### Honestly deferred to Turn 18B.2
- SQL RPC aggregation function (dashboard still JS-scan with truncation flag)
- Verify / reject / reverse controls
- Category / payer editor UI
- Income entry form
- Reconciliation actions
- Playwright viewport inspection (360 / 390 / 414 / 768 / 1280) — inspected only via responsive CSS review, not automated capture
- AI income categorization
- Any online gateway (Razorpay stays subscription-only)

## Turn 18B.2 — Secure Verify / Reject / Reverse workflows

- Additive migration adds `rejected_at`, `rejected_by`, `rejection_reason` columns to `society_income_records` and a new `public.transition_income_record(uuid, text, text)` SECURITY DEFINER RPC.
  - Fixed `search_path = public`, EXECUTE revoked from PUBLIC, granted only to `authenticated`.
  - Actor/society derived server-side from `auth.uid()` and the record; browser cannot supply them.
  - Conditional expected-status UPDATE with `ROW_COUNT` check → concurrent transitions return `already_processed` instead of overwriting.
  - Audit_log INSERT runs in the same transaction: audit failure rolls back the state change.
  - Reason validated inside the RPC: 5-500 chars, no HTML.
- New `verifyIncomeRecordByIdFn` / `rejectIncomeRecordByIdFn` / `reverseIncomeRecordByIdFn` server functions accept minimal input (`recordId` + optional `reason`) and return a strict discriminated `IncomeTransitionResult`.
- Detail route `/society/income/$id` now surfaces per-status action buttons and Verify / Reject / Reverse dialogs with masked references and required, validated reasons. Cache invalidation covers detail + list + dashboard on success and on `already_processed`.
- Preflight: income list now uses `parseFinancialAmount` (invalid amounts surface a safe list error instead of silent ₹0), and category/payer label batch queries check `.error` before proceeding.
- Tests: 43 in the income suite, 212 across `tests/unit`. Full `bunx tsgo --noEmit`, `bun run build`, and secret-scan pass.

Still deferred:
- SQL dashboard aggregate (JavaScript scan with `truncated` warning retained).
- Category management UI, payer directory UI, offline income entry (Turn 18B.3).
- Reconciliation actions, bank statement import, AI categorization, online gateways.

## Turn 18B.2A — Direct-RPC bypass + record-existence enumeration closure

**Original defect.** `public.transition_income_record(uuid, text, text)` was
`SECURITY DEFINER` and executable by every authenticated user. Pro/Premium
entitlement lived only in the TypeScript wrapper, so an authenticated Basic
Society Admin could call the RPC directly through the Supabase client and
bypass the plan gate. The same RPC returned `not_found` for unknown UUIDs and
`not_authorized` for existing-but-inaccessible rows, letting a caller probe
which record IDs exist across societies.

**Selected exposure model — Design A (fully authorized authenticated RPC).**
`authenticated` continues to hold `EXECUTE`; the RPC itself is now solely
responsible for its own authorization decisions.

**Corrective migration** (`20260715173243_...sql`) — additive; no in-place edit
of the already-applied 18B.2 migration; no production backfill.

- Adds `public.is_non_member_income_enabled_internal(_society_id uuid)` — a
  DB-side mirror of `normalizePlan()`. `EXECUTE` revoked from `PUBLIC`/`anon`;
  granted only to `authenticated`. Fixed `SET search_path = public`.
  Denies Basic / expired / cancelled / past_due / inactive / missing plan.
  Allows Pro, Premium, and any active-trial society.
- Replaces `public.transition_income_record(uuid, text, text)`:
  - Non-enumerating response — missing row, cross-society row, and
    non-admin caller all return `{ status: "not_found" }`. `plan_required`
    is returned only after society membership is established.
  - Plan entitlement enforced *inside* the RPC via
    `is_non_member_income_enabled_internal`.
  - Unused `v_new_recon` variable removed.
  - Grants unchanged: `REVOKE ALL ... FROM PUBLIC`, `REVOKE ALL ... FROM anon`,
    `GRANT EXECUTE ... TO authenticated`.

**Wrapper hardening** (`src/lib/non-member-income.functions.ts`).
- Mutation input surface remains `{ recordId }` (+ optional `reason`). No
  caller-controlled `societyId`, `actorId`, `plan`, `currentStatus`, `amount`,
  or `category`.
- `authorizeMutation` collapses "signed-in but not a society admin" to
  `not_found`, matching the RPC's non-enumerating shape.
- `callTransitionRpc` validates the RPC response with the new strict
  `IncomeTransitionResultSchema` (Zod `discriminatedUnion`). Any malformed
  payload becomes `{ status: "error" }`; raw RPC JSON is never surfaced.

**OAuth consent audit.** `src/routes/[.]lovable.oauth.consent.tsx` builds its
`?next=` return path from `location.pathname + location.searchStr` at redirect
time — a same-origin app path never taken from user input — so no
`sanitizeNextPath` change was required for the OAuth-protocol callback. The
generic post-login return path was already sanitized in Turn 18B Part 0.

**Test surface.** +16 unit tests covering `IncomeTransitionResultSchema`
(success/malformed/unknown-status), wrapper input minimalism, wrapper
non-enumerating response, migration hardening (helper presence, plan gate,
argument allow-list, GRANT/REVOKE lines, `v_new_recon` removal). Full unit
suite: 228 / 228 passing.

**Integration status.** Direct-PostgreSQL role-transition scenarios (bypass
tests #1–#20 in the turn brief) require isolated PostgreSQL fixture variables
that are unavailable in this sandbox. Wrapper- and schema-level behavior is
verified by the unit suite; direct-RPC runtime authorization is *not* claimed
verified end-to-end and is deferred to Turn 18B.3's guarded integration run.

## Turn 18B.2B — Entitlement helper privacy + exact plan parity

Additive migration `20260715181730_3e51af37-...sql`:

- `public.is_non_member_income_enabled_internal(uuid)` — EXECUTE revoked from
  `PUBLIC`, `anon`, and `authenticated`. Only reachable through
  `public.transition_income_record`, which runs SECURITY DEFINER as the
  owning role (`postgres`) and thus retains execute privilege on the helper.
  No caller-facing role can any longer probe arbitrary society UUIDs for plan
  entitlement.
- Helper alias list now mirrors `normalizePlan()` exactly:
  `pro | standard | growth | premium | business | enterprise` for paid;
  `expired | cancelled | canceled | past_due | inactive` for denied;
  `trial | trialing` gated on `trial_ends_at` being NULL or in the future.
- `plan_id = 'trial'` (18B.2A) no longer grants entitlement on its own —
  stale trial rows can no longer inherit Premium indefinitely.

TypeScript `normalizePlan(raw, status, trialEndsAt?)` extended with an
optional `trialEndsAt` argument: an active trial status with a past expiry
normalizes to `basic`. Legacy 2-arg callers preserve historical behavior.
`assertProPlan` in `non-member-income.functions.ts` now selects
`trial_ends_at` and passes it into `normalizePlan`.

`IncomeTransitionResultSchema` hardened: every variant is `.strict()`,
`success.changedAt` requires `z.string().datetime({ offset: true })`. Any
unknown field or malformed timestamp collapses to `{ status: "error" }`.

**Tests.** 264/264 unit tests passing. New coverage:

- Canonical plan-parity matrix (26 cases, active/expired trials, aliases,
  case/whitespace, unknown data).
- Migration privacy checks (REVOKE from PUBLIC/anon/authenticated, no
  re-GRANT).
- Alias/trial-expiry SQL parity to `normalizePlan`.
- No client, hook, component, or MCP tool references the helper.
- Strict schema + ISO datetime enforcement.

**Direct-PostgreSQL runtime status.** Isolated PG fixtures for
authenticated-role EXECUTE probing remain deferred to Turn 18B.3's guarded
integration suite; grant state is verified through migration-string tests
and observed via `information_schema.routine_privileges` in the applied DB.

Build passing. Client bundle secret scan clean (892 files, no server-only
indicators).

## Stage 1D — Category Management, Payer Directory, Offline Income Entry

Stage 1D is the first delivery under the **V2 roadmap format**
(`docs/SOCIYOHUB_MASTER_ROADMAP_V2.md`). The old nested Turn-based names are
now historical; further Income & Collections work uses only Stage 1 letters.

### Part 1 — security debt (already closed)

The Part 1 security checklist (entitlement helper not executable by
PUBLIC/anon/authenticated, exact `normalizePlan` parity in SQL, stale/expired
trial denied, unknown plan denied, strict `IncomeTransitionResultSchema`
with `.strict()` variants and ISO-offset `changedAt`) was **already fully
delivered** by migration `20260715181730_3e51af37…` and the schema hardening
recorded above. Stage 1D adds no new migration for Part 1 — re-migrating
would only churn history. The V2 roadmap records this state as complete
under Stage 1C.

### Foundation documents (this stage)

- `docs/SOCIYOHUB_MASTER_ROADMAP_V2.md` — flat, letter-scoped roadmap.
- `docs/FEATURE_COVERAGE_V2.md` — coverage matrix across 24-prompt inventory,
  current implementation, plan/role, tests, visual QA, remaining stage.
- `docs/UI_DESIGN_SYSTEM_V2.md` — tokens (color / gradient / radius /
  spacing / typography / motion) and composition rules.

### Remaining Stage 1D scope (in progress)

- `/society/income/categories` — category management screen + create/edit
  dialog, reusing existing `listIncomeCategoriesFn` /
  `createIncomeCategoryFn` / `updateIncomeCategoryFn`.
- `/society/income/payers` — external-payer directory, reusing
  `listNonMemberPayersFn` / `createNonMemberPayerFn` /
  `updateNonMemberPayerFn`, with data-minimized default list.
- `/society/income/new` — 3-step Details / Review / Saved flow reusing
  `createNonMemberIncomeRecordFn`.
- Dashboard action wiring (Record Income / Add Payer / Manage Categories).
- Unit + integration tests, exit gate.

No Stage 1D work touches AI categorization, Smart QR, online gateways, or
platform fees; those remain Stage 9 / 10 / 14.

---

# Stage 1D — Partial Closure (Product Quality Pass)

## What shipped in this pass

Focused fixes on the three routes already created for Stage 1D — quality,
privacy, and workflow correctness. No new stages started, no skills touched.

### Payer privacy split (server)

- `listNonMemberPayersFn` now selects **only safe columns** from
  `non_member_payers`: `id, payer_type, display_name, organization_name,
  is_active, created_at`. Phone, email, reference_code, notes and
  society_id are never fetched or transmitted on the default list path.
- New authorized detail server function
  `getNonMemberPayerDetailFn(societyId, payerId)`:
  - `requireSupabaseAuth` + admin + Pro plan on the target society.
  - Returns the editable contact fields only after society-scoped
    ownership matches.
  - A missing or cross-society record returns `{ code: "not_found" }`,
    identical to the truly missing case — no enumeration side-channel.

### Render-phase state bug fixed

- `CategoryDialog` and `PayerDialog` previously called setState during
  render via a `lastOpen` sentinel. Both now use `useEffect(..., [openKey])`
  to hydrate their form state safely. React no longer warns; behaviour is
  identical from the user's perspective.

### External Payers page

- Renamed the page to "External Payers"; supporting copy updated to
  "Manage vendors, advertisers and other non-member payers."
- Row rendering no longer displays phone (default list contract does
  not carry it in the first place).
- Edit action now opens a dialog that shows a loading state, fetches the
  authorized detail through `getNonMemberPayerDetailFn`, and renders a
  generic "This payer is unavailable" message when the detail is missing
  or inaccessible.
- Local `PayerItem` interface reduced to the safe list contract; the
  full contact object no longer flows through the list at all.

### Record Offline Income — three-step flow

`/society/income/new` is now a proper three-step wizard:

1. **Details** — category, payer kind (non-member or anonymous), external
   payer selector, amount, payment date, payment method, reference,
   description. Client validation is convenience-only; server remains
   authoritative.
2. **Review** — read-only accounting review with masked reference,
   `Pending` verification chip, `Unreconciled` reconciliation chip, and
   the explicit sentence "This record will be saved as pending
   verification." Actions: **Back**, **Save Income Record**.
3. **Saved** — restrained confirmation. Shows amount, payer, category,
   method, date, masked reference and short record identifier. Actions:
   **View Record**, **Record Another**, **Back to Income**. Never uses
   "Payment successful" copy.

Cash and Bank Transfer are the **only** payment methods visible in the
UI. The `other_offline` option has been removed from the entry form.
The server still accepts existing `other_offline` records for backward
compatibility with previously-created rows.

Query invalidation on successful create broadens to
`["society-income"]`, refreshing dashboard, list, categories and payers.

Amount validation rejects scientific notation and more than two decimal
places. Future dates are rejected.

Errors are mapped through a `friendlyError()` helper that never surfaces
raw Supabase / PostgreSQL error text.

### Verification

- `bunx tsgo --noEmit` — passed.
- `bun run build` — passed (build succeeded, ~47s).
- `bun scripts/verify-client-bundle-secrets.ts` — OK, no server-only
  indicators in the client bundle.
- Protected society `baldha Meetarth`
  (`1907a918-c4b8-4f43-a837-450530cc7c34`) not accessed at any point.

## Explicitly still remaining inside Stage 1D

The full Stage 1D exit gate described in the roadmap is **not yet**
complete. The following items remain and are the honest gap this pass
did not close in a single response:

1. Premium V2 redesign of the Categories page: summary cards, typed
   filters (search/All/Active/Inactive/System/Custom/group), safe usage
   count, semantic pastel icon tiles, glass dialog shell.
2. Premium V2 redesign of the External Payers page: summary cards,
   debounced search, payer type filter, active/inactive filter, server
   pagination, initials avatar.
3. Server-side idempotency token for create-income (browser-provided
   UUID, society-scoped unique constraint, additive migration). Current
   double-submit prevention is UI-only via mutation state.
4. Additional unit tests in `tests/unit/non-member-income.test.ts`
   covering the new list projection (no phone/email/notes/reference_code
   in the default contract), the three-step controller, amount
   validation edge cases, and query-key invalidation.
5. Integration tests behind `ALLOW_SOCIOHUB_TEST_FIXTURES` for Society A
   / Society B isolation, plan gating, and role gating.
6. Direct responsive inspection at 360 / 390 / 414 / 768 / 1280 px with
   screenshots.
7. Basic-plan protected-call-count verification against the current
   FeatureGate + `requireAdminAndPlan` chain.

These items remain **inside Stage 1D**. Stage 1E has not been started.

## Stage 1D — Turn 19: server-side idempotency, typed errors, query-key factory

Scope of this pass (honest, incremental — Stage 1D is still open):

### Delivered

1. **Server-side idempotency for offline income creation.**
   - New migration (`20260716…creation_request_id`) adds a nullable
     `creation_request_id uuid` column on `society_income_records` plus a
     partial unique index on
     `(society_id, created_by, creation_request_id) WHERE creation_request_id IS NOT NULL`.
     No backfill, no seeding, no changes to existing rows or policies.
   - `CreateIncomeRecordInput` accepts an optional `creation_request_id`
     (UUID, validated by Zod).
   - `createNonMemberIncomeRecordFn` now inserts with the key, and on
     unique-index violation (`23505`) fetches and returns the original
     record id under `{ id, idempotent: true }`. First success returns
     `{ id, idempotent: false }`. Actor, society, plan, status and audit
     fields are still server-derived; the browser only supplies the key.
2. **Income wizard hardening.**
   - `society.income.new.tsx` generates one `crypto.randomUUID()` on
     transition to Review, reuses it across Save retries, and regenerates
     it on "Record Another". Double-clicks and retries can no longer
     create duplicate financial records.
3. **Typed error contract.**
   - New `src/lib/income-errors.ts` maps every known server code
     (`forbidden_plan`, `forbidden_society`, `category_inactive`,
     `payer_inactive`, `duplicate_category_key`, `not_found`, …) to a
     small closed union and collapses unknowns to `temporary_error`. Raw
     Postgres / constraint text cannot reach the UI through this path.
4. **Central query-key factory.**
   - New `src/lib/income-query-keys.ts` provides society-scoped keys for
     dashboard, records, categories, active-categories, payers,
     active-payers, and payer detail, plus a canonical `incomeInvalidations`
     mutation-target map. Filters/pages are folded into the key; "all" and
     empty values are normalised so unrelated churn is impossible.
5. **Focused unit tests.**
   - New `tests/unit/income-idempotency.test.ts` (11 tests) covering the
     `creation_request_id` schema, typed error mapping, no-DB-leak
     guarantees, and query-key factory shape.
   - Full unit suite: **275 tests passing** (13 files).
6. **Verification (this pass).**
   - `bunx tsgo --noEmit` — exit 0.
   - `bunx vitest run tests/unit` — 275/275 passing.
   - `bun run build` — success.
   - `bun scripts/verify-client-bundle-secrets.ts` — clean (897 files).
   - `git diff --check` — clean.

### Explicitly still remaining inside Stage 1D

Stage 1D is **not** marked complete. The following items are still open
and must not be moved into Stage 1E:

1. Premium V2 redesign of `/society/income/categories` (summary cards,
   pastel icon tiles, typed filter bar, glass dialog shell).
2. Premium V2 redesign of `/society/income/payers` (summary cards,
   debounced search, type filter, server pagination, initials avatar,
   safe-loading edit dialog reusing the existing detail server fn).
3. Migrating existing route callers to the new `incomeKeys` /
   `incomeInvalidations` factory (currently only the new tests consume
   it; the routes still use ad-hoc keys). This is a mechanical follow-up.
4. Expanded unit tests: private-payer-list projection assertions on the
   real list response shape, category-summary helpers, payer-summary
   helpers, and wizard-controller state machine.
5. Guarded integration tests behind `ALLOW_SOCIOHUB_TEST_FIXTURES` for
   Society A / Society B isolation, plan gating, role gating, duplicate
   `creation_request_id` returning one row, and safe list projection.
6. Direct responsive inspection at 360 / 390 / 414 / 768 / 1280 px with
   captured screenshots for every wizard step and both directory pages.
7. Basic-plan zero-protected-call harness (component-level test that a
   Basic society renders `UpgradePrompt` and issues zero category /
   payer / detail / create calls).
8. Documentation sync across `SOCIYOHUB_MASTER_ROADMAP_V2.md`,
   `FEATURE_COVERAGE_V2.md`, `UI_DESIGN_SYSTEM_V2.md`, `FEATURE_MATRIX.md`,
   `UI_REFERENCE_MAP.md`, `PAYMENT_ARCHITECTURE.md`,
   `SECURITY_REQUIREMENTS.md`, `NEXT_STAGES.md`, `RELEASE_READINESS.md`.

### Payment constraints reconfirmed

Cash and Bank Transfer are the only methods surfaced in the Stage 1D
income-entry UI. `other_offline` remains in the backend enum for legacy
rows only. Razorpay stays subscription-only. No Stripe, Paddle, UPI,
card, wallet, payment link, online gateway, platform fee, or
reconciliation was added or removed in this pass.

### Protected society

`baldha Meetarth` (`1907a918-c4b8-4f43-a837-450530cc7c34`) was **not**
queried, seeded, probed, migrated against, or otherwise accessed in this
pass. The migration is additive DDL only; no rows were read or written.
