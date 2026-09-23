# Session postmortem — v1.1.4 live shakedown

## Scope

Live Desktop Chrome run:

- process: `process-088dce85-4444-485b-8797-becd0c2a87ed`
- run: `run-7879b4ee-df93-4c39-9e57-7d8a53fb68d5`
- generation: 1
- turn: 1
- app: v1.1.4

The run ended in `BLOCKED` with `NANO_TASK_REISSUE`. The final guard was correct; the
upstream state/evidence pipeline made the correct guard see a corrupted/stale candidate.

## Event-chain diagnosis

### 1. Target response parsing — PASS

`RESPONSE_STATUS_PARSED` seq 64 produced:

- canonical status `CONTINUE`;
- `parseMode=REPAIRED_UNESCAPED_QUOTES`;
- four bounded repairs.

This closes the parser defect that blocked v1.1.3.

### 2. Nano Task write-ahead — PASS

Seq 71 persisted a RUNNING request with request id
`nano-task-21d770fd-7555-4cd5-a6e6-d1dfa95da20d`, source-response hash, English
execution prompt and exact-once no-replay policy.

### 3. Nano Task execution — PASS

Seq 78 issued exactly one model prompt. Seq 79 returned:

`GREENFIELD_V114_OK`

with `status=COMPLETED`, `promptCalls=1`.

The side effect succeeded.

### 4. First causal defect — completion was not durably checkpointed

v1.1.4 returned the completed Nano Task only as an in-memory result inside the larger
offscreen `NANO_TASK -> NANO_OBSERVER -> HJALMAR` pipeline. Background persisted the
terminal Nano Task only after the entire pipeline returned successfully.

The following Nano Observer failed before that point. Canonical process state therefore
still said `lastNanoTask.status=RUNNING` although the Audit had already recorded the real
completed result.

This was the primary state-loss defect.

### 5. Nano Observer output failure incorrectly aborted the whole pipeline

The observer returned malformed/truncated JSON and seq 86 reported
`ANALYSIS_JSON_INVALID`.

Nano Observer is advisory. Its formatting failure should not invalidate an already
completed exact-once Nano Task or restart all preceding stages.

### 6. Retry converted uncertainty into false failure

Because persisted task state was still RUNNING, every retry correctly refused to replay
the exact-once effect. However v1.1.4 converted the unknown prior effect to
`status=FAILED`, `NANO_TASK_EFFECT_UNKNOWN_NO_REPLAY`.

That was epistemically wrong. "Effect unknown" is not proof that the task failed.

Five `NANO_TASK_REPLAY_BLOCKED` events were observed.

### 7. Recovery restarted already-completed/advisory stages

Each Hjalmar validation failure restarted the entire analysis pipeline, repeatedly
invoking Nano Observer and Hjalmar instead of resuming at the failed advisory stage.
This added several minutes of model calls without increasing owner evidence.

### 8. Hjalmar model-shape variance was treated as pipeline failure

Repeated model outputs failed on fields such as:

- `AMBIGUITY_REQUIRES_READ`;
- `ROLLBACK_PATH`;
- `OWNER_EVIDENCE`;
- `READBACK_PLAN`.

These are advisory/model-authored fields around runtime-owned facts. Treating each format
or wording miss as a whole-pipeline exception caused recovery churn. The correct runtime
response is a bounded deterministic fallback/reconciliation, not replay of preceding
stages.

### 9. Final task state contradicted the real task event

The first Nano Task result was `COMPLETED` with `GREENFIELD_V114_OK`. After retries,
`NANO_TASK_READBACK_COMMIT` persisted `FAILED` with no result and
`NANO_TASK_EFFECT_UNKNOWN_NO_REPLAY`.

This was a direct contradiction between forensic effect evidence and canonical process
state.

### 10. Hjalmar reissued a consumed Nano directive

The final model decision emitted the same `NANO_TASK:` directive again. Runtime corrected
the assessment field but v1.1.4 only sanitized reissued task directives for a
`COMPLETED` task. Since canonical state had already been corrupted to `FAILED`, the stale
directive survived reconciliation.

### 11. Final continuation guard — PASS, but too late

`CONTINUATION_ADMISSION_EVALUATED` correctly returned `NANO_TASK_REISSUE` and prevented
the same local task from being sent back to the target session.

The guard is defense-in-depth and remains. v1.1.5 fixes the upstream causal chain so a
correctable model deviation is sanitized before admission.

### 12. Nano UI — renderer PASS, state truth FAIL

The v1.1.4 side panel did render Nano Task data. It showed `FAILED` because that was the
corrupted canonical process state. The UI renderer itself was not the failure in this
run.

### 13. Task/directive boundary was too broad

v1.1.4 treated everything after `NANO_TASK:` as the local task. In the shakedown response,
task execution instructions and later continuation/reporting requirements were placed on
the same line, so all of them reached Nano.

v1.1.5 defines a `NANO_TASK:` directive as one dedicated line ending at the first newline.
Later continuation instructions remain target/Hjalmar context instead of Nano task text.

### 14. A2A prompt metadata sanitizer was incomplete

Background constructed `promptLanguage` and `promptPolicy` in `analysisEvidence`, but
`lib/a2a.mjs` removed them when building the outbound envelope. v1.1.5 retains both.

## v1.1.5 causal repair

1. Isolated Nano Task execution is now a separate offscreen operation.
2. Background durably checkpoints terminal task result/readback before Nano Observer or
   Hjalmar runs.
3. Advisory Nano/Hjalmar format/validation failures use audited deterministic fallbacks
   instead of restarting the whole pipeline.
4. `UNKNOWN_EFFECT` is a distinct exact-once state; it is never mislabeled as FAILED.
5. Deterministically verifiable exact literal output may close `semanticStatus` as
   `SATISFIED`; arbitrary semantics remain `UNVERIFIED`.
6. Hjalmar reconciliation sanitizes consumed task directives for both COMPLETED and
   FAILED terminal tasks.
7. Terminal Nano failure can continue with failure evidence; only PENDING/RUNNING or real
   UNKNOWN_EFFECT blocks unsafe continuation.
8. Nano Task directives are line-scoped.
9. A2A bounded evidence retains prompt language/policy.
10. The existing `NANO_TASK_REISSUE` guard remains as defense-in-depth.
