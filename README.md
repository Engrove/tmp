# EIC Autonom Agent v0.12.12

v0.12.12 is a focused post-Nano handoff repair built from the exact delivered
v0.12.11 browser package and the supplied v0.12.11 Desktop Chrome runtime
export/full-audit/session-context. The live failure occurred after deterministic
protocol repair had completed: a prepared repair prompt was cancelled as
`CANCELLED_SUPERSEDED` solely because the page was transiently reported as
generating, even though the readable assistant hash and document epoch were
unchanged. The run then fell into `WAITING_FOR_RESPONSE` without a submitted
prompt, pending Nano task or other causal producer.

v0.12.12 separates **owner identity** from **target busy state**. A prepared
effect is superseded only by a different readable assistant hash or document
epoch. If the same owner is temporarily generating or working in background,
the prepared effect remains journalled and waits in an explicit
`WAITING_FOREGROUND` / `WAITING_BACKGROUND` pre-submit state with no inherited
response deadline. Unreadable owner identity fails closed into bounded
readback/recovery rather than submit or cancellation. Fast rechecks are bounded
to a 10-second window, with the existing 30-second watchdog as durable fallback.

The package carries the inherited v0.12.9 deep-repair regression, v0.12.10
Autostart regression, v0.12.11 Nano owner-liveness regression, the new v0.12.12
handoff replay regression and the current whole-package invariant suite.

## v0.12.11 historical repair

v0.12.11 is a liveness/owner-cancellation repair release built from the exact
delivered v0.12.10 browser package and the supplied v0.12.10 Desktop Chrome
audit/export. The live incident was not a request/requeue loop: one
`CONTINUATION_ANALYSIS` request remained locally active for many minutes while
the target entered a newer foreground response generation. Background had
already stopped accepting that Nano request, but sidepanel treated the rejected
heartbeats as telemetry-only and let the stale local LanguageModel inference
continue until it attempted stale terminal receipts.

v0.12.11 gives the exact Nano request an owner-bound abort signal. An
authoritative heartbeat/terminal rejection now aborts the local provider task
instead of being ignored; foreground target generation explicitly supersedes a
running ordinary Nano request before leaving `ASSESSING`; stale terminal
`NANO_DECISION`/`NANO_FAILURE` receipts are suppressed; and ordinary
`CONTINUATION_ANALYSIS` has a 180-second mode deadline while the configurable
global 1800-second wall ceiling remains unchanged. The active heartbeat cadence
is 10 seconds, bounding owner-loss detection while inference is running.

The package carries the inherited v0.12.9 deep-repair regression, the v0.12.10
Autostart regression, the v0.12.11 Nano owner-liveness regression and a
whole-package invariant suite.

## v0.12.10 historical repair

v0.12.10 was a focused repair release built from the exact delivered v0.12.9
browser package. Live v0.12.9 logs proved that Chrome LanguageModel creation
and canary verification succeeded, while Autostart still failed because its
cached precondition required a previously selected ChatGPT tab even though the
Autostart plan itself owns `LINK_ACTIVE_TAB`. The same failed attempt could
also mark a verified Nano base stale before target binding.

v0.12.10 made active-tab binding an owned Autostart transaction step, staged
the selected scenario without staling an existing verified Nano base, committed
the staged config only after target binding and Nano readiness, preserved a
previous verified Nano base when a staged replacement failed, and replaced the
ambiguous `OMSTART KRÄVS` UI wording with `AKTIVERA NANO`.

v0.12.9 was the deep-audit repair release from the exact v0.12.8 browser
package. It fixed nullable Chrome-id coercion (`null`/missing ids becoming
numeric `0`), current-schema restart handling, initialization single-flight,
observer/write separation, CDP attach durability reconciliation, Session
Capture cancellation/commit ordering, repeated-turn capture identity, stale
sidepanel refresh ordering and serialized audit/application-log persistence.

v0.12.8 fixes the live multi-agent continuation crash in v0.12.7: background.js called the exported execution-routing helper shouldSuppressRepeatedLocalStateRead() at five post-Nano decision points without importing it. The missing module binding raised a ReferenceError immediately after otherwise-valid Nano decisions, causing bounded deterministic recovery to fail repeatedly. v0.12.8 restores the missing binding and adds a release regression that checks the exact helper binding plus the observed live failure signature.

