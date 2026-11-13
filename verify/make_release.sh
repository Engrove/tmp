#!/usr/bin/env bash
# Builds a release that can be identified unambiguously (review F27):
#   * only from a CLEAN, committed tree (the commit is embedded in the exe's informational
#     version by the SDK; a dirty tree would make the exe and its source disagree);
#   * runs the full proof chain (verify/run_all.sh) first;
#   * writes RELEASE-MANIFEST.json (version, file version, commit, SDK, build time, SHA-256 of
#     every shipped file, test results) — Install-PresenceLock.ps1 verifies against it;
#   * packages the GPO zip with SHA256SUMS.txt.
# Usage: verify/make_release.sh <output-dir>
set -euo pipefail
cd "$(dirname "$0")/.."
OUT="${1:?usage: make_release.sh <output-dir>}"
export DOTNET_CLI_TELEMETRY_OPTOUT=1 DOTNET_NOLOGO=1

if [ -n "$(git status --porcelain)" ]; then
  echo "refusing: working tree not clean (commit first, so the exe and its source agree)"; git status --short; exit 1
fi
COMMIT=$(git rev-parse HEAD)
VERSION=$(sed -n 's:.*<Version>\(.*\)</Version>.*:\1:p' src/PresenceLock.App/PresenceLock.App.csproj)
FILEVERSION="$VERSION.0"

LOG=$(mktemp)
./verify/run_all.sh | tee "$LOG"
PY=$(grep -oE '[0-9]+/[0-9]+ checks passed' "$LOG" | head -1)
CS=$(grep -oE 'Passed: +[0-9]+, Skipped: +[0-9]+, Total: +[0-9]+' "$LOG" | head -1)
rm -f "$LOG"

BIN=src/PresenceLock.App/bin/Release/net48
# The version RESOURCE (UTF-16), i.e. the ProductVersion Windows shows in the file's properties.
EMBEDDED=$(strings -el "$BIN/PresenceLock.exe" | grep -oE "^$VERSION\+[0-9a-f]{40}$" | head -1 || true)
if [ "$EMBEDDED" != "$VERSION+$COMMIT" ]; then
  echo "refusing: exe informational version '$EMBEDDED' is not '$VERSION+$COMMIT'"; exit 1
fi

PKG=$(mktemp -d)
mkdir -p "$PKG/PresenceLock" "$PKG/PolicyDefinitions/en-US" "$PKG/PolicyDefinitions/sv-SE" "$PKG/Dokumentation"
cp "$BIN/PresenceLock.exe" "$BIN/PresenceLock.exe.config" deploy/Install-PresenceLock.ps1 deploy/Uninstall-PresenceLock.ps1 deploy/PresenceLock-LogonTask.xml "$PKG/PresenceLock/"
cp deploy/PresenceLock.admx "$PKG/PolicyDefinitions/"; cp deploy/en-US/PresenceLock.adml "$PKG/PolicyDefinitions/en-US/"; cp deploy/sv-SE/PresenceLock.adml "$PKG/PolicyDefinitions/sv-SE/"
cp README.md "$PKG/"
for f in docs/compliance/*.md docs/review/*.md; do [ -f "$f" ] && cp "$f" "$PKG/Dokumentation/"; done
if command -v pandoc >/dev/null; then for f in "$PKG"/Dokumentation/*.md; do pandoc "$f" -o "${f%.md}.docx"; done; fi

EXE_SHA=$(sha256sum "$PKG/PresenceLock/PresenceLock.exe" | cut -d' ' -f1 | tr a-f A-F)
CFG_SHA=$(sha256sum "$PKG/PresenceLock/PresenceLock.exe.config" | cut -d' ' -f1 | tr a-f A-F)
cat > "$PKG/PresenceLock/RELEASE-MANIFEST.json" <<JSON
{
  "product": "PresenceLock",
  "version": "$VERSION",
  "fileVersion": "$FILEVERSION",
  "commit": "$COMMIT",
  "sdk": "$(dotnet --version)",
  "builtUtc": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "files": { "PresenceLock.exe": "$EXE_SHA", "PresenceLock.exe.config": "$CFG_SHA" },
  "verification": { "python": "$PY", "csharp": "$CS", "windowsAcceptance": "NOT RUN (see README, Windows acceptance W01-W18)" }
}
JSON
(cd "$PKG" && find . -type f ! -name SHA256SUMS.txt | sort | sed 's|^\./||' | xargs -d '\n' sha256sum > SHA256SUMS.txt)
mkdir -p "$OUT"
ZIP="$OUT/PresenceLock-$VERSION-gpo-package.zip"
rm -f "$ZIP"
(cd "$PKG" && zip -qr "$ZIP" .)
rm -rf "$PKG"
echo "release $VERSION ($COMMIT) -> $ZIP"
