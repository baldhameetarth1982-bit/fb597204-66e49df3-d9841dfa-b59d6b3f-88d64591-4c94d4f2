# Stage 3C live runtime environment unblock

## Scope
Make the existing 93-case Stage 3C live suite reproducible against an isolated local database only. Do not modify Matrix Import, production behavior, the 93 cases, or Stage 3D.

## Findings
- The live fixture already fails closed unless explicitly enabled and given dedicated test credentials.
- It rejects hosted/shared database URLs and creates only synthetic, prefix-scoped societies and users.
- The existing CI workflow already starts disposable services, applies repository migrations without seed data, exports local credentials, runs the 93-case suite, validates the JSON report, uploads evidence, and tears services down.
- This sandbox has neither Docker nor the local database CLI, so the actual live lifecycle cannot execute here.
- The reported `src/lib/utils.ts(8,7)` error is stale: the file has six lines and current type checking does not reproduce it.

## Implementation
1. Add one repository script that mirrors the CI lifecycle for developers: preflight Docker/CLI, start disposable services, reset with repository migrations, safely parse local credentials without printing them, run the exact 93-case command and validators, preserve a report, and always stop services.
2. Add a package command for that script; do not add dependencies or alter the lockfile.
3. Strengthen the source validator and behavioral tests so the disposable workflow/local runner cannot silently drop the environment guard, migration reset, report validation, or teardown.
4. Update Stage 3C status documents to distinguish source/CI readiness from observed runtime closure. Keep Stage 3C blocked until a real report proves 93 passed, zero failed/skipped/setup/teardown failures.

## Verification
- Shell syntax and workflow parsing checks.
- Canonical/source/report validator tests.
- Full typecheck, full non-live tests, app build, client bundle secret scan, and diff checks.
- Attempt the local live runner only if Docker and the local database CLI are available; otherwise record the exact unavailable dependency and leave Stage 3C blocked.
