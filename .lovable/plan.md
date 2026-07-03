# Phase 3 Plan — Login UX Correction + Society Setup Wizard + Hierarchy Engine

Scope: ship the Phase 2 login-flow correction and the full Phase 3 wizard in one pass. The Enterprise-Dark theme overhaul is intentionally deferred to Phase 4 (separate plan). No backend, RLS, subscription, Razorpay, Truecaller, or auth-architecture changes beyond what's required to introduce the hierarchy engine.

---

## Part A — Phase 2 Correction: Restore Login Flow

Goal: put the login screen back to its intended two-step shape. Onboarding never appears before authentication.

### A1. `/login` screen (restored)

- SocioHub Logo + Welcome copy (existing animations retained).
- Primary buttons:
  1. **Continue with Google** (unchanged; uses `lovable.auth.signInWithOAuth`).
  2. **Continue with Phone** — routes to `/login/phone`, does NOT render OTP inline.
  3. **Continue with Truecaller** (only when `capabilities.truecaller === true`).
- Remove the "phone-first, OTP inline" collapse introduced in Phase 2.

### A2. `/login/phone` (dedicated screen)

- Fields: Mobile number + Continue. OTP form renders only after Continue is pressed (existing `PhoneOtpForm` two-step mode).
- Back button returns to `/login`.

### A3. Post-auth routing (in `__root.tsx` / `AuthGuard`)

Existing authenticated users bypass everything:

```
session? → phoneVerified? → society membership?
   no          →                    → /login
   yes    no  →                    → /verify-phone
   yes    yes  no                  → /onboarding
   yes    yes  yes                 → ROLE_HOME[role]
```

Guard runs before render — no flash. `bootstrapping` flag from Phase 2 stays.

### A4. Files touched

- `src/routes/_auth/login.tsx` — restore two-tier layout.
- `src/routes/_auth/login.phone.tsx` — new dedicated phone screen.
- `src/components/auth/PhoneOtpForm.tsx` — expose "number-only step" mode.
- `src/routes/__root.tsx` — tighten redirect precedence.

No changes to auth service, Supabase, Truecaller, or session logic.

---

## Part B — Unified Hierarchy Engine (backend)

Chosen: **new `hierarchy_nodes` table + compatibility views** over `blocks`/`flats`. Existing modules keep working via views until they're migrated in later phases.

### B1. Schema (single migration)

```sql
create type public.hierarchy_kind as enum ('society','structure','floor','unit');
create type public.society_layout as enum ('structured','serial');

create table public.hierarchy_nodes (
  id uuid primary key default gen_random_uuid(),
  society_id uuid not null references public.societies(id) on delete cascade,
  parent_id uuid references public.hierarchy_nodes(id) on delete cascade,
  kind hierarchy_kind not null,
  name text not null,
  code text,               -- e.g. "A", "101"
  sort_order int not null default 0,
  meta jsonb not null default '{}'::jsonb,   -- floors_count, units_per_floor, numbering_pattern, etc.
  legacy_block_id uuid,    -- back-reference to blocks.id during migration
  legacy_flat_id  uuid,    -- back-reference to flats.id
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (society_id, parent_id, name),
  unique (society_id, parent_id, code)
);
-- GRANTs + RLS scoped to society membership via has_society_access(society_id).
```

Adds to `societies`:

- `layout society_layout default 'structured'`
- `structure_label text default 'Block'`  (Wing/Tower/Block/Building/Sector/Phase/Custom)

Adds to `society_settings` (reuse existing table; already has opening balances, maintenance policy, wizard_step):

- `dynamic_profile_fields jsonb default '[]'` (list of `{key,label,type,required,options}`).
- `wizard_state jsonb default '{}'` (autosave payload).
- `default_bill_template_id uuid` (nullable).

### B2. Read/write API (server functions in `src/lib/hierarchy.functions.ts`)

- `getHierarchy(societyId)` — tree.
- `saveWizardDraft(societyId, state)` — upsert `society_settings.wizard_state`.
- `commitWizard(societyId, payload)` — atomic RPC that:
  1. Writes society info + `layout` + `structure_label`.
  2. Generates all `hierarchy_nodes` in batches (up to 20 000 units).
  3. Backfills legacy `blocks` + `flats` for compat (so existing residents/maintenance/visitors reads keep working unchanged).
  4. Writes opening balances (locked), maintenance policy, dynamic fields, default bill template.
  5. Marks `society_settings.setup_completed_at`.

Everything inside one `SECURITY DEFINER` RPC → transactional, no partial states.

### B3. Compatibility views (later-phase-friendly)

- `v_blocks_from_hierarchy` and `v_flats_from_hierarchy` are shipped but existing tables remain the source of truth for now. Future phases migrate module by module.

---

