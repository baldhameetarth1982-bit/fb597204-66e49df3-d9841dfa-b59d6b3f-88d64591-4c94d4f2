# Prompt #34 — Stage 3D closure before Stage 3E

## Current evidence and classification

Stage 3D remains **IMPLEMENTED_UNVERIFIED**, not complete.


| Requirement                                   | Status                 | Evidence / defect                                                                                                                                                                            |
| --------------------------------------------- | ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Canonical society-scoped double-entry journal | IMPLEMENTED_UNVERIFIED | Tables, source links, balanced posting, immutable posted rows, and RLS exist; disposable runtime is unavailable locally.                                                                     |
| Complete replay identity and concurrency      | IMPLEMENTED_UNVERIFIED | Forward migration compares the full canonical identity and catches concurrent uniqueness conflicts; live race evidence is pending.                                                           |
| Payment/income/expense posting and reversals  | IMPLEMENTED_UNVERIFIED | Canonical transitions are wired and plan-gated; eight-case live suite exists, but it has not run here.                                                                                       |
| Backfill durability                           | IMPLEMENTED_UNVERIFIED | Durable `(society_id, request_id)` results and advisory locking exist; runtime replay proof is pending.                                                                                      |
| Cash/bank books and overview                  | IMPLEMENTED_UNVERIFIED | Journal-derived reads exist; date and balance behavior need runtime proof.                                                                                                                   |
| Receivables ageing                            | PARTIAL                | Server-authoritative implementation exists; boundary and lifecycle behavior need stronger behavioral coverage.                                                                               |
| Vendors and expenses                          | IMPLEMENTED_UNVERIFIED | Tenant-scoped mutations, idempotency, reversal, UI controls, and pagination exist; visual/runtime proof is pending.                                                                          |
| Legacy ledger boundary                        | COMPLETE in source     | Legacy rows are read-only and excluded from canonical reporting/backfill.                                                                                                                    |
| Plan entitlement                              | IMPLEMENTED_UNVERIFIED | Database checks fail closed for inactive/expired/unknown plans; client gate is presentation only.                                                                                            |
| Financial visibility                          | INCORRECT / MISSING    | Existing resolver supports `admin/summary/detailed/none`, but Stage 3D read RPCs accept only `admin`; the resident route redirects and its dead component reads legacy ledger data directly. |
| Query failure UX                              | PARTIAL                | Main finance pages separate loading/errors, but Reports still renders zero-value hero statistics while the overview request is loading or failed, and lacks retry.                           |
| Stage 3C preservation                         | IMPLEMENTED_UNVERIFIED | Plan-gated triggers preserve Basic societies and source validators pass; exact `93/0/0/0/0` runtime evidence is still absent, so Stage 3C remains BLOCKED.                                   |
| Responsive/accessibility closure              | BLOCKED                | Source-level controls improved; required viewport, keyboard, focus, and screenshot evidence is not yet captured.                                                                             |
| Runtime security and tenant isolation         | BLOCKED                | Docker and the local database CLI are unavailable in this environment.                                                                                                                       |


Stage 3E remains **NOT_STARTED** until the Stage 3D defects above are fixed and its runtime closure gate is satisfied. No accounting-period schema will be added prematurely.

## Implementation plan

### 1. Close remaining Stage 3D server defects

- Add one forward-only migration; do not rewrite applied history.
- Add a server-authoritative resident finance read contract that derives `admin/summary/detailed/none` from the existing resolver, enforces active plan entitlement independently, and returns only the fields allowed by the selected tier.
- Keep admin workspaces/books/reports admin-only; never broaden base-table RLS or grants.
- Make summary and detailed projections explicit, society-scoped, journal-derived, and non-enumerating; `none`, unknown plans, inactive plans, and unauthorized actors fail closed.
- Strengthen ageing/date-boundary and lifecycle rules where the audit identifies a concrete defect.
- Preserve exact replay, reversal, backfill, legacy-ledger, and audit-failure behavior; add only corrective definitions needed by the audit.
- Revoke `PUBLIC`/`anon` execution from every new privileged function and grant only the roles required by its policy.

### 2. Replace the unsafe/dead resident finance screen

- Remove the direct legacy-ledger read from the resident route.
- Use the new authenticated server contract for summary/detailed transparency.
- Render explicit plan-locked, privacy-unavailable, loading, genuine-empty, filtered-empty, error, and retry states without fabricating zeros.
- Keep resident access read-only and avoid exposing journal IDs, actor IDs, vendor contact data, or other admin-only fields.

### 3. Harden admin report states

