# Stage 3D Prompt #46 Security Closure Plan

## Scope
- Keep Stage 3E unstarted, preserve exactly 11 Stage 3D and 93 Stage 3C cases, and leave `src/lib/utils.ts` unchanged.
- Use only synthetic/disposable evidence; do not access protected production society data or rewrite migration history.

## Corrections
1. Remove the unused legacy income-status mutation path that updates records directly and attempts audit inserts through an authenticated client. Retain the active transactional database function path, which updates status and appends audit history atomically.
2. Strengthen source tests for the effective audit RLS/grant/trigger contract, the canonical append boundary, strict society-admin/block-admin behavior, resident authorization ordering, society-scoped joins, input bounds, and minimized projections.
3. Correct roadmap/release wording so source convergence and unavailable disposable runtime evidence remain distinct; Stage 3D stays `implemented_unverified`.

## Verification
- Run migration/history, audit, resident authorization, fixture safety, exact 11/93, and CI-independence checks in the requested order.
- Run the full non-live suite, TypeScript check, production build, client-bundle secret scan, and patch validation.
- Attempt disposable runtime checks only if the required local tools exist; otherwise report the exact blockers without claiming runtime evidence.
