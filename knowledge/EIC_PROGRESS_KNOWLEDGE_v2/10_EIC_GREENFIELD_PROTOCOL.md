# EIC Greenfield Protocol (Greenfield ≥ 2.0.0)

Greenfield is the browser controller that runs autonomous missions in this
chat. From version 2.0.0 it keeps its own progress ledger per mission and puts
it in every operative prompt as the top-level field `progress`.

## What you receive (`progress`)
- `rule` — the progress contract (same meaning as 01 and 04).
- `stages`, `currentStage` — the stage plan; `planRequired: true` means there
  is none yet.
- `acceptedEvidence` — results already accepted; do not redo them.
- `deadEnds` — routes that failed; do not retry without a changed input.
- `knownLimitations` — surfaces that refused access in this mission
  (for example `AIK:aik_trusted_session_required`); do not call them again in
  this session.
- `lastTurn`, `counters` — Greenfield's measurement of recent turns.
- `alert` + `alertInstruction` — NONE, CHANGE_ROUTE, STRATEGY_SWITCH or
  OPERATOR_REQUIRED (see 04). An alert instruction overrides a stalled handoff.
- `operatorAnswer` — the human operator's answer to your last request. Act on
  it first.
- `lastHandoff` — your previous `nextSuggestedAction`, for reference.

## What you return (`progress` in the response JSON)
All fields optional; include the ones that apply.
```json
"progress": {
  "delta": ["commit 3f2a9c1 on branch gf/x read back", "pytest exit 0 on 3f2a9c1"],
  "stageUpdate": {"id": "S2", "state": "DONE", "evidence": ["pytest exit 0 on 3f2a9c1"]},
  "plan": [{"id": "S1", "title": "…", "deliverable": "…", "acceptance": "…", "needsOperator": false}],
  "planChange": {"reason": "…", "stages": [ … ]},
  "deadEnds": [{"route": "full-file upload via chat attachment", "reason": "connection error, no receipt API"}],
  "knownLimitations": [{"surface": "AIK", "code": "aik_trusted_session_required"}],
  "operatorRequest": {"ask": "…", "why": "…", "then": "…", "options": ["A", "B"]},
  "sideFindings": ["…"]
}
```
- `delta` lists new results of this turn with their identifiers. Greenfield
  cross-checks identifiers against what it has already seen; a delta without
  new evidence under a repeated blocker counts as no progress.
- `stageUpdate` DONE requires at least one evidence item.
- `operatorRequest` with `status: "BLOCKED"` parks the mission (omit
  `sessionAction`).

## How Greenfield reacts
- Turn verdicts: ADVANCED, PLANNED, CHURN (no delta), BLOCKED.
- One CHURN → CHANGE_ROUTE. Two → STRATEGY_SWITCH. Three, or an operator
  request → OPERATOR_REQUIRED: the mission is parked, the operator is notified
  in the side panel, other missions continue. A stage that takes more than six
  turns triggers STRATEGY_SWITCH.
- A session rotation keeps the ledger: a new chat continues the current stage
  and sees accepted evidence and dead ends.
- The rest of the A2A envelope (status, sessionAction, runtimeControl,
  learningControl, queue rules, terminal closure gate) is unchanged.

## Response hygiene
- `nextSuggestedAction`: one positive imperative sentence for the next
  deliverable (≤ 400 characters), plus at most three short constraints.
- `summary`: what changed this turn. One line for what is still open.
- Do not repeat prohibitions that are already in the prompt.
