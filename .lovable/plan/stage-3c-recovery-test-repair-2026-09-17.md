# Stage 3C Recovery/Test Repair

## Scope
- Rewrite only `tests/unit/billing-stage3c-closure-v4.test.ts` as one coherent test implementation.
- Preserve all existing resident/admin submission, UI contract, payment-detail, occupancy, permission, and protected-society assertions.
- Do not change application code, migrations, payment behavior, Stage 3C cases, or Stage 3D.

## Implementation
- Load every SQL migration once in deterministic filename order.
- Extract each required RPC's latest actual `CREATE OR REPLACE FUNCTION` definition, failing clearly when absent.
- Resolve permission statements per exact RPC signature and verify the latest effective state grants authenticated execution while denying PUBLIC and anonymous execution.
- Keep explicit active-occupancy checks for all five resident-facing RPCs.
- Retain focused payment/audit/recreation-path regressions in their existing dedicated test files.

## Verification
- Run the complete focused Stage 3C test set with full output.
- Run the canonical non-live unit/integration scope and report exact totals.
- Run typecheck, production build, local-runner help validation, migration validators, Stage 3C source/93-case validators, client bundle secret scan, and diff validation.
- Execute disposable migration/runtime checks only if local tooling exists; otherwise report them as not executed.
- Keep Stage 3C blocked unless external evidence is exactly 93 passed, 0 failed, 0 skipped, 0 setup failures, and 0 teardown failures. Keep Stage 3D not started.
