# v0.12.0 control-plane architecture

Canonical flow:

`RawObservation -> CanonicalMessage -> CorrelatedEvent -> TransitionCommit -> Effect -> EffectReceipt -> ResponseBinding -> EffectClose -> MaterialStateAdvance`

`lib/causal-transition-authority.mjs` is the commit authority for the causal CONTROL
aggregate. Other subsystems remain event/observation/classification producers.

## Invariants

1. One response has at most one causal CONTROL owner.
2. Transport ACK does not imply permanent response ownership.
3. New material human/user events close stale response claims.
4. Protocol applicability is established before response parsing.
5. Terminal state is absorbing for the causal unit and retires nested causal inputs.
6. External WAIT is quiescent until its registered wake predicate changes.
7. Nano policy rejection is not bypassable by generic recovery in the same material generation.
8. Mission baseline is explicitly MISSION-plane; acceptance harness is a separate causal plane.
9. Historical conversation turn IDs cannot prove current control-prompt ownership.
