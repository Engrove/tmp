# Changelog

## 1.1.2

Correctness and integrity release. Every item below was reproduced against 1.1.1 with the regression harness in `tests/` before it was fixed; `BUILD_REPORT.md` lists the before/after results.

### Verdict integrity

- Fixed a false `VERIFIED_COMPLETE_BROWSER_TRANSCRIPT`: stopping a capture during a sweep stored only the turns transmitted so far (32 of 40 in the harness) while the verdict still reported a verified complete transcript. The content script now aborts the sweep when the capture stops, and the export cross-checks every turn the sweep observed against the stored records (`checks.everyObservedTurnStored`).
- The verdict is now a conjunction of named checks (`checks`, `failedChecks` in `diagnostics/completeness.json`).
- The first turn is proven by the verified top of the scroll container (`firstTurnIndexAtVerifiedTop`) instead of assuming that ChatGPT numbers turns from 1.
- A sweep is only accepted if its completion record was stored; a session-level fallback no longer suffices.
- Turns from another conversation block verification; a sweep is refused when the tab has navigated to another conversation since the capture started.
- Failed page requests (`cdp-network-loading-failed`, page fetch errors) no longer block the transcript verdict; capture-pipeline errors (`bridge-*`, `background-*`, chunk/serialization/transport errors) still do. Both are reported separately.

### Service-worker lifecycle

- Fixed `Capture is not active for this tab` on **Run full session sweep** after Chrome stopped the idle service worker (30 s of inactivity is enough). The content script lost its state on every port disconnect and never reconnected. State now survives a disconnect, the port is reopened on demand, and the background sends the session ID and options with every sweep request (`SYNC_STATE`, `RUN_SWEEP`).
- A sweep interrupted by a service-worker restart completes, and a second sweep in the same capture works.
- Port messages are processed strictly in order; chunks arriving without their `record-begin` are recorded as `bridge-transport-error` instead of being dropped silently.
- Record writes per capture are serialized (the read-modify-write turn merge and record count were racy).
- The IndexedDB connection is reused instead of being opened and closed four times per record.
- Captures left `active` by an extension reload or browser restart are marked `interrupted`.

### Transcript fidelity

- Fixed loss of indentation in every code block and in user messages: line-leading whitespace was stripped, and runs of blank lines were collapsed. Python code in the transcript was not valid Python.
- Fixed code blocks containing the language label and the button text (`pythonCopy codedef g(...)`): the code is taken from the `<code>` element.
- Fixed the final answer being replaced by the expanded reasoning block when the reasoning content is rendered with the same `.markdown` class as the answer and precedes it.
- Fixed turns with several message roots keeping only the first one; each part is kept and listed in `messageParts`.
- Fixed URLs in message text being rewritten (`https://example.com.` became `https://example.com/.`). Message text is no longer passed through the URL sanitizer; only URL fields and evidence HTML are redacted, and an URL without sensitive parameters is never re-serialized.
- Reasoning panel bodies are always written to `session.md`; previously they were omitted whenever the panel contained a button.
- A collapsed reasoning panel can no longer capture the following answer block as its content (`contentFound` is false instead of a false positive).
- A later, poorer observation of a turn (content not rendered yet after a virtualized remount, a panel that collapsed again) no longer overwrites a complete earlier observation.
- Uploaded images without a file-name extension (and images whose signed URL failed to load) are listed as `image` attachment references.
- Multi-line table cells stay on one Markdown row (`<br>`); ordered lists keep their `start` number.
- Reasoning labels now include `Reasoned`, `Reasoning`, `Analyzed`, `Tänkte`, `Resonerade`, `Analyserade` and `Arbetar`; matching no longer relies on the ASCII-only `\b`.
- Expandable controls in assistant turns that are not recognised as reasoning panels are reported in `unclassifiedToggleLabels`.

### Privacy and security

- Fixed export of the ChatGPT bearer access token with sensitive capture **off**: the `accessToken` in `/api/auth/session` response bodies was stored verbatim by page-network and deep-network capture. JWTs, `Bearer` values and sensitive JSON string fields are now redacted in evidence strings, and header names ending in `-token` are redacted.
- MHTML snapshots are captured only with sensitive capture enabled: rewriting URLs inside MHTML corrupted its quoted-printable encoding, and an unredacted snapshot contains signed URLs.
- Records from the page's MAIN world are limited to page network/runtime kinds, so page scripts cannot inject `conversation-turn` records.
- Control messages are accepted only from the extension's own pages.

### Export

- `manifest/sha256sums.txt` lists the SHA-256 of every file (`sha256sum -c`).
- Turn boundaries in `session.md` are marked with `<!-- cgsc:turn ... -->` comments.
- Evidence NDJSON is assembled as binary parts (no single JavaScript string), MHTML is written once and referenced from the NDJSON, and the duplicate `evidence/turns.raw.json` was removed.
- The ZIP's object URL is released when the download ends.

### Popup

- Fixed the busy lock: status polling re-enabled **Run full session sweep** and **Stop** 1.5 s into a running sweep.
- **Stop capture** aborts a running sweep.
- Live sweep progress (stage, step, turns) and the sweep state are shown, also after the popup was closed and reopened.
- Options are remembered; during an active capture the popup shows the options that capture was started with and locks them.
- Capture buttons stay disabled on non-ChatGPT tabs.

### Runtime evidence

- Runtime snapshots no longer serialize `outerHTML` for every DOM node referenced by a React fiber (quadratic size) and keep a 300-character prefix of function sources.

### Removed

- `evidence/turns.raw.json` (the same records are in `evidence/records.ndjson`).
- Unused functions `fnv1a` (bridge.js) and `safeName` (export.js).

## 1.1.1

- Added automatic content-script readiness probing and programmatic reinjection.
- Fixed `Could not establish connection. Receiving end does not exist` when the ChatGPT tab predates extension installation or reload.
- Prevented capture activation before the receiver is verified.
- Routed optional page-state capture through the same self-healing background path.

## 1.1.0

- Added compact `ai-transcript` capture profile.
- Added root-level `AI_TO_AI_INSTRUCTIONS.md` to every generated ZIP.
- Separated browser-visible reasoning summaries from final assistant answers.
- Added extraction for ChatGPT `button[aria-expanded]` reasoning panels.
- Added DOM-to-Markdown conversion and structured session JSON.
- Added attachment-reference manifest.
- Added explicit top/bottom, sequence-gap and expansion diagnostics.
- Added independent page-network capture switch and disabled hidden network collection in transcript mode.
- Disabled page-state snapshots when storage/runtime capture is not selected.
- Added recursive evidence sanitization.
- Escaped optional HTML evidence.
- Removed default duplicate raw record exports.
- Added DEFLATE ZIP compression.
