# Changelog

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
