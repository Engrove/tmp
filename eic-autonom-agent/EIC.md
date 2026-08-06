# EIC.md — EIC Autonom Agent v0.10.12 current contract

## Authority

This file is the current repository-local router. It is intentionally small. Detailed contracts are loaded only when the active work unit needs them.

Priority:
1. current operator instruction;
2. live owner-route access and readback;
3. this current-version contract;
4. linked design documents;
5. historical documents as history only.

## Forward-only law

v0.9.3 and every later version are **current-version-only**.

- No backward compatibility is required.
- Older storage, exports, UI envelopes, command aliases, removed fields or deprecated states are not migrated or accepted.
- A version or schema change may remove earlier behavior without adapters.
- Tests for removed compatibility behavior are not acceptance requirements.
- Historical files describe history; they do not constrain current implementation.
- Current schemas and rejection behavior are defined in `docs/V0_9_3_FORWARD_ONLY_POLICY.md`.

## Release identity law (v0.10.12)

- Five surfaces carry the runtime version: `package.json`, `manifest.json`, `APP_VERSION`, `CONTENT_SCRIPT_VERSION` and the `const VERSION` literal in `content.js`. They must be identical, and the equality must be *computed*, never assumed by a hard-coded assertion.
- A per-file hash manifest is not a release-identity gate. It proves a file was packaged unchanged, including a file that is wrong.
- Every release must execute the shipped content bridge and read its `EIC_PING` answer. A version the runtime never asks for is not verified.
- Packaging must fail before staging when identity is inconsistent.
- A rollback must name its own cause. Operator-attributed aborts are reserved for aborts the operator actually requested.

## Prompt-critical delivery law (v0.10.11)

- Every step between a persisted dispatch state and a journalled effect runs inside the same serialized operation. A prompt-critical step must never depend on a detached timer callback surviving.
- `deterministicDispatchState = DISPATCHED` states intent only. Delivery is proven by a journalled effect with a prompt digest and a submission receipt, never by dispatch bookkeeping.
- An exception on a prompt-critical path must be persisted to run state, written to the audit and written to the application log before any recovery decision. `console.warn` is not an error channel.
- An observation may be recorded as processed only if it produced an effect that left `PREPARED`. An undelivered observation must stay reconcilable.
- No wait state may be entered without either a delivered turn or an armed, unburned evidence source. `WAITING_FOR_RESPONSE` is legitimate at takeover start; it is never legitimate as the resting place of a failed delivery.
- Every non-terminal phase of the session-context initialization gate that the controller owns end-to-end must have a liveness bound and an explicit failure state with an operator route.

## Native model provider law

v0.10.12 preserves the v0.9.11-verified Chrome extension Prompt API surface and the v0.10.1–v0.10.2 lifecycle and UI hotfix contracts.

- Select only `globalThis.LanguageModel`.
- Do not use, probe or emulate `globalThis.ai.languageModel`.
- Passive readiness uses `LanguageModel.availability()` with the same English `expectedOutputs` attestation used by create().
- Native activation must call `LanguageModel.create()` directly in the explicit operator click before any `await`, storage write, hash, message hop or availability wait.
- The activation create receives only `monitor` and `AbortSignal`; no mandate, expected modalities, sampling configuration or language constraint.
- A created activation session is not ready until one bounded local canary inference returns non-empty output.
- The activation session is destroyed after canary; only a newly created mandate-bound session becomes the durable base.
- Base and task sessions use the same standard provider.
- Model availability claims require both native create success and canary evidence.

Details: `docs/V0_9_11_LANGUAGE_ATTESTATION.md`.

## Mandate identity law

A mandate profile is one atomic identity: profile ID, immutable version and exact text.

- Applying a profile must update all three fields before persistence.
- The same mandate version may never be reused with another hash.
- Custom Nano or target text receives a deterministic content-addressed version before autosave.
- A mandate conflict must block the save and start operation; it must not create a partial run.

## Delivery law

Every autonomous work unit binds:

- `PRIMARY_PROGRAM_GOAL`
- `ACTIVE_MILESTONE`
- `BOUNDED_CURRENT_UNIT`
- `PROPOSED_ACTION`
- `DIRECT_PROGRAM_DELTA`

