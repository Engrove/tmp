# v0.9.0 execution ledger

## Control

- Release: one `v0.9.0`.
- Execution method: WP00–WP05 manual; autonomous strict-WP progression authorized by the operator from WP06.
- Approval rule: from WP06, proceed autonomously one green WP at a time; stop at real owner/safety/risk/acceptance boundaries.
- Active gate: WP14 source gate implemented; final package hashes are recorded outside the source package.
- Source baseline: artifact 1119.
- Working-copy version: 0.9.0.
- Repository state: no Git/Forgejo checkout or persistence claim established in WP00.

## Work packages

| WP | Delivery | State | Evidence | Next condition |
|---|---|---|---|---|
| WP00 | Baseline, scope, execution ledger, inventory and ADRs | IMPLEMENTED | WP00 evidence and source candidate | Await WP01 approval |
| WP01 | uiSnapshot, command dispatch and UI/runtime separation | IMPLEMENTED | WP01 contract, tests and evidence | Await WP02 approval |
| WP02 | Mission domain, mode registry, state machine and persistence schema | IMPLEMENTED | WP02 contract, tests and evidence | Await WP03 approval |
| WP03 | Mission Control app shell | IMPLEMENTED | WP03 shell contract, tests and evidence | Await WP04 approval |
| WP04 | Migrate all v0.8.2 functions into mission modes | IMPLEMENTED | WP04 contract, tests and evidence | Await WP05 approval |
| WP05 | Controller/target pairing and tab lifecycle | IMPLEMENTED | WP05 pair contract, lifecycle tests and evidence | Await WP06 approval |
| WP06 | Dual builds, permission model and CDP session | IMPLEMENTED | WP06 contract, tests, profile manifests and package evidence | Proceeded autonomously to WP07 |
| WP07 | DOM/AX, screenshots, console, network and evidence storage | IMPLEMENTED | WP07 contract, redaction/storage tests and evidence | Proceeded autonomously to WP08 |
| WP08 | EIC_BROWSER_ACTION/1 parser, validator and executor | IMPLEMENTED | WP08 contract, 24 focused tests, exactly-once ledger and package evidence | Proceeded autonomously to WP09 |
| WP09 | End-to-end ChatGPT/EIC browser loop and verified image attachment | IMPLEMENTED | WP09 contract, 15 focused tests, controller/action/prompt barriers and attachment readback logic | Proceeded autonomously to WP10 |
| WP10 | Risk policy, prompt-injection defense, redaction and approvals | IMPLEMENTED | WP10 contract, 21 focused tests, exact approvals and trust isolation | Proceeded autonomously to WP11 |
| WP11 | Recovery, migration, import and rollback | IMPLEMENTED | WP11 contract, 18 focused tests, export v12 and digest-bound rollback | Proceeded autonomously to WP12 |
| WP12 | UI/UX polish, Focus Mode and responsiveness | IMPLEMENTED | WP12 contract, 15 focused tests, accessibility and responsive CSS | Proceed to WP13 runtime gate |
| WP13 | Full regression and real Desktop Chrome acceptance | IMPLEMENTED | Operator-reported Desktop Chrome PASS; source baseline regression 575/575 | Proceed to WP14 |
| WP14 | Versioning, documentation, packages, hashes and release receipt | IMPLEMENTED | 8/8 focused, 583/583 regression, validate and syntax gates | External hash receipt after package freeze |

## WP00 receipt

### Inputs

- Source artifact: 1119.
- Source SHA-256: `46bd49e0310ff39b9da906ae024e834ba47ddacc2ae0700b62fd7603b9328c9d`.
- Requirements transcript SHA-256: `d4fc78c8690861af1bfb3cdb14c1cf3a5e79191ff627b24faeb51a091a5c2a26`.
- Transcript completeness: `VERIFIED_COMPLETE_BROWSER_TRANSCRIPT`, six turns.
- Missing inputs: all nine referenced attachment bodies.

### Baseline

- `npm test`: exit 0, 382/382 PASS before WP00 edits.
- `npm run validate`: exit 0, PASS before WP00 edits.
- Version: 0.8.2.
- Config/runtime/export/continuity schemas: v8/v8/v10/v2.
- Manifest has no `debugger` permission and no general website host permission.

