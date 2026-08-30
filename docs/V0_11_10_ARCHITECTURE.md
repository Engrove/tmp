# v0.11.10 Architecture — cross-boundary local-rearm bridge

## Live defect

v0.11.9 made side-band observations semantic, but a local no-delta receipt is written *before* the first side-band wake. That receipt stored the ordinary raw response identity/material digest. When the EIC reply arrived, `currentTurn.kind` became `CHAT_CONTROL_CONTINUATION` or `PROTOCOL_REPAIR`, so the next equivalent local read was represented in the side-band semantic namespace. The raw → semantic namespace migration itself produced `MATERIAL_DELTA` once and allowed a second `LOCAL_STATE_UNCHANGED` wake.

## Repair

v0.11.10 adds a dedicated local-rearm bridge alongside the ordinary observation/material identities.

- `localRearmObservationKey()` is stable across the non-side-band → first-side-band boundary.
- `localRearmMaterialKey()` binds the bridge to run/task/init/material-effect anchor, owner-controlled `materialControlGeneration`, structured target control class, committed baseline state, session-init state and material effect state.
- Local microstep receipts persist both ordinary identity/digest and bridge identity/digest.
- `evaluateLocalNanoRearm()` uses the bridge only when the *current* turn is side-band and the same local rearm family and bridge state are exact. Ordinary non-side-band response identity semantics remain unchanged.
- `chatControlWakeKeyInput()` uses the bridge identity/digest for `LOCAL_STATE_UNCHANGED`, making the original wake and its equivalent first side-band child share one wake identity.

Free-form `EIC_NEXT` wording is not used as a bridge discriminator. Structured executor/completion changes remain material, and a different execution plan is resolved before local rearm gating.

## Forward-only state

The local storage namespace rotates from `v109` to `v110`. No v0.11.9 runtime/local receipt is imported as current v0.11.10 state.

## Preserved controls

- v0.11.9 side-band-to-side-band response identity stability;
- v0.11.8 baseline-correction fence;
- v0.11.7 `NANO_INCOMPLETE_JSON`;
- v0.11.6 6,000-soft/schema-hard output policy;
- v0.11.5 actor/capability topology;
- one terminal Nano diagnostic per failure generation and same-generation suppression.