v0.12.7 fixes the v0.12.6 sidepanel startup crash caused by conflating the closed schema's theoretical worst-case JSON-escape bound with the independent 32k runtime stream safety cap. The schema remains expressive; the runtime cap remains bounded and is now enforced even when a complete JSON object arrives before the normal streaming bounds check.

Chrome MV3 extension for bounded autonomous continuation of an operator-owned task.

v0.12.6 closes the correlated post-READY Nano/control episode observed in the
exact v0.12.5 export and transcript. The failure was not a model-host outage:
Nano selected a runtime-admissible local action, yet controller liveness was
owned by a model-expression/discrimination meta-test and later terminally
blocked the mission. The old ordinary Nano contract also required 25 top-level
controller fields plus a nested seven-field trackControl object, causing the
model to restate controller state instead of spending its output on semantic
judgment.

Current ordinary Nano is `eic.nano.advisory.v4`. The model returns only a
runtime action recommendation plus one free analysis field; an optional
proposal/uncertainty/evidence need may be added when useful. Runtime—not Nano—
owns transition membership, executor actor, progress, waits, effect class,
safety and terminal commits. STOP is not a standing ordinary-Nano action and
destructive-sounding advisory prose cannot manufacture a human boundary for a
no-effect local/wait route.

The exact v0.12.5 fresh-target dilemma is also capability-routed: after one
no-delta `READ_LOCAL_SESSION_STATE`, that local read is suppressed for the same
side-band generation. AGENT cannot create/select/attest an independent fresh
ChatGPT evaluator session; the next route is the EIC AI/operator handoff via
`WAIT_OWNER_EVENT`. EIC AI may create/select the target only through an actually
exposed browser/session owner route; otherwise the handoff explicitly requires
`OPERATOR_ACTION` to open/select/link the target. A persisted v0.12.5
`NANO_DISCRIMINATION_FAILED` policy
fence is deterministically retired on v0.12.6 upgrade so the still-unprocessed
assistant response can re-enter the advisory pipeline.

## Current behavior

- Response settle ownership is exclusive: once a response is transferred into observation/processed context, it cannot remain an active liveness candidate.
- `RESPONSE_CANDIDATE -> PENDING_OBSERVATION` is an atomic transfer; early session-init/no-progress/protocol branches cannot retain a stale settle candidate.
- Full response identity is authoritative when available; hash-only equality is a fallback, so identical rendered text in a distinct assistant turn remains a new response generation.
- Outbound effects persist both source response hash and response identity; the source response cannot become the response to its own effect.
- Control-plane precedence is explicit: terminal -> human -> safety -> effect -> response -> session-init -> Nano -> recovery -> ordinary delivery.
- Response-settle timeout applies only to the current `ACTIVE` causal response owner after ownership reconciliation.
- Terminal parent states close active session-init, Nano and response-observation children before the run can remain terminal.

