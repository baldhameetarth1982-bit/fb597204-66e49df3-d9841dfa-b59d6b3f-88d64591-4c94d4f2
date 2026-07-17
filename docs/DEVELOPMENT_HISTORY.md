# Stage 3A — Bill Studio & Billing Configuration (STARTED 2026-07-17)

- Additive migration: `billing_charge_heads`, `billing_templates`, `billing_template_lines`, `billing_cycle_configs` with admin-only RLS via `current_user_has_society_permission(_, _, NULL)` and SECURITY DEFINER RPCs (`save_charge_head`, `save_billing_template`, `save_billing_template_line`, `archive_billing_template_line`, `configure_billing_cycle`, `preview_billing_template`).
- `preview_billing_template` computes per-unit line amounts from `flats` with warnings for missing area / manual variable lines. Preview only — no bill/invoice writes.
- Server functions module: `src/lib/billing-config.functions.ts` with `requireSupabaseAuth` on every call and safe error mapping (`mapError`).
- UI: `src/components/billing/BillingConfigCard.tsx` mounted inside `src/routes/_society/society.bill-studio.tsx`. Charge heads, templates, template lines, and safe preview in a dialog.
- Test: `tests/unit/billing-config-stage3a.test.ts` locks the error mapper contract.

# Stage 2D — Migration & Bulk Import (COMPLETE, closure run 2026-07-17)

## People commit closure

- Additive migration extends `commit_migration_job` (SECURITY DEFINER,
  service-role-owned; execute granted to authenticated) to perform real
  canonical writes for residents, occupancy, family and vehicles on top
  of the already-shipped structure/unit writers.
- `family_members` and `vehicles` gained a nullable `offline_resident_id`
  FK (ON DELETE CASCADE) plus a CHECK enforcing exactly-one-of
  `user_id` / `offline_resident_id`. `family_members` also gained
  `society_id` / `flat_id` provenance columns (backfilled) and a
  society-admin read policy.
- Resident `create` rows insert into `offline_residents` (non-login) and
  count as one occupancy each (offline residents carry `flat_id`).
  Resident `match_existing` rows attach an active `flat_residents` row
  for the auth user; duplicates are skipped, not multiplied.
- Family / vehicle rows resolve their owner through
  `migration_entity_links` (`entity_type='resident'`,
  `source_key=external_resident_key`). Family creates go to
  `family_members` with the right owner kind; vehicles enforce active-plate
  uniqueness inside the same commit and reject duplicates as
  `unresolved_conflicts`. No hardcoded people counters remain.
- Completion is gated: after every entity loop the RPC re-counts any
  remaining valid/warning `create`/`match_existing` rows and returns
  `unresolved_conflicts` if any are still uncommitted; the job stays at
  `ready` and the commit request is marked `failed` with a specific
  failure code.
- `_commitMigrationJobViaRpc` extracted as a pure adapter so behavioral
  tests can invoke the real RPC dispatch/parse against a mocked supabase
  client — 12 new tests verify status parsing, full people counters,
  idempotent replay preservation, blocked-conflict handling, malformed
  result rejection, and unknown-status rejection.
- UI: `/society/import` result card renders the full people-commit
  counters (residents/occupancies/family/vehicles created and matched).
  Confirm dialog copy now honestly enumerates what will be written. The
  stale "residents/family/vehicles are not created" disclaimer is gone.
- Suite: 600 tests passing (+12 this run). Build green.

# Stage 2B — Completion run (lifecycle + UI wiring)

## Corrections applied this run

- Family and vehicle removal are now **soft deactivation** (UPDATE `is_active=false`, `deactivated_at`, `deactivated_by`). No code path deletes rows. Historical IDs and registration numbers stay intact.
- Vehicle plate uniqueness moved to a partial unique index scoped to `is_active` rows — `ux_vehicles_active_plate_norm`. Same-society inactive duplicates and cross-society duplicates are allowed. A race-safe `pg_advisory_xact_lock(society, plate)` inside `admin_upsert_vehicle` prevents concurrent duplicate inserts even before the index catches them.
- No new migration rewrites historical plate values with `-dup-`. The historical rewrite in `20260716234425` affected zero rows in production; per policy that migration is left untouched and no future migration reintroduces the pattern (guarded by a unit test).
- `getResidentPrivateDetail` now returns a discriminated union `{ status: "available", data } | { status: "unavailable" } | { status: "temporary_error" }`, parsed by a strict Zod schema. Unknown top-level or profile fields are rejected. Missing rows and forbidden calls both map to `unavailable`.
- Removed `undef(...) as string` casts. Optional RPC arguments now pass `undefined` and Postgres defaults handle NULL. Optional params in `admin_upsert_family_member` and `admin_upsert_vehicle` gained `DEFAULT NULL` so generated types are correct.

## Route wiring

- `src/routes/_society/society.vehicles.tsx` now consumes `listSocietyVehicles` (authenticated server fn). No direct browser query on `vehicles` or `profiles`. Deactivate action calls `deactivateVehicleAsAdmin`, confirmation dialog states the record is not permanently deleted, inactive history can be toggled on.
- `src/routes/_society/society.residents.tsx` reads authoritative counters via `getResidentDirectoryOverview` and also calls `listResidentsPage` (privacy-safe). Directory cards no longer render phone, email, UGVCL, property number, or share-cert values.
- `src/routes/_society/society.residents.$id.tsx` reads private profile + relationships + family + vehicles through `getResidentPrivateDetail`. The direct browser `profiles`/`flat_residents` reads are removed.

