# v0.9.0 WP07 — bounded browser evidence

## Result

WP07 adds observation and evidence only. It does not add browser action parsing or execution.

## Evidence model

- Durable store: `eic.autonom.evidence-store.v1`.
- Item identity: window, tab, surface, document epoch and origin.
- Durable payloads: reduced/redacted AX, DOM layout summary, console, network metadata,
  navigation/load state and receipts.
- Ephemeral payload: raw PNG screenshot in `chrome.storage.session`.
- Every durable write and screenshot body requires readback before it is reported as stored.

## CDP surface

Enabled domains:

- `Runtime.enable`
- `Log.enable`
- `Network.enable`
- `Page.enable`

Explicit snapshot commands:

- `Accessibility.getFullAXTree`
- `DOMSnapshot.captureSnapshot`
- `Page.captureScreenshot`

Forbidden in WP07:

- `Runtime.evaluate`
- `Runtime.callFunctionOn`
- `Network.getResponseBody`
- `Network.getRequestPostData`
- cookie reads
- browser action execution

## Redaction and quotas

Queries, fragments, credentials and sensitive headers are removed. Password-like AX fields are
redacted and DOM strings/attributes are never persisted. Network request/response bodies are never
requested. Screenshots are bounded to 4 MB decoded bytes and are not durable or prompt-deliverable.

## Claim boundary

The source contracts and local fixtures can prove command selection, redaction, quotas and readback
logic. They do not prove a live target capture, screenshot pixels, installed Chrome runtime or
ChatGPT attachment. Those claims require later Desktop Chrome/readback gates.
