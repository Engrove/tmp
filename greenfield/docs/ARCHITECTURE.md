# Architecture — Greenfield v1.3.0

## Nano epistemic boundary (v1.3.0)

Nano is modeled as a stateless prompt-only model endpoint. Its reasoning capability is not
artificially reduced by Greenfield; its knowledge surface is.

Invariant:

`Nano answerable inputs ⊆ current Nano invocation prompt`

Nano does not inherit the EIC session, Greenfield mission history, project state, files,
repositories, artifacts, owner routes, browser state, web/API access, previous turns or hidden
context. EIC remains responsible for reading any external owner and either handling the work
itself or embedding the exact required source material into a new Nano prompt.

The direct Nano lane has two compatible request forms:
- legacy one-line English task for self-contained work;
- `eic.greenfield.nano-task.request.v2` for data-bearing work, with
  `knowledgeBoundary=PROMPT_ONLY`, `instruction`, inline `context`, and `output`.

Admission is defense in depth. A deterministic preflight rejects obvious external-state
dependencies before any model call. Admitted tasks receive a runtime-owned prompt explicitly
stating that the prompt is the entire knowledge world. If missing information is discovered by
Nano, it must answer `NANO_CONTEXT_REQUIRED: ...`. Both paths produce terminal
`CONTEXT_REQUIRED` evidence and return control to EIC without blocking the mission or replaying
the same task.

Nano Observer follows the same epistemic rule. It may derive `summary`, `intent`,
`materialFacts`, `uncertainties`, `continuityRisk` and `recommendedFocus` only from bounded
fields actually serialized into its own prompt. Those values remain advisory local judgments,
never owner/project/runtime truth.

## Greenfield control plane (v1.2.3)

The browser loop has a dedicated control projection separate from EIC-A2A evidence fields:

`GREENFIELD_STATE = ACTIVE | DONE`

`GREENFIELD_ACTION = NEXT | BLOCK | OPERATOR | NONE`

Target `status`, `blockers[]` and `nextSuggestedAction` remain response/evidence metadata.
`blockers[]` are claim-scoped and cannot directly set a terminal browser phase. The runtime
resolves a Greenfield control action after Hjalmar/runtime reconciliation and before terminal
phase handling. An executable target `CONTINUE` can recover a model-level false `BLOCKED` into
`NEXT`; the original Hjalmar disposition and override reason remain audited. A real human
authority requirement becomes `OPERATOR`, exact-once unknown effect becomes `BLOCK`, and
mission satisfaction becomes state `DONE`.

This projection matches Greenfield Works semantics: execution/continuation state is distinct
from domain blockers, while Greenfield Works itself remains continuity/index truth rather than
repo/runtime/domain truth.


## Cross-session rotation (v1.2.3)

`ROTATING` is a non-terminal process phase. Rotation changes the ChatGPT conversation but does
not change `processId`, `runId`, canonical mission text or mission identity. It increments
`generation`, `sessionSeq` and turn ownership so callbacks from the prior chat are stale.

Rotation may be armed by:
- explicit EIC `sessionAction=ROTATE_SESSION_NOW`;
- stale WAIT exhaustion after the 30/60/90 minute F5/Ctrl-F5 ladder;
- repeated failure to reattach a missing managed tab.

The runtime resolves the target GPT landing surface from the live managed `Tab.url` first and
uses the persisted process `gptRoot` only as fallback. It navigates/reuses the managed tab when
possible and creates a replacement tab only when the original is gone. A newly opened target
must expose a fresh empty ChatGPT conversation before the persisted `SESSION_ROTATION` envelope
is dispatched.

The rotation envelope carries continuation state only. It says `resumeFromOwners=true`,
`replayCompletedWork=false`, and requires the receiving EIC to reconstruct current position from
Greenfield Works and fresh domain/effect owners. A prompt dispatch with unresolved exact-once
effect is a hard boundary and is not rotated/replayed blindly.

## Saved mission persistence owner (v1.2.2)

`chrome.storage.local` is a cache, not the durable saved-mission owner. The durable browser-side
preset owner is a versioned folder in the Chrome profile bookmark store. Each mission is written
through a staging folder, read back, committed, deduplicated and bounded to 24 records. Delete is
followed by durable readback. On startup, an empty local cache is hydrated from the vault; a
legacy local-only v1.2.1 set is migrated on first v1.2.2 load.

This owner is independent of the Greenfield extension installation and extension ID but not of
the Chrome profile itself. Greenfield Works remains the separate owner for canonical
five-sentence mission chronology and Greenfield session receipts.

