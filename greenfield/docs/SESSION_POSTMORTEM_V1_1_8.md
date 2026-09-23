# Session postmortem — v1.1.8 manual-interleaving acceptance

## Scope

This document records the live v1.1.8 shakedown evidence that led to v1.1.9. It is
historical; current behavior is defined by v1.1.9 source and tests.

## Verified live behaviors

- structured A2A response path continued with causal response provenance;
- `expectedUserTurnId == pairedUserTurnId` and `causalMatch=true` were exposed live;
- one English Nano Task completed exactly once with `GREENFIELD_V118_OK`;
- a causally paired response with no structured A2A object continued normally with
  `protocol.found=false`, `parseMode=NONE`, and Hjalmar `CONTINUE`;
- no Nano replay occurred on later turns.

## Acceptance gap

The manual interleave probe was operator-timed. The autonomous controller produced the next
CONTINUATION before the operator's manual assistant reply finished, so the external pair did
not exist inside the intended response-completion/admission window. Repeating the same probe
would test operator timing rather than controller correctness.

The exact failure in the acceptance method was therefore nondeterminism of the probe, not
new evidence that the production causal ownership path had failed.

## v1.1.9 closure

v1.1.9 adds a deterministic staged fixture and bounded external-interleave readback. The
fixture exercises a changed latest manual turn and assistant count while the earlier
autonomous assistant remains causally addressable. Runtime uses the same
`externalAssistantInterleaveEvidence()` helper whose output is asserted by the fixture.

No production delay is introduced to create the race artificially.
