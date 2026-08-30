# v0.12.8

## Live incident

Two concurrently running v0.12.7 Agents completed bootstrap/Nano reasoning and then stopped
immediately after their first ordinary post-READY Nano decision. Both full-audit traces recorded:

`ReferenceError: shouldSuppressRepeatedLocalStateRead is not defined`

from `applyNanoDecisionCommandUnlocked()` in `background.js`.

## Root cause

v0.12.6 introduced `shouldSuppressRepeatedLocalStateRead()` as an exported helper in
`lib/execution-routing.mjs` and added five call sites in `background.js`, but the named
import was omitted. v0.12.7 inherited the defect unchanged because that release only repaired
the Nano output-budget startup crash.

This is a module-binding/integration defect. It is distinct from Nano semantic quality,
response ownership, policy fencing, and the v0.12.7 schema-capacity startup issue.

## Fix

- Import `shouldSuppressRepeatedLocalStateRead` from `lib/execution-routing.mjs`.
- Keep all five call sites and the v0.12.6 no-delta local-read suppression semantics intact.
- Add a focused regression that proves the helper is exported, imported, referenced at all
  expected call sites, and behaves correctly on live-shaped suppression/non-suppression states.
- Replay the supplied multi-window audit signature and require the two failed windows to map
  to this exact ReferenceError while the third window remains free of that failure.

## Claim boundary

Source/package regression only until exact-package Desktop Chrome live acceptance.