- Universal actor/capability topology is explicit and machine-routed: `EIC_AI_SESSION`, `AGENT`, `NANO`, `EXTERNAL_SYSTEM`, `OPERATOR_ACTION`, `OPERATOR_DECISION` and `NONE` have separate capability scopes. Task domain never grants capability.
- `EIC_NEXT_ACTOR: EIC_AI_SESSION` is first-class EIC-AA/5 syntax for work that requires EIC/tool/owner routes exposed to the connected ChatGPT EIC session. `AGENT` remains local Chrome-extension runtime only; `NANO` is reasoning-only and never an execution actor.
- A true `EXTERNAL_SYSTEM` dependency resolves to quiescent `WAIT_EXTERNAL_EVENT` without target dispatch or chat-control. The same EIC chat is never used as a false external-system proxy.
- Every registered micro-action declares `executorActor` and `requiredCapability`; Core filters the Nano action catalog by the target actor before Nano may choose a transport.
- Session-context baseline `ACCEPT` is a typed commit event. It cannot enter ordinary continuation grounding, autonomy, delivery regulation or recovery; after durable `READY`, Core hands the same owner-bound observation to exactly one ordinary Nano request without a second target prompt.
- Pre-`READY` ordinary Nano/recovery/local program mutation is rejected. `NANO_ANALYZING` during initialization requires the exact typed baseline request id bound by `sessionContextInit.nanoRequestId`.
- Execution disposition is resolved before delivery regulation. The delivery regulator applies only to material `TARGET_DISPATCH`; `LOCAL_EXECUTE`, `WAIT_OWNER_EVENT`, `WAIT_EXTERNAL_EVENT`, legacy `EXTERNAL_OWNER_EXECUTE`, `CHAT_CONTROL_CONTINUATION` and `TERMINAL` never pass through the material delivery gate.
- Baseline response consumption is lifecycle-aware: an ACKED baseline response may be re-observed by baseline reconciliation even if an ordinary processed marker references the same response identity.
- Terminal Nano ownership release uses one common finalizer for request/observation/host-busy projection. A terminal decision cannot leave `pendingNanoRequest=null` while stale Nano host ownership remains active.
- `WAITING_FOR_RESPONSE` is legal only with a registered causal wake source. Connected-response waits use an active effect/response owner; genuine external waits use an explicit `WAIT_EXTERNAL_EVENT` predicate and remain quiescent until that predicate changes.
- Ordinary `EIC_AUTONOMY: CONTINUE` responses always pass through Nano after session baseline readiness; deterministic protocol fast-path is reserved for terminal/human-boundary outcomes.
- A valid `EIC_AUTONOMY: OPERATOR_ACTION_REQUIRED` + `EIC_NEXT_ACTOR: OPERATOR_ACTION` tuple is an immediate dominant human boundary. The response is marked processed, pending Nano/observation/candidate state is cleared, any not-yet-dispatched prepared effect is cancelled, runtime enters `AWAITING_OPERATOR_ACTION`, timeouts are suspended, and only an accepted operator-action receipt may resume processing.
- Nano receives a registered micro-action catalog and selects `microActionId`; execution transport is a fixed registry property and cannot be selected by `requestedAction` prose.
- `LOCAL_EXECUTE`, `WAIT_OWNER_EVENT`, `WAIT_EXTERNAL_EVENT`, legacy `EXTERNAL_OWNER_EXECUTE`, `TARGET_DISPATCH`, Core-only `CHAT_CONTROL_CONTINUATION` and `TERMINAL` are explicit execution dispositions. Non-material work never falls through to material `TARGET_DISPATCH`; EIC-AI-actionable waits may create exactly one side-band chat-control turn, while true external dependencies create none.
- Local reads write a bounded receipt, but a receipt is not progress by itself. Nano is re-armed only when the response/owner/material decision input actually changes.
- A no-delta local read may emit one typed `diagnostics.localState` payload for that exact unchanged generation. It contains only bounded bridge/receipt/structured target/lifecycle fields, does not enter material decision identity, and is fenced so the same generation cannot create another diagnostic wake.
- Side-band `CHAT_CONTROL_CONTINUATION` / `PROTOCOL_REPAIR` responses use semantic material identity: fresh assistant response identity/hash/turn ids alone do not re-arm local Nano or create a new wake; material control generation, task/init/material-effect anchor changes and substantive target-control semantics still do.
- Nano cannot schedule `REANALYZE_CURRENT_RESPONSE` or `REQUEUE_NANO`; those are Core-only recovery controls. The model therefore cannot create a self-scheduling analysis loop through its own action catalog.
- A terminal Nano host failure fences the exact failed observation/material input. Local recovery may inspect owner state, but unchanged facts never create another Nano request; Core records the wait reason and emits an exactly-once AI-visible chat-control continuation instead of deadlocking in a UI-only wait.
- Semantic no-progress recovery keys the execution family independently of requested-action wording and cannot rewrite or requeue the same failed semantic input.
- Nano/model compute may be asynchronous, but semantic commits, runtime-relevant config writes and material effects are serialized through the single owner lane.
- Ordinary Nano output is now compact `eic.nano.advisory.v4`: only `selectedActionId` and a free `analysis` field are required; runtime projects actor/progress/completion/effect/wait state instead of asking the model to re-emit controller structures.
- Normal decision and JSON-repair output use a two-tier bound: 6,000 characters is a soft telemetry threshold; the hard limit is deterministically derived from the closed `DECISION_SCHEMA` with worst-case JSON escaping plus margin. A valid >6,000-character decision is therefore not terminalized solely by the historical threshold.
- `NANO_OUTPUT_OVERRUN` is not blindly rerun on a fresh task session. One bounded compact repair is permitted; after a durable failure receipt the panel does not rethrow the expected failure into Chrome's extension error list.
- `WAIT_OWNER_EVENT` is never a communication endpoint. The sidepanel is UI only; when the connected `EIC_AI_SESSION` can perform the next bounded owner-routable action, Core emits exactly one `CHAT_CONTROL_CONTINUATION`, journals and ACKs it, then waits for that ChatGPT response. This path is forbidden for `EXTERNAL_SYSTEM`.
- A material accepted Core Surface Review advances an owner-controlled material generation and can rearm exactly one preserved observation without target dispatch.
- The Nano UI separates the current request from historical telemetry: `PENDING` never displays a previous request's start time or result as current.

