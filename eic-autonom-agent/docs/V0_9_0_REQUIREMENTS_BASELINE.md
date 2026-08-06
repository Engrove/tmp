# v0.9.0 requirements baseline

## Evidence sources

| Source | Identity | Supported use |
|---|---|---|
| v0.8.2 source artifact | artifact 1119, SHA-256 `46bd49e0310ff39b9da906ae024e834ba47ddacc2ae0700b62fd7603b9328c9d` | Exact v0.8.2 source baseline |
| Browser transcript | SHA-256 `d4fc78c8690861af1bfb3cdb14c1cf3a5e79191ff627b24faeb51a091a5c2a26` | Browser-visible requirements and plan |
| Operator statement, 2026-08-04 | “v0.8.2 Desktop Chrome-acceptansen har körts: PASS.” | Operator attestation only |

The transcript completeness verdict covers the six browser-visible conversation turns. It does not
contain the bodies of nine reference-only attachments. The seven UI screenshots and the referenced
`EIC_Autonom_Agent_v0.9.0_plan_och_Nano_prompter.md` body are therefore not owner-readable here.
Requirements below are limited to text present in the transcript.

## Release objective

Create one v0.9.0 release through WP00–WP14. The release combines:

1. Mission Control redesign.
2. A two-tab browser-agent subsystem with ChatGPT/EIC as controller and a separate web target.
3. Separate standard and browser-enabled packages.
4. Bounded evidence, permissions, recovery and manual approval behavior.

## Required Mission Control views

- **Körning** — active mission, state, current step, next action and blocker.
- **Webbytor** — controller/target pairing, permissions, origin and browser status.
- **Evidens** — screenshots, receipts, console, network, DOM/accessibility and timeline.
- **Uppdrag** — mission builder and mode templates.
- **Inställningar** — governance, Nano, Mjölnar, data, recovery and advanced policy.

A fixed header, persistent navigation and state-specific action dock are required. The main panel
should have one primary vertical scroll, with scoped exceptions for large evidence or JSON views.

## Mission and role model

Existing v0.8.2 functions must be represented as mission modes. Add:

- `CHATGPT_CONTROLLER`
- `WEB_TARGET`
- `AI_WEB_RESEARCH`

The target tab must have its own identity and lifecycle. `selectedTabId` cannot be reused as the
browser target role.

## Browser action protocol

Required action registry:

`observe`, `scroll`, `click`, `double_click`, `focus`, `type`, `clear`, `select`, `check`,
`uncheck`, `keypress`, `navigate`, `back`, `forward`, `reload`, `wait_for`, `capture`.

Forbidden generic operations include `eval`, `execute_javascript`, `run_script`, `call_function`,
`set_cookie` and `modify_request`.

The model may request exactly one structured action per response. The extension validates the
operation, target, current document epoch, origin boundary, risk and expected effect before dispatch.

## Observation and evidence

The controlled diagnostic package includes:

- accessibility tree;
- DOM/layout snapshot;
- screenshot;
- console errors and uncaught exceptions;
- request/response metadata;
- HTTP failures and failed requests;
- navigation and load state.

Response bodies are opt-in and require redaction. Credentials, authorization/cookie headers and
password values must never enter durable evidence.

## Permissions and builds

- Standard package preserves the current restricted ChatGPT permission boundary.
- Browser package may add `debugger` and explicit optional host permissions.
- General website access is granted per origin by the operator.
- Origin changes pause the mission until explicitly approved.

## Recovery and acceptance

Recovery must fail closed after target navigation, reload, service-worker restart, debugger detach,
tab replacement and import. Unit fixtures are not Desktop Chrome acceptance. WP13 requires real
Chrome execution in a separate profile or user-data-dir.

## Manual execution override

The transcript proposed autonomous Nano operation. The current operator instruction overrides that
method: implementation is manual and every WP stops for explicit approval before the next WP.
