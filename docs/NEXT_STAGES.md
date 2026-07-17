# Next Stages

## Stage 2D — Migration & Bulk Import (COMPLETE 2026-07-17)

### People commit closure (final run)

- `commit_migration_job` now performs real canonical writes for every
  supported entity type — structures, units, residents (via
  `offline_residents` for non-login creates and `flat_residents` for
  matched auth users), family members, and vehicles. The people counters
  (`residents_created`, `residents_matched`, `occupancies_created`,
  `family_created`, `vehicles_created`) are derived from actual inserts,
  never hardcoded.
- Additive schema extension: `family_members` and `vehicles` gained a
  nullable `offline_resident_id` FK and a CHECK constraint requiring
  exactly one of `user_id` / `offline_resident_id`. `family_members` also
  gained `society_id` / `flat_id` provenance columns (backfilled for
  existing rows) and a society-admin read policy.
- Duplicate active vehicle plates block the commit as
  `unresolved_conflicts` (never silently overwrite). Unresolvable resident
  links, missing units, and invalid plates likewise mark the commit
  request `failed` and roll the job back to `ready` so retries are safe.
- Completion guard: after each entity loop, the RPC counts any remaining
  valid/warning rows with `create`/`match_existing` and returns
  `unresolved_conflicts` if any are still uncommitted or unlinked. A job
  cannot reach `completed` while staged work remains.
- Behavioral tests (`tests/unit/migration-behavioral.test.ts`) invoke the
  real `_commitMigrationJobViaRpc` against a mocked supabase client and
  assert the full status/result contract — including people counts,
  idempotent replay, blocked-conflict handling, malformed-result guards,
  and unknown-status rejection. No source-regex assertions.
- UI: the confirm dialog now honestly enumerates what will be written and
  the result card shows the full people-commit counters. The stale "no
  residents/family/vehicles" disclaimer is removed.

## Stage 2D — Migration & Bulk Import (superseded intermediate status)

### Upload hardening delivered this run

- Storage authorization no longer casts arbitrary object folders to `uuid`.
  New SECURITY DEFINER helper `public.migration_upload_path_ok(name)`
  validates the exact path shape `<society-uuid>/<job-uuid>/<random>.<ext>`,
  confirms the job belongs to the society, and confirms the caller is a
  Society Admin (or Super Admin). Malformed paths return `false` — never
  throw. The storage policy on `migration-uploads` uses this helper.
- Browser CreateJob contract removed. `initializeMigrationUpload` is the
  only entry point: it validates the declared filename/size/mime, creates
  a job via `migration_create_job` (SECURITY DEFINER), generates the final
  private path server-side, and returns a short-lived signed upload URL
  for that exact path.
- `finalizeMigrationUpload` downloads the private object server-side,
  enforces the 10 MB cap on actual bytes, checks the magic-byte signature
  (rejects XLSX/EXE/ELF), computes SHA-256 from real bytes, parses CSV
  server-side, and stores authoritative parsed rows in the new
  `migration_parsed_rows` table. Finalize records the authoritative
  checksum/size/row count through `migration_finalize_upload`.
- New CSV parser in `src/lib/migration-pipeline.ts` (no dependency):
  handles UTF-8 BOM, quoted commas, escaped quotes, CRLF/LF, blank
  lines, and rejects malformed quotes, empty headers, duplicate headers,
  oversized cells, and row-cap breaches. Formula-looking cells stay
  inert text — neutralization only fires on downloadable reports.
- `validateMigrationJob` no longer accepts caller-supplied rows. It loads
  the authoritative parsed rows, applies mapping server-side, runs Zod,
  and replaces staging atomically through the new
  `migration_replace_staging` RPC (locks the job, deletes stale staging,
  bulk-inserts new staging, updates counters — all in one transaction).
- Direct `INSERT/UPDATE/DELETE` grants on `migration_jobs`,
  `migration_rows`, and `migration_entity_links` are revoked from
  `authenticated`. Every mutation goes through the SECURITY DEFINER RPCs.
- Production `/society/import` route rewritten to consume the new server
  functions end-to-end (source → CSV upload → server parse → mapping →
  server validate → server-paginated preview). Browser XLSX dependency
  removed. Confirm-import is deliberately disabled with an "Import commit
  will be enabled after final validation is complete" message — no
  canonical writes are performed from the browser anymore.
