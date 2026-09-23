# EIC Autonom Agent Greenfield v1.5.3

Chrome MV3 extension for continuity-first autonomous work in operator-owned ChatGPT
sessions. One Greenfield Chrome window is a **serial mission worker**: it owns at most one
managed ChatGPT tab at a time, but it can carry an ordered work queue of multiple saved
missions and rotate them through fresh ChatGPT conversations. Multiple Greenfield windows
remain supported through the profile-global capacity scheduler.

Inner mission loop:

`SEND -> WAIT -> CAPTURE -> [NANO_TASK] -> NANO_OBSERVER -> HJALMAR_D2 -> ADMISSION -> [MISSION_PAUSE] -> CONTINUE`

Worker loop:

`SELECT MISSION -> FRESH CHAT -> RUN QUANTUM -> OWNER CHECKPOINT -> PARK/TERMINAL -> SWITCH -> NEXT MISSION`



## v1.5.2 worker isolation, queue sets and pause precedence

v1.5.2 replaces Chrome numeric `windowId` as persistent worker identity. Each live
Greenfield window receives a random `workerId` in `chrome.storage.session`; queue and process state
are stored under that worker identity. A newly opened Greenfield window therefore starts with a
new empty queue and cannot auto-adopt an orphan queue, a legacy per-window queue, or another
worker's process snapshot. `windowId` is only the current browser attachment.

The queue registry is now serialized and metadata-only. Process lookup reads only currently bound
workers, owner tokens fence `workerId + processId + runId + generation`, and side-panel mutations
must present the current worker binding. Stale queue wake alarms are worker-fenced as well.

Named **Sparade kö-set** are profile-global configuration templates. Saving a set stores only
mission identity/text, label, priority, quantum and order. Applying a set to a stopped worker creates
fresh `READY` queue items with new IDs and deliberately strips process snapshots, resume records,
pause state, delegation state and errors, so a reusable set cannot transport runtime ownership
between workers.

`PAUSE_PROCESS` is now stronger than queue quantum/yield scheduling. A queued response requesting
(for example) `pauseSeconds: 600` remains on the same mission and enters the normal mission-pause
not-before path; quantum exhaustion cannot park it and switch to another mission. `YIELD_TO_QUEUE`
remains the explicit queue-switch control.

Automatic v1.3.9 orphan-queue rebind and legacy window-key migration are intentionally superseded by
this isolation model. Legacy bytes remain untouched/quarantined rather than being attached to a
fresh worker. Use named queue sets to persist reusable queue configuration across new workers.

See `docs/WORKER_ISOLATION_QUEUE_SETS_PAUSE_V1_5_1.md` and `docs/RELEASE_NOTES.md`.

## v1.5.0 scheduler re-arm liveness

v1.5.0 fixes a same-process capacity deadlock discovered in a real Greenfield Chrome session.
When an acknowledged autonomous turn loses its response producer, or when the bounded idle
keepalive replaces an abandoned turn, Greenfield now cancels the obsolete global capacity
ownership **before** arming a continuation with a new prompt hash. This preserves the scheduler's
strict prompt-hash mismatch guard while preventing the worker from remaining forever in
`GLOBAL_CAPACITY_ACTIVE_PROMPT_MISMATCH`. The SENDING path also contains a bounded self-heal:
when the same process is blocked only by an obsolete active prompt hash and the replacement prompt
has not crossed the effect boundary, Greenfield cancels the stale slot and retries.

The release also removes an accidental development-only `tmp_probe.mjs` file and adds focused
regression coverage for prompt replacement, producer-loss recovery and idle-keepalive re-arm.


## v1.4.0 delegated mission spawning

v1.4.0 adds AI-requested mission creation without letting a supervising Greenfield create new
durable queue work in its own Chrome session.

A queued EIC response may emit up to three `missionDelegations`. Each request has a stable
`requestId`, mission text, bounded label, priority and relation
`SUPPORTS_CURRENT|UNBLOCKS_CURRENT`. The supervising worker only persists the delegation request.
It does **not** add the mission to its own queue, open another ChatGPT conversation or yield its
current work merely because it delegated something.

Another already-running **queue-managed Greenfield worker in a different Chrome window** accepts
the pending request on that worker's own process tick and inserts the mission into that worker's
own durable queue. If no eligible worker exists, the request remains pending in
`chrome.storage.local`; it is never silently redirected back to the supervising worker.

