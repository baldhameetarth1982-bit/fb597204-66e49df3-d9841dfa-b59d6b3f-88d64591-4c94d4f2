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