## Process ownership

One Chrome window -> one managed ChatGPT tab -> one autonomous process -> one canonical
state machine -> one keyed execution queue. Separate windows never share process execution
ownership.

Canonical loop:

`SENDING -> WAITING -> ANALYZING -> SENDING`

Terminal phases are `BLOCKED`, `DONE`, `STOPPED`, `AUDIT_FAILURE`. `DONE` is a controller
decision reached from `ANALYZING`; protocol metadata never performs a direct
`WAITING -> DONE` transition.

## SEND: exact-once dispatch and causal anchor

Prompt dispatch is write-ahead fenced by dispatch identity and content `documentId`. After
ChatGPT materializes the sent prompt, runtime records the concrete user-turn id returned by
the content bridge as `lastPrompt.dispatchedUserTurnId` plus its ordinal fallback.

This dispatched user turn is the causal anchor for the entire WAIT phase.

## WAIT: structural trust plus causal pairing

`content.js` extracts canonical user/assistant entries and exposes two views:

- the latest visible user/assistant turn;
- `autonomousTurn`, resolved from the expected dispatched user-turn id (or persisted ordinal
  fallback) and the assistant turn occurring after that user and before the next user.

A response is eligible for stability only when:
- content bridge version is current;
- `documentId` is present;
- expected autonomous user-turn identity exists;
- paired user-turn identity exists and equals the expected identity;
- an assistant is present inside that causal turn;
- assistant owner provenance is structurally trusted, OR the response qualifies for the stricter v1.2.1 exact-ID visible causal fallback;
- transported text length is coherent;
- the assistant is no longer generating.

Response candidate identity binds:
`documentId + pairedUserTurnId + assistantMessageId + ownerKind + hash + assistantCount`.

Manual/operator turns may appear later in the same conversation. They are observable and
audited as `EXTERNAL_TURN_INTERLEAVED`, but their assistant replies cannot replace the
causally paired autonomous response.

Observation-quality uncertainty is transient: it stays in WAITING as
`RESPONSE_OBSERVATION_HELD`. It is never translated into a semantic protocol failure.

v1.2.1 adds one bounded renderer-regression escape hatch: an assistant with
`ROLE_NODE_FALLBACK` may terminalize only when the dispatched user turn resolves by exact
`USER_TURN_ID`, paired/expected ids match, the response slot remains open, the document is
visible, generation is complete, and the same response is stable for at least 5 seconds and
5 reads. Hidden fallback fragments, ordinal-only reconciliation, causal mismatches and
closed response slots remain fail-closed. Coherent duplicate renderer nodes with the same
message id and identical text may instead establish structural `COHERENT_ROLE_REPLICA`
ownership.

## CAPTURE: response completion independent of protocol

After a causally paired response is stable, runtime captures the raw response and optionally
runs `parseTargetResponse()`.

Protocol parse outcome is metadata:
- structured/full valid;
- degraded/repaired;
- absent/invalid.

`eic.a2a.response.v1` presence, validity and status are not continuation-admission
requirements. A missing schema anchor therefore cannot by itself produce `BLOCKED`.

Captured response provenance persists:
`documentId`, assistant `messageId`, owner kind/trust, expected and paired autonomous user
turn, causal match, visibility, text length, assistant count, candidate identity and
protocol parse mode.

## ANALYZING

1. optional one-line `NANO_TASK:` executes through a dedicated exact-once local-model lane;
2. terminal Nano Task evidence is durably persisted/read back;
3. Nano Observer receives compact bounded evidence;
4. Hjalmar D2 receives compact bounded runtime/protocol/Nano evidence;
5. runtime reconciles factual mirror fields and removes consumed Nano directives;
6. deterministic continuation admission applies runtime invariants;
7. controller decision selects `SENDING`, `DONE`, or a genuine terminal boundary.

Protocol status is advisory evidence only. Hjalmar/controller must independently decide
whether the actual objective is pending, satisfied, failed or blocked.

## Manual chat interleaving

Manual messages remain normal ChatGPT behavior. They are not prohibited, paused or rewritten
by the autonomous controller.

If a manual user/assistant turn appears while the process is waiting or recovering, runtime:
- records the external interleaving;
- preserves the current autonomous dispatched-user-turn anchor;
- continues observing the causally paired autonomous response;
- never feeds an unrelated manual assistant reply into autonomous protocol parsing or
  controller `lastResponse`.

