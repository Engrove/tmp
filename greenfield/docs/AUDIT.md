# Forensic Audit — Greenfield v1.1.12

## v1.1.12 operating contract

Persistent Audit is operator-controlled and **off by default**.

When the side-panel checkbox is off:

- no Audit event is persisted to IndexedDB;
- the background keeps only a volatile FIFO of the 25 most recent event headers for display;
- the FIFO contains event identity/phase/kind/component metadata, not full payload bodies;
- the FIFO is non-durable and may reset when the MV3 service worker or extension reloads;
- persistent NDJSON export is disabled.

When the checkbox is on:

- Audit persistence uses schema `eic.greenfield.audit.v2` in DB schema version 3;
- the store is bounded to 5,000 events, with excess legacy history pruned in bounded batches;
- reverse cursor queries use time-bearing indexes rather than `getAll()`;
- high-frequency unchanged polling diagnostics are sampled/coalesced on a 5-second window;
- a process-scoped persistence failure remains terminal `AUDIT_FAILURE`.

The legacy `auditCounters/__global__` record is no longer used on the write path.

`PAGE_STATE_OBSERVED` intentionally excludes raw assistant response text. It carries IDs,
hashes, lengths, trust/generation signals and bounded autonomous-turn metadata instead.
Response text may be captured once at the actual response-capture boundary when persistent
Audit is enabled.

Audit remains observability, not a second state machine. Disabling persistence does not
change dispatch, response admission, exact-once, Nano/Hjalmar or controller decisions.

## Required forensic event families when persistence is enabled

In addition to APP/WINDOW/RUN, model, DOM, dispatch, state, storage, recovery, overlay and
stale-callback evidence, v1.1.x defines:

- `RESPONSE_STATUS_PARSED` with canonical target status, parse mode, bounded repair metadata and parse errors;
- `RESPONSE_PROTOCOL_OPTIONAL_ABSENT_OR_INVALID` when structured A2A metadata cannot be established without stopping continuity;
- no protocol-only target BLOCKED/DONE terminal barrier;
- `NANO_TASK_WRITE_AHEAD` including readback match and no-replay invariant;
- Nano Task create/prompt/result/error/destroy lifecycle;
- `NANO_TASK_DURABLE_COMMIT` with terminal result/readback before advisory Nano/Hjalmar;
- `NANO_TASK_PIPELINE_READBACK` proving the advisory pipeline sees the durable task checkpoint;
- `HJALMAR_EVIDENCE_BINDING_REJECTED` when model claims contradict canonical facts;
- `HJALMAR_RUNTIME_FACTS_RECONCILED` when model mirror fields or a consumed Nano directive are corrected;
- `CONTINUATION_ADMISSION_EVALUATED`, `CONTINUATION_REPLANNED` and only genuine `CONTINUATION_ADMISSION_BLOCKED`;
- `AUTONOMOUS_RESPONSE_PRODUCER_LOST` and `INTERRUPTED_CONTINUATION_REARMED` for a closed causal response slot;
- `STALE_SESSION_COUNTER_INITIALIZED` and `STALE_SESSION_COUNTER_RESET` for the WAIT-only stale anchor;
- staged WAIT refresh events at 30/60/90 minutes and terminal stale exhaustion at 120 minutes;
- `CONTINUATION_DISPOSITION_BOUND` proving the source of `previousDisposition`;
- outbound bounded `analysisEvidence`.

Schema validation events must never be described as semantic task-completion evidence.


## Nano Task prompt evidence

v1.1.2+ records the Nano Task producer/executor boundary explicitly:

- `sourceTask`: the target-session directive captured after `NANO_TASK:`.
- `executionPrompt`: the runtime-owned English prompt actually sent to Nano.
- `promptLanguage`: `en`.
- `promptPolicy`: `ENGLISH_DIRECT_EXECUTION_V1`.

`NANO_TASK_REQUEST_START`, `NANO_TASK_PROMPT_ATTEMPT`, and `NANO_TASK_WRITE_AHEAD` provide the forensic chain. `COMPLETED` still means execution completed, not that task semantics were proven.


## v1.1.4 grammar-aware renderer-repair evidence

When the bounded grammar-aware quote-repair path is used, `RESPONSE_STATUS_PARSED` reports
`parseMode=REPAIRED_UNESCAPED_QUOTES`, `repairApplied=true`, and a repair count. The
repair path does not itself prove validity: the complete response schema must still pass. v1.1.4 additionally distinguishes structural closing quotes from embedded quoted metadata that is followed by a comma, using JSON container context rather than punctuation alone.
Historical v1.1.4 behavior treated an unrecoverable protocol response as terminal. v1.1.8 supersedes that rule: protocol failure is metadata and a causally complete response still reaches analysis.

Nano Task UI evidence is sourced from persisted `lastNanoTask`/`lastNano`; response
capture no longer erases the previous task result.


## v1.1.5 stage-checkpoint evidence

The exact-once Nano Task side effect is now a separate runtime stage. Audit must show:

1. `NANO_TASK_WRITE_AHEAD`;
2. Nano Task create/prompt/result;
3. `NANO_TASK_DURABLE_COMMIT` with `readbackMatches=true`;
4. only then Nano Observer/Hjalmar.

If a task effect cannot be resolved after restart, runtime records `UNKNOWN_EFFECT`; it
does not rewrite uncertainty into `FAILED`.

