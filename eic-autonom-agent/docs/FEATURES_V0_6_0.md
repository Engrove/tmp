# Egenskapsbeskrivning — EIC Autonom Agent v0.6.0

## Egenskapsmatris

| Område | Egenskap | v0.6.0-beteende |
|---|---|---|
| Start | Waiting mode | Läser baseline och väntar utan prompt eller Stop |
| Start | Ny session | Nano-analyserad raw operatorprompt med durable continuity seed |
| Start | Protokoll | Befintligt EIC-AA-kontrakt detekteras; inget nested envelope |
| Start | Identitet | Exact prompt SHA/längd + separat DOM-ack digest |
| Target | Låst | Fokusbyte ändrar inte target |
| Target | Följ | Endast redan kopplad tab i samma fönster |
| Response | Stabilitet | Minst två identiska hash-läsningar och `settleMs` |
| Response | Supersede | Hash/epoch verifieras före claim, decision/repair och submit |
| Nano | Base/task | Immutable base + isolerad clone per task när möjligt |
| Nano | Rotation | Task-session förstörs; context pressure ger inte normal operatörspaus |
| Nano | Claim | `PENDING → RUNNING → terminal` med lease och heartbeat |
| Nano | Grounding | Tom/meta-only/ogrundad output kan inte skapa targetprompt |
| Nano | Diagnostik | Exakt stale reason och context usage/window exporteras |
| Background | TTL-free | Verifierat background wait saknar applikationsdeadline |
| Idempotency | Continuation | Turn-ID-set |
| Idempotency | Raw start | Promptdigest-set |
| Parser | Trailer | Exakta sista 4 eller 3 rader; motsägelser avvisas |
| Progress | Deterministic | Ändrad targetresponse + giltigt contract |
| Completion | Dual evidence | Nano-DONE + target-DONE med evidence |
| Mjölnar | Proveniens | Nano=`NANO_PROPOSED`; D1 kräver trusted external channel |
| State | Persistens | Config/runtime/export v7, run v7, window v5, continuity v2 |
| Storage | Quota failure | Circuit breaker + fail-closed promptblock |

## Trust boundary

### Trusted local/deterministic

- extensionconfig och persistensresultat;
- exact tab/window/conversation locator;
- lokal state transition;
- parserresultat från det bundna targetkontraktet;
- observationens hash/epoch efter owner-read;
- effect journal/readback;
- statisk action registry.

### Untrusted candidate/data

- ChatGPT-text;
- Nano-fält;
- target Hjalmar-text;
- modellens progress-/completion-självrapport;
- startpromptens historiska live-state claims.

## Startpromptkontrakt

`canonicalStartPrompt()` bevarar JavaScript-strängen exakt och gör ingen trimning, whitespace-normalisering eller wrapping. `inspectStartPromptContract()` väljer `TURN_BOUND_4`, `TURNLESS_3` eller `UNBOUND`. `validateStartAnalysis()` kräver intent, en atomär icke-meta arbetsenhet, constraints, required evidence, korrekt digest och korrekt chunkantal.

## Observation freshness

En observation kan endast styra en effekt om samma responsehash och document epoch fortfarande ägs av target DOM. Mismatch ger `OBSERVATION_SUPERSEDED`; gammal request, repair och förberedd prompt kasseras.

## Nano-host

UI skiljer host absence från decision invalidity. `NANO_HOST_REQUIRED` används för saknad körbar värd. `NANO_GROUNDING_REJECTED` används när modelloutput finns men failar grounding efter bounded repair.

## Response- och completionkontrakt

Targetresultat accepteras endast när markörerna ligger sist, är unika och inte citerade/kodblock. Statusfält måste vara semantiskt konsekventa. Stable-goal completion kräver target-DONE med konkret evidence.

## Claim boundary

Source, Node-tester, syntax, validator, packagebytes och ZIP-integritet kan verifieras lokalt. Verklig LanguageModel-inferens, aktuell ChatGPT-DOM, long-run background, freeze/discard, sleep/wake och promptreadback kräver desktop Chrome-owner-run.
