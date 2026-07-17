# Security Requirements

## Row-Level Security
- **Every** `public` table has RLS enabled and policies scoped to `auth.uid()` or `has_role(auth.uid(), 'admin')` or society membership.
- **Every** new `public` table has explicit `GRANT` statements in the same migration:
  ```sql
  GRANT SELECT, INSERT, UPDATE, DELETE ON public.<t> TO authenticated;
  GRANT ALL ON public.<t> TO service_role;
  ```
  (`anon` only when a policy specifically allows it.)
- Roles live in `user_roles` (never on `profiles`).
- Cross-society isolation is tested in both directions before claiming "RLS added".

## Server-side state transitions
Sensitive workflow status (`no_dues_requests.status`, points-ledger `source`, payment verification) may **only** be set via server functions using `requireSupabaseAuth` + role check, or by `supabaseAdmin` inside a verified webhook / route. Clients cannot flip approved/issued/revoked directly.

## Public routes (`/api/public/*`)
- Bypass auth at the edge → each handler verifies the caller (signature, opaque token).
- Never returns PII.
- Uses narrow projections; never `select *`.
- `supabaseAdmin` loaded inside the handler, never at module scope of client-reachable files.

## Secrets
- `SUPABASE_SERVICE_ROLE_KEY`, Razorpay secret, Lovable AI Gateway key — server-only.
- Never logged, echoed, screenshotted, or returned in responses.
- Client-visible config uses `import.meta.env.VITE_*` only.

## PDF generation
- `pdf-lib` + `qrcode` — pure JS, Cloudflare-Worker-safe.
- Never `puppeteer`, `sharp`, `canvas` in server code.

## Verification tokens
- Opaque, unguessable (32+ bytes crypto random, base64url).
- Never sequential, never derived from primary keys.
- Public verification endpoint returns minimum data only.

## Input validation
- Every server fn `.inputValidator()` uses Zod (or equivalent) with bounds.
- Format checks on emails/phones/UUIDs/URLs.
- Client-provided IDs cross-checked against caller's society membership on every mutation.

## Non-member income transitions (Turn 18B.2A)

`public.transition_income_record(uuid, text, text)` is authenticated-callable
by design. It **must not** rely on any TypeScript wrapper for security:

- Society-admin (or super-admin) membership is verified inside the RPC.
- Pro/Premium plan entitlement is verified inside the RPC via
  `public.is_non_member_income_enabled_internal(_society_id)`.
- Missing row, cross-society row, and non-admin caller all return the same
  `{ status: "not_found" }` shape — no record-existence enumeration.
- `plan_required` is returned only after society membership succeeds.
- The RPC never accepts `society_id`, `actor_id`, `plan`, `current_status`,
  `amount`, or `category` as arguments — they are derived server-side.
- `EXECUTE` on both functions is revoked from `PUBLIC` and `anon`; granted
  only to `authenticated`.
- Server callers validate the RPC's `jsonb` reply with
  `IncomeTransitionResultSchema` (Zod discriminated union) before returning
  to the browser. Raw RPC JSON is never surfaced.

## Stage 1D — non-member income creation (2026-07-16)

Non-member income records MUST be created only through the SECURITY DEFINER
RPC `public.create_non_member_income_record`. Direct client INSERTs into
`society_income_records` or `audit_log` are not part of the contract and
are not audited.

Grants: `PUBLIC` and `anon` are revoked; `authenticated` has EXECUTE. The
function independently enforces society-admin membership, Pro/Premium plan
entitlement (mirroring `normalizePlan`), category/payer society scoping,
and the payer-kind relationship rules. All decisions happen inside the
database — the TypeScript adapter cannot bypass them.

Idempotency uses SHA-256 of a canonical JSON payload, computed with
`extensions.digest()` inside the RPC. A `NOT VALID` CHECK constraint
`society_income_records_hash_format_chk` guarantees any new hash matches
`^[0-9a-f]{64}$`. Non-cryptographic fallbacks (djb2) have been removed
from the codebase.

## Stage 1D — Non-member income creation: authoritative RPC

The transactional creator `public.create_non_member_income_record`
accepts **only** business fields. It does not accept and never has an
argument for:

- `_canonical_payload`
- `_payload_hash`
- `_creation_payload_hash`
- actor / role / plan / verification / reconciliation / audit metadata

All authorization, plan entitlement, category/payer scoping, canonical
JSON derivation, and SHA-256 hashing are performed inside PL/pgSQL
against `auth.uid()` and the normalized values that are about to be
persisted. `creation_request_id` is required (null → `invalid_input`).
Only `cash` and `bank_transfer` are accepted for new records. Resident
payer creation is refused until a canonical resident-society membership
helper exists.

Grants: `REVOKE ALL ... FROM PUBLIC, anon`; `GRANT EXECUTE ... TO
authenticated`. The previous 12-arg signature (which accepted
`_canonical_payload text`) has been dropped in the same migration.

Regression protection: `tests/unit/income-rpc-invariants.test.ts`
reads the actual migration and adapter source and fails on any of the
above conditions reappearing.

## Stage 1D — Income access boundary