Delegation is idempotent by `requestId`, survives restart/update, and is deduplicated even when
the delegated child already exists in terminal queue history. Child priority is capped at the
source mission priority. A delegated child carries provenance back to the supervising queue item.
If an `UNBLOCKS_CURRENT` child reaches `DONE`, Greenfield makes the still-blocked source item
immediately retryable when its source worker window is still live; the existing blocker cooldown
remains the fallback when the source window has been recreated.

`DONE` remains terminal and never re-enters the queue. Temporary bounded work that genuinely
belongs inside the supervising mission is still allowed in the supervising Chrome Greenfield
session and should not be emitted as a durable `missionDelegations` entry.

See `docs/DELEGATED_MISSION_SPAWNING_V1_4_0.md` and `docs/RELEASE_NOTES.md`.


## v1.3.9 queue continuity repair

**Superseded in v1.5.2:** automatic orphan rebind and legacy per-window migration described
below are retained here only as release history and are no longer runtime behavior.

v1.3.9 changes `BLOCKED` from a queue-terminal outcome into a temporary parked state.
A controller-level blocker ends the current ChatGPT process turn, but the mission remains in
the active work queue together with its checkpoint. Other runnable missions are selected first.
The blocked mission becomes eligible again after a bounded cooldown equal to the configured
queue priority-aging step, which prevents a persistent blocker from creating a hot retry loop.

`DONE` remains terminal. `STOPPED` remains terminal. Audit/integrity failure is recorded as
terminal `FAILED` history rather than reusing the `BLOCKED` queue meaning.

The work queue is now additionally mirrored in a profile-local durable queue registry. On a
browser/app restart where Chrome creates a new window id, an orphaned queue is rebound to the
new live worker window instead of appearing empty. Existing v1 queue records are migrated on
read. Retryable historical `BLOCKED` entries from v1.3.7/v1.3.8 are moved back into the active
queue; terminal `DONE` and audit failures remain history.

The **Grundparametrar för uppdragskö** save path now captures the form values before the busy
render rewrites the controls. The resulting normalized settings are written to
`chrome.storage.local` and read back through the existing operator-settings contract.

See `docs/BLOCKED_QUEUE_DURABILITY_V1_3_9.md` and `docs/RELEASE_NOTES.md`.


## v1.3.8 live response/capacity repair

v1.3.8 fixes two independent v1.3.7 runtime defects while preserving the serial per-window
mission queue:

- global capacity now represents live managed window/tab ownership rather than durable process
  history, so closed/detached ghost records are pruned during hydration and released on surface
  close;
- assistant reasoning/lifecycle chrome such as `Working...` or `Arbetade i 51 sekunder >` is
  excluded from semantic response completion, preventing a short hidden renderer fragment from
  masking the later complete EIC-A2A response and its `PAUSE_PROCESS` control;
- observed-effect scheduler adoption is explicitly fenced to already-existing send effects and
  reports over-capacity truth instead of acting as a general admission bypass.

See `docs/RESPONSE_AND_CAPACITY_LIVENESS_V1_3_8.md` and `docs/RELEASE_NOTES.md`.

## v1.3.7 serial multi-mission worker queue

v1.3.7 adds a per-Chrome-window work queue built from the existing saved-mission vault.
The **Uppdragskö** view lets the operator add multiple saved missions, order them, assign
`LOW|NORMAL|HIGH|URGENT` priority, and set a per-mission maximum interaction quantum.
Only one mission in a worker is active at a time.

A quantum counts completed causally paired ChatGPT interaction cycles. Retry/recovery work
is not intended to consume the mission quantum. Greenfield identifies the final permitted
interaction before sending it and adds an explicit queue-turn control to the EIC-A2A
prompt. That prompt requires EIC to persist durable mission state/knowledge to the correct
owner surfaces, use route-native readback where available, omit transient chat/hidden
reasoning, and leave a restart-safe handoff whenever the mission will continue later.

Historical v1.3.7 behavior moved `DONE`, controller-level `BLOCKED`, `STOPPED`, and
audit-failure terminal outcomes out of the active queue into history. **Current v1.3.9+ behavior
supersedes that part:** `BLOCKED` is temporary queue parking and remains retryable, while
`DONE`, `STOPPED`, and audit/integrity `FAILED` remain terminal. A normal scoped blocker in
response evidence is not by itself a queue-terminal signal; the Greenfield/Hjalmar control
decision still owns process disposition.

