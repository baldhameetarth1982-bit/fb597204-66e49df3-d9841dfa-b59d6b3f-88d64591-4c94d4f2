# Stage 3D final blocker resolution

## Goal

Close every safe, currently reproducible Stage 3D blocker while preserving Stage 3C and keeping Stage 3E unstarted.

## Implementation

- Add a terminal corrective migration in both canonical migration tracks that restores `audit_log` UPDATE/DELETE rejection for every role, including service role, and explicitly locks down table privileges.
- Remove test assumptions that privileged credentials may mutate audit history; keep cleanup at the disposable-database lifecycle boundary.
- Give Stage 3D its own runtime opt-in and report validator, while leaving the exact Stage 3C 93-case gate unchanged.
- Strengthen focused tests for effective migration order, audit immutability, exact 11-case execution, authorization-first resident access, and Stage 3D/3C gate separation.
- Update only Stage 3D status/evidence records and the active roadmap with verified results.

## Technical constraints

- Additive migrations only; do not rewrite migration history.
- No changes to `src/lib/utils.ts`, Stage 3C behavior or its 93-case matrix, protected production data, online payments, Razorpay, AI, reconciliation, exports, or Stage 3E.
- Use synthetic disposable data only. Do not manufacture runtime, browser, or security evidence.

## Verification

- Run focused Stage 3D and audit tests, migration/security validators, Stage 3C source-preservation validators, full practical test suite, typecheck, build, bundle secret scan, and `git diff --check`.
- Attempt the guarded Stage 3D live suite only if an isolated disposable backend is available; otherwise record the exact blocker and retain `implemented_unverified`.
- Report exact counts and statuses for all 25 requested evidence items.  Approve this plan. It correctly addresses the remaining Stage 3D blocker without starting Stage 3E.
  **Important hard stops for Lovable:**
  - The terminal corrective migration must make `audit_log` immutable for **service role too**; no production cleanup bypass.
  - Additive migration only; do not rewrite already-applied migration history.
  - Disposable fixture cleanup must happen at the disposable DB/schema lifecycle boundary.
  - The Stage 3D runtime gate must be independent from Stage 3C.
  - Stage 3C must remain exactly **93 passed / 0 failed / 0 skipped / 0 setup failures / 0 teardown failures**.
  - Do not claim runtime/security verification if the disposable backend is unavailable.
  - Do not weaken/remove tests to achieve green results.
  - Do not touch `utils.ts`, protected production data, or deferred Stage 3E/features.
  - For the audit test, verify the **effective final database behavior**, not merely migration text.
  - Authorization-first resident access must be tested behaviorally where runtime is available.
  - If any migration conflict or security ambiguity is discovered, stop that portion and report it rather than silently choosing a weaker behavior.
  Proceed with the implementation and verification exactly as planned.