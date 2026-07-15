# SociyoHub — Master Context

> **Read this file, and every file in `/docs/`, before planning or editing SociyoHub.**
> Do not remove, contradict, downgrade, or silently replace any approved decision below.
> When two decisions conflict, follow the newest dated decision and report the conflict in your response.

Last stage: **Stage 3A** — Unified feature catalog, Feature Directory, Flat 360, Automated No-Dues, Gamification.

---

## Product identity

SociyoHub is a mobile-first management platform for Indian residential societies (apartments, gated communities, row-house layouts). Roles: **Super Admin** (SociyoHub staff), **Society Admin** (elected committee / secretary), **Resident** (owner or tenant), **Guard** (security).

Design system tokens (locked): primary `#00A896`, accent `#06B6A4`, foreground `#0B2545`, background `#F6F8F7`, card `#FFFFFF`, border `#E3E8E6`, success `#10B981`, warning `#F59E0B`, destructive `#E11D48`, info `#2563EB`. Reuse `MobileHero`, `SectionCard`, `ListCard`, `StatPill(Row)`, existing `StatusChip`, `FeatureGate`, `UpgradePrompt`, `LockedFeatureCard`. Never revert to generic `PageHeader`/`PageShell` on user-facing screens the reference covers.

## Authentication — Firebase → Supabase exchange (DO NOT REPLACE)

- **Phone OTP** via Firebase, **Google** via Firebase (branded consent screen).
- Server verifies the Firebase ID token against Google's JWKS
  (`https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com`).
- On success, the server mints a Supabase magic-link `hashed_token`; the browser calls
  `supabase.auth.verifyOtp({ type: "magiclink", token_hash })` to establish the session.
- All app authorization thereafter uses `auth.uid()` and RLS.
- The exchange endpoint is `src/routes/api/public/auth/firebase-session.ts`. **Do not touch** it without a reproducible regression.
- Existing user lookup order: (1) `phone_verifications` for phone flow; (2) `admin.generateLink({ type: "magiclink", email })` for Google — this auto-resolves duplicate emails.

See `AUTH_ARCHITECTURE.md` for the full path.

## Payments (locked)

- **Razorpay** is used **only** for SociyoHub subscription checkout (Basic / Pro / Premium).
- **Maintenance** collection defaults to **Cash** and **Bank Transfer** with Society-Admin verification.
- **Online maintenance gateways** are enabled per-society by SociyoHub Support only.
- **There is no platform fee.** No 1.5%, 1.7%, 98.5%-payable-to-society, or `FeeBreakdown` UI. Do not reintroduce.

See `PAYMENT_ARCHITECTURE.md`.

## Society creation (locked)

`create_society_full` is idempotent, authenticated-EXECUTE only, optional parameters default. Reloads the schema cache. Do not replace or weaken.

## Plan model (rank inheritance)

- `basic` = rank 1, `pro` = rank 2, `premium` = rank 3.
- Access rule: `currentPlanRank >= feature.minPlanRank`.
- **Premium automatically inherits every feature in the catalog.** No manually maintained Premium array.
- Uncategorized existing features default to **Pro** — never silently to Basic.
- Trial and `plan_status = trialing` behave as Premium.

See `FEATURE_MATRIX.md` for the full catalog and per-feature min-plan.

## Non-negotiables

- Additive migrations only. No destructive changes to `auth`, `storage`, `realtime`, `supabase_functions`, `vault`.
- `SUPABASE_SERVICE_ROLE_KEY` server-only. `supabaseAdmin` imported inside handlers with `await import(...)` in client-reachable files.
- Never edit auto-generated files: `src/routeTree.gen.ts`, `src/integrations/supabase/client.ts`, `client.server.ts`, `auth-middleware.ts`, `auth-attacher.ts`, `types.ts`, `.env` (VITE_SUPABASE_*), `supabase/config.toml`.
- Real production society data (e.g. `baldha Meetarth`) is off-limits for test writes.
- Every existing feature is preserved. Discoverability, not removal, is how we clean up sprawl.
