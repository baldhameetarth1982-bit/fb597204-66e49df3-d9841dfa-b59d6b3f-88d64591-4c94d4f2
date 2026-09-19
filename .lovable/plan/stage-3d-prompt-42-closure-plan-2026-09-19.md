# Stage 3D Prompt #42 Closure Plan

## Scope
- Preserve Stage 3C behavior, the exact 93-case contract, `src/lib/utils.ts`, protected-production isolation, and Stage 3E as not started.
- Correct only the remaining audit-cleanup, CI isolation, report-evidence, and migration-status defects identified by Prompt #42.

## Implementation
1. Harden the Stage 3C fixture source validator against narrowly defined audit cleanup bypasses while continuing to allow audit reads.
2. Replace the inverted fresh-reset security assertion with explicit positive managed-track assertions and a clearly named divergence/blocker contract.
3. Add commit metadata and mandatory expected-SHA validation to the Stage 3D report gate, runner, and focused tests.
4. Split Stage 3C and Stage 3D runtime verification into independent CI jobs with separate disposable database lifecycles, environments, reports, and outcomes.
5. Preserve the historical managed migrations and document the still-unverified CLI fresh-reset track without inventing a migration or claiming convergence.

## Verification
- Confirm exactly 11 behavioral Stage 3D cases and zero Stage 3C gate references in Stage 3D-specific code.
- Run fresh typecheck, focused tests, source validators, complete non-live tests, build, bundle-secret scan, and diff checks.
- Attempt live Stage 3D and fresh reset only when genuinely isolated local infrastructure exists; otherwise record them as blocked and retain `implemented_unverified`.
- Produce the requested 25-section evidence report with exact observed totals.
