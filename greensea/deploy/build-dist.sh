#!/usr/bin/env bash
# Build dist/GreenSea_v<version>.zip and .sha256 from the COMMITTED greensea/ tree.
#   bash greensea/deploy/build-dist.sh
# git archive takes file times from the commit, so the same commit always gives
# the same zip (and checksum). Uncommitted changes are refused.
set -euo pipefail

ROOT="$(git -C "$(dirname "$0")" rev-parse --show-toplevel)"
cd "$ROOT"
if [[ -n "$(git status --porcelain -- greensea)" ]]; then
  echo "greensea/ has uncommitted or untracked changes; commit them first" >&2
  git status --short -- greensea >&2
  exit 1
fi
VER="$(python3 -c 'import tomllib; print(tomllib.load(open("greensea/pyproject.toml", "rb"))["project"]["version"])')"
APP="$(python3 -c 'import re; print(re.search(r"APP_VERSION = \"([^\"]+)\"", open("greensea/greensea/__init__.py").read()).group(1))')"
if [[ "$VER" != "$APP" ]]; then
  echo "version mismatch: pyproject.toml $VER, greensea/__init__.py $APP" >&2
  exit 1
fi
NAME="GreenSea_v$VER.zip"
mkdir -p dist
git archive --format=zip --prefix="greensea-$VER/" -o "dist/$NAME" HEAD:greensea
(cd dist && sha256sum "$NAME" > "$NAME.sha256")
echo "built dist/$NAME from $(git rev-parse --short HEAD)"
cat "dist/$NAME.sha256"
