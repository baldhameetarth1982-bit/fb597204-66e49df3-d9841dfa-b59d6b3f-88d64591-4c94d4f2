# Stage 2E — Visible UI Correction Plan

You are right to call out the previous passes. The last passes touched routes but kept `PageHeader` + `PageShell` + shadcn `Card` grids, so the live screens still look like a generic SaaS admin. This plan replaces the actual visible surfaces, not helpers.

Honest scope note: 20 routes at ~5,200 LOC in one turn is where "typecheck passed" stops meaning "UI changed". I want to split this into **3 sequential build passes** so each one produces screens you can visually inspect before approving the next. If you'd rather I do it in one giant pass, say so and I will, but the risk of drift is real.

---

## Failure map (audit before touching anything)


| Route                                                      | File                        | Visible problem today                                                | Uses generic PageHeader/Shell?  | To replace with                                                    |
| ---------------------------------------------------------- | --------------------------- | -------------------------------------------------------------------- | ------------------------------- | ------------------------------------------------------------------ |
| /admin/dashboard                                           | `admin.dashboard.tsx`       | 12 identical tile cards + metric grid — looks like a shadcn template | No shell, but generic Card grid | Command-center hero + grouped modules                              |
| /admin/societies                                           | `admin.societies.tsx`       | Raw table                                                            | Yes                             | Mobile card list + filter chips                                    |
| /admin/users                                               | `admin.users.tsx`           | Raw table + filters                                                  | Yes                             | Mobile card list + role chips                                      |
| /admin/reports/plan-required/razorpay                      | various                     | Generic PageShell text                                               | Yes                             | Mobile hero + status cards                                         |
| /society/dashboard                                         | `society.dashboard.tsx`     | Already partially redesigned; check density                          | Partial                         | Verify hero + KPI band + activity feed                             |
| /society/more                                              | `society.more.tsx`          | Tile grid inside plain PageShell                                     | Yes                             | Hero header + section cards (already close, needs hero)            |
| /society/residents                                         | `society.residents.tsx`     | Uses PageHeader; list style unclear                                  | Yes                             | Mobile roster cards + search bar hero                              |
| /society/billing (+ generate/bill-studio/billing-settings) | 4 files                     | Feel like separate pages, not one center                             | Yes                             | Unified Billing Center hero + tab band pinned + card body          |
| /society/accounts/ledger/expenses/reports                  | 4 files                     | Raw tables first                                                     | Yes                             | Summary hero + chart card + transaction cards                      |
| /society/maintenance/matrix                                | 2 files                     | Wide tables, overflow risk on 390px                                  | Yes                             | Sticky-header table wrapped in scroll shell + mobile card fallback |
| /society/communication                                     | `society.communication.tsx` | Generic cards                                                        | Yes                             | Hub layout: composer hero + channel list                           |
| /society/digest                                            | `society.digest.tsx`        | Insight cards on plain page                                          | Yes                             | AI hero band + insight stack                                       |
| /society/import                                            | `society.import.tsx`        | Stepper already added; verify visual                                 | Partial                         | Hero + step tracker card                                           |
| /society/team                                              | `society.team.tsx`          | Generic list                                                         | Yes                             | Member cards + role chips                                          |


## SocioHub visual system (locked for this pass)

Applied via **new** primitives, not by editing helpers scattered around:

- `MobileHero` — gradient teal→navy header block, title + subtitle + optional stat pills, rounded-b-[32px]
- `StatPill` — compact KPI row for hero (label / value / delta color)
- `SectionCard` — rounded-2xl white card with soft border + optional icon header
- `ListCard` — flush list row primitive (avatar + title + meta + trailing chip)
- `StatusChip` — teal/amber/rose/slate variants, rounded-full, uppercase tracking

Tokens (already in `src/styles.css`, verify only — no destructive edits):

- primary teal, foreground navy, muted soft-slate
- shadow-elegant on hero, shadow-sm on cards
- radius: card=2xl (16px), hero=[32px]

Every redesigned route swaps `PageHeader/PageShell` for `MobileHero + <div className="px-4 pb-24 -mt-6 space-y-4">…</div>`.

## Phased execution

**Pass A — Foundations + Super Admin (this turn if you approve)**