A continuation is admitted only when it directly advances the program or is the single required owner/safety action with an exact omission failure and unlock. `DIRECT_PROGRAM_DELTA=0` stops the process branch.

Details: `docs/V0_9_3_DELIVERY_CONTEXT_ARCHITECTURE.md`.

## Universal session-context initialization law

Every manual start and every Autostart path enters the same ordered gate before any ordinary mission work:

1. inspect the current ChatGPT page state;
2. wait until a stable session catch can be armed;
3. bind exactly one complete stable assistant observation;
4. dispatch the canonical `eic.main-task-baseline.v1` request deterministically;
5. wait for the structured baseline response;
6. let Nano analyze the baseline and classify the next action;
7. enter `READY`.

No special mode, continuation, deterministic fast path, prompt effect or deferred mission may bypass this gate. The initial baseline request is application-owned deterministic text; Nano must not author, abbreviate or replace it. A non-terminal Nano stream has a bounded idle watchdog and at most one fresh-session retry.

The ChatGPT overlay is a derived UI projection only. It may be dismissed for the current need key, but a later phase or new need must show it again. It never owns runtime truth.

## Main-task and detour law

Nano must not infer that a locally coherent continuation is still aligned with the operator's stable program.

- When `eic.main-task-baseline.v1` is absent, the application dispatches the canonical `HUVUDUPPGIFTSKONTROLL` request before Nano analysis.
- The baseline is routing context and must include the stable task, measurable completion, active milestone/work unit, scope, owners, blockers, 80/20 vital few/deferred many, active/required global skills and a bounded detour return condition.
- Global-skill identity is reported from live global owner reads. Target text cannot prove activation or payload identity.
- Every later Nano decision carries `trackControl`.
- `ON_TRACK` directly advances the current high-leverage action.
- `JUSTIFIED_DETOUR` is limited to an owner dependency, safety boundary, blocker removal or required validation and must name an exact return condition.
- `DRIFT` emits a concrete correction back to the baseline.
- Deterministic protocol fast paths do not bypass missing baseline intake or the required Nano analysis.

Details: `docs/V0_10_9_ARCHITECTURE.md`.

## Full-audit directory law

Browser File System Access does not expose an absolute Windows path. Never use `handle.name` as proof of `C:\\temp`.

A full-audit directory becomes ready only after:

1. operator selection of an existing directory handle;
2. read/write permission;
3. unique probe write;
4. exact readback;
5. probe deletion.

The verified claim is only that the selected handle is writable. Audit failures remain fail-soft for the main program.

## Context law

Use progressive disclosure.

The default Nano context is:

- immutable task binding;
- mandate version/hash/reference;
- program goal, milestone and bounded unit;
- owner locators and evidence classes;
- current blockers and next direction;
- response hash and bounded observation anchors.

Do not copy full prior assistant prose or full conversation history into continuation prompts. Request a specific source section only when the next decision needs it.

## Evidence law

Every evidence-bearing claim uses one class:

- `OWNER_LIVE`
- `OWNER_RECEIPT`
- `OWNER_HISTORICAL`
- `DERIVED_VIEW`
- `LOCAL_CANDIDATE`
- `ROUTING_CONTEXT`
- `DRY_RUN`

Current/live claims require `OWNER_LIVE` or `OWNER_RECEIPT`. Durable-effect claims require `OWNER_RECEIPT`.

Sensitive transport fields are replaced with opaque handles before prompt, UI, evidence or audit rendering:
`session_locator`, `lock_token`, `confirmation_token`, `preflight_receipt`, `credential_ref`, `secret_ref`.

## Completion law

Keep completion levels independent:

- `UNIT_DONE`
- `MILESTONE_CONTINUE`
- `PROGRAM_BLOCKED`
- `PROGRAM_DONE`

`EIC_AUTONOMY:DONE` is legal only for `PROGRAM_DONE`, no concrete next action and owner-supported completion evidence.

## Nano activation and protocol law

