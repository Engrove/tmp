# EIC Autonom Agent v0.10.6 — Changelog

## Status

Source/package candidate. Desktop Chrome runtime acceptance is not claimed by this document.

## Fixed

- Continuity now projects the active run, target project, turn index, work unit, next direction and acknowledged turn evidence before sealing.
- Window-scoped continuity backup now advances to the last valid semantic state and is verified by storage readback.
- Nano heartbeat telemetry now synchronizes the current claim lease; terminal paths clear stale busy state and publish current decision status.
- Partial Nano-host updates preserve prior fields and cannot report `cloneUsed=true` with `cloneSupported=false`.
- Watchdog alarm installation is self-healing when the configured period changes.
- Automatic capture defers while mission Nano owns the local model.
- Capture identity no longer depends on virtualized assistant counts or document epochs.
- Full and delta captures are cumulative and monotonic for the same conversation/task; a smaller virtualized DOM view cannot replace a larger known capture.
- Stable turn identity uses the source message ID when available and ignores ordinal movement and known UI controls.
- Target project binding is separate from the extension control project and records explicit mismatch.
- Automatic core-surface review is deferred while a mission or Nano request is active.
- Mission projection now carries current step, next action, risk and execution status from the active run.
- Strong completion claims require matching owner-receipt evidence; an empty claim result is no longer represented as verified.
- Prompt acknowledgement uses mutation-driven observation, visibility/timing diagnostics and a bounded hidden-tab window.
- v0.10.5 source-anchor tests fail explicitly when either anchor is absent.
- The unused runtime `PORTS` contract was removed.

## Added

- Optional full audit sink for an operator-selected existing Windows `C:\temp` directory. It is OFF by default, redacted, NDJSON, bounded, rotated and fail-soft.
- Explicit `M2_MANDATE` for registered Mjölnar D2 actions. It carries operator-equivalent authority level `9.9999` for the exact bounded action while keeping level 10 and actual `OPERATOR_APPROVAL` separate.
- Nano discrimination telemetry that records whether the model accepted or materially changed target `EIC_NEXT`; it never claims independent planning merely because a model inference occurred.
- Continuity write/readback receipts and audit queue status.
- v0.10.6 focused regression fixtures.

## Preserved

- v0.10.5 config/runtime v13 round-trip.
- Two-click D1/D2 user-activation transaction.
- Immediate activation rejection handling.
- Exact linked-tab/controller readback before mission start.
- Forward-only current-version policy.
