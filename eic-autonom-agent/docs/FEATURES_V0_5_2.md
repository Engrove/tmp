# Egenskapsbeskrivning — EIC Autonom Agent v0.5.2

## Produktdefinition

EIC Autonom Agent är en lokal Chrome-sidepanel som lägger en beständig kontinuitetskontroller runt en uttryckligen kopplad ChatGPT-session. Den lokala Chrome Nano-modellen analyserar ett färdigt assistantsvar och föreslår nästa bounded arbetsenhet. En deterministisk background-policy avgör om analysen får bli en ny målprompt.

Tillägget är inte en generell browser-agent. Det arbetar endast mot deklarerade ChatGPT-hostar och endast i en kopplad flik.

## Egenskapsmatris

| Område | Egenskap | Beteende |
|---|---|---|
| Session | Waiting start | Startar utan prompt och utan att stoppa pågående generation |
| Session | New session | Öppnar ny ChatGPT-flik och levererar engångsstartprompt exakt en gång |
| Session | Exact locator | Binder Custom GPT-sessioner till `/c/<conversation-id>` |
| Nano | Direct gesture create | LanguageModel skapas från uttrycklig användargest |
| Nano | Supported language declaration | Deklarerar endast `en` i Prompt API options |
| Nano | Claim protocol | Varje request måste claimas med exakt claim-ID |
| Nano | Lease/heartbeat | Aktiv inferens förnyar lease och lämnar mätbar telemetri |
| Nano | Streaming | Använder `promptStreaming()` när tillgänglig |
| Nano | Grounding | Tom eller meta-only takeover kan inte emittera målprompt |
| Nano | Repair | En bounded repair-runda; därefter fail-closed pause |
| Kontext | Takeover bootstrap | Läser senaste kompletta svar + recent conversation head/tail |
| Kontext | Durable continuity | Bevarar intent, facts, claims, inferences, försök och blockerare |
| Anti-loop | Meta detection | Identifierar svenska/engelska audit- och kontrollomtag |
| Anti-loop | Stop condition | Två nollprogressiva metaåtgärder utlöser stopp |
| Prompt | Canonical object | Markdown och JSON genereras från samma tur-objekt |
| Prompt | Private Nano mandate | Skickas aldrig till målsessionen |
| Prompt | Target mandate header | Infogas först i varje continuation |
| Prompt | Idempotency | Effect journal blockerar dubbletter och unknown-effect retry |
| Background | Foreground wait | Konkurrerar inte med pågående ChatGPT-generation |
| Background | TTL-free wait | Ingen applikationsdeadline i verifierat background state |
| Background | Structural classifier | Kombinerar statuskontroller, ARIA/role, struktur och textfallback |
| Background | Untrusted isolation | Text i vanligt assistantsvar triggar inte ensam background wait |
| Lifecycle | MV3 recovery | Storage-baserad återställning efter worker-suspension |
| Lifecycle | Alarm reconciliation | Best-effort watchdog, aldrig state owner |
| Lifecycle | Frozen/discarded | Bevarar väntan och kräver readback efter resume |
| Lifecycle | Sleep/wake | Ingen expiry under OS-suspension; reconcile efter wake |
| Tabs | Locked mode | Fokusbyte ändrar aldrig target |
| Tabs | Follow mode | Följer endast redan kopplad flik i samma fönster |
| Tabs | Cross-window isolation | Annat Chrome-fönster väljs aldrig automatiskt |
| Mjölnar | D0 | Exakta rutinreads och bounded recovery |
| Mjölnar | D1 | Allowlist + rollback + readback + idempotency |
| Mjölnar | D2 | Auth, secrets, permissions, delete, merge, release och deploy kräver människa |
| UI | Nano telemetry | Visar request, claim, elapsed, output, chunkar och heartbeat |
| UI | Runtime state | Visar foreground/background, timeout, target och recovery |
| Data | Export/import | Exporterar config, continuity, window state och audit |
| Privacy | Local-first | Ingen egen backend eller credentialhantering |
| Security | Host allowlist | Endast ChatGPT-hostar |
| Security | Fail closed | Stale target, corrupt state och okänd effekt stoppar promptleverans |

## Nano decision contract

Nano producerar ett strikt JSON-beslut med bland annat:

- `analysisMode`
- `intent`
- `action`
- `progressDelta`
- `reason`
- `workUnit`
- `requestedAction`
- `requiredEvidence`
- `verifiedFacts`
- `targetClaims`
- `inferences`
- `evidenceAnchors`
- `blockers`
- `alternatives`
- `completionScope`
- `completionConfirmed`
- `pauseOrigin`
- `boundaryEvidence`

