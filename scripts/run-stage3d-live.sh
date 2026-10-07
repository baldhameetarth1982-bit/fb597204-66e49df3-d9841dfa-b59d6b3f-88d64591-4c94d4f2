#!/usr/bin/env bash
set -euo pipefail

if [ "${ALLOW_SOCIOHUB_LIVE_STAGE3D:-}" != "true" ]; then
  printf '%s\n' "Stage 3D live verification requires ALLOW_SOCIOHUB_LIVE_STAGE3D=true." >&2
  exit 1
fi

for name in SOCIOHUB_TEST_SUPABASE_URL SOCIOHUB_TEST_SUPABASE_SERVICE_ROLE_KEY SOCIOHUB_TEST_SUPABASE_PUBLISHABLE_KEY SOCIOHUB_TEST_DATABASE_URL; do
  if [ -z "${!name:-}" ]; then
    printf 'Stage 3D live verification requires %s.\n' "$name" >&2
    exit 1
  fi
done

case "$SOCIOHUB_TEST_SUPABASE_URL" in
  http://127.0.0.1:*|http://localhost:*|http://host.docker.internal:*|http://kong:*|http://supabase_kong:*|http://supabase-kong:*) ;;
  *)
    printf '%s\n' "Stage 3D refuses to run against a non-disposable database URL." >&2
    exit 1
    ;;
esac

if [ -n "${SUPABASE_URL:-}" ] && [ "$SUPABASE_URL" = "$SOCIOHUB_TEST_SUPABASE_URL" ]; then
  printf '%s\n' "Stage 3D refuses to run because the test URL matches SUPABASE_URL." >&2
  exit 1
fi

case "$SOCIOHUB_TEST_DATABASE_URL" in
  postgres://*@127.0.0.1:*/*|postgresql://*@127.0.0.1:*/*|postgres://*@localhost:*/*|postgresql://*@localhost:*/*) ;;
  *)
    printf '%s\n' "Stage 3D refuses to run against a non-disposable PostgreSQL URL." >&2
    exit 1
    ;;
esac

if [ -n "${DATABASE_URL:-}" ] && [ "$DATABASE_URL" = "$SOCIOHUB_TEST_DATABASE_URL" ]; then
  printf '%s\n' "Stage 3D refuses to run because the test database URL matches DATABASE_URL." >&2
  exit 1
fi

mkdir -p reports
report="reports/stage3d-live.json"
meta="reports/stage3d-live.meta.json"
actual_sha="$(git rev-parse HEAD)"
expected_sha="${EXPECTED_COMMIT_SHA:-}"
if ! printf '%s' "$expected_sha" | grep -Eq '^[0-9a-fA-F]{40}$'; then
  printf '%s\n' "Stage 3D requires a canonical full expected commit SHA." >&2
  exit 1
fi
if [ "${actual_sha,,}" != "${expected_sha,,}" ]; then
  printf '%s\n' "Stage 3D checked-out commit does not match the expected commit." >&2
  exit 1
fi
rm -f "$report" "$meta"
printf '{"commit":"%s"}\n' "$actual_sha" > "$meta"
started_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
live_status=0
bunx vitest run tests/integration/accounting-stage3d-live.test.ts \
  --reporter=default --reporter=json --outputFile="$report" || live_status=$?

# Record the run context next to the commit binding. Hosts only, never keys.
STAGE3D_META_STARTED_AT="$started_at" STAGE3D_META_LIVE_STATUS="$live_status" \
STAGE3D_META_COMMIT="$actual_sha" node - "$report" "$meta" <<'NODE'
const fs = require("fs");
const [reportPath, metaPath] = process.argv.slice(2);
const host = (value) => { try { return new URL(value).hostname; } catch { return null; } };
let counts = null;
try {
  const r = JSON.parse(fs.readFileSync(reportPath, "utf8"));
  counts = {
    suites: r.numTotalTestSuites, tests: r.numTotalTests, passed: r.numPassedTests,
    failed: r.numFailedTests, pending: r.numPendingTests, todo: r.numTodoTests, success: r.success,
  };
} catch { counts = null; }
const env = process.env;
fs.writeFileSync(metaPath, JSON.stringify({
  commit: env.STAGE3D_META_COMMIT,
  workflow: env.GITHUB_WORKFLOW ?? null,
  run_id: env.GITHUB_RUN_ID ?? null,
  run_attempt: env.GITHUB_RUN_ATTEMPT ?? null,
  ref: env.GITHUB_REF ?? null,
  started_at: env.STAGE3D_META_STARTED_AT,
  finished_at: new Date().toISOString(),
  isolated_environment: {
    api_host: host(env.SOCIOHUB_TEST_SUPABASE_URL),
    database_host: host(env.SOCIOHUB_TEST_DATABASE_URL),
    disposable: true,
  },
  fixture_safety_result: env.STAGE3D_FIXTURE_SAFETY_RESULT ?? "not_reported",
  focused_contract_result: env.STAGE3D_FOCUSED_CONTRACT_RESULT ?? "not_reported",
  live_accounting_result: Number(env.STAGE3D_META_LIVE_STATUS) === 0 ? "passed" : "failed",
  live_counts: counts,
}, null, 2) + "\n");
NODE

report_status=0
if [ ! -s "$report" ]; then
  printf '%s\n' "Stage 3D live report is missing or empty." >&2
  report_status=1
else
  bun scripts/verify-stage3d-live-report.ts "$report" \
    --expected-sha="$expected_sha" --meta="$meta" || report_status=$?
fi

if [ "$live_status" -ne 0 ]; then
  exit "$live_status"
fi
exit "$report_status"