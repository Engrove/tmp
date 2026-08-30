# Changelog — v0.12.13

Control-plane repair for the 2026-08-30 no-producer deadlock, in which a
complete and stable assistant response sat on screen for 133 seconds across
218 tick cycles while no subsystem was able to admit it.

## Root cause

- Unified response admission on a single causal ownership verdict.
  `newResponseAdmissionReady` consulted only the legacy effect journal while
  `effectReady` required a live causal effect. The legacy journal has no
  vocabulary for consumption at all — `LEGACY_EFFECT_STATUS` maps nothing to
  `RESPONSE_CONSUMED`/`CLOSED` — so a legacy effect stays `ACKED` forever once
  acknowledged, while `RESPONSE_CONSUME` closes the causal effect and clears
  `activeEffectId`. Both gates were locally correct and permanently
  contradictory: gate one reported `admission=1` while gate two refused the
  same response, and because gate one also suppresses the autonomous recovery
  block, the pair formed a live-lock with no producer.
- Added `classifyCausalOwnership()` as the only predicate either gate may ask,
  with typed verdicts including `OWNER_CONSUMED_WITHOUT_SUCCESSOR`.

## Reconciliation

- Repaired the v0.12.0 causal preflight, which was supposed to keep the two
  planes in sync every tick and could not. `EFFECT_REGISTER` refuses a terminal
  effect, so re-registration returned `EFFECT_ALREADY_TERMINAL` on every tick;
  the follow-up guard then read `.status` off a null `activeCausalEffect()`,
  tested `includes("")` and passed in exactly the case it was written to block,
  whereupon `EFFECT_STATUS` was rejected as terminal too. Both rejections were
  silent.
- The preflight now classifies before mutating, compares against the effect's
  own causal status, and audits a stranded owner on first detection.

## Liveness

- Added turn-owned bounded liveness (`causal-ownership-liveness.mjs`). The only
  v0.12.12 response bound hung off `run.responseCandidate`, which is precisely
  the object that is never created while ownership is stranded, and
  `clearResponseStabilityProbe()` additionally cancelled the Chrome alarm. A
  stranded owner now terminalizes with the typed invariant
  `CAUSAL_OWNER_STRANDED_NO_PRODUCER` instead of waiting indefinitely.

## Response settlement

- A `TURN_BOUND_5` CONTROL response is no longer consumed on soft stability
  alone. `responseEligibleForNano()` returns `GENERAL_DYNAMIC_STABILITY_ALLOWED`
  for every non-specialized mode, so three stable reads over four seconds were
  enough to treat a still-streaming answer as settled, and `RESPONSE_CONSUME`
  then ran regardless of the parse outcome. An incomplete trailer that the page
  cannot confirm as terminal is now kept under observation, still bounded by the
  candidate settle deadline.

## Owner readback

- Added monotonic assistant turn identity in `content.js`.
  `assistantRecords.at(-1)` is purely positional, and ChatGPT virtualizes older
  DOM nodes, so the last visible assistant node can step backwards to an earlier
  turn. v0.12.12 read only "the hash changed" and concluded "a newer response
  owns the page", discarding a live prepared effect.
- Added the `OWNER_READBACK_REGRESSED` disposition. A lower turn sequence is now
  a stale readback to wait out, not a supersession. Genuine supersession and the
  no-sequence-data path keep their v0.12.12 behaviour.

## Regressions

- Added `v0.12.13-control-plane-regression.mjs`: 35 assertions replaying the
  exact incident (`469f9aa1…` → `a37a87d6…` at assistant ordinal 12 →
  `4bb78cf4…` at ordinal 14), including the legacy/causal contradiction, and
  requiring that the sequence terminalizes rather than resting silently in
  `WAITING_FOR_RESPONSE`.
- Preserved all v0.12.9, v0.12.10, v0.12.11 and v0.12.12 regressions.
  Suite total 131 assertions.
- No new autonomous capability was added.
