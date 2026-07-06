# SocioHub — Route × Role × Shell Audit (Pass 1)

Generated for Pass 1 (global shell + role-based navigation). No routes are
deleted or redirected in this pass. This document is the reference for
future feature-screen passes.

## Roles

- **Public** — unauthenticated marketing / legal / auth pages
- **Onboarding** — authenticated but no active society yet
- **Resident** — `/app/*` (except guard subtree)
- **Guard** — `/app/guard*` (currently lives inside `_resident` route file)
- **Society Admin** — `/society/*`
- **Super Admin** — `/admin/*`

## Bottom-nav targets (Pass 1)

| Role          | Tabs                                                         |
| ------------- | ------------------------------------------------------------ |
| Resident      | Home, Bills, Visitors, Society, Profile                      |
| Society Admin | Dashboard, Billing, Residents, Operations, More              |
| Guard         | Dashboard, History, Settings                                 |
| Super Admin   | Overview, Societies, Users, Reports, More                    |

## Route mapping

### Public / Auth

| Route file             | URL              | Shell   | Notes                        |
| ---------------------- | ---------------- | ------- | ---------------------------- |
| `index.tsx`            | `/`              | bare    | Landing                      |
| `_auth/login.tsx`      | `/login`         | bare    | Sign-in                      |
| `verify-phone.tsx`     | `/verify-phone`  | bare    | OTP                          |
| `welcome.tsx`          | `/welcome`       | default |                              |
| `pricing.tsx`          | `/pricing`       | default | Marketing                    |
| `contact.tsx`          | `/contact`       | default | Marketing                    |
| `support.tsx`          | `/support`       | bare    |                              |
| `legal.tsx`            | `/legal`         | default |                              |
| `privacy.tsx`          | `/privacy`       | default |                              |
| `terms.tsx`            | `/terms`         | bare    |                              |
| `refund.tsx`           | `/refund`        | default |                              |
| `gdpr.tsx`             | `/gdpr`          | default |                              |
| `checkout.$planId.tsx` | `/checkout/:id`  | default |                              |

### Onboarding

| Route file                | URL                     | Shell        |
| ------------------------- | ----------------------- | ------------ |
| `onboarding.index.tsx`    | `/onboarding`           | Onboarding   |
| `onboarding.create.tsx`   | `/onboarding/create`    | Onboarding   |
| `onboarding.join.tsx`     | `/onboarding/join`      | Onboarding   |
| `onboarding.pending.tsx`  | `/onboarding/pending`   | Onboarding   |
| `onboarding.plan.tsx`     | `/onboarding/plan`      | Onboarding   |

### Resident (`/app/*`)

Tab mapping for Resident bottom nav (Home / Bills / Visitors / Society / Profile):

| URL                     | Nav slot                     | Notes                                     |
| ----------------------- | ---------------------------- | ----------------------------------------- |
| `/app/dashboard`        | Home (active)                |                                           |
| `/app/bills`            | Bills (active)               |                                           |
| `/app/dues`             | Bills                        | duplicate-ish; keep, doc only             |
| `/app/ledger`           | Bills                        |                                           |
| `/app/visitors`         | Visitors (active)            |                                           |
| `/app/guard`            | (GuardShell — separate)      | routed to guard shell in __root switcher  |
| `/app/comm`             | Society (active)             | unified Communication Center              |
| `/app/notices`          | Society                      | probable duplicate of /app/comm — flagged, not redirected |
| `/app/helpdesk`         | Society                      |                                           |
| `/app/contacts`         | Society                      |                                           |
| `/app/bylaws`           | Society                      |                                           |
| `/app/feed`             | Society                      |                                           |
| `/app/feed/$postId`     | Society                      |                                           |
| `/app/polls`            | Society                      |                                           |
| `/app/notifications`    | Society                      | notifications inbox                       |
| `/app/emergency`        | Society                      |                                           |
| `/app/profile`          | Profile (active)             |                                           |
| `/app/family`           | Profile                      |                                           |
| `/app/vehicles`         | Profile                      |                                           |
| `/app/services`         | Profile                      |                                           |
| `/app/trust`            | Profile                      |                                           |
| `/app/achievements`     | Profile                      |                                           |
| `/app/activity`         | Profile                      |                                           |
| `/app/search`           | (top-bar search action)      | not a bottom-nav tab                      |
| `/app/plan-required`    | (blocker)                    | shell shows no bottom nav here            |