- An ACKED baseline turn is durable delivery truth. Same-owner assistant response hash/epoch churn invalidates only the stale Nano result and triggers local reanalysis; it never resends the baseline prompt.
- Baseline owner lineage is separated from visible-DOM evidence. A virtualized/missing old prompt is diagnostic only; a real conversation/user-turn owner change still fails closed.
- Every persisted baseline-analysis `NANO_ANALYZING` state binds the exact Nano request id. A recoverable ACKED lineage with a lost request is normalized to post-delivery reconciliation before storage, preventing controller-created `NANO_ANALYSIS_ORPHANED`.
- Temporary loss of the current user-turn owner anchor waits locally; it is not treated as evidence of a new owner.
- Deterministic/target-authored fallback is forbidden for `sessionContextBaselineAnalysis`.

- A satisfied controller-local unlock is normalized before autonomy/hard-boundary classification: stale `PROGRAM_BLOCKED`, completion-confirmed/bounded-stop and dormant `USER_PAUSE` candidate metadata cannot override an active `CONTINUE`.
- `operatorCandidate` affects destructiveness only when `pauseOrigin` explicitly selects `OPERATOR_PROXY_CANDIDATE` or `USER_PAUSE`; a dormant candidate cannot manufacture level-10 human authority.
- Explicit genuine `USER_PAUSE` remains a level-10 boundary and is never normalized away.
- Recovery provenance is explicit: a readable ChatGPT page only clears connectivity/lifecycle recovery, never `NO_PROGRESS` or an exact local-unlock wait.
- Controller-local unlocks use a producer registry. `AGENT_NANO_READY_STATE` is produced by `run.sessionContextInit.state === "READY"`; unknown local state tokens cannot arm indefinite waits.
- No-progress accounting uses `max(progressDelta, directProgramDelta)`.
- Core Surface Review uses one bounded 24,000-character response contract shared by schema, normalization and executor.
- Content-script startup rehydrates the visible link badge from durable background-owned runtime state; `RECOVERING` has its own non-disconnected label.

- Session baseline validation uses the compact `eic.nano.baseline-analysis.v2` schema; a parsed target baseline is not adopted until Nano returns `ACCEPT`.
- Baseline Nano has a 180-second per-attempt deadline, one fresh task-session retry and semantic early termination at the first complete JSON object.
- Baseline Nano failure is owned by session initialization and becomes explicit `FAILED`; deterministic continuation may not substitute for the required baseline analysis.
- Nano claim/decision/failure forensic events retain bounded output segments, output SHA-256, request/init/observation/continuity state and validation metadata in application/full audit.

- A transient continuity readback mismatch gets exactly one bounded rewrite/readback before fail-closed storage recovery.
- Storage/lifecycle recovery preserves `NANO_ANALYZING + PENDING` as the semantic owner state and restores `ASSESSING`; it may not degrade to an unarmed `WAITING_FOR_RESPONSE`.
- Nano claim eligibility is request-driven during session initialization. A valid `NANO_ANALYZING` request can be claimed even if a redundant run-state projection is stale.
- Each pending Nano claim phase has its own 45-second epoch. A first/second/third expired epoch locally re-arms the same request without a target prompt; only a fourth consecutive unclaimed epoch may fail initialization. Successful claims and repair/requeue transitions reset the claim epoch so a slow completed analysis cannot make a fresh repair look already timed out.
- Automatic Session Capture is suspended while the initialization Nano request owns the model turn and resumes explicitly after completion.

