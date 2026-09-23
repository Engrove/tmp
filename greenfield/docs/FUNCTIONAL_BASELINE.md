# Functional baseline — Greenfield v1.3.6

## Required and present

- one managed ChatGPT tab per Chrome window;
- profile-global active-turn capacity with normal default `2` and operator range `1..4`;
- per-process `LOW|NORMAL|HIGH|URGENT` priority with starvation-safe 180-second aging steps;
- deterministic queue order by effective priority, ready age and ticket sequence;
- non-preemptive priority/capacity changes: active ChatGPT turns are never aborted by scheduling;
- active turn slots held through the causally paired assistant-response capture boundary;
- persisted scheduler state reconstructed before hydrated process ticks;
- profile-global rate-limit circuit breaker with serial recovery rather than simultaneous client release;
- per-affected-client first-release warning recovery using safe structural dismiss or Ctrl-F5-equivalent fallback;
- ordinary profile-global prompt spacing configurable from 0–300 seconds, independent of rate-limit recovery;
- multiple independent autonomous processes across Chrome windows;
- persistent single-owner process state and deterministic stale-callback rejection;
- exact-once/idempotent outbound prompt dispatch;
- persisted autonomous dispatched-user-turn identity;
- structurally trusted and causally paired assistant-response observation;
- manual/operator chat interleaving without autonomous response hijack;
- response completion independent of `eic.a2a.response.v1` presence/validity/status;
- dedicated Greenfield browser control projection (`ACTIVE|DONE` + `NEXT|BLOCK|OPERATOR|NONE`);
- scoped target `blockers[]` cannot directly stop an executable `CONTINUE` continuation;
- human-authority stop is represented distinctly as `OPERATOR`;
- saved missions survive extension uninstall/new extension identity in the same Chrome profile
  through a staged/readback Chrome-profile bookmark vault, with local storage as cache;
- A2A protocol parsing retained as optional structured metadata;
- explicit objective identity/lifecycle and stale-objective guard;
- isolated prompt-only Nano Task execution via one-line `NANO_TASK:` directives, with
  complexity permitted when all required input is embedded in the current prompt;
- durable terminal Nano Task checkpoint/readback before advisory analysis;
- explicit `UNKNOWN_EFFECT` exact-once ambiguity instead of false failure;
- separate prompt-only Nano Observer before fixed Hjalmar D2; its semantic fields are
  advisory derivations from the bounded prompt, not external-state knowledge;
- bounded small-context Nano/Hjalmar prompts and audited runtime fallback;
- evidence-bound Hjalmar D2 with protocol status treated as advisory metadata;
- standard Agent presentation and native EIC-A2A/1 outbound messages;
- bounded `analysisEvidence.responseObservation` and `analysisEvidence.protocol`;
- bounded external-interleave provenance in `analysisEvidence.responseObservation.externalInterleave`;
- one-shot operator instruction for exactly the next prompt;
- linked-tab/process/phase overlay;
- side-panel readback of latest Nano Task and Nano Observer evidence;
- continuation repetition is replanned instead of being mislabeled as a real blocker;
- closed autonomous response slots are producer-loss events with bounded owner-reconcile rearm;
- WAIT-only stale-session recovery: 30m -> F5, 60m -> Ctrl-F5, 90m -> Ctrl-F5, 120m -> fresh-chat session rotation;
- stale-session counter resets on every newly completed assistant response regardless of A2A/protocol/status/causal admissibility, without changing autonomous response ownership;
- continuity-first recovery and 120-minute material-idle keepalive;
- operator-controlled forensic Audit, off by default;
- volatile 25-event FIFO display with zero IndexedDB Audit writes while Audit is off;
- bounded persistent Audit retention and indexed reverse reads while Audit is on;
- Prompt API expected output-language declaration and structured output constraints.

## Response invariants

A stable assistant message is not enough. Normal autonomous response admission requires:
1. trusted structural assistant owner;
2. causal pairing to the exact user turn materialized by the current autonomous dispatch.

v1.2.1 additionally permits a bounded `CAUSAL_VISIBLE_FALLBACK` only for
`ROLE_NODE_FALLBACK` when the user turn resolves by exact ID, expected/paired ids match,
the response slot is still open, the page is visible, generation has stopped, and the same
response remains stable for at least 5 seconds / 5 reads. Hidden fragments and ordinal-only
fallback remain non-admissible.

External manual turns remain usable and auditable but are non-admissible as the autonomous
response candidate.

A2A parser results never directly transition WAITING to DONE/BLOCKED. Missing or malformed
A2A is metadata (`UNKNOWN`) and normal analysis continues.

## Nano context baseline

Knowledge boundary: `PROMPT_ONLY`. Nano has no implicit EIC/project/file/repo/artifact/tool/
browser/web/API/chat-history state. Complexity is not an admission criterion; completeness of
the current prompt is. For data-bearing tasks, `eic.greenfield.nano-task.request.v2` carries
the actual inline context. Obvious external dependencies terminate before a model call as
`CONTEXT_REQUIRED`; Nano may independently return `NANO_CONTEXT_REQUIRED:` when it detects
missing information. Either outcome returns work to EIC and is not a mission blocker.

Direct task prompt budget: 2600 chars. Nano Observer: 3400 chars. Hjalmar D2: 6200 chars.
Raw complete turn transcripts are not forwarded to the local Chrome LanguageModel.


## v1.2.0 additions

- 0–90 s operator-controlled prompt-post pause persisted in `chrome.storage.local`;
- extension-wide prompt slot coordination across Greenfield windows in one Chrome profile;
- actual last-post-time check plus short cross-window send lease before page effect;
- status-rail prompt-pause countdown;
- persistent saved mission presets (maximum 24).
