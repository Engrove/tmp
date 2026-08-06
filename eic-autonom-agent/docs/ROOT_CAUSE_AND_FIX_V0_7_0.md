# ROOT CAUSE AND FIX — v0.7.0

Incident: 2026-08-02, Chrome-fönster `1974094030`, run `run-876655fe-8177-412d-885b-70e288bc1d0d`,
målflik `1974094088` (`chatgpt.com:c:6a6f5a5f-0368-83ed-9f78-b2d6aaadbf96`).

Evidenskällor: operatörens `eic-autonom-agent-v0_6_9-export-1785695504899.json` (20 auditposter,
fullständigt run-state) samt v0.6.9-källträdet. Varje påstående nedan är taggat.

---

## 1. Observerat sluttillstånd

`mode = WAITING_CONTINUE`, `state = WAITING_FOREGROUND`, `pendingNanoRequest = null`,
`pendingObservation` bevarad, `deterministicGroundingFailure.count = 1`,
`lastNanoTrace.resultSummary = "GROUNDING_REJECTED: TASK_INTENT_EMPTY, WORK_UNIT_EMPTY, TAKEOVER_CONTEXT_EMPTY"`.

Applikationen skickade inga fler prompter och begärde inget mänskligt beslut. Den var terminal
utan att deklarera det.

## 2. Grundorsak D1 — självogiltig deterministisk recovery (VERIFIED, exekverad repro)

Kedjan, verifierad genom att köra biblioteksvägen mot det exporterade run-statet:

1. `buildDeterministicDecision()` (`lib/fallback-planner.mjs`) returnerade för
   `requestMode = TAKEOVER_BOOTSTRAP` med ogrundad continuity ett `PAUSE`-beslut med
   `intent: ""`, `workUnit: ""`, `targetClaims: []`, `inferences: []`, `evidenceAnchors: []`.
   Detta var avsiktligt: ingen generisk målprompt fick författas.
2. `applyNanoDecisionCommand()` (`background.js`) validerade addonets **eget** beslut med
   `validateNanoDecisionGrounding(..., takeover: true)`.
3. `validateDecisionGrounding()` tillämpade `TASK_INTENT_EMPTY`, `WORK_UNIT_EMPTY` och
   `TAKEOVER_CONTEXT_EMPTY` oberoende av `decision.action` → tre fel, garanterat.
4. `repairDeterministicDecision()` avböjde med `NOT_REPAIRABLE_CONTINUE` eftersom
   `action !== "CONTINUE"`.
5. Grenen "Deterministic grounding-spin avbruten" satte `STATES.RECOVERING` med en
   `resumePlan` som krävde *"en ny målresponse eller owner-read med ändrad response identity"*.
6. `lastProcessedAssistantHash` var redan lika med `pendingObservation.responseHash`, och
   addonet skickar per konstruktion ingen prompt. Ingen ny observation kunde uppstå.

Modulen som producerade `PAUSE` avgav alltså ett beslut som den egna konsumentgrinden
garanterat avvisade, och avvisandet krävde en händelse som systemet själv aldrig kan orsaka.

Reproduktion före fix:

```
decision.action  = PAUSE
grounding.errors = TASK_INTENT_EMPTY, WORK_UNIT_EMPTY, TAKEOVER_CONTEXT_EMPTY
repair.repaired  = false   reason = NOT_REPAIRABLE_CONTINUE
```

Auditen visar två oberoende cykler (observation generation 1 kl. 18:01–18:03 och
generation 2 kl. 18:12–18:28) med identiskt utfall.

## 3. Grundorsak D2 — kontraktsglipa mellan struktur- och semantikgrind (VERIFIED)

`DECISION_SCHEMA` i `sidepanel.js` saknade `minItems` på `contextEvidence`, `targetClaims`
och `inferences`. Gemini Nano kunde därför uppfylla `responseConstraint` med tomma arrayer
och sedan falla på den semantiska grinden med `TAKEOVER_CONTEXT_EMPTY`. Strukturgrinden
accepterade exakt det semantikgrinden avvisade.

Audit: första Nano-passet i **båda** observationsgenerationerna avvisades på
`TAKEOVER_CONTEXT_EMPTY`. I cykel 1 producerade modellen giltig `intent` och `workUnit` —
den enda bristen var kontextarrayerna.

## 4. Grundorsak D3 — obunden constrained decoding (VERIFIED)

Inget `maxLength` fanns på någon sträng i schemat. Telemetri för det sista passet:
`lastOutputChars = 10985`, `lastChunkCount = 6647`, för ett beslutsobjekt som korrekt är
cirka 2 000 tecken. `firstTokenAt = 18:27:56`, fel kl. `18:28:28`, `durationMs = 42010`.
Detta är en repetitionsloop under constrained decoding, inte en långsam värd.

`outputReserveTokens = 1400` i `nano-input-budget.mjs` var enbart budgetaritmetik; ingenting
stoppade genereringen vid runtime.

## 5. Grundorsak D4/D5 — obegränsad sessionsackumulering (VERIFIED + SUPPORTED)

VERIFIED ur exporten: `nanoTelemetry.lastCloneUsed = false`,
`lastContextUsage = null`, `lastContextWindow = null`.

`createTaskSession()` föll därmed tillbaka på den **delade bassessionen** (`owned = false`),
så varje analys ackumulerade både input och output i samma kontext. Den enda skyddsmekanismen
— 80 %-vakten `ratio >= 0.8` — var död kod eftersom den kräver finita `contextUsage`/
`contextWindow`, som värden aldrig exponerade.

