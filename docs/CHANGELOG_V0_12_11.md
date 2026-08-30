# Changelog v0.12.11

Repair-only release from exact v0.12.10.

## Fixed

- Propagate background Nano owner invalidation into the exact local
  LanguageModel task through an `AbortSignal`.
- Distinguish authoritative owner rejection from transient heartbeat transport
  failure.
- Preserve owner-invalidated classification even when the transport layer
  prefixes a generic error code before the authoritative owner message.
- Abort stale local Nano inference when its request/claim is no longer active.
- Suppress stale `NANO_DECISION` retry and `NANO_FAILURE` after owner loss.
- Retire a running ordinary Nano request when a newer target foreground
  generation becomes the causal owner.
- Bound ordinary `CONTINUATION_ANALYSIS` to 180 seconds in both sidepanel provider
  execution and the background owner's absolute request deadline. Heartbeats cannot
  extend a continuation beyond that deadline, and a running request that reaches
  the hard deadline is terminally retired rather than requeued as the same request.
- Preserve the global 1,800-second configured wall ceiling for other explicit paths.
- Increase active owner heartbeat cadence from 20 seconds to 10 seconds.
- Show the active per-mode Nano deadline separately from the global wall ceiling in
  Mission Control.
- Add focused owner-liveness and whole-package invariant regressions.

## Unchanged

- No new autonomous capability.
- Session-context baseline acceptance semantics remain unchanged.
- v0.12.10 Autostart target-linking repair remains intact.
- Global Nano wall-timeout configuration remains 1,800 seconds.
- Desktop Chrome behavior remains a separate live acceptance gate.
