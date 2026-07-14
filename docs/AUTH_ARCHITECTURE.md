# Authentication Architecture

## Flow

1. **Client** invokes Firebase Phone OTP or Firebase Google popup (`signInWithPopup`).
2. **Client** obtains a Firebase ID token.
3. **Client** POSTs `{ provider, idToken, phone? }` to `/api/public/auth/firebase-session`.
4. **Server** verifies the JWT against Google's JWKS:
   `https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com`
   - Algorithm: RS256.
   - Issuer: `https://securetoken.google.com/sociohub-49e4f`.
   - Audience: `sociohub-49e4f`.
   - JWKS cached in-memory for 1 hour.
5. **Server** resolves / creates the Supabase auth user:
   - **Phone**: lookup by phone in `phone_verifications`; if missing, create with `admin.createUser({ phone, phone_confirm: true, ... })`.
   - **Google**: `admin.generateLink({ type: "magiclink", email })` — this returns a hashed token regardless of whether the user pre-existed. This is what fixed "A user with this email address has already been registered".
6. **Server** returns `{ email, token_hash }`.
7. **Client** calls `supabase.auth.verifyOtp({ type: "magiclink", token_hash })` → Supabase session established.

## Never touch

- `src/routes/api/public/auth/firebase-session.ts` (unless a reproducible regression).
- `src/integrations/supabase/client.ts`, `client.server.ts`, `auth-middleware.ts`, `auth-attacher.ts`, `types.ts`.
- `.env` VITE_SUPABASE_* keys.
- `supabase/config.toml`.

## RLS everywhere after that

Once `auth.uid()` is available, every table with user data enforces access via RLS policies scoped to `auth.uid()` and/or `has_role(auth.uid(), 'admin')` and/or society membership. Roles live in `user_roles` (never on profiles).

## Server-function auth

- Protected server fns use `.middleware([requireSupabaseAuth])`.
- The generated `attachSupabaseAuth` `functionMiddleware` in `src/start.ts` attaches the bearer token client-side.
- Never call a protected server fn from a public route loader — SSR has no session and prerender 401s.
