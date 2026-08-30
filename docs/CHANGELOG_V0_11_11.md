# EIC Autonom Agent v0.11.11

- Preserves the v0.11.10 one-way cross-boundary local-rearm bridge and its structured target-control materiality rules.
- Adds a typed bounded `diagnostics.localState` payload to EIC-AA/5 `CHAT_CONTROL_CONTINUATION`.
- The local-state diagnostic carries only the minimum Agent-owned bridge evidence needed to distinguish expected structured target rearm from a runtime bridge defect: prior/current local receipt bridge fields, parsed structured target result, material-control generation, session-init identity, latest material effect and chat-control wake receipt.
- Adds a dedicated diagnostic generation key and one-shot receipt so the same unchanged generation cannot emit another local-state diagnostic wake.
- The diagnostic payload is observability-only: it is not part of `observationMaterialKey`, `materialDecisionInputKey`, `localRearmObservationKey`, `localRearmMaterialKey` or `chatControlWakeKeyInput`.
- Preserves the existing `diagnostics.nanoFailure` schema and rejects ambiguous turns carrying both diagnostic kinds.
- Rotates the current-version-only local storage namespace to `v111` so v0.11.10 diagnostic-less runtime receipts cannot be imported as current v0.11.11 state.
- Preserves the v0.11.8 session-init baseline-correction fence, v0.11.7 typed Nano JSON completeness, v0.11.6 schema-safe output bounds and v0.11.5 actor/capability topology.