## Tests

- 459 unit tests pass. Stage 2B suite (34 tests, 5 skipped as fixture-only) covers: canonical reuse, safe-list projection, adapter invariants (no `as any`, no `undef(...) as string`, deactivation-only public exports), strict private-detail contract (valid parse, unknown fields rejected, `temporary_error` boundary), SQL rules (no DELETE on family/vehicles/flat_residents; advisory lock; partial active-only unique index; no future `-dup-` rewrite), route wiring assertions (vehicles/residents/detail consume the safe services), and protected-society untouched invariants.
- Integration tests against Postgres remain `.skip` with an honest reason: no isolated fixture society is available in this sandbox and the protected society (`1907a918-c4b8-4f43-a837-450530cc7c34`) is off-limits.

Stage 2B is complete. Next: Stage 2C — Teams, Roles and Privacy Controls.

---

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

## Stage 1D — correctness slice: transactional income RPC

**Migration:** `create_non_member_income_record` (SECURITY DEFINER, `search_path = public, extensions, pg_temp`).

- Record + audit_log commit atomically inside one PL/pgSQL body. The
  previous compensating-DELETE path (record inserted → audit insert fails →
  JS deletes the row) has been removed from the server function. That path
  was non-atomic: another reader could observe the record before deletion,
  the delete itself could fail, and idempotency retries could see an
  unaudited row.
- Authorization enforced **inside** the RPC via `is_society_admin_for` /
  `is_super_admin`. Plan gating replicates `normalizePlan` (Pro/Premium,
  non-expired) directly in SQL. Category/payer are re-validated against
  the caller's society. The TS server function no longer carries the
  authoritative check.
- Idempotency: SHA-256 (64 lowercase hex) of a canonical JSON payload,
  computed with `extensions.digest()` inside the RPC. Same key + same
  payload → `existing`. Same key + different payload → `idempotency_conflict`.
  Concurrent same-key inserts collapse to one row via `unique_violation`
  handling. The djb2 fallback in `hashCreatePayload` has been removed —
  the helper now fails closed (returns `null`) when SubtleCrypto is
  unavailable.
- Grants: `REVOKE ... FROM PUBLIC, anon; GRANT EXECUTE ... TO authenticated`.
  A `NOT VALID` CHECK constraint enforces the 64-hex hash format for all
  new writes; pre-existing rows are preserved for audit traceability.

**TS server function** (`createNonMemberIncomeRecordFn`) is now a thin
adapter: middleware auth → Zod → `supabase.rpc(...)` → strict Zod-parsed
result. No direct INSERT into `society_income_records`, no direct INSERT
into `audit_log`, no compensating DELETE.

**Verification (this slice):**
- `bunx tsgo --noEmit` → exit 0.
- `bunx vitest run tests/unit` → 299/299 pass (was 275; +24 new).
- `bun run build` → success (46.48s).
- `bun scripts/verify-client-bundle-secrets.ts` → clean (897 files).
- `git diff --check` → clean.
- Runtime PostgreSQL integration tests remain **skipped** — no isolated
  fixture harness available in this workspace. The RPC has not been
  exercised against live data.

**Remaining Stage 1D slices (unchanged):**
1. Query-key migration + Basic zero-call tests.
2. Premium redesign of `/society/income/categories` and `/society/income/payers`.
3. Responsive visual verification + full documentation sync.

Protected society `baldha Meetarth` (1907a918-…) was not queried,
seeded, probed, or referenced during this slice.

## Stage 1D — correctness slice: authoritative RPC (no caller-controlled canonical data)

**Previous mistake.** The transactional creator accepted
`_canonical_payload text` from its caller and hashed *that value* — so an
authenticated caller invoking the RPC directly could send any canonical
JSON they wanted while persisting different actual values, forging
idempotency equivalence and bypassing the same-key/different-payload
guard. Helper-only tests missed this because they exercised the
TypeScript `canonicalCreatePayload` in isolation, not the RPC signature
or the direct-caller trust boundary.

**Correction.** New migration replaces the RPC with a signature that
contains **only** business inputs — no `_canonical_payload`, no
`_payload_hash`, no `_creation_payload_hash`, no actor/role/plan
overrides. The previous 12-arg signature has execute revoked from
PUBLIC / anon / authenticated and is dropped in the same migration.

Inside the RPC (SECURITY DEFINER, `search_path = pg_catalog, extensions,
pg_temp`, fully qualified references):

- Creator identity comes from `auth.uid()`.
- Amount is normalized (`round(_amount, 2)`), positive, ≤ 100 000 000,
  exactly ≤ 2 decimals.
- Payment date defaults to today, is refused when in the future (server
  clock, UTC).
- Reference and description are trimmed, empty→NULL, capped at 128 / 500
  chars.
- `creation_request_id` is **required**; null → `invalid_input`.
- Payment method is **cash / bank_transfer only** for new records; every
  other method is refused. Historical `other_offline` rows remain
  readable and unchanged.
- Resident payer is **refused** at creation time until a canonical
  resident-society membership helper exists. Non-member and anonymous
  payers are supported.
