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
- Use additive migrations only; do not weaken authentication, tenant isolation, RLS, grants, plan checks, canonical posting, or audit guarantees.    **Do not modify Stage 3C behavior or its 93-case matrix.** The exact gate remains **93 passed / 0 failed / 0 skipped / 0 setup failures / 0 teardown failures**.
- **Do not weaken tests** to accommodate implementation problems. If a behavioral test exposes a defect, fix the implementation.
- For payment-state tests, verify the **canonical DB state**, not merely what the UI displays.
- For concurrency/idempotency, prove that concurrent/replayed requests produce **one canonical financial effect**, not merely one successful HTTP/RPC response.
- Resident authorization must be derived server-side from `auth.uid()` + canonical active membership/relationship. **No client-provided society/resident ID may become an authorization boundary.**
- Financial failures must remain **fail-closed**. Never turn RPC errors, missing rows, authorization failures, or unavailable data into legitimate-looking ₹0/empty success.
- Any audit event for a security-sensitive financial transition must use the canonical `audit_log` schema and must not silently disappear on a successful state-changing operation.
- Keep financial history immutable; corrections/reversals must remain traceable.
- **Do not touch** `src/lib/utils.ts` merely because of the stale line-8 diagnostic.
- Do not use the protected society even for verification.
- Do not begin Stage 3E, even if Stage 3D appears ready. We will explicitly advance stages with the next prompt.
- If runtime/visual infrastructure is unavailable, report **implemented_unverified/blocked** honestly rather than manufacturing evidence.

One important point: **the metadata improvement is fine only if it is genuinely part of the affected finance routes and does not become scope creep.** Do not spend a prompt polishing unrelated SEO/metadata work here.