#!/usr/bin/env bash
# Assemble the canonical migration track for a DISPOSABLE verification database.
#
# The hosted database was built from two checked-in histories:
#   1. supabase/migrations/ up to and including CUTOFF (Supabase CLI track), then
#   2. drizzle/migrations/ in drizzle/migrations/meta/_journal.json order.
# supabase/migrations/ files after CUTOFF are mirrors of drizzle migrations and
# were never applied to the hosted track; replaying them before drizzle creates
# duplicate objects. This script writes the correct order into a separate
# throwaway Supabase workdir. It never edits the repository's migration folders
# and never contacts any hosted database.
#
# Usage: bash scripts/assemble-disposable-migration-track.sh <empty-output-dir>
set -euo pipefail

CUTOFF="20260917012306"
# Mirror files after CUTOFF that are intentionally excluded (content lives in drizzle).
KNOWN_MIRRORS=(
  20260917013000 20260917235500 20260917235900 20260918001600 20260918002500
  20260918003000 20260918004000 20260918005000 20260919050000 20260921234600
  20260923223500 20260923225000 20260924000000
)
EXPECTED_SUPABASE_PREFIX_COUNT=150

out="${1:-}"
if [ -z "$out" ]; then
  echo "[config] usage: assemble-disposable-migration-track.sh <output-dir>" >&2
  exit 2
fi
root="$(cd "$(dirname "$0")/.." && pwd)"
case "$(cd "$(dirname "$out")" 2>/dev/null && pwd)/$(basename "$out")" in
  "$root"/supabase*|"$root"/drizzle*)
    echo "[config] refusing to write into the repository's migration folders" >&2
    exit 2 ;;
esac
if [ -e "$out" ] && [ -n "$(ls -A "$out" 2>/dev/null)" ]; then
  echo "[config] output directory must be empty: $out" >&2
  exit 2
fi

mig="$out/supabase/migrations"
mkdir -p "$mig"
printf 'project_id = "sociohub-disposable-verification"\n' > "$out/supabase/config.toml"

# 1. Inert scheduler first, so historical cron registrations never execute.
cp "$root/scripts/disposable-db/inert-scheduler.sql" "$mig/20260101000000_disposable_inert_scheduler.sql"

# 2. Supabase CLI track up to CUTOFF, failing closed on unknown later files.
prefix_count=0
for f in "$root"/supabase/migrations/*.sql; do
  name="$(basename "$f")"
  version="${name%%_*}"
  if [[ ! "$version" =~ ^[0-9]{14}$ ]]; then
    echo "[config] unexpected migration filename: $name" >&2; exit 2
  fi
  if [[ "$version" > "$CUTOFF" ]]; then
    known=0
    for m in "${KNOWN_MIRRORS[@]}"; do [ "$m" = "$version" ] && known=1; done
    if [ "$known" -ne 1 ]; then
      echo "[config] supabase/migrations/$name is after the drizzle cutover and is not a known mirror;" >&2
      echo "[config] new migrations belong in drizzle/migrations. Refusing to guess its order." >&2
      exit 2
    fi
    continue
  fi
  cp "$f" "$mig/$name"
  prefix_count=$((prefix_count + 1))
  # 2b. Replace outbound HTTP right after the migration that installs it.
  if grep -qiE '^CREATE EXTENSION pg_net' "$f"; then
    cp "$root/scripts/disposable-db/inert-network.sql" \
      "$mig/$(printf '%014d' $((10#$version + 1)))_disposable_inert_network.sql"
  fi
done
if [ "$prefix_count" -ne "$EXPECTED_SUPABASE_PREFIX_COUNT" ]; then
  echo "[config] expected $EXPECTED_SUPABASE_PREFIX_COUNT pre-cutover migrations, found $prefix_count" >&2
  exit 2
fi
if ! ls "$mig" | grep -q '_disposable_inert_network\.sql$'; then
  echo "[config] could not place the inert network stand-in" >&2; exit 2
fi

# 3. Drizzle track in journal order, versioned after CUTOFF.
node - "$root" "$mig" <<'NODE'
const fs = require("fs");
const path = require("path");
const [root, mig] = process.argv.slice(2);
const dir = path.join(root, "drizzle", "migrations");
const journal = JSON.parse(fs.readFileSync(path.join(dir, "meta", "_journal.json"), "utf8"));
const tags = journal.entries.map((e) => e.tag);
const files = fs.readdirSync(dir).filter((f) => f.endsWith(".sql")).map((f) => f.slice(0, -4)).sort();
const missing = tags.filter((t) => !files.includes(t));
const extra = files.filter((f) => !tags.includes(f));
if (missing.length || extra.length) {
  console.error(`[config] drizzle journal/files mismatch. missing=${missing.join(",")} extra=${extra.join(",")}`);
  process.exit(2);
}
if (tags.length > 99999) { console.error("[config] too many drizzle migrations"); process.exit(2); }
tags.forEach((tag, i) => {
  const version = `202609180${String(i).padStart(5, "0")}`;
  fs.copyFileSync(path.join(dir, `${tag}.sql`), path.join(mig, `${version}_dz_${tag}.sql`));
});
console.log(`drizzle migrations: ${tags.length}`);
NODE

echo "pre-cutover supabase migrations: $prefix_count"
echo "excluded post-cutover mirrors: ${#KNOWN_MIRRORS[@]}"
echo "assembled track: $(ls "$mig" | wc -l) files in $mig"