### Operator acceptance attestation

The operator reported on 2026-08-04 that v0.8.2 Desktop Chrome acceptance passed.
No scenario-level browser log, screenshot set or machine-readable result was supplied in this gate.
The statement is retained as an operator attestation, not upgraded to tool-verified browser evidence.

### Files created

- `EIC.md`
- `docs/V0_9_0_REQUIREMENTS_BASELINE.md`
- `docs/V0_9_0_EXECUTION_LEDGER.md`
- `docs/V0_9_0_CONTROL_INVENTORY.md`
- `docs/V0_9_0_STATE_MAP.md`
- six v0.9.0 ADRs
- `docs/DESKTOP_CHROME_ACCEPTANCE_RESULT_V0_8_2.md`
- `docs/V0_9_0_WP00_EVIDENCE.json`
- baseline and post-change command logs
- `tests/v090-wp00-contract.test.mjs`

### Gate decision

The source work is implemented when post-change focused tests, full regression, validation and source ZIP integrity succeed. The project owner record may mark WP00 PASS only after artifact write/readback and project chronology readback succeed. WP01 remains blocked
until the operator explicitly approves it.

## WP01 receipt

### Inputs

- Operator approval: `Godkänn WP01`.
- Working baseline: completed WP00 candidate, SHA-256
  `e0928fc6ba8fd8cb5a2386675f5379146ae159599db232d6de68d4cb314b7b7c`.
- Pre-change `npm test`: exit 0, 388/388 PASS.
- Pre-change `npm run validate`: exit 0, PASS.

### Implementation

- Added `lib/ui-contract.mjs`.
- Added `lib/ui-runtime-client.mjs`.
- Replaced the background command switch with a closed `UI_COMMAND_HANDLERS` registry.
- Added versioned command, result and `uiSnapshot` schemas.
- Added request-id and command-bound response validation.
- Separated panel DOM rendering from message-envelope construction and result decoding.
- Added focused WP01 tests and contract documentation.

### Preserved boundaries

- No visible Mission Control redesign.
- No persistent schema, version, permission or host-permission change.
- No browser target, CDP session, general web permission or browser action.
- WP02 has not started.

### Verification

- Focused WP01 contract: 10/10 PASS.
- Full regression: 398/398 PASS.
- Static validation: PASS.
- Syntax checks: 13/13 PASS.
- Source delta: 4 functional/documentation files added before evidence materialization, 12 files modified,
  0 files removed; manifest, package, persistent contracts, sidepanel HTML and CSS are byte-identical.
- Packaging and ZIP integrity: PASS; final immutable package hashes are recorded outside this
  source-contained ledger to avoid self-referential package hashing.
- The first post-change regression exposed seven static fixtures that encoded the old
  `switch (message.command)` implementation. They were migrated to assert the closed registry and
  central dispatcher; no runtime behavior defect was found.

### Gate decision

WP01 source gate is PASS. The versioned UI boundary is implemented without visual redesign,
persistent-schema change or permission expansion. WP02 remains blocked until explicit operator approval.



## WP02 receipt

### Inputs

- Operator approval: `Godkänt`, bound to the immediately preceding WP01 gate.
- Working baseline: completed WP01 candidate, SHA-256
  `0c1821271a35cbcdfc07504b9a4c5cbda5d6e0af789e0c427e955bceba698a04`.
- Pre-change `npm test`: exit 0, 398/398 PASS.
- Pre-change `npm run validate`: exit 0, PASS.

### Implementation

- Added `lib/mission-contract.mjs`.
- Added `lib/mission-state-machine.mjs`.
- Added `lib/migration-v8-v9.mjs`.
- Added a closed registry with four migrated standard modes and disabled browser-only
  `AI_WEB_RESEARCH`.
- Added explicit `CHATGPT_CONTROLLER` and `WEB_TARGET` role fields.
- Added a closed Mission lifecycle with fail-closed unknown-state handling.
- Advanced config/runtime/export/audit/window/UI snapshot schemas to v9/v9/v11/v9/v7/v2.
- Added normalized Mission persistence, per-window references and run-to-mission reconciliation.
- Added v11 Mission view export/import while retaining v3–v10 import compatibility.