- Prevent report hero figures from displaying `₹0` before a successful response.
- Add safe retry for overview and ageing independently.
- Keep genuine zero distinct from loading, permission denied, plan locked, and query failure.
- Preserve pagination, duplicate-submission prevention, destructive confirmation, and server-confirmed financial language on existing finance screens.

### 4. Expand verification without weakening Stage 3C

- Extend disposable Stage 3D tests for all four visibility tiers, active/inactive/unknown entitlement, summary-vs-detailed projections, cross-society denial, audit rollback, date boundaries, ageing buckets, exact lifecycle posting, replay/concurrency, backfill replay, legacy exclusion, and immutable verified history.
- Add focused source/contract tests for the resident and report failure-state boundaries.
- Keep Stage 3C's canonical 93-case suite, report validator, and exact `93 passed / 0 failed / 0 skipped / 0 setup failures / 0 teardown failures` gate unchanged.
- Keep local and CI runs fail-closed for skipped/TODO/setup/teardown/incomplete reports.

### 5. Validate and report honestly

- Run focused tests, full non-live tests, TypeScript, build, bundle-secret scan, migration/source/security validators, shell/YAML checks, and `git diff --check`.
- Attempt disposable runtime only through the isolated local runner. If Docker/database CLI remain unavailable, record runtime as **BLOCKED**, not passed.
- Run mobile/desktop browser checks only if an authenticated synthetic fixture is available; otherwise record visual verification as blocked.
- Update roadmap and release documents with exact command exit codes, test totals, durations, changed objects, unresolved defects, and blockers.
- Confirm `src/lib/utils.ts` is unchanged and the stale line-8 diagnostic is not treated as a real source defect.

## Stage 3E gate

Do not implement Stage 3E in this run unless Stage 3D reaches genuine closure with disposable runtime and required visual evidence. If that evidence remains blocked, report Stage 3E as **NOT_STARTED** with the exact external action required: run the checked-in disposable workflow in an environment with Docker and the local database CLI, then provide the generated Stage 3D and Stage 3C reports.

## Constraints preserved

- Synthetic societies only; the protected production society is never queried, seeded, printed, or used.
- No online maintenance payments, society Razorpay collections, UPI/cards/wallets, Stripe/Paddle, Smart QR, AI categorization, reconciliation, exports, or Stage 4+ work.
- No Firebase/session architecture changes.
- No weaker RLS, grants, role checks, plan checks, canonical RPC boundaries, or audit guarantees.
- No test rewriting to accept broken behavior and no skipped test presented as passed.      **Resident finance contract**
  - Must resolve society membership/server authorization from the authenticated session, never accept a client-supplied `society_id` as authority.
  - `none`, inactive/expired/unknown plan, unauthorized resident, and resolver failure must fail closed.
  - Never fall back to legacy `ledger_entries`.
- **Financial visibility**
  - `summary` and `detailed` must be projections from canonical journal/source data only.
  - Never expose journal IDs, internal actor IDs, vendor private/contact data, or admin-only accounting metadata.
  - `admin` remains admin-only; do not accidentally make `admin` available to residents.
- **Error behavior**
  - A failed finance query must **never become ₹0, an empty-success state, or “no dues.”**
  - Loading → success/empty/error must be distinguishable.
  - Retry must re-query safely without duplicate mutations.
- **Accounting integrity**
  - Do not weaken the existing canonical posting, reversal, idempotency, concurrency, audit, or immutable-history protections to make tests pass.
  - Any audit failure on a financial mutation must roll back the mutation.
  - Replays must return the original canonical result rather than create a second posting/audit event.
- **Stage 3C**
  - Treat the existing **93/0/0/0/0** gate as immutable.
  - Do not modify its cases, expected totals, skip handling, teardown behavior, or success criteria merely to obtain a pass.
  - If external execution is unavailable, explicitly report **BLOCKED**.
- **Protected society**
  - Synthetic/disposable fixtures only. Do not inspect, seed, count, probe, or print the protected society or its identifier.
- **Scope**
  - Do **not** start Stage 3E if Stage 3D runtime/visual closure is still blocked.
  - Do not touch Firebase/session architecture, `src/lib/utils.ts`, online society payments, Smart QR, AI, exports, or Stage 4+ work.
- **Testing**
  - Tests must exercise actual database/RPC behavior where runtime exists, not merely source-string contracts.
  - No weakening assertions, deleting cases, converting failures to skips, or presenting skipped/setup-failed cases as passed.
- **Final report**
  - Separate **implemented**, **tested**, **security-verified**, **visually verified**, and **blocked**.
  - Give exact test totals and command exit codes.
  - If runtime is blocked, state the exact external action required rather than implying closure.