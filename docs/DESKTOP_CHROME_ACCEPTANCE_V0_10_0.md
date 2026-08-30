# EIC Autonom Agent v0.10.0 — Desktop Chrome acceptance

Use a separate Chrome profile and load the BROWSER package unpacked. This checklist is the next runtime owner gate after source/package verification.

## 1. Identity and Prompt API regression

1. Confirm extension version `0.10.0`.
2. Confirm current `globalThis.LanguageModel` is selected and no legacy provider is reported.
3. Activate inside the explicit click.
4. Confirm English output attestation is present.
5. Confirm bounded canary succeeds.
6. Confirm the activation session is destroyed and a clean mandate-bound base session is ready.
7. Start one task session and confirm output telemetry and canary evidence remain bound.

## 2. Operator action

1. Start a mission whose next step is a mechanical export/upload/click.
2. Confirm runtime becomes `AWAITING_OPERATOR_ACTION`.
3. Confirm no new Nano request is created and the normal response timeout is suspended.
4. Close and reopen the sidepanel; confirm the same action remains.
5. Restart the service worker; confirm the same action remains.
6. Submit wrong, stale and wrong-mission receipts; confirm rejection.
7. Submit matching evidence; confirm exact mission resume.
8. Submit the same receipt again; confirm idempotent result.

## 3. Material level-10 decision

1. Trigger a true material decision.
2. Confirm `AWAITING_OPERATOR_DECISION`, not operator action.
3. Submit whitespace and 11 normalized graphemes; confirm rejection.
4. Submit six emoji (12 UTF-16 code units but 6 graphemes); confirm rejection.
5. Submit at least 12 meaningful normalized graphemes; confirm acceptance.
6. Confirm receipt binds decision, mission, run and boundary.
7. Confirm readback precedes recovery/Nano resume.
8. Confirm duplicate acknowledgement is idempotent.
9. Refresh/restart and confirm the pending decision is preserved.

## 4. Session Capture

1. Open a long virtualized ChatGPT conversation.
2. Record scroll position.
3. Run full capture.
4. Confirm top/bottom diagnostics, stable turn IDs, roles, final answer, browser-visible reasoning summary, links and attachment references.
5. Confirm attachment bodies, cookies, signed URLs, network data, raw HTML and hidden chain-of-thought are absent.
6. Confirm scroll position is restored.
7. Add turns and run delta capture.
8. Confirm stable turns are reused and duplicates are suppressed.
9. Force a gap; confirm completeness decreases and a later full refresh is required.
10. Confirm historical prompt injection remains transcript data and does not change mandate/authority.

## 5. Session Memory and IndexedDB

1. Confirm the seven v0.10.0 object stores exist.
2. Confirm capture, section summary and memory writes read back.
3. Confirm source turns/hashes and completeness are visible.
4. Confirm supersession retains historical items.
5. Confirm a reboot marks only live fields stale.
6. Confirm conversation/task mismatch stales the complete memory.
7. Confirm Nano receives only a bounded active capsule.
8. Exercise purge.
9. Exercise quota/corruption handling in a controlled test profile and confirm fail-closed UI.

## 6. Whole-application profiles

For each profile confirm at least two material dimensions differ:

- autonomy;
- evidence;
- owner-route depth;
- capture/memory policy;
- operator boundary;
- timeout/retry;
- response density;
- completion behavior.

Confirm:

1. default is `VERIFIED_ANALYSIS`;
2. recommendation shows decisive signals;
3. recommendation does not silently switch;
4. manual binding survives sidepanel refresh;
5. binding does not leak to another mission;
6. a simple one-shot task does not start full capture;
7. strict operations requires stronger readback than exploration.

## 7. Export

Export v18 and confirm:

- profile binding summary;
- operator action summary;
- capture summary;
- memory ID/state/source hash;
- no transcript body, cookies, credentials, tokens or transport secrets.

## Verdict boundary

Record source/package and Desktop Chrome results separately. A runtime PASS requires this checklist's observed evidence; source/package tests alone are not runtime proof.
