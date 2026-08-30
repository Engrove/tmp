# EIC Autonom Agent v0.10.1 — Architecture

v0.10.1 is a forward-only patch release. It does not read or migrate v0.10.0 configuration, runtime, IndexedDB, export or prompt state.

## Canonical target protocol

EIC-AA/5 remains the only current response protocol. Target delivery contains one compact canonical JSON envelope, a short authority boundary and exactly five required final lines. The previous Markdown mirror, HTML markers and pretty-printed duplicate envelope are not delivered.

A mandate may use `REFERENCE` only after an acknowledged prompt effect in the same conversation, task fingerprint and immediately prior turn. `PREPARED` is not delivery evidence.

## Runtime lifecycle

- `autoRestartNanoOnChange` defaults to true.
- Automatic restart is limited to already available, previously canary-verified local model assets.
- The same restart fingerprint is attempted at most once per ten minutes.
- Download, stalled-asset, timeout and external-asset blocker states remain manual and fail closed.
- A RUNNING Nano telemetry record without a pending request is classified as interrupted and the preserved observation is requeued once.

## Session context

- `autoSessionCaptureEnabled` defaults to true.
- A stable linked transcript can be captured without an active mission.
- First capture is full; later unchanged transcript identities are deduplicated and new stable identities use delta capture.
- Capture and memory summaries belong to the window context and may be adopted by a compatible run.
- Manual full/delta capture and purge remain available.

## Current contracts

- App/content: 0.10.1
- Config/runtime: v12
- Export: v19
- EIC response: EIC-AA/5
- Session Capture: v1
- Session Memory: v1
- Operator Action: v1
- Quick Profile: v1
