#!/usr/bin/env bash
# Lints the shipped extension sources with the repository's ESLint rules.
set -euo pipefail
cd "$(dirname "$0")/.."
ESLINT_USE_FLAT_CONFIG=true eslint --no-config-lookup --config tools/eslint.config.cjs ./*.js lib/*.js
