## Goal
Lock the entire society behind a paid plan after the 14-day trial, force plan selection right after society creation, isolate societies cryptographically via RLS, and harden the app with rate limiting everywhere.

## 1. Plan-gate flow (society admin)

**New route: `/onboarding/plan`** (mandatory step, cannot be skipped)
- Shown immediately after `create_society_for_current_user` succeeds.
- Beautiful Material 3 dark "Executive" card layout, 4 cards (Free Trial / Basic / Pro / Premium), hero gradient, plan comparison, social proof, "What you lose if you don't subscribe" section.
- Trial CTA: starts 14-day trial (sets `societies.trial_ends_at = now()+14d`, `plan_id='trial'`, `plan_status='trialing'`).
- Paid CTA: routes to `/checkout/$planId` (already exists, Razorpay-gated).
- Back button + sign-out are the only escapes. No `/app` or `/society` route is reachable until a plan choice exists.

**Schema additions (`societies`):**
- `plan_status text` — `none | trialing | active | expired | cancelled`
- `trial_ends_at timestamptz`
- `plan_expires_at timestamptz`
- `plan_selected_at timestamptz`

**Server fn `start_trial_for_society`** (RPC): only callable by that society's admin, only if `plan_status='none'`, sets trial fields. Idempotent. Rate-limited (1/min/user).

## 2. Hard gate everywhere

**New helper: `society_has_access(_society_id uuid) returns boolean`** (SECURITY DEFINER)
- Returns true if `plan_status='active'` OR (`plan_status='trialing'` AND `trial_ends_at > now()`).
- Super admin always true.

**Layout guards:**
- `_society.tsx` and `_resident.tsx` query `society_has_access(societyId)`. If false → redirect to:
  - Society admin → `/society/plan-required` (full-screen "Your plan expired" page with renew CTA, beautiful design, lists features they're losing).
  - Resident → `/app/plan-required` ("Your society's subscription has ended. Please ask your society admin to renew.").
- Super admin bypasses.

**Checkout hardening:** `/checkout/$planId` already checks `is_razorpay_live()`. Add server-side verification of Razorpay payment signature (HMAC) on the success webhook before flipping `plan_status='active'`. No client-side trust.

## 3. Cross-society isolation (RLS audit)

Run a systematic RLS audit. For every table with `society_id`:
- Drop any policy using bare `auth.uid()` membership without `society_id` scoping.
- Replace with `using (authorize_membership(auth.uid(), society_id))` (already exists).
- Admin write policies must use `is_society_admin_for(auth.uid(), society_id)` strictly equal to the row's society_id.

**Cross-society profile leak fix:** `profiles.society_id` updates restricted — residents can only update their own profile, but cannot change `society_id` arbitrarily (only via `join_society_with_code`).

**Add test migration** asserting no policy uses `true` or unbounded membership on multi-tenant tables.

## 4. Resident ad-removal plan (₹50/mo)

- New plan row `id='ad_free'`, individual scope (`scope='resident'` column added to `plans`).
- Only shown to residents whose society's plan has `ads_enabled=true`.
- New table `resident_subscriptions(user_id, plan_id, status, expires_at)`.
- `AdBanner` component checks: society plan has ads + resident has no active `ad_free` sub → show.

## 5. Rate limiting everywhere

Wrap every sensitive server fn / public route with `checkRateLimit`:
- Auth: login (5/15min — already), signup (3/hr/IP), OTP (3/10min/phone), password reset (3/hr/email).
- Writes: bills create (30/min/society), payments (10/min/user), posts (10/min/user), comments (30/min/user), reactions (60/min/user), polls vote (per poll 1/user).
- Reads heavy: AI block generator (5/hr/user), referrals (10/min/user).
- Public APIs (`/api/public/*`): per-IP 60/min default.

Centralize in `rate-limit.server.ts`; add `withRateLimit(bucket, limit, windowSec)` middleware helper for `createServerFn`.

## 6. Plan-required pages (design)

Full-screen, executive dark, gradient hero (deep red → black), hero illustration (generated), countdown if trialing, big "Renew now" CTA, plan grid below, testimonials carousel, FAQ accordion. Mobile-first.

## 7. Acceptance checks
- New society → cannot reach `/society/dashboard` without picking trial/plan.
- Trial expired → admin sees plan-required, residents see read-only "subscription ended" screen.
- Tampering `society_id` in client request → RLS blocks; verified by SQL test queries.
- Razorpay success without valid signature → server rejects, plan stays unchanged.
- 100 rapid requests to any rate-limited fn → 429-equivalent after limit.

## Technical notes
- Migrations: 1 big migration for schema + RLS audit + `society_has_access` + `start_trial_for_society` + ad_free plan + resident_subscriptions.
- Files: `src/routes/onboarding.plan.tsx`, `src/routes/_society/society.plan-required.tsx`, `src/routes/_resident/app.plan-required.tsx`, `src/lib/plan-gate.functions.ts`, `src/lib/rate-limit-middleware.server.ts`, edits to `_society.tsx`, `_resident.tsx`, `onboarding.create.tsx`, `checkout.$planId.tsx`, `AdBanner.tsx`, `pricing.tsx`.
- Razorpay signature verification needs `RAZORPAY_KEY_SECRET` (already documented as server-side secret).

## Scope NOT included
- Updating vulnerable npm deps (separate concern, can do after if you want).
- Building admin UI to manually extend a society's plan (super-admin can do via DB for now).

Ready to ship this in one go after approval.