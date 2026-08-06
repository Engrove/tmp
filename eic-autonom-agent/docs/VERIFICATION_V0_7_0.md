# VERIFICATION — v0.7.0

## Verifieringsgränser

Allt nedan är kört i Node 22 mot källträdet. Ingenting nedan har körts i Chrome mot en
riktig Gemini Nano-värd; sådana steg ligger i `DESKTOP_CHROME_ACCEPTANCE_V0_7_0.md` och är en
uttalad BLOCKER för fullständig acceptans.

## V1 — Incident acceptance: livelocken är bruten (VERIFIED)

Reproduktionen byggs från operatörens export
`eic-autonom-agent-v0_6_9-export-1785695504899.json` (run
`run-876655fe-8177-412d-885b-70e288bc1d0d`, observation
`observation-03a89ad9-5699-4cd1-9628-09481fe4d16b`).

Före fix:

```
decision.action  = PAUSE
grounding.errors = TASK_INTENT_EMPTY, WORK_UNIT_EMPTY, TAKEOVER_CONTEXT_EMPTY
repair.repaired  = false   reason = NOT_REPAIRABLE_CONTINUE
```

Efter fix:

```
decision.action        = PAUSE
decision.requestedAction = ""
grounding.valid        = true    errors = NONE
```

Låst av `v0.7.0 deterministic takeover recovery passes the gate that consumes it`.

## V2 — Säkerhetsinvarianten överlever (VERIFIED)

- `v0.7.0 takeover recovery still authors no target prompt`: `requestedAction === ""` och
  `authorsTargetPrompt("PAUSE") === false`.
- `v0.7.0 grounding requirements still apply in full to every prompt-authoring action`: en tom
  `CONTINUE` ger fortfarande `TASK_INTENT_EMPTY`, `WORK_UNIT_EMPTY`, `REQUESTED_ACTION_EMPTY`
  och `TAKEOVER_CONTEXT_EMPTY`.
- `v0.7.0 a meta-only CONTINUE is still rejected after local context grounding`.
- `v0.7.0 keeps the hard prompt-authoring guard`: `if (effectiveAction !== "CONTINUE")` och
  `nanoGroundingRequired` finns kvar i `background.js`.

## V3 — Lokal grundning är avgränsad (VERIFIED)

- Uppfinner aldrig kontext: tom observation ger `OBSERVATION_HAS_NO_ANCHORS`.
- Skriver aldrig över modellens egen kontext: `CONTEXT_ALREADY_PRESENT`.
- Befordrar aldrig måltext till `verifiedFacts`; varje `targetClaim` prefixas
  `Målsessionen visade:`.

## V4 — Kontraktsglipan är stängd (VERIFIED)

`v0.7.0 the response constraint no longer accepts what the gate rejects` kräver
`minItems: 1` på `contextEvidence`, `minLength: 1` på `intent` och `workUnit`, samt räknar
antalet obundna strängfält i `DECISION_SCHEMA` och kräver noll.

## V5 — Nano-värden är bunden (VERIFIED som kodinvariant)

Låst av fyra tester: output-tak och `NanoOutputOverrunError`; `FRESH_SESSION`/`SHARED_BASE`;
`NANO_SHARED_SESSION_CHAR_BUDGET` med teckenackumulator; `UnknownError` som recoverable och
`ensureNanoSessionForRequest()`.

Detta verifierar att koden gör rätt sak. Att `kErrorUnknown` faktiskt upphör på fältvärden är
SUPPORTED, inte VERIFIED — se `ROOT_CAUSE_AND_FIX_V0_7_0.md` avsnitt 11.

## V6 — Terminal-escape (VERIFIED som kodinvariant)

`TAKEOVER_MAX_RECOVERY_ATTEMPTS`, `TAKEOVER_NANO_HOST_RESET`, `nanoHostResetRequired` och
återställning av `takeoverRecoveryAttempts` vid grundad takeover.

## V7 — Regressionsstatus

```
node --test tests/*.test.mjs   → 256 tests, 256 pass, 0 fail
node scripts/validate.mjs      → VALIDATE PASS
```

De två v0.6.6-testerna om engelska-endast språkdeklaration är omskrivna till den nya
symmetriinvarianten. Ingen annan äldre assertion är ändrad eller borttagen.
