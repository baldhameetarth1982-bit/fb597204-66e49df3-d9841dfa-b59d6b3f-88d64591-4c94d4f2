# Stage 3D final runtime-gate closure

## Scope
- Keep Stage 3C behavior and its exact 93-case contract unchanged.
- Keep Stage 3D at exactly 11 behavioral cases.
- Do not modify `src/lib/utils.ts`, Stage 3E, product UI, authentication, payment behavior, or historical migrations.
- Use only synthetic disposable runtime data; never inspect or use the protected society.

## Changes
1. **Fail closed on commit identity**
   - Remove the Stage 3D runner’s fallback from a missing `EXPECTED_COMMIT_SHA` to the checked-out commit.
   - Require a full 40-character SHA, compare it with the checked-out commit, remove stale report files, run the real suite, and verify the generated report and metadata.
   - Add focused source/behavior coverage proving a missing, malformed, or mismatched expected SHA cannot satisfy the release gate.

2. **Confirm security and gate isolation**
   - Verify fixture teardown never deletes immutable audit history and its validator rejects obvious deletion, truncation, cleanup-RPC, trigger-disable, and role-bypass paths.
   - Verify Stage 3D code has no Stage 3C opt-in dependency and the two CI jobs own separate disposable database lifecycles.
   - Preserve the managed audit lock and append boundary. Keep duplicate historical migrations intact and report the CLI fresh-reset track as divergent rather than fabricating convergence.

3. **Run evidence checks in the requested order**
   - Run focused Stage 3D, audit, fixture, migration, report, and Stage 3C preservation checks.
   - Run the full non-live suite, TypeScript, production build, bundle-secret scan, and diff checks.
   - Run live Stage 3D and fresh-reset verification only if genuinely isolated local infrastructure is available; otherwise record the precise blocker and retain `implemented_unverified`.

4. **Record only observed status**
   - Update the Stage 3D release/development records only where evidence changes.
   - Keep Stage 3E unstarted and report all remaining blockers explicitly.

## Acceptance
- `utils.ts` remains the same six-line helper with its current hash.
- Stage 3D runner cannot execute or accept evidence without an explicit matching full commit SHA.
- Exact Stage 3D and Stage 3C source contracts remain 11 and 93 respectively.
- Audit history stays immutable for browser and privileged roles.
- No release-ready or runtime-verified claim is made without a real commit-bound 11/0/0 disposable run.
