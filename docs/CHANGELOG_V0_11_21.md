# Changelog v0.11.21

v0.11.21 is a focused rendered-response ownership repair on top of v0.11.20.

## Live incident closed at source/package scope

In the v0.11.20 Desktop Chrome acceptance, the canonical baseline prompt was delivered and the
target visibly rendered a complete `eic.main-task-baseline.v2` response. The runtime nevertheless
bound a 24-character assistant candidate, marked its extraction `complete=true`, parsed
`MAIN_TASK_BASELINE_NOT_FOUND`, and sent Nano a baseline-analysis request with
`baselineCandidate=null` and no semantic coverage. Nano then failed the mandatory baseline
analysis contract.

The 24-character extracted candidate matches the visible completed reasoning-duration disclosure
shape (`Arbetade i 51 sekunder >`) in the same assistant turn. The failure is therefore upstream of
Nano: a ChatGPT lifecycle/UI fragment was treated as the semantic assistant response.

## Changes

1. **Conceptual conversation-turn ownership.**
   Role-bearing DOM fragments are resolved to their nearest safe ChatGPT conversation-turn shell.
   A turn shell is canonical only when all role-bearing descendants have the same semantic role.
2. **Fragment deduplication.**
   Multiple role-bearing assistant fragments inside one conceptual turn now yield one canonical
   message entry.
3. **Reasoning lifecycle exclusion.**
   Transient and completed reasoning-status text (`Thinking`, `Working`, Swedish equivalents and
   timed disclosures such as `Arbetade i 51 sekunder >`) is excluded from semantic response text.
4. **One extraction contract for runtime and Capture.**
   Page-state response selection and Session Capture use the same conceptual-turn owner and
   lifecycle filtering.
5. **Structured response preservation.**
   The full safe turn owner remains the source for `pre`/`code` payload discovery and canonical
   response completeness. A role fragment can no longer hide the structured baseline that is
   present elsewhere in the same assistant turn.
6. **Current-only release namespace.**
   App/config/runtime/export/storage/Session DB/alarm identities advance to v0.11.21.

## Preserved v0.11.20 behavior

The runtime-root receipt fix, post-transition boundary identity, bounded model-only USER_PAUSE
internalization, readback-before-success rule and post-READY baseline handoff projection remain
unchanged.

## Claim boundary

This release is source/package verified only. Desktop Chrome installed-byte identity, live
conversation-turn DOM behavior, baseline Nano READY and production acceptance require a fresh run
of the exact packaged ZIP.
