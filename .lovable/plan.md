# Pass 1 — Global SocioHub UI System & Role-Based Shell

Scope is **strictly** the global shell, navigation, and design tokens. No feature screens are rebuilt in this pass. No DB, RLS, auth, payment, billing, maintenance, or accounts logic is changed.

---

## 1. Route & role audit (deliverable: audit doc, no code)

I'll produce `.lovable/ui-audit.md` mapping every route under `src/routes/` to:

- Owner role — Resident / Society Admin / Guard / Super Admin / Public / Onboarding
- Current shell (from `__root.tsx` `ShellSwitcher`)
- Duplicate/dead status (e.g. two `ResidentBottomNav` components exist today: `src/components/resident/ResidentBottomNav.tsx` and `src/components/shared/ResidentBottomNav.tsx`)
- Target nav slot per your spec

Known collisions I already see and will flag:

- Two Resident bottom navs coexist (shared/ vs resident/). The `_resident` layout renders one; the shared one is currently unused but exists — will be removed from the codebase after confirming no imports.
- Society shell uses `SocietyDrawer` + `SocietyFab` + desktop `AppSidebar`. On mobile it has no bottom nav — spec wants: Dashboard, Billing, Residents, Operations, More.
- No Guard shell exists; guard routes (`app.guard.tsx`) currently ride the Resident shell. Needs its own shell + 3-tab bottom nav.
- No Super Admin bottom nav on mobile; `_admin` uses `AdminSidebar` only. Needs mobile bottom nav: Overview, Societies, Users, Reports, More.

## 2. Design tokens extracted from the reference PDF

I'll parse `user-uploads://sociohub_App_Ui.pdf` (pdfplumber + image sampling of the hero/primary CTAs, chips, backgrounds) and rewrite the token block in `src/styles.css` under `@theme inline` + `:root` so tokens flow through shadcn. Existing token names are preserved; only values change.

Expected extraction targets (values TBD from PDF sampling — will be reported back before finalization):

- `--primary` (SocioHub teal-green)
- `--primary-foreground`
- `--background` (soft app background)
- `--card` / `--card-foreground`
- `--foreground` (navy)
- `--muted` / `--muted-foreground`
- `--border` / `--input`
- `--ring`
- Status chips: `--success`, `--warning`, `--destructive`, `--info` + their `-foreground` and soft/tinted variants used by chips
- `--radius` (rounded card scale)
- `--shadow-card` (soft elevation)

A short **Token Report** is delivered at end of pass listing before/after hex for each token above. If the theme-neon opt-in class exists in `ThemeApplier`, it is left untouched.

Fonts: only add a `<link>` in `__root.tsx` head if the reference clearly uses a specific family; otherwise keep the current stack (no speculative font swap in this pass).

## 3. Role-based shells (replace `ShellSwitcher` branches)

`src/routes/__root.tsx` — `ProtectedShell` is refactored so each role gets a dedicated shell component, all mobile-first, all wrapped in a 480px-max mobile frame on small screens and a proper responsive layout at md+:

```text
/app/*         → ResidentShell     (bottom nav: Home, Bills, Visitors, Society, Profile)
/society/*     → SocietyAdminShell (bottom nav on mobile: Dashboard, Billing, Residents, Operations, More
                                    sidebar preserved on md+)
/app/guard/*   → GuardShell        (bottom nav: Dashboard, History, Settings)   [see routing note below]
/admin/*       → SuperAdminShell   (bottom nav on mobile: Overview, Societies, Users, Reports, More
                                    sidebar preserved on md+)
/onboarding/*  → OnboardingShell   (no bottom nav; back button top bar)
```

Guard routing note: today `app.guard.tsx` lives under `_resident`. I will NOT move the route file in this pass (would risk breaking guard access). Instead the shell switcher will branch on `pathname.startsWith("/app/guard")` (and any known guard subpaths) and render `GuardShell` instead of the resident shell. A follow-up pass can migrate to a proper `_guard` layout.

## 4. Unified top bar

Single `AppTopBar` component with slots:

- Leading: back button (auto-shown on detail routes: pattern `pathname.split("/").length > 3` or explicit prop)
- Logo (home routes only) OR page title
- Trailing: search icon → `/app/search` etc. per role, notifications bell w/ unread badge, avatar
- Sticky, `bg-background/95 backdrop-blur`, safe-area top padding

`AppHeader` is refactored to delegate to `AppTopBar`; per-role wrappers pass the correct trailing actions. `SocietyDrawer` mobile trigger is removed once the Society bottom nav lands (drawer contents move to the "More" tab).

## 5. Bottom nav components

Four dedicated components under `src/components/nav/`:

- `ResidentBottomNav.tsx` — replaces both existing copies; icons per spec, unread badge on "Society" (notices) hook stays via `useUnreadNotifications`.
- `SocietyAdminBottomNav.tsx` — new.
- `GuardBottomNav.tsx` — new.
- `SuperAdminBottomNav.tsx` — new.

