## Root cause

`/api/public/auth/firebase-session` verifies the Firebase ID token by fetching Google's X.509 cert bundle:

```
https://www.googleapis.com/robot/v1/metadata/x509/[email protected]
```

inside a Cloudflare Worker. The `fetch` throws (or returns non-OK) in the Worker runtime, so `loadCerts()` bubbles up the generic message `"Could not load Firebase certs"`. That's why Google sign-in completes in the browser (Firebase returns a valid ID token — visible in the network log), but the very next call — POST `/api/public/auth/firebase-session` — returns 401 with `{"error":"Could not load Firebase certs"}`.

The Phone OTP path goes through the same endpoint and would fail the same way; this is not Google-specific.

## Fix

Replace the hand-rolled X.509 cert fetch + `importX509` with `jose`'s `createRemoteJWKSet` pointed at Google's JWK endpoint. It's the officially recommended path, natively handles kid rotation and caching, and works on Cloudflare Workers without a bespoke cache layer.

### Change in `src/routes/api/public/auth/firebase-session.ts`

1. Remove `importX509`, `CERTS_URL`, the `certCache` variable, and `loadCerts()`.
2. Add a module-level JWKS:

   ```ts
   import { createRemoteJWKSet, jwtVerify } from "jose";

   const JWKS = createRemoteJWKSet(
     new URL(`https://www.googleapis.com/service_accounts/v1/jwk/[email protected]`),
     { cooldownDuration: 60_000 },
   );
   ```

3. Rewrite `verifyFirebaseIdToken` to:

   ```ts
   const { payload } = await jwtVerify(idToken, JWKS, {
     algorithms: ["RS256"],
     issuer: ISSUER,
     audience: FIREBASE_PROJECT_ID,
   });
   return payload as unknown as FirebasePayload;
   ```

   Drop the manual base64 header decode — `jose` reads the `kid` from the JWKS resolver.
4. In the `POST` handler's `catch`, surface `e?.message` unchanged so real errors (expired token, bad audience, JWKS fetch failure) are distinguishable in the 401 response instead of the misleading "Could not load Firebase certs".

No other files need to change. Onboarding, phone OTP verify, session minting, and `verifyOtp` on the client all keep working — only the token-verification primitive changes.

## Verification

- `bunx tsgo --noEmit` → exit 0.
- Preview: sign in with Google as the reviewer account. Expect POST `/api/public/auth/firebase-session` → 200 with `{ email, token_hash }`, then the client's `supabase.auth.verifyOtp({ token_hash, type: 'magiclink' })` establishes the session and routing lands on onboarding or the role home.
- Phone OTP path: request OTP → verify → same endpoint returns 200 and signs the user in.

## Non-goals / guardrails

- No auth/RLS/schema/migration/payment/subscription changes.
- No frontend edits (`login.tsx`, `auth-service`, etc. are untouched).
- Firebase config, service-role usage, and the magic-link ceremony remain identical.
- Cashfree wording, Razorpay flow, and society data are not touched.
