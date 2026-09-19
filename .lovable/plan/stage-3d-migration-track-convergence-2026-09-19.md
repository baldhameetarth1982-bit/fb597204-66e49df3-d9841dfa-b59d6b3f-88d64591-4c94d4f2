# Stage 3D migration-track convergence

## Goal
Close the fresh-reset security divergence without changing historical migrations, Stage 3C behavior, the exact Stage 3D contract, or `src/lib/utils.ts`. Stage 3E remains unstarted.

## Current verified state
- `drizzle/migrations/` is the managed migration authority; its journal records `0000` through `0012`.
- `supabase/migrations/` is the active disposable fresh-reset track used by local scripts and both CI runtime jobs.
- The fresh-reset track already contains the early Stage 3D migrations but lacks the final resident authorization, audit immutability, and audit append-boundary state.
- The reported `src/lib/utils.ts(8,7)` diagnostic is stale: the file is six lines, unchanged, and has no line 8.

## Implementation
1. Add a new forward-only timestamped migration under the fresh-reset track. It will establish only the missing effective Stage 3D state:
   - final authorization-first resident finance function;
   - universal audit update/delete rejection, including the trusted server role;
   - immutable audit trigger;
   - browser INSERT revocation, anonymous SELECT revocation, authenticated scoped SELECT, and canonical server INSERT access.
2. Preserve all historical managed migrations, including `0009`–`0012`, and do not alter either migration history or journal.
3. Extend migration-source tests so both tracks must end in the same effective security contract and future regressions fail closed.
4. Keep fixture cleanup immutable, Stage 3C and Stage 3D runtime jobs independent, Stage 3D at exactly 11 cases, and Stage 3C at exactly 93 cases.
5. Update the roadmap and release evidence with only observed results.

## Verification
Run the requested order: migration/history checks, fixture validator, focused security tests, exact 11/93 contracts, CI/source checks, full non-live tests, TypeScript, production build, client-secret scan, and diff checks. Run fresh reset and live Stage 3D only if a genuinely disposable authorized runtime is available; otherwise retain `implemented_unverified` and report the exact blocker.