- Release identity is a build gate: `package.json`, `manifest.json`, `APP_VERSION`, `CONTENT_SCRIPT_VERSION` and the `const VERSION` literal inside `content.js` must all be the same string, checked by the validator, by the package script before it copies a single file, and by an executed `EIC_PING` against the real content bridge.
- An Autostart rollback is reported as `AUTOSTART_PRECONDITION_FAILED`, never as an operator abort, and a synchronous precondition check runs inside the operator gesture before native model activation.
- The deterministic baseline/protocol decision is applied **in-band**, inside the same serialized operation that persisted its dispatch state. No prompt-critical step runs from a detached callback, and a dispatch exception is persisted, audited and written to the application log instead of reaching only the service-worker console.
- The session-context initialization gate is **live-bounded**: its transient controller-owned phases fail to an explicit `FAILED` state with an operator retry, instead of blocking every prompt indefinitely.
- An observation is recorded as processed only when it actually produced a delivered turn, so a baseline question that was never sent can never make its own retry evidence unreachable.
- A deferred automatic Session Capture backs off exponentially to 30 s instead of retrying at a fixed 2.5 s.
- Every manual mission start and every Autostart path first enters one universal session-context initialization gate: chat-state inspection, stable catch, deterministic baseline request, baseline response and Nano analysis.
- All ordinary prompts, special modes and effects remain blocked until the initialization state is `READY`.
- A closable translucent ChatGPT overlay shows the active agent phase; dismissal applies only to the current need, so the next phase or future need appears again.
- The canonical `eic.main-task-baseline.v3` request is application-authored deterministic text, not free-form ordinary Nano output.
- Non-terminal Nano streaming is bounded by a material-output idle watchdog with at most one fresh-session retry.
- Continuity is projected from the active run and keeps a verified N-1 backup with storage readback.
- Mission Nano has priority while session initialization is active; the first source-bound core-surface review is persisted as an exactly-once deferral and receives the next local model turn after initialization reaches `READY`.
- Capture is cumulative and monotonic across virtualized DOM views and uses stable transcript identity.
- Control project and transcript-derived target project are retained as separate identities.
- Mission status and strong-claim receipts are projected from their owning run/evidence surfaces.
- Optional full audit is OFF by default and writes redacted rotated NDJSON only to an operator-selected existing directory after read/write permission and a write/readback/delete probe; `C:\\temp` is a recommendation, not a browser-verifiable absolute path.
- Mjölnar D2 carries an explicit exact-action `M2_MANDATE` at 9.9999; level 10 still requires the real operator.
- `EIC-AA/5` separates completion, next actor and autonomy.
- Mechanical human presence uses durable `OPERATOR_ACTION_REQUIRED`.
- Material level-10 decisions use a separate, source-bound acknowledgement receipt.
- Session Capture performs a transcript-only full/delta DOM sweep with virtualisation diagnostics, stable turn identity, gaps and scroll restoration.
- Automatic Session Capture is enabled by default and does not require an active mission; it performs one full capture and then bounded delta capture for new stable transcript identities.
- Automatic capture is guarded to one attempt per stable response fingerprint and Pause/Stop cancels an active sweep.
- A pending Nano settings/core-surface proposal is globally visible through the attention banner; safe local-context changes can auto-apply after five minutes, while mandate, profile and autonomy changes remain manual.
- The Autostart action combines tab linking, profile selection, Nano activation and mission start through ordered presets from context-only to Mjölnar D2.
- Config/runtime v13 now round-trips without the stale v12 loader reset that broke v0.10.4 tab and run state.
- Mjölnar D1/D2 confirmation uses a second explicit in-panel click so native `LanguageModel.create()` receives a valid Chrome user gesture.
- The clickable attention banner routes to the highest-priority operator, browser, review, capture or Nano owner object.
- Automatic LanguageModel restart after a profile/mandate change is enabled by default, limited to available canary-verified assets and protected by a ten-minute fingerprint cooldown.
- Target delivery uses one compact canonical EIC-AA/5 JSON envelope and mandate references require acknowledged prior delivery.
- Interrupted sidepanel Nano inference is requeued from the preserved observation at most once.
- Session Memory is derived local context stored in IndexedDB with provenance, source hashes, supersession and stale-state handling.
- Nano receives only a bounded active memory capsule.
- Exactly four whole-application quick profiles exist; `VERIFIED_ANALYSIS` is the safe default.
- Recommendations never silently change risk, evidence or autonomy.
- Export v20 contains bounded profile/operator/capture/memory summaries without transcript bodies or secrets.
- Delivery admission remains bound to the primary goal, milestone, bounded unit, proposed action and direct program delta.
- Deterministic EIC-AA/5 CONTINUE decisions now carry a complete delivery contract: direct bounded work carries positive delta; unresolved owner control carries omission failure and an exact unlock.
- A genuine zero-delta rejection consumes the response identity and enters a stable owner-evidence wait instead of `SOFT_PAUSED` recovery and same-observation rearming.
- The attention banner exposes owner/locator waiting explicitly.
- Session initialization requests an `eic.main-task-baseline.v3` when no stable main-task baseline exists.
- The baseline is intentionally small: objective/program goal, measurable completion, bounded current unit, last material delta, next action, constraints/blockers and optional `contextRefs` / `evidenceNeeds`.
- EIC Core/Backend — not Nano baseline semantics — owns access, owner-route resolution, external probes, claim ceilings, global-skill truth, effect verification and readback.
- Every Nano continuation classifies the candidate as on-track, justified detour, drift or insufficient context.
- Deterministic protocol fast paths remain withheld until the main-task baseline exists.
- Trusted-session, owner-route, claim, approval, effect and recovery gates remain fail-closed.