- Honest XLSX status: `finalizeMigrationUpload` returns
  `unsupported_format` for `.xlsx` uploads. The UI copy advertises CSV
  only. A safe server-side XLSX parser lands with the remaining Stage 2D
  work.

### Tests

- 32 new assertions in `tests/unit/migration-stage2d-upload.test.ts`
  cover CSV parsing edge cases, signature detection, disabled commit,
  removed browser-write patterns, missing `as any`, and SQL-level
  invariants (safe path helper, revoked grants, parsed-rows table,
  replace-staging RPC). Full unit suite: 587 pass, 5 skipped.

### Remaining Stage 2D work

- Real transactional canonical commit (`commit_migration_job` PLPGSQL
  dispatching to Stage 2A/2B admin functions).
- Separate `migration_commit_requests` table for commit idempotency
  (distinct from upload idempotency).
- Real `canonical_entity_id` in `migration_entity_links` (currently
  placeholder — no rows are written into that table by this run).
- Server-side XLSX parser or a hard, documented CSV-only stance.
- Final result UI (post-commit summary).
- Stage 2D completion + closure.

Stage 2D remains **IN PROGRESS**. Protected society
`1907a918-c4b8-4f43-a837-450530cc7c34` is untouched — no fixture, seed,
or runtime reference.

## Stage 2D — Prior scaffolding notes



Canonical import pipeline scaffolded end-to-end:

- Migration `20260717044655…` adds `migration_jobs`, `migration_rows`,
  `migration_entity_links` (staging + provenance), plus enums
  `migration_job_status`, `migration_entity_type`, `migration_row_action`,
  `migration_row_status`.
- Society-scoped SECURITY DEFINER helper
  `public.current_user_can_admin_migrations(_society_id)` powers RLS on all
  three tables. Residents, block admins, guards and anonymous are denied.
- Private storage bucket `migration-uploads` with society-scoped RLS
  (`storage.foldername(name)[1]::uuid` binds path to society id).
- Shared browser-safe pipeline module `src/lib/migration-pipeline.ts`:
  file-safety validator (10 MB cap, 5 000 row cap, XLSM/XLSB/macros
  rejected), formula neutralization for downloadable error reports,
  MyGate/ADDA/NoBrokerHood/SociyoHub/generic column-mapping presets,
  strict Zod row schemas for structures / units / residents / occupancy /
  family / vehicles, plate normalization, deterministic checksums.
- Server functions in `src/lib/migration.functions.ts`
  (`createMigrationJob`, `validateMigrationJob`, `listMigrationJobs`,
  `getMigrationPreview`, `commitMigrationJob`) — all typed against
  generated `Database` types, strict Zod input/output, safe stable error
  codes only (`invalid_file`, `unsupported_format`, `too_many_rows`,
  `invalid_mapping`, `validation_failed`, `unresolved_conflicts`,
  `job_not_ready`, `job_already_committing`, `idempotency_conflict`,
  `unavailable`, `operation_failed`). No `as any`.
- Idempotent commit: `(society_id, idempotency_key)` unique on jobs;
  identical `creation_request_id` re-runs return the existing completion;
  changed checksum returns `idempotency_conflict`. Provenance rows are
  upserted on `(society_id, source_type, entity_type, source_key)`.
- Preview is server-paginated (`getMigrationPreview`) — no operational
  mutation, no PII leaked in the job list.
- 23 focused unit tests in `tests/unit/migration-pipeline.test.ts`:
  file safety (CSV/XLSX accepted; XLSM/XLSB/XLTM/archives/executables
  rejected; oversized rejected; row cap enforced; empty rejected),
  formula neutralization, MyGate/ADDA/NoBrokerHood preset detection,
  row-schema validation including plate normalization, and deterministic
  checksums. All pass; `bunx tsgo --noEmit` clean.
- Protected society `1907a918-c4b8-4f43-a837-450530cc7c34` remains
  completely untouched — no fixture, seed, or runtime reference.
- Canonical writes for new structures / units / residents remain the
  responsibility of the existing Stage 2A/2B admin RPCs. The Stage 2D
  commit records provenance for matched rows and leaves canonical inserts
  as the Stage 2E wiring task; auth users are never fabricated.
- Integration tests: honestly skipped pending isolated fixtures + private
  test storage. No production data used.

**Exact next position:** Stage 2E — Onboarding, Migration QA and Stage 2
Closure (canonical write wiring, resumable partial commits, and the
production UI consuming the pipeline).