### Preserved boundaries

- Legacy run v8 remains execution owner until WP04.
- No visual Mission Control redesign or WP03 app shell.
- No new permissions, host permissions, browser actions, origin grants or CDP session.
- `AI_WEB_RESEARCH` is registered but disabled.
- Package/application version remains 0.8.2 until WP14.

### Verification

- Focused WP02 Mission contract: 11/11 PASS.
- Full regression: 409/409 PASS.
- Static validation: PASS.
- Background service-worker smoke: PASS.
- Syntax checks: 94/94 JavaScript/MJS files PASS.
- Functional delta before evidence materialization: 5 files added, 12 modified and 0 removed.
- `manifest.json`, `package.json`, `sidepanel.html` and `sidepanel.css` remain byte-identical to WP01.
- The first post-change full run exposed one historical fixture that encoded export v10. It was
  advanced to the intentional current export v11; no runtime behavior defect was identified.
- Packaging and ZIP integrity results are stored outside this source-contained ledger to avoid
  self-referential package hashing.

### Gate decision

WP02 source gate is PASS after the declared verification and immutable package checks succeed.
WP03 remains blocked until explicit operator approval.


## WP03 receipt

### Inputs

- Operator approval: `Godkänt`, bound to the immediately preceding WP02 gate.
- Working baseline: completed WP02 candidate, SHA-256
  `82c9cf69ac86b1bd2bc50e4fc6fa2ee54d64baeea78861fbf7b59c64b099f83d`.
- Pre-change `npm test`: exit 0, 409/409 PASS.
- Pre-change `npm run validate`: exit 0, PASS.

### Implementation

- Added `lib/mission-control-shell.mjs` with a closed five-view registry and accessible local navigation.
- Rebuilt `sidepanel.html` as a Mission Control shell with sticky topbar, view panels and action dock.
- Added read-only active-Mission and explicit surface-role summaries from the WP02 `uiSnapshot`.
- Preserved every existing v0.8.2 control id and WP01 runtime command path.
- Added responsive shell CSS, focused WP03 tests and the WP03 contract document.

### Preserved boundaries

- No semantic migration of existing functions into Mission execution; WP04 owns that work.
- No config/runtime/export/Mission/uiSnapshot schema change.
- No permission, host, origin-grant, debugger/CDP or browser-action change.
- `AI_WEB_RESEARCH` remains disabled.
- Package/application version remains 0.8.2 until WP14.

### Verification

- Focused WP03 shell contract: 12/12 PASS.
- Full regression: 421/421 PASS.
- Static validation: PASS.
- Background service-worker smoke: PASS.
- Syntax checks: 96/96 JavaScript/MJS files PASS.
- First full regression exposed two static compatibility fixtures: one attribute-order regex and one
  WP00 ledger assertion frozen to WP03 waiting state. Both were updated without changing runtime behavior.
- Immutable package hashes are recorded outside this source-contained ledger to avoid
  self-referential package hashing.

### Gate decision

WP03 source gate is PASS only after all declared checks and immutable package integrity succeed.
WP04 remains blocked until explicit operator approval.

## WP04 receipt

### Inputs

- Operator approval: `Fortsätt`, bound to the immediately preceding WP03 gate.
- Working baseline: completed WP03 candidate, SHA-256
  `b062d4ffd49a063ed9a764c0d8315bef893d27d8d83ec1c7d2a1819e4dde5fd1`.
- Pre-change `npm test`: exit 0, 421/421 PASS.
- Pre-change `npm run validate`: exit 0, PASS.

### Implementation

- Added `lib/mission-mode-adapter.mjs` with the closed Mission template and input registry.
- Added `START_MISSION { modeId, input }` to the WP01 command boundary.
- Made Mission the execution owner and the v0.8.2 run object an explicit `LEGACY_RUN_V8` adapter.
- Bound every new adapter run to one Mission id and fail-closed mode agreement.
- Migrated continuation, new-session, app-audit and archaeology starts through the generic command.
- Added a Mission selector and mode panels; retained all historical control ids.
- Moved autonomy and Mjölnar rollout to Settings and local boundary authorization to Run.
- Kept `AI_WEB_RESEARCH` visible but disabled.