### Mission switching and isolation

Mission switching reuses the existing managed Chrome tab but **does not reuse the previous
ChatGPT conversation**. Greenfield navigates the tab to the configured EIC GPT root,
verifies that the target chat has zero user turns and an empty/ready composer, and only then
resumes the selected mission.

The optional Ctrl-F5-equivalent step is implemented with
`chrome.tabs.reload(..., {bypassCache:true})` **after navigation**. It is a browser preflight,
not the isolation boundary. The fresh ChatGPT conversation is the isolation boundary.

Before an inter-mission navigation, the worker can wait a configurable minimum switch
delay. This is separate from the existing profile-global prompt-post delay and is intended
to avoid bursty session/bootstrap traffic when work is rotated.

### Adjustable global operating parameters

Operational tuning is kept in the application rather than requiring source edits:

- profile-global prompt-post delay: `0..300 s`;
- profile-global maximum active Greenfield turns: `1..4`;
- queue default mission quantum: `1..50` completed interactions;
- queue priority-aging step: `30..3600 s`;
- minimum delay before inter-mission navigation: `0..300 s`;
- hard reload after fresh-chat navigation: on/off;
- post-reload settle time: `0..30 s`.

Structural safety limits remain bounded in code, but normal operating values are persisted
as operator settings in the Chrome profile.

The profile-global scheduler and v1.3.5 rate-limit circuit breaker remain active above the
worker layer. A practical conservative start is therefore several queued missions inside
one worker and profile-global capacity `1`; the operator can later raise capacity and use
multiple Greenfield windows without changing the queue design.

### Verification boundary

The release package includes unit/static regression coverage for the queue contract,
priority/aging, quantum checkpoint boundary, persistence/readback, fresh-chat switching,
hard-reload ordering, EIC `YIELD_TO_QUEUE`, terminal queue removal wiring, and the retained
multi-window scheduler. Live Desktop Chrome/ChatGPT behavior still requires an operator
installation test because source tests cannot prove remote ChatGPT rate-limit or browser
runtime behavior.

No required v1.3.7 queue capability is intentionally deferred to a later version.

## v1.3.6 priority capacity scheduler

v1.3.6 changes normal multi-window operation from unbounded concurrent ChatGPT turns to a
profile-global capacity scheduler. The default normal capacity is **2 active turns** and the
operator may set `1..4` from the side panel. One Chrome window still owns at most one Greenfield
process and every individual process remains serial.

The scheduler owns a turn slot from immediately before a prompt may cross the ChatGPT side-effect
boundary until the causally paired assistant response is captured. The existing short global send
lease still serializes the actual DOM/post effect. Local Nano/Hjalmar analysis does not consume a
ChatGPT turn slot.

Priority is per Greenfield process: `LOW`, `NORMAL`, `HIGH`, or `URGENT`. It is deliberately
non-preemptive: changing priority never interrupts an already active ChatGPT turn. Waiting work is
ranked by:

`effectivePriority DESC -> readySinceMs ASC -> ticketSeq ASC -> processId`

To make priority starvation-safe, each full **3 minutes** of queue wait raises effective priority
one level, capped at `URGENT`. A `LOW` waiter therefore reaches the top effective level after
**9 minutes**. Once effective priorities tie, the older ready/ticket order wins. Later
high-priority arrivals therefore cannot indefinitely starve an older low-priority waiter.

The rate-limit circuit breaker from v1.3.5 remains authoritative over capacity:

- `NORMAL`: effective capacity equals the operator setting (`1..4`, default `2`);
- `COOLDOWN`: effective capacity is `0` for new turns;
- `SERIAL_RECOVERY`: effective capacity is `1`;
- lowering capacity is non-preemptive, so already active turns are not aborted;
- after recovery completes, capacity returns to the operator-configured normal value.

Capacity waiters are persisted in `chrome.storage.local` and service-worker hydration reconstructs
both waiters and active-turn ownership before hydrated process ticks. Capacity denial no longer
uses the previous fast ~1 second polling pattern; slot release, priority/capacity change and the
existing watchdog provide wake-up paths.

See `docs/PRIORITY_CAPACITY_SCHEDULER_V1_3_6.md`.