SUPPORTED (ej verifierbart utan Chrome): `kErrorUnknown` är konsistent med kontextöverskridning
på den delade sessionen. Aritmetik ur `lastInputBudget`: `availableTokens = 6247` ⇒
`contextWindow − contextUsage ≈ 8598`, förenligt med ett 9 216-tokensfönster och cirka 618
tokens systemprompt. Två analyser à cirka 2 120 in + flera tusen ut överskrider det. Stödjande
observation: första analysen i cykel 1 tog 74 s, första analysen i cykel 2 tog 902 s.

## 6. Grundorsak D6 — repairrundan regresserade (VERIFIED)

Audit cykel 1: första passet `TAKEOVER_CONTEXT_EMPTY`; repairpasset
`WORK_UNIT_EMPTY, TAKEOVER_CONTEXT_EMPTY`. Den enda tillåtna repairrundan byggde beslutet
från grunden och tappade ett fält som redan var giltigt.

## 7. Grundorsak D7 — språkdeklaration (SUPPORTED)

`expectedInputs`/`expectedOutputs` deklarerade `["en"]` medan målmandatet, målsessionen och
alla härledda `intent`/`reason`-strängar är svenska. En deklarerad språkmismatch degraderar
eller felar on-device-modellen.

## 8. Testtäckningsgap (VERIFIED)

v0.6.9 passerade 236/236 tester och `scripts/validate.mjs` på en runtime som låste sig.
Inget test körde ett deterministiskt recovery-beslut genom sin egen konsumentgrind.

---

## 9. Åtgärder i v0.7.0

| ID | Åtgärd | Fil |
|----|--------|-----|
| F1 | Action-scopad grounding. Prompt-obligationer gäller enbart `CONTINUE`. `PAUSE` kräver `reason` + `pauseOrigin`; `DONE` kräver `completionEvidence`. Nya koder: `PAUSE_REASON_EMPTY`, `PAUSE_ORIGIN_EMPTY`, `COMPLETION_EVIDENCE_EMPTY`, `ACTION_EMPTY`. | `lib/decision-grounding.mjs` |
| F2 | `TAKEOVER_OBSERVATION_EMPTY` scopad till prompt-författande actions. | `lib/nano-pipeline.mjs` |
| F3 | `deriveObservationAnchors()` och `groundDecisionFromObservation()`: deterministisk, lokal härledning av `contextEvidence` ur den observation kontrollern redan läst. | `lib/nano-pipeline.mjs` |
| F4 | Välformad takeover-`PAUSE` med bevarad tom `requestedAction`. | `lib/fallback-planner.mjs` |
| F5 | Lokal grundningsreparation före grindavslag; audit `Takeover-kontext grundad lokalt från observationen`. | `background.js` |
| F6 | `TAKEOVER_MAX_RECOVERY_ATTEMPTS = 3`. Bevarad observation återköas mot färsk Nano-session i stället för terminal `RECOVERING`. | `background.js` |
| F7 | `priorDecisionFields` bär giltiga fält in i repairrundan. | `background.js`, `sidepanel.js` |
| F8 | `minItems`/`minLength`/`maxLength` genom hela `DECISION_SCHEMA`, inklusive `operatorCandidate`. | `sidepanel.js` |
| F9 | `NANO_MAX_OUTPUT_CHARS`, `NANO_MAX_OUTPUT_CHUNKS`, `NanoOutputOverrunError`. | `sidepanel.js` |
| F10 | Isolerad task-session (`FRESH_SESSION`) utan `clone()`; `NANO_SHARED_SESSION_CHAR_BUDGET` för den delade vägen. | `sidepanel.js` |
| F11 | `UnknownError`, `NotReadableError`, `NanoOutputOverrunError` klassade som recoverable. | `sidepanel.js` |
| F12 | `ensureNanoSessionForRequest()`: tyst sessionsomstart utan operatörsgest. | `sidepanel.js` |
| F13 | Symmetrisk språkdeklaration `["en", "sv"]` med `NotSupportedError`-fallback till `["en"]`. | `sidepanel.js` |

## 10. Bevarade invarianter

Följande är kontrollerade i `tests/v070-takeover-deadlock.test.mjs` och `scripts/validate.mjs`:

- Endast `CONTINUE` kan nå promptkompilering. Den hårda grinden
  `if (effectiveAction !== "CONTINUE") throw` i `background.js` är oförändrad.
- `nanoGroundingRequired` blockerar fortfarande att en ogrundad takeover-`PAUSE` replaneras
  till `CONTINUE`.
- Grundingkraven gäller fortfarande i sin helhet för varje prompt-författande action.
- En meta-only `CONTINUE` avvisas även efter lokal kontextgrundning.
- Lokal grundning uppfinner aldrig kontext för en tom observation, skriver aldrig över kontext
  modellen själv producerat och befordrar aldrig måltext till `verifiedFacts`.
- Direkt operatörsstopp, autentisering, CAPTCHA, credentials och deterministisk nivå 10 är
  oförändrade.

## 11. Kvarstående osäkerhet

- SUPPORTED, ej VERIFIED: att `kErrorUnknown` orsakades av kontextöverskridning respektive
  constrained-decoding-överskridning. Slutsatsen vilar på telemetri och aritmetik, inte på en
  körning i Chrome. Åtgärderna F9–F12 adresserar båda hypoteserna oberoende av varandra.
- ASSUMPTION: att Chromes constrained-decoding-motor respekterar `minItems`, `minLength` och
  `maxLength`. Om den ignorerar dem bär F3 och F9 korrektheten ensamma; om den avvisar dem med
  `TypeError` fångas det av den befintliga fallbacken till obunden prompt.
- BLOCKER för fullständig acceptans: stegen i `DESKTOP_CHROME_ACCEPTANCE_V0_7_0.md` kräver en
  riktig Chrome-värd med Gemini Nano och kan inte köras i byggmiljön.
