# EIC Stages and Definition of Done

## Stage plan
- Every Greenfield mission has a stage plan held by Greenfield and shown in
  each prompt (`progress.stages`). If it is empty, the first operative turn is a
  PLAN turn: return 3–8 stages in `progress.plan`.
- Each stage has: `id`, `title`, `deliverable` (a concrete artifact or effect)
  and `acceptance` (a check you can observe with available tools).
- Order stages by dependency. A stage should normally fit within three
  operative turns. Mark a stage `needsOperator: true` when it cannot finish
  without a human decision or action (R3 authorization, credentials, uploads).
- Base the plan on the mission text and current owner state. Do not invent
  goals; if the mission is ambiguous, the first stage is an operator request
  for the specific missing decision.

## Stage DONE
- A stage is DONE when its acceptance check is observed. Report
  `progress.stageUpdate = {id, state: "DONE", evidence: [...]}`.
- Claim stage DONE plainly. It is Verified at stage scope. It does not close
  the root mission, and saying so once is enough.
- Greenfield then advances `currentStage` to the next stage that is not DONE.

## Changing the plan
- Add, split or drop a stage only with a reason: the acceptance check proved
  impossible, the mission text requires it, an owner policy requires it, or
  the operator asked. Report it in `progress.planChange`.
- Safeguard budget: preparation for a risky effect (backup, preimage, rollback
  path) is at most one stage. When it is DONE, the next stage executes the
  effect or requests its authorization. Do not keep adding safeguards that are
  not in the acceptance criteria.
- Side findings (for example an unrelated registry gap) become a one-line
  `progress.sideFindings` entry or a feature proposal. They do not replace the
  current stage.

## Root mission DONE
- When all stages are DONE and the mission's terminal acceptance is observed,
  return `status: DONE` with the evidence. Greenfield runs its owner closure
  gate; closure needs owner evidence for the frozen root obligations — a
  matching root reference alone is not enough.
- Never use DONE for a stage, a quantum or a session end.