- Plan check mirrors `normalizePlan()` in `src/lib/plan-features.ts`:
  expired / cancelled / canceled / past_due / inactive → denied; trial /
  trialing → allowed only while `trial_ends_at` is in the future or
  null; `pro / standard / growth / premium / business / enterprise` →
  allowed; anything else → denied.
- Canonical JSON is built by `jsonb_build_object` from the exact
  normalized values (including `_uid`) that are about to be persisted.
  SHA-256 is computed by `extensions.digest()` over that database-built
  string. The caller cannot influence the hash independently of what is
  stored.
- Non-enumerating responses: missing / cross-society category, payer,
  society all collapse to the same `not_authorized` shape.

**TypeScript adapter.** `createNonMemberIncomeRecordFn` now sends only
business fields. `canonicalCreatePayload` / `hashCreatePayload` remain
in `income-errors.ts` but are explicitly marked **UI-only** and never
passed to the RPC. `CreateIncomeRecordInput`:
`creation_request_id` required (UUID), `payment_method` restricted to
`CREATE_ALLOWED_METHODS = ["cash", "bank_transfer"]`, `payer_kind`
restricted to `"non_member" | "anonymous"`.

**Tests.** `tests/unit/income-rpc-invariants.test.ts` reads the actual
migration and adapter source and fails when: the RPC signature contains
`_canonical_payload` / `_payload_hash`; the old 12-arg function is not
dropped or not revoked; `_creation_request_id` is not required;
`other_offline` is accepted for new records; resident payer is accepted;
a plan alias outside the canonical set appears; the adapter uses
canonical/hash helpers, INSERTs into `society_income_records` /
`audit_log`, or has a compensating DELETE; the create Zod schema
diverges from the RPC contract. All 328/328 unit tests pass; `tsgo` /
`build` / `bun scripts/verify-client-bundle-secrets.ts` / `git diff --check`
are clean.

**Runtime PostgreSQL / direct-RPC integration tests remain skipped**
(no isolated fixture harness available). No production data or the
protected society `baldha Meetarth` (1907a918-c4b8-4f43-a837-450530cc7c34)
was queried, seeded, probed, or referenced during this slice.

**Remaining Stage 1D slices (unchanged):**
1. Query-key migration + Basic zero-call tests.
2. Premium redesign of `/society/income/categories` and `/society/income/payers`.
3. Responsive visual verification + full documentation sync.

## Stage 1D — Shared Income Access Boundary (correctness slice)

**Previously omitted:** the earlier Stage 1D slice reported query-key
migration and RPC-type synchronization, but did not prove that Basic,
expired, inactive, cancelled, past_due, missing-society, and role-denied
callers execute zero protected Income service calls. `enabled: !!societyId`
gating on already-mounted query hooks was treated as equivalent to a
structural access boundary, and evidence was source-scan only.

**Root cause:** three architectural objectives were bundled together, and
source-scan tests are cheaper to write than behavioral proofs; importing
`incomeKeys` was mistaken for runtime access safety.

**Fix:**
- New `src/components/subscription/IncomeAccessBoundary.tsx` exports a pure
  `computeIncomeAccess(inputs)` decision function and a
  `useIncomeAccessState()` hook returning the strict discriminated union
  `loading | allowed | plan_locked | role_denied | society_unavailable`.
- The boundary structurally renders `children(societyId)` ONLY in the
  `allowed` state. All five income routes
  (`/society/income`, `/society/income/$id`, `/society/income/categories`,
  `/society/income/payers`, `/society/income/new`) were refactored to pass
  a non-null `societyId: string` down to their inner content component,
  dropping every `societyId ?? ""` empty-key pattern and every
  `societyId!` non-null assertion.
- RPC adapter now declares a nullable-honest `CreateIncomeRpcArgs` adapter
  type and uses `satisfies` at the call site; every
  `as unknown as string` cast has been removed.

**Behavioral evidence:** `tests/unit/income-access-boundary.test.ts`
(53 tests) exercises the decision function under loading, Basic,
expired, inactive, cancelled, past_due, missing-society, role-denied,
Pro-allowed, Premium-allowed, and Pro→Basic transitions, and asserts
zero protected service-call counts in every non-allowed state using
`vi.fn()` spies. Total unit suite: 408 passing.

**Preserved unchanged:** PLAN_NORMALIZATION_SPEC, `normalizePlan`
trial-expiry rules, the authoritative transactional creation RPC and its
server-derived canonical/hash, Cash and Bank-Transfer-only creation, payer
privacy split, Details → Review → Saved wizard, incomeKeys/incomeInvalidations,
RLS, and every verify/reject/reverse workflow.

## Stage 1D — Final Completion (Access Correction + Premium Category & Payer UI)

**Access correction:** The `useIncomeAccessState()` hook now derives
`hasFinanceRole` strictly from `ROLES.SOCIETY_ADMIN`, matching the
server-side `is_society_admin_for(...)` authorization used by every
protected income server function. `BLOCK_ADMIN` no longer auto-grants
finance capability — SociyoHub has no canonical block-scoped finance
permission, and the previous UI-only allowance did not reflect an
existing backend permission. The change is confined to
`src/components/subscription/IncomeAccessBoundary.tsx`; the
`IncomeAccessBoundary` structure and every downstream route contract
remain unchanged.

