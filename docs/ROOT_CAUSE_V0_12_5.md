# Root-cause analysis — v0.12.5

## Evidence source

The primary incident evidence is the exact exported v0.12.4 runtime captured after the
visible `RECOVERING / NANO_DISCRIMINATION_FAILED` failure.

The export shows:

- `state = RECOVERING`
- `runtimeDecisionStatus = NANO_DISCRIMINATION_FAILED`
- a current-generation causal policy fence with code `NANO_DISCRIMINATION_FAILED`
- `lastTransition.from = PROGRAM_BLOCKED`
- `lastTransition.to = RECOVERING`
- transition reason exactly:
  `Blockeringen saknar nivå-10-gräns; autonom recovery fortsätter.`

The final Nano output in the same export has:

- `microActionId = REQUEST_TARGET`
- `requestedAction = REQUEST_TARGET`
- `candidateSource = TARGET`
- `selectionRelation = ACCEPT`
- one semantic target candidate describing creation/selection of the fresh evaluator target

Core execution routing for that exact target state admits only:

- `STOP`
- `WAIT_OWNER_EVENT`

and deterministically resolves the requested unavailable `REQUEST_TARGET` to
`WAIT_OWNER_EVENT` with source `CORE_FALLBACK`.

## Causal chain

1. Session-context baseline reaches READY.
2. Post-READY handoff creates an actor-neutral semantic target next.
3. Core has exactly one continuing route: `WAIT_OWNER_EVENT`.
4. Nano semantically accepts the target next but copies symbolic `REQUEST_TARGET` into
   `requestedAction`.
5. v0.12.4 compares symbolic `REQUEST_TARGET` against semantic candidate prose.
6. The first gate rejects and schedules exactly one internal deliberation repair.
7. Repair fixes candidate membership but still returns symbolic `requestedAction`.
8. The second gate fails with `SELECTED_ACTION_NOT_IN_CANDIDATES`,
   `ACCEPT_DOES_NOT_MATCH_CANDIDATE`, and `NANO_DISCRIMINATION_REQUIRED`.
9. Runtime installs a current-generation `NANO_DISCRIMINATION_FAILED` policy fence and
   enters `PROGRAM_BLOCKED`.
10. A second generic watchdog recovery branch ignores that fence and forces
    `PROGRAM_BLOCKED -> RECOVERING`.
11. The run is now in recovery despite a still-current policy fence; live Nano ownership
    metadata also survives longer than the terminal causal decision.

## Falsified local hypotheses

- **Timeout/liveness failure:** falsified. The Nano request completed and produced a parsed
  decision; the failure is semantic/control validation, not model transport timeout.
- **No available continuation path:** falsified. Core had `WAIT_OWNER_EVENT`.
- **Nano failed to select any useful action:** falsified at semantic level. Both attempts
  accepted the same target work; the mismatch is symbolic transition identity versus prose.
- **Policy fence itself was absent:** falsified. It is present in the export at the same
  material generation as the blocked run.
- **Generic recovery respected the fence everywhere:** falsified by exact transition reason
  and the second unguarded source branch.

## v0.12.5 enforcement

The fix moves authority to the runtime action catalog, makes same-generation policy fencing
a central state-machine invariant, adds watchdog quiescence, and retires terminal Nano live
ownership inputs. Regression tests replay the exact v0.12.4 export and enumerate every
possible attempted state exit from a fenced `PROGRAM_BLOCKED` state.
