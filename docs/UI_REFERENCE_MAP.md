# UI Reference Map

Route → reference screenshot → current UI status. Update at the end of every stage.

Status legend:
- `matched` — matches reference exactly (verified at 390 + 1280).
- `partial` — functionality present, visual polish incomplete.
- `unmatched` — reference exists, current UI diverges materially.
- `reference-missing` — no attached reference yet; using SocioHub visual system (tokens + primitives).
- `stage-3A-updated` — touched in Stage 3A this pass.

## Stage 3A pass

| Route | Role | File | Reference | Status | Notes |
|---|---|---|---|---|---|
| `/society/features` | Society Admin | `_society/society.features.tsx` | reference-missing | stage-3A-updated | New — Feature Directory (search, categories, favorites, recently-used) |
| `/app/features` | Resident | `_resident/app.features.tsx` | reference-missing | stage-3A-updated | New — Feature Directory (resident view) |
| `/society/more` | Society Admin | `_society/society.more.tsx` | reference-missing | partial | Existing; Stage 3A wires Feature Directory entry + gamification / no-dues tiles |
| `/society/flats/$id` | Society Admin | `_society/society.flats.$id.tsx` | reference-missing | stage-3A-planned | Flat 360 upgrade queued (Checkpoint F) |
| `/society/no-dues` | Society Admin | (planned) | reference-missing | stage-3A-planned | Queued (Checkpoint G) |
| `/society/no-dues/$id` | Society Admin | (planned) | reference-missing | stage-3A-planned | Queued |
| `/app/no-dues` | Resident | (planned) | reference-missing | stage-3A-planned | Queued |
| `/app/no-dues/$id` | Resident | (planned) | reference-missing | stage-3A-planned | Queued |
| `/verify/no-dues/$token` | Public | (planned) | reference-missing | stage-3A-planned | Queued |
| `/society/leaderboard` | Society Admin | `_society/society.leaderboard.tsx` | reference-missing | partial | Existing; Stage 3A adds idempotent points-ledger |
| `/app/achievements` | Resident | `_resident/app.achievements.tsx` | reference-missing | partial | Existing |

## Not touched in Stage 3A (Checkpoint J pass will cover)

Public: `/`, `/pricing`, `/login`, `/onboarding.*`, `/legal`, `/gdpr`, `/privacy`, `/terms`, `/refund`, `/contact`, `/support`, `/checkout.$planId`.

Society Admin: `/society/dashboard`, `/society/residents`, `/society/residents/$id`, `/society/billing`, `/society/billing/generate`, `/society/bills/$id`, `/society/bill-studio`, `/society/billing-settings`, `/society/maintenance`, `/society/matrix`, `/society/matrix-import`, `/society/accounts`, `/society/ledger`, `/society/expenses`, `/society/reports`, `/society/visitors`, `/society/vehicles`, `/society/communication`, `/society/announcements`, `/society/polls`, `/society/team`, `/society/import`, `/society/digest`, `/society/plan-required`, `/society/setup`, `/society/business-profile`, `/society/blocks`, `/society/approvals`, `/society/verifications`, `/society/contacts`, `/society/bylaws`, `/society/custom-fields`, `/society/explorer`, `/society/payouts`, `/society/automations`, `/society/search`.

Resident: `/app/dashboard`, `/app/bills`, `/app/dues`, `/app/visitors`, `/app/vehicles`, `/app/comm`, `/app/services`, `/app/profile`, `/app/notices`, `/app/polls`, `/app/family`, `/app/emergency`, `/app/contacts`, `/app/helpdesk`, `/app/trust`, `/app/plan-required`, `/app/ledger`, `/app/bylaws`, `/app/feed`, `/app/feed/$postId`, `/app/notifications`, `/app/activity`, `/app/search`.

Guard: `/app/guard`.

Super Admin: `/admin/*` (19 routes).

**All rows in this section have status `reference-missing` and require Checkpoint J visual pass.**
