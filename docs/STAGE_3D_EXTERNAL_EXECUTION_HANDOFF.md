# Stage 3D External Runtime Evidence Handoff

Stage 3D is **source-converged and implemented_unverified**. It remains pending
a fresh disposable reset and an exact 11/0/0 runtime result. This handoff is an
execution procedure, not runtime evidence.

## Required environment

- Docker with a working daemon.
- Supabase CLI `1.219.2`.
- Bun `1.3.3` and Node.js `24`.
- The exact commit under review checked out with no source changes.
- No production database credentials and no protected-society identifier.

The executor must receive the expected full commit SHA externally. It must be
exactly 40 hexadecimal characters; never derive a missing expected SHA from the
checkout and never reuse evidence from another commit.

## Disposable execution

Run from the repository root in an authorized isolated environment:

```bash
set -euo pipefail

export EXPECTED_COMMIT_SHA="<externally-supplied-40-character-commit-sha>"
test "$(git rev-parse HEAD)" = "$EXPECTED_COMMIT_SHA"

bun install --frozen-lockfile
bun scripts/verify-stage3c-fixture-source.ts

supabase start --debug
trap 'supabase stop --no-backup' EXIT
supabase db reset --no-seed

supabase status -o env > .stage3d-supabase.env
set -a
. ./.stage3d-supabase.env
set +a
rm -f .stage3d-supabase.env

case "$API_URL" in
  http://127.0.0.1:*|http://localhost:*) ;;
  *) echo "Refusing non-local Stage 3D database URL" >&2; exit 1 ;;
esac

export SOCIOHUB_TEST_SUPABASE_URL="$API_URL"
export SOCIOHUB_TEST_SUPABASE_SERVICE_ROLE_KEY="$SERVICE_ROLE_KEY"
export SOCIOHUB_TEST_SUPABASE_PUBLISHABLE_KEY="$ANON_KEY"
export SOCIOHUB_TEST_DATABASE_URL="$DB_URL"
export ALLOW_SOCIOHUB_LIVE_STAGE3D=true

bun run test:stage3d:live
bun scripts/verify-stage3d-live-report.ts reports/stage3d-live.json \
  --expected-sha="$EXPECTED_COMMIT_SHA" \
  --meta=reports/stage3d-live.meta.json
```

The reset must replay the checked-in `supabase/migrations/` track. Fixtures must
use generated synthetic societies only. Audit history must remain immutable;
destroying the disposable database is the cleanup boundary.

## Required evidence

Preserve both generated files together as the `stage3d-reports` artifact:

- `reports/stage3d-live.json`
- `reports/stage3d-live.meta.json`

The validator must accept exactly:

- 1 passed suite and 0 failed or pending suites;
- 11 passed tests;
- 0 failed, skipped/pending, or todo tests;
- no setup or teardown failure;
- metadata containing the exact externally supplied full commit SHA.

The runtime cases must exercise the actual database behavior, including audit
immutability and TRUNCATE denial, canonical income transitions, authorization,
cross-society isolation, resident finance boundaries, block-administrator
exclusion, and financial state integrity.

## Fail-closed policy

Stage 3D remains `implemented_unverified` when any of these occurs:

- Docker or the Supabase CLI is unavailable;
- fixture-source validation or migration reset fails;
- the target is not disposable and local;
- the expected SHA is missing, malformed, or differs from the checkout/report;
- a report or metadata file is missing or stale;
- the result differs from exact 11 passed / 0 failed / 0 skipped;
- setup, teardown, report validation, or database destruction fails;
- any protected-society access is attempted.

Static tests, source inspection, and this handoff do not close the runtime gate.
Stage 3E must not start until genuine evidence passes every condition above.