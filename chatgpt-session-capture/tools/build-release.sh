#!/usr/bin/env bash
# Builds the release ZIP from the extension sources only (no tests or tools).
# Usage: tools/build-release.sh [output-dir]
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="${1:-$ROOT/dist}"
mkdir -p "$OUT"
OUT="$(cd "$OUT" && pwd)"
VERSION="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["version"])' "$ROOT/manifest.json")"
NAME="chatgpt-session-capture-$VERSION"
STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT
mkdir -p "$STAGE/$NAME"
cd "$ROOT"
cp -r manifest.json background.js bridge.js main-hook.js export.js popup.html popup.css popup.js offscreen.html \
  README.md CHANGELOG.md PRIVACY.md BUILD_REPORT.md icons lib "$STAGE/$NAME/"
rm -f "$OUT/$NAME.zip"
(cd "$STAGE" && find "$NAME" -exec touch -t 202610280000 {} + && zip -X -q -r "$OUT/$NAME.zip" "$NAME")
echo "$OUT/$NAME.zip"
(cd "$OUT" && sha256sum "$NAME.zip")
