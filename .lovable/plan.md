# Stage 3C Workflow Checkout Safety Gate

## Goal
Add one fail-closed preflight to the canonical Stage 3C workflow so every run proves which checkout it tests and rejects a stale migration chain before starting the disposable database.

## Changes
- Update only `.github/workflows/stage3c-runtime-verification.yml`.
- Immediately after checkout, log the repository, selected ref, event SHA, and actual checked-out commit.
- Run the existing focused migration dependency test to reject the obsolete Razorpay RPC, verify `is_razorpay_live()` ordering and least-privilege permissions, and confirm the current 93-case suite exists through the existing source validators.
- Keep branch selection controlled by the normal manual workflow dispatch; do not override checkout to `main` or hardcode a commit.
- Preserve the disposable database setup, exact 93-case closure gate, Playwright job, artifacts, and fail-closed teardown unchanged.

## Validation
- Parse the workflow YAML.
- Run the migration dependency test and existing Stage 3C source validators.
- Run `git diff --check` and inspect the final workflow diff.
- Do not rerun the full app suite or change application code.

## Constraints
- Production Excellence mode: DEEP, because this changes migration/payment release verification.
- No Stage 3D, Matrix Import, payment behavior, test-case, database, secret, or protected-society changes.
- Stage 3C remains blocked until canonical GitHub runtime reports 93 passed, 0 failed, 0 skipped, 0 setup failures, and 0 teardown failures.
