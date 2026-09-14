#!/usr/bin/env bash

set -euo pipefail

if ! command -v supabase >/dev/null 2>&1; then
  printf '%s\n' "Fresh migration verification requires the Supabase CLI." >&2
  exit 127
fi

# The caller owns the disposable local lifecycle. This command only applies
# the complete checked-in migration chain and never accepts a hosted target.
supabase db reset --no-seed