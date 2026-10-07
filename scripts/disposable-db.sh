#!/usr/bin/env bash
# Disposable verification database helper for CI.
#
#   bash scripts/disposable-db.sh run <phase> -- <command...>
#       Runs a command, keeps a credential-redacted log in diagnostics/<phase>.log,
#       and on failure prints the real underlying error with a failure category:
#       INFRASTRUCTURE, PORT, CONFIGURATION, MIGRATION, READINESS or UNKNOWN.
#   bash scripts/disposable-db.sh ready
#       Waits (bounded) for the local database, REST API and auth service to be
#       healthy and for every assembled migration to be recorded as applied.
#
# Requires DISPOSABLE_WORKDIR (the assembled throwaway Supabase workdir).
# Refuses any non-local target. Never prints keys, secrets or passwords.
set -uo pipefail

DIAG="${DIAGNOSTICS_DIR:-diagnostics}"
mkdir -p "$DIAG"

redact() {
  sed -E \
    -e 's#(postgres(ql)?://)[^@/[:space:]]+@#\1***@#g' \
    -e 's#((key|secret|password|token)[^=:]{0,30}[=:][[:space:]]*)[^[:space:]",]+#\1***#Ig' \
    -e 's#eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}#***#g' \
    -e 's#sb_(secret|publishable)_[A-Za-z0-9_-]+#***#g'
}

annotate() { # category, message
  printf '::error title=Disposable database %s failure::%s\n' "$1" "$2"
  printf '%s\n' "$1" > "$DIAG/failure-category.txt"
}

classify() { # phase, logfile
  local phase="$1" log="$2" category="UNKNOWN" detail=""
  if grep -qiE 'Cannot connect to the Docker daemon|docker: command not found|permission denied while trying to connect to the docker' "$log"; then
    category="INFRASTRUCTURE"; detail="Docker is unavailable on the runner."
  elif grep -qiE 'port is already allocated|address already in use|failed to bind|ports are not available' "$log"; then
    category="PORT"; detail="A required local port is already in use."
  elif grep -qiE 'SQLSTATE|At statement|failed to apply|error running migration|ERROR: ' "$log"; then
    category="MIGRATION"
    local last
    last="$(grep -oE 'Applying migration [^ ]+' "$log" | tail -1 || true)"
    detail="A database migration failed${last:+ (last: ${last#Applying migration })}."
  elif grep -qiE 'unhealthy|health ?check|timed out|deadline exceeded|not ready' "$log"; then
    category="READINESS"; detail="A local service did not become healthy."
  elif grep -qiE 'config\.toml|failed to parse|invalid config|unknown flag|no such file' "$log"; then
    category="CONFIGURATION"; detail="The disposable workdir or CLI configuration is invalid."
  fi
  annotate "$category" "Phase '$phase' failed: $detail See diagnostics/$phase.log."
  echo "----- last 60 lines of $phase (credentials redacted) -----"
  tail -n 60 "$log"
  echo "----- matching error lines -----"
  grep -iE 'error|SQLSTATE|At statement|failed|unhealthy' "$log" | tail -n 25 || true
}

require_workdir() {
  if [ -z "${DISPOSABLE_WORKDIR:-}" ] || [ ! -f "$DISPOSABLE_WORKDIR/supabase/config.toml" ]; then
    annotate "CONFIGURATION" "DISPOSABLE_WORKDIR is not an assembled disposable workdir."
    exit 2
  fi
}

cmd_run() {
  local phase="$1"; shift
  [ "${1:-}" = "--" ] && shift
  require_workdir
  local log="$DIAG/$phase.log"
  echo "Running phase '$phase' (log: $log)"
  set +e
  "$@" 2>&1 | redact | tee "$log"
  local status="${PIPESTATUS[0]}"
  set -u
  if [ "$status" -ne 0 ]; then
    classify "$phase" "$log"
    exit "$status"
  fi
}

status_env() {
  supabase status -o env --workdir "$DISPOSABLE_WORKDIR" 2>/dev/null \
    | sed -n -E "s/^([A-Z_]+)=\"?([^\"]*)\"?$/\1=\2/p"
}

cmd_ready() {
  require_workdir
  local env_text api db anon
  env_text="$(status_env)"
  api="$(printf '%s\n' "$env_text" | sed -n 's/^API_URL=//p')"
  db="$(printf '%s\n' "$env_text" | sed -n 's/^DB_URL=//p')"
  anon="$(printf '%s\n' "$env_text" | sed -n 's/^ANON_KEY=//p')"
  if [ -z "$api" ] || [ -z "$db" ] || [ -z "$anon" ]; then
    annotate "CONFIGURATION" "supabase status did not report API_URL, DB_URL and ANON_KEY."
    exit 1
  fi
  [ -n "${GITHUB_ACTIONS:-}" ] && printf '::add-mask::%s\n' "$anon"
  case "$api" in http://127.0.0.1:*|http://localhost:*) ;; *)
    annotate "CONFIGURATION" "Refusing: API URL is not local."; exit 1 ;; esac
  case "$db" in postgres*://*@127.0.0.1:*|postgres*://*@localhost:*) ;; *)
    annotate "CONFIGURATION" "Refusing: database URL is not local."; exit 1 ;; esac
  if ! command -v psql >/dev/null 2>&1; then
    annotate "CONFIGURATION" "psql is required for the readiness check."; exit 1
  fi

  local expected applied="" ok=0
  expected="$(find "$DISPOSABLE_WORKDIR/supabase/migrations" -name '*.sql' | wc -l | tr -d ' ')"
  for _ in $(seq 1 60); do
    if psql "$db" -XAtq -c 'select 1' >/dev/null 2>&1 \
      && curl -fsS -o /dev/null -H "apikey: $anon" "$api/rest/v1/" \
      && curl -fsS -o /dev/null -H "apikey: $anon" "$api/auth/v1/health"; then
      applied="$(psql "$db" -XAtq -c 'select count(*) from supabase_migrations.schema_migrations' 2>/dev/null || true)"
      if [ "$applied" = "$expected" ]; then ok=1; break; fi
    fi
    sleep 2
  done
  if [ "$ok" -ne 1 ]; then
    if [ -n "$applied" ] && [ "$applied" != "$expected" ]; then
      annotate "MIGRATION" "Only ${applied} of ${expected} assembled migrations are recorded as applied."
    else
      annotate "READINESS" "Database, REST API or auth service was not healthy within 120 seconds."
    fi
    exit 1
  fi
  echo "Disposable database ready: ${applied}/${expected} migrations applied; database, REST API and auth healthy."
}

case "${1:-}" in
  run) shift; [ $# -ge 2 ] || { echo "usage: disposable-db.sh run <phase> -- <command...>" >&2; exit 2; }; cmd_run "$@" ;;
  ready) cmd_ready ;;
  *) echo "usage: disposable-db.sh run <phase> -- <command...> | ready" >&2; exit 2 ;;
esac
