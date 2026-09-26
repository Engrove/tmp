# Verification provenance for v1.8.8

`v188-*` files are the checks performed for this local release.
The full Node suite returned 642 passed, zero failed/skipped, exit 0.
The pre-fix regression contains 12 deliberate failures on v1.8.7, not failed
release tests. The two new files cover 20 cases across four functional defects
and the preserved boundaries.

The browser attempt was blocked before assertions; no new Chromium/live Chrome
pass is claimed. Other files in this directory are retained historical outputs
for the versions in their filenames. `upstream-v187-build-verification.json`
is the supplied historical build record, not independent evidence from this run.
See root BUILD_VERIFICATION.json and the version-bound risk analysis.
