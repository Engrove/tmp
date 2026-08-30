# v0.11.9 Architecture — Semantic side-band material identity

## Live defect

v0.11.8 live shakedown showed that an EIC side-band control reply could create a fresh assistant response identity/hash even when local state and target-control semantics were unchanged. The controller used that raw response identity in `observationMaterialKey`, `materialDecisionInputKey`, and the chat-control wake key. That let the control reply itself become apparent material progress, re-arm one local Nano/read cycle, and regenerate `LOCAL_STATE_UNCHANGED`.

## Material identity contract

For `CHAT_CONTROL_CONTINUATION` and `PROTOCOL_REPAIR` only:

- raw assistant `responseIdentity`, `responseHash`, trailer `turnId`, and the side-band current turn id are transport identity, not material progress by themselves;
- the stable anchor is the current run/task plus latest non-side-band material effect and current session-init episode identity;
- `materialControlGeneration` remains material so an accepted Core Surface Review can re-arm exactly once;
- target-control semantics remain material: protocol validity/reason, autonomy status, `EIC_NEXT`, `EIC_NEXT_ACTOR`, completion state, and full-stop reason;
- material owner/effect state remains in `materialDecisionInputKey`, and local material-state digest remains in the wake key.

Outside side-band control turns, assistant response identity behavior is unchanged.

## Anti-loop consequence

A semantically equivalent EIC control reply with only a fresh response identity now produces the same observation material key, the same material-decision digest, and the same wake key. `evaluateLocalNanoRearm` therefore returns `LOCAL_STATE_UNCHANGED` instead of treating transport identity churn as a material delta. The prior wake receipt deduplicates the same no-delta generation.

A genuine `materialControlGeneration` increment, changed task/init episode, substantive target-control change, or actual material owner/local-state change still produces a different key and permits one bounded reanalysis.

## Preserved controls

- v0.11.8 baseline-correction fence;
- v0.11.7 `NANO_INCOMPLETE_JSON`;
- v0.11.6 6,000-soft/schema-hard output policy;
- v0.11.5 actor/capability topology;
- v0.11.5 one terminal Nano diagnostic per failure generation and same-generation wake suppression.
