---
name: sociyohub-testing-e2e
description: Use when SociyoHub work needs new or updated unit, integration or browser tests — including role-based workflows, cross-society negative paths, uploads, payments, and Firebase session flows. Do not use for release approval (route to sociyohub-release-readiness) or for planning-only tasks with no code changes.
---

# SociyoHub Testing (End-to-End)

Tests describe SociyoHub behaviour a resident, society admin, guard or super admin actually experiences. They run against synthetic fixtures and never touch the protected society.

## Focused Vitest tests

Unit tests target pure logic:

- Schemas and validators.
- Formatters (currency, phone, date).
- State transition functions (bill status, payment status).
- Plan normalisation and entitlement helpers.
- Small hook behaviours around known inputs.

Rules:

- One behaviour per test; descriptive names.
- No hidden global state between tests.
- Freeze time explicitly when asserting expiry or scheduling.
- Mock only true boundaries (network, crypto RNG, environment).

## Integration tests (server + database)

Integration tests exercise server functions against a real PostgreSQL instance seeded with synthetic societies and users:

- Cover allow and deny paths for RLS.
- Cover plan-gated allow and deny.
- Cover input validation edge cases (empty, oversized, malformed).
- Cover idempotency where the endpoint can retry.

Every integration test asserts that the protected society is not queried, not seeded, not mutated. Use fixture society IDs distinct from [REDACTED-PROTECTED-SOCIETY-ID].

## Testing Library — user behaviour

For UI tests:

- Query by role and accessible name first.
- Interact via `userEvent`.
- Assert on visible text, roles, focus, disabled state, and announced status.
- Avoid snapshot tests that pin exact DOM strings.

Do not assert on internal hook call counts or React component identity.

## Playwright — role-based browser tests

Browser tests cover realistic role workflows:

- **Resident**: sign in with a synthetic Firebase session, view bills, view notices, submit a support ticket, view AI answer with citations.
- **Society admin**: sign in, approve a join request, record offline income, view No-Dues status, export a report.
- **Guard**: sign in, log a visitor, close a visit.
- **Super admin**: sign in, review pending withdrawals, view revenue.

Each test:

- Runs against the local preview.
- Sets a viewport (mobile for resident/guard, desktop for admin/super admin).
- Waits on real state (URL, visible role, network response), not `sleep`.
- Captures screenshot evidence only when actually taken.

## Responsive browser checks

Key screens are exercised at 360, 390, 414, 768, 1280:

- No overflow.
- No hidden primary CTAs.
- No overlapping absolute-positioned nav.

## Firebase session tests

Firebase-authenticated flows are tested with a session-restore strategy:

- Use the sandbox's managed Supabase session injection where available.
- Otherwise, mint synthetic session data through the trusted server route in a test-only mode.
- Never embed real user tokens in test files.

## Cross-society negative workflows

For every table with per-society data, at least one negative test:

- User of society A cannot list, read, update or delete rows of society B via the server function.
- User of society A cannot read another society's plan tier via any exposed endpoint.
- Guard of society A cannot access society B's visitor logs.

These tests are as important as happy-path coverage.

## Upload workflows

Upload tests verify:

- Accepted formats and size limits at the boundary.
- Rejected uploads (wrong MIME, oversized, empty) return a clean error.
- Uploaded assets are scoped to the correct society path.
- The uploaded content is not executed anywhere in the pipeline.

## Payment transition workflows

Payment tests cover:

- SaaS subscription activation with a valid Razorpay signature.
- Signature-invalid webhook rejected without state change.
- Duplicate webhook does not double-credit.
- Out-of-order webhook resolves to the correct terminal state.
- Offline income record allow/deny under plan gating.

No test uses real Razorpay credentials or live keys.

## No brittle source-string tests

- Do not assert exact HTML class names, generated IDs, or CSS-in-JS strings.
- Do not assert exact SQL. Assert on effects.
- Do not test third-party library internals.

## Screenshot evidence only when captured

Only claim screenshot evidence when a screenshot was actually saved in this attempt. Never invent filenames or paths. Store under `/tmp/browser/**` per environment guidance and do not commit them.

## Test hygiene

- Deterministic seeds for anything random.
- Fake timers when time matters.
- Reset all mocks between tests.
- Fixtures created and torn down per test where affordable; per-suite where necessary and documented.
- No shared mutable global state.

## Reporting

At the end of a test-adding turn:

- Report new test names.
- Report which category (unit, integration, browser).
- Report exit codes.
- Hand off to `sociyohub-verification-gate` for closure.
