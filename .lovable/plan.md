
# Phase 1 — Foundation UI, Mobile Design System & UX Cleanup

Frontend-only refactor. No changes to auth, RLS, billing, subscriptions, visitor/resident/maintenance logic, DB schema, edge functions, or server functions. Only `src/styles.css`, `src/components/**`, `src/layouts/**`, and route JSX/className usage are touched.

## 1. Design tokens (src/styles.css)

Rebuild the token layer so every component adapts to light/dark from CSS variables. No hardcoded `text-white`, `bg-black`, `bg-[#…]` anywhere in components.

Semantic tokens (both `:root` and `.dark`):
`--background`, `--surface`, `--surface-2` (sheets/dialogs), `--card`, `--overlay`,
`--primary`, `--primary-container`, `--secondary`, `--secondary-container`,
`--success`, `--warning`, `--danger`, `--info` (+ `-foreground` and `-container` for each),
`--outline`, `--border`, `--divider`,
`--text-primary`, `--text-secondary`, `--text-disabled`,
`--ring`, `--focus`,
elevation: `--elevation-1..4` (soft shadows, no backdrop blur — perf rule already set),
motion: `--ease-standard`, `--ease-emphasized`, `--dur-fast/base/slow`,
radii: keep 12px base, add `--radius-pill`,
spacing scale documented (4/8/12/16/20/24/32).

Typography scale via `@utility`: `.type-display`, `.type-headline`, `.type-title`, `.type-body`, `.type-caption`, `.type-button`. All map to Inter with defined weights/sizes/line-heights.

Charts, badges, chips, tables consume the new tokens (chart palette already in place — remap to semantic).

## 2. Core primitives (shadcn wrappers, single source of truth)

Under `src/components/ui/` (extend existing) and `src/components/system/` (new umbrella):

- `Button` — variants: primary, secondary, outlined, danger, text, fab; sizes sm/md/lg/icon; built-in `loading` prop with spinner swap; 48dp min height on md; ripple via CSS `:active` scale + opacity.
- `IconButton` — 48dp target with 24dp icon, accessible label required.
- `TextField`, `Select`, `DatePicker`, `OTPInput`, `Checkbox`, `Radio`, `Switch`, `SearchField`, `Autocomplete` — unified label/helper/error slots, live validation, focus/disabled/loading/error/success states, 44–48dp height.
- `Card` — one component, `padding` and `elevation` props, consistent radius.
- `Sheet` (bottom sheet), `Dialog`, `ConfirmDialog`, `AlertDialog` — replace any `window.confirm/alert` in codebase.
- `Chip`, `Badge`, `StatusChip` (success/warning/danger/info/neutral).
- `EmptyState` — illustration/icon + title + description + primary action.
- `ErrorState` — explanation + retry + optional support link.
- `ListRow` — leading/title/subtitle/trailing, 56dp min height, ripple.
- `SectionHeader`, `Divider`, `Skeleton` presets (row, card, avatar, chart).
- `PageTransition` — fade+slide wrapper for route content.

## 3. Toast system rebuild

Replace the current sonner styling with a fully token-driven variant that fixes the misaligned close button.

- Grid layout: `[icon] [message 1fr] [close]` with `items-center`, `gap-3`, `min-h-14`.
- Icon slot 24dp, close slot 32dp centered, message wraps without clipping.
- Variants: success, error, warning, info, loading (spinner in icon slot).
- Uses `--success/--danger/…` with `-container` for background and `-foreground` for text.
- Configure globally in `src/components/ui/sonner.tsx` via `toastOptions.classNames` (only presentation).
- Codebase-wide sweep: keep `toast()` call sites, do not change payloads.

## 4. Loading experience

- `SocioHubLoader` — logo + subtle pulse/fade (SVG or existing `sociohub-logo`), lightweight (no heavy filters).
- `SuspenseScreen` — full-screen loader shown for route-level suspense; `pendingComponent` set at router level via existing route defs (no logic change, just wire `pendingComponent`/`defaultPendingComponent`).
- `SkeletonScreen` — matches page layouts (dashboard, lists, forms) for query-driven states; no blank flashes.
- Fade-in on content mount, no white flash: root sets `background` on `<html>` and shows loader on initial paint.

