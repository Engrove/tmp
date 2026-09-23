# v1.1.7 two-ended runtime wire trace

> Historical: superseded by `WIRE_TRACE_V1_1_8.md`; retained to document the v1.1.7 model and its gaps.

This document is a release gate for the response-observation and local-model path.

Every decision-bearing field in this path is traced as:

`producer -> transport/persistence -> consumer -> invariant -> regression`

No field is considered functional merely because it exists in source.

## Response observation path

| Field | Producer | Transport / persistence | Consumer | Invariant | Regression |
|---|---|---|---|---|---|
| `bridgeVersion` | `content.js` `CONTENT_VERSION` and `EIC_GF_PING` | PING / page state -> `background.ensureContentBridgeVersion()` | start-run + every `tabState()` read | stale content-script code is refreshed and exact version is read back before page observations are trusted | `observation-wire.test.mjs`, `static-contract.test.mjs` |
| `documentId` | `content.js` `DOCUMENT_ID` | `pageState()` -> `EIC_GF_GET_PAGE_STATE` -> `background.tabState()` | `response-stability.mjs`; `send-fence.mjs` | response candidates cannot mix documents; unknown send effect can replay only in the same content document | `observation-wire.test.mjs`, `response-stability.test.mjs`, `send-fence.test.mjs` |
| `lastAssistantId` | `canonicalEntries()` | `pageState()` -> background | response candidate identity | stable response reads must belong to one assistant message | `response-stability.test.mjs`, `v116-live-regression.test.mjs` |
| `lastAssistantOwnerKind` | `resolveMessageOwner()` | page state -> background | response stability + Audit | owner provenance is explicit; role-node fallback is not terminalizable | `observation-wire.test.mjs`, `v116-live-regression.test.mjs` |
| `lastAssistantOwnerTrusted` | `resolveMessageOwner()` | page state -> background | `classifyResponseObservation()` | parser never receives an untrusted role-node fragment | `response-stability.test.mjs`, `v116-live-regression.test.mjs` |
| `assistantText` | `messageText(owner)` | page state -> candidate -> captured response | response parser | parser consumes only a trusted stable owner snapshot | `v116-live-regression.test.mjs` |
| `assistantHash` | SHA-256 of `assistantText` | page state -> candidate | response stability | repeated bytes alone are insufficient; hash is only one part of identity | `response-stability.test.mjs` |
| `assistantTextLength` | `assistantText.length` | page state -> background | observation classifier | reported text length must agree with transported text | `observation-wire.test.mjs` |
| `assistantCount` | `canonicalEntries()` | page state -> candidate | response identity | a candidate cannot mix DOM snapshots with different assistant cardinality | `response-stability.test.mjs` |
| `visibilityState` | `document.visibilityState` | page signals -> background -> candidate/Audit | diagnostics and candidate provenance | hidden state is not by itself a blocker or proof of completeness | `v116-live-regression.test.mjs` |
| `responseCandidate.identityKey` | response stability | canonical process state | next WAITING tick | identity = document + assistant message + owner kind + hash + assistant count | `response-stability.test.mjs` |

## Terminality split

`OBSERVATION_*` reasons are transient observation-quality states. They remain in WAITING and are audited as `RESPONSE_OBSERVATION_HELD`.

Only after a trusted response candidate reaches the short stability threshold may `parseTargetResponse()` run. A complete response that still lacks canonical control may reach `TARGET_RESPONSE_CONTRACT_INVALID`; an incomplete/untrusted observation may not.

## Chrome Nano small-context path

The local Chrome LanguageModel is treated as a small-context model.

### Nano Observer

Producer fields used by `buildNanoPrompt()`:
- bounded mission;
- turn;
- canonical target disposition;
- compact parsed target response;
- compact Nano Task terminal evidence;
- bounded operator one-shot instruction.

Raw `lastPrompt` and raw `assistantResponse` are not forwarded to Nano Observer.

### Hjalmar D2

Producer fields used by `buildHjalmarPrompt()`:
- bounded mission and current objective;
- canonical target disposition;
- compact parsed target response;
- compact Nano Task evidence;
- compact Nano Observer evidence;
- bounded operator instruction;
- compact previous decision.

Raw turn transcripts are not forwarded.

Regression limits:
- Nano Observer prompt < 3400 characters under deliberately oversized inputs.
- Hjalmar D2 prompt < 6200 characters under deliberately oversized inputs.

Direct Nano Task prompt > 2600 characters is rejected before any model prompt call and is recorded as a failed local task with zero prompt calls. Nano Observer/Hjalmar prompt-budget overflow is an advisory-model failure and uses the existing bounded runtime fallback rather than replaying side effects.

These are application-side conservative budgets, not claims about Chrome's absolute model context limit.


## Content bridge lifecycle

`content.js` may survive an extension reload in a tab. v1.1.7 therefore does not assume that a responding content script is the current build.

`CONTENT_VERSION` is produced by the content bridge in both `EIC_GF_PING` and `pageState()`. `background.ensureContentBridgeVersion()` consumes the PING value. A mismatch triggers one bounded reinjection of `content.js`, followed by a second PING readback. `tabState()` then verifies the page-state `bridgeVersion` before its observation is used. A failed readback is an explicit bridge error, not a response-parser error.

This closes the former dangling `EIC_GF_PING` producer and gives the version field both ends of the wire.

## Structural owner invariant

A response owner is trusted only when the selected structural boundary contains exactly one outer `data-message-author-role` node and that role matches the message being read. An explicit turn shell is preferred; a homogeneous ancestor is a bounded fallback. A bare role node remains `ROLE_NODE_FALLBACK` and is never eligible for response terminality.
