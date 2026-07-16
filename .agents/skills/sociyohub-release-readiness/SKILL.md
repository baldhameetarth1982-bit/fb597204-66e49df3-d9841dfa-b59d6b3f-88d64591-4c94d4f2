---
name: sociyohub-release-readiness
description: Use when a SociyoHub stage, milestone, or public deployment is being considered for approval and must be gated behind a full evidence matrix covering security, RLS, tests, secrets, dependencies, build, performance, accessibility, responsive coverage and recoverability. Do not use for in-progress feature work, individual bug fixes, or documentation-only changes.
---

# SociyoHub Release Readiness

A SociyoHub release is not approved on vibes. It is approved when every required check produced fresh evidence in the current attempt, and every skipped check has a documented reason.

## Requirements matrix

Before approval, produce a matrix listing:

- Each requirement (security, tests, secrets, dependencies, build, performance, a11y, responsive, backup).
- The check that validates it.
- The command run and its exit code.
- The location of the full log.
- The outcome: pass, fail, or skipped with reason.

A missing row means the release is not ready.

## Role-based end-to-end

Playwright must exercise, against local preview, the primary workflows for:

- Resident.
- Society admin.
- Guard.
- Super admin.

For each: sign-in, primary happy path, one representative negative path (cross-society denial or plan-gated denial). Screenshots captured where meaningful.

## Security

- `sociyohub-security-guardian` has been consulted for any security-touching change since the last release.
- OWASP-style checklist for the changed surfaces has been completed.
- No new endpoint is exposed under `/api/public/**` without signature verification or documented public-read justification.

## RLS

- Every table changed or created since the last release has RLS enabled.
- Every such table has per-command policies and matching GRANTs.
- Direct PostgreSQL role tests demonstrate cross-society isolation.
- `SECURITY DEFINER` functions have explicit `search_path` and minimal EXECUTE grants.

## PostgreSQL role tests

Executed under distinct roles for at least:

- `anon`.
- `authenticated` as user in society A.
- `authenticated` as user in society B.
- Society admin of A.
- Super admin.

For each: read and write attempts against representative tables. Results recorded.

## Secret scan

- `scripts/verify-client-bundle-secrets.ts` (or the current equivalent) exits 0 against the freshly built client bundle.
- No `.agents/**`, `docs/**`, or research repository content appears in `dist/client`.
- No Firebase Admin, Supabase service role, Razorpay secret, or webhook signing key appears in any browser-shipped file.

## Dependency audit

- Lockfile audited for known vulnerabilities against the current advisory database.
- Any high-severity finding is either fixed, upgraded, or documented with a rationale for deferral.
- No new dependency was added without a recorded reason.

## Build

- Production build (`bun run build` or the current equivalent) exits 0.
- No warnings related to server-only code leaking into the client.
- No route reports duplicated `/` paths.
- Head metadata is real and app-specific — not the template defaults.

## Bundle and performance

- Bundle size delta since the last release is recorded.
- Per-route chunk sizes are sane; no unexpected multi-megabyte chunks.
- Lighthouse or Web Vitals numbers, if reported, were actually measured in this attempt against a production build.

## Accessibility

- Key screens pass keyboard traversal without traps.
- Focus indicators are visible in light and dark themes.
- Forms have labels; images have alt text; icon-only buttons have accessible names.
- Contrast passes WCAG AA on primary text, interactive controls, and status colours.
- Reduced-motion preference is honoured.

## Responsive inspection

Every changed screen has been inspected at 360, 390, 414, 768, and 1280:

- No overflow.
- No hidden primary CTAs.
- No overlapping nav or FAB.

Evidence: screenshot names or a written summary from the reviewer, only when the check was actually performed.

## Backup and recovery

- Latest migration is reversible or has a documented forward-only rationale.
- Database backup schedule is confirmed (through Supabase-side settings visible to the operator; not asserted from the code).
- Restore procedure is documented in `docs/RELEASE_READINESS.md` (or the current equivalent) and reviewed.

## Blocker report

If any check fails or is skipped without a valid reason:

- Name the check.
- Describe the failure and the smallest reproducible signal.
- Propose an owner and next step.
- Mark the release as not approved.

## No release approval with critical skipped evidence

A release is not approved when any of these is skipped without a valid, documented reason:

- Security-touching change without RLS role tests.
- Payment-touching change without idempotency and signature tests.
- AI-touching change without regression and citation-leak evaluation.
- Auth-touching change without Firebase→Supabase exchange verification.
- Any change that modifies migrations without a reviewed migration.

## Protected society check

Before approval, confirm in writing:

- Protected society `baldha Meetarth` (`1907a918-c4b8-4f43-a837-450530cc7c34`) was not queried, seeded, mutated, probed, or referenced as a fixture during this release cycle.
- Synthetic societies were used everywhere real data would be needed.

## Documentation

- `docs/DEVELOPMENT_HISTORY.md` updated with the release entry.
- `docs/FEATURE_COVERAGE_V2.md` reflects the shipped state.
- `docs/SOCIYOHUB_MASTER_ROADMAP_V2.md` marks the correct stage as complete.
- Any new security decision is recorded in `docs/SECURITY_REQUIREMENTS.md`.

## Handoff

When every row of the matrix is green with recorded exit codes and no critical skip, release readiness is met. Hand off to the user (or the next stage) with a compact summary — never a triumphant paragraph without exit codes.
