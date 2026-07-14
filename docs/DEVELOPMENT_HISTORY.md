# Development History

## Stage 3A — 2026-07-14

**Delivered:**
- Source-of-truth docs in `/docs/` (this file + 8 companions).
- Unified feature catalog + Premium auto-inheritance (`src/lib/plan-features.ts`).
- Feature Directory routes: `/society/features`, `/app/features` (search, categories, favorites, recently-used, plan/status badges, role filter).
- `More / Operations` (society) linked to Feature Directory; No-Dues + Leaderboard tiles surfaced.

**Queued (same stage, follow-up turns):**
- Checkpoint F — Flat 360 upgrade on `/society/flats/$id` (identity, financial, occupancy history, operations, No-Dues status, deterministic + AI summary).
- Checkpoint G — No-Dues workflow (migrations `no_dues_requests`, `no_dues_certificates`, `no_dues_audit`, RPC `check_no_dues_eligibility`; server fns; society/resident/public UI; pdf-lib + qrcode certificates in `no-dues-certificates` storage bucket).
- Checkpoint H — Gamification `payment_points_ledger` (idempotent by `payment_id`), `society_settings.gamification_enabled`, server-side award on payment verification.
- Checkpoint J — Whole-app visual parity across all roles (see `UI_REFERENCE_MAP.md`).

**Preserved intact:**
- Firebase → Supabase auth exchange (`firebase-session.ts` unchanged).
- `create_society_full` idempotent flow.
- Razorpay subscription checkout.
- Cash + Bank Transfer maintenance rules; no platform fee.
- All existing routes, tables, feature keys, gamification data (`user_points`, `achievements`).

## Pre-Stage 3A

- Firebase Google + Phone OTP → Supabase magic-link exchange stabilized (JWKS cache, HTTPS-verified Google service-account URL, `admin.generateLink` short-circuit for existing emails).
- SocioHub subscription payments via Razorpay.
