# v0.11.11 Architecture — one-shot local bridge diagnostic

## Live evidence gap

v0.11.10 proved that the first cross-boundary local-rearm child can legitimately re-arm when a structured target-control field such as `completionState` changes. The existing EIC-AA diagnostics contract exposed only `diagnostics.nanoFailure`, so the local Agent-owned fields needed to distinguish expected structured rearm from a bridge/runtime defect could not be transported to the connected EIC session. Repeating `READ_LOCAL_SESSION_STATE` could not close that gap.

## Repair

v0.11.11 adds a second typed diagnostics branch, `diagnostics.localState`.

`buildLocalStateBridgeDiagnostic()` emits only bounded fields already owned by the local controller:

- prior/current local receipt: `sourceTurnKind`, `sourceLocalRearmObservationKey`, `localRearmMaterialDigest`, `rearmFamily`, `rearmReason`, `rearmAllowed`;
- parsed target-control class: `valid`, `status`, `nextActor`, `completionState`, `fullStopReason`;
- `materialControlGeneration`;
- session-init `needKey`, `state`, `catchResponseIdentity`;
- latest non-side-band material-effect turn/status;
- prior chat-control receipt wake key/generation/status and the candidate wake key/generation.

Prompt bodies, free-form EIC reasoning, credentials, provider output, hidden reasoning and arbitrary source content are excluded.

## One-shot contract

`localStateDiagnosticKeyInput()` derives the diagnostic generation from bridge material, structured target class, material-control generation and init/material-effect anchors. Candidate wake generation, prior wake lifecycle status and timestamps are excluded because they are effects of transport, not material program state.

`shouldEmitLocalStateDiagnostic()` allows exactly one diagnostic per generation. The background controller persists `eic.autonom.local-state-diagnostic-receipt.v1`. If the same generation is observed again, no new `CHAT_CONTROL_CONTINUATION` is created solely to reproduce the diagnostic.

## Non-rearming observability

The diagnostic is attached only after local rearm evaluation has already returned `LOCAL_STATE_UNCHANGED`. No diagnostic field participates in observation/material/rearm/wake identity. The outgoing EIC-AA requested action explicitly labels the payload as local observability, not target material.

The existing v0.11.10 bridge semantics remain unchanged:

- the first equivalent non-side-band → side-band child can be bridged;
- structured target actor/completion changes remain material;
- side-band → side-band substantive target changes can re-arm;
- ordinary non-side-band response identity remains material.

## Turn contract

`normalizeTurnDiagnostics()` and `validateTurnObject()` now support exactly one typed diagnostic kind per turn:

- `diagnostics.nanoFailure`; or
- `diagnostics.localState`.

A turn containing both kinds is rejected as `TURN_DIAGNOSTICS_INVALID`.

## Forward-only state

The local storage namespace rotates from `v110` to `v111`. No v0.11.10 runtime/local diagnostic state is imported as current v0.11.11 state.

## Claim boundary

This change closes the protocol observability gap in source/package form. It does not by itself prove the unresolved v0.11.10 live bridge behavior, exact installed-byte identity, or Desktop Chrome acceptance.