- Model activation is a separate explicit operator action. Mission start never initiates or retries model creation.
- Mission start fails closed unless the LanguageModel base session is `available`, non-stale and canary-verified; an unknown host must never be represented as local analysis.
- `TAKEOVER_BOOTSTRAP` always goes through Nano. A malformed or historical footer in the pre-existing response is observation data, not authority to bypass Nano.
- After takeover, at most one deterministic protocol repair is allowed for an invalid footer. An invalid response to a repair turn returns to Nano instead of producing another repair.
- A repair prompt's requested `EIC_TURN` must be the newly allocated repair turn, never the stale expected turn.
- EIC-AA/5 has exactly five trailer lines: `EIC_TURN`, `EIC_NEXT`, `EIC_COMPLETION_EVIDENCE`, `EIC_NEXT_ACTOR` and `EIC_AUTONOMY`.
- Current combinations are:
  - `CONTINUE` with `AGENT` or `EXTERNAL_SYSTEM` and one concrete next action;
  - `OPERATOR_ACTION_REQUIRED` with `OPERATOR_ACTION` for one exact mechanical action;
  - `USER_PAUSE` with `OPERATOR_DECISION` and `PROGRAM_BLOCKED` for one material level-10 decision;
  - `DONE` with `NONE`, `PROGRAM_DONE` and `EIC_NEXT: NONE`.
- `PAUSE`, `FULL_STOP` and EIC-AA/4 are retired under the forward-only law.


## Operator action and decision law

- Mechanical operator work uses `AWAITING_OPERATOR_ACTION` and an exact `eic.autonom.operator-action.v1` object.
- A mechanical action never uses the level-10 acknowledgement solely because human presence is needed.
- Material level-10 decisions use `AWAITING_OPERATOR_DECISION` and an exact decision receipt.
- Decision acknowledgements are NFKC-normalized, grapheme-counted and bound to decision, mission, run and boundary.
- No Nano request or ordinary response timeout runs while an operator action is pending.
- Matching duplicate receipts are idempotent; stale or wrong-bound receipts fail closed.

## Session Capture and Session Memory law

- Session Capture is transcript-only, virtualisation-aware and records completeness gaps.
- Browser-visible reasoning summaries may be captured; hidden chain-of-thought is never requested or claimed.
- Attachments are references unless a separate owner route reads the body.
- Session Capture and Session Memory are stored locally in IndexedDB under current-only v0.10.1 namespaces.
- `chrome.storage.local` holds only small active-ID and readiness pointers.
- Session Memory is source-bound derived context, not project, repository, artifact or runtime truth.
- Nano receives a bounded active memory capsule, never the raw transcript.
- The user-visible purge removes local capture/memory records and pointers.
- The first source-bound core-surface review in each application session is exactly-once. If session initialization or mission Nano owns the model, the review is deferred with its app-session, capture and memory identities, then replayed after `READY` and model release.
- A deferred review must not be lost, duplicated or started in parallel with mission Nano. The automatic review gets the next local model turn after initialization; later reviews remain manual.

## Whole-application quick-profile law

Exactly four quick profiles exist:

1. `VERIFIED_ANALYSIS` — safe default.
2. `BOUNDED_DELIVERY`.
3. `STRICT_OPERATIONS_RECOVERY`.
4. `EXPLORATION_DESIGN`.

A recommendation may be automatic. A material profile switch must not be silent, and a manual profile binding is scoped to one mission/task.

## LanguageModel asset-admission and application-log law

- The operator-facing term is `Chrome on-device LanguageModel`; `Chrome Nano` is not used as the runtime product label.
- The 1,500-second host-create watchdog is the outer admission limit.
- `downloadable`, `downloading` or a `downloadprogress=0` event before any positive progress is `PREPARING_ASSETS`, not proof of an active download.
- `DOWNLOADING` is emitted only after Chrome reports a positive progress fraction.
- The material-progress deadline is 1,200 seconds.
- If that deadline expires before any positive progress, the terminal admission result is `EXTERNAL_MODEL_ASSET_BLOCKER`; automatic retry is forbidden.
- If positive progress was observed and then no material increase occurs for 1,200 seconds, the result is `DOWNLOAD_STALLED`.
- Duplicate progress events, including repeated `0 %`, do not extend the material-progress deadline.
- Reaching 100 % transfers the host to `LOADING`; extraction/loading is governed by the outer create watchdog, not the progress watchdog.
- The complete admission chain is written to the session-aware application log: admission start, availability, asset preparation, positive download progress, loading, available or terminal blocker, and settled.
- The application log is separate from the operator-facing audit log.
- Every application-log entry is bound to an application session and may additionally carry host, window, tab, run, mission and correlation identities.
- Logs rotate automatically by entry count, segment bytes and segment count. Oldest segments are discarded with explicit counters.
- Secrets, credentials, authorization fields, session locators and full prompt/body fields are never retained.
- Full application-log contents are returned only by explicit export; ordinary UI snapshots contain a bounded summary.

