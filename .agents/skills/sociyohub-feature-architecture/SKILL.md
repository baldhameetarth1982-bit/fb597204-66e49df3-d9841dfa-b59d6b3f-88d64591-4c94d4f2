---
name: sociyohub-feature-architecture
description: Use when adding a new SociyoHub feature or gradually restructuring an existing one so that UI, schema, server functions, hooks, types and tests live in predictable, feature-scoped locations with clear public interfaces. Do not use for framework swaps, full-repository rewrites, or purely cosmetic UI changes.
---

# SociyoHub Feature Architecture

Grow SociyoHub feature-by-feature. Keep server rules out of UI. Keep cross-feature imports shallow. Never force a big-bang restructure.

## Feature-based structure

A SociyoHub feature owns:

- Its route files under `src/routes/**`.
- Its UI components under `src/features/<feature>/**` or, when reused across features, under `src/components/**`.
- Its server functions in `src/lib/<feature>.functions.ts`.
- Its server-only helpers in `src/lib/<feature>.server.ts` (never imported from client-shipped modules).
- Its Zod schemas and domain types near the server functions.
- Its unit tests under `tests/unit/<feature>*.test.ts` and integration tests under `tests/integration/<feature>*.integration.test.ts`.

A new feature is complete only when every one of these locations either exists with real content or is deliberately marked N/A in the turn notes.

## Public feature interfaces

Each feature exposes a narrow public surface:

- Named exports from `src/lib/<feature>.functions.ts` for callable server functions.
- Named exports from `src/features/<feature>/index.ts` for UI entry points (screen components, hooks intended for other features).
- Everything else is internal.

Other features import only from these public entry points. Deep imports (`src/features/foo/internals/utils/helpers/x.ts`) are prohibited.

## Dependency direction

Allowed direction:

- Routes → features → shared UI/util libs → integrations.
- Features may import from `src/components/`, `src/hooks/`, `src/lib/`, `src/integrations/`.
- Features must not import from other features' internals.
- Server-only modules (`*.server.ts`, `src/integrations/supabase/client.server.ts`) must not be imported from client-shipped modules.

If two features truly need to share logic, promote the shared logic to `src/lib/` and give it a stable name.

## No empty folders

Do not scaffold placeholder directories. A `.gitkeep` is acceptable only where already established in this repository. Every new folder must ship with real code or be deleted.

## No full-repository rewrite

Restructure incrementally:

- One feature at a time.
- Move files; do not rewrite them.
- Keep public paths (routes, exports) stable during moves; use re-exports if paths must change.
- Never restructure while adding new behaviour in the same commit.

## Server business rules outside UI

UI components must not:

- Compute plan entitlement.
- Compute financial totals or fees.
- Perform authorization decisions.
- Verify tokens.

These live in server functions or server-only helpers. UI receives already-authorised, already-computed data and displays it. UI may cache and optimistically update, but the source of truth is the server.

## One canonical business rule and state machine

For any domain concept (plan tier, bill status, payment status, No-Dues state, income record status):

- One TypeScript type is canonical.
- One transition function or state chart is canonical.
- All features import from that canonical source.

Do not fork status enums per screen. Do not re-derive plan features in three places.

## TanStack Query and Router compatibility

- Query keys are structured: `[<feature>, <resource>, ...deps]`. Same input → same key.
- Server functions used in loaders are safe for SSR/prerender (no protected-user-only code in public routes; use the `_authenticated` layout when auth is required).
- Route params and search params are typed via TanStack Router's schemas.
- Do not fetch in `useEffect` for initial render — use loaders or `useSuspenseQuery` with `ensureQueryData`.

## Predictable locations for handoff

A new developer must be able to answer these by scanning names only:

- "Where is the UI for X?" → `src/routes/**` or `src/features/x/**`.
- "Where does the server enforce plan for X?" → `src/lib/x.functions.ts` or `x.server.ts`.
- "Where is the schema for X?" → `supabase/migrations/**` and the Zod schema next to the server function.
- "Where are the tests for X?" → `tests/unit/x*.test.ts`, `tests/integration/x*.integration.test.ts`.

If any of these questions requires guessing, the architecture is not yet correct.

## Gradual migration playbook

For an existing feature that violates the structure:

1. Freeze new behaviour changes for the migration turn.
2. Move files into their canonical locations.
3. Update imports.
4. Add or move tests to the canonical test path.
5. Verify with `sociyohub-verification-gate`.
6. Only then, in a subsequent turn, add new behaviour.

## What this skill does not do

- It does not choose UI patterns — that is `sociyohub-premium-ui`.
- It does not decide security policy — that is `sociyohub-security-guardian`.
- It does not test — that is `sociyohub-risk-based-tdd` and `sociyohub-testing-e2e`.
- It does not approve releases — that is `sociyohub-release-readiness`.
