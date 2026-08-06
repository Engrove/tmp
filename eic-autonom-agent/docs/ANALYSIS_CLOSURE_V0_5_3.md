# Analysclosure — EIC Autonom Agent v0.5.3

Detta dokument mappar den externa v0.5.2-granskningens findings till v0.5.3-ändringar och lokala verifieringspunkter.

## Critical

| Finding | Korrigering | Regression |
|---|---|---|
| Egen badge kan trigga background | `data-eic-own-ui`, explicit exclusion, ingen status/aria-live, separat BACKGROUND-label | `content-bridge-wiring.test.mjs`; validator |
| Dubblett efter senare user message | bounded `userTurnIds` från alla user messages, content-memory + persisted linked-tab set, set-baserad reconciliation | `effect-journal-regression.test.mjs`; `runtime-safety.test.mjs` |
| Hjalmar verdict från Nano | Nano-Hjalmar märks untrusted; D1 kräver `TRUSTED_EXTERNAL_CHANNEL` | `mjolnar.test.mjs`; validator |
| LOCAL_STATE_MACHINE stämplas på modelloutput | Nano-producent ger `NANO_PROPOSED`; trusted predicate kräver genuine local producer | `mjolnar.test.mjs`; wiring test |
| transitionRun kastar i pausvägar | safety escape för alla aktiva states, terminal-event no-op, per-window tick isolation | state property test; wiring test |

## Major

| Finding | Korrigering | Regression |
|---|---|---|
| Stale run conversationKey | explicit BIND/PROMOTION, MISMATCH fail-closed, run uppdateras | `runtime-safety.test.mjs`; wiring test |
| Modellstyrd progress/completion | local progress kräver ändrad response + giltigt target contract; target-DONE krävs för completion; loop blir hard pause | 20-turn soak; completion tests |
| Panel stängd ger target-authored fallback | fallback default av; continuation och takeover pausar `NANO_HOST_REQUIRED` | fallback tests; wiring test |
| Mjölnar bypassar grounding | omgrundning efter verified effect före CONTINUE | grounding regression + wiring test |
| Obegränsad storage | recovery 40, journal 12, turn-ID 128, prompt bara aktiv turn, storage circuit | runtime safety tests; validator |
| Språkkontrakt | system/decision instructions på engelska; API options `en`; Swedish target data quoted/untrusted | Nano runtime regression; validator |

## Minor

| Finding | Korrigering |
|---|---|
| BACKGROUND visas FRÅNKOPPLAD | egen `BACKGROUND`-label |
| D2 substring false matches | token-boundary regex och fler fält |
| Locator fallback divergerar | samma hostname/path fallback |
| Trailer endast 8 rader | 24-raders bakåtsökning |
| Heartbeat bundet till chunks | separat 10-sekunders inference timer |
| Background normaliserar inte action | `normalizeBackgroundAction` vid trust boundary |
| Repetition felklassad som Nano-host | `PROMPT_REPETITION_GUARD` |
| Authredirect ger navigated-away loop | explicit auth boundary utan content injection |

## Claim boundary

Closuren är verifierad mot source och lokala tester. Desktop Chrome-runtime kräver separat operator-runbook.
