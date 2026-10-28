# ChatGPT Session Capture 1.1.2

A local Chrome Manifest V3 extension for collecting the text and UI data that a ChatGPT conversation exposes in the browser. The extension does not call a ChatGPT conversation reconstruction endpoint and does not attempt to obtain server-only data.

The default **AI transcript** profile uses only the controlled conversation sweep and safe expansion of browser-visible reasoning panels. The resulting ZIP is small enough to upload directly to a reviewing AI.

## Default AI transcript profile

The default controls are:

- Deep network capture through Chrome Debugger: **off**
- Page fetch/XHR/WebSocket capture: **off**
- Reload tab after start: **off**
- IndexedDB and Cache Storage: **off**
- Page state and React/runtime objects: **off**
- Expand safe details during sweep: **on**
- Aggressive runtime snapshot: **off**
- Cookies and sensitive headers: **off**
- Stabilization per step: **1000 ms**

The popup remembers the last options used. While a capture is active it shows, and locks, the options that capture was started with.

With these settings the archive contains only:

```text
AI_TO_AI_INSTRUCTIONS.md
conversation/session.md
conversation/session.json
diagnostics/completeness.json
attachments/manifest.json
manifest/session.json
manifest/sha256sums.txt
```

`AI_TO_AI_INSTRUCTIONS.md` is placed in the ZIP root and tells a reviewing AI how to interpret the archive, which file to read first, what the completeness verdict means, and why browser-visible reasoning summaries must not be treated as hidden chain-of-thought. `manifest/sha256sums.txt` lists the SHA-256 of every other file; after extraction, `sha256sum -c manifest/sha256sums.txt` verifies them.

## What is fixed in 1.1.2

The full list, with the reproduction for each item, is in `CHANGELOG.md` and `BUILD_REPORT.md`. The most important changes:

- **False verified verdict.** 1.1.1 could report `VERIFIED_COMPLETE_BROWSER_TRANSCRIPT` for a transcript that was missing turns (for example after **Stop capture** during a sweep). The verdict now cross-checks every turn the sweep observed against storage and lists each condition in `checks`.
- **Sweep failed after an idle pause.** When Chrome stopped the idle service worker (after 30 s), **Run full session sweep** failed with `Capture is not active for this tab`. The capture state now survives service-worker restarts.
- **Code and indentation.** Indentation and blank lines in code blocks and user messages were stripped, and code blocks contained the `python`/`Copy code` header text. Both are now verbatim.
- **Wrong final answer.** An expanded reasoning block rendered with the answer's `.markdown` class replaced the final answer. Turns with several message parts kept only the first part.
- **Access token in exports.** With page or deep network capture and sensitive capture **off**, the ChatGPT bearer token from `/api/auth/session` was exported. It is now redacted.
- **Popup.** Status polling re-enabled the sweep and stop buttons during a running sweep. **Stop capture** now aborts a running sweep, and the popup shows live sweep progress.

## Installation

1. Extract the release ZIP into a permanent local directory.
2. Open `chrome://extensions`.
3. Enable **Developer mode**.
4. When upgrading, replace the previous source directory and select **Reload** on the extension, or remove the old version first.
5. Select **Load unpacked** and choose the extracted directory containing `manifest.json` (not needed after **Reload**).
6. Pin **ChatGPT Session Capture** to the Chrome toolbar.
7. After an upgrade, reload ChatGPT tabs that were open before it once. The extension injects its scripts into such tabs automatically, but injection into a tab that still runs scripts from the previous version has not been tested.

## Minimal capture procedure

1. Open the exact ChatGPT conversation (`https://chatgpt.com/c/…`).
2. Open the extension popup.
3. Leave only **Expand safe details during sweep** enabled and keep stabilization at 1000 ms.
4. Select **1. Start capture**.
5. Select **2. Run full session sweep**. The popup shows the stage, step and number of turns. The popup may be closed; reopening it shows the progress.
6. Keep the ChatGPT tab on the same conversation until the sweep reports completion. A sweep is refused, or aborted, if the tab navigates to another conversation.
7. Select **Stop capture**. Stopping during a sweep aborts the sweep.
8. Export the selected local capture as ZIP. The popup shows the completeness verdict.

For AI review, upload the complete compact ZIP. The root instruction file directs the reviewing AI to the canonical transcript and diagnostics.

## Transcript structure

Each assistant turn is represented as:

