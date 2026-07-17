# Feature Matrix

Source of truth: `src/lib/plan-features.ts` (`getFeatureCatalog()`).
This document is a **snapshot** of the catalog for review purposes — the running app reads the catalog directly.

Legend:
- `built` — route exists, backend ready, reachable from navigation.
- `partial` — route exists but backend or UI is incomplete.
- `planned` — feature key registered, implementation deferred to a future stage.
- `locked` — feature exists but the user's current plan does not include it.

## Plan model

- **Basic** (rank 1) — 8 keys: `society_setup`, `society_profile`, `blocks`, `flats`, `residents`, `billing`, `announcements`, `notices`.
- **Pro** (rank 2) — Basic + **all standard functional features** including Reddit-validated workflows.
- **Premium** (rank 3) — **Every** key in the catalog (auto-inherited).

## Catalog snapshot

| Key | Label | Category | Min Plan | Status | Route |
|---|---|---|---|---|---|
| society_setup | Society Setup | Core Management | Basic | built | /society/setup |
| society_profile | Society Profile | Core Management | Basic | built | /society/business-profile |
| blocks | Blocks & Wings | Residents & Units | Basic | built | /society/blocks |
| flats | Houses / Flats | Residents & Units | Basic | built | /society/flats |
| residents | Residents | Residents & Units | Basic | built | /society/residents |
| billing | Maintenance Billing | Billing & Finance | Basic | built | /society/billing |
| announcements | Announcements | Communication | Basic | built | /society/announcements |
| notices | Notices | Communication | Basic | built | /society/communication |
| expenses | Expenses | Billing & Finance | Pro | built | /society/expenses |
| ledger | Accounts Ledger | Billing & Finance | Pro | built | /society/ledger |
| accounts_center | Accounts Center | Billing & Finance | Pro | built | /society/accounts |
| advanced_reports | Reports | Billing & Finance | Pro | built | /society/reports |
| bill_templates | Bill Templates & Branding | Billing & Finance | Pro | built | /society/bill-studio |
| resident_import | Bulk Resident Import | Migration & Imports | Pro | built | /society/import |
| matrix | Maintenance Matrix | Billing & Finance | Pro | built | /society/matrix |
| visitors | Visitor Management | Visitors & Security | Pro | built | /society/visitors |
| vehicles | Vehicle Registry | Visitors & Security | Pro | built | /society/vehicles |
| polls | Polls & Voting | Communication | Pro | built | /society/polls |
| team_roles | Team & Roles | Settings & Admin | Pro | built | /society/team |
| approvals | Approvals | Residents & Units | Pro | built | /society/approvals |
| verifications | Resident Verifications | Residents & Units | Pro | built | /society/verifications |
| flat_360 | Flat / Unit 360 | Residents & Units | Pro | **partial** | /society/flats |
| no_dues | No-Dues Certificate | Certificates & Compliance | Pro | **planned** | /society/no-dues |
| non_member_payments | Non-Member Payments | Billing & Finance | Pro | **partial** (Turn 18B.1 read-only UI: dashboard, list, detail at /society/income) | — |
| ai_income_categorization | AI Income Categorization | AI & Insights | Pro | planned | — |
| ai_secretary | AI Secretary | AI & Insights | Pro | planned | — |
| smart_qr_collections | Smart QR Collections | Billing & Finance | Pro | planned | — |
| reconciliation | Reconciliation | Billing & Finance | Pro | partial | — |
| migration | Low-Risk Migration | Migration & Imports | Pro | planned | — |
| privacy_controls | Privacy & Transparency | Settings & Admin | Pro | planned | — |
| gamification | Gamification | Community & Gamification | Pro | **partial** | /society/leaderboard |
| payment_points | Payment Points | Community & Gamification | Pro | partial | — |
| leaderboard | Leaderboard | Community & Gamification | Pro | built | /society/leaderboard |
| ai_digest | AI Digest & Insights | AI & Insights | Premium | built | /society/digest |
| custom_branding | Custom Branding | Settings & Admin | Premium | planned | — |
| online_gateway_request | Online Gateway Request | Integrations | Premium | planned | — |
| advanced_automation | Advanced Automation | Settings & Admin | Premium | partial | /society/automations |

## Audit findings

### Existing routes not yet in catalog (reachable, but not tagged as features)

These stay untouched — they're settings/utility routes, not "features" in the entitlement sense:
- `/society/dashboard`, `/society/search`, `/society/more`, `/society/plan-required`, `/society/setup`, `/society/contacts`, `/society/bylaws`, `/society/payouts`, `/society/announcements`, `/society/billing-settings`, `/society/billing/generate`, `/society/bills/$id`, `/society/flats/$id`, `/society/residents/$id`, `/society/matrix-import`.

### Existing gamification tables (preserved)

- `achievements` (7 columns, 1 policy)
- `user_points` (6 columns, 1 policy)
- `/society/leaderboard` route exists
- `/app/achievements` route exists
- **Gap**: no idempotent payment→points ledger. Checkpoint H will add `payment_points_ledger` (unique on `payment_id`) additively.

### No-Dues (planned)

- No existing tables, routes, or server fns matched `no.dues|nodues|no_dues`.
- Checkpoint G will add tables + RLS + server fns + 4 UI routes + public verification.

## Stage 2A closure (canonical structure model)

- Canonical: `societies` + `blocks` + `flats`. `hierarchy_nodes` is legacy compatibility only.
- `societies.structure_mode` is `'structured' | 'serial'` (nullable for legacy).
- `flats.block_id` is nullable in serial mode; a BEFORE-trigger enforces mode rules.
- New RPCs (SECURITY DEFINER, authenticated-only): `get_society_structure_overview`, `configure_society_structure_mode`, `list_society_units_page`, `create_society_unit`, `update_society_unit`, `set_society_unit_active`, `set_society_block_active`.
- Unsafe mode conversions with existing units are blocked; ambiguous legacy data left unchanged.
- `commit_society_wizard` writes canonical rows and no longer creates a fake "Houses" block for serial.

## Stage 2C completion (2026-07-17)
- Canonical capability parity: SQL role allowlists mirror
  `capabilitiesForRole(role)` from `src/lib/role-permissions.ts` and
  reject unknown capabilities before any role shortcut.
- Multi-block Block Admin scope: `public.user_role_block_scopes`
  canonical table; `admin_upsert_team_role_v2(_block_ids uuid[])`;
  Team & Roles UI multi-select chips.
- Privacy decision helpers: `resolve_privacy_access`,
  `resolve_financial_visibility`, `list_society_residents_safe_page`.
- Typed Stage 2C adapters: no `as any` remains in
  `team-admin.functions.ts` or `privacy-decisions.functions.ts`.
