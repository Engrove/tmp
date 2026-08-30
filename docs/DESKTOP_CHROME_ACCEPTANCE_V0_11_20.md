# Desktop Chrome acceptance v0.11.20

## Claim boundary

Use the exact delivered v0.11.20 BROWSER ZIP. Source/package PASS is not browser runtime PASS.

## Oracle A — false USER_PAUSE on a no-effect route

Reproduce the investigative post-READY situation where Nano selects `WAIT_OWNER_EVENT` and
model-authored output asks for control, while the target protocol itself is valid `CONTINUE` and has
no operator/human boundary.

Required:
- no level-10 `USER_PAUSE` panel is created;
- audit records bounded internalization of the model-authored pause;
- the registered no-effect route executes normally;
- no duplicate chat-control/local-state/protocol-repair churn occurs.

## Oracle B — real USER_PAUSE authorization

Deliberately create a genuine owner/operator decision boundary after READY.

Before click:
- state is `AWAITING_OPERATOR_DECISION`;
- operator decision is `PENDING`;
- `run.boundaryKey == operatorDecision.boundaryKey`.

Click **Kvittera materiellt beslut och verifiera readback** once.

Required:
- no JavaScript/command error;
- root runtime write succeeds;
- operator decision receipt is ACCEPTED/readable;
- boundary authorization contains the same receipt id and boundary key;
- readback sees run state `RECOVERING`;
- only after readback does the success audit say the decision was accepted;
- controller continues exactly once.

Clicking the same accepted decision again must be idempotent and must not duplicate the effect.

## Oracle C — sibling wrapper/root mutation paths

1. Trigger one valid operator-action evidence receipt.
2. Trigger Session Context purge from the supported UI flow.

Neither path may produce `Cannot read properties of undefined (reading '0')` or
`RUNTIME_ROOT_REQUIRED` with valid runtime state.

## Oracle D — post-READY baseline handoff

Use a baseline whose EIC trailer says to validate the baseline and then continue work, while
`mainTaskBaseline.current.nextHighLeverageAction` names the actual post-init work.

Required:
- init reaches READY once;
- first ordinary post-READY Nano input is marked `SESSION_CONTEXT_READY_HANDOFF`;
- target next equals the accepted baseline's `nextHighLeverageAction`, not the init-only validation
  instruction;
- actor is neutral until a fresh target turn supplies the next actor;
- no redundant baseline-validation request is emitted.

## Oracle E — v0.11.19 preservation

In clean episodes re-check:
- fresh conversation/mission baseline isolation;
- complete structured response extraction;
- exact Session Memory conversation/capture provenance;
- no request-placeholder/Thinking capture;
- true external producer wait remains passive;
- manual retry rotates correction episode;
- CATCH source-response exclusion remains stable.

## Production gate

Production remains blocked until the exact v0.11.20 package passes Oracles A-E with exported runtime
and audit evidence for the same installed episode.
