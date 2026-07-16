---
name: sociyohub-risk-based-tdd
description: Use when SociyoHub work touches risky behaviour — money, permissions, RLS, plan entitlements, state transitions, validation, or historically fragile logic — to drive change through RED/GREEN/REFACTOR with behaviour-focused tests. Do not use for pure copy, spacing, colour tokens, or one-off documentation edits where no behavioural regression is possible.
---

# SociyoHub Risk-Based TDD

Test-first is a tool, not a religion. Apply it where SociyoHub cannot tolerate silent regressions. Skip it where cost outweighs risk.

## What counts as risky in SociyoHub

Always test-first when the change affects any of:

- **Money** — bills, ledgers, offline income, No-Dues cryptography, Razorpay subscription state, refunds, adjustments.
- **Permissions** — RLS policies, `SECURITY DEFINER` functions, admin routes, guard/resident/admin/super-admin gates.
- **Plan entitlements** — `normalizePlan`, plan-features helper, feature gates, trial validity.
- **State transitions** — bill status, payment status, income record status, onboarding state, invite claim state.
- **Validation** — Zod schemas at server-function boundaries, webhook payload parsers, ID and phone normalisation.
- **Known-fragile areas** — Flat 360 AI DTOs, No-Dues token verification, Firebase→Supabase exchange.

## What does not require test-first

- Copy tweaks, colour tokens, spacing, typography.
- Static documentation.
- Purely additive UI text, empty-state copy.
- Icon swaps.
- Log message wording (as long as no PII leak is introduced).

For these, sanity-render and static checks are enough.

## RED

Write a failing test that expresses the behaviour, not the implementation:

- Name the test by observable behaviour: `"blocks income transition when society plan lacks non_member_income entitlement"`, not `"calls has_role once"`.
- Assert on outputs, thrown errors, PostgreSQL errors codes seen through the API, or DOM state a real user perceives.
- Use synthetic fixtures. Never seed or reference the protected society.
- Run the test and confirm it fails for the right reason. A test that fails at import is not RED.

## GREEN

Write the minimum code to pass the failing test:

- Do not add unrelated features.
- Do not pre-generalise for hypothetical future needs.
- Do not weaken the test to make it pass.
- Prefer the smallest possible change to the smallest number of files.

Re-run the test suite scope; confirm the new test passes and no prior test regressed.

## REFACTOR

With tests green, improve structure without changing behaviour:

- Extract clearly-named helpers.
- Delete dead branches uncovered by the fix.
- Tighten types (`unknown` → validated Zod parse).
- Move server-only imports out of client-imported files.

Re-run tests after each refactor step. Refactor stops when the next step would need a new test.

## Test the behaviour, not implementation

Bad tests couple to internals and rot on every refactor:

- Do not assert that a specific hook was called N times.
- Do not snapshot deep component trees.
- Do not assert exact SQL string or query-key literals.

Good tests describe user- or contract-visible behaviour:

- HTTP status and body shape.
- Rows visible to role A but not to role B.
- Rendered error message the user sees.
- Idempotency: second identical webhook does not double-credit.

## Vitest patterns

- One behaviour per `test` block; descriptive names in plain English.
- `describe` blocks group by feature or contract, not by file.
- Mock only true boundaries (network, time, crypto RNG). Do not mock the code under test.
- Freeze time with Vitest fake timers when asserting expiry or scheduling.
- Reset all mocks between tests; enforce isolation.

## Testing Library patterns

- Query by role and accessible name first: `getByRole('button', { name: /pay bill/i })`.
- Use `findBy*` for async UI; never `waitFor` around a synchronous query.
- Prefer `userEvent` over `fireEvent`.
- Assert on what a user perceives: text, roles, disabled state, focus, announced status.
- Avoid `data-testid` unless there is no accessible query.

## Integration and RLS tests

For any RLS or `SECURITY DEFINER` change:

- Test at least: anonymous, authenticated user of society A, authenticated user of society B, society admin of A, super admin.
- Assert both allow and deny paths.
- Test that column-level minimisation holds (no leak of `plan_id`, `plan_status`, phone, email, address where not intended).

## When TDD conflicts with speed

If the risk is real and the test is expensive to write, the test still wins. If the risk is trivial and the test is expensive, skip the test and record the reason in the turn notes. Do not skip tests for money, permissions or state transitions.
