# Wire trace — Greenfield v1.2.0 global prompt pause

## Producer

`sidepanel.js` -> `operator-settings.mjs` persists `postDelaySeconds` (0..90) in
`chrome.storage.local`.

## Reservation

`background.js:buildPendingA2A()` snapshots the configured delay into the pending prompt.
`tickSending()` calls `reserveGlobalPromptSlot()` once before the first dispatch attempt. The
extension-wide record stores a monotonic reservation sequence and `nextPromptNotBeforeAtMs`.

## Wait/readback

The pending process stores `promptPause.reservationId/reservationSeq/notBeforeAtMs`. `publicSnapshot`
projects this bounded state to the side panel, whose status rail renders **Prompt pause** and a
second-by-second countdown.

## Pre-effect gate

After the page is idle and the dispatch fence allows an effect, `claimGlobalPromptSend()` checks:

1. the process reservation time;
2. `lastPromptPostedAtMs + delay`;
3. any active cross-window send lease.

If the actual spacing floor moved later, the pending prompt is persisted with the extended
`notBeforeAtMs` and waits again.

## Effect commit

A successful/effect-possible content send calls `commitGlobalPromptPost()`. If callback state is
uncertain, exact-once reconciliation remains authoritative; a later `WAIT_NO_RESEND` or
`ALREADY_MATERIALIZED` fence also commits the global post timestamp. Confirmed no-effect paths
release the lease.

## Scope

One installed extension instance / Chrome profile. No cross-profile synchronization claim.