## Part C — Society Setup Wizard (frontend, metadata-driven)

### C1. Wizard framework (`src/features/onboarding/wizard/`)

Reusable definition model — new steps can be inserted without touching navigation:

```ts
type WizardStep<S> = {
  id: string;
  title: string;
  progressWeight: number;
  Component: React.FC<StepProps<S>>;
  validate: (state: S) => ValidationResult;
  canSkip?: (state: S) => boolean;
};
type WizardDef<S> = { id: string; steps: WizardStep<S>[]; initial: S };
```

- `<WizardRunner def={societySetupDef}/>` handles nav, progress bar, autosave (debounced 800ms → `saveWizardDraft`), back-without-loss, inline validation, sticky bottom CTA, mobile transitions (`PageTransition`).
- Resumes from `wizard_state` on load.

### C2. Steps (society setup)

1. **Society Info** — logo, name, registration (opt), address, state, city, PIN, creator (prefilled/editable), phone (locked), email (opt).
2. **Layout Choice** — two large cards: *Structured* vs *Serial Number*.
3. **Structure Naming** (Structured only) — pick label (Wing/Tower/Block/Building/Sector/Phase/Custom) + count. Auto-generates names, each rename-able.
4. **Configure Each Structure** (Structured; one screen per structure via sub-stepper) — floors, units/floor, ground-floor toggle, numbering format (Sequential / Simple / Floor-Unit / Custom pattern with tokens `{S}`, `{F}`, `{N}`, `{FF}`, `{NN}`). Live preview grid updates on every keystroke.
5. **Total Houses** (Serial only) — single number input, live preview of first 20.
6. **Flat/House Editor** — virtualized list (react-virtual). Rename, delete, insert, reorder (drag), mark default Owner/Tenant, add note. Duplicate detection inline.
7. **Pricing** — calls `pricing-engine.getApplicablePlans({ totalUnits })`. If units > threshold → Enterprise auto. Otherwise show Trial (if eligible) + Basic/Pro/Premium/Custom. Wizard hands off to existing checkout, returns to step 8 after success.
8. **Opening Balances** — cash, bank, as-of date. Warning banner: locks on finish.
9. **Maintenance Policy** — amount, billing type (Prepaid/Current/Postpaid), due day, grace, late fee, auto-generation toggle. All become defaults, all editable later.
10. **Dynamic Profile Fields** — add/edit/remove custom resident fields (text/number/date/dropdown/checkbox/file/image). Optional step.
11. **Review & Finish** — one-tap `commitWizard`. Triggers initialization of society settings, hierarchy, opening balances, maintenance policy, default bill template, society code (already generated in Phase 2), financial year, default reports flags, default theme.

### C3. Numbering-format engine (`src/lib/hierarchy/numbering.ts`)

Pure function `generateUnits(config): Unit[]`:

- Handles all four formats + custom token expansion.
- Batched generation (chunks of 500) with `requestIdleCallback` fallback → no UI freeze for 5 000+ units.
- Duplicate & validation checks return typed errors consumed by inline UI.

### C4. Mobile UX rules applied

- One primary CTA per screen; sticky bottom.
- Animated progress bar (weighted).
- Bottom sheets (Vaul `<Drawer>`) instead of dialogs.
- Auto-scroll to first error.
- Smart defaults (Block=5, floors=4, units/floor=4, format=Sequential, due day=10, grace=5).
- Large touch targets (min 44px).

### C5. Performance

- Virtualized list for flat editor.
- Batch generation with progress toast for >1 000 units.
- Generation runs client-side; commit sends compact payload (config + edits diff), server expands via RPC.

---

## Part D — What is NOT changing this phase

- Auth architecture, Truecaller, Firebase phone, Google OAuth wiring.
- Subscriptions, Razorpay/PayU/Cashfree adapters, pricing engine DB.
- RLS on `residents`, `maintenance_periods`, `bills`, `visitors`, `expenses`, `payments`.
- Super Admin, resident-side modules (untouched surface area).
- Global theme tokens (Enterprise-Dark = Phase 4).

---

## Part E — Deliverables

**Migrations (1)**

- `hierarchy_nodes` + enums + `societies.layout` + `societies.structure_label` + `society_settings.dynamic_profile_fields`/`wizard_state`/`default_bill_template_id` + `commitWizard` RPC + `saveWizardDraft` RPC + compat views.

**New files**

- `src/features/onboarding/wizard/{WizardRunner,useWizardAutosave,types}.tsx`
- `src/features/onboarding/wizard/steps/*.tsx` (11 files)
- `src/lib/hierarchy/{numbering,validation}.ts`
- `src/lib/hierarchy.functions.ts`
- `src/routes/_auth/login.phone.tsx`

**Edited files**

