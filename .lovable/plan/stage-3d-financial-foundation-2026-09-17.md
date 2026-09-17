# Stage 3D financial foundation

## Scope

Implement the canonical Stage 3D accounting foundation while preserving Stage 3C payment behavior and its blocked external-runtime status. Replace unsafe direct finance reads/writes with one society-scoped, server-authoritative model; preserve legacy rows read-only rather than fabricating conversions.

## Database and security

- Add an additive migration for society-scoped chart accounts, balanced journal entries/lines, vendors, and the canonical expense lifecycle, with explicit grants, RLS, tenant constraints, immutable posted history, source uniqueness, reversal linkage, and audit writes.
- Add authenticated, fixed-search-path RPC boundaries for idempotent account seeding, atomic journal posting, expense creation/reversal, cash and bank books, journal/report summaries, and receivables ageing.
- Derive actor, society, role, finance entitlement, and visibility in the database; reject cross-society references and malformed amounts/dates. Remove direct authenticated mutation access from canonical and legacy finance tables.
- Keep legacy `ledger_entries` preserved and read-only. Do not auto-convert historical rows without provable source identity.

## Canonical source integration

- Extend the existing verified-payment and verified-income transition functions additively so successful verification posts exactly one journal entry and reversal posts exactly one compensating entry, in the same transaction.
- Do not alter Stage 3C states, verification authorization, receipts, Cash/Bank Transfer rules, idempotency, or error contracts. Pending and rejected sources never post.
- Add a safe, explicit backfill RPC for unposted verified sources; it remains idempotent and never targets a hardcoded society.

## Application integration

- Add strict server-function adapters and Zod contracts for accounts, vendors, expenses, journal books, reports, and ageing; all browser inputs exclude trusted society/actor fields.
- Upgrade the existing Accounts, Transactions, Expenses, and Reports screens instead of adding parallel finance routes. Add Vendors, Cash Book, Bank Book, and Ageing as views within the existing Accounts navigation.
- Use authoritative paginated projections, safe errors, plan-locked/denied/error/empty states, Indian currency formatting, and controlled expense-reversal confirmation. Remove direct browser finance aggregation and destructive delete actions.

## Tests and validation

- Add focused Stage 3D contract/behavior tests covering balance enforcement, precision, atomicity, idempotency, replay, tenant isolation, vendor/expense lifecycle, reversals, payment/income posting, books, reports, ageing, visibility, entitlement, audit, and no physical deletion.
- Run focused Stage 3D tests, existing Stage 3C tests, full non-live tests, typecheck, build, bundle-secret scan, migration/source validators, and diff checks.
- Run disposable fresh/upgraded database validation only if tooling is available; otherwise report it as not executed without inventing evidence.

## Documentation and status

- Update roadmap/status/coverage/history documents with exact implemented and unverified boundaries.
- Keep Stage 3C **BLOCKED** pending external `93 passed / 0 failed / 0 skipped / 0 setup failures / 0 teardown failures` evidence.
- Mark Stage 3D only to the level proven by this run; do not claim runtime, visual, or release closure without evidence.

## Explicit exclusions

No protected-society access, Stage 3C case changes, online collection gateway, UPI/cards/wallets, Stripe/Paddle, platform fee, AI categorization, Smart QR, accounting-period close/reopen, final reconciliation closure, or full accounting export.       :

1. **Journal integrity must be database-enforced**
  - Every posted journal entry must have at least 2 lines.
  - Total debits = total credits exactly.
  - No zero/negative lines.
  - Posted entries and lines cannot be updated or deleted.
  - Reversals must reference the original entry and themselves balance.
2. **No partial financial writes**
  - Payment/income verification + journal posting + audit must commit atomically.
  - If journal posting fails, the source verification transition must roll back.
  - No “verified but unposted” state except the explicitly supported backfill path.
3. **Concurrency / double-post protection**
  - Enforce database uniqueness for each source transition, not merely an application check.
  - Concurrent verification/reversal requests must result in exactly one posting.
  - Retries/replays must return the existing canonical result rather than create another journal.
4. **Explicit account semantics**
  - Define canonical account types and normal debit/credit behavior.
  - Cash and Bank accounts must be society-scoped.
  - Payment/income posting must use deterministic account mapping, never user-supplied arbitrary account IDs.
5. **Expense lifecycle**
  - Draft/pending/posted/reversed states should be explicit.
  - Only authorized users can post/reverse.
  - A reversed expense remains permanently visible in history.
  - No physical deletion of canonical expenses, vendors, journal entries, or journal lines.
6. **Report correctness**
  - Reports must derive from canonical journal data, not independently aggregate old `payments`, `expenses`, and `ledger_entries`.
  - Legacy `ledger_entries` must be clearly labeled as legacy/unconverted and excluded from canonical totals unless explicitly supported by a documented reconciliation rule.
7. **Visibility must be enforced server-side**
  - `admins_only` / `detailed` / `summary` / `none` must apply to every finance RPC and projection, not merely the UI.
  - A resident cannot bypass this through direct Supabase queries or alternate RPC parameters.
8. **Plan entitlement must fail closed**
  - Unknown/missing/expired/inactive plans → denied.
  - Never trust a client-provided plan or feature flag.
  - All Stage 3D Pro-gated operations must use the same database/server entitlement boundary.
9. **Backfill safety**
  - Backfill should support dry-run/preview counts **without exposing protected production data**.
  - Only explicitly identified, provably unposted sources may be posted.
  - No blind “post everything verified” migration.
10. **Fresh + upgraded schema convergence**

- The migration chain must produce the same effective schema/security state from both a clean database and an upgraded database.
- Do not introduce another conditional recreation pattern that could resurrect obsolete policies/RPCs—the previous Stage 3C migration issue makes this particularly important.

11. **Audit fail-closed**

- Financial state changes must not silently succeed if their required audit write fails.
- Audit records must use the actual canonical `audit_log` column contract.

12. **Performance / pagination**

- No unbounded finance-table downloads into the browser.
- Reports/books/ageing must use server-side aggregation and pagination with sensible limits.

### Approval

With those additions, **I approve the Stage 3D plan**.

The most important architectural rule is:

> **Canonical journal = financial reporting source of truth. Legacy** `ledger_entries` **= preserved read-only historical data. Payments/income/expenses are source workflows that feed the canonical journal through guarded, atomic, idempotent server/database transitions.**