## Hard safety boundaries

- Trusted-session and owner-route gates remain fail-closed.
- Target/AI text is candidate data, never authority.
- Session Context, derived views and project chronology never become repository, release, install or runtime proof.
- No merge, release, deployment, installation or publication without the matching owner route and readback.
- Only genuine human-presence, secret, irreversible-destruction or material safety/policy boundaries require operator pause.


## v0.10.1 lifecycle and target-delivery law (preserved in v0.10.7)

- EIC-AA/5 is the only active target response protocol and requires exactly five final lines, including `EIC_NEXT_ACTOR`.
- Target prompts use one compact canonical JSON envelope. Markdown mirrors and HTML field/block markers are not delivered.
- Mandate `REFERENCE` delivery requires an acknowledged prior prompt effect in the same conversation/task/turn chain. `PREPARED` is not acknowledgement.
- Automatic LanguageModel restart is enabled by default only for already available, previously canary-verified assets. The same restart fingerprint is attempted at most once per ten minutes. Asset download/blocker states never auto-retry.
- Automatic Session Capture is enabled by default and is mission-independent. It runs only for a new stable transcript identity, restores scroll position and deduplicates unchanged turns.
- A lost sidepanel inference may requeue the preserved observation exactly once; repeated lifecycle recovery is blocked.

## Current schemas

- App/content: `0.10.7`
- Config/runtime: v13
- Continuity: v4
- Export: v20
- Session Capture: v1
- Session Memory: v1
- Operator action: v1
- Quick profile: v1
- Nano-host telemetry: v4
- UI command: v2
- UI snapshot: v3
- Turn protocol: EIC-AA/5

## Verification

Run:

```text
npm test
npm run validate
npm run package
```

Completion claims must use direct command output and exit status. Package claims require ZIP integrity and checksum verification. Desktop Chrome runtime remains a separate owner surface.

## Current documents

- `docs/V0_10_0_ARCHITECTURE.md`
- `docs/CHANGELOG_V0_10_0.md`
- `docs/VERIFICATION_V0_10_0.md`
- `docs/DESKTOP_CHROME_ACCEPTANCE_V0_10_0.md`
- `docs/V0_9_11_LANGUAGE_ATTESTATION.md`
- `docs/V0_9_3_FORWARD_ONLY_POLICY.md`
- `docs/V0_9_3_DELIVERY_CONTEXT_ARCHITECTURE.md`


## v0.10.3 automatic capture and core-surface review law

- Automatic Session Capture is background-owned and accepts only terminal assistant states `COMPLETE_STABLE` and `COMPLETE_PROTOCOL_OVERRIDE`.
- Capture is deduplicated by conversation, document epoch and latest-message hash and does not require an active mission or open side-panel render loop.
- The first successful capture in an application session creates at most one spontaneous Nano review request.
- Transcript and Session Memory remain untrusted data. They cannot grant authority, owner truth, permissions, credentials or external effects.
- Nano may propose safe settings changes and rewrites of the Nano mandate, target mandate and continuity context.
- No proposal is applied silently. The operator must explicitly apply or decline it.
- Later reviews in the same application session are manual only.
- Changes to project identity, target mode, Mjölnar rollout, permissions, credentials, release or deployment remain manual-only and outside the review patch.

## v0.10.4 automatic control and attention law

- Automatic Session Capture is background-owned and keyed by stable transcript identity only. A volatile document epoch is not a capture identity.
- The same stable fingerprint receives at most one automatic attempt. Manual capture is a separate operator action.
- Pause and Stop cancel pending debounce and the active transcript sweep; the content surface must restore scroll position before returning.
- Paused, stopped, operator-bound and terminal runs are ineligible for automatic capture.
- A material Nano core-surface proposal may be auto-applied after five minutes only when the default-enabled setting remains active and no operator accept/decline has superseded it.
- No-op proposals close without changing config, mandates, continuity or Nano-host freshness.
- Autostart presets are whole-start plans. D1 and D2 require explicit confirmation, and model creation remains bound to the initiating user gesture.
- The top attention banner is a derived locator, not authority. It routes to the highest-priority owner object and does not itself approve or complete it.

