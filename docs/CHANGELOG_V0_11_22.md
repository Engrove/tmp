# Changelog v0.11.22

v0.11.22 closes the v0.11.21 post-READY protocol-repair/chat-control loop and upgrades ordinary
Nano continuation from telemetry-only discrimination to an enforced bounded deliberation contract.

## Live incident

The supplied v0.11.21 transcript/export reached session initialization `READY`, but post-READY
continuation entered alternating `PROTOCOL_REPAIR` and `CHAT_CONTROL_CONTINUATION` generations until
the operator stopped the run.

Two concrete causes compose the loop:

1. The rendered semantic assistant text could begin with ChatGPT presentation chrome such as
   `EIC sade:`. An otherwise exact five-line EIC-AA/5 trailer was therefore parsed as
   `PROTOCOL_TRAILER_NOT_EXACT`.
2. v0.11.21 routed every response to a `PROTOCOL_REPAIR` turn into ordinary Nano before checking
   whether the repaired protocol was valid. Nano could then turn a transport-only failure into
   `READ_LOCAL_SESSION_STATE` / `WAIT_OWNER_EVENT`, which generated a chat-control turn whose
   response could be repaired again.

The same exported Session Memory also demonstrates a presentation variant where a speaker label and
completed reasoning disclosure are concatenated with the final answer:
`EIC sade:Arbetade i 2m 54s...`.

## Changes

1. **Canonical assistant presentation cleanup.**
   Known assistant speaker labels (`EIC sade:`, `ChatGPT sade:`, English equivalents) and one
   leading completed reasoning-duration disclosure are removed before semantic response ownership,
   hashing, protocol parsing and Session Capture.
2. **Single bounded protocol repair.**
   An ordinary invalid target response may create one `PROTOCOL_REPAIR`. A response to that repair
   is never ordinary Nano input: valid repair is consumed by deterministic protocol fast-path;
   invalid repair terminalizes locally as `PROTOCOL_REPAIR_EXHAUSTED`.
3. **No repair/control amplifier.**
   `PROTOCOL_REPAIR_EXHAUSTED` creates no Nano request, local-state action, chat-control
   continuation or second repair generation.
4. **Nano microdecision v3.**
   Ordinary post-READY Nano returns candidate source/actions, selection relation,
   rejected alternatives, decision basis, uncertainty/evidence need, executor actor, stop
   condition and explicit no-material-alternative state.
5. **Owner-derived discrimination gate.**
   Runtime, not Nano, derives `independentJudgmentDemonstrated`. An ACCEPT must show a materially
   different rejected alternative or an explicit justified `noMaterialAlternative=true`.
   MODIFY/REJECT must be materially different from the target path.
6. **Bounded deliberation repair.**
   One internal Nano re-prompt may repair a missing discrimination payload without any target or
   chat-control effect. A second failure typed-fails `NANO_DISCRIMINATION_FAILED` and stops.
7. **Baseline separation preserved.**
   Session-context baseline Nano remains validator-only. The deliberation gate applies only to
   ordinary post-READY continuation/operator-resume Nano.
8. **Fresh current-only namespace.**
   App/config/runtime/export/storage/Session DB/alarm identities advance to v0.11.22.

## Claim boundary

This release is a source/package candidate. Local regression fixtures and package-integrity checks
do not prove installed-byte identity, current ChatGPT DOM behavior, Desktop Chrome liveness or
production readiness.
