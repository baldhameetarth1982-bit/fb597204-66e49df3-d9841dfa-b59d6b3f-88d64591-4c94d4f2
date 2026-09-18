# Stage 3D forensic correction and evidence cleanup

## Goal
Resolve only verified Stage 3D defects in the current tree, preserve the Stage 3C `93/0/0/0/0` gate, and keep Stage 3E unstarted.

## Plan
1. **Establish the authoritative migration chain**
   - Classify the Drizzle Stage 3D files versus deployable migrations and document their roles.
   - Repair the malformed deployable Stage 3D correction without rewriting applied history.
   - Ensure the final effective finance functions have one unambiguous definition, safe grants, and fresh/upgrade convergence.

2. **Harden resident authorization and accounting semantics**
   - Make resident access explicit from the authenticated actor’s active, society-matching canonical occupancy/membership.
   - Exclude block admins unless they independently qualify as an active resident; deny anonymous, moved-out, unrelated, and cross-society callers.
   - Preserve authorization-before-visibility/plan checks.
   - Verify journal-derived signs behaviorally: income positive, expense negative, and reversals compensating exactly once.

3. **Correct the verification suite and gates**
   - Clean the Stage 3D live/foundation tests and derive the expected count from meaningful registered cases.
   - Add missing database-state assertions for retries, conflicts, reversals, audit rows, and concurrency where the disposable environment supports them.
   - Keep Stage 3D and Stage 3C reports separate; validate failures, skips, malformed/missing reports, setup, and teardown independently.

4. **Verify affected finance screens only**
   - Confirm Accounts and Reports distinguish unavailable data from legitimate zero and retry the failed request.
   - Confirm Expenses and Journal use canonical server-authoritative data and preserve failure states.
   - Confirm Resident Trust exposes only the resident-safe projection and Resident Ledger remains redirect-only.
   - Keep one metadata definition per affected finance route.

5. **Run and record evidence**
   - Run focused and full tests, typecheck, production build, supported bundle-secret scan, migration/source/security validators, and Stage 3C preservation validators.
   - Run disposable Stage 3D runtime verification if local infrastructure is available; otherwise record the exact blocker without claiming runtime proof.
   - Perform authenticated visual checks only if a safe synthetic session is available.
   - Update roadmap/release evidence with the exact 29-section status report and leave Stage 3D below `release_ready` unless all required evidence exists.

## Technical constraints
- DEEP/RELEASE discipline; additive migrations only.
- No changes to `src/lib/utils.ts`, Stage 3C behavior or matrix, protected production data, online payments, Razorpay, AI, reconciliation, exports, or accounting periods.
- No generated-type hand edits, client-side authorization substitutes, raw financial errors, fake zeros, or optimistic success.
