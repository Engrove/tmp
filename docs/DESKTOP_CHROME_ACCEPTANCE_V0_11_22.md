# Desktop Chrome acceptance v0.11.22

## Claim boundary

Use the exact delivered v0.11.22 BROWSER ZIP. Source/package verification is not runtime PASS.

## Oracle A — fresh session and baseline

- fresh conversation owns fresh baseline/continuity/memory provenance;
- canonical baseline response survives reasoning/presentation chrome;
- baseline Nano validates and commits `READY` exactly once.

## Oracle B — speaker-label normalization

Cause ChatGPT to render a normal EIC response where accessibility text may expose `EIC sade:` /
`ChatGPT said:` or a completed reasoning-duration disclosure.

Required:
- canonical assistant response starts with semantic response content, not the speaker label;
- exact EIC-AA/5 footer parses without protocol repair when otherwise valid;
- Session Capture contains no standalone speaker/lifecycle presentation turn.

## Oracle C — protocol repair fence

Inject or provoke one genuinely malformed EIC-AA/5 footer after READY.

Required:
- exactly one `PROTOCOL_REPAIR` may be emitted;
- if the repair is valid, it is consumed deterministically with no ordinary Nano turn;
- if the repair remains invalid, runtime becomes `PROGRAM_BLOCKED` with
  `PROTOCOL_REPAIR_EXHAUSTED`;
- no subsequent `READ_LOCAL_SESSION_STATE`, `WAIT_OWNER_EVENT`, `CHAT_CONTROL_CONTINUATION` or
  second protocol-repair generation may arise from that repair episode.

## Oracle D — Nano bounded deliberation

For ordinary post-READY `CONTINUATION_ANALYSIS`:

- response schema is `eic.nano.microdecision.v3`;
- runtime records candidate source/actions, selection relation, decision basis, executor and stop;
- candidate set contains the owner-known candidate and selected action, and executorActor matches the selected registered micro-action;
- a target-next echo without real alternative or explicit no-material-alternative is rejected
  internally;
- one internal discrimination repair may occur with no target/chat-control effect;
- repeated failure terminalizes `NANO_DISCRIMINATION_FAILED`;
- DELIBERATIVE_ACCEPT/VALIDATOR_ACCEPT are distinguishable in telemetry;
- no field authored by Nano can directly assert independent judgment.

## Oracle E — investigative/non-ping-pong mission

Continue an investigation in which the next useful delta may be a local Nano test, EIC owner read
or genuine external producer.

Required:
- actor ownership remains explicit;
- genuine external waits are passive;
- local no-delta reads cannot create unbounded chat-control generations;
- Nano may modify/reject the target candidate when its structured deliberation justifies a
  materially different route.

## Oracle F — human boundary preservation

After READY:
- no-effect Nano wording must not manufacture a level-10 human decision;
- a genuine operator action/decision persists, reads back and resumes exactly once.

## Production gate

Production remains blocked until the exact v0.11.22 package passes Oracles A-F with export,
raw-session-context and audit evidence from the same installed episode.
