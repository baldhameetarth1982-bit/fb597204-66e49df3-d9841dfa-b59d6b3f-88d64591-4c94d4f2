---
name: sociyohub-auth-guardian
description: Use when SociyoHub work touches sign-in, sign-up, OTP, Google identity, Firebase-to-Supabase exchange, session refresh, logout, account linking, redirect handling, or reauthentication for sensitive actions. Do not use for post-authentication feature logic, RLS design, or payment flows — route those to sociyohub-security-guardian and sociyohub-payment-integrity.
---

# SociyoHub Auth Guardian

SociyoHub identity is deliberately layered: Firebase provides Phone OTP and Google, a trusted server verifies the Firebase ID token, and a Supabase application session is minted for RLS-scoped access. This layering must be preserved exactly.

## Preserve Firebase-to-Supabase exchange

Do not:

- Replace Firebase OTP or Firebase Google with a Supabase-only login.
- Introduce Supabase magic links, Supabase email/password, or Supabase phone OTP as primary auth.
- Move Firebase token verification into the browser.
- Store the Firebase ID token anywhere reachable by non-owner client code.

The flow is: user authenticates with Firebase → client sends the Firebase ID token to the trusted server route → server verifies with Firebase Admin → server mints or refreshes a Supabase session for RLS → client uses the Supabase session for subsequent calls.

## Server token verification

On the trusted server route:

- Verify signature against Firebase's public keys (with proper caching and rotation).
- Verify `iss` matches the expected Firebase issuer for this project.
- Verify `aud` matches the expected audience.
- Verify `exp` and `iat`; reject skewed tokens beyond a small tolerance.
- Verify `auth_time` where flow policy requires recent authentication.

Reject and return a generic error on any failure. Never surface which check failed.

## OTP abuse control

Phone OTP is a rate-limited, cost-bearing surface. For every OTP-related endpoint:

- Enforce per-phone and per-IP rate limits.
- Enforce a global daily cap per phone.
- Return uniform responses; never reveal whether a number is registered.
- Log attempts by hashed phone, not raw phone.

Client-side timers are UX only; the server is the limiter.

## Account linking

- Linking additional identity providers requires reauthentication.
- Linking a new phone or Google identity must not silently merge with another existing user.
- Conflicts must return a clean error that guides the resident to support, without disclosing the other account's existence.

## Session refresh

- Refresh Supabase sessions server-side where possible.
- Do not implement custom refresh loops that could race with Supabase's own client.
- On refresh failure, treat the session as invalid and re-run the Firebase→Supabase exchange.

## Logout

- Client clears in-memory session state and Supabase's stored session.
- Server invalidates the Firebase refresh token where feasible.
- Post-logout navigation must land on a public route with no residual protected data cached in TanStack Query — invalidate the query cache.

## Redirect safety

- `redirect_uri` for social OAuth must be an absolute same-origin URL.
- Never redirect directly to a protected route as `redirect_uri`; store the intended path separately and navigate after session is hydrated.
- Validate any `next=` or similar redirect parameter against an allowlist of internal paths; reject external hosts.

## No raw token logging

Never log:

- Firebase ID tokens or refresh tokens.
- Supabase access tokens.
- OTP codes.
- Session cookies.

Log identifiers (Firebase UID hash, Supabase user ID) and event names only.

## No service-role secret in frontend

- `SUPABASE_SERVICE_ROLE_KEY`, Firebase Admin credentials, and any signing key are server-only.
- `import.meta.env.VITE_*` may contain only publishable values.
- `scripts/verify-client-bundle-secrets.ts` (or equivalent) must remain green.

## RLS session mapping

- `auth.uid()` on the Supabase side must correspond to a stable user record linked to the Firebase UID.
- Do not remap user IDs after account creation; linking edits an identity table, not the primary user ID.
- Row ownership checks in RLS use `auth.uid()`, never a client-supplied user ID.

## Reauthentication for sensitive actions

Require a fresh Firebase reauthentication (within a short recency window) before:

- Changing the primary phone number.
- Changing or unlinking the primary Google identity.
- Deleting the account.
- Approving high-value payouts or refunds (society-admin scope).
- Rotating API keys or webhook secrets in society settings, once such settings exist.

The recency check runs on the server against verified token claims.

## No user enumeration

Endpoints must not distinguish "unknown phone" from "wrong OTP" from "rate-limited" in a way an attacker can observe:

- Uniform success shape when a lookup is negative.
- Uniform delay characteristics where feasible.
- Never return existence flags to unauthenticated callers.

## Cross-tenant identity hygiene

- A resident belongs to one or more societies via explicit membership rows, not via profile columns.
- Onboarding into a new society always goes through the join workflow; never auto-link by phone without explicit consent.
- Guard, resident, society admin and super admin roles are enforced by the roles table + `has_role`, not by profile flags.

## Failure surface

When an auth-related change fails a check:

- Report the check name (signature, issuer, audience, expiry, rate limit).
- Do not include the token or user PII in the report.
- Route the fix through `sociyohub-systematic-debugging` and re-verify with `sociyohub-verification-gate`.
