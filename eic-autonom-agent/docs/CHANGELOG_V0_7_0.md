# CHANGELOG — v0.7.0

Fokus: den terminala takeover-livelocken i v0.6.9 samt de Nano-värdfel som utlöste den.
Referensincident: 2026-08-02, Chrome-fönster `1974094030`.

## Fixat

- **Action-scopad grounding.** Prompt-obligationerna `TASK_INTENT_EMPTY`, `WORK_UNIT_EMPTY`,
  `TAKEOVER_CONTEXT_EMPTY`, `META_ONLY_ACTION` och `UNGROUNDED_CONTINUATION` gäller nu enbart
  `CONTINUE`. Tidigare tillämpades de även på `PAUSE` och `DONE`, vilket gjorde den
  deterministiska takeover-recoveryn självogiltig och körningen terminal.
- **Nya, korrekta obligationer.** `PAUSE` kräver `reason` och `pauseOrigin`
  (`PAUSE_REASON_EMPTY`, `PAUSE_ORIGIN_EMPTY`). `DONE` kräver `completionEvidence`
  (`COMPLETION_EVIDENCE_EMPTY`). Tom action ger `ACTION_EMPTY`.
- **Välformad takeover-PAUSE.** `buildDeterministicDecision()` avger inte längre tomma
  fält. `requestedAction` förblir tom, så ingen generisk målprompt kan författas.
- **Lokal observationsgrundning.** `deriveObservationAnchors()` och
  `groundDecisionFromObservation()` härleder `contextEvidence` deterministiskt ur den
  observation kontrollern redan läst. Ankarna är literala fragment av den otillförlitliga
  målytan och blir aldrig `verifiedFacts`.
- **Bunden response constraint.** `DECISION_SCHEMA` har `minItems: 1` på `contextEvidence`,
  `minLength: 1` på `intent`/`workUnit` och `maxLength` på varje fritextfält, inklusive det
  nästlade `operatorCandidate`. Strukturgrinden accepterar inte längre det semantikgrinden
  avvisar.
- **Hårt output-tak.** `NANO_MAX_OUTPUT_CHARS = 6000` och `NANO_MAX_OUTPUT_CHUNKS = 4000`
  bryter strömmen i panelen och kastar `NanoOutputOverrunError`. Fältincidenten nådde
  10 985 tecken över 6 647 chunks innan värden kollapsade.
- **Isolerad task-session utan `clone()`.** En färsk session skapas per analys från sparade
  create-options. v0.6.9 föll tyst tillbaka på den delade bassessionen, så varje analys
  ackumulerade input och output i samma kontext.
- **Bunden delad bassession.** `NANO_SHARED_SESSION_CHAR_BUDGET = 14000` gör
  80 %-vakten verksam även när värden inte exponerar `contextUsage`/`contextWindow` — vilket
  var fallet i fält.
- **`kErrorUnknown` är recoverable.** `UnknownError`, `NotReadableError` och
  `NanoOutputOverrunError` ger en ny session i stället för ett terminalt körningsfel.
- **Bounded takeover-requeue.** `TAKEOVER_MAX_RECOVERY_ATTEMPTS = 3`. Samma bevarade
  observation återköas mot en färsk Nano-session innan owner-reconciliation krävs.
  `TAKEOVER_NANO_HOST_RESET` skrivs till recovery-loggen.
- **Tyst sessionsomstart.** `ensureNanoSessionForRequest()` bygger om en stale session utan
  operatörsgest, så en obevakad körning kan återhämta sig själv.
- **Repairrundan regresserar inte.** `priorDecisionFields` bär giltig `intent`, `workUnit`
  och `requestedAction` in i den enda tillåtna repairrundan.

## Ändrat

- Språkdeklarationen är `["en", "sv"]` för både `expectedInputs` och `expectedOutputs`, med
  bounded fallback till `["en"]` vid `NotSupportedError`. Detta ersätter v0.6.6-invarianten
  om engelska endast; målmandat och målsession är svenska.
- `scripts/validate.mjs` kontrollerar fjorton nya strukturella invarianter för v0.7.0,
  inklusive att `DECISION_SCHEMA` inte innehåller några obundna strängfält.

## Oförändrat

Den hårda grinden `if (effectiveAction !== "CONTINUE")`, `nanoGroundingRequired`, förbudet mot
target-authored fallback, `EIC_DESTRUCTIVENESS/1`, Mjölnar D0–D2 och alla nivå-10-gränser.

## Test

256 tester passerar (236 bevarade från v0.6.9 plus 20 nya i
`tests/v070-takeover-deadlock.test.mjs`). Två v0.6.6-tester om engelska-endast är omskrivna
med motivering i koden, inte borttagna.
