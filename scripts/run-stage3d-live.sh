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
live_status=0
bunx vitest run tests/integration/accounting-stage3d-live.test.ts \
  --reporter=default --reporter=json --outputFile="$report" || live_status=$?

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