## v1.3.5 profile-global rate-limit circuit breaker

v1.3.5 adds a profile-global recovery path for ChatGPT request-throttling warnings. A detected
warning immediately blocks prompt effects across all active Greenfield processes in the same
Chrome profile. Recovery never releases every client at once: one client holds the global send
lease, performs its first-release recovery preflight, posts at most one prompt, and only after the
next serialized spacing interval may another client proceed.

Key behavior:

- cooldown escalation is `180 -> 360 -> 720 -> 900` seconds for distinct warnings inside the
  30-minute escalation window;
- the serialized success ramp uses `180 -> 150 -> 120 -> 90 -> 90 -> 90` second spacing before
  returning to normal global prompt rhythm;
- every process affected by the warning must complete one first-release preflight for that
  rate-limit epoch;
- the preflight may dismiss the warning only when a blocking throttle modal has exactly one
  structurally safe neutral action; the visible acknowledgement wording is **not** a selector;
- if safe dismissal is unavailable or cannot be verified, Greenfield performs a hard
  `chrome.tabs.reload(..., {bypassCache:true})` (Ctrl-F5 equivalent) for that client and waits for
  composer/readback readiness before it may post;
- any new warning during recovery creates a new epoch, clears prepared/recovered state, cancels the
  current send lease and returns the entire profile to cooldown;
- the ordinary operator-controlled prompt spacing remains separate and is now configurable
  from `0..300` seconds.

The warning detector uses modal structure plus multilingual throttle/request signals. It does not
key on a literal button label such as a Swedish or English acknowledgement phrase. This package
does not claim a documented ChatGPT server quota or a live-throttle acceptance result; Desktop
Chrome/ChatGPT warning acceptance remains an operator-run installation test.

See `docs/RATE_LIMIT_RECOVERY_V1_3_5.md`.

## v1.3.3 canonical A2A partial-response hold

v1.3.3 fixes a live Desktop Chrome regression where a structurally trusted hidden
`EXPLICIT_TURN_SHELL` could stabilize on the exact 42-character prefix
`{"schema":"eic.a2a.response.v1","status":"` before the rest of the EIC response had
become observable. That fragment was then parsed as terminal protocol absence, so
`sessionAction=ROTATE_SESSION_NOW` was never seen and Greenfield incorrectly kept the
current ChatGPT session.

The response-stability gate now recognizes an opened canonical `eic.a2a.response.v1`
object whose top-level JSON object has not closed yet and holds it as
`OBSERVATION_CANONICAL_A2A_RESPONSE_INCOMPLETE`. This is deliberately narrower than "all invalid
protocol": complete malformed responses still reach the response parser, complete hidden
trusted A2A responses still terminalize normally, and ordinary protocol-absent prose keeps
the existing completion behavior.

Regression coverage includes the exact 42-character live prefix, a complete hidden trusted
`ROTATE_SESSION_NOW` response, and ordinary protocol-absent prose. See
`docs/RESPONSE_STABILITY_V1_3_3.md`.

## v1.3.2 Session Health + compact A2A transport

v1.3.2 adds **advisory, browser-observed Session Health telemetry** without giving counters,
latency or Nano authority to rotate a session by themselves. The purpose is to make proactive
`ROTATE_SESSION_NOW` decisions better informed while preserving the v1.3.1 collaboration,
owner-boundary, exact-once, pause and continuation behavior.

The A2A envelope now carries a compact `sessionHealth` capsule with:

- prompts posted in the current ChatGPT session;
- Greenfield-managed prompt/response character counts as a bounded context-load proxy;
- time-to-first-observed-response (`ttfrMs`) measured from the **actual prompt-post boundary**;
- a per-session clean TTFR baseline and relative ratio once enough clean samples exist;
- response completion time after first observed response activity;
- latency trend, recovery churn, bounded pressure band and explicit contributing signals.

Mission pause and the profile-global 0–90 second prompt-post gate are excluded from TTFR because
the clock starts only after the prompt has actually crossed the post boundary. Recovery-tainted
samples are retained for chronology but do not seed the clean latency baseline.

`generation`, `turn` and `sessionSeq` remain lineage/fencing fields, not noise scores. Session
Health resets on session rotation and is advisory only: `LOW|WATCH|ELEVATED|HIGH` never causes an
automatic rotation by itself. EIC must corroborate proxy pressure with semantic drift, repetition,
contradiction, stale assumptions or other material session-health evidence. Nano may be used as a
stateless prompt-only second opinion when ambiguity remains.