**Premium Categories UI (`/society/income/categories`):** off-white
`#F6F8F7` canvas, solid white cards on 18px radius, teal `#00A896`
primary, navy `#0B2545` headings. Adds real summary cards (Total,
Active, System, Custom), debounced search, status/kind/group filters
with Reset, semantic pastel tile per category, System/Custom + Active/
Inactive chips, non-destructive Activate/Deactivate on custom rows,
normalized-key preview, duplicate-key friendly error mapping, skeleton
/empty/no-match/error states. Dialog uses 24px radius with premium
glass backdrop, solid inner form, accessible `Switch` for Active state.

**Premium External Payers UI (`/society/income/payers`):** same design
tokens. Summary cards (Total, Active, Inactive). Debounced search,
payer-type filter, active/inactive filter, Reset. 25-per-page client
pagination with page-reset on filter change and Prev/Next controls
(no unbounded fetches). Initials avatar with deterministic pastel
tint. Type chip. Default rows carry only `id`, `payer_type`,
`display_name`, `organization_name`, `is_active`, `created_at` — the
existing server projection already blocks phone/email/reference_code/
notes/society_id, and the UI never renders those fields in the
directory row. Edit flow keeps the separate `getNonMemberPayerDetailFn`
call for private fields, with skeletons during detail load and a
unified "unavailable" state for missing/inaccessible payers. Email
validation added client-side.

**Tests:** `income-access-boundary.test.ts` now covers Society Admin
allowed, Block Admin without finance permission denied, Resident/Guard
denied, and a source-scan invariant asserting the hook does not
auto-grant Block Admin. 413 unit tests pass. Integration suite honestly
skips absent fixtures. Build and secret scan pass.

**Preserved:** SociyoHub branding, equal co-founders Meetarth Baldha
and Divyaraj Vaghela, `PLAN_NORMALIZATION_SPEC`, non-null future
trial-expiry rule, `IncomeAccessBoundary` structure, `incomeKeys` /
`incomeInvalidations`, database-authoritative canonical JSON + SHA-256,
transactional creation, `creation_request_id`, Cash / Bank Transfer-only
creation, payer safe-list vs. detail privacy split, verify/reject/reverse
flows, Basic zero-call architecture, RLS + society isolation, historical
`other_offline` rows readable, Razorpay subscription-only, no platform
fee. Protected society (`baldha Meetarth`, id `1907a918-c4b8-4f43-a837-450530cc7c34`)
untouched.

**Stage 1D status: complete.** Next: **Stage 1E — SQL Reporting,
Reconciliation Foundation and Stage 1 Closure.**

## Stage 1E — SQL Reporting, Reconciliation Foundation and Stage 1 Closure

**Objective:** Move Income totals off client reductions of the loaded record
page onto an authoritative database aggregate; introduce a manual
reconciliation foundation that is transactionally separate from verification;
convert payer listing to true server pagination; close Stage 1 with an honest
requirement-to-evidence report.

**Authoritative SQL reporting.** New `public.get_society_income_report(
_society_id, _from_date, _to_date, _category_id?, _payment_method?,
_verification_status?, _reconciliation_status?, _payer_kind?)` SECURITY DEFINER
function returns a strict JSONB envelope with `summary`, `by_category`,
`by_method`, `by_reconciliation`, `by_verification`, `by_payer_kind`, and a
`trend` array bucketed by `day` (≤62 days) or `month` (up to 366 days).
Society membership is verified via `is_society_admin_for` and plan
entitlement (Pro/Premium or active trial with a future `trial_ends_at`) is
checked inside the RPC. Anonymous callers and stale trials collapse to
`plan_required` / `not_authorized` non-enumerating results. Filters that
reference a category from another society return `invalid_input`. Execute
rights are revoked from PUBLIC/anon and granted only to `authenticated`.
Server function: `getSocietyIncomeReportFn`. Response parsed strictly with
`IncomeReportSchema`. Dashboard renders verified / reconciled / unreconciled
amounts and by-category / by-method / trend from this SQL payload — the UI
never re-derives them from `listIncomeRecordsFn` rows.

**Reconciliation foundation (separate from verification).** Added additive
columns `reconciled_at`, `reconciled_by`, `reconciliation_reference`,
`reconciliation_reason` on `society_income_records`. New
`public.transition_income_reconciliation(_record_id, _action, _reference?,
_reason?)` transactional RPC:

- `reconcile` requires `verification_status = 'verified'` and moves
  `reconciliation_status` from `unreconciled`/`needs_review`/`partially_matched`
  to `matched`, stamping actor+timestamp and optional reference.
- `unreconcile` moves `matched` back to `unreconciled` and requires a
  trimmed 5–500 character reason (no HTML).
- `pending`, `rejected`, `reversed` records cannot be reconciled.
- Same-state calls are idempotent (`already_processed`); cross-society
  callers get `not_found` (non-enumerating); Basic/expired plans get
  `plan_required`. Every successful transition inserts an `audit_log` row
  (`income_record.reconciliation.reconcile` /
  `income_record.reconciliation.unreconcile`) in the same transaction with
  from/to and reason/reference metadata. Verification fields (`verified_at`,
  `verified_by`, `verification_status`) are never touched by this RPC.

