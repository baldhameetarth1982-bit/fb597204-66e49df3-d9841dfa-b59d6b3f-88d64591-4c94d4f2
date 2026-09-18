# Stage 3D defect-closure plan

## Current-tree assessment

- **Complete:** resident trust and deprecated ledger routes contain one canonical implementation and no direct legacy-ledger reads.
- **Complete:** Accounts and Reports distinguish unresolved/error states from legitimate zero values and provide retries.
- **Complete:** resident visibility now requires authenticated, active, society-scoped residency; block administrators and cross-society callers fail closed.
- **Complete:** receivables ageing matches payments by society, honors verified-at dates, and rejects future report dates.
- **Complete:** canonical journals, source ownership checks, compensating reversals, expense/vendor scope, immutable history, and durable backfill identity exist.
- **Implemented but unverified:** disposable database behavior, fresh migration convergence, security behavior, and visual/accessibility behavior have no current runtime evidence.
- **Partial:** the nine broad live tests do not explicitly prove every Prompt #35 resident, ageing, payment-state, reversal, idempotency, and boundary-date case.
- **Partial:** affected route metadata lacks the full required description/Open Graph/Twitter fields.
- **Missing:** current roadmap entry and final evidence report for Prompt #35.
- **Not started:** Stage 3E, as required.

## Implementation

1. Add only focused Stage 3D hardening needed by current defects; preserve all Stage 3C behavior and the exact 93-case gate.
2. Expand disposable integration coverage for anonymous/unrelated/moved-out/block-admin/cross-society denial, visibility and plan failure modes, verified versus pending/rejected/reversed payment math, ageing boundaries, partial/full payment handling, and replay/concurrency behavior.
3. Keep local and CI exact-count assertions synchronized after the suite expansion.
4. Improve affected finance loading/error status semantics and route metadata without redesigning the pages.
5. Add source-contract checks only as defense in depth, never as substitutes for runtime behavior.

## Verification

- Run focused Stage 3D tests, full non-live tests, typecheck, build, bundle secret scan, source/security/migration validators, Stage 3C preservation validators, and `git diff --check`.
- Run disposable database tests only if local Docker and database tooling are available; otherwise report the exact blocker and retain `implemented_unverified`.
- Verify affected resident/admin pages at mobile and desktop widths when an authenticated synthetic fixture is available; otherwise report visual verification as blocked.
- Confirm `src/lib/utils.ts` remains unchanged and the reported line-8 diagnostic is stale.

## Scope safeguards

- Never access or identify the protected production society; use synthetic fixtures only.
- Do not begin Stage 3E or touch online payments, Razorpay, UPI/cards/wallets, Smart QR, AI, reconciliation, exports, or period-close work.
- Use additive migrations only; do not weaken authentication, tenant isolation, RLS, grants, plan checks, canonical posting, or audit guarantees.
