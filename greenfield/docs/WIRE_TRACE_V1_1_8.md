# v1.1.8 two-ended runtime wire trace

Release rule: every decision-critical field/function below must have a producer, transport
or persistence path, consumer, invariant and regression. Presence in source alone is not a
functional guarantee.

## Causal response path

| Field / function | Producer | Transport / persistence | Consumer | Invariant | Regression |
|---|---|---|---|---|---|
| `bridgeVersion` | `content.js` `CONTENT_VERSION` / `EIC_GF_PING` | PING + page state | `ensureContentBridgeVersion()` | stale content code is refreshed and read back before observations are trusted | `observation-wire`, `static-contract` |
| `documentId` | content `DOCUMENT_ID` | page state + send result + `lastPrompt.baselineDocumentId` | send fence + response stability | send replay and response reads cannot cross content documents | `send-fence`, `response-stability`, `observation-wire` |
| materialized autonomous user id | content send-result `after.lastUserId` | dispatch result -> `lastPrompt.dispatchedUserTurnId` | `expectedAutonomousUserTurn()` -> content state request | WAIT has one explicit causal user-turn anchor | `turn-causality`, `v117-live-regression`, static wire tests |
| autonomous user ordinal | send baseline user count | dispatch result -> `lastPrompt.dispatchedUserTurnIndex` | content `resolveAutonomousTurn()` fallback | missing id may be reconciled only to the exact persisted ordinal | `turn-causality`, static wire tests |
| expected user id/index | `lastPrompt` | background `EIC_GF_GET_PAGE_STATE` request | content `pageState()` | content resolves the requested autonomous turn, not merely latest turn | `observation-wire` |
| `resolvedUserTurnId` | content `resolveAutonomousTurn()` | `page.autonomousTurn` | `autonomousResponseObservation()` + stability | resolved turn must equal expected persisted id when known | `turn-causality`, `response-stability` |
| paired assistant id | content entries after resolved user until next user | `page.autonomousTurn.assistantId` | causal observation + candidate identity | only assistant paired to current autonomous user is admissible | `turn-causality`, `v117-live-regression` |
| latest manual assistant id | normal content latest-turn extraction | page state | `isExternalAssistantInterleaved()` | later external turn may be audited but cannot replace paired autonomous response | `turn-causality`, `v117-live-regression` |
| structural owner trust | `resolveMessageOwner()` | autonomous turn state | response stability | causal pairing does not waive structural trust | `response-stability`, `observation-wire` |
| response hash/text/length | content paired assistant owner | autonomous turn -> response candidate | stability -> captured `lastResponse` | stable identity includes exact transported bytes; length must agree | `response-stability` |
| response candidate identity | stability module | canonical process `responseCandidate` | next WAIT tick | identity binds document + paired user + assistant + owner + hash + count | `response-stability` |
| terminality | stability module | WAIT tick | response capture | incomplete/untrusted/unpaired observations stay WAITING | `v116-live-regression`, `v117-live-regression` |
| protocol parse | `parseTargetResponse()` after terminal causal capture | `lastResponse.contract` + `analysisEvidence.protocol` | Nano/Hjalmar as advisory evidence | VALID/INVALID/ABSENT protocol cannot itself block or complete process | `continuation-guard`, `hjalmar-d2`, `v117-live-regression`, static |
| controller disposition | Hjalmar/runtime reconciliation | `lastDecision` -> outbound `continuity.previousDisposition` | next autonomous turn | controller disposition, not protocol status, owns continuity transition | `a2a`, `hjalmar-d2`, static |
| `responseObservation` | captured causal response | `lastResponse.observation` -> A2A builder/sanitizer | next target + operator Audit | provenance is runtime-produced bounded evidence | `a2a`, `observation-wire` |

## Manual interleaving invariant

Manual chat is part of the supported state space. The controller never requires manual
messages to contain A2A. A manual assistant turn may be the latest visible turn while an
autonomous causal response remains separately addressable. Runtime emits
`EXTERNAL_TURN_INTERLEAVED` and does not mutate the autonomous response candidate from the
external message.

## Protocol-independent transition invariant

The WAIT path has no direct protocol-driven `WAITING -> DONE` or `WAITING -> BLOCKED`
transition. Every terminalized causal response enters `ANALYZING`.

`DONE` may be reached only from the controller decision after analysis. Genuine runtime
boundaries such as explicit operator stop, Audit failure or irrecoverable exact-once
ambiguity keep their existing owner semantics.

## Chrome Nano small-context path

Local-model prompts remain bounded:
- direct Nano Task: 2600 chars;
- Nano Observer: 3400 chars;
- Hjalmar D2: 6200 chars.

When A2A metadata is absent/invalid, Nano sees only a bounded current-response excerpt,
never the full raw conversation. Protocol absence therefore does not trade liveness for an
unbounded local-model context.

## Frozen live regressions

`tests/fixtures/v1.1.7-live-protocol-manual-interleave.json` freezes both v1.1.7 failures:
- protocol `DONE` caused legacy `ILLEGAL_TRANSITION:WAITING->DONE`;
- a later manual `Avvaktar...` assistant response lacked A2A and was incorrectly promoted
  to autonomous `lastResponse`.

Current regressions prove protocol `DONE` is advisory and the manual assistant cannot
replace a causally paired autonomous assistant candidate.
