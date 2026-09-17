# Stage 3D behavioral verification and hardening

## Goal

Prove the existing Stage 3D accounting behavior in an isolated synthetic environment, fix only defects demonstrated by inspection or tests, and keep Stage 3C blocked until its independent 93/0/0/0/0 gate passes.

## Confirmed starting state

- `src/lib/utils.ts` is the unchanged six-line `cn` helper; the reported line 8 diagnostic is stale and this file will not be modified.
- Stage 3D is currently `implemented_unverified`; current tests are source-contract checks, not database behavioral proof.
- Local disposable database tooling is not installed in this workspace, so runtime proof must be made reproducible in CI and executed locally only if safe tooling becomes available.
- No production or protected-society data will be read, counted, modified, seeded, or used as a fixture.

## Implementation

1. **Add a forward-only accounting hardening migration**
  - Preserve the existing Stage 3C payment lifecycle and all current payment methods.
  - Make journal replay equivalence exact, including source, action, date, amount, accounts, and reversal parent; reject conflicting replay.
  - Require reversal entries to compensate the matching original source and journal, not an arbitrary same-society journal.
  - Make expense request-id replay compare the complete canonical payload, including vendor and description.
  - Add durable, society-scoped request-id results for backfill so retries and concurrency return the original result without duplicate audit evidence.
  - Keep internal posting helpers inaccessible to normal clients, retain strict society-admin authorization, and preserve RLS/least-privilege grants.
  - Correct report semantics where current labels and calculations disagree, without introducing another balance source.
2. **Create a disposable Stage 3D behavioral suite**
  - Use synthetic societies and users only.
  - Cover account seeding; balanced posting; invalid balance/account/date/amount cases; immutable posted entries and lines; role and tenant isolation; exact replay/conflicting replay; concurrent posting/reversal/backfill; payment, income, and expense lifecycle integration; vendor isolation/archive behavior; cash/bank arithmetic and pagination; ageing boundaries and payment states; plan/visibility denial; audit failure rollback; and legacy-ledger lockdown.
  - Assert database state after failures so atomicity and absence of partial financial success are proven.
3. **Make runtime verification reproducible**
  - Add a fail-closed Stage 3D local runner modeled on the existing disposable Stage 3C runner.
  - Add a dedicated CI workflow or isolated Stage 3D job that applies the full migration chain, executes the behavioral suite without skips, records a machine-readable report bound to the commit, and always validates that the run actually occurred.
  - Keep the Stage 3C canonical workflow and acceptance gate unchanged.
4. **Harden typed adapters and affected screens only where evidence requires**
  - Remove unsafe assumptions in the Stage 3D adapter without weakening validation.
  - Ensure Accounts, Expenses, Journal/Transactions, and Reports show truthful unavailable/loading/error states and do not display failed queries as zero balances.
  - Verify reversal confirmation, INR display, keyboard access, touch targets, and overflow at 390, 768, and 1280 pixels using the local preview and synthetic/denied states available without production data.
5. **Verify and document exact evidence**
  - Run focused Stage 3D tests, unchanged Stage 3C regression/source checks, the full non-live suite, migration/security/source validators, secret scan, and repository integrity checks.
  - Use the platform build/typecheck result to verify the stale `utils.ts` diagnostic is absent.
  - Update roadmap, history, coverage, and readiness documents only with observed totals and exact blockers.
  - Keep Stage 3D as `implemented_unverified` unless fresh and upgraded disposable runtime plus visual evidence genuinely satisfy closure; keep Stage 3C `BLOCKED` without exact external 93/0/0/0/0 evidence.

## Expected files

- One new forward-only migration under `supabase/migrations/`.
- Focused Stage 3D runtime helpers/tests under `tests/`.
- A local Stage 3D runner and CI workflow/job.
- Only the affected finance adapter/screens if tests or browser evidence show defects.
- Canonical roadmap/status documents updated with measured evidence.

## Non-goals

No online society payments, Razorpay changes, UPI/cards/wallets, Smart QR, AI categorization, period close, reconciliation, exports, migration-history rewrites, legacy-ledger conversion, or later-stage work.    For the new durable backfill request-id result, enforce uniqueness at the **database level on** `(society_id, request_id)` and make the stored result immutable. An identical retry must return the original result without creating another `finance.backfill_executed` audit event; a conflicting request must fail closed.

- For journal replay equivalence, compare the **complete canonical posting identity**, including source type/id, source action, transaction date, amount, debit account, credit account, reversal parent, and any other field that materially determines the journal. Never treat a partial match as an idempotent replay.
- For reversal, verify the original journal's `source_type`, `source_id`, `source_action`, society, and reversal state against the source being reversed. Do not permit a same-society but unrelated journal to be used as the reversal parent.
- For payment/income integration, test the **actual existing Stage 3C lifecycle RPCs**, not a mocked/direct journal call. Stage 3C's authorization, occupancy, payment-method, receipt, state-transition, and error contracts must remain unchanged.
- The Stage 3D CI runner must fail if **any behavioral test is skipped, todo, setup-failed, or teardown-failed**. The expected successful accounting runtime result must therefore explicitly show zero skips and zero setup/teardown failures.
- Never make a test pass by changing the expected result to match current behavior. If behavior contradicts the accounting/security requirement, fix the implementation and retain the test proving the requirement.
- For the UI, a failed finance query must never be rendered as `₹0`, empty success, or a normal empty state. Distinguish `loading`, `error/unavailable`, `denied`, and genuine zero-data states.
- Keep the Stage 3C canonical workflow and its exact **93/0/0/0/0** acceptance gate completely unchanged.