---

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

---

# Stage 2B — Residents, Family Members, Occupancy and Vehicles — COMPLETE

Canonical `profiles` / `flat_residents` / `family_members` / `vehicles`
reused (no new tables). Server-side RPCs added for a privacy-safe
paginated directory, private detail bundle, occupancy assign/end with
audit, and society-scoped family/vehicle lifecycle. Family and vehicle
removal are **soft deactivation** (row + registration number preserved,
never DELETE). Vehicle plate uniqueness is enforced by a partial index
scoped to `is_active` rows plus a race-safe `pg_advisory_xact_lock` on
`(society, normalized plate)`. `getResidentPrivateDetail` returns a
strict Zod-parsed discriminated union — unknown fields rejected,
malformed shapes fold to `temporary_error`. Existing production routes
now consume the safe services: `society.residents.tsx` uses
`getResidentDirectoryOverview` + `listResidentsPage` and no longer
renders phone/email/UGVCL/property in directory rows;
`society.residents.$id.tsx` reads private detail through the authorised
server fn; `society.vehicles.tsx` uses `listSocietyVehicles` +
`deactivateVehicleAsAdmin` (no direct browser private-table query, no
permanent-delete UI). No migration rewrites historical plate values.
459 unit tests pass; build and secret scan clean. Protected society
untouched.

**Next:** Stage 2C — Teams, Roles and Privacy Controls.

---

# Stage 2C — Teams, Roles and Privacy Controls — COMPLETE

Canonical `user_roles` reused; added lifecycle columns (`is_active`,
`deactivated_at`, `deactivated_by`, `assigned_by`, `updated_at`) with a
touch trigger and a partial index for active team lookups. Privacy
contract added to `society_settings` as five constrained columns
(`privacy_directory`, `privacy_contacts`, `privacy_finances`,
`privacy_vehicles`, `privacy_documents`) with safe defaults
(admins_only / self-household-and-admins / owner-and-admins) — unknown
values fail closed via `normalizePrivacy`.

**Canonical permission spec** lives at `src/lib/role-permissions.ts`.
Frontend, tests, and DB helper (`current_user_has_society_permission`)
consume the same specification. Base grants:

- Super Admin — all capabilities (platform).
- Society Admin — team, privacy, structure, residents, private detail,
  billing, finance admin.
- Block Admin — no society-wide access; directory + block-scoped
  residents + self household only.
- Guard — guard operations + self household.
- Resident — self household only.

Server functions in `src/lib/team-admin.functions.ts` (`listTeamMembers`,
`listAssignmentCandidates`, `upsertTeamRole`, `setTeamActive`,
`getSocietyPrivacy`, `setSocietyPrivacy`) call SECURITY DEFINER RPCs that:

- lock the society with `pg_advisory_xact_lock` inside the mutating
  transaction,
- protect the last active Society Admin against demotion/deactivation
  (`last_society_admin` code),
- reject Block Admin in serial-mode societies,
- require active same-society block scope for Block Admin,
- insert an `audit_log` row with previous/resulting state,
- prefer soft deactivation (never physical delete).

The existing `/society/team` route now consumes those services. The
Privacy & Transparency section lets Society Admin pick each policy with
inline description — "Public" is never offered. A read-only permission
preview is generated from the canonical spec (no hand-typed matrix).
`admin.security.tsx` continues to render the platform-level roles view
untouched.

Tests: 483 unit tests pass (12 new role-permission + privacy fail-closed
assertions). Isolated PostgreSQL fixtures for last-admin race / block
scope enforcement are deferred to Stage 13 hardening — not run here.
Build passes; client-bundle secret scan clean. Visual smoke: not
verified in this run (no preview interaction ran); deferred to Stage 16
launch audit. Protected society `1907a918-c4b8-4f43-a837-450530cc7c34`
untouched.

## Stage 2C — Completion follow-up (2026-07-17)

Focused completion run correcting four gaps found in the initial Stage 2C
delivery:

