#!/usr/bin/env bash
# Runs every check for the extension in this directory:
#   1. syntax check of every shipped script (node --check)
#   2. ESLint (tools/lint.sh)
#   3. Node unit tests (sanitizer, turn merge, verdict logic, ZIP writer)
#   4. DOM extraction tests in Chromium
#   5. End-to-end scenarios with the unpacked extension in Chromium
# Requirements: Node 22+, Python 3, Playwright with Chromium. Set
# PLAYWRIGHT_MODULE to Playwright's module path if it is not resolvable.
# Usage: tests/run-all.sh [unpacked-extension-dir]
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
EXT="${1:-$ROOT}"
cd "$ROOT"
echo "== node --check"
for file in "$EXT"/*.js "$EXT"/lib/*.js; do node --check "$file"; done
echo "== eslint"
if command -v eslint >/dev/null; then (cd "$EXT" && ESLINT_USE_FLAT_CONFIG=true eslint --no-config-lookup --config "$ROOT/tools/eslint.config.cjs" ./*.js lib/*.js); else echo "eslint not installed; skipped"; fi
echo "== unit tests"
node --test tests/unit/*.test.cjs
echo "== DOM extraction tests"
node tests/browser/capture-core.cjs "$EXT"
echo "== end-to-end scenarios"
node tests/browser/e2e.cjs "$EXT"
