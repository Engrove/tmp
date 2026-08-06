# EIC Autonom Agent v0.10.11

Chrome MV3 extension for bounded autonomous continuation of an operator-owned task.

v0.10.11 is current-version-only under the forward-only law introduced in v0.9.3. It does not migrate or emulate earlier storage, export, UI, prompt, capture, memory or operator-action contracts. No backward compatibility is required or preserved.

## Current behavior

- The deterministic baseline/protocol decision is applied **in-band**, inside the same serialized operation that persisted its dispatch state. No prompt-critical step runs from a detached callback, and a dispatch exception is persisted, audited and written to the application log instead of reaching only the service-worker console.
- The session-context initialization gate is **live-bounded**: its transient controller-owned phases fail to an explicit `FAILED` state with an operator retry, instead of blocking every prompt indefinitely.
- An observation is recorded as processed only when it actually produced a delivered turn, so a baseline question that was never sent can never make its own retry evidence unreachable.
- A deferred automatic Session Capture backs off exponentially to 30 s instead of retrying at a fixed 2.5 s.
- Every manual mission start and every Autostart path first enters one universal session-context initialization gate: chat-state inspection, stable catch, deterministic baseline request, baseline response and Nano analysis.
- All ordinary prompts, special modes and effects remain blocked until the initialization state is `READY`.
- A closable translucent ChatGPT overlay shows the active agent phase; dismissal applies only to the current need, so the next phase or future need appears again.
- The canonical `eic.main-task-baseline.v1` request is application-authored deterministic text, not free-form Nano output.
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
- Nano first requests an `eic.main-task-baseline.v1` when no stable main-task baseline exists.
- The baseline carries measurable completion, scope, owners, blockers, the 80/20 vital few/deferred many, active/required global skills and a bounded detour return condition.
- Every Nano continuation classifies the candidate as on-track, justified detour, drift or insufficient context.
- Deterministic protocol fast paths remain withheld until the main-task baseline exists.
- Trusted-session, owner-route, claim, approval, effect and recovery gates remain fail-closed.

## Preserved Chrome Prompt API contract

v0.10.11 preserves the verified v0.9.11 activation path and v0.10.1–v0.10.2 lifecycle/UI fixes:

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
| App/content | 0.10.11 |
| Config/runtime | v13 |
| Continuity | v4 |
| Export | v20 |
| Operator action | v1 |
| Session Capture | v1 |
| Session Memory | v1 |
| Quick profile | v1 |
| Nano-host telemetry | v4 |
| UI command | v2 |
| UI snapshot | v3 |
| Turn | EIC-AA/5 |

## Local storage

Structured captures, turns, sections, summaries, session memories and operator actions use extension IndexedDB. `chrome.storage.local` contains only small active-ID/readiness pointers in addition to existing config/runtime state. Secret-like fields are redacted. The UI provides explicit local purge.

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

- [v0.10.7 architecture](docs/V0_10_7_ARCHITECTURE.md)
- [v0.10.7 changelog](docs/CHANGELOG_V0_10_7.md)
- [v0.10.7 verification](docs/VERIFICATION_V0_10_7.md)
- [v0.10.7 Desktop Chrome acceptance](docs/DESKTOP_CHROME_ACCEPTANCE_V0_10_7.md)
- [v0.10.7 change manifest](docs/V0_10_7_CHANGE_MANIFEST.json)
- [v0.10.6 architecture](docs/V0_10_6_ARCHITECTURE.md)
- [v0.10.6 remediation matrix](docs/V0_10_6_REMEDIATION_MATRIX.md)
- [v0.10.6 full audit](docs/FULL_AUDIT_V0_10_6.md)
- [v0.10.6 verification](docs/VERIFICATION_V0_10_6.md)
- [Forward-only policy](docs/V0_9_3_FORWARD_ONLY_POLICY.md)
- [Delivery/context architecture](docs/V0_9_3_DELIVERY_CONTEXT_ARCHITECTURE.md)
- [v0.9.11 Prompt API activation](docs/V0_9_11_LANGUAGE_ATTESTATION.md)

Historical documents in `docs/` are archival context only and are not compatibility obligations.

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
