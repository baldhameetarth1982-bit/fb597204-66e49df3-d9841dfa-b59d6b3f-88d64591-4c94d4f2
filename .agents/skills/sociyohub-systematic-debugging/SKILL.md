---
name: sociyohub-systematic-debugging
description: Use when a SociyoHub bug, regression, failing test, incorrect UI, wrong RLS behaviour or unexpected payment/plan outcome must be diagnosed. Do not use for new-feature planning (use sociyohub-agent-intelligence), for release approval (use sociyohub-release-readiness), or when the fix is a one-line copy/typo change with no behavioural risk.
---

# SociyoHub Systematic Debugging

A disciplined loop for finding the earliest incorrect state in SociyoHub before writing any fix. No random patching. No stacking fixes on top of unverified hypotheses.

## 1. Reproduce first

Before proposing a cause:

- Write the exact reproduction steps: route, role (resident, society admin, super admin, guard), plan tier, society context, input values.
- Confirm the bug is reproducible against synthetic fixtures. Never reproduce against the protected society protected society (`1907a918-c4b8-4f43-a837-450530cc7c34`).
- Capture the observable failure: error message, HTTP status, PostgreSQL error code, UI state, network payload, console log.
- If it cannot be reproduced, that is the finding — say so and stop.

## 2. Read the complete error

Do not truncate. Capture:

- Full error message, error class, PostgreSQL `code` and `hint` (never leak to the client, but read internally).
- Full stack trace on server; only the origin frame in client logs if PII risk exists.
- Related network requests, request IDs, and timestamps.
- Console warnings that immediately precede the failure.

An unread trailing line is often the actual cause.

## 3. Inspect recent changes

- `git log` the affected files for recent commits.
- Read the latest migration touching involved tables, RLS policies or `SECURITY DEFINER` functions.
- Check `docs/DEVELOPMENT_HISTORY.md` for recent turns in the same area.

Correlate the bug's first appearance with a specific change when possible.

## 4. Find the earliest incorrect state

Trace forward from user action to failure and locate the first place where a value, permission, plan flag or state is wrong. Prefer identifying the earliest incorrect state over the loudest symptom.

Boundaries to inspect in order:

1. **Frontend** — form validation, TanStack Query cache state, route params, plan gating.
2. **Server function / route** — input schema, auth middleware, plan check, business rule.
3. **Database** — RLS policy evaluation, `SECURITY DEFINER` function `search_path`, grants, unique constraints, triggers.
4. **External** — Firebase token, Razorpay webhook, storage.

A bug that looks like a UI issue is often a plan gate, RLS, or query-key issue upstream.

## 5. One hypothesis at a time

Formulate a single hypothesis about the cause. Design one minimal experiment to confirm or reject it. The experiment must:

- Change nothing user-visible in production.
- Not touch the protected society.
- Be reversible.
- Produce a clear signal.

If the experiment neither confirms nor rejects, the hypothesis is untestable — refine it.

## 6. Minimal experiments

Prefer, in order:

- Read-only SQL against synthetic data.
- Local unit test that isolates the suspected function.
- Targeted `console.log` or server-side log line, added and later removed.
- Playwright reproduction against local preview.

Never bulk-mutate production data to "see what happens".

## 7. Regression protection

Once the earliest incorrect state is found:

- Add or update a test that fails without the fix and passes with it.
- Prefer a test at the boundary where the incorrect state originates, not where it eventually surfaces.
- Record the test name in the fix commit or turn notes.

## 8. Architecture stop after three failed fixes

If three separate patches have failed to fix the same reported bug:

- Stop patching.
- Escalate to `sociyohub-agent-intelligence` and, when relevant, `sociyohub-feature-architecture` or `sociyohub-security-guardian`.
- Consider that the abstraction, RLS model, plan state machine, payment state machine or query-key layout may be wrong, not the specific code line.

Repeated failure is a design signal.

## 9. No random patch stacking

Do not:

- Wrap failing code in `try/catch` to silence it.
- Add optional chaining until the error disappears.
- Loosen a Zod schema, RLS policy or plan check to make a test pass.
- Add sleeps, retries or `refetchInterval` to hide a race.

Each of these hides the earliest incorrect state and creates worse bugs later.

## 10. Report to the user

When done, report:

- Reproduction (role, plan, route, inputs).
- Earliest incorrect state (file, line, RLS policy or function).
- Fix summary.
- Test that now guards it.
- Any related suspected areas not yet addressed.

Hand off to `sociyohub-verification-gate` before claiming the bug fixed.