A2A prompts are now emitted as **minified JSON** (`JSON.stringify(envelope)`) because Greenfield
sessions are machine-to-machine conversations. No v1.3.1 response-contract semantics were removed
for this change; whitespace was removed and the additive Session Health capsule/control hint was
added. See `docs/SESSION_HEALTH_V1_3_2.md`.

## v1.3.1 timed mission pause

v1.3.1 adds an EIC-controlled mission-level pause for cases where **time itself is the next
dependency**. The receiving EIC session may return `sessionAction=PAUSE_PROCESS` with integer
`pauseSeconds` from 300 through 86400, `status=CONTINUE`, and a non-empty
`nextSuggestedAction`.

This is deliberately separate from the existing profile-global 0–90 second prompt-post gate:

- mission pause belongs to one Greenfield process and persists as process state;
- the next continuation prompt is composed and hashed before the process enters `PAUSED`;
- a one-shot `chrome.alarms` alarm is the normal wake signal, while persisted pause state is
  the owner and recreates the alarm on runtime/browser hydration;
- wake time is `not-before / best-effort`: Chrome may deliver later and does not wake a sleeping
  device;
- after wake the process returns to `SENDING`, where the ordinary 0–90 second global post gate
  still applies;
- the side panel shows the mission-pause countdown and permits an explicit early resume.

The A2A prompt teaches this capability in a compact machine-readable
`responseContract.pauseControl` plus one short instruction in `responseContract.note`.
See `docs/TIMED_MISSION_PAUSE_V1_3_1.md`.

### Mission vs objective

`mission` remains the invariant full operator mandate. `objective` is the bounded current
work package. v1.3.1 no longer duplicates the full mission into `objective` on
`MISSION_START`; it uses a compact bootstrap objective telling EIC to read fresh owner state and
select the first bounded work package. Continuations keep carrying the specific next objective.

## v1.3.0 Nano prompt-closure

v1.3.0 corrects the epistemic boundary for Chrome Nano. Nano is not restricted to trivial
arithmetic. It may perform any reasoning the local model can handle, provided every fact and
data item needed for the answer is present in the one prompt sent to that Nano invocation.

Nano has no implicit access to EIC state, project state, files, repositories, artifacts,
mailboxes, owner routes, tools, browser state, web/API data, chat history, previous turns or
hidden context. A task that depends on such information must stay in EIC until EIC has read the
owning source and, when Nano is still useful, embedded the required content into the Nano prompt.

The direct task lane now uses `PROMPT_CLOSED_EXECUTION_V2` and `PROMPT_ONLY`:

- simple legacy one-line tasks remain supported;
- data-bearing/complex tasks should use one-line
  `eic.greenfield.nano-task.request.v2` JSON with `instruction`, inline `context`, and `output`;
- obvious external-state dependencies are rejected before `LanguageModel.prompt()` and become
  terminal Nano status `CONTEXT_REQUIRED` with zero prompt calls;
- Nano itself is instructed to return `NANO_CONTEXT_REQUIRED: <missing information>` instead
  of guessing when the deterministic preflight cannot see a missing dependency;
- `CONTEXT_REQUIRED` does not stop the Greenfield mission. EIC continues with owner/context
  retrieval or emits a new, fully prompt-closed Nano task;
- complexity alone is never a Nano admission/rejection criterion;
- Nano Observer remains advisory and may only reason over the bounded fields explicitly placed
  in its own prompt.

This is an epistemic closure rule, not a model-capability claim.

## v1.2.3 cross-session continuity

v1.2.3 extends the v1.2.2 Greenfield control alignment with unattended cross-session
continuity. A new ChatGPT conversation is a session rotation of the same mission, not a new
mission. Greenfield preserves mission identity, increments sessionSeq, derives the custom-GPT
root from the managed tab URL when available, and resumes from Greenfield Works plus fresh
owner state instead of replaying completed work.

- EIC may return `sessionAction=ROTATE_SESSION_NOW` to request an immediate proactive rotation.
- EIC may return `sessionAction=STOP_PROCESS` or `status=DONE` to terminate the autonomous mission.
- Proactive rotation is intended for material context-noise, context-drift, contradiction,
  stale-assumption, overload or session-health risk before the current chat actually fails.
