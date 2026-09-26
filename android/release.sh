#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MANIFEST="$ROOT/android/twa-manifest.json"
BUILD_DIR="$ROOT/android/.build"
KEYSTORE="${1:-}"

if [[ -z "$KEYSTORE" || ! -f "$KEYSTORE" ]]; then
  printf '%s\n' "Usage: bash android/release.sh /absolute/path/to/upload-keystore.jks" >&2
  exit 1
fi
if [[ -z "${BUBBLEWRAP_KEYSTORE_PASSWORD:-}" || -z "${BUBBLEWRAP_KEY_PASSWORD:-}" ]]; then
  printf '%s\n' "Set BUBBLEWRAP_KEYSTORE_PASSWORD and BUBBLEWRAP_KEY_PASSWORD via a secure local mechanism." >&2
  exit 1
fi
command -v java >/dev/null || { printf '%s\n' "JDK 17 is required." >&2; exit 1; }
command -v npx >/dev/null || { printf '%s\n' "npx is required." >&2; exit 1; }

rm -rf "$BUILD_DIR"
mkdir -p "$BUILD_DIR"
npx --yes @bubblewrap/cli@1.25.0 update --skipVersionUpgrade --manifest="$MANIFEST" --directory="$BUILD_DIR"
(
  cd "$BUILD_DIR"
  npx --yes @bubblewrap/cli@1.25.0 build \
    --manifest="$MANIFEST" \
    --signingKeyPath="$KEYSTORE" \
    --signingKeyAlias="sociohub"
)

test -s "$BUILD_DIR/app-release-bundle.aab" || {
  printf '%s\n' "Bubblewrap did not produce app-release-bundle.aab." >&2
  exit 1
}
printf '%s\n' "Signed bundle: $BUILD_DIR/app-release-bundle.aab"