## 5. Layout / shells (mobile-first, safe area)

- `ResidentLayout`, `SocietyLayout`, `AdminLayout`, `AuthLayout` refactored to:
  - `min-h-dvh`, `pt-[env(safe-area-inset-top)]`, `pb-[calc(4rem+env(safe-area-inset-bottom))]` when bottom nav present, gesture-safe FAB offset.
  - Sticky `AppBar` (56dp) with title/back/actions; `MobileTopBar` becomes the canonical top bar.
  - `ResidentBottomNav` and `SocietyBottomNav` — 64dp height, 48dp targets, active pill uses `--primary-container`.
  - Desktop: same components, upscaled max-width containers (`max-w-[420px]` mobile shell → `max-w-6xl` desktop content), never desktop-first.
- No button ever touches the edge — enforced via layout padding rather than per-page fixes.

## 6. Global sweep across routes

For every file under `src/routes/**` and `src/components/**` (mechanical, no logic touched):

- Replace raw shadcn button/card/input usage where it diverges from system primitives; keep imports where already aligned.
- Remove hardcoded color classes (`text-white`, `bg-black`, `bg-[#…]`, `text-gray-*`, `bg-slate-*`) → semantic tokens.
- Normalize spacing to the scale (4/8/12/16/20/24/32).
- Add `EmptyState` / `ErrorState` where blank/plain error strings exist.
- Add `Skeleton` placeholders for query-loading branches.
- Ensure every list uses `ListRow`; every dialog uses `Dialog`/`ConfirmDialog`.
- Search inputs → `SearchField` (instant search stays; only visuals change).
- Add `PageTransition` at each route's root wrapper.

## 7. Accessibility & touch

- 48dp minimum on all interactive elements (already partly enforced in `@layer base`; extend to `IconButton`).
- Visible focus ring on all inputs/buttons via `:focus-visible` token.
- `aria-label` on every icon-only control.
- Respect existing `.a11y` mode; ensure new components scale.

## 8. Responsive verification

Manual (Playwright) verification at 360/375/390/412/414/768/1024 across:
Auth (login, OTP), Onboarding, Resident dashboard/bills/feed/services/profile, Society dashboard/residents/maintenance/payouts/business-profile, Admin dashboard, Legal pages, Checkout, Pricing. Screenshot each, fix overflow/clipping/overlap issues found.

## 9. Explicit non-goals

Untouched files (business logic):
- `src/lib/*.functions.ts`, `*.server.ts`
- `src/routes/api/**`
- `src/integrations/supabase/**`
- `supabase/migrations/**`
- `.env`, `wrangler.jsonc`, `src/server.ts`, `src/start.ts`
- Auth, RLS, plans, billing, Razorpay, maintenance, visitors, dynamic fields — logic unchanged.

## Technical notes

- Tailwind v4: extend tokens in `@theme inline`, add utilities via `@utility`, custom variants via `@custom-variant`. No `tailwind.config.js`.
- Sonner customization stays in `src/components/ui/sonner.tsx` (project uses sonner, per modern stack).
- Route-level loaders wired through `pendingComponent` on existing `createFileRoute` calls — signature only, no loader logic change.
- Framer-motion already available for `PageTransition`; keep durations ≤ 200ms.
- No new dependencies expected. If a headless date/OTP primitive is missing, use existing shadcn parts (`input-otp`, `calendar`) already in the repo.

## Deliverable batches (executed in order once approved)

1. Tokens + typography + motion in `src/styles.css`; toast rebuild.
2. System primitives (`Button`, `Card`, `ListRow`, `EmptyState`, `ErrorState`, `Dialog/Sheet`, `SearchField`, form fields).
3. `SocioHubLoader` + route `pendingComponent` wiring + `PageTransition`.
4. Layout shells (Resident/Society/Admin/Auth) with safe-area + bottom nav polish.
5. Route-by-route sweep: hardcoded colors, spacing, skeletons, empty/error states.
6. Responsive audit + fixes across the viewport matrix.

## Open question before I start

Do you want me to touch **every route** in one pass (batch 5 will be large and take multiple turns), or ship batches 1–4 first as the reusable foundation and then sweep routes incrementally on later turns? Either way, no business logic changes.