Background accepterar inte beslutet enbart därför att JSON kan parsas. Grounding måste matcha aktuell observation och continuity.

## Top-level run states

- `IDLE`
- `PREPARING`
- `WAITING_FOR_RESPONSE`
- `WAITING_FOREGROUND`
- `WAITING_BACKGROUND`
- `ASSESSING`
- `CONTINUING`
- `RECOVERING`
- `SOFT_PAUSED`
- `HARD_BLOCKED`
- `MJOLNAR_ADJUDICATING`
- `MJOLNAR_DISPATCH`
- `MJOLNAR_READBACK`
- `HUMAN_REQUIRED`
- `DONE`
- `STOPPED`
- `ERROR_RETRYABLE`
- `ERROR_TERMINAL`

## Nano request states

- `PENDING`
- `RUNNING`
- `COMPLETED`
- `FAILED`
- `INVALID`

En aktiv request har route-native request- och claimidentitet. Fel claim kan inte rapportera progress eller completion.

## ChatGPT response states

- `GENERATING_FOREGROUND`
- `WAITING_BACKGROUND`
- `COMPLETE_STABLE`
- `EXPLICIT_PAUSE`
- `ERROR`
- `CANCELLED`
- `AUTH_REQUIRED`
- `UNKNOWN_RECONCILE`

## Takeover-acceptans

En takeover får emittera CONTINUE endast när den innehåller:

1. härledd stabil avsikt;
2. avgränsad arbetsenhet;
3. minst ett load-bearing context/evidence anchor;
4. konkret requested action med observerbar effekt;
5. relevant required evidence;
6. ingen förbjuden boundary;
7. ingen meta-only loop.

`PROTOCOL_MISSING` är en observationssignal, inte ett tillstånd som får omvandlas till generisk CONTINUE.

## Konversationslocator

Prioritet:

1. `/c/<conversation-id>`
2. `/g/<gpt-id>` endast när ingen conversation finns
3. normaliserad path fallback

Denna ordning används både i background utilities och content script. Persisted legacy-state repareras från sparad tab-URL. Tvetydig continuity ändras inte automatiskt.

## Promptleverans

Före submit skapas ett journalrecord med:

- action key;
- effect id;
- turn id;
- prompt digest;
- prepared timestamp;
- attempt count.

Efter submit krävs DOM/readback som visar att exakt turn-ID finns i ett user message. Vid unknown effect sker readback före varje möjlig retry.

## Bakgrundsdetektering

Trusted signaler kan vara:

- stabila dataattribut;
- `role=status` eller progresssemantik;
- synlig spinner/progresscontainer;
- strukturellt kopplade Cancel/Hide-kontroller;
- lokaliserad statusfallback;
- frånvaro av ny stabil completion;
- oförändrad conversation/task identity.

Text i `data-message-author-role=assistant` är opålitlig innehållstext och får inte ensam klassificera background state.

## Persisted data

Storage innehåller endast det som krävs för kontroll och återställning:

- mandat och config;
- compact continuity;
- run state;
- linked tab metadata;
- snapshot- och responsehashar;
- Nano telemetri;
- promptjournal;
- Mjölnarledger;
- auditposter.

Credentials, cookies, tokens och full rå konversationshistorik är förbjudna.

## Rollout och säker standard

- Max Autonomous Mode är opt-in via checkbox.
- Mjölnar kan vara av, shadow, D0 live eller D1 live.
- D1 får aldrig vara dold.
- Stop-knappen är alltid tillgänglig.
- Auth/CAPTCHA/secrets/permissions/destructive är alltid human boundary.
- Operatorn har för denna leverans åsidosatt extern Hjalmar-slutgranskning. Det ändrar inte runtime-policyregeln att ett Hjalmar `BLOCK/NO-GO`, när sådan evidens faktiskt finns, inte får överridas av Mjölnar.

## Runtimeclaim

Source- och paketverifiering kan utföras lokalt. Följande kräver separat desktop Chrome-evidens:

- verklig Nano-inferenstid;
- aktuell ChatGPT-DOM;
- flera timmars background wait;
- minimerat fönster och skärmlås;
- verklig sleep/wake;
- frozen/discarded recovery;
- D0/D1 dispatch och owner-readback;
- frånvaro av dubblettprompt över lång soak.
