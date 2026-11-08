# Uppdatera till Greenfield 1.9.16

Paketet innehåller hela tillägget. Uppdateringen bevarar rättningarna från
1.9.14–1.9.15 och nekar implicit byte av ett redan bundet rotmål.

1. Pausa berörda workers och köer på ett kontrollerat sätt. Bevara diagnostik,
   konfiguration och föregående kodmapp. Låt pågående svar slutföras innan en
   omladdning; en osäker effekt måste rekoncilieras i sin ursprungliga konversation.
2. Ersätt hela innehållet i den **befintliga** tilläggsmappen med innehållet i
   detta pakets `greenfield/`. Installera ingen parallell kopia och radera inte
   sparade uppdrag, köplatser, kvitton eller historik.
3. Välj **Läs in igen** för rätt tillägg i `chrome://extensions`. Ladda därefter
   om tillhörande ChatGPT-flikar när föregående steg är säkrat och öppna panelen
   på nytt. Manifest, panel och **Körande motor** ska visa **1.9.16** utan
   versionsvarning. Denna anvisning är inte ett kvitto på utförd installation.
4. Bevara samma savedMissionId, itemId och frusna rot. Ingen datamigrering eller
   automatisk scopeändring görs. Sessionsgränsen är fortsatt tre fullbordade
   kvantum eller femton operativa promptar, det som nås först; slotens
   maxInteractions, normalt fem, gäller separat.
5. Har v1.9.15 redan använts med ansluten ägarläsning och operatörsinstruktioner:
   jämför sparad root/progressEvidence med kanonisk högsta ägarrot. v1.9.16 kan
   inte identifiera alla tidigare felaktigt sparade rotbyten. Vid avvikelse,
   håll berört uppdrag, bevara underlaget och använd ägarens befintliga
   auktoriserade återställningsförfarande. Radera inte ownerProgress eller skapa
   ett nytt uppdrags-ID för att komma förbi spärren.
6. Tillämpa `../EIC_v1.9.16_instruktioner.txt` hos de befintliga EIC-ägarna.
   Läs först deras aktuella regler och revisioner. Publicerad kunskap kräver
   separat readback; en uppladdad instruktion är inte en genomförd regeländring.
7. Verifiera faktisk EIC-ägarläsning enligt
   `../eic-integration/OWNER_PROGRESS_CONTRACT.md`. Behåll en redan verifierad
   anslutning; referensadapterns root-spärr är oförändrad. Exempelvägen i Drift
   är inte bevis på en tillgänglig server. Saknas en fungerande anslutning,
   inventera befintlig autentisering och ägarkapacitet innan ny integration
   beslutas. Inga credentials ska läggas i kod, URL, prompt eller diagnostik.
8. Kör acceptansmatrisen i `../eic-knowledge/acceptance-plan.json` i ett redan
   auktoriserat avgränsat uppdrag. Kontrollera rätt rot och mission, del-PASS →
   nästa arbete, WAIT utan AI-loop, STOP, rotation och terminal readback.
   Tvinga inte fram ett farligt rotbyte i ett produktionsuppdrag; använd
   godkända testägarkvitton för negativa fall.

## Beteende vid en avvisad rot

Klientens direktvalidering ger `OWNER_ROOT_CHANGED`. Referenshandlern ger
HTTP 409 med denna orsak; klientens transportlager visar `OWNER_HTTP_409`.
Den gamla roten och dess historik bevaras. Avslaget sparas som senaste
läsresultat. En vanlig instruktion kan tillämpas inom ursprungligt mål;
den avvisade rotens nästa åtgärd och slutkvitto används inte som ägarbevis.

Det finns ingen rotbytesfunktion i v1.9.16, inte heller via texten ”byt rot”.
En verklig scopeändring måste hanteras hos rätt ägare genom ett separat
verifierat förfarande. Ingen ny wire-kontroll införs för detta.

## Återställning och verifiering

Bevara tidigare kod som återställningskopia. Vid rollback pausas berörda
uppdrag och deras ägarläge kontrolleras först: v1.9.15 innehåller det kända
rotmålsfelet. Rulla inte tillbaka kod och fortsätt oövervakat som om spärren
fortfarande gällde. Osäkra effekter och köhistorik får inte raderas.

Tillägget behöver ingen npm-installation för att köras i Chrome. För tester,
från `greenfield/`: `npm ci --ignore-scripts --no-audit --no-fund` och `npm test`.
Från paketroten: `python3 verification/1.9.16/verify_release.py`.
Källhashar, verkliga körresultat och testernas gränser finns i
`../verification/1.9.16/VERIFIERING.md`.