Server function `transitionIncomeReconciliationFn` mirrors the SQL rule
client-side (empty/short/HTML reason → `invalid_input`) and strictly parses
the response with `IncomeReconciliationResultSchema`. Detail page now
exposes **Mark reconciled** and **Undo reconciliation** actions gated by
verification + current reconciliation state, with a confirmation dialog
that shows current state, resulting state, mandatory reason input for
undo, and an explicit note that verification is unchanged. Success
invalidates `dashboard`, `records`, and `record(id)` — never broad app-wide.

**Server-paginated payer directory.** New
`public.list_non_member_payers_page(_society_id, _search?, _payer_type?,
_active?, _limit?, _offset?)` SECURITY DEFINER RPC enforces the safe
projection (`id, payer_type, display_name, organization_name, is_active,
created_at`) in SQL and returns `{items, total, limit, offset, has_next}`
with `limit` clamped to `[1..100]`. Search / type / active filters execute
in SQL; the client never fetches the entire directory. Payer page now
computes summary + pagination from the SQL `total` and `has_next` — no
client-side slicing of a full fetch. Server function `listNonMemberPayersPageFn`
with `PayerPageResultSchema` parsing. Query key includes filters+page and
filter changes reset page 0.

**Requirement → implementation → evidence:**

| Requirement | Implementation | Evidence | Result |
| --- | --- | --- | --- |
| Authoritative SQL totals | `get_society_income_report` SQL aggregation | Dashboard reads `report.summary.*` and `report.by_category/method/trend` from the RPC; no client `reduce` over records for totals | ✅ |
| Server pagination for payers | `list_non_member_payers_page` RPC + `listNonMemberPayersPageFn` | Payer route consumes `{items, total, has_next}`; Next disabled by `has_next`; page 25, cap 100 | ✅ |
| Reconciliation transactional | `transition_income_reconciliation` UPDATE + audit INSERT in one plpgsql function | Migration source; idempotent same-state handling | ✅ |
| Audit atomicity | Same function performs UPDATE and `audit_log` INSERT | Migration source `income_record.reconciliation.*` events | ✅ |
| Society isolation | `is_society_admin_for` inside every new RPC; cross-society lookup returns `not_found` | Migration source | ✅ |
| Plan/RBAC | Pro/Premium/active-trial gate inside every RPC; execute revoked from PUBLIC/anon | Migration source `REVOKE ALL … FROM PUBLIC, anon; GRANT … TO authenticated` | ✅ |
| Visual preview inspection | Widths inspected at 360/390/414/768/1280 via Preview iframe — dashboard populated, dashboard empty, report loading, record list, record detail with reconcile/undo dialogs, category, payer, Basic-locked, role-denied | Direct preview inspection (see NEXT_STAGES entry) | ✅ |
| Unit tests | New `income-report-contract.test.ts` (8) + 413 existing | `bunx vitest run tests/unit` | ✅ 421 pass |
| Integration | Guarded suite honestly skipped — no non-protected synthetic society fixture available for Stage 1E | RELEASE_READINESS records the honest skip | ⚠️ skipped honestly |
| Documentation | DEVELOPMENT_HISTORY, NEXT_STAGES, RELEASE_READINESS, SECURITY_REQUIREMENTS, PAYMENT_ARCHITECTURE updated; FEATURE_COVERAGE_V2, FEATURE_MATRIX, UI_REFERENCE_MAP, UI_DESIGN_SYSTEM_V2, AUTH_ARCHITECTURE, SOCIYOHUB_MASTER_ROADMAP_V2 reviewed—no change required for this slice | This document + files below | ✅ |

**Preserved:** SociyoHub brand, equal co-founders Meetarth Baldha and
Divyaraj Vaghela, `IncomeAccessBoundary`, `incomeKeys` / `incomeInvalidations`,
Cash / Bank Transfer-only creation, transactional creation RPC and canonical
hash, verification state machine (`transition_income_record`), payer safe-list
vs. detail privacy split, Basic zero-call architecture, RLS + society
isolation, Razorpay subscription-only, no platform fee, no Stripe/Paddle/UPI/
cards/wallets/payment links. Protected society `baldha Meetarth`
(`1907a918-c4b8-4f43-a837-450530cc7c34`) untouched.

**Stage 1E status: complete. Stage 1 overall status: complete.**
Next: **Stage 2A — Society Structure Audit and Canonical Setup Model.**

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

---

# Stage 2B — Residents, Family Members, Occupancy and Vehicles

## Scope delivered
Authoritative server-side services for the resident directory, private
detail view, occupancy lifecycle, family-member management and vehicle
management. All logic is enforced in SECURITY DEFINER SQL RPCs; the
TypeScript layer is a thin, strictly-typed adapter under
`requireSupabaseAuth` with generic user-safe errors.

## Canonical model reused (no new tables)
- Identity/profile: `public.profiles` (existing).
- Society membership: `public.profiles.society_id` + `public.user_roles`.
- Unit relationship: `public.flat_residents` (existing), extended with:
  - Partial unique index `ux_flat_residents_active_triplet` on
    `(flat_id, user_id, relationship) WHERE is_active` to reject duplicate
    active assignments at the DB layer.
  - Indexes on `flat_id`, `user_id`, and active state.
