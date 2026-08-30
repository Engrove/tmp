# v0.11.22 architecture

## Correlated incident model

The recurring failure family now spans response ownership, protocol transport and post-READY Nano
routing. The violated invariant is:

> One conceptual assistant turn must yield one canonical semantic response, and a bounded
> transport repair must never become a new semantic continuation episode.

The v0.11.21 live export falsified the previous closure in two independent places.

### A. Presentation chrome entered semantic ownership

The runtime-owned observation contained an assistant response beginning `EIC sade:EIC_TURN: ...`.
The strict trailer parser correctly rejected this because the first semantic line was not
`EIC_TURN:`. The UI/accessibility speaker label is presentation metadata and must not participate
in the response hash, parser input or Session Capture semantic text.

The same run contains Session Memory text shaped
`assistant: EIC sade:Arbetade i 2m 54sAccepterat ...`, proving that completed reasoning-duration
presentation can also be concatenated with the final answer.

### B. Protocol repair crossed into semantic Nano

v0.11.21 `selectProtocolDecisionPath()` returned `NANO` for every
`currentTurnKind === "PROTOCOL_REPAIR"`. Therefore an invalid repaired trailer did not close the
transport episode. It entered ordinary Nano, which could choose a local read/wait, create
`CHAT_CONTROL_CONTINUATION`, and expose another assistant response to the same protocol parser.

This is a liveness/ownership defect, not a reason to add retries or tolerate arbitrary protocol.

## Transport-repair invariant

For one parent response:

- generation 0: ordinary invalid protocol may create one `PROTOCOL_REPAIR`;
- repair response valid: deterministic `FAST_PATH`, no ordinary Nano;
- repair response invalid: local `REPAIR_EXHAUSTED` terminalization;
- no path from an exhausted repair may create Nano, local-state wake, chat-control or another
  protocol repair for the same episode.

## Canonical assistant response

`content.js` now applies assistant-only presentation cleanup after selecting the safe conceptual
conversation-turn owner:

1. strip a known leading assistant speaker label;
2. strip one leading completed timed reasoning disclosure;
3. remove standalone assistant lifecycle lines;
4. preserve ordinary prose, EIC-AA/5 text and structured `pre`/`code` payloads;
5. use the same canonical record for runtime page state and Session Capture.

User-role text is never transformed by this assistant presentation filter.

## Nano deliberation contract

`eic.nano.microdecision.v3` separates semantic judgment from transport:

- `candidateSource`: TARGET | BASELINE | NANO
- `candidateActions[]`
- `selectionRelation`: ACCEPT | MODIFY | REJECT | PROPOSE_NEW
- `rejectedAlternatives[]`
- `decisionBasis`
- `criticalUncertainty`
- `evidenceNeed`
- `executorActor`
- `stopCondition`
- `noMaterialAlternative`

Runtime derives the verdict. Nano cannot set or self-attest an
`independentJudgmentDemonstrated` flag. The candidate set must contain the selected action and the
owner-known target/baseline candidate, and `executorActor` must match the registered micro-action's
runtime-owned executor.

### Acceptance semantics

- ACCEPT + materially different rejected alternative + concrete basis:
  `DELIBERATIVE_ACCEPT`.
- ACCEPT + no distinct alternative + explicit, concrete `noMaterialAlternative=true`:
  `VALIDATOR_ACCEPT`.
- ACCEPT with neither:
  `NANO_DISCRIMINATION_REQUIRED`.
- MODIFY/REJECT must materially change actor, micro-action, effect or evidence path.
- PROPOSE_NEW is legal only when no usable target candidate exists and Nano explicitly owns the
  candidate source semantically; NANO still never becomes the executor.

The first discrimination failure is repaired internally exactly once. No chat turn or target
effect is emitted during that repair. Repeated failure terminalizes as
`NANO_DISCRIMINATION_FAILED`.

## Baseline boundary

The mandatory session-context baseline path remains a validator contract. It is intentionally
excluded from ordinary Nano deliberation enforcement and may commit READY only through the existing
typed baseline acceptance flow.

## Claim boundary

The architecture is implemented and locally checked in the packaged candidate only. Desktop Chrome
runtime acceptance remains a separate owner/evidence boundary.
