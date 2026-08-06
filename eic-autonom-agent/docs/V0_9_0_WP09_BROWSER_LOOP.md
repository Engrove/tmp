# v0.9.0 WP09 — ChatGPT controller loop and verified attachment path

## Status

Source gate implemented in the isolated working copy. Live Desktop Chrome execution is not claimed.

## Goal

Connect the WP08 structured action executor to the bound `CHATGPT_CONTROLLER` while preserving
exactly-once behavior across service-worker restarts. A captured screenshot may be included only
after exact body reconstruction and ChatGPT composer attachment readback.

## Loop sequence

1. Read the bound controller tab through the existing content bridge.
2. Require one complete, previously unprocessed assistant response with matching controller epoch.
3. Parse exactly one standalone `EIC_BROWSER_ACTION/1`.
4. Persist the controller response hash and loop step before calling WP08.
5. Execute the action through the WP08 durable `PENDING_DISPATCH` barrier.
6. Read the persisted browser action receipt.
7. Add a bounded post-action `EIC_BROWSER_OBSERVATION/1` for non-navigation actions.
8. For `capture`, reconstruct the WP07 screenshot from `chrome.storage.session` and verify decoded
   bytes and SHA-256.
9. Send `EIC_ATTACH_IMAGE` to the controller content bridge and require file-input or attachment-DOM
   readback.
10. Build an observation prompt that labels target content as untrusted.
11. Persist prompt digest and pending-delivery state before `EIC_SUBMIT_PROMPT`.
12. Record acknowledged or unconfirmed submission without blind retry.

## Attachment boundary

The content bridge accepts only:

- supported ChatGPT origins;
- the current controller document epoch;
- a sanitized `.png` file name;
- MIME `image/png`;
- at most 4,000,000 decoded bytes;
- valid PNG signature;
- exact decoded-byte SHA-256.

The bridge uses a browser `File` and `DataTransfer` only after validation. It reports success only
after matching file-input or attachment-DOM readback.

## Failure behavior

- Reused controller response hash: reject.
- Multiple or missing action marker: reject.
- Controller or target identity change: reject.
- Missing WP08 action receipt: reject.
- Screenshot body mismatch: reject.
- Attachment readback failure: reject before prompt submission.
- Unknown prompt effect: leave the step unconfirmed; do not retry blindly.
- Navigation: do not create a post-action observation from the stale document epoch.

## Deferred to WP10 and later

- WP10: risk policy, prompt-injection defense, redaction and approvals; activation of
  `AI_WEB_RESEARCH`.
- WP11: recovery and migration across navigation/reload/service-worker/CDP detach.
- WP13: real Desktop Chrome scenarios and attachment verification.
- WP14: versioning and release package.

## Source verification

- Focused WP09 contract: 15/15 PASS.
- Full regression: 521/521 PASS.
- Validator: PASS.
- Background boot smoke: PASS.
- JavaScript/MJS syntax: 115/115 PASS before package evidence freeze.

These results verify source behavior and fixtures only.