1. Create primitives: `MobileHero.tsx`, `StatPill.tsx`, `SectionCard.tsx`, `ListCard.tsx`, `StatusChip.tsx` in `src/components/shared/`.
2. Rebuild `/admin/dashboard` — hero with MRR + counts, then 4 grouped module bands (Growth / Operations / Money / Platform) using SectionCard + ListCard, no 12-tile grid.
3. Rebuild `/admin/societies` and `/admin/users` — filter chip strip + mobile card list; desktop keeps same list widened.
4. Sweep `/admin/plan-required`, `/admin/razorpay` for wording (Cashfree = plan payments, no Razorpay-first copy, no platform fee).
5. Typecheck + open each route in Playwright at 390px + 1280px, screenshot, and paste screenshot filenames back so you can confirm visibly before Pass B.

**Pass B — Society Admin core**
Dashboard verify, More hero, Residents, Billing Center (4 files unified visually via shared BillingHero component), Maintenance, Matrix.

**Pass C — Society Admin remainder**
Accounts, Ledger, Expenses, Reports, Communication, Digest, Import, Team.

## Guardrails (unchanged from earlier passes)

- No auth / RLS / schema / payment / subscription changes.
- All real data queries preserved; no invented KPIs.
- FeatureGate / UpgradePrompt / LockedFeatureCard from Stage 2D untouched; locked tiles keep lock badges.
- Payment copy: Cashfree = SocioHub plan billing only. No platform fee. Maintenance = Cash + Bank Transfer by default, online gateway is support-enabled.
- Bottom nav, top bar, drawer, FAB not rebuilt unless a hero collision requires it.

## Definition of done for each pass

Not "typecheck passed". A pass is done when for **every route in that pass**:

1. The route file no longer imports `PageHeader`/`PageShell` (or has explicit justification).
2. A Playwright screenshot at 390×844 shows the new hero + card system.
3. Real backend data still renders (or empty-state card if no data).

## Technical details

- Primitives live in `src/components/shared/` and are pure presentational — no data fetching, no context.
- `MobileHero` accepts `title`, `subtitle`, `stats?: StatPillProps[]`, `action?: ReactNode`, `variant?: 'teal' | 'navy' | 'muted'`.
- Existing helpers (`PageHeader`, `PageShell`) are kept in the repo for any resident-facing route already using them — we do not delete, we just stop importing them from admin/society routes.
- No changes to `src/integrations/supabase/*`, `src/lib/plan-features.ts`, `useFeatureAccess.ts`, `FeatureGate.tsx`, `UpgradePrompt.tsx`, `LockedFeatureCard.tsx`, migrations, or `src/routeTree.gen.ts` (auto-gen).

---

**Please confirm one of:**

- **A)** Approve phased plan → I start Pass A now (primitives + Super Admin, ~6 files, screenshots back for review).
- **B)** Do it all in one pass anyway → higher drift risk; I'll batch but cannot screenshot 20 routes reliably in a single turn.
- **C)** Different priority order → tell me which routes matter most and I'll re-plan.
  Approved: Start Stage 2E Pass A only.
  Scope:
  - Foundations/primitives
  - Super Admin visible UI correction
  - Do not touch Society Admin yet except shared primitives if needed.
  Important correction:
  Do NOT create a duplicate StatusChip if one already exists.
  First inspect existing StatusChip components:
  - src/components/system/StatusChip.tsx
  - src/components/shared/StatusChip.tsx if present
  Reuse or extend the existing one safely.
  Avoid duplicate components with the same purpose.
  Pass A tasks:
  1. Confirm build/typecheck is clean before coding.
  2. Create/upgrade shared visual primitives:
     - MobileHero
     - StatPill
     - SectionCard
     - ListCard
     - reuse existing StatusChip
  3. Rebuild visible Super Admin routes:
     - /admin/dashboard
     - /admin/societies
     - /admin/users
     - /admin/plan-required
     - /admin/razorpay or legacy payment admin screen if visible
  4. Remove generic shadcn dashboard look from these routes.
  5. Replace raw table-first UI with premium mobile card-first layouts.
  6. Keep real data only. No fake KPIs.
  7. No auth/RLS/schema/payment/subscription/database changes.
  8. Do not modify FeatureGate/subscription entitlement system from Stage 2D.
  9. Keep payment rules:
     - Cashfree = SocioHub plan/subscription payments
     - no platform fee
     - maintenance payments = cash + bank transfer by default
     - online maintenance gateway = contact support only
  Acceptance requirement:
  For every route changed, report:
  Route | File changed | Before problem | Visible change made | Remaining gap
  Also provide:
  - screenshot filenames or screenshot evidence at 390px and 1280px
  - exact files changed
  - confirmation targeted routes no longer use generic PageHeader/PageShell unless justified
  - typecheck result
  Do not proceed to Pass B without approval.