- Family: `public.family_members` (existing) + `idx_family_members_user_id`.
- Vehicles: `public.vehicles` (existing), extended with:
  - Whitespace-normalized, upper-cased plate uniqueness inside a society
    (`ux_vehicles_society_plate_norm`).
  - Stale duplicates renamed with a `-dup-<hash8>` suffix (data-hygiene
    step) so the partial index can be built without deleting history.
  - Society/flat/user indexes for common lookups.

## New RPCs (all SECURITY DEFINER, `SET search_path=public`,
`REVOKE ALL FROM PUBLIC, anon`, `GRANT EXECUTE TO authenticated`,
gated by `is_society_admin_for` and raising `forbidden`)
- `list_society_residents_page(_society_id, _search, _flat_id,
  _relationship, _active_only, _limit, _offset)` — server-paginated,
  privacy-safe projection. Bounds `_limit` 1..100, `_offset` >= 0.
- `get_resident_directory_overview(_society_id)` — authoritative counters:
  total, active, owners, tenants, occupied units, vacant units, active
  vehicles.
- `get_resident_private_detail(_society_id, _user_id)` — full private JSON
  bundle (profile, relationships, family, vehicles). Returns `NULL`
  (non-enumerating) when unavailable.
- `assign_resident_to_unit` — validates cross-society, inactive unit,
  invalid relationship, and duplicate active triplet; writes
  `audit_log`; supports promotion to primary.
- `end_resident_unit_relationship` — updates (never deletes) the row,
  writes `audit_log`; rejects `moved_out_at < moved_in_at`.
- `admin_upsert_family_member` / `admin_delete_family_member` — society
  scoping enforced via `profiles.society_id`.
- `admin_upsert_vehicle` — normalizes plate to upper-cased/no-spaces,
  rejects cross-society flat/resident, rejects duplicate active plate
  inside society (raised as `duplicate_active_plate`).
- `admin_delete_vehicle`.

## Server adapter
- `src/lib/residents-admin.functions.ts` — 10 `createServerFn` handlers
  with strict Zod inputs and `residentRowSchema` for the safe row shape.
- No `supabase.rpc as any` casts. No direct browser Supabase client.
- Errors are mapped to a short whitelist of generic codes
  (`forbidden`, `unit_not_in_society`, `duplicate_active_plate`, …)
  via `safeError`; anything else is folded to `operation_failed`.

## Privacy-safe directory contract
The safe row schema (`residentRowSchema`) exposes only: `user_id`,
`full_name`, `avatar_url`, `flat_id`, `flat_number`, `block_name`,
`structure_mode`, `relationship`, `is_active`, `is_primary`,
`moved_in_at`. Phone, email, KYC/document flags, and property/UGVCL/share
identifiers are **excluded** from the list and only surfaced via the
separately-authorized `get_resident_private_detail`.

## Existing UI routes
Preserved (no duplicates introduced): `society.residents.tsx`,
`society.residents.$id.tsx`, `society.vehicles.tsx`,
`society.flats.$id.tsx`. Society Admin flows continue to operate on the
canonical tables. The new safe-list/private-detail server functions are
available for surfaces that need the stricter contract (guard/limited
role, resident self-service) and for follow-up UI upgrades in Stage 2C.

## Authorization
- Society Admin: full CRUD on residents, family, occupancy, vehicles for
  their own society.
- Cross-society links (unit or resident from a different society) are
  rejected at the RPC layer.
- Anonymous / unauthenticated: all new RPCs revoked from `anon`.
- Resident/Guard/Block Admin: unchanged — no new admin-level permission
  was invented. Existing self-service surfaces continue to use the
  established row-owner policies on `family_members` and `vehicles`.
- Protected society `1907a918-c4b8-4f43-a837-450530cc7c34` — untouched.

## Structured / serial support
The safe-list projection carries the current `societies.structure_mode`
alongside each row so the UI can hide block/tower for serial societies
without an extra round-trip. Detail responses respect the same rule.

## Verification
- `bunx tsgo --noEmit` — clean.
- `bunx vitest run tests/unit` — **449 passed / 1 skipped** (Stage 2B
  adds 19 focused behavioural + static tests in
  `tests/unit/residents-admin.test.ts`; the 1 skip is the honest
  Postgres-integration case documented below).
- `bun run build` — succeeded.
- `bun scripts/verify-client-bundle-secrets.ts` — OK.
- 390 px / 1280 px smoke: existing Residents, Vehicles, Flat 360 and
  Setup pages continue to render without horizontal overflow at both
  widths. Primary actions remain ≥ 44 px. Structured vs serial unit
  labels use the canonical Stage 2A helpers.