## Preserved Chrome Prompt API contract

v0.11.5 preserves the verified v0.9.11 activation path and v0.10.1–v0.10.2 lifecycle/UI fixes:

- use only `globalThis.LanguageModel`;
- require Chrome 138 or later;
- use passive `availability()` with matching English output attestation;
- invoke `LanguageModel.create()` directly in the explicit activation click before any `await`;
- use bounded canary verification;
- destroy the activation session and create a clean mandate-bound base session;
- keep mission start blocked until the base is available, non-stale and canary-verified.
- preserve the 1,200-second material-progress boundary and fail closed as `EXTERNAL_MODEL_ASSET_BLOCKER` before positive progress; automatic retry remains forbidden.

See [v0.9.11 Prompt API activation](docs/V0_9_11_LANGUAGE_ATTESTATION.md).

## Current contracts

| Surface | Contract |
|---|---|
| App/content | 0.12.11 |
| Config/runtime | v23 |
| Continuity | v5 |
| Audit | v13 |
| Export | v27 |
| Operator action | v1 |
| Session Capture | v1 |
| Session Memory | v1 |
| Quick profile | v1 |
| Nano-host telemetry | v4 |
| UI command | v2 |
| UI snapshot | v3 |
| Turn | EIC-AA/5 |

## Local storage

Structured captures, turns, sections, summaries, session memories and operator actions use extension IndexedDB. Per-window runtime summaries are authoritative for active capture/memory identity; `chrome.storage.local` retains small active-ID/readiness values only as compatibility mirrors in addition to config/runtime state. Secret-like fields are redacted. The UI provides explicit local purge.

IndexedDB and Session Memory are derived local context, not project, repository, artifact, deployment or runtime owner truth.

## Build profiles

- `STANDARD`: no debugger permission.
- `BROWSER`: bounded optional debugger/origin capabilities according to existing risk and approval gates.
- `SOURCE`: full source, tests and documentation.

These package profiles are distinct from the four whole-application quick profiles and do not imply installation or live runtime.

## Development

```bash
npm test
npm run validate
npm run package
```

## Current documents