Each: `fixed bottom-0`, safe-area padding, 5-column grid (3 for guard), min 56px touch target, active state uses `text-primary` + soft tinted pill, both text + color for chips throughout.

Main content padding-bottom becomes `calc(72px + env(safe-area-inset-bottom))` in every shell that renders a bottom nav so no content is hidden behind it.

## 6. Duplicate / dead cleanup (UI-only)

- Delete `src/components/shared/ResidentBottomNav.tsx` after confirming zero imports.
- Delete `src/components/resident/ResidentBottomNav.tsx` after the new `nav/ResidentBottomNav.tsx` is wired.
- Remove `SocietyDrawer` mobile trigger from `AppHeader` (component file kept for now — desktop still may use it; will be re-evaluated in society pass).
- Redirect known duplicate routes to unified centers only if the target already exists. Concretely I will NOT add redirects blindly — instead the audit doc lists proposed redirects; nothing is redirected in this pass unless it's a strict duplicate with zero unique content (e.g. `/app/notices` → `/app/comm` if `comm` already covers notices; will verify per-file before touching).
- No route files deleted in this pass. Dead-looking routes are listed in the audit for a later pass.

## 7. Nothing to add in this pass (explicit non-goals)

- No new feature screens.
- No placeholder routes created — if a bottom-nav tab points at a missing route, the audit doc flags it and the tab links to the closest existing route; a real screen is built in the follow-up role pass.
- No changes to `src/integrations/supabase/*`, RLS, migrations, payment adapters, billing, maintenance, accounts, or resident onboarding logic.
- No dark-mode overhaul beyond token value updates.
- No copy changes.

## 8. Verification checklist (run before closing pass)

- `tsgo` clean; `bun run build` clean; no new console errors on `/`, `/login`, `/app/dashboard`, `/society/dashboard`, `/admin/dashboard`, `/app/guard`.
- Playwright at 360 / 390 / 414 / 768 / 1024 for one representative route per role: no horizontal overflow, bottom nav visible, top bar sticky, safe-area respected.
- `ProtectedRoute` still gates each shell; resident URL → no admin nav, admin URL → no resident nav, guard → 3-tab only.
- Token Report attached to the reply.

---

## Deliverables at end of pass

1. `.lovable/ui-audit.md` — full route × role × shell × duplicate matrix
2. Updated `src/styles.css` tokens (values from PDF sampling)
3. New `src/components/nav/{Resident,SocietyAdmin,Guard,SuperAdmin}BottomNav.tsx`
4. Refactored `src/routes/__root.tsx` `ShellSwitcher` + per-role shell components
5. New `AppTopBar` + refactored `AppHeader`
6. Two deleted duplicate `ResidentBottomNav` files
7. **Token Report** in the closing message (before/after hex for each token listed in §2)

Follow-up passes (not in this plan): Society Admin screens → Resident screens → Guard screens → Super Admin screens → remaining/optional.                                                                                                                                                                                                                                              Approved — execute Pass 1: Global SocioHub UI System & Role-Based Shell.

But apply these corrections before starting:

1. Use the attached SocioHub reference images/PDF as the exact visual source of truth.

   Do not approximate the theme. Extract exact teal/green/navy/status colors from the references and update tokens accordingly.

2. Do not physically delete duplicate navigation files unless:

   - imports are confirmed to be zero, OR

   - the old file is replaced with a compatibility re-export to the new component.

   I do not want broken imports caused by deleting components too early.

3. No destructive changes.

   Do not delete routes, database tables, columns, records, migrations, RLS policies, payment logic, billing logic, maintenance logic, or auth logic.

4. For duplicate/dead routes:

   - Do not delete them in this pass.

   - Do not blindly redirect them.

   - Document them in `.lovable/ui-audit.md`.

   - Only redirect a route if it is confirmed to be a strict duplicate and the target route already exists and works.

5. For the 480px mobile shell:

   - On real mobile widths, the app should use the full viewport naturally.

   - Do not make it look like a phone mockup inside the phone.

   - Use max-width only for large desktop preview containers where appropriate.

6. Guard routes:

   Keep the current route location for now.

   Shell switching based on `/app/guard` is acceptable for this pass.

   Do not migrate guard routes yet.

7. Role-based navigation must be strict:

   - Resident must not see admin nav.

   - Society Admin must not see resident nav.

   - Guard must only see guard nav.

   - Super Admin must only see super admin nav.

8. Do not create placeholder feature screens.

   If a nav item route does not exist, link it to the closest existing working route and document the missing final screen in the audit.

9. Keep this pass limited to:

   - tokens

   - global shell

   - top bar

   - role-based bottom nav

   - safe-area spacing

   - route audit

   - duplicate nav cleanup

   - mobile responsiveness

10. Do not start rebuilding Society Admin, Resident, Guard, or Super Admin feature screens in this pass.

11. Final deliverables must include:

   - `.lovable/ui-audit.md`

   - token report with before/after hex values

   - list of files changed

   - confirmation that build/typecheck pass

   - confirmation that no auth/RLS/payment/billing/maintenance/accounting logic was touched

Proceed with Pass 1.