# SocioHub — Release Readiness (Source of Truth)

**Every future agent MUST read this file before claiming release status.**

## Permanent Rules

1. **No feature, security requirement, release requirement or Play Store
   requirement may be marked complete without implementation evidence AND test
   evidence. Typecheck alone is not completion.**
2. **Payment gateway and live payment integration remain the final
   implementation stage.** Earlier stages may prepare safe abstractions and UI
   placeholders but MUST NOT activate or replace payment providers, add
   platform fees, or change Cash + Bank Transfer maintenance behavior.
3. **Real production data (society "baldha Meetarth" etc.) is never modified
   for testing. Use ephemeral fixtures and clean them up.**

## State Vocabulary

- `not_started` — no code exists
- `partial` — some code, not usable end-to-end
- `implemented_unverified` — code exists, typecheck passes, no runtime test
- `tested` — automated or scripted runtime tests pass
- `security_verified` — RLS/authz penetration checks passed
- `visually_verified` — screenshot/Playwright parity checks passed
- `release_ready` — all above plus docs, monitoring, and rollback plan
- `blocked` — waiting on a missing secret, service, or decision

## Section Checklists

### 1. Approved Feature Delivery
| Feature | State | Evidence |
|---|---|---|
| Auth (Firebase → Supabase) | tested | Migrated Turn ≤ Stage 2 |
| Onboarding (create/join) | implemented_unverified | — |
| Maintenance (Cash + Bank Transfer only) | implemented_unverified | — |
| Bills / Ledger | implemented_unverified | — |
| Visitors / Guard | implemented_unverified | — |
| Announcements / Notices / Polls | implemented_unverified | — |
| No-Dues (workflow + verification) | implemented_unverified | Trusted-actor RPCs, HMAC-fingerprinted rate limit, dual bucket (30/60s + 10/60s invalid). Runtime authz tests pending. |
| Flat 360 | not_started | Existing `/society/flats/$id` to be upgraded |
| Gamification | not_started | — |
| Feature Directory | implemented_unverified | — |

### 2. Backend Implementation
- Server functions via `createServerFn` — ✅ in use
- `_internal` RPCs receive trusted `_actor_id` from server session — ✅ No-Dues
- Service-role EXECUTE only on privileged RPCs — ✅ No-Dues
- Canonical DB-level eligibility function (`compute_no_dues_eligibility_internal`) — **not yet migrated**
- Atomic rate limiter (`touch_rate_limit` RPC) — ✅
- Never `auth.uid()` inside service-role RPC — ✅

### 3. Frontend Implementation
- Feature-gated routes via `FeatureGate` — ✅
- Mobile-first hero/section pattern — ✅
- No-Dues detail routes (`/society/no-dues/$id`, `/app/no-dues/$id`) — **not_started**

### 4. Multi-Tenant RLS/Security
- Every `public` table has explicit `GRANT` + RLS — audit pending
- `user_roles` in separate table with `has_role()` SECURITY DEFINER — ✅
- Society isolation checks in all eligibility/dues code — pending canonical DB fn
- Storage buckets private + short-lived signed URLs — ✅ no-dues-certificates
- Public verification endpoint returns identical shape for malformed/unknown — ✅

### 5. Advanced Production Security
- `RATE_LIMIT_HMAC_SECRET` required in production, fails closed — ✅ (Turn 7)
- Dual rate-limit buckets (general + invalid attempts) — ✅ (Turn 7)
- Raw IPs never stored (HMAC fingerprint) — ✅
- Raw verification tokens never logged — ✅
- Webhook signature verification (Razorpay) — implemented_unverified
- Endpoint-level input validation with Zod — ✅ where applied
- Content Security Policy — not_started
- Dependency audit (`bun audit`) — not_started
- RLS penetration tests — not_started
- Secrets scan of git history — not_started

### 6. Full UI/UX Usability
- Empty/loading/error states across every route — partial
- Old-age-friendly font sizing / contrast — not_started

### 7. Accessibility
- Focus states, ARIA labels, semantic landmarks — partial
- Keyboard navigation across critical flows — not_started

### 8. Performance
- Route-level code splitting — ✅ via TanStack
- Image lazy loading — partial
- Query staleness / cache tuning — partial
- Lighthouse ≥ 90 (published) — not_started

### 9. Automated Testing
- `tests/billing-cron.test.mjs` — exists
- Vitest unit coverage — minimal
- Playwright end-to-end flows — not_started
- No-Dues authz tests (deny anon RPC, deny cross-society admin, etc.) — not_started

### 10. Manual QA
- Full role matrix walk-through — not_started

### 11. Play Store Readiness
- PWA / native wrapper decision — not_started
- App icons + splash + adaptive icon — not_started
- Deep links — not_started
- Notification permissions flow — not_started
- Privacy / Data Safety form — not_started
- Account deletion flow — not_started
- Legal pages complete — partial

### 12. Privacy / Legal
- Terms + Privacy + Refund + GDPR — partial
- Export user data endpoint — not_started
- Delete user data endpoint — not_started

### 13. Monitoring / Backups / Recovery
- Error capture (`src/lib/error-capture.ts`) — implemented_unverified
- Uptime + latency dashboards — not_started
- DB backup schedule verified — not_started
- Restore drill — not_started

### 14. Final Payment Integration (LAST STAGE)
- **Not to be touched before Final Stage.** Existing Razorpay subscription
  path is preserved as-is.

### 15. Production Launch
- Rollback plan documented — not_started
- Feature-flag kill switches — not_started
- Post-launch on-call rota — not_started

## Update Rule

After every development turn, edit this file to reflect newly `tested` /
`security_verified` / `visually_verified` items. Never downgrade evidence;
never mark `release_ready` without linked commit + test output.
