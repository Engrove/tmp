# Egenskapsbeskrivning — EIC Autonom Agent v0.5.3

## Produkt

EIC Autonom Agent är en lokal Manifest V3-sidepanel som övervakar en uttryckligen kopplad ChatGPT-session, låter Chrome Nano analysera stabila kompletta svar och levererar högst en journalförd continuation-prompt per tur.

## Egenskapsmatris

| Område | Egenskap | v0.5.3-beteende |
|---|---|---|
| Start | Waiting mode | Läser baseline och väntar utan att skicka prompt eller stoppa generation |
| Start | Ny session | Nano-analyserad engångsstartprompt med persistent sessionskvitto |
| Target | Låst | Fokusbyte ändrar inte target |
| Target | Följ | Endast redan kopplad tab i samma fönster |
| Locator | Exact conversation | `/c/<id>` prioriteras och run-locator promoveras |
| Nano | Claim lifecycle | `PENDING → RUNNING → terminal` med request/claim-ID |
| Nano | Lease | Förnybar 15-minuters claim lease; heartbeat är telemetri |
| Nano | Streaming | Streaming när API stöder det, annars prompt + timerheartbeat |
| Nano | Grounding | Tom/meta-only/ogrundad output kan inte skapa targetprompt |
| Nano | Host absence | Fail-closed `NANO_HOST_REQUIRED`, ingen target-authored fallback |
| Background | Self-exclusion | Extensionens egen UI-subtree filtreras bort |
| Background | TTL-free | Verifierat background wait har ingen applikationsdeadline |
| Background | Hard stops | Stop, cancel, error, auth, mismatch och korrupt state gäller |
| Idempotency | Turn-ID set | Alla observerade bounded turn-ID:n bevaras över DOM-virtualisering |
| Idempotency | Owner-read | Okänd submit-effekt läses före retry |
| Progress | Deterministic | Endast ändrad targetrespons + giltigt turn-kontrakt räknas |
| Anti-loop | Hard pause | Två meta-/audit-turer utan progress pausar |
| Completion | Dual evidence | Nano-DONE och target-DONE med evidens krävs |
| Mjölnar | Proveniens | Nano=`NANO_PROPOSED`; trusted trigger kan inte stämplas vid sink |
| Mjölnar | D1 | Kräver separat trusted Hjalmar-proveniens |
| Mjölnar | D2 | Auth/secrets/permissions/delete/merge/release/deploy kräver människa |
| State | Safety transition | Paus/block/error får inte kasta från aktivt state |
| State | Window isolation | Fel i ett window tick blockerar inte andra fönster |
| Storage | Bounded growth | Recovery 40, journal 12, prompt endast aktiv turn |
| Storage | Quota failure | Circuit breaker + `HARD_BLOCKED` |
| Parser | Trailer scan | Markörer hittas bakifrån inom 24 icke-tomma rader |
| Language | API options | Endast Chrome-stödda `en` deklareras |
| Privacy | Local-first | Ingen backend, credentials, cookies eller tokens |
| Packaging | MV3 | Install- och source-ZIP från samma source tree |

## Trust boundary

### Trusted local/deterministic

- extensionconfig;
- persisted runtime;
- exact tab/window locator;
- local state transition;
- parsed bounded turn-ID;
- action registry;
- storage write result;
- DOM structure read by content bridge.

### Untrusted candidate/data

- ChatGPT-text;
- Nano-fält;
- target Hjalmar-text;
- modellens `progressDelta`;
- modellens `completionConfirmed`;
- modellens Mjölnar source class, rollback eller authority class.

### Owner-read required

- prompt synlig i target DOM;
- tab/URL status;
- storage write;
- action effect/readback;
- desktop Chrome runtimeacceptans.

## Nano request contract

Obligatoriska runtimefält:

```text
requestId
observationId
mode
status
createdAt
deadlineAt
claimId
claimedAt
heartbeatAt
claimLeaseUntil
firstTokenAt
outputChars
chunkCount
transport
durationMs
decisionSource
validationErrors
```

En claim måste matcha exact request. Stale/expired claim får inte rapportera completion eller failure.

## Promptkontrakt

Continuation-prompten byggs från ett canonical object och innehåller:

- target mandate header;
- turn identity;
- task intent;
- work unit;
- verified state;
- target claims;
- inferences;
- anti-loop correction;
- requested action;
- required evidence;
- continue/stop criteria;
- authority limits;
- Markdown;
- JSON machine envelope;
- fyra turn-bundna slutrader.

Markdown och JSON korsvalideras före submit.

## Response- och completionkontrakt

Targetresultat accepteras endast när:

- rätt turn-ID återges;
- statusmarkörer är unika och inte citerade/kodblock;
- `CONTINUE` har konkret `EIC_NEXT`;
- `DONE` har completion evidence;
- blocker/Hjalmar NO-GO inte motsäger continuation.

Completion av stabilt mål kräver ett giltigt target-DONE, inte bara Nano-output.

## Background classifier

Trusted state byggs av flera signaler:

1. data-/ARIA-/role-ankare;
2. strukturella relationer;
3. kontrollpar;
4. lokaliserad textfallback;
5. stabil assistant/task identity.

Extensionens `data-eic-own-ui` exkluderas. Text inne i assistant message är untrusted och kan inte ensam trigga background wait.

## Idempotency

Content bridge extraherar endast turn-ID:n, inte full historik. Setet finns både i aktuell content bridge och i linked-tab runtime state. Därför förblir en tidigare prompt synlig för reconcileraren även när operatören skickar ett senare meddelande eller ChatGPT virtualiserar DOM-noder.

## Framdrift

Deterministisk progress är 1 endast när:

```text
response hash changed
AND
(valid target CONTINUE with substantive EIC_NEXT
 OR valid target DONE with completion evidence)
```

Nano-action, work-unit-omskrivning och `progressDelta` är inte progressbevis.

## Mjölnar

v0.5.3 skiljer tre saker:

- förslag: `NANO_PROPOSED`;
- trusted local trigger: `LOCAL_STATE_MACHINE`;
- extern Hjalmar-kontroll: `TRUSTED_EXTERNAL_CHANNEL`.

Ett Nano-förslag kan inte byta klass genom att passera en wrapper. D1 blir `HUMAN_REQUIRED` utan extern trusted Hjalmar-proveniens.

## Persistens

Schema v6 begränsar lagringsökning:

- recovery attempts: 40;
- effect journal: 12;
- old journal prompts tas bort;
- seen turn IDs: 128;
- audit: bounded;
- continuity: bounded och SHA-256-förseglad.

Storage write-failure öppnar circuit breaker. Ingen prompt får skickas medan circuit är öppet.

## Runtime states

```text
IDLE
PREPARING
WAITING_FOR_RESPONSE
WAITING_FOREGROUND
WAITING_BACKGROUND
ASSESSING
CONTINUING
RECOVERING
SOFT_PAUSED
HARD_BLOCKED
MJOLNAR_ADJUDICATING
MJOLNAR_DISPATCH
MJOLNAR_READBACK
HUMAN_REQUIRED
DONE
STOPPED
ERROR_RETRYABLE
ERROR_TERMINAL
```

Säkerhetsflykt till paus/block/error/stop tillåts från alla icke-terminala states. Terminal state muteras inte av sena events.

## Claim boundary

Följande kan verifieras lokalt: source, Node-tester, syntax, statisk validator, package bytes och ZIP-integritet.

Följande kräver desktop Chrome-owner: verklig LanguageModel-inferens, aktuell ChatGPT-DOM, background soak, sleep/wake, frozen/discarded och faktisk prompt-/actionreadback över tid.