- Runtime stale recovery is now 30m F5 -> 60m Ctrl-F5 -> 90m Ctrl-F5 -> 120m session rotation.
- A detached managed tab is reattached when unambiguous; repeated failed reattachment rotates
  to a fresh chat on the same GPT surface.
- Rotation is exactly-once bounded: unresolved prompt-send effects are never blindly replayed,
  and the old chat cannot reclaim continuation ownership after rotation generation/sessionSeq
  advance.
- The fresh chat receives a `SESSION_ROTATION` continuation envelope with the same mission text
  and explicit no-replay semantics.

The v1.2.2 control-plane and saved-mission persistence behavior remains in force below.

v1.2.2 separates Greenfield browser-loop control from domain claim limitations and aligns
the extension with the Greenfield global contract and Greenfield Works execution-state model.

- Browser control is explicit: `GREENFIELD_STATE=ACTIVE|DONE` and
  `GREENFIELD_ACTION=NEXT|BLOCK|OPERATOR|NONE`.
- `blockers[]` in an EIC-A2A target response are scoped evidence/claim limitations. They do
  not directly stop the browser loop.
- `status=CONTINUE` plus a non-empty `nextSuggestedAction` is an executable continuation
  candidate. If Hjalmar returns `BLOCKED` only because blocker text was present, the runtime
  records the Hjalmar result and safely projects the executable target continuation to `NEXT`.
- `OPERATOR` is reserved for actual human-authority requirements. `BLOCK` is reserved for a
  genuine autonomous hard stop such as exact-once `UNKNOWN_EFFECT` or no executable next step.
- `DONE` is a separate mission state and is not inferred from blocker text.
- Saved mission presets use `chrome.storage.local` only as a cache. Their durable owner is a
  versioned Chrome-profile bookmark vault, so uninstalling Greenfield and installing a fresh
  extension identity in the same Chrome profile can restore the saved missions.
- Greenfield Works remains the owner of mission-definition chronology, session receipts and
  derived execution state. The bookmark vault is only the browser-side saved-preset owner and
  never substitutes for Greenfield Works or domain owner truth.

The durable bookmark vault is intentionally bounded to 24 saved missions, uses staged
write/readback before commit, and requires readback after delete. Persistence is bounded to the
same Chrome profile/bookmark data; deleting that profile or its bookmark data removes the vault.

## v1.2.1 governing invariants

v1.2.1 hardens response ownership against current ChatGPT renderer shapes without weakening
causal isolation. Structural owner proof remains preferred. A visible `ROLE_NODE_FALLBACK`
can only use the slower exact-ID causal fallback when the autonomous response slot is open
and the same response remains stable for at least 5 seconds / 5 reads. Hidden fragments,
ordinal-only recovery and later manual turns remain fail-closed. Duplicate coherent renderer
replicas are deduplicated by role/message id, and unchanged linked-tab overlay state no longer
emits repeated observation-time Audit sync/render events.

- Response completion is a runtime/DOM fact, not an A2A-protocol fact.
- `eic.a2a.response.v1` is preferred structured metadata but is optional. VALID, INVALID,
  malformed or ABSENT protocol never blocks continuity by itself.
- Protocol `CONTINUE | DONE | BLOCKED` is advisory evidence for Hjalmar/controller
  reasoning; it is not a direct phase-transition command.
- A process reaches `DONE` only from the controller decision in `ANALYZING`, never directly
  from a protocol status observed in `WAITING`.
- Every autonomous dispatch persists the concrete user-turn identity materialized in
  ChatGPT. A response is autonomous only when the observed assistant turn is causally
  paired with that exact user turn.
- Manual/operator chat turns are fully allowed. They are audited as external interleavings
  and cannot replace the autonomous response candidate.
- Response candidate identity binds document, expected/paired autonomous user turn,
  assistant message, owner kind, text hash and assistant count.
- Structural owner trust is necessary but not sufficient: causal user-turn pairing is also
  required before response stability can terminalize.
- Incomplete/untrusted/unpaired observations remain `WAITING` and are audited as
  `RESPONSE_OBSERVATION_HELD`.
- A later user turn that closes the autonomous response slot before a paired assistant
  response is classified as producer loss; the controller re-arms with an owner-reconcile
  alternative continuation instead of waiting forever.
