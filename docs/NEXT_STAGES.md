# Next Stages

## Immediately after Stage 3A closes

### Checkpoint F — Flat 360
Upgrade `src/routes/_society/society.flats.$id.tsx` in place (no duplicate route). Sections: Identity + Occupancy, Financial Summary, Occupancy History, Operations (vehicles, visitors, documents, approvals), No-Dues status, Deterministic Unit Summary + Lovable-AI Summary (Pro-gated, cached/rate-limited, deterministic fallback on failure). Real data only; honest empty states.

### Checkpoint G — No-Dues workflow (Pro)
- Migration (additive): `no_dues_requests`, `no_dues_certificates`, `no_dues_audit`, `check_no_dues_eligibility(unit_id)` RPC. RLS scoped to society + owner; server-side transitions only.
- Storage: private bucket `no-dues-certificates`.
- Server fns in `src/lib/no-dues.functions.ts`: `submitNoDuesRequest`, `reviewNoDuesRequest`, `approveAndIssue` (idempotent), `rejectRequest`, `revokeCertificate`, `listMyRequests`, `listSocietyRequests`. Certificates via `pdf-lib` + `qrcode`.
- Public route: `src/routes/api/public/verify/no-dues.$token.ts` (JSON, minimum data).
- Public page: `src/routes/verify.no-dues.$token.tsx`.
- Society Admin UI: `/society/no-dues`, `/society/no-dues/$id`.
- Resident UI: `/app/no-dues`, `/app/no-dues/$id`.

### Checkpoint H — Gamification (Pro)
- Migration (additive): `payment_points_ledger` (unique on `payment_id`), `society_settings.gamification_enabled`.
- Server fn awarding 2 points on verified on-time payment; reversal handling.
- Leaderboard route already exists — wire it to the new ledger.

### Checkpoint J — Whole-app visual parity
Iterate every route in the "Not touched in Stage 3A" section of `UI_REFERENCE_MAP.md`. Route-level visible changes required. Reference screenshots (user-provided) are source of truth; where absent, use SocioHub tokens + primitives.

## Stage 3B — Non-Member Payments, AI Income Categorization, Reconciliation
All Pro. Feature keys: `non_member_payments`, `ai_income_categorization`, `reconciliation`.

## Stage 3C — AI Secretary / Society Knowledge Base
Pro. Document upload, indexing, source-cited answers from society-uploaded docs only. Feature key: `ai_secretary`.

## Stage 3D — Universal Smart QR, low-risk migration, privacy/transparency controls
All Pro. Feature keys: `smart_qr_collections`, `migration`, `privacy_controls`.

## Stage 3E — Premium enhancements
Advanced AI limits, deeper automation, advanced forecasting, custom branding, higher usage caps, priority support. Premium differentiation lives here — **not** by removing Pro workflows.

---

## Stage 4 — Remaining Feature Completion
Complaints/helpdesk, documents, approvals, notifications, communication, imports/exports, advanced reports across resident/admin/guard/super-admin.

## Stage 5 — Production Security Hardening
Dependency audit, secrets audit, endpoint rate limiting on remaining surfaces, strict schema validation, RLS penetration tests, upload security, audit logs, backups/recovery, export/deletion, session/device security.

## Stage 6 — UI/UX, Accessibility, Performance
Whole-app usability sweep, WCAG-level accessibility, performance budget, offline/error/empty/loading states, user onboarding polish, old-age-friendly usability.

## Stage 7 — Android / Play Store Readiness
PWA vs native wrapper decision, app icons, splash, deep links, notification permissions, Privacy/Data Safety forms, account deletion, legal pages, crash monitoring, release build, internal/closed testing.

## Final Stage — Payment Integration
Payment-provider review, live gateway integration, webhook verification, reconciliation, failure/refund handling, production payment testing. **Absolutely no payment activation before this stage.**

---

**Roadmap Lock:** Payment integration MUST remain the final stage. Any earlier
stage that touches payment activation, platform fees, or replaces
Cash + Bank Transfer maintenance behavior violates the lock. See
`docs/RELEASE_READINESS.md` for permanent rules.
