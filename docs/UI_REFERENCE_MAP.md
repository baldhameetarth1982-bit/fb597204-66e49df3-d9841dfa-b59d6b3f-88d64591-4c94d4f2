# UI Reference Map — Stage 3A / Checkpoint E

Route → reference screenshot → current UI status. Update at the end of every stage.

**No reference screenshots or PDFs have been attached by the user for Stage 3A.** All routes are therefore marked `reference-missing` and rendered against the SociyoHub visual system (tokens + primitives from `docs/SOCIYOHUB_MASTER_CONTEXT.md`). Checkpoint J will re-classify routes to `matched` / `partial` / `unmatched` when references are provided.

Status legend:
- `matched` — matches reference exactly (verified at 390 + 1280).
- `partial` — functionality present, visual polish incomplete.
- `unmatched` — reference exists, current UI diverges materially.
- `reference-missing` — no attached reference; uses SociyoHub visual system.
- `stage-3A-updated` — touched in Stage 3A this pass.

## Checkpoint A/D Completeness Audit

**Total routes discovered:** 84
- Public / auth / onboarding: 15
- `_auth`: 1 (login)
- `_resident` (`/app/*`): 26
- `_society` (`/society/*`): 40
- `_admin` (`/admin/*`): 19
- API: `api/public/auth/firebase-session`, `api/public/hooks/*` (razorpay, run-billing, maintenance-reminders), `api/support-chat`

**Total functional modules discovered:** ~55 (routes + supporting server-fn modules under `src/lib/*.functions.ts`).

**Catalog before this pass:** 37 entries — Society Admin heavy, missing every Resident route, every Guard route, every Super Admin route, and several Society routes.

**Catalog gaps identified (to be filled in Checkpoint A/D fix, in same turn as Checkpoint G approval):**

Society Admin routes missing from catalog: `dashboard`, `maintenance`, `billing-settings`, `billing/generate`, `bills/$id`, `contacts`, `bylaws`, `custom-fields`, `explorer`, `payouts`, `matrix-import`, `search`, `residents/$id`, `flats/$id` (mapped only via `flat_360` key).

Resident routes missing from catalog: `dashboard`, `bills`, `dues`, `ledger`, `visitors`, `vehicles`, `comm`, `notices`, `services`, `profile`, `polls`, `family`, `emergency`, `contacts`, `helpdesk`, `trust`, `feed`, `feed/$postId`, `notifications`, `activity`, `achievements`, `search`, `bylaws`, `no-dues` (planned).

Guard routes missing: `app/guard` (guard dashboard).

Super Admin routes missing: all 19 `/admin/*` routes (dashboard, ads, audit, bi, branding, custom-plans, executive, health, income, plans, razorpay, report-builder, revenue, search, security, settings, societies, users, withdrawals).

Public routes intentionally excluded from catalog (marketing / legal / auth surface, not gated features): `/`, `/pricing`, `/login`, `/contact`, `/support`, `/legal`, `/gdpr`, `/privacy`, `/terms`, `/refund`, `/checkout/$planId`, `/onboarding/*`, `/verify-phone`, `/welcome`, `/settings`.

**Duplicate feature entries:** `flat_360` and `flats` both route to `/society/flats` (flat_360 is the Pro upgrade of the same list — kept distinct on purpose; flat_360 gates the drill-in detail view). `gamification` and `leaderboard` both route to `/society/leaderboard` (gamification is umbrella toggle, leaderboard is the surface — kept distinct on purpose).

**Features unreachable from navigation:** After Checkpoint D the Feature Directory (`/society/features`, `/app/features`) surfaces everything; no feature is unreachable.

**Routes intentionally excluded from catalog and why:**
- All onboarding / auth / marketing / legal surfaces — these are entry funnels, not plan-gated features.
- Dynamic detail routes (`/society/bills/$id`, `/society/residents/$id`, `/society/flats/$id`, `/app/feed/$postId`) — surfaced via their parent list entries; adding them separately would duplicate discovery.
- `/society/plan-required`, `/app/plan-required` — upgrade prompts, not features.

## Stage 3A pass — updated routes

| Route | Role | File | Reference | Status | Notes |
|---|---|---|---|---|---|
| `/society/features` | Society Admin | `_society/society.features.tsx` | reference-missing | stage-3A-updated | Feature Directory (search, categories, favorites, recently-used) |
| `/app/features` | Resident | `_resident/app.features.tsx` | reference-missing | stage-3A-updated | Feature Directory (resident view) |
| `/society/more` | Society Admin | `_society/society.more.tsx` | reference-missing | partial | Wires Feature Directory + gamification / no-dues tiles |
| `/society/flats/$id` | Society Admin | `_society/society.flats.$id.tsx` | reference-missing | stage-3A-planned | Flat 360 upgrade queued (Checkpoint F) |
| `/society/no-dues` | Society Admin | (planned) | reference-missing | stage-3A-planned | Queued (Checkpoint G) |
| `/society/no-dues/$id` | Society Admin | (planned) | reference-missing | stage-3A-planned | Queued |
| `/app/no-dues` | Resident | (planned) | reference-missing | stage-3A-planned | Queued |
| `/app/no-dues/$id` | Resident | (planned) | reference-missing | stage-3A-planned | Queued |
| `/verify/no-dues/$token` | Public | (planned) | reference-missing | stage-3A-planned | Queued |
| `/society/leaderboard` | Society Admin | `_society/society.leaderboard.tsx` | reference-missing | partial | Stage 3A adds idempotent points-ledger |
| `/app/achievements` | Resident | `_resident/app.achievements.tsx` | reference-missing | partial | Existing |

## Not touched in Stage 3A — Checkpoint J pass

All remaining routes above have status `reference-missing`. Reusable components across every route: `MobileHero`, `SectionCard`, `ListCard`, `StatPill(Row)`, `StatusChip`, `FeatureGate`, `UpgradePrompt`, `LockedFeatureCard`. Backend data sources: existing Supabase tables listed in `SOCIYOHUB_MASTER_CONTEXT.md` plus new `no_dues_requests`, `no_dues_certificates`, `no_dues_audit`, and `payment_points_ledger` (or reuse `user_points` with idempotency constraint — decided in migration).

Checkpoint J will:
1. Screenshot each route at 360/390/414/1280.
2. Classify each row as `matched` / `partial` / `unmatched` when references are provided.
3. Fix `partial` and `unmatched` visuals without touching business logic.
4. Verify no horizontal overflow, no header/hero overlap, no content hidden behind bottom nav, no FAB collision.