The latest distinct external pair is persisted in process-scoped `responseInterleave` state
for the current autonomous turn. When the autonomous response is captured, that bounded
evidence is copied into `lastResponse.observation.externalInterleave` and then into the next
`analysisEvidence.responseObservation.externalInterleave`. It is cleared when the next
autonomous turn enters `SENDING`.

No production delay is added for this evidence path. Deterministic race coverage is provided
by a staged fixture that changes the latest manual turn and global assistant count between
response-stability reads.

## A2A

Outbound autonomous prompts remain `eic.a2a.message.v1` / `EIC-A2A/1` for rich structured
coordination. Target response JSON is preferred, not mandatory.

Outbound `continuity.previousDisposition` is the prior controller/Hjalmar disposition.
Protocol disposition is transported separately in `analysisEvidence.protocol`.

`analysisEvidence.responseObservation` is runtime-produced evidence, not target-model
authored data.

## Chrome Nano small-context policy

Nano Task, Nano Observer and Hjalmar have separate bounded prompt budgets. Raw previous
prompts and full assistant transcripts are not forwarded to local models. When no structured
target payload exists, Nano receives only a bounded response excerpt. This keeps the small
local model focused on current evidence.

## Audit — v1.1.12

Audit is observability, not a second state machine.

Persistent Audit is off by default. The runtime always emits lightweight event headers into
a per-window volatile FIFO capped at 25 entries; when persistence is off those headers are
the only Audit history and no IndexedDB Audit write is attempted.

When the operator enables persistent Audit:

- full eligible events are written to IndexedDB;
- retention is capped at 5,000 events;
- high-frequency unchanged polling events are sampled/coalesced;
- time-bearing indexes support bounded reverse cursor reads;
- the legacy global sequence counter is not used;
- ordinary side-panel renders still consume the FIFO rather than persistent history.

`PAGE_STATE_OBSERVED` transports diagnostic identity/hash/length/signal metadata but does not
duplicate raw assistant response text on every poll.

See `WIRE_TRACE_V1_1_12.md` and `AUDIT.md`.

## WAIT liveness and no-progress recovery — v1.1.12

The controller keeps the v1.1.10 producer-loss and continuation-repeat repairs, while the
browser stale-session ladder is now a separate WAIT-only liveness mechanism.

1. **Causal response slot closed by a later user turn before the autonomous assistant exists.**
   This remains `AUTONOMOUS_RESPONSE_PRODUCER_LOST`. The lost turn is not replayed. Runtime
   re-arms one owner-reconcile/alternative continuation in `SENDING`.
2. **Hjalmar/controller proposes the same `nextPrompt` as the active objective.**
   This remains recoverable no-progress. Exact-once Nano/effect ambiguity remains fail-closed,
   while pure repetition is replanned.
3. **ChatGPT returns no completed assistant response while an acknowledged prompt is WAITING.**
   Runtime keeps a persisted `waitingRefresh.staleSince` anchor plus the last completed
   assistant marker. Escalation is based on time since that stale anchor:
   - 30m: `F5_30`, reload with `bypassCache:false`;
   - 60m: `CTRL_F5_60`, reload with `bypassCache:true`;
   - 90m: `CTRL_F5_90`, reload with `bypassCache:true`;
   - 120m: `STALE_SESSION_120M_EXHAUSTED` -> `BLOCKED`.

Every newly completed assistant response resets `staleSince`, clears the refresh stage and
increments the reset counter. This reset is deliberately protocol- and causality-agnostic:
an external/manual assistant response demonstrates renderer/model liveness but remains
non-admissible as the autonomous response unless the normal causal binding also passes.

`generating=true` is not a completed response. Reload-only DOM identity churn with unchanged
assistant count/hash does not reset the stale clock.

The stale ladder is invoked only from unresolved `WAITING` exits. Internal `RECOVERING`,
`ANALYZING`, Nano/Hjalmar work and protocol metadata do not advance this browser-stale
counter.

Reload stages never resend the autonomous prompt and are persisted before the browser effect.



## Global prompt-post coordinator — v1.2.0

Per-window process state remains independent. Prompt-post pacing is the deliberate exception:
`chrome.storage.local` contains one extension-wide gate record shared by all windows in the same
Chrome profile. The background service worker serializes reservations and lease mutations.
A pending prompt keeps only its own reservation receipt. The page-effect path still obeys the
existing exact-once send fence; the global gate is a pacing owner, not a delivery owner.
