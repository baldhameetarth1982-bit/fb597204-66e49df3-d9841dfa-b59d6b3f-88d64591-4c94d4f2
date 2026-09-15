# Stage 3C External Execution Handoff

Stage 3C remains **BLOCKED** solely because the canonical GitHub Actions runtime has not been externally dispatched. Everything below is what the repository owner needs to execute and verify it. Do not duplicate or alter the workflow.

## Canonical workflow

- File: `.github/workflows/stage3c-runtime-verification.yml`
- Workflow display name: **Stage 3C Runtime Verification**
- Job: **Isolated Supabase + Playwright**
- Required ref: `edit/edt-5855a41a-6b98-46e2-8025-6c267bec15bb`
- Required commit: `778d79fc30caca93896302f087b7b336f7c68a25`
- Workflow inputs: **none required**

## Manual execution steps

GitHub → repository → **Actions** → **Stage 3C Runtime Verification** → **Run workflow** → select the required ref → **Run workflow**.

## Required closure evidence

- 93 passed
- 0 failed
- 0 skipped
- 0 setup failures
- 0 teardown failures

## Required live security evidence

- RLS / cross-society isolation
- Role authorization
- Payment lifecycle (Cash and Bank Transfer)
- Receipt correctness
- Idempotency / replay protection
- Audit integrity
- Cleanup / teardown

## Artifacts

- `stage3c-reports` — primary artifact; the closure evidence above is read from here.
- `stage3c-supabase-diagnostics` and `stage3c-app-log` — failure investigation only.

## Fail-closed rule

Static checks, unit tests, a passing migration audit, or an unexecuted workflow do **not** close Stage 3C. Any skipped case, setup failure, or teardown failure means Stage 3C remains BLOCKED.

## Security

- Never expose GitHub or backend credentials in logs, issues, or documentation.
- Never run against the protected real society.
- The runtime environment must remain disposable and synthetic.