- Repeated `nextPrompt == current objective` is a recoverable no-progress condition, not a
  real blocker. The controller adopts safe newer target guidance or emits a bounded
  alternative-continuation prompt while preserving exact-once/evidence barriers.
- Stale-session recovery applies only while an acknowledged target prompt remains in
  `WAITING`: 30m -> F5, 60m -> Ctrl-F5, 90m -> Ctrl-F5, 120m -> fresh-chat session rotation.
  Every newly completed assistant response resets this stale clock regardless of protocol,
  response type or autonomous causal admissibility; the reset is liveness evidence only
  and does not change autonomous response ownership.
- Accepted response provenance is serialized into bounded
  `analysisEvidence.responseObservation`; protocol parse state is carried separately in
  `analysisEvidence.protocol`.
- Exact-once page dispatch remains write-ahead fenced and no blind resend is allowed.
- `NANO_TASK:` is line-scoped, English, exact-once and uses a fresh local LanguageModel
  session. Terminal task evidence is durably committed/read back before advisory models.
- Chrome Nano is treated as a small-context model. Nano/Hjalmar receive compact bounded
  evidence rather than raw previous prompts or complete response transcripts.
- Nano Observer and Hjalmar model-format failures are advisory and use bounded runtime
  fallback; they do not replay committed side effects.
- One-shot operator instructions, linked-tab overlay, per-window parallelism and mandatory
  app-owned forensic Audit remain part of the baseline.


## Global prompt-post pause — v1.2.0

Greenfield now coordinates every autonomous prompt post across all Greenfield windows in the
same Chrome profile. The owner surface is extension-wide `chrome.storage.local`, not a
per-window process record.

- The side panel control **Paus mellan analys och post** is persisted globally, range 0–90 s.
- When a process reaches `SENDING`, it reserves the next global prompt slot. Reservations are
  serialized by the shared MV3 service worker and persisted as
  `eic.gf.global-prompt-post-gate.v1`.
- The scheduled slot is based on the later of current system time, the prior reserved slot and
  the last committed prompt-post time, plus the configured delay.
- Immediately before a page effect, the runtime acquires a short global send lease and checks
  the actual last committed post time again. If another window posted later than expected, the
  current prompt pause is extended rather than allowing a burst.
- Confirmed prompt effects commit `lastPromptPostedAtMs`; confirmed no-effect paths release the
  lease. Unknown-effect paths keep exact-once reconciliation semantics and do not blindly resend.
- The status rail includes **Prompt pause** and shows a live countdown while the current process
  is waiting for its globally reserved slot.

The scope is one Chrome profile / one installed Greenfield extension instance. Separate Chrome
profiles do not share `chrome.storage.local`.

## Saved missions — carried forward into v1.2.0

The operator settings surface also persists up to 24 saved mission texts for quick reuse. Saving,
loading or deleting a preset never changes an already-running process goal.

## Manual chat coexistence

The operator may use the same ChatGPT conversation manually while an autonomous process is
active. Runtime keeps two notions separate:

1. **Latest visible conversation turn** — useful for UI/Audit and detecting external
   interleaving.
2. **Current autonomous causal turn** — the assistant response paired with the user turn
   created by the current autonomous dispatch.

Manual turns never need to contain `eic.a2a.response.v1`. They do not become autonomous
response candidates merely because they are structurally valid ChatGPT turns.

v1.1.9 additionally persists bounded external-interleave provenance through the accepted
autonomous response and next A2A envelope. This gives the live shakedown a deterministic
readback surface without changing production timing or inserting admission delays.

The release also includes a staged deterministic fixture in which the autonomous response is
first stabilizing, a manual user/assistant pair becomes the latest visible turn, the global
assistant count changes, and the controller must re-stabilize on the earlier causally paired
autonomous assistant rather than adopt the manual reply.

## Protocol-independent response handling

After a causally paired assistant response reaches terminal stability, the process advances
to `ANALYZING` regardless of A2A presence or validity. `parseTargetResponse()` may enrich
the captured response:

- valid structured response -> protocol metadata is available;
- degraded/repairable structured response -> bounded protocol metadata may be available;
- absent/malformed response -> protocol disposition is `UNKNOWN`.

All three cases continue to Nano/Hjalmar/controller decision unless another real runtime,
owner, safety, exact-once or operator-stop boundary exists.

