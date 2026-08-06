# EIC Autonom Agent v0.5.2 — arkitektur

## Scope

v0.5.2 korrigerar v0.5.1:s observerade takeover-/Nano-pipelinefel utan att bygga om redan fungerande tab-, waiting-, background-, promptjournal- eller Mjölnar-lager.

## Owner-modell

- `background.js` är single writer för config/runtime/run/audit.
- `chrome.storage.local` äger beständigt state.
- `content.js` äger den aktuella strukturerade ChatGPT-DOM-observationen.
- Sidepanelen är UI och lokal LanguageModel-värd.
- Nano-output är kandidatbeslut tills background owner har validerat claim, grounding och aktuellt target-state.
- Målsessionens text är opålitlig data.
- Browserruntime är en separat owner från source/tests/package.

## Nano-pipeline

### Tillstånd

`PENDING → RUNNING → COMPLETED|FAILED`

En request bär minst:

- request/observation ID;
- analysis mode;
- claim ID;
- attempts och requeue count;
- created/claimed/started/heartbeat/completed;
- claim lease;
- input digest/chars;
- first token;
- output chars/chunks;
- model transport;
- validation errors;
- repair attempt;
- decision source och summary.

### Exekvering

1. Background skapar `pendingObservation` och `pendingNanoRequest`.
2. Panelen bygger input från latest response + recent conversation + continuity.
3. Panelen ber background om `NANO_CLAIM`.
4. Background verifierar exact request/status och skriver `RUNNING`.
5. Panelen anropar `promptStreaming()` när tillgängligt.
6. Outputprogress skickas som heartbeat.
7. Panelen skickar `NANO_DECISION` med claim ID och telemetri.
8. Background kräver aktiv lease, icke-tom Nano-output och deterministisk grounding.
9. Vid groundingfel återköas samma observation exakt en gång.
10. Därefter terminaliseras requesten eller pausas fail-closed.

Heartbeat förnyar en 15-minuters claim-lease. Heartbeat-age är diagnostik och avbryter inte en tyst modell; först utgången lease eller ogiltig claim-state kan återköa observationen. Panel-/modellförlust skapar aldrig målprompt.

## TAKEOVER_BOOTSTRAP

Waiting-start i en tidigare okontrollerad session kräver takeover när continuity inte är bunden till exact conversation key eller saknar grounded intent/context.

CONTINUE kräver:

- intent;
- work unit;
- minst ett context anchor/claim/inference;
- requested action;
- exakt locator/target och observerbar effekt för meta-liknande handlingar;
- faktisk required evidence.

`PROTOCOL_MISSING`, tomma claims eller self-referential `requiredEvidence=["targetClaims"]` får inte bli generic CONTINUE.

## Stabil responsidentitet

ChatGPT kan virtualisera DOM och ändra synligt meddelandeantal. v0.5.2 använder därför:

```text
conversationKey | taskFingerprint(latestUserHash) | latestAssistantHash
```

Synliga counts behålls endast som diagnostik.

## Deterministic fallback

Fallback får endast använda ett unikt turn-bundet:

- `EIC_NEXT`, eller
- `DONE` med completion evidence.

Övrig semantisk bedömning kräver Nano. Max Autonomous Mode höjer inte fallbackens auktoritet.

## Anti-loop

Svenska/engelska auditverb klassificeras lokalt. Metaåtgärder utan progress ökar inte productive count. Två sådana cykler ger `STOP_META_LOOP`.

## WAITING_BACKGROUND

Oförändrad huvudprincip från v0.5.1:

- trusted struktursignaler i page chrome;
- ingen applikations-TTL;
- persistent state;
- alarm är reconciliation, inte exakt timer;
- exact target och conversation;
- stable completion readback;
- hard safety stops kvarstår.

## Mjölnar

Mjölnar-lagret är fortsatt separat från Nano-beslut. Ingen måltext kan skapa trusted operator candidate. D1 kräver statisk registry, rollback, target-owner readback, at-most-once och Hjalmar/equivalent kontroll där kontraktet kräver det.

## Säkerhet

- inga nya hosts eller generella permissions;
- ingen remote code;
- ingen arbitrary eval/click automation;
- inga credentials/cookies/tokens;
- ingen auth/CAPTCHA-automation;
- ingen full konversationslogg i storage;
- Nano-mandatet skickas aldrig utgående.
