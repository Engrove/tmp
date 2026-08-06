# Slutadjudikering — EIC Autonom Agent v0.5.0

## Underlag

- FAMILY_A, GPT-5.6 Thinking, ny EIC-backad session.
- FAMILY_B, Claude Opus 5, separat standardsession.
- v0.4.1-källarkiv med matchad SHA-256 enligt familjeunderlagen.
- Operatörens tilläggskrav för v0.5.0.
- Live projektkontext från projekt 63 samt WP30-planeringen i projekt 2.

Ingen modellöverenskommelse behandlas som proof. Källkod, lokala tester, Chrome-dokumentation och live projektposter har separata claim boundaries.

## Adjudikerad rotorsaksmodell

### Kritisk mekanism 1 — felaktig protokollkontroll

FAMILY_B visade att v0.4.1 kunde läsa kontrollmarkörer över hela target-svaret med last-wins-semantik. Den egna prompttexten och citerade kontrakt kunde därför felklassificeras. Target-text kunde dessutom påverka ett fält benämnt verifierat state.

Beslut för v0.5.0:
- turn-id-bound kontrollblock;
- endast sista bounded rader;
- kodblock/blockquote ignoreras;
- exakt en status/turn/next;
- måltext kan inte skriva verified facts;
- Hjalmar/annan target-text har ingen direkt override-auktoritet.

### Kritisk mekanism 2 — PAUS som absorberande state

FAMILY_B visade att auto- och manual recovery förutsatte ett nytt assistantsvar, samtidigt som pausen stoppade den submission som kunde skapa svaret.

Beslut för v0.5.0:
- PAUSE är en klassificeringssignal;
- normal soft pause lagrar en konkret resume-plan;
- explicit Återuppta genererar en ny journalförd continuation från den bevarade planen;
- Max Mode använder en bounded recovery-stege;
- genuine dead end kräver uttömd stege, stagnation, blockerare och unlock-event.

### Kritisk mekanism 3 — side panel som agentägare

FAMILY_A och FAMILY_B visade att v0.4.1 höll run, timers, modell, hash och pausvakt i sidepanel-renderern. Panelstängning rev ned körningen och service worker ägde ingen workflowmotor.

Beslut för v0.5.0:
- `chrome.storage.local` äger durable state;
- background service worker är single writer och bounded transition executor;
- `chrome.alarms` är watchdog;
- panel är UI/Nano-host men inte run owner;
- effektjournal och reconciliation före blind retry.

## Operatörens tillägg

### O1 — versionskrav

Manifest, contracts, package och dokumentation använder `0.5.0`.

### O2 — Start/Continue i Waiting Mode

Implementerad som ren observation:
- baseline läses;
- ingen prompt skickas;
- pågående generation stoppas aldrig;
- nästa nya kompletta assistantsvar utlöser ASSESSING.

### O3 — Starta Ny Session

Implementerad med separat textyta:
- aktiv tom ChatGPT-flik återanvänds, annars öppnas en ny i samma fönster;
- Nano analyserar hela prompten chunkvis;
- originalet levereras oförkortat;
- persistent kvitto och turn-ID hindrar dubbel leverans i samma session;
- därefter normal waiting state.

### O4 — WP30 tab/window-koncept

Projekt 2:s WP30-plan beskriver global side panel per Chrome-fönster, WindowContext/LinkedTabContext, Follow/Locked, tab move/close/navigation/reconnect, wrong-tab/cross-window-isolering och en aktiv Nano-run per fönster.

Endast dessa principer har anpassats till v0.5.0:
- per-window context;
- explicit linked/selected target;
- Locked/Follow;
- active-run target lock;
- onActivated/onUpdated/onRemoved/onReplaced/onDetached/onAttached/windows.onRemoved;
- ingen automatisk targetövertagning efter cross-window move.

WP30 är planerad och inte startad. v0.5.0 gör därför ingen claim om EIC Backend-implementation eller WP30-runtime.

## Verifieringsresultatets claim boundary

Node-sviten täcker pure contracts, marker grammar, continuity, migration, effect journal, deterministic fallback, session receipts och state transitions. Validatorn kontrollerar MV3, permissions, UI-kontrakt, versionsidentitet, statiska invariants och syntax.

Detta stödjer en lokal käll- och paketkandidat. Det stödjer inte påståendet att Chrome desktop-runtime eller flera timmars soak har PASS.

## Desktopacceptans som återstår

1. Load unpacked i inloggad Chrome-profil.
2. Waiting Mode mitt under lång generation.
3. Panel closure under waiting.
4. Manuell service-worker-termination.
5. Tab reload/replacement/move/close.
6. Tappad submission-ACK.
7. Aktiv tom tab och automatiskt skapad ny tab för engångsstart.
8. Startprompt får inte levereras två gånger i samma session.
9. Nano Prompt API context loss.
10. Max Mode recoverable pause kontra auth/CAPTCHA/operatorstop.
11. Sleep/wake.
12. Flera timmars soak med exporterat auditkvitto.

## Slutbeslut

v0.5.0 levereras som en lokalt testad och statiskt validerad kandidat. Browser-runtime-PASS är medvetet inte deklarerad före owner-evidens.
