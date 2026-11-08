# Greenfield 1.9.15 — fortsättning mot ägarens slutmål

Bygger på det levererade kompletta 1.9.14-paketet. Alla dess tolv fynd och
integritetsrättningar finns kvar; se `AUTONOMY_CHANGELOG_1_9_14.md`.

| Område | Ändring i 1.9.15 |
| --- | --- |
| Terminalbeslut | Strikt och kausalt parat svar, exakt kontrolltarget, inga okända lokala utskick samt färsk direkt ägarläsning krävs. Felaktig explicit runtime-kontroll kan inte falla tillbaka till legacy-DONE. |
| Del-PASS | Befintlig dispatcher konsumerar ägarens NEXT i samma mission/slot. Ägarens körbara oberoende gren har företräde framför modellens lokala DONE eller blocker. |
| Sista readback | Ägarens CLOSURE_READY läses om precis före stängning. Utgånget kvitto, ändrad ägarstatus, STOP eller ersatt köplats stoppar commit. Endast samma logiska mission finaliseras. |
| Väntan | Bounded WAIT med orsak, händelse och återläsningstid. Ingen ny AI-prompt på oförändrad ägarrevision. Andra körbara slots får fortsätta. Avbrott efter sparad WAIT-checkpoint återupptar väntan. |
| Osäkra effekter | Befintliga dispatch-fences bevaras. UNKNOWN får inte rensas för att parkera, rotera eller prova igen. Ägarens redan utfärdade effekt-idempotensnyckel kräver rekonciliering före retry. |
| Sessionbroker | Idempotent räknare per bevisad konversation: högst 3 fullbordade kvantum eller 15 operativa promptar. Samma mission kan återupptas varmt över kvantumgräns inom taket. Separat per-slot-kvantum består. |
| FULL/COMPACT | Båda bär aktuell root, restlista, ägarkvittoreferens och fortsättningsregel. Det tillåtna A2A-svarsschemat och dess tre statusvärden är oförändrade. |
| Ägaradapter | Ny operatörsvald HTTPS-läsroute på befintlig EIC-origin, begränsad svarsstorlek, nonce/target/hash, kort kvittogiltighet och inga transkript i request. Ingen ny hostpermission. |
| Driftpanel | Endpointinställning och synlig WAIT-orsak/återstartsvillkor. Konfiguration kan endast sättas från tilläggets egen sidopanel. |
| Evidens | Bounded 64-posters historik med källbindning, tidigare/ny restlista, ägarkvitto och nästa action/effectKey. Förnyat modellomdöme blir inte ägarbevis. |

## Verklig integrationsgräns

Det äldre källpaketet innehöll ingen direkt domänägarverifiering för VTF-rootens
slutvillkor. DOM:s ownerTrusted intygar svarsursprung, inte domänacceptans.
1.9.15 levererar därför klientgrinden och en referensadapter som kopplas till
befintliga EIC-ägare. Den kopplingen kräver korrekt autentisering och verklig
VTF/GPO-läsning i EIC. Paketet innehåller ingen påhittad domänmodell eller mock
som standardkälla. Utan kopplingen hålls slutavslut öppet; normala icke-terminala
steg använder fortsatt befintlig körning.

3/15 är en ny policy i denna patch. Den granskade 1.9.14-koden tog kall väg vid
ett nytt kvantum och hade ett separat warm-resume-tak på tio. Äldre beskrivningar
som kallar 3/15 redan verifierad 1.9.14-funktion ska korrigeras.

## Leveransbevis

Aktuella körresultat, källhashar och replay finns i `../verification/1.9.15/`.
Testsvar kommer från Node/DOM och simulerad Chrome/ägare. Leveransen gör inget
påstående om Git-publicering, serverdriftsättning, Chrome-installation eller
terminal 100% PASS i ett verkligt GFW-uppdrag.