- [v0.11.18 architecture](docs/V0_11_18_ARCHITECTURE.md)
- [v0.11.18 state registry](docs/V0_11_18_STATE_REGISTRY.json)
- [v0.11.18 change manifest](docs/V0_11_18_CHANGE_MANIFEST.json)
- [v0.11.18 changelog](docs/CHANGELOG_V0_11_18.md)
- [v0.11.18 verification](docs/VERIFICATION_V0_11_18.md)
- [v0.11.18 Desktop Chrome acceptance](docs/DESKTOP_CHROME_ACCEPTANCE_V0_11_18.md)
- [v0.11.17 architecture](docs/V0_11_17_ARCHITECTURE.md)
- [v0.11.17 state registry](docs/V0_11_17_STATE_REGISTRY.json)
- [v0.11.17 change manifest](docs/V0_11_17_CHANGE_MANIFEST.json)
- [v0.11.17 changelog](docs/CHANGELOG_V0_11_17.md)
- [v0.11.17 verification](docs/VERIFICATION_V0_11_17.md)
- [v0.11.17 Desktop Chrome acceptance](docs/DESKTOP_CHROME_ACCEPTANCE_V0_11_17.md)
- [v0.11.16 architecture](docs/V0_11_16_ARCHITECTURE.md)
- [v0.11.16 change manifest](docs/V0_11_16_CHANGE_MANIFEST.json)
- [v0.11.16 changelog](docs/CHANGELOG_V0_11_16.md)
- [v0.11.16 verification](docs/VERIFICATION_V0_11_16.md)
- [v0.11.16 Desktop Chrome acceptance status](docs/DESKTOP_CHROME_ACCEPTANCE_V0_11_16.md)
- [v0.11.15 architecture](docs/V0_11_15_ARCHITECTURE.md)
- [v0.11.15 change manifest](docs/V0_11_15_CHANGE_MANIFEST.json)
- [v0.11.15 changelog](docs/CHANGELOG_V0_11_15.md)
- [v0.11.15 verification](docs/VERIFICATION_V0_11_15.md)
- [v0.11.15 Desktop Chrome acceptance status](docs/DESKTOP_CHROME_ACCEPTANCE_V0_11_15.md)
- [v0.11.14 architecture](docs/V0_11_14_ARCHITECTURE.md)
- [v0.11.14 change manifest](docs/V0_11_14_CHANGE_MANIFEST.json)
- [v0.11.14 changelog](docs/CHANGELOG_V0_11_14.md)
- [v0.11.14 verification](docs/VERIFICATION_V0_11_14.md)
- [v0.11.14 Desktop Chrome acceptance status](docs/DESKTOP_CHROME_ACCEPTANCE_V0_11_14.md)
- [v0.11.10 architecture](docs/V0_11_10_ARCHITECTURE.md)
- [v0.11.10 change manifest](docs/V0_11_10_CHANGE_MANIFEST.json)
- [v0.11.10 changelog](docs/CHANGELOG_V0_11_10.md)
- [v0.11.10 verification](docs/VERIFICATION_V0_11_10.md)
- [v0.11.10 Desktop Chrome acceptance status](docs/DESKTOP_CHROME_ACCEPTANCE_V0_11_10.md)
- [v0.11.9 architecture](docs/V0_11_9_ARCHITECTURE.md)
- [v0.11.9 change manifest](docs/V0_11_9_CHANGE_MANIFEST.json)
- [v0.11.9 changelog](docs/CHANGELOG_V0_11_9.md)
- [v0.11.9 verification](docs/VERIFICATION_V0_11_9.md)
- [v0.11.9 Desktop Chrome acceptance status](docs/DESKTOP_CHROME_ACCEPTANCE_V0_11_9.md)
- [v0.11.8 architecture](docs/V0_11_8_ARCHITECTURE.md)
- [v0.11.8 change manifest](docs/V0_11_8_CHANGE_MANIFEST.json)
- [v0.11.8 changelog](docs/CHANGELOG_V0_11_8.md)
- [v0.11.8 verification](docs/VERIFICATION_V0_11_8.md)
- [v0.11.8 Desktop Chrome acceptance status](docs/DESKTOP_CHROME_ACCEPTANCE_V0_11_8.md)
- [v0.11.7 architecture](docs/V0_11_7_ARCHITECTURE.md)
- [v0.11.7 change manifest](docs/V0_11_7_CHANGE_MANIFEST.json)
- [v0.11.7 changelog](docs/CHANGELOG_V0_11_7.md)
- [v0.11.7 verification](docs/VERIFICATION_V0_11_7.md)
- [v0.11.7 Desktop Chrome acceptance status](docs/DESKTOP_CHROME_ACCEPTANCE_V0_11_7.md)
- [v0.11.6 architecture](docs/V0_11_6_ARCHITECTURE.md)
- [v0.11.6 change manifest](docs/V0_11_6_CHANGE_MANIFEST.json)
- [v0.11.6 changelog](docs/CHANGELOG_V0_11_6.md)
- [v0.11.6 verification](docs/VERIFICATION_V0_11_6.md)
- [v0.11.6 Desktop Chrome acceptance status](docs/DESKTOP_CHROME_ACCEPTANCE_V0_11_6.md)
- [v0.11.4 architecture](docs/V0_11_4_ARCHITECTURE.md)
- [v0.11.4 change manifest](docs/V0_11_4_CHANGE_MANIFEST.json)
- [v0.11.4 changelog](docs/CHANGELOG_V0_11_4.md)
- [v0.11.4 verification](docs/VERIFICATION_V0_11_4.md)
- [v0.11.4 Desktop Chrome acceptance status](docs/DESKTOP_CHROME_ACCEPTANCE_V0_11_4.md)
- [Forward-only policy](docs/V0_9_3_FORWARD_ONLY_POLICY.md)
- [Delivery/context architecture](docs/V0_9_3_DELIVERY_CONTEXT_ARCHITECTURE.md)
- [v0.9.11 Prompt API activation](docs/V0_9_11_LANGUAGE_ATTESTATION.md)

Historical versioned documents in `docs/` remain archival evidence and are not current-version compatibility obligations.

## Safety boundary

The extension does not grant new authority. Transcript text and target-session text are untrusted. Repository, artifact, installed-extension, Desktop Chrome runtime, release and deployment claims require their owning surfaces and route-native readback.