```markdown
<!-- cgsc:turn sequence=N index=N role=assistant -->
## N. Assistant

### Browser-visible reasoning summary

#### Arbetade i ...
- Expanded during capture: yes
- Content found: yes

...reasoning summary text...

### Final answer

...assistant response...

<!-- cgsc:end-turn sequence=N -->
```

The HTML comments mark turn boundaries; headings inside message text are message content. A turn with several message parts (for example a tool step and the final reply) lists them as `#### Part 1`, `#### Part 2`, …

Message text and code blocks are verbatim: indentation, tabs and blank-line runs are preserved, and only line endings are normalized. URLs in message text are never rewritten.

The structured equivalent is stored in `conversation/session.json` (schema `cgsc.browser-transcript/1.2`) under:

- `browserVisibleReasoning`
- `finalAnswer`
- `messageParts`
- `attachments`
- `links`

The term **browser-visible reasoning summary** is intentional. It refers only to UI text exposed in the page. It is not a claim that hidden model chain-of-thought was captured.

## Completeness verdict

`diagnostics/completeness.json` (schema `cgsc.completeness/1.2`) uses explicit statuses:

- `VERIFIED_COMPLETE_BROWSER_TRANSCRIPT` — every entry of `checks` is `true`:
  - `completedSweepRecorded`, `sweepCompletionRecordStored` — a sweep finished and its completion record reached storage;
  - `topVerified`, `firstTurnAtVerifiedTop` — the top of the conversation was stable for four rounds, and the first turn rendered there is the lowest stored turn index;
  - `bottomVerified` — the bottom was reached and stable;
  - `everyTurnHasNumericIndex`, `contiguousTurnIndices` — every turn has a `conversation-turn-N` index and the indices have no gaps;
  - `sweepObservationsAvailable`, `everyObservedTurnStored`, `lastTurnMatchesSweep` — every turn the content script saw during the sweep is in storage;
  - `noTurnFromAnotherConversation` — every turn was captured on the capture's conversation URL;
  - `noTransportFailure`, `noPipelineErrorRecord` — no record was lost between page and storage;
  - `noExpansionFailure`, `everyReasoningPanelHasContent` — every reasoning panel was opened and its content captured.
- `CAPTURED_WITH_UNVERIFIED_BOUNDARIES_OR_GAPS` — text was captured, but `failedChecks` lists at least one unproven condition.
- `NO_COMPLETED_SWEEP_RECORDED` — no completed full sweep was found.

The verdict applies only to browser-observable conversation text and browser-visible reasoning summaries. It does not cover hidden server state, hidden model reasoning or attachment bodies that were never rendered. Failed page requests and other evidence-mode errors are listed in `evidenceErrorRecords` and do not affect the transcript verdict. `unclassifiedToggleLabels` lists expandable controls in assistant turns that were not recognised as reasoning panels; they do not affect the verdict.

Captures made with 1.1.1 or earlier lack the sweep observations the cross-check needs and are never reported as verified by the 1.1.2 exporter.

## Optional evidence modes

Enabling any of these switches changes the profile from `ai-transcript` to `browser-evidence`:

- deep network capture;
- page fetch/XHR/WebSocket capture;
- storage capture;
- runtime capture;
- aggressive runtime capture.

Evidence mode can produce much larger archives and should be used only for browser forensics. It adds `evidence/records.ndjson` (all stored records), `evidence/turns.safe.html` (escaped HTML evidence), `evidence/record-kinds.json` and, when sensitive capture is enabled, MHTML snapshots in `evidence/mhtml/` that are referenced from the NDJSON instead of being duplicated.

## Privacy boundary

All collection and ZIP generation occur locally in Chrome. The extension contains no analytics, telemetry, advertising code or external JavaScript dependencies. Conversation exports remain sensitive documents even in compact mode. See `PRIVACY.md` for what is redacted.

## Development and verification

The source repository contains a regression suite that is not part of the release ZIP:

- `tests/run-all.sh` — syntax check, ESLint, Node unit tests, DOM extraction tests in Chromium and end-to-end scenarios that load the unpacked extension into Chromium against a deterministic mock conversation (`tests/fixtures/mock-chatgpt.cjs`) and validate the downloaded ZIP with Python's `zipfile`.
- `tools/build-release.sh` — builds the release ZIP from the extension files only.

The mock reproduces the structural properties the extension depends on; it is not ChatGPT's markup. Results against the live site depend on ChatGPT's current DOM.