Advisory model-format failures are explicit:

- `NANO_OBSERVER_RUNTIME_FALLBACK`;
- `HJALMAR_RUNTIME_FALLBACK`.

These events preserve the failed model evidence but do not rewind a completed exact-once
Nano task. A final `NANO_TASK_REISSUE` remains a defense-in-depth guard event and should
not normally become a caller-visible blocker after runtime reconciliation.


## v1.1.6 renderer-degraded response evidence

When strict/full target-response parsing fails but bounded control extraction succeeds,
Audit must retain the distinction rather than silently promoting the response to valid JSON.

Required evidence includes:

- `RESPONSE_STATUS_PARSED` with `schemaValid=false`, `controlValid=true`,
  `degraded=true`, canonical status and `parseMode=CONTROL_PLANE_SALVAGE`;
- `RESPONSE_SCHEMA_DEGRADED_CONTROL_ACCEPTED` with the response hash, status,
  bounded recovered next action, parser errors, and explicit `fullSchemaValid=false`;
- normal response capture/analysis/continuation evidence after admission;
- historical v1.1.6 behavior failed closed when control was missing/ambiguous; v1.1.8 supersedes this and records optional protocol failure without blocking.

The raw captured assistant response remains forensic evidence and is never rewritten into a
claim that the full response schema was valid.


## v1.1.7 observation-quality evidence

`PAGE_STATE_OBSERVED` now includes:

- `documentId`;
- `lastAssistantId`;
- `lastAssistantOwnerKind`;
- `lastAssistantOwnerTrusted`;
- `assistantCount`;
- `assistantTextLength`;
- existing assistant hash/text/generation/visibility signals.

`RESPONSE_STABILITY_SAMPLE` records the same identity/provenance fields plus the
`identityKey` and observation-quality classification.

`RESPONSE_OBSERVATION_HELD` is emitted for transient `OBSERVATION_*` conditions and proves
that the bytes were not terminalized or parsed. This distinguishes observation uncertainty from protocol parse failure; neither condition alone is a terminal blocker in v1.1.8.

`ANALYSIS_PIPELINE_REQUEST` records `modelContextPolicy=NANO_SMALL_CONTEXT_V1`; raw previous
prompt/assistant transcript is referenced by hash/message identity rather than forwarded to
the local model prompt.


## v1.1.8 causal/protocol-independent evidence

The WAIT path audits both latest visible conversation state and the current autonomous
causal turn. Material events include:
- `AUTONOMOUS_USER_TURN_ID_RECONCILED` when ordinal fallback recovers the concrete id;
- `EXTERNAL_TURN_INTERLEAVED` when a later manual assistant is visible;
- `RESPONSE_OBSERVATION_HELD` for missing/untrusted/unpaired causal observations;
- `RESPONSE_STABILITY_SAMPLE` with expected/paired user ids and candidate identity;
- `RESPONSE_PROTOCOL_OPTIONAL_ABSENT_OR_INVALID` when A2A is missing/malformed but continuity
  remains allowed;
- `RESPONSE_STATUS_PARSED` as protocol metadata, never as proof of completion;
- `RESPONSE_CAPTURED` with `protocolRequiredForContinuation=false`;
- `CONTINUATION_DISPOSITION_BOUND` with controller disposition and bounded response provenance.

Protocol parser errors must never be the sole reason for a terminal BLOCKED transition.
Manual/external turns must remain visible in Audit without mutating autonomous response
ownership.


## v1.1.9 deterministic manual-interleave evidence

`EXTERNAL_TURN_INTERLEAVED` remains an Audit event, but v1.1.9 also persists the first
distinct external pair for the current autonomous turn as bounded runtime evidence. The
accepted autonomous response transports:

- `externalInterleave.observed`;
- latest external user-turn id;
- latest external assistant-turn id;
- autonomous user-turn id;
- autonomous assistant-turn id;
- `admissibleAsAutonomousResponse=false`;
- bounded `observedAt`.

This evidence is serialized through `analysisEvidence.responseObservation.externalInterleave`
on the next autonomous envelope and is cleared for the next turn. Raw external assistant
text is not forwarded through this bounded field.

The deterministic fixture `tests/fixtures/v1.1.8-deterministic-manual-interleave.json`
models the exact event order that a human-timed live probe could not reliably hit:
autonomous response observation -> external manual pair becomes latest -> global assistant
count changes -> autonomous response re-stabilizes and is admitted. Production code adds no
test delay or admission hold.

## v1.1.11 stale-session evidence

The stale-session audit chain is intentionally separate from autonomous response admission.

`STALE_SESSION_COUNTER_RESET` means only that a newly completed assistant response was
observed. It records the prior stage/anchor, new `staleSince`, reset count, assistant
identity/hash/count, `protocolAgnostic=true`, and `causalBindingRequiredForReset=false`.

This event must not be interpreted as:
- autonomous response admission;
- A2A validity;
- objective completion;
- Hjalmar/Nano success.

Escalation events carry the fixed policy
`30M_F5_60M_CTRL_F5_90M_CTRL_F5_120M_ROTATE`, persisted stage, stale anchor and reset
count. The browser reload effect is always preceded by its write-ahead ARM event.
At 120 minutes the exhausted WAIT path arms `SESSION_ROTATION` instead of terminal blocking; the rotation write-ahead state is audited before navigation.
