# EIC Autonom Agent v0.11.10

- Preserves the v0.11.9 semantic side-band identity policy within side-band mode.
- Fixes the remaining first-boundary false delta: a no-delta local receipt created before the first `CHAT_CONTROL_CONTINUATION` / `PROTOCOL_REPAIR` response now carries a dedicated cross-boundary local-rearm identity and digest.
- Uses the same cross-boundary semantic identity for `LOCAL_STATE_UNCHANGED` wake dedupe, so the first side-band child cannot mint a second wake only because the identity namespace changed.
- Keeps ordinary non-side-band response identity material.
- Keeps owner-controlled `materialControlGeneration`, structured target actor/completion changes, task/init/material-effect anchors, and committed baseline/effect state material.
- Rotates the current-version-only local storage namespace to `v110` so v0.11.9 receipts cannot be silently reused.
- Preserves the v0.11.8 session-init baseline-correction generation fence, v0.11.7 typed Nano JSON completeness, v0.11.6 schema-safe output bounds, and v0.11.5 actor/capability + one-diagnostic/no-repeat controls.
