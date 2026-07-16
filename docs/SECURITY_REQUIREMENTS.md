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
