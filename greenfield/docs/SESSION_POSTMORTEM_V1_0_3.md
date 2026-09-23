# Session postmortem — v1.0.1 to v1.0.3

## Scope

This document records the Greenfield shakedown sequence that led to v1.1.0.
It is based on the supplied Audit exports plus exact package/source inspection.

## Timeline and verified conclusions

### v1.0.1

The first Greenfield shakedown exposed three independent defects:

1. Send acknowledgement uncertainty caused the same prompt to be dispatched repeatedly.
2. Chrome Prompt API creation omitted an expected output language and raised a LanguageModel error.
3. Pre-run/sidepanel errors were not guaranteed to enter the exported Audit.

The stale-callback generation fence did work after operator stop.

### v1.0.2

v1.0.2 added exact-once send fencing and deeper Audit, but the first live `SENDING`
tick never dispatched. Audit repeatedly showed `PROCESS_TICK -> PAGE_STATE_OBSERVED`
without a dispatch event.

Exact source inspection found the direct cause: `background.js` called
`sendFenceDecision()` but did not import it. The resulting `ReferenceError` occurred before
the first dispatch event and the tick itself lacked a final forensic boundary.

### v1.0.3

v1.0.3 fixed that import and added tick-level forensic error capture. The live run then
proved the transport path:

- fence evaluated;
- write-ahead dispatch persisted;
- prompt side effect issued;
- generation start acknowledged;
- no-resend fence committed;
- SENDING transitioned to WAITING with storage readback.

That defect class is therefore separated from the later control defect.

The v1.0.3 Audit export contains 1,096 parsed events (seq 11 through 1108) and nine
captured target responses. It exposed the following causal chain.

#### Nano was an observer, not a task executor

At turn 3 the operator requested a task that required a Nano answer. The local Nano stage
returned schema-valid observer JSON describing the requested multiplication but did not
perform it. The output said that Nano *was tasked* with solving `37 * 19`; it did not return
the requested answer.

The schema validator still returned `ok=true` because it checked the shape of
`eic.greenfield.nano.v1`, not semantic satisfaction of the task.

This was not merely a prompt-quality issue. v1.0.3 had only an advisory Nano observer.
The separate one-prompt Nano task harness present in the v0.12.x line had not been restored.

#### Hjalmar could turn schema validity into false progress

Hjalmar then claimed the Nano response was successfully processed/validated while
simultaneously saying the system was still waiting for Nano's answer. It emitted the same
Nano objective again. On later turns the Nano observer itself identified the observability
gap and recommended stopping redundant Nano tests, but Hjalmar still reused the stale
next prompt.

The model therefore both interpreted evidence and effectively authored control state.
There was no deterministic continuation admission invariant between Hjalmar output and
the state transition.

#### Target `BLOCKED` was not canonical

A2A continuation metadata used the local Hjalmar disposition as
`continuity.previousDisposition`. The target response's own structured
`eic.a2a.response.v1.status` was never parsed into canonical process state.

Consequently, target responses with `status=BLOCKED` were followed by new
`CONTINUATION` messages carrying `previousDisposition=CONTINUE`.

After the target explicitly instructed the runtime to terminate and not send another
continuation, the same run still advanced through turns 8 and 9.

#### Invalid Hjalmar output could enter technical recovery

Once the target was returning BLOCKED, Hjalmar also produced structurally invalid
combinations such as BLOCKED with a non-empty next prompt. The runtime classified these
as analysis failures and retried through RECOVERING. This amplified the causality error:
a canonical target BLOCKED should have prevented Hjalmar from running at all.

#### Operator stop worked

The operator stopped the run while turn 9 was ANALYZING. Audit recorded the transition
intent, storage readback, `RUN_STOPPED_COMMIT`, generation increment to 2, and overlay
clear. Manual stop therefore remained an effective final barrier.

## Root cause

The common root cause after transport repair was **missing deterministic ownership of
semantic and continuation facts**.

v1.0.3 correctly had one persisted process state owner, but critical facts inside that
state were still model-derived or absent:

- target response status was not parsed/bound;
- task execution and observer analysis were conflated;
- schema validity could be mistaken for task completion;
- objectives had no explicit identity/lifecycle;
- stale next prompts had no deterministic rejection rule;
- bounded Nano/Hjalmar evidence was not propagated in the outbound A2A envelope.

This allowed a locally generated Hjalmar `CONTINUE` to outrank newer target evidence.

## v1.1.0 solution

v1.1.0 keeps the single-owner Greenfield architecture and makes models advisers beneath
runtime invariants:

1. Parse the target's `eic.a2a.response.v1` JSON into canonical
   `CONTINUE | DONE | BLOCKED | UNKNOWN`.
2. Treat canonical target BLOCKED as a runtime barrier before Nano/Hjalmar.
3. Bind outbound `previousDisposition` only to the parsed target status.
4. Restore an explicit `NANO_TASK:` lane: fresh local LanguageModel session, no system
   prompt, exactly one prompt call, explicit request id and write-ahead state.
5. Keep Nano Observer separate from Nano Task.
6. Treat Nano/Hjalmar JSON validity as structural validation only.
7. Add Hjalmar evidence-binding checks against canonical target status and actual Nano
   Task status/result.
8. Add `objectiveId` and objective lifecycle state.
9. Reject identical/stale next objectives before transition to SENDING.
10. Propagate bounded `analysisEvidence` in the A2A continuation.
11. Persist/Audit target status parsing, Nano task write-ahead/result, evidence-binding,
    continuation admission, and disposition binding.
12. Preserve exact-once prompt send, one-shot operator instruction, per-window queues,
    overlay, deep Audit and continuity recovery.

## Acceptance boundary

The v1.1.0 module regression suite can prove these deterministic helpers and package
invariants. It cannot prove real Desktop Chrome/ChatGPT/LanguageModel behavior.
A new live shakedown remains required.