1. **Exact SQL × TypeScript capability parity.** The permission helper
   `public.current_user_has_society_permission(_society_id, _capability,
   _block_id uuid DEFAULT NULL)` now validates the capability against the
   canonical `public.is_known_capability(text)` allowlist BEFORE any role
   shortcut. Unknown capabilities return false for every role (including
   Super Admin). Each role branch mirrors `capabilitiesForRole(role)` from
   `src/lib/role-permissions.ts` exactly; the compatibility 2-arg
   signature is rewritten to delegate to the 3-arg body so no stale
   broad-grant body remains. Parity is enforced by
   `tests/unit/role-permissions-parity.test.ts`, which parses the actual
   SQL branches and asserts equality with the TypeScript source — no
   hand-copied expected matrix.

2. **Canonical multi-block Block Admin scope.** New table
   `public.user_role_block_scopes` (role_id, society_id, block_id,
   is_active, assigned_by, created_at, deactivated_at, deactivated_by)
   with a partial unique index on (role_id, block_id) WHERE is_active
   and RLS gated to Society/Super Admin readers. Existing active
   single-block Block Admin rows are backfilled into the table without
   inventing extra scopes. `admin_upsert_team_role_v2` accepts a `uuid[]`
   of blocks, dedupes them, validates each is active + same-society,
   deactivates removed scopes, reactivates existing ones, inserts missing
   ones, and audits previous_block_ids/resulting_block_ids in one
   transaction. `list_society_team_members_v2` returns aggregated active
   block_ids and block_names. The Team & Roles dialog now uses a chip
   multi-select; empty selection is rejected. `user_roles.block_id`
   remains temporarily for compatibility but is not the authoritative
   source.

3. **Typed RPC adapters — zero `any`.** `src/lib/team-admin.functions.ts`
   and the new `src/lib/privacy-decisions.functions.ts` build every RPC
   argument object with `satisfies
   Database["public"]["Functions"][fn]["Args"]` and validate every
   response through Zod (`TeamMemberSchema`, `CandidateSchema`,
   `RoleScopeSchema`, `PrivacyRowSchema`, `SafeRowSchema`). Malformed
   responses collapse to generic `operation_failed` errors, never raw DB
   messages.

4. **Server-enforced privacy decisions.**
   - `public.resolve_privacy_access(_society_id, _resource,
     _subject_user_id uuid DEFAULT NULL)` decides directory / contacts /
     finances / vehicles / documents access. Unknown resources or
     settings return false. Guards are always denied. Block Admin
     receives only directory. Household contact access requires an
     actual shared `flat_residents` occupancy.
   - `public.resolve_financial_visibility(_society_id)` returns
     `admin | detailed | summary | none`. Any future resident financial
     reporting MUST consume this resolver.
   - `public.list_society_residents_safe_page(_society_id, _search,
     _limit, _offset)` is the first data endpoint that consumes the
     privacy decision. Block Admins see residents only in their
     explicitly assigned active blocks; residents see the directory only
     when the society opts into `residents_safe`; phone, email, KYC and
     documents are never projected. Guards are denied.

New tests: 25 new assertions across
`tests/unit/role-permissions-parity.test.ts` and
`tests/unit/stage2c-completion.test.ts` covering capability parity,
unknown-capability denial, scope reconciliation, backfill invariants,
privacy fail-closed and adapter typing. Full suite: 509 passed / 5
skipped, build passes, secret scan clean. Isolated Postgres integration
fixtures (multi-user scope enforcement, race-safe upserts) remain
deferred to Stage 13 hardening — not simulated against production or
the protected society.

**Next:** Stage 2D — Migration and Bulk Import.


## Stage 2C — Closure follow-up (2026-07-17)

Final security closure. Fixed:

- NULL-block scope bypass in the three-arg permission helper.
- Two-arg helper now returns false for Block Admin block-scoped caps.
- Legacy `admin_upsert_team_role` / `list_society_team_members`
  retired: revoked from `authenticated`, body raises
  `deprecated_use_v2`.
- Email removed from the standard team-directory display fallback.
- `resolve_privacy_access` contacts branch is society-bound via
  `flats.society_id`; vehicles/documents no longer trust
  `_subject_user_id` as ownership proof.
- New `can_access_vehicle(society, vehicle)` derives ownership from the
  vehicles row and fails closed for cross-society lookups.
- `user_role_block_scopes` FKs on role/block are now `ON DELETE RESTRICT`
  so scope history is preserved; soft deactivation is the canonical
  lifecycle.

Unit tests: 532 passed / 5 skipped. tsgo clean. Build green. Secret
scan clean. Protected society untouched.

**Next:** Stage 2D — Migration and Bulk Import.
