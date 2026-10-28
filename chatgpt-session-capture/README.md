# ChatGPT Session Capture 1.1.1

A local Chrome Manifest V3 extension for collecting the text and UI data that a ChatGPT conversation exposes in the browser. The extension does not call a ChatGPT conversation reconstruction endpoint and does not attempt to obtain server-only data.

Version 1.1.1 retains a compact **AI transcript** profile. With the default settings, only the controlled conversation sweep and safe expansion of browser-visible reasoning panels are used. The resulting ZIP is intended to be small enough to upload directly to a reviewing AI.

## Default AI transcript profile

The default controls are deliberately identical to the requested minimal capture configuration:

- Deep network capture through Chrome Debugger: **off**
- Page fetch/XHR/WebSocket capture: **off**
- Reload tab after start: **off**
- IndexedDB and Cache Storage: **off**
- Page state and React/runtime objects: **off**
- Expand safe details during sweep: **on**
- Aggressive runtime snapshot: **off**
- Cookies and sensitive headers: **off**
- Stabilization per step: **1000 ms**

When these settings are used, the archive contains only:

```text
AI_TO_AI_INSTRUCTIONS.md
conversation/session.md
conversation/session.json
diagnostics/completeness.json
attachments/manifest.json
manifest/session.json
```

`AI_TO_AI_INSTRUCTIONS.md` is placed in the ZIP root and tells a reviewing AI how to interpret the archive, which file to read first, what the completeness verdict means, and why browser-visible reasoning summaries must not be treated as hidden chain-of-thought.

## What is fixed in 1.1.1

- The extension verifies that its content-script receiver exists before a capture is marked active.
- If the ChatGPT tab was already open when the extension was installed or reloaded, the required MAIN- and ISOLATED-world scripts are injected programmatically; a manual page reload is no longer required.
- Full sweep and optional snapshot operations automatically repair a missing receiver and retry.
- A failed receiver bootstrap no longer leaves a newly started capture falsely marked active.
- Optional page-state snapshots pass through the background controller and use the same self-healing injection path.

## What is fixed in 1.1.0

- Browser-visible reasoning panels are extracted from ChatGPT's current `button[aria-expanded]` structure, not only from HTML `<details>` elements.
- Reasoning summaries and the final assistant answer are stored as separate fields and separate Markdown sections.
- Page-level fetch, XHR, WebSocket and EventSource capture is now controlled by its own checkbox and is completely inactive in the default profile.
- Page-state snapshots are no longer created when storage and runtime capture are disabled.
- The compact profile no longer exports raw HTML, full page snapshots, network records or duplicate NDJSON records.
- ZIP entries use DEFLATE compression when supported by Chrome, with a standards-compliant stored-entry fallback.
- Links, headings, lists, tables and code blocks are preserved through a DOM-to-Markdown conversion.
- Attachment references are reported separately and explicitly state whether the file body was captured.
- Exported evidence data is recursively sanitized for authentication identifiers, session/device identifiers and signed URL parameters unless sensitive capture was explicitly enabled.
- Optional HTML evidence is escaped before display instead of being injected as active markup.
- Fullness diagnostics now report top and bottom boundary verification, numeric turn range, missing turn indices, expansion failures and whether virtualization was observed.

## Installation

1. Extract the release ZIP into a permanent local directory.
2. Open `chrome://extensions`.
3. Enable **Developer mode**.
4. Remove version 1.0.0 or select **Reload** after replacing its source directory.
5. Select **Load unpacked** and choose the extracted directory containing `manifest.json`.
6. Pin **ChatGPT Session Capture** to the Chrome toolbar.

## Minimal capture procedure

1. Open the exact ChatGPT conversation.
2. Open the extension popup.
3. Leave only **Expand safe details during sweep** enabled and keep stabilization at 1000 ms.
4. Select **1. Start capture**.
5. Select **2. Run full session sweep**.
6. Keep the ChatGPT tab open until the sweep reports completion.
7. Select **Stop capture**.
8. Export the selected local capture as ZIP.

For AI review, upload the complete compact ZIP. The root instruction file directs the reviewing AI to the canonical transcript and diagnostics.

## Transcript structure

Each assistant turn is represented as:

```markdown
## N. Assistant

### Browser-visible reasoning summary

#### Arbetade i ...
- visible step ...

### Final answer

...assistant response...
```

The structured equivalent is stored in `conversation/session.json` under:

- `browserVisibleReasoning`
- `finalAnswer`
- `attachments`
- `links`

The term **browser-visible reasoning summary** is intentional. It refers only to UI text exposed in the page. It is not a claim that hidden model chain-of-thought was captured.

## Completeness verdict

`diagnostics/completeness.json` uses explicit statuses:

- `VERIFIED_COMPLETE_BROWSER_TRANSCRIPT` — the sweep stabilized at the top, reached the bottom, found a contiguous numeric `conversation-turn-N` sequence beginning at 1, recorded no expansion failure and recorded no capture error.
- `CAPTURED_WITH_UNVERIFIED_BOUNDARIES_OR_GAPS` — text was captured, but one or more completeness conditions were not proved.
- `NO_COMPLETED_SWEEP_RECORDED` — no completed full sweep was found.

The verdict applies only to browser-observable conversation text and browser-visible reasoning summaries. It does not cover hidden server state, hidden model reasoning or attachment bodies that were never rendered.

## Optional evidence modes

Enabling any of these switches changes the profile from `ai-transcript` to `browser-evidence`:

- deep network capture;
- page fetch/XHR/WebSocket capture;
- storage capture;
- runtime capture;
- aggressive runtime capture.

Evidence mode can produce much larger archives and should be used only for browser forensics. It adds a consolidated evidence NDJSON file, escaped HTML evidence and selected debugger artifacts without the version 1.0 duplication of every record into several parallel formats.

## Privacy boundary

All collection and ZIP generation occur locally in Chrome. The extension contains no analytics, telemetry, advertising code or external JavaScript dependencies. Conversation exports remain sensitive documents even in compact mode.