Every route under `/society/income*` MUST mount its protected query and
mutation hooks inside `IncomeAccessBoundary`. The boundary's
`computeIncomeAccess` decision function is the single source of truth for
entitlement, role, and society readiness. Callers whose state resolves to
`plan_locked`, `role_denied`, `society_unavailable`, or `loading` never see
the authorized subtree render, so no protected service function is invoked
on their behalf — this is proven behaviourally, not only by static scan.

The creation RPC adapter (`create_non_member_income_record`) uses a
nullable-honest `CreateIncomeRpcArgs` adapter type in place of double-cast
`as unknown as string` coercions; TypeScript now reflects the real
signature of the SQL function, keeping the boundary between caller-supplied
input and server-derived canonical JSON/hash unambiguous.

## Stage 1E — Reporting and reconciliation

- `get_society_income_report`, `transition_income_reconciliation`, and
  `list_non_member_payers_page` are all `SECURITY DEFINER` with a fixed
  `search_path = public`, revoke `EXECUTE` from `PUBLIC` and `anon`, and
  grant `EXECUTE` only to `authenticated`.
- Each RPC calls `public.is_society_admin_for(auth.uid(), _society_id)`
  as its authorization primitive. Cross-society lookups collapse to
  `not_found` (non-enumerating) rather than distinguishing a hidden
  record from a missing one.
- Plan gate (Pro/Premium or an active trial with a future `trial_ends_at`)
  is enforced inside every RPC — the UI cannot bypass it.
- Reconciliation `UPDATE` and the `audit_log` `INSERT` run in the same
  transactional plpgsql function so an aborted update cannot leave an
  audit trail behind or vice versa.
- Verification (`society_income_records.verification_status`) is never
  mutated by the reconciliation RPC. The two state machines are strictly
  independent.
- Payer list projection is enforced in SQL (`id, payer_type,
  display_name, organization_name, is_active, created_at`) so the wire
  format cannot leak `phone`, `email`, `reference_code`, or `notes`.

## Stage 2A closure (canonical structure model)

- Canonical: `societies` + `blocks` + `flats`. `hierarchy_nodes` is legacy compatibility only.
- `societies.structure_mode` is `'structured' | 'serial'` (nullable for legacy).
- `flats.block_id` is nullable in serial mode; a BEFORE-trigger enforces mode rules.
- New RPCs (SECURITY DEFINER, authenticated-only): `get_society_structure_overview`, `configure_society_structure_mode`, `list_society_units_page`, `create_society_unit`, `update_society_unit`, `set_society_unit_active`, `set_society_block_active`.
- Unsafe mode conversions with existing units are blocked; ambiguous legacy data left unchanged.
- `commit_society_wizard` writes canonical rows and no longer creates a fake "Houses" block for serial.

## Stage 2B additions
- Any surface that lists residents to a non-admin role MUST use
  `listResidentsPage` (server fn) — never a direct browser Supabase call.
  The RPC projects only safe operational fields; phone, email, KYC,
  UGVCL/property/share identifiers, and family contacts are not part of
  the safe list contract.
- Private resident detail is served only by `getResidentPrivateDetail`
  (server fn → `get_resident_private_detail` RPC) and requires the caller
  to be a society admin for the target society. Missing/inaccessible
  residents return NULL (non-enumerating).
- Occupancy state changes MUST go through `assign_resident_to_unit` and
  `end_resident_unit_relationship`. Move-out preserves history and writes
  `audit_log`; never `DELETE` a `flat_residents` row.
- Vehicle plates are normalized inside the RPC (uppercase, whitespace
  stripped) and are unique per society at the DB layer.

## Stage 2C completion — server-enforced privacy
- Every capability check goes through
  `public.current_user_has_society_permission(_society_id, _capability,
  _block_id)` and is denied unless the capability is in
  `public.is_known_capability(text)`. Unknown capabilities are denied
  for every role, including Super Admin.
- Block Admin authority is bound to explicitly assigned active blocks
  recorded in `public.user_role_block_scopes`. `user_roles.block_id`
  is legacy compatibility only — never treat it as the authoritative
  multi-block source.
- Resident-facing data endpoints MUST consult
  `resolve_privacy_access(_society_id, _resource, _subject_user_id)`
  (booleans) or `resolve_financial_visibility(_society_id)` (tiered).
  Unknown resource or setting values fail closed. Guard is denied every
  resident-privacy resource.
- The first data endpoint honoring the decision is
  `list_society_residents_safe_page` — safe projection only (id, name,
  flat, block). Contacts, vehicles and documents keep their existing
  admin-only paths; when their resident-facing variants land in later
  stages they MUST call `resolve_privacy_access` before returning data.


## Stage 2C closure (2026-07-17)

- Block-scoped permission checks require exact block ID; NULL block → false for Block Admin.
- Two-arg permission helper fails closed for Block Admin block-scoped capabilities.
- Legacy `admin_upsert_team_role`/`list_society_team_members` retired (revoked, body raises `deprecated_use_v2`).
- Team directory no longer falls back to email; assignment candidates keep email under a separate authorization.
- Privacy contacts household check is bound to `flats.society_id`; vehicles/documents require resource-specific `can_access_vehicle`.
- `user_role_block_scopes` role/block FKs are `ON DELETE RESTRICT` — scope history preserved.
- 532 unit tests pass; tsgo clean; build green; client-bundle secret scan clean.
- Protected society `1907a918-c4b8-4f43-a837-450530cc7c34` untouched.