### Preserved boundaries

- WP05 controller/target pairing is not implemented.
- No version, persistent schema, permission, host-permission, origin-grant, CDP or browser-action change.
- The four historical start commands remain compatibility aliases only.
- Package/application version remains 0.8.2 until WP14.

### Verification

- Focused WP04 Mission migration contract: 15/15 PASS.
- Full regression after implementation and documentation: 436/436 PASS.
- Static validation: PASS.
- Background service-worker smoke: PASS.
- JavaScript/MJS syntax: 98/98 PASS.
- All 44 baseline interactive controls remain present exactly once.
- Package/build-info and immutable ZIP checks are executed after this source-contained ledger is
  frozen; immutable package hashes are kept outside the ledger to avoid self-referential hashing.

### Gate decision

WP04 source gate is PASS only after all declared checks and immutable package integrity succeed.
WP05 remains blocked until explicit operator approval.



## WP05 receipt

### Inputs

- Operator approval: `acepterat`, bound to the immediately preceding WP05 gate.
- Working baseline: completed WP04 candidate, SHA-256
  `b2137ad2a325113686a52a7935b93ca50c9b3a91a07ff0644a26a76e0f267e6c`.
- Pre-change `npm test`: exit 0, 436/436 PASS.
- Pre-change `npm run validate`: exit 0, PASS.

### Implementation

- Added `lib/surface-pair.mjs` with versioned pair and surface contracts.
- Materialized separate controller and target identities in each window context.
- Added explicit target bind/detach commands and Mission Control status fields.
- Bound existing ChatGPT link/select operations to `CHATGPT_CONTROLLER`.
- Added tab activation, update, replacement, close and cross-window lifecycle handling.
- Bound standard Missions to controller identity without activating browser mode.

### Preserved boundaries

- No version, manifest permission or host-permission expansion.
- No dual build, origin grant, `chrome.debugger`, CDP session or browser action.
- No DOM/AX, screenshot, console or network evidence collection.
- `AI_WEB_RESEARCH` remains disabled.
- WP06 has not started.

### Gate decision

WP05 source gate is PASS only after the recorded focused tests, full regression,
validation, background smoke, syntax checks, package identity and ZIP integrity
succeed. WP06 remains blocked until explicit operator approval.


## WP06 receipt

### Scope

- Added closed standard/browser build profiles.
- Added exact-origin optional permission request, readback and revocation.
- Added identity-bound CDP attach/detach with fail-closed lifecycle invalidation.
- Added four closed UI commands and Webbytor controls.
- Did not start WP07 DOM/AX, screenshot, console or network collection.

### Verification

- Pre-change baseline: 453/453 tests PASS and validator PASS.
- WP06 focused contract: 12/12 PASS.
- Full regression after integration: 465/465 PASS.
- Validator: PASS.
- Background boot smoke: PASS.
- Source manifest remains the standard profile.
- Browser manifest is generated only during packaging.


## WP07 receipt

### Scope

- Added `eic.autonom.evidence-store.v1`, `eic.autonom.evidence-item.v1` and
  `eic.autonom.evidence-observation.v1`.
- Added explicit start/capture/stop/clear evidence commands.
- Added bounded CDP observation for Runtime, Log, Network and Page metadata.
- Added reduced/redacted Accessibility and DOM summaries.
- Added session-only screenshot bodies with decoded-byte SHA-256 and storage readback.
- Added event-bound console, network and navigation evidence.
- No response-body capture, arbitrary JavaScript, browser action parser or action executor.

### Bounds

- 200 durable items and 1.5 MB durable metadata per window.
- 4 screenshots, maximum 4 MB decoded PNG body each.
- 500 AX nodes and 250 layout bounds per snapshot.
- Console, network, navigation and receipt type quotas.
- Item identity includes tabId, surfaceId, documentEpoch and origin.
- Target or CDP identity loss marks observation stale.

### Verification

- Focused WP07 contract: 17/17 PASS.
- Full regression before final package evidence: 482/482 PASS.
- Validator, background smoke, syntax, build-info and package integrity are rerun after this receipt.
- Screenshot bodies are excluded from durable storage and prompt delivery.
- WP08 remains not started until this gate is frozen.

