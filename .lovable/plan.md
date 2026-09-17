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
No protected-society access, Stage 3C case changes, online collection gateway, UPI/cards/wallets, Stripe/Paddle, platform fee, AI categorization, Smart QR, accounting-period close/reopen, final reconciliation closure, or full accounting export.
