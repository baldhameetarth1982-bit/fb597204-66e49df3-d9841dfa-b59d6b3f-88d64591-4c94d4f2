# Stage 3D Prompt #47 Security Consistency Plan

## Scope
- Keep Stage 3E unstarted, preserve exactly 11 Stage 3D and 93 Stage 3C cases, and leave `src/lib/utils.ts` unchanged.
- Use source and synthetic/disposable checks only; never access protected production data or rewrite migration history.

## Current classification
- **Implemented:** canonical income transitions use `transition_income_record`; obsolete direct-update wrappers are absent; managed migration `0013` revokes and trigger-blocks audit truncation; audit update/delete and browser append protections exist; resident finance authorization is authorization-first and society-scoped.
- **Partial:** the fresh-reset migration track has update/delete immutability and append restrictions but no equivalent truncate protection.
- **Contradictory:** the audit test globally rejects any `TRUNCATE audit_log` text while separately requiring the legitimate managed `REVOKE TRUNCATE` migration; adding the missing fresh-reset protection would trip that test.
- **Missing:** a new forward-only fresh-reset migration providing the same revoke and statement-level truncate trigger as managed `0013`.
- **Unverified:** disposable database replay, runtime privilege/RLS behavior, and exact live 11/0/0 evidence because local Docker/database CLI tooling is unavailable.

## Changes
1. Add one timestamped forward-only fresh-reset migration that revokes `TRUNCATE` from all application roles and creates the statement-level immutable truncate trigger using the existing protected function.
2. Refine audit security tests to distinguish forbidden data-destruction statements from legitimate `REVOKE TRUNCATE` protection, and assert both migration tracks converge semantically.
3. Update only Stage 3D status documentation and the active roadmap with truthful source-converged/runtime-unverified wording.

## Verification
- Run focused migration, audit, income, Stage 3D foundation, report-gate, fixture-security, exact 11/93, and CI-independence checks.
- Run the full non-live suite, TypeScript check, production build through the platform signal, client-bundle secret scan when output exists, and patch checks.
- Keep status `implemented_unverified` unless a disposable reset and runtime suite actually execute.