## WP08 receipt

### Scope

- Strict `EIC_BROWSER_ACTION/1` parser and validator.
- Fixed 17-operation action registry.
- Digest-verifiable `EIC_BROWSER_OBSERVATION/1`.
- Exactly-once pre-dispatch barrier with bounded action/turn ledger.
- Bounded Accessibility/DOM/Input/Page executor and evidence receipts.
- No WP09 controller loop or ChatGPT attachment.

### Verification

- Focused WP08 contract: 24/24 PASS.
- Full regression: 506/506 PASS.
- `npm run validate`: PASS.
- `node scripts/background-smoke.mjs`: PASS.
- JavaScript/MJS syntax: 113/113 PASS before evidence freeze.
- Final package/hash results are recorded in the external WP08 gate receipt and EIC code revision readback.

### Gate boundary

This gate proves source and fixture behavior only. It does not prove live target execution,
Desktop Chrome behavior, screenshot attachment, installed extension, repository persistence,
release or deployment.

## WP09 receipt

### Scope delivered

- Added a versioned browser-controller loop bound to one `CHATGPT_CONTROLLER` response and one
  `WEB_TARGET` action.
- A complete controller response is durably consumed before the WP08 action dispatcher is called.
  Replaying the same response hash is blocked, including after service-worker restart.
- Added a second durable prompt-dispatch barrier after action/evidence processing and before the
  structured observation prompt is submitted to ChatGPT.
- Added post-action accessibility observation for non-navigation actions. Navigation actions return
  only their bounded action receipt until the target obtains a fresh document epoch.
- Added screenshot-body reconstruction from `chrome.storage.session`, decoded-byte SHA-256 readback
  and a content-bridge image attachment path.
- A screenshot attachment receipt is accepted only after the ChatGPT composer reports matching file
  input or attachment-DOM readback. The observation prompt is not submitted if attachment verification
  fails.
- Added `PROCESS_BROWSER_CONTROLLER_STEP` as one closed internal UI/runtime command.
- `AI_WEB_RESEARCH` remains disabled until WP10 risk policy, prompt-injection defense and approval
  rules are installed.

### Source verification

- Focused WP09 contract: 15/15 PASS.
- Full regression after the functional change: 521/521 PASS.
- Validator: PASS.
- Background boot smoke: PASS.
- JavaScript/MJS syntax: 115/115 PASS before documentation/package evidence freeze.
- No direct `chrome.debugger.sendCommand` was added to `background.js`; post-action observation is
  delegated to the bounded browser-loop module, preserving the WP06/WP07 architecture boundary.

### Claim boundary

- Source contracts, local fixtures, digest/readback logic and fail-closed replay barriers are verified.
- No live `WEB_TARGET` action, real screenshot pixel, ChatGPT attachment, installed Chrome runtime,
  repository persistence, release, deployment or artifact storage is claimed by this gate.
- Desktop Chrome runtime acceptance remains WP13 work.
- WP10 risk policy is not part of WP09.



## WP10 receipt

### Scope

- Added `eic.autonom.browser-risk-decision.v1` and `eic.autonom.browser-approval.v1`.
- Classified browser work as `READ_ONLY`, `INTERACTIVE`, `EXTERNAL_EFFECTS` or `HUMAN_REQUIRED`.
- Bound approvals to the exact action digest, controller-response hash, target identity and 15-minute TTL.
- Required a durable approval record before external-effect dispatch.
- Made authentication, 2FA/WebAuthn, CAPTCHA, payment, destructive account work,
  local-file/native-dialog work and secret access non-automatable even with approval.
- Marked all target-page text as untrusted observation with instruction authority `NONE`.
- Enabled `AI_WEB_RESEARCH` only in the browser build after exact-origin, CDP and evidence gates.
- Added explicit operator approve/deny UI and preserved the fixed WP08 action registry.
- Did not start WP11 recovery/import/rollback work.

### Verification

