#!/usr/bin/env bash
# Runs one rollback-only SQL harness (tests/sql/*.sql) against a DISPOSABLE
# local database and fails unless it reports fail=0 with at least MIN passes.
#
# Usage: HARNESS_DB_URL=postgresql://...@127.0.0.1:54322/postgres \
#          scripts/run-sql-harness.sh <sql-file> <RESULT_PREFIX> <min-pass>
set -euo pipefail

FILE="${1:?sql file}"; PREFIX="${2:?result prefix}"; MIN_PASS="${3:?min pass}"
: "${HARNESS_DB_URL:?Set HARNESS_DB_URL to a disposable local database}"
case "$HARNESS_DB_URL" in
  *@127.0.0.1:*|*@localhost:*) ;;
  *) echo "Refusing: HARNESS_DB_URL must point at 127.0.0.1/localhost." >&2; exit 2 ;;
esac

OUT="$(psql "$HARNESS_DB_URL" -v ON_ERROR_STOP=0 -q -f "$FILE" 2>&1 || true)"
LINE="$(printf '%s\n' "$OUT" | grep -o "${PREFIX}|[^\"]*" | head -1 || true)"
if [ -z "$LINE" ]; then
  echo "Harness $FILE did not report a result:" >&2
  printf '%s\n' "$OUT" | tail -n 40 >&2
  exit 1
fi
echo "$LINE"
PASSED="$(printf '%s\n' "$LINE" | sed -n 's/.*|pass=\([0-9][0-9]*\)|.*/\1/p')"
if [ -z "$PASSED" ] || [ "$PASSED" -lt "$MIN_PASS" ]; then
  echo "Refusing: only ${PASSED:-0} checks passed (expected at least $MIN_PASS)." >&2
  exit 1
fi
case "$LINE" in *"|fail=0|OK"*) exit 0 ;; *) exit 1 ;; esac