**Duplicate/overlap candidates (documented, not touched):**
- `/app/notices` vs `/app/comm` — appears to be replaced by unified `/app/comm`.
- `/app/dues` vs `/app/bills` — overlapping billing surfaces.

### Guard

| URL          | Nav slot   |
| ------------ | ---------- |
| `/app/guard` | Dashboard  |

Guard bottom nav planned tabs (History, Settings) do not have dedicated routes today.
For Pass 1 the tabs will link to the closest existing routes:
- History → `/app/guard` (until a real history route ships)
- Settings → `/settings`

Follow-up pass owns the real Guard sub-routes and (later) a `_guard` route folder move.

### Society Admin (`/society/*`)

| URL                          | Nav slot     |
| ---------------------------- | ------------ |
| `/society/dashboard`         | Dashboard    |
| `/society/billing`           | Billing      |
| `/society/billing-settings`  | Billing      |
| `/society/bill-studio`       | Billing      |
| `/society/accounts`          | Billing      |
| `/society/ledger`            | Billing      |
| `/society/expenses`          | Billing      |
| `/society/payouts`           | Billing      |
| `/society/reports`           | Billing      |
| `/society/residents`         | Residents    |
| `/society/residents/$id`     | Residents    |
| `/society/flats`             | Residents    |
| `/society/blocks`            | Residents    |
| `/society/approvals`         | Residents    |
| `/society/verifications`     | Residents    |
| `/society/import`            | Residents    |
| `/society/matrix`            | Operations   |
| `/society/matrix-import`     | Operations   |
| `/society/maintenance`       | Operations   |
| `/society/visitors`          | Operations   |
| `/society/vehicles`          | Operations   |
| `/society/polls`             | Operations   |
| `/society/announcements`     | Operations   |
| `/society/digest`            | Operations   |
| `/society/contacts`          | Operations   |
| `/society/bylaws`            | Operations   |
| `/society/automations`       | Operations   |
| `/society/business-profile`  | More         |
| `/society/team`              | More         |
| `/society/custom-fields`     | More         |
| `/society/explorer`          | More         |
| `/society/setup`             | More         |
| `/society/leaderboard`       | More         |
| `/society/search`            | (top-bar)    |
| `/society/plan-required`     | (blocker)    |

### Super Admin (`/admin/*`)

| URL                       | Nav slot     |
| ------------------------- | ------------ |
| `/admin/dashboard`        | Overview     |
| `/admin/executive`        | Overview     |
| `/admin/health`           | Overview     |
| `/admin/societies`        | Societies    |
| `/admin/withdrawals`      | Societies    |
| `/admin/razorpay`         | Societies    |
| `/admin/users`            | Users        |
| `/admin/plans`            | Users        |
| `/admin/custom-plans`     | Users        |
| `/admin/bi`               | Reports      |
| `/admin/revenue`          | Reports      |
| `/admin/income`           | Reports      |
| `/admin/report-builder`   | Reports      |
| `/admin/audit`            | Reports      |
| `/admin/security`         | More         |
| `/admin/ads`              | More         |
| `/admin/branding`         | More         |
| `/admin/settings`         | More         |
| `/admin/search`           | (top-bar)    |

## Duplicate navigation components (before Pass 1)

- `src/components/resident/ResidentBottomNav.tsx` — actively used by `_resident.tsx`
- `src/components/shared/ResidentBottomNav.tsx` — orphan; different tab set

Both are replaced by compatibility re-exports pointing to
`src/components/nav/ResidentBottomNav.tsx` in Pass 1.

## Pass 1 changes summary

- Added: `src/components/nav/{Resident,SocietyAdmin,Guard,SuperAdmin}BottomNav.tsx`
- Rewrote (as re-exports): `src/components/resident/ResidentBottomNav.tsx`, `src/components/shared/ResidentBottomNav.tsx`
- Refactored: `src/routes/__root.tsx` `ShellSwitcher` — per-role shells + mobile bottom navs
- Updated: `src/styles.css` tokens (teal primary + status container values sampled from reference PDF)
- Unchanged: all business logic, RLS, migrations, payment adapters, feature-screen bodies
