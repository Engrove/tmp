# Verification v0.11.20

## Claim boundary

This document covers source/package verification only. It does not claim Desktop Chrome
installation, runtime acceptance or production readiness.

## Focused regression requirements

1. `AUTHORIZE_BOUNDARY` uses `bundle.runtime` for persistence and performs owner-state readback before
   success is reported.
2. Operator-action evidence receipt uses the same root-runtime discipline.
3. Session-context purge uses the same root-runtime discipline.
4. `writeRuntimeBundle()` rejects wrapper-shaped input with `RUNTIME_ROOT_REQUIRED`.
5. USER_PAUSE hard-boundary sequencing transitions the run first and derives the canonical
   boundary key second.
6. A valid acknowledgement can advance a correctly keyed pending decision to a recoverable receipt
   state in the local state-machine fixture.
7. Nano-selected `WAIT_OWNER_EVENT` + model-authored USER_PAUSE + target `CONTINUE` with no human
   boundary is internalized as a no-effect route.
8. A target USER_PAUSE / OPERATOR_DECISION is not internalized.
9. A material target dispatch is not internalized.
10. An unknown/fallback Nano micro-action is not internalized.
11. The post-READY baseline handoff replaces init-only `EIC_NEXT` with
    `mainTaskBaseline.current.nextHighLeverageAction`, blanks the actor, and marks
    `SESSION_CONTEXT_READY_HANDOFF`.
12. Original accepted baseline target metadata remains separately available for audit.
13. Existing v0.11.19 conversation isolation, extraction completeness, Session Memory provenance,
    passive true-external wait, retry-fence reset, protocol parsing and terminal ownership repairs
    remain syntactically/package coherent.
14. Payload hashes, package digest and ZIP structure reproduce exactly from the finished package.

## Live acceptance remains required

The exact packaged ZIP must still prove the click path and continuation in Desktop Chrome. Local
fixtures cannot prove extension installation or browser runtime effects.