- Pre-change baseline: 521/521 tests PASS and validator PASS.
- WP10 focused contract: 21/21 PASS.
- Full regression after policy integration: 542/542 PASS.
- Response bodies remain disabled.
- `Runtime.evaluate`, function calls, cookies and request mutation remain forbidden.
- Live target execution and Desktop Chrome acceptance remain outside this source gate.

### Gate decision

WP10 source gate is PASS only after final validation, background smoke, syntax,
package identity and ZIP integrity succeed. Autonomous strict-WP progression may continue
to WP11; no live-browser or release claim follows from this source gate.


## WP11 receipt

### Scope

- Added `eic.autonom.browser-recovery.v1` with fail-closed lifecycle recovery.
- Navigation/reload/replacement/move/close, service-worker identity loss and debugger
  detach pause the browser loop, clear approvals and require explicit recovery.
- Recovery verifies exact target or same-origin rebind, origin permission, CDP attachment
  and active evidence observation. No pending action is replayed.
- Advanced export to `eic.autonom.export.v12`; import remains compatible with v3–v12.
- Imported tabs, origin grants, CDP sessions, approvals and pending effects are sanitized.
- Added a digest-bound, 1.5 MB-bounded, single-use import rollback.
- UI snapshots expose rollback metadata only; rollback bodies remain background-owned.
- Added explicit recovery and rollback controls.
- WP12 Focus Mode/responsive polish was not started in this gate.

### Verification

- Focused WP11 contract: 18/18 PASS.
- Full regression: 560/560 PASS.
- Validator, background boot smoke and JavaScript/MJS syntax: PASS.
- Final package/hash results are recorded in the WP11 receipt and EIC code revision.

### Claim boundary

The gate verifies source contracts, fixtures, local storage/readback logic and package
integrity. It does not prove live Chrome lifecycle recovery, installed extension state,
repository persistence, release, deployment or production runtime.


## WP12 receipt

### Scope

- Added versioned UI-only Focus Mode preference in panel `sessionStorage`.
- Added a header toggle, `Alt+F`, skip link and assertive operational status announcer.
- Secondary cards are hidden only through explicit focus markers; approval, recovery and
  boundary controls remain visible.
- Added snapshot-derived `IDLE`, `ACTIVE`, `ATTENTION` and `BLOCKED` visual priority.
- Added responsive navigation, touch targets, single-column narrow layout, reduced-motion,
  forced-colors and `:focus-visible` support.
- No background command, browser protocol, permission, risk, recovery or persistence
  contract changed.
- WP13 Desktop Chrome acceptance was not executed by this source gate.

### Verification

- Focused WP12 contract: 15/15 PASS.
- Full regression: 575/575 PASS.
- Validator, background boot smoke and JavaScript/MJS syntax: PASS.
- Final package/hash results are recorded in the WP12 receipt and EIC code revision.

### Claim boundary

The gate verifies source contracts, static accessibility/responsive invariants, local tests
and package integrity. It does not prove actual side-panel rendering, keyboard interaction,
screen-reader behavior or Desktop Chrome runtime. Those require WP13.

## WP13 receipt

### Runtime verdict

- Operator response: `PASS, fortsätt.`
- Date: 2026-08-04.
- Candidate: WP12 browser package, SHA-256
  `0357e5c5f956a43cc14587d11039b7d6a969b2b9dbfee480fb7324eb3581b337`.
- Verdict: PASS, operator-reported.

### Evidence boundary

No scenario-level log or screenshot set was supplied. The overall human-owned runtime verdict is
retained without inventing individual scenario results.

## WP14 receipt

### Scope

- Synchronize active version surfaces to 0.9.0.
- Add final changelog, verification and Desktop Chrome result documentation.
- Build distinct standard, browser and source packages.
- Verify tests, validation, syntax, build-info and ZIP integrity.
- Emit immutable package hashes in an external receipt after packaging.

### Release boundary

A local source/package release candidate does not establish Git persistence, merge, deployment,
Chrome Web Store publication or installed-runtime identity.


### Source verification

- Focused WP14 release contract: 8/8 PASS.
- Full regression: 583/583 PASS.
- Static validator: PASS.
- JavaScript/MJS syntax: 122/122 PASS.
- Durable schema versions remain config/runtime v9 and export v12.
- STANDARD and BROWSER permission profiles remain separated.