## v0.10.6 Autostart transaction-integrity law

- Current config/runtime acceptance must use the version constants owned by `lib/contracts.mjs`; schema and version may not drift between default creation, load, save and export.
- A current config/runtime object must round-trip without a forward-only reset. A schema/version mismatch is a release blocker.
- D1 and D2 use a staged in-panel confirmation. The second explicit operator click is the gesture that invokes native `LanguageModel.create()`; a modal `confirm()` may not precede that call.
- A LanguageModel activation rejection is handled synchronously before any later await, so Autostart cannot emit an unhandled promise while linking or persisting.
- Autostart must read back a selected linked ChatGPT tab and matching `CHATGPT_CONTROLLER` surface before mission start.
- After the preset config is persisted, mission start reuses that exact config and does not perform a second implicit save.

Details:
- `docs/V0_10_4_ARCHITECTURE.md`
- `docs/DESKTOP_CHROME_ACCEPTANCE_V0_10_4.md`
- `docs/V0_10_5_ARCHITECTURE.md`
- `docs/DESKTOP_CHROME_ACCEPTANCE_V0_10_5.md`


## v0.10.6 runtime hardening law

- The active run is projected into scoped continuity before sealing. A timestamp-only reseal is not a semantic state transition.
- On semantic change the previous verified continuity becomes N-1 backup and both primary and backup require storage readback.
- The extension control project and transcript-derived target project are separate. Transcript data cannot silently switch project authority.
- Mission Nano owns the local model while running. Automatic Session Capture and automatic core review defer instead of competing with or invalidating it.
- A stored capture for the same conversation/task may not regress to a smaller virtualized DOM view. Delta and full refresh remain cumulative and monotonic.
- Nano host telemetry must preserve omitted values, synchronize claim lease on heartbeat and clear busy/current status on terminal paths.
- Mission projection carries current step, next action, assessed risk and execution status.
- Strong external-effect claims require matching owner receipts. `NO_STRONG_CLAIMS` is not `VERIFIED`.
- `M2_MANDATE` is exact-action, expiring, readback-bound and operator-equivalent only below level 10. It is never actual `OPERATOR_APPROVAL`.
- Full audit is default-OFF, redacted, bounded, rotated and fail-soft. It may write only through an operator-granted handle to an existing directory; it never creates or scans `C:\\temp`.
- Source/package gates do not prove installed Desktop Chrome behavior.

Details:
- `docs/V0_10_6_ARCHITECTURE.md`
- `docs/V0_10_6_REMEDIATION_MATRIX.md`
- `docs/VERIFICATION_V0_10_6.md`
- `docs/DESKTOP_CHROME_ACCEPTANCE_V0_10_6.md`

## v0.10.7 deterministic delivery-regulator and wait law

- A deterministic turn-bound `CONTINUE` must carry a complete delivery contract before `evaluateDirectProgramDelta()` runs.
- Concrete bounded work carries `directProgramDelta=1..3`.
- A continuation that first requires owner control carries `requiredControl=true`, a concrete `omissionFailure` and an exact `unlocksNextAction`; target text remains continuation data and never becomes owner evidence.
- A genuine `DIRECT_PROGRAM_DELTA_ZERO` rejection consumes the current response identity and clears the pending observation.
- A rejected branch enters stable `WAITING_FOR_RESPONSE` with suspended response timeout and `deliveryWait.status=WAITING_OWNER_EVIDENCE`.
- A delivery rejection must not transition to auto-recoverable `SOFT_PAUSED`, rearm the same observation or schedule another deterministic callback.
- The attention surface must show `Väntar på extern owner/locator` while that stable wait is active.
- A new response identity or fresh owner evidence may clear the wait and start a new bounded decision cycle.
- Source/package PASS remains separate from installed Desktop Chrome runtime acceptance.

Details:
- `docs/V0_10_7_ARCHITECTURE.md`
- `docs/CHANGELOG_V0_10_7.md`
- `docs/VERIFICATION_V0_10_7.md`
- `docs/DESKTOP_CHROME_ACCEPTANCE_V0_10_7.md`