## Nano Task contract

A target response requests one isolated local Nano task with one dedicated line:

`NANO_TASK: <English prompt-closed task>`

The directive ends at the first newline. Runtime derives an English
`PROMPT_CLOSED_EXECUTION_V2` execution prompt, persists write-ahead identity, and invokes a
fresh one-prompt Nano session only after prompt-closure admission.

For complex/data-bearing work, prefer:

`NANO_TASK: {"schema":"eic.greenfield.nano-task.request.v2","knowledgeBoundary":"PROMPT_ONLY","instruction":"...","context":"...","output":"..."}`

`context` is data embedded in this invocation; it is not a locator. Nano receives no EIC,
project, file, repo, artifact, web/API, browser or prior-chat state unless EIC has copied the
needed content into the prompt. Runtime has no complexity ceiling beyond product/model limits.

If required information is absent, the task terminates as `CONTEXT_REQUIRED`; it is not
blindly replayed and does not block the mission. Unknown model-call effect remains explicit
`UNKNOWN_EFFECT` and is never blindly replayed.

Application-side prompt budgets remain conservative:
- direct Nano Task: 2600 characters;
- Nano Observer: 3400 characters;
- Hjalmar D2: 6200 characters.

These are product budgets, not claims about Chrome's absolute model context or reasoning limit.

## Audit behavior — v1.1.12

Persistent Audit is **off by default**. The side panel exposes a checkbox:

- unchecked: no IndexedDB audit writes; only the 25 most recent live event headers are kept
  in a volatile in-memory FIFO for the side-panel feed;
- checked: events are persisted with bounded retention, noisy polling samples are coalesced,
  and persistent reads use IndexedDB time indexes/cursors instead of global `getAll()`;
- `PAGE_STATE_OBSERVED` stores identities, hashes, lengths and causal metadata, not duplicated
  raw assistant text;
- persistent retention is capped at 5,000 events and legacy data is pruned in bounded batches;
- the legacy globally contended audit sequence counter is no longer used for event writes.

The FIFO is intentionally non-durable and can reset when the MV3 service worker or extension
reloads. Export is available only while persistent Audit is enabled.

## Install

1. Unzip the package.
2. Open `chrome://extensions`.
3. Enable Developer mode.
4. Select **Load unpacked** and choose the extracted folder.
5. Open a ChatGPT tab, open the side panel, enter the mission and start.

Chrome 138+ with the local Prompt API / `LanguageModel` is required for Nano and Hjalmar.

## Evidence boundary

Module/static regression tests validate deterministic code/package invariants. They do not
constitute live Desktop Chrome acceptance.

## Documents

- `docs/TIMED_MISSION_PAUSE_V1_3_1.md` — timed mission pause, wake semantics and mission/objective contract.
- `docs/SESSION_POSTMORTEM_V1_1_12.md` — source-level Audit crash investigation and v1.1.12 corrections.
- `docs/WIRE_TRACE_V1_1_12.md` — default-off/FIFO/persistent Audit wire map.
- `docs/SESSION_POSTMORTEM_V1_1_9.md` — v1.1.9 WAITING/repetition incident and v1.1.10 corrections.
- `docs/SESSION_POSTMORTEM_V1_1_8.md` — v1.1.8 live acceptance findings.
- `docs/SESSION_POSTMORTEM_V1_1_7.md` — v1.1.7 live failures and corrected causal model.
- `docs/WIRE_TRACE_V1_1_11.md` — v1.1.12 stale-session producer -> state -> consumer -> test map.\n- `docs/WIRE_TRACE_V1_1_10.md` — historical v1.1.10 continuity/liveness wire map.
- `docs/WIRE_TRACE_V1_1_9.md` — historical v1.1.9 wire map.
- `docs/FUNCTIONAL_BASELINE.md` — current required functional surface.
- `docs/ARCHITECTURE.md` — canonical runtime/state design.
- `docs/AUDIT.md` — forensic Audit contract.
- `docs/RELEASE_NOTES.md` — v1.1.12 release notes.


## v1.5.3

- Mission queue sets are mirrored to a Chrome-profile bookmark vault and restored/migrated from local storage, so queue plans survive extension-ID/install-path changes.
- New **Körstatus** tab gives a fleet-level operational view of active workers, current work, queue pressure, pauses, capacity, prompt gate, work mode and rate-limit state.
