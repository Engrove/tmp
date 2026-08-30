# Integritet — EIC Autonom Agent v0.10.10

## Lokal-first

Tillägget har ingen egen extern backend för Session Capture eller Session Memory. Chrome Prompt API kör den lokala analysen enligt den kapacitet Chrome tillhandahåller.

## Behörigheter

Standardpaketet använder `sidePanel`, `storage`, `tabs`, `scripting` och `alarms` samt endast de deklarerade ChatGPT-originerna. Browserpaketet kan efter uttrycklig användaråtgärd begära en exakt valfri origin och använda bounded debugger/CDP enligt befintlig riskpolicy.

Tillägget använder inte cookie-, identity- eller webRequest-behörighet i standardflödet.

## IndexedDB

v0.10.1 lagrar strukturerad lokal sessionskontext i IndexedDB:

- captures;
- turns;
- sections;
- section summaries;
- session memories;
- operator actions;
- metadata.

Poster är current-only, källbundna och redigeras före persistens. Writes kräver transaktionsslut och exakt readback. Quota-, korruptions- och versionsfel fail-closar.

## Session Capture

Capture läser endast synlig transcriptstruktur:

- user/assistant-roll;
- stabil meddelandeidentitet;
- final answer;
- browser-visible reasoning summary;
- links;
- attachment references;
- completeness gaps.

Capture läser inte cookies, signed URLs, nätverkstrafik, debuggerstate, rå React-state, rå HTML eller dold chain-of-thought. En attachment reference är inte attachment body.

## Session Memory

Session Memory är härledd lokal kontext med typade register, provenance, source hashes, completeness, supersession och stale-state. Den promoveras inte automatiskt till Core memory och är inte project/repo/runtime owner truth.

Nano får normalt endast en bounded aktiv capsule.

## Hemligheter och redaktion

Fält som ser ut som tokens, credentials, cookies, authorization, signed URLs, session locators, lock tokens eller confirmation tokens ersätts med `[REDACTED]` före persistens. Transporthemligheter ska inte ingå i export v20.

## Retention och radering

Retention är bounded. UI erbjuder explicit lokal purge av Session Capture och Session Memory. Extensionens hela site/storage-data kan dessutom rensas i Chrome.

## Export

Export v20 innehåller bounded summaries och locatorer för profil, operator action, capture och memory. Den inkluderar inte rått transcript, attachment bodies, cookies, credentials eller transporthemligheter.


## Automatic capture boundary

Automatic capture is local-only, transcript-only and runs only for a new stable linked conversation identity. It does not capture network traffic, cookies, signed URLs, hidden chain-of-thought or attachment bodies. Manual purge remains available.


## Nano-granskning efter Session Capture

Den första lyckade capture i en appsession kan lokalt trigga en Nano-granskning av inställningar och tre kärnytor. Underlaget är den lokala capture-/memorysammanfattningen och klassas som obetrodd transcriptdata. Om sessionsinitiering eller mission-Nano använder modellen sparas en lokal, källbunden deferral med appsession-, capture- och memory-identitet. Den konsumeras exakt en gång efter `READY` och modellfrisläppning. Förslaget lagras lokalt och tillämpas aldrig utan operatörens uttryckliga acceptans. Credentials, cookies, tokens, transporthemligheter och attachment bodies ingår inte.

## Automatisk Nano-applicering

En lokal Nano-granskning kan efter en femminuters väntetid tillämpa ett normaliserat, låg-risk lokalkontextförslag när den standardaktiverade inställningen fortfarande är på och operatören inte har accepterat eller nekat. Mandat-, snabbprofil- och autonomiändringar förblir manuella. Förslaget bygger på lokalt transcript-/memoryunderlag som fortsatt klassas som obetrott. Det får inte ge credentials, permissions, owner truth, Mjölnar-rollout, release- eller deploymentauktoritet. Funktionen kan stängas av i Inställningar.

## Uppmärksamhetsbanner och Autostart

Uppmärksamhetsbannern visar endast lokalt härledd status och en intern UI-locator. Den skickar inte data externt. Autostart materialiserar ett lokalt preset och använder samma befintliga ChatGPT- och Chrome Prompt API-ytor; den skapar inga nya behörigheter.


## Valbar full audit

Full audit är avstängd som standard. Operatören väljer uttryckligen en befintlig katalog genom Chromes katalogväljare. Tillägget begär skrivbehörighet och verifierar kataloghandtaget genom att skriva, läsa tillbaka och radera en unik probfil innan NDJSON-segment får skrivas.

Chromes File System Access API exponerar inte katalogens absoluta Windows-sökväg. Tillägget kan därför verifiera att det valda handtaget är skrivbart, men inte att det verkligen är `C:\\temp`. Ingen katalog skapas automatiskt.

## Nano huvuduppgiftsbaslinje

Nano kan begära en strukturerad huvuduppgiftsbaslinje från den länkade ChatGPT-sessionen. Baslinjen kan innehålla uppgift, mål, scope, owner-locators, blockerare, 80/20-prioritet och namn/hash för global skills. Uppgifterna behandlas som obetrodd routingkontext och ger ingen ny behörighet eller owner-sanning. Den ingår i lokal continuity och kan förekomma i en lokal export.

- Tillägget skapar eller söker inte efter `C:\\temp`.
- Browsern lämnar ett kataloghandtag och katalognamn, inte en verifierbar absolut Windows-sökväg; operatören måste välja rätt mapp.
- Kö, batch, filstorlek och antal segment är begränsade.
- Auditfel är fail-soft och får inte stoppa huvudkörningen.
- Promptkroppar, credentials, tokens, cookies, signed URLs, carrier/session secrets och dold reasoning ska inte skrivas.
- Kataloghandtaget lagras lokalt i IndexedDB och kan återkallas genom browserbehörighet eller rensning av tilläggets data.


## ChatGPT process overlay

v0.10.10 may inject a local, translucent status overlay into the linked ChatGPT page while session context or Nano analysis is in progress. The overlay contains only derived phase/status text, is marked as extension-owned UI so transcript scanners ignore it, and does not become source-of-truth evidence. The operator may close it for the current need key; a later phase or new need may display it again. No overlay content is sent to an external backend.
