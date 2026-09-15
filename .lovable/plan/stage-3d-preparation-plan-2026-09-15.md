# Stage 3D preparation plan

## Current boundary

- Stage 3C remains **BLOCKED — live runtime evidence unavailable**.
- Its closure gate remains unchanged: **93 passed, 0 failed, 0 skipped, 0 setup failures, 0 teardown failures** in the canonical disposable GitHub Actions run.
- Stage 3D implementation must not begin until that evidence exists and Stage 3C receives explicit closure approval.

## Authoritative Stage 3D scope

Stage 3D is **Ledger, expenses, transparency and reports**:

- Expenses and vendors
- Cash book and bank book
- Journal entries with balanced accounting rules
- Income/expense, ageing, and period reports
- Resident summary/detailed financial-transparency settings

The obsolete `NEXT_STAGES.md` section that labels Smart QR as Stage 3D is not authoritative; Smart QR remains deferred to Stage 10.

## Explicit exclusions

- Stage 3C payment implementation, acceptance cases, workflow, and Matrix Import
- Period close/reopen controls
- Full reconciliation closure and performance testing
- Accounting exports
- Full financial security/UI closure reserved for Stage 3E
- Society-owned online payment gateway, fake payment methods, or changes to Cash/Bank Transfer rules

## First implementation slice after Stage 3C closes

1. Audit and define the canonical accounting model shared by expenses, income, and verified maintenance payments.
2. Establish server-authoritative, society-scoped journal posting with balanced debit/credit enforcement and idempotent source references.
3. Safely integrate existing expense/vendor records without deleting or rewriting verified financial history.
4. Add focused database, authorization, tenant-isolation, balance, replay, and reversal tests before expanding UI work.    ## First implementation slice after Stage 3C closes
  1. Audit the existing accounting/financial schema and code paths before changing anything.
     Identify the canonical existing models for:
     - income
     - verified maintenance payments
     - expenses
     - vendors
     - ledger/journal data
     - cash/bank records
     - audit history
  2. Define ONE canonical accounting model shared by expenses, income, and verified
     maintenance payments.
     Do not create a competing ledger if an existing canonical model already exists.
     Reuse/migrate existing structures safely where possible.
  3. Establish server-authoritative, society-scoped journal posting with:
     - balanced debit/credit enforcement
     - atomic posting
     - idempotent source references
     - immutable verified history
     - controlled reversal
     - audit history
     - strict RLS/authorization
     - cross-society isolation
  4. Before production UI expansion, add focused database and server tests proving:
     - balanced entries
     - unbalanced entries rejected
     - zero/invalid amounts rejected
     - duplicate/replay source references rejected or safely deduplicated
     - reversal preserves historical integrity
     - unauthorized roles rejected
     - cross-society access rejected
     - plan entitlement enforced
     - verified financial history cannot be destructively rewritten
     - actor/society authority cannot be supplied by an untrusted client
     - audit records are created for financial transitions
  5. Safely integrate existing expense/vendor records without deleting,
     rewriting, or silently reclassifying verified financial history.
  6. STOP after this slice.
  Do not build the full expense UI, reports, cash book, bank book, or transparency
  screens until the canonical accounting model and its security/integrity tests
  are proven.

## Later Stage 3D slices

1. Expense and vendor workflows using the canonical accounting model.
2. Cash book, bank book, and journal views.
3. Income/expense, ageing, and period reports.
4. Resident summary/detailed transparency settings, enforced by the backend rather than UI visibility alone.
5. Mobile/accessibility and failure-state verification for affected screens.

## Technical constraints

- Derive society and actor authority on the server; never trust client-provided society, role, ownership, or permission data.
- Keep RLS and role/plan checks server-enforced for every accounting read and mutation.
- Require balanced entries, atomic/idempotent transitions, immutable verified history, and controlled reversals.
- Reuse existing accounting routes and shared navigation; do not create duplicate routes or competing ledgers.
- Replace direct browser financial queries where they bypass the established server-authoritative boundary.
- Use only synthetic disposable societies in tests and never access the protected production society.
- Preserve safe errors and prevent keys, credentials, identifiers, and financial details from leaking through logs.

## Verification gate for each slice

- Focused accounting behavior tests
- RLS, role, plan, and cross-society isolation tests
- Balance, duplicate/replay, reversal, and audit-history tests

&nbsp;

- Typecheck and production build
- Client-bundle secret scan and diff validation
- Relevant mobile and accessibility checks for changed screens

## Blocker and next action

**Blocker:** Stage 3C lacks the required canonical live-runtime evidence.

**Next action:** Run the existing canonical Stage 3C GitHub Actions workflow externally and record a valid 93/0/0 result with zero setup and teardown failures. Only then approve and begin the first Stage 3D slice above.