---
name: sociyohub-performance-engine
description: Use when SociyoHub work aims to improve or protect load time, interaction latency, bundle size, query performance, or Web Vitals with measured evidence. Do not use for correctness or security fixes, or as a justification for cutting features, tests, or accessibility.
---

# SociyoHub Performance Engine

Optimise only what is measured. Never invent numbers. Never trade correctness or security for milliseconds.

## Baseline before optimization

Before changing anything performance-relevant:

- Record a baseline for the exact scenario (route, role, viewport, network throttle).
- Include: initial load time, LCP, CLS, INP proxy (interaction latency on a real click), transferred bytes, number of blocking requests.
- Store the baseline in the turn notes.

An optimization without a baseline is a guess.

## Lighthouse and Web Vitals

- Use Lighthouse for structural audits (unused JS, render-blocking resources, image formats, cache policy).
- Use the Web Vitals library concepts for real-user-facing metrics: LCP, CLS, INP, TTFB.
- Never report a Lighthouse score you did not actually run.
- Never present development-mode numbers as production performance.

## Bundle inspection

- Inspect the production build output for chunk sizes and largest modules.
- Identify any client chunk that unexpectedly contains a server-only module (marker: presence of `*.server` module content, admin-only helper, Firebase Admin SDK code).
- Route heavy or rarely-used screens through lazy imports.
- Prefer per-route code splitting over a single monolithic vendor chunk.

Third-party research repositories, `.agents/**` skills, and `docs/**` files must never be bundled into the browser output.

## Route lazy loading

- Non-critical routes and heavy modals lazy-load via dynamic import.
- Above-the-fold content on landing and dashboard renders without waiting for lazy modules.
- Suspense fallbacks match final layout height where feasible, to avoid CLS.

## Query deduplication and stable keys

- TanStack Query keys are structured, stable, and consistent across the codebase.
- Same inputs always produce the same key; different inputs never collide.
- Reads are deduplicated by key; do not manually fetch in `useEffect` around an existing query.
- Prefer `ensureQueryData` in loaders and `useSuspenseQuery` in components for initial render.

## Appropriate stale times

Choose stale times per data type:

- Immutable reference data (categories, plan definitions once loaded): long stale time.
- Slowly-changing per-society data (member list, bill list): medium.
- Fast-changing data (unread notification count, live payment status): short, with focus-refetch enabled.

Do not set stale time to Infinity for anything a user can mutate.

## N+1 prevention

- Server functions returning lists must fetch related data in one query where possible (join, `select` with related columns, or one follow-up batched fetch).
- Watch for RLS policies that force per-row round trips because of expensive `SECURITY DEFINER` calls; profile before optimising.

## Minimum-column selection

- `select()` names only the columns the UI needs.
- Never `select('*')` in a server function returning data to residents.
- Do not return `plan_id`, `plan_status`, phone, email or internal audit columns to clients that must not see them.

## Pagination

- Any list expected to grow (bills, notices, activity, income records) uses server-side pagination with a stable order and a cursor or offset boundary.
- UI must not fetch the entire table to render a first page.

## Image and font loading

- Images have explicit width/height or aspect ratios to prevent CLS.
- Hero and above-the-fold images use `loading="eager"`; below-the-fold use `loading="lazy"`.
- Prefer modern formats (AVIF/WebP) where available; fall back gracefully.
- Fonts self-host or use `<link rel="preconnect">` and `font-display: swap`.

## Layout shift

- Reserve space for async content: skeletons match final dimensions.
- Avoid injecting banners or trust badges after first paint without reserved space.
- Absolute-positioned nav elements must not overlap first-render content.

## Skeleton correctness

Skeletons approximate the final layout, not decorate the page. A skeleton that misrepresents count or size creates worse perceived performance than a plain spinner.

## Server-only code excluded from client

- `*.server.ts` files are never imported from client-shipped modules.
- Server function `.handler()` bodies are stripped; do not put client-required code inside handlers.
- Verify chunk contents when a suspicious size appears.

## Measured after-result

After optimizing:

- Re-run the same scenario under the same conditions.
- Record the delta against baseline.
- Report both before and after; do not report only the after.

## No invented score

Never write "Lighthouse 95" or "LCP 1.2s" unless you actually observed it in this attempt. If a number was not measured, say so.

## When to stop

Stop optimising when:

- The measured metric meets the agreed target.
- Further gain requires trading correctness, accessibility, or maintainability.
- The next optimization has cost that outweighs benefit (rare-path micro-optimizations).

Route large architectural changes required for further gains through `sociyohub-feature-architecture` in a separate turn.
