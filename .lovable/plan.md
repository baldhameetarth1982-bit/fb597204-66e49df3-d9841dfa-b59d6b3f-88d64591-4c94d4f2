# Stage 3D canonical accounting hardening

## Goal
Finish the existing Stage 3D implementation without changing Stage 3C business rules, touching protected production data, or claiming runtime closure without evidence.

## Highest-priority corrections
- Add a forward-only corrective migration that makes journal posting fail closed on conflicting replays, validates source/reversal society ownership, preserves immutable posted history, and keeps all canonical mutations behind authenticated RPCs.
- Replace implicit trigger-only coupling with guarded, transaction-safe payment and income posting that preserves every existing Stage 3C state, receipt, authorization, occupancy, method, and error rule.
- Complete idempotent expense reversal, vendor lifecycle safeguards, deterministic account seeding, and an explicit preview/execute backfill boundary for verified unposted sources only.
- Correct cash/bank opening and running balances, receivables ageing buckets, report visibility (`none`, `summary`, `detailed`, `admin`), and fail-closed plan enforcement from canonical data.
- Remove unsafe adapter typing and non-null assertions; treat any selected society as untrusted and independently authorize/derive tenant and actor at the database boundary.

## Existing screen completion
- Keep the current Accounts, Transactions, Expenses, and Reports pages; do not create another finance center.
- Add vendor management and selection within the existing Expenses experience.
- Expose Cash Book, Bank Book, Journal, and Ageing through the existing Accounts navigation/views, with pagination and clear loading, locked, denied, empty, retry, and reversal-confirmation states.
- Preserve Indian currency formatting, touch targets, keyboard access, mobile layouts, and honest financial status messaging.

## Verification
- Replace regex-only confidence with focused behavioral and security tests using isolated synthetic societies: balance/precision, tenant isolation, direct-write denial, immutable history, replay/concurrency, payment/income/expense posting and reversal, visibility, entitlement, reports, ageing, audit failure, legacy lockdown, and protected-ID absence.
- Re-run Stage 3C regression/source checks unchanged, full non-live tests, typecheck, build, diff check, bundle-secret scan, migration/security validators, and browser checks at required sizes.
- Run fresh, upgraded, and accounting runtime validation only when disposable tooling is available; otherwise report each as not executed.

## Status and boundaries
- Update the canonical roadmap, coverage, readiness, and history documents with exact evidence only.
- Keep Stage 3C **BLOCKED** until external disposable evidence is exactly `93 passed / 0 failed / 0 skipped / 0 setup failures / 0 teardown failures`.
- Keep Stage 3D at `implemented_unverified` unless fresh/upgraded runtime and visual evidence genuinely support a stronger status.
- Exclude online society payments, Razorpay collection changes, Smart QR, AI categorization, period closing, final reconciliation, exports, and all protected-society access.

## Technical notes
- Use additive migrations only; never rewrite applied migration history.
- Preserve the canonical model: source workflows → `finance_journal_entries`/`finance_journal_lines`; legacy `ledger_entries` remains read-only and excluded.
- Use fixed `search_path`, schema-qualified objects, explicit grants, RLS, canonical `audit_log` columns, and safe external error mapping.
