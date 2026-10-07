#!/usr/bin/env bash
# Runs the Phase 4B database security harness against a DISPOSABLE database.
# The harness always rolls back; this script additionally refuses any target
# that is not a local database, so it can never touch shared/production data.
#
# Usage: PHASE4B_DB_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres \
#          scripts/run-phase4b-sql.sh
set -euo pipefail

: "${PHASE4B_DB_URL:?Set PHASE4B_DB_URL to a disposable local database (e.g. supabase start)}"
case "$PHASE4B_DB_URL" in
  *@127.0.0.1:*|*@localhost:*) ;;
  *) echo "Refusing: PHASE4B_DB_URL must point at 127.0.0.1/localhost." >&2; exit 2 ;;
esac

HERE="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$(psql "$PHASE4B_DB_URL" -v ON_ERROR_STOP=0 -q -f "$HERE/tests/sql/phase4b-security-boundaries.sql" 2>&1 || true)"
LINE="$(printf '%s\n' "$OUT" | grep -o 'P4B_RESULT|[^\n]*' | head -1 || true)"
if [ -z "$LINE" ]; then
  echo "Harness did not report a result:" >&2
  printf '%s\n' "$OUT" >&2
  exit 1
fi
echo "$LINE"
case "$LINE" in
  *"|fail=0|OK"*) exit 0 ;;
  *) exit 1 ;;
esac
