# Changelog v0.11.17

## Reworked

- Replaced the response-settle patch chain with an explicit exclusive response-ownership lifecycle.
- A settled response is transferred from `RESPONSE_CANDIDATE` to `PENDING_OBSERVATION`; it is not copied.
- Processed/source responses and owner-mismatched candidates are reconciled before liveness timeout logic.
- Outbound effects bind both source response hash and full response identity.
- Response equality is identity-first, so identical rendered text in two different assistant turns remains distinct.
- Added a central control-plane precedence model for terminal, human, safety, effect, response, session-init,
  Nano, recovery and ordinary delivery ownership.
- Terminal parent transitions now close active session-init/Nano/response child state.
- Background response-candidate retirement is centralized; raw candidate lifecycle clears were removed.
- Effect-journal statuses are explicitly registered and included in the source-derived state-space model.
- Mission projection now explicitly maps `PROGRAM_BLOCKED`, `PROGRAM_DONE`,
  `AWAITING_OPERATOR_ACTION` and `AWAITING_OPERATOR_DECISION`.

## Fixed

- The exact v0.11.16 dual-owner state can no longer keep a processed session-catch response as an active
  settle candidate after the baseline handoff.
- Early returns after pending-observation creation cannot bypass candidate retirement.
- A baseline/effect source response cannot be admitted as the response to its own outbound effect.
- A genuinely new assistant response with byte-identical text is not suppressed when its full response identity differs.
- Stale response candidates cannot produce `RESPONSE_SETTLE_LIVENESS_TIMEOUT` after ownership has already transferred.

## Added

- `lib/response-observation-cycle.mjs`.
- `lib/control-plane-phase.mjs`.
- Source-derived `docs/V0_11_17_STATE_REGISTRY.json`.
- Exact incident replay, binary-tree control-plane state space, response-ownership lifecycle state space and source-registry verification outside the runtime package build.

## Preserved

- v0.11.16 Core Surface Review no-op normalization.
- v0.11.15 durable settle alarm/deadline infrastructure for an actually active response generation.
- v0.11.13/v0.11.14 human-boundary and lexical `USER_PAUSE` contracts.