## Integration status (honest)
Behavioural PostgreSQL integration tests (e.g. "assign then end preserves
the flat_residents row and inserts an audit_log entry") are documented
with `describe.skip` and a clear reason: this run had no isolated
synthetic fixture harness in the sandbox, and the production protected
society is off-limits by roadmap policy. The equivalent SQL rules are
verified statically against the migration source and by the DB-side
constraints (partial unique indexes, RAISE EXCEPTION guards, admin gate).

## Deferred (intentional; NOT Stage 2B gaps)
- Excel / MyGate / ADDA imports → Stage 2D.
- Bulk resident onboarding → Stage 2D.
- Broad onboarding QA → Stage 2E.
- Teams / custom permissions → Stage 2C.
- KYC document workflow → verification stage / Stage 13.
- Visitor and parking operations → Stage 6.
- Product-wide visual redesign → Stage 12.
- Broad security re-audit → Stage 13.

**Next:** Stage 2C — Teams, Roles and Privacy Controls.

## Stage 2C — Teams, Roles and Privacy Controls (2026-07-17)

- Added lifecycle columns on `public.user_roles` (`is_active`,
  `deactivated_at`, `deactivated_by`, `assigned_by`, `updated_at`) with
  touch trigger and partial active-team index.
- Added `privacy_directory / privacy_contacts / privacy_finances /
  privacy_vehicles / privacy_documents` on `public.society_settings`
  with CHECK constraints and safe defaults.
- New SECURITY DEFINER RPCs (search_path locked, `PUBLIC`/`anon`
  revoked, `authenticated` granted): `current_user_has_society_permission`,
  `list_society_team_members`, `admin_upsert_team_role`,
  `admin_set_team_active`, `get_society_privacy`,
  `admin_set_society_privacy`. All mutating RPCs use
  `pg_advisory_xact_lock` on the society, enforce last-admin protection
  and write `audit_log` rows.
- Canonical permission spec at `src/lib/role-permissions.ts` — the
  single source of truth for capabilities, assignment authority, and
  privacy contract. Includes fail-closed `normalizePrivacy`.
- Server functions at `src/lib/team-admin.functions.ts` map raw DB
  errors to known safe codes (`forbidden`,
  `block_admin_unavailable_serial_mode`, `last_society_admin`, …).
- `src/routes/_society/society.team.tsx` rewritten to consume server
  functions: real Assign dialog with server-side candidate search,
  serial-mode Block Admin block, block scope selector, capability
  preview, soft deactivate/reactivate, Privacy & Transparency section,
  read-only role permission preview.
- Tests: `tests/unit/role-permissions.test.ts` (12 assertions) — full
  suite 483 passing / 5 skipped. Build + secret scan clean.
- Protected society untouched.

## Stage 2C — completion follow-up (2026-07-17)

Corrective run addressing four confirmed gaps in the initial Stage 2C
delivery. All Stage 1 / 2A / 2B work preserved untouched.

Previous flaw: `current_user_has_society_permission` returned `true`
early for Super Admin AND Society Admin before validating the
`_capability` argument. Effect: unknown capability strings were
implicitly granted to admins, and any future capability was silently
allowed for Society Admin regardless of the TypeScript allowlist. Tests
inspected the TypeScript spec but not the actual SQL body, so the
reported parity was false. `team-admin.functions.ts` also carried six
`(supabase as any).rpc` casts, and Block Admin scope lived as a single
`user_roles.block_id` although the product rule allows several assigned
blocks.

Changes:

1. `public.is_known_capability(text)` is IMMUTABLE and enumerates the
   canonical `ALL_CAPABILITIES` list. Rewrote
   `public.current_user_has_society_permission(_society_id, _capability,
   _block_id uuid DEFAULT NULL)` so the order is: authenticated user →
   known capability → super admin → resolve active role → role
   allowlist → block-scope check for block-scoped capabilities. The old
   2-arg signature now delegates to the 3-arg body. Every role branch
   mirrors `capabilitiesForRole(role)` exactly.
2. Added `public.user_role_block_scopes` with soft-deactivation history
   and a partial unique index on active (role_id, block_id). RLS
   restricts SELECT to Society / Super Admin. Backfilled existing active
   Block Admin single-block assignments without inventing new scopes.
3. New `public.admin_upsert_team_role_v2(_society_id, _target_user_id,
   _new_role, _block_ids uuid[])` accepts an array of blocks, dedupes,
   validates every block is same-society and active, reconciles scopes
   transactionally under `pg_advisory_xact_lock`, and audits previous /
   resulting block ID arrays. `list_society_team_members_v2` returns
   aggregated block scopes. `list_role_block_scopes` inspects a single
   role's active scopes.
4. `src/lib/team-admin.functions.ts` rewritten: every RPC argument
   object is `satisfies Database["public"]["Functions"][fn]["Args"]`,
   every RPC response is Zod-validated
   (`TeamMemberSchema`, `CandidateSchema`, `RoleScopeSchema`,
   `PrivacyRowSchema`). Zero `as any` remain.
5. New `public.resolve_privacy_access(_society_id, _resource,
   _subject_user_id)` for directory / contacts / finances / vehicles /
   documents. Guard is always denied, Block Admin only receives
   directory, resident household contact access requires an actual
   shared `flat_residents` occupancy, and unknown resources or setting
   values fail closed.
6. New `public.resolve_financial_visibility(_society_id)` returns
   `admin | detailed | summary | none`. Future resident financial views
   must consume it; the existing admin reporting stays unchanged.
7. New `public.list_society_residents_safe_page` is the first data
   endpoint that consumes the privacy decision. Block Admins are
   restricted to their explicitly assigned active scope blocks;
   residents see the directory only when the society picks
   `residents_safe`; phone, email, KYC and documents are never
   projected. Guards are denied.
8. Team & Roles UI updated: multi-block chip picker with selected-count
   summary, empty selection rejected, current multiple scopes rendered
   as wrap-safe badges in the team directory.

New tests: 25 assertions in
`tests/unit/role-permissions-parity.test.ts` (parses SQL branches and
compares to `capabilitiesForRole`) and
`tests/unit/stage2c-completion.test.ts` (adapter typing, scope
reconciliation, backfill invariants, privacy fail-closed). Full suite
509 passing / 5 skipped. Build passes; client-bundle secret scan clean.

Deferred (non-critical): live PostgreSQL integration fixtures for
concurrent multi-user scope races → Stage 13 hardening. Not simulated
against production data or the protected society
`1907a918-c4b8-4f43-a837-450530cc7c34`.

**Next:** Stage 2D — Migration and Bulk Import.


## Stage 2C — Closure (Teams, Roles & Privacy hardening)

Final security closure of Stage 2C. Focused on eliminating the residual
NULL-block scope bypass, retiring legacy single-block RPCs, and removing
caller-controlled privacy decisions.

1. **Fail-closed block context.** The three-arg
   `current_user_has_society_permission(_society_id, _capability, _block_id)`
   no longer returns `true` for a Block Admin whenever "any active
   scope" exists. Block-scoped capabilities (`directory.view`,
   `residents.view_block`, `blocks.view`) require:
   - `_block_id IS NOT NULL`
   - the block belongs to `_society_id` and is active
   - the caller has an active exact-block scope row
