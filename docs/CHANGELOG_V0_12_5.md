# EIC Autonom Agent v0.12.5

## Scope

v0.12.5 fixes the v0.12.4 post-READY Nano/recovery failure as one causal episode rather
than adding another retry or timeout.

## Root causes fixed

1. **Transition identity was split between model prose and runtime action IDs.**
   `microActionId` is a symbolic runtime transition ID, while `requestedAction` is semantic
   prose. v0.12.4 validated `requestedAction` against model-authored `candidateActions`
   even when Core had already resolved the only admissible continuing transition.

2. **A unique runtime route was incorrectly forced through a discrimination test.**
   In the captured failure, Core admitted only `STOP` and `WAIT_OWNER_EVENT`; therefore
   there was exactly one continuing transition. Nano returned the semantic owner candidate
   but copied `REQUEST_TARGET` into both `microActionId` and `requestedAction`.
   The validator rejected this as candidate mismatch instead of binding the semantic
   ACCEPT to Core's unique route.

3. **The current-generation policy fence was advisory at one recovery call site.**
   After `NANO_DISCRIMINATION_FAILED`, one later `PROGRAM_BLOCKED -> RECOVERING` watchdog
   branch did not consult the causal policy fence. The exported v0.12.4 transition reason
   matches that branch exactly.

4. **Terminal Nano failure retained live ownership inputs.**
   The failed Nano request could leave `decisionOwner` and the same observation alive in
   waiting/pending state, allowing later scheduler/recovery logic to act on a causal unit
   that had already failed closed.

## Architectural changes

- Runtime `availableActionIds` is the transition-authority set; Nano discrimination telemetry is bumped to `eic.autonom.nano-discrimination.v3`.
- Model-authored `candidateActions` is deliberation evidence only.
- A single admissible non-STOP runtime route can be bound deterministically without
  fabricating an alternative merely to satisfy a discrimination ceremony.
- Multiple admissible runtime routes still require real discrimination; a Nano-selected
  action outside the runtime catalog is rejected.
- Semantic `requestedAction` may be normalized to the owner candidate after a valid
  runtime-bound ACCEPT, while the original model `microActionId` is retained until
  execution routing so `CORE_FALLBACK` provenance is not falsely relabelled `NANO_SELECTED`.
- A current-generation causal policy fence makes `PROGRAM_BLOCKED` absorbing for every
  nonterminal/non-failsafe transition even with `force:true`.
- The watchdog may still observe a genuine new material user event. If no new material
  generation appears, it returns before response drain, Nano, scheduler or generic recovery.
- Terminal Nano discrimination failure retires `pendingNanoRequest`, `pendingObservation`,
  `waitingObservation`, and live `decisionOwner` atomically. A compact historical failure
  observation remains for diagnostics only.

## Release invariant

`NANO_DISCRIMINATION_FAILED` for material generation G cannot execute or recover more work
for G. It may leave `PROGRAM_BLOCKED` only by an explicit fail-safe terminal transition or
after a genuine material event advances the causal generation.

Nano never creates transition authority. Core owns the admissible transition catalog.