- `src/routes/_auth/login.tsx` (restore two-tier)
- `src/components/auth/PhoneOtpForm.tsx` (number-only step)
- `src/routes/onboarding.create.tsx` — replaced by `<WizardRunner def={societySetupDef}/>`
- `src/routes/onboarding.plan.tsx` — merged into wizard step 7
- `src/routes/__root.tsx` — redirect precedence
- `src/lib/pricing-engine.ts` — expose `getApplicablePlans({ totalUnits })` for wizard

**Untouched**

- `_resident/*`, `_society/{maintenance,billing,accounts,visitors,reports,expenses,payouts}.tsx`
- All payment adapters, `join-approvals.ts`, `society-code.ts`, all RLS.

---

## Completion criteria

- Existing signed-in user hitting `/` goes straight to role home — no login/OTP/onboarding flash.
- New user can create a Structured society (5 blocks × 4 floors × 4 flats) OR a Serial society (150 houses) end-to-end on a 360px viewport.
- Refreshing mid-wizard resumes at the last step with all inputs intact.
- Duplicate flat numbers, empty name, zero floors surface inline before Next.
- Pricing step auto-shows Enterprise when units > threshold; otherwise Standard plans.
- On Finish: hierarchy exists, opening balances locked, maintenance policy stored, dynamic fields saved, society code visible, default bill template row present. Society dashboard opens without errors.
- No changes to `blocks`/`flats` reads in other modules — they still work via backfill.

Enterprise-Dark theme overhaul (splash, glass tiles, Quantum Ring, Bill Studio canvas, WhatsApp exporter UI, Cashless checkout redesign) will be planned separately as Phase 4 once this ships.                                                                                                                                     1. Financial Year Initialization

When the wizard finishes, automatically create:

```

```

```
Current Financial Year

Example:

2026-27

Opening balances belong to this FY.
```

Future accounting modules should immediately know which FY is active.

---

# 2. Resident Number Capacity

Every generated flat should immediately contain:

```

```

```
Maximum Residents

default = unlimited

editable later
```

This helps future visitor and occupancy features.

---

# 3. Parking Initialization

During setup, optionally ask:

```

```

```
Does your society have parking?

Yes / No
```

If Yes:

```

```

```
Parking Types

Two Wheeler

Four Wheeler

Visitor Parking

Commercial
```

Skip if No.

---

# 4. Amenities Initialization

Optional screen:

```

```

```
Amenities

Garden

Club House

Gym

Temple

Swimming Pool

Community Hall

Other
```

These become available later.

---

# 5. Water Meter / Electricity Number Support

When creating Dynamic Profile Fields,

provide quick templates.

Example:

```

```

```
Property Number

Electric Meter

Water Meter

Gas Connection

Parking Slot

Vehicle Number
```

instead of forcing admins to create everything manually.

---

# 6. Undo Before Finish

Before clicking Finish,

allow

```

```

```
Preview

↓

Edit

↓

Finish
```

instead of immediately committing.

---

# 7. Duplicate Detection

Besides duplicate flat numbers,

also detect

```

```

```
Duplicate structure names

Duplicate custom numbering patterns

Duplicate generated IDs
```

---

# 8. Migration Safety

Since hierarchy is changing,

ask Lovable to guarantee:

```

```

```
Existing societies

↓

Auto migrate

↓

Nothing breaks

↓

No data loss

↓

Rollback available
```

---

# 9. Wizard Versioning

Very important.

Save

```

```

```
wizard_version = 1
```

inside society settings.

Later, if setup changes,

the app knows which wizard version created the society.

---

# 10. Initialization Queue

Instead of doing everything synchronously,

after Finish:

```

```

```
Commit

↓

Background Initialization

↓

Generate Flats

↓

Generate Reports

↓

Default Bill Template

↓

Financial Year

↓

Complete
```

Show a progress indicator.

This prevents freezes on societies with thousands of units.

---

# 11. Enterprise Support

You've already added Enterprise pricing.

Also add:

```

```

```
If Total Units > Enterprise Threshold

↓

Recommend contacting Sales

↓

Still allow demo setup

↓

Lock activation until subscription.
```

---

# 12. Recovery

If initialization fails at 90%,

the admin should never lose progress.

Resume from the failed step automatically.

---

# My only concern

One thing I'd watch is this line:

> **Pricing — calls pricing-engine.getApplicablePlans() inside the wizard.**

I would slightly change the flow.

Instead of:

```

```

```
Setup

↓

Pricing

↓

Continue
```

I'd recommend:

```

```

```
Society Info

↓

Structure

↓

Wizard

↓

Review

↓

Pricing

↓

Payment

↓

Initialize Society

↓

Dashboard
```

This way, the admin configures the society first, then chooses the plan based on the final number of units. It avoids situations where they change the structure after seeing the price and have to go back.