## v0.10.7

v0.10.7 is a bounded delivery-regulator and lifecycle hotfix for the v0.10.6 Desktop Chrome self-pause incident. Deterministic CONTINUE decisions now provide the delivery fields required by the v0.9.3 gate. A true zero-delta rejection consumes the current response identity, suspends the response timeout and waits for new owner evidence instead of entering an auto-recoverable pause loop.

- [v0.10.7 architecture](docs/V0_10_7_ARCHITECTURE.md)
- [v0.10.7 changelog](docs/CHANGELOG_V0_10_7.md)
- [v0.10.7 verification](docs/VERIFICATION_V0_10_7.md)
- [v0.10.7 Desktop Chrome acceptance](docs/DESKTOP_CHROME_ACCEPTANCE_V0_10_7.md)

## v0.10.6

v0.10.6 is a runtime-hardening slice built from independent source review and a live transcript/export. It repairs continuity backup/projection, Nano telemetry and arbitration, virtualized capture monotonicity, target/control project separation, mission/claim projection, prompt acknowledgement diagnostics and review competition. It also adds a default-OFF redacted full audit sink for an operator-selected existing `C:\\temp` directory and an explicit Mjölnar `M2_MANDATE` at authority level 9.9999 below level 10.

- [v0.10.6 architecture](docs/V0_10_6_ARCHITECTURE.md)
- [v0.10.6 remediation matrix](docs/V0_10_6_REMEDIATION_MATRIX.md)
- [v0.10.6 full audit](docs/FULL_AUDIT_V0_10_6.md)
- [v0.10.6 changelog](docs/CHANGELOG_V0_10_6.md)
- [v0.10.6 verification](docs/VERIFICATION_V0_10_6.md)
- [v0.10.6 Desktop Chrome acceptance](docs/DESKTOP_CHROME_ACCEPTANCE_V0_10_6.md)

## v0.10.4

v0.10.4 hardens automatic capture against repeated sweeps, makes Pause/Stop cancel capture, adds a five-minute default-enabled Nano proposal TTL, introduces ordered Autostart presets and provides a clickable prioritized attention banner.

- [v0.10.4 architecture](docs/V0_10_4_ARCHITECTURE.md)
- [v0.10.4 changelog](docs/CHANGELOG_V0_10_4.md)
- [v0.10.4 verification](docs/VERIFICATION_V0_10_4.md)
- [v0.10.4 Desktop Chrome acceptance](docs/DESKTOP_CHROME_ACCEPTANCE_V0_10_4.md)

## v0.10.3

v0.10.3 moves automatic Session Capture eligibility and scheduling to the background owner, accepts terminal protocol-override responses, and adds one source-bound Nano settings/core-surface review after the first capture of an application session. The review is proposal-only until the operator explicitly applies or declines it. Later reevaluation is manual.

- [v0.10.3 architecture](docs/V0_10_3_ARCHITECTURE.md)
- [v0.10.3 changelog](docs/CHANGELOG_V0_10_3.md)
- [v0.10.3 verification](docs/VERIFICATION_V0_10_3.md)
- [v0.10.3 Desktop Chrome acceptance](docs/DESKTOP_CHROME_ACCEPTANCE_V0_10_3.md)


## NANO_TASK (v0.12.1)

For isolated local LLM experiments, place a final directive in an EIC-managed prompt:

```text
NANO_TASK: {your one-prompt experiment}
```

NANO_TASK executes on a fresh local `LanguageModel` session with no ordinary Nano context, no clone, no continuity/mission/control authority, exactly one `prompt()` call, and immediate session destruction. If ordinary mission text precedes the directive, the directive is stripped from the EIC-managed mission prompt before target dispatch. See `docs/CHANGELOG_V0_12_1.md`.


## Session-context material-event rearm (v0.12.2)

v0.12.2 closes a split-brain between causal CONTROL ownership and the legacy
session-init projection. If a genuinely new MISSION user event supersedes an
outstanding session-context baseline effect, the same runtime persistence cycle
now retires the legacy baseline turn/response obligation and re-arms
`WAITING_CHAT_READY` with a fresh need key. The next stable assistant response
is a fresh session catch rather than a response to the closed effect.

This prevents `WAITING_FOR_RESPONSE` from surviving solely because the legacy
`currentTurn` still says `SESSION_CONTEXT_BASELINE_REQUEST` after causal
ownership has already been closed.
