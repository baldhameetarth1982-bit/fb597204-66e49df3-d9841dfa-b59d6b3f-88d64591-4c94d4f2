# Phase 1 Stabilization Audit — Tracks 2-5

Date: 2026-07-03

## Track 2 — Wizard E2E
Society-setup wizard route (`/onboarding/create`) loads cleanly (HTTP 200, 0
console errors). Full step-by-step Firebase phone OTP flow cannot be
end-to-end tested from the sandbox because Firebase phone auth requires a
real device/reCAPTCHA and a live SMS. Route-level smoke passes.

## Track 3 — Route/Build Audit
- 85 route files scanned.
- **Every route with a `loader:` already has `errorComponent`.** No missing
  error boundaries detected.
- Smoke test at 360×789 across 18 top-level routes:
  - All public routes return 200.
  - All `/society/*`, `/app/*`, `/admin/*` routes correctly redirect to
    sign-in when unauthenticated (managed `_authenticated` gate working).
  - The only hydration warning is React's `data-tsd-source` attribute
    mismatch — this is Lovable's dev-only source annotation and disappears
    in production builds.

## Track 4 — RLS + Storage Audit
- **All 46 public tables have RLS enabled** (`pg_tables.rowsecurity=true`).
- Society-scoped tables (`bills`, `payments`, `flats`, `hierarchy_nodes`,
  `polls`, `posts`, `expenses`, `visitors`, `vehicles`, `blocks`,
  `billing_schedules`, `community_digests`, `society_contacts`,
  `society_settings`, `audit_log`, `join_requests`) all filter reads by
  `get_user_society_id(auth.uid())`, `is_society_admin_for(auth.uid(),
  society_id)`, or `get_admin_society_ids(auth.uid())`. Society isolation
  is enforced consistently.
- User-owned tables (`profiles`, `family_members`, `fcm_tokens`,
  `poll_votes`, `post_comments`, `post_reactions`, `referral_earnings`,
  `resident_subscriptions`) scope to `auth.uid()`.
- Super-admin escape hatch is via `has_role(auth.uid(), 'super_admin')`
  or `is_super_admin(auth.uid())`.
- `pricing_settings` has intentionally-public SELECT (needed for public
  `/pricing` page).
- **Storage**: all 5 buckets (`kyc`, `kyc-admin`, `ads`, `posts`, `uploads`)
  are private. Access is gated by storage RLS policies.

**No leaks found. No migration needed.**

## Track 5 — Mobile UI Pass @ 360px
Screen-by-screen scroll-width check.
- **Only one overflow found**: `/pricing` — the "I need enterprise" button
  next to the units input broke out to 430px.
- **Fixed** in `src/routes/pricing.tsx`: switched the estimator row to
  `flex-col sm:flex-row`, added `min-w-0` on the input and `w-full sm:w-auto
  shrink-0` on the button.
- All authenticated routes redirect to sign-in at 360px without overflow.
- No sub-44px tap targets or off-screen text detected.

## Summary
- ✅ RLS society isolation verified — no leaks.
- ✅ All routes render or gate correctly.
- ✅ Mobile 360px overflow fixed on `/pricing`.
- ✅ Error boundaries present on every loader route.
- ⚠️ Firebase phone OTP flow requires live device testing (out of sandbox scope).