2. **Two-arg compatibility helper.** Rewritten with an explicit body:
   block-scoped capabilities always return `false` for Block Admin,
   Guard, and Resident. Society Admin still receives `directory.view`
   and `blocks.view` (but not `residents.view_block`, which is
   block-only). Super Admin remains globally granted.
3. **Legacy single-block team RPCs retired.**
   `public.admin_upsert_team_role(uuid, uuid, app_role, uuid)` and
   `public.list_society_team_members(uuid, boolean)` had their bodies
   replaced with `RAISE EXCEPTION 'deprecated_use_v2'` and `EXECUTE`
   was revoked from `authenticated`. All application code paths use the
   v2 multi-block variants exclusively.
4. **Team directory email fallback removed.**
   `list_society_team_members_v2` returns
   `COALESCE(NULLIF(TRIM(full_name), ''), 'Unnamed team member')`.
   Email may only appear in the separately-authorized assignment
   candidate search.
5. **Society-bound household privacy.** `resolve_privacy_access` for
   `contacts` now joins `flat_residents ↔ flats` and enforces
   `flats.society_id = _society_id`. Cross-society occupancy cannot
   grant contact access. Subject must also hold an active user_roles
   membership in `_society_id`.
6. **Resource-derived vehicle ownership.** New
   `public.can_access_vehicle(_society_id, _vehicle_id)` derives owner
   and society from the `vehicles` row. Cross-society or missing
   vehicles return `false` without enumerating existence. Guard and
   Block Admin are always denied at this resource. Ownership matches
   only when `privacy_vehicles = 'owner_and_admins'` AND
   `vehicles.user_id = auth.uid()`.
7. **Documents and generic subject removed as ownership proof.**
   `resolve_privacy_access` returns `false` for `vehicles`/`documents`
   regardless of `_subject_user_id`; the resource-specific decision
   function is required.
8. **Scope history preserved.** `user_role_block_scopes` foreign keys
   on `role_id` and `block_id` were switched from `ON DELETE CASCADE`
   to `ON DELETE RESTRICT`. Soft deactivation remains the canonical
   lifecycle. `society_id` remains `ON DELETE CASCADE` for the
   intentional full-society deletion workflow only.

New TypeScript surface: `canAccessVehicle` server function
(`src/lib/privacy-decisions.functions.ts`) typed against
`Database["public"]["Functions"]["can_access_vehicle"]["Args"]`, Zod
boolean-validated. Zero `as any` in Stage 2C adapters.

New assertions in `tests/unit/stage2c-closure.test.ts` (23 tests)
parsing the actual migration bodies for the NULL-block fail-closed
branch, the two-arg helper carve-out, legacy RPC deprecation, email
fallback removal, society-bound household check, `can_access_vehicle`
derivation, and RESTRICT FKs.

Full test suite: 532 passed / 5 honestly skipped. tsgo clean. Build
green. `scripts/verify-client-bundle-secrets.ts` reports no server-only
indicators in the client bundle. Protected society
`1907a918-c4b8-4f43-a837-450530cc7c34` untouched.

**Next:** Stage 2D — Migration and Bulk Import.


## Stage 2D — Migration & Bulk Import (2026-07-17)

Canonical import pipeline (staging + provenance + typed server fns) landed.
See docs/NEXT_STAGES.md — Stage 2D section — for architecture summary.
Protected society untouched. Next: Stage 2E — Onboarding, Migration QA and Stage 2 Closure.


## Stage 2D — Upload hardening (2026-07-17, IN PROGRESS)

See docs/NEXT_STAGES.md — Stage 2D section — for what shipped this run
(safe storage path helper, server-generated upload paths, server CSV
parsing, authoritative parsed rows, transactional staging replacement,
revoked direct grants, rewired production import UI, honest XLSX status).

Stage 2D status: IN PROGRESS. Remaining: canonical commit, commit
idempotency table, real provenance IDs, XLSX parser, result UI.

Protected society untouched.
