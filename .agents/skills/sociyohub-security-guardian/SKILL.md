---
name: sociyohub-security-guardian
description: Use when SociyoHub work touches authorization, RLS, SECURITY DEFINER functions, multi-tenant isolation, plan entitlement, input validation, rate limiting, uploads, secrets, or dependency risk. Do not use for pure UI copy, spacing, or non-sensitive documentation changes.
---

# SociyoHub Security Guardian

SociyoHub is multi-tenant, plan-gated, and holds financial and identity data for real residents. Security is not a review step at the end — it is a design constraint from the first line.

## OWASP-style verification (ASVS lens)

For every change, ask and answer, in writing when non-trivial:

- **Authentication** — who is calling this? Verified via Firebase token exchanged into a Supabase session?
- **Session** — is the token fresh, not logged, not exposed to the client outside HTTPS-only storage?
- **Authorization** — is the caller allowed to see and act on this specific row, in this specific society, under their plan and role?
- **Validation** — is every input Zod-parsed at the server boundary, including webhooks and public routes?
- **Cryptography** — are we using vetted primitives (Web Crypto, Supabase-provided), not hand-rolled?
- **Logging** — do we log enough to triage, without leaking PII, tokens, or PostgreSQL error text?
- **Data protection** — least-privilege columns, no over-fetch, no admin fields to residents.

## Multi-tenant isolation

Every table with per-society data must:

- Include `society_id` (or an equivalent linked column).
- Have RLS enabled.
- Have per-command policies (SELECT/INSERT/UPDATE/DELETE) — never one blanket `FOR ALL`.
- Have GRANTs matched to policies. `authenticated` gets what the policy allows; `anon` gets nothing unless a public-read policy exists and is intentional.
- Be tested under two distinct synthetic societies to prove reads and writes do not cross.

Never rely on the client filtering by `society_id`.

## Authorization

Authorization is a server responsibility. It runs after authentication and before any read or write:

- Role checks via `has_role(auth.uid(), 'admin')` (or the equivalent SECURITY DEFINER helper), never via a column on `profiles` or `users`.
- Admin scope: `get_admin_society_ids()` returns the societies where the caller is admin. Actions must intersect with this set.
- Super admin actions are logged.

Frontend hides UI; the server denies data. Both, not one.

## Plan entitlement

Plan checks are enforced server-side:

- `normalizePlan` maps raw plan identifiers to canonical tiers.
- Trial validity is verified via server time, not client time.
- Feature gates in server functions consult a single canonical helper (e.g. plan-features).
- Never return a shape that lets the client infer another society's plan (record-existence leak).

## Input validation

- Every server function `inputValidator` uses Zod.
- Every public route (`/api/public/**`) parses the body/headers before any DB access.
- Reject unknown keys where practical (`z.object(...).strict()` for narrow surfaces).
- Normalise phone numbers, IDs, and enums; do not trust client-cased strings.

## Rate limiting

For any endpoint that can be abused (OTP send, password-like reset, join-by-code, join-by-phone, AI query, upload):

- Apply the shared rate-limit middleware or an equivalent server-side limiter.
- Key by caller identity where authenticated, and by IP + phone/email hash otherwise.
- Return generic responses on limit — never confirm existence of an account.

## Error safety

- Server functions return generic user-safe messages.
- Internal logs contain enough (error code, function name) for triage without leaking PostgreSQL constraint names or user PII to clients.
- Never echo the raw PostgREST body to the browser.

## Secret scanning

- No secret (Firebase admin, Supabase service role, Razorpay key secret, JWT signing key) may appear in any file bundled to the browser.
- `scripts/verify-client-bundle-secrets.ts` (or the current equivalent) must pass before release.
- `process.env.*` is read only in server-side code paths.

## Dependency audits

- Before adding a dependency, check maintenance status, license, and last release.
- Prefer standard library or existing repo helpers.
- Record why a dependency is needed in the turn notes.
- Run vulnerability review against the lockfile at release readiness.

## Safe uploads

For any file upload:

- Restrict MIME types and size at the server boundary.
- Store under society-scoped paths.
- Enforce storage RLS policies aligned with table RLS.
- Treat uploaded content as untrusted data (see `sociyohub-ai-knowledge-engine` for AI-side handling).
- Strip metadata where privacy demands it.

## Safe `SECURITY DEFINER`

Every `SECURITY DEFINER` function:

- Sets an explicit `search_path` (typically `public`).
- Grants EXECUTE only to the minimum roles required.
- Contains no dynamic SQL that concatenates user input.
- Has a narrow, named purpose reflected in the function name.
- Is tested for the deny paths, not only the allow paths.

## Minimum EXECUTE

`REVOKE EXECUTE ... FROM PUBLIC` on any new `SECURITY DEFINER` function, then GRANT to the specific roles that need it (`authenticated`, `service_role`, or a narrower custom role). Never leave `PUBLIC` execute in place.

## Cross-society enumeration resistance

Endpoints must not let an attacker probe existence of records in another society by comparing 403 vs. 404 vs. timing. Prefer uniform generic responses for unauthorised access. Do not include row counts or existence hints in error messages.

## Direct PostgreSQL role testing

For RLS or `SECURITY DEFINER` changes, verification includes queries executed under distinct database roles (as different synthetic users), asserting:

- Cross-society read is empty or denied.
- Cross-role write is denied.
- Plan-gated write is denied when the plan lacks the entitlement.

## No frontend-only authorization

If the only thing stopping a resident from calling an admin action is a hidden button, the action is unauthorised by design. Fix the server.
