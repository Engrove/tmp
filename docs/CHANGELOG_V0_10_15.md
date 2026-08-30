# EIC Autonom Agent v0.10.15

## P0 — UI contract parity for baseline Nano evidence

v0.10.14 produced a real baseline Nano result but `createUiCommand()` rejected
`NANO_DECISION.baselineAnalysis` before the message reached background. The
failure path then attempted `NANO_FAILURE.forensics`, which was rejected by the
same allowlist and swallowed.

v0.10.15 adds the two fields to the owner command contract with bounded typed
validation, preserves fail-closed handling for unknown keys, adds an end-to-end
UI-runtime -> UI-contract -> background baseline-decision test, and adds a
90-second heartbeat stale guard for already-claimed baseline requests. The
90-second guard is not an inference timeout: active local inference refreshes
the heartbeat every 20 seconds.

A secondary terminal-receipt transport failure now attempts a bounded
`ADD_AUDIT` diagnostic instead of disappearing silently.

No installed Desktop Chrome PASS is claimed by this release artifact.
