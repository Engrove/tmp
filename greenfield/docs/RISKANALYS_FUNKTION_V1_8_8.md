# Funktionell patch- och riskanalys – Greenfield v1.8.8

Datum: 2026-09-26. Baslinje: användarens kompletta v1.8.7-arkiv, inte Forgejo-main.
Originalet är lagrat i Project63 som artifact **12194**:
`ef344a01c96139bb44a47c3b13b0eb71f10209fc9ce755f63625a6da2fcd227f`, 987041 byte.

## Omfattning och evidens

Alla 320 filer extraherades; samtliga 319 poster i baslinjens INTEGRITY.json matchade.
Granskningen koncentrerades på väntan/generering, återhämtningskedjor, EIC-målval,
trådidentitet, kopplad overlay och de befintliga regressionssviterna.
Detta är inte ett bevis att varje körväg eller extern UI-variant är felfri.

Baslinjen kördes lokalt: 622/622 tester godkända.
Tolv nya regressionstester, med API:er som redan finns i v1.8.7, fallerade mot den
oförändrade baslinjen av respektive avsedd beteendeorsak. Efter patchen passerar
dessa plus åtta gräns-/återhämtningstester. Hela versionsmärkta paketet: 642/642.
149 JavaScript/MJS-filer syntaxkontrolleras separat.

Alla dessa resultat är från Node v22.16.0 med den riktiga controllerkoden och
mockade Chrome-gränssnitt. De är inte tester av en inloggad Chrome-installation.
Det medföljande Chromium-verktyget provades, men miljön stoppade sidnavigeringen
med `ERR_BLOCKED_BY_ADMINISTRATOR` innan DOM-assertionerna kunde köras.
Äldre medföljande Chromium-resultat är historiska, inte ny verifiering.

## Bekräftade fel och rättningar

| ID | Felmekanism i v1.8.7 | Konsekvens | Rättning i v1.8.8 | Primär kod |
|---|---|---|---|---|
| GF188-01 | evaluateWaitingRefresh tittar på tid och steg men inte positiv genereringsobservation. | Ett legitimt långt svar kan laddas om eller överges. | Deferral endast med aktuell `generating` plus stopp-/strömningssignal; hårt 4h-tak från prompt, synlig maximal respit, normal svarsfångst. | lib/waiting-refresh.mjs; background.js; lib/overlay-summary.mjs |
| GF188-02 | Förfallna tidsgränser kan driva flera destruktiva steg på efterföljande ticks utan verklig återhämtningspaus. | Omladdningsstorm och för tidigt köbyte efter lång paus. | Minst 60s efter faktiskt begärt steg; samma deadlineberäkning i overlay. | lib/waiting-refresh.mjs |
| GF188-03 | resolveManagedGptRoot väljer aktiv fliks GPT före befintlig process-/EIC-bindning. | En kö startad från annan GPT riktas dit trots känd EIC-adress. | Bunden process först, verifierad global EIC därefter; aktiv tab-root endast när bindning saknas eller ger namn för samma id. | lib/managed-eic-surface.mjs |
| GF188-04 | En EIC-root räknas som giltig adress och skriver över lastManagedUrl; tom root saknar conversationUrl och kan ses som återhämtad. Återhämtningen laddar aktuell root igen. | Ett obesvarat uppdrag förlorar återinträdet till sin konversation. | Bevara känd konversation under pågående tur, betrakta tom landningssida som saknad tråd och återbesök sparad tråd via befintlig återhämtningsstege. | lib/conversation-recovery.mjs; background.js |

De tolv regressionsfallen är flera fall för dessa fyra felgrupper, inte tolv
oberoende produktfel. Respittaket och den minsta mellanpausen är uttryckliga
klientval i denna patch; de är inte provider-attesterade tidsgränser.

## Gränser som bevaras

- Kvalitetskarantän under pågående tur returnerar fortfarande före återhämtningsstegen.
- Modellspärren får inte användas som tillstånd att skicka nya promptar.
- Ett utskick med okänd effekt skickas inte blint igen.
- Enbart `composerBusy` eller `generating=true` utan positiv signal ger ingen ny respit.
- Generering som aldrig upphör får inte hålla en köplats obegränsat: därefter körs
  den återstående stegkedjan med mellanpaus. Tidsgränsen innebär att även ett
  legitimt svar längre än fyra timmar kan utsättas för återhämtning.
- En faktisk avslutad respons fångas via befintlig kausal bindning/stabilitetskontroll.
- En avsiktlig ny sessionsrotation återställer inte den gamla konversationen.
- En annan GPT:s eller origins konversationsadress får inte lånas som återställningsmål.
- Generiska `/c/<id>`-adresser får sparas först efter aktuell EIC-ytkontroll.
- Inga nya extension permissions, host permissions, nätverksdestinationer eller wire-operationer.

## Återstående funktionella risker

| Risk från v1.8.7 | Status efter patch | Nästa diskriminerande kontroll |
|---|---|---|
| Riktig konversations-DOM i det nya ChatGPT-skalet saknas | Fortsatt overifierad; inga uppdiktade selektorer har lagts in. | Sanerad observation under generering och efter färdigt svar; replay och faktisk Chrome-smoke. |
| Pro/effort medium | Avsiktligt oförändrad policy, inte en borttagen spärr. | Operatörsbeslut och verifierad betydelse innan godkännanderegel ändras. |
| Miljöfel upprepas per köplats | Befintligt beteende kvar; inget nytt fleet-globalt stopp införs i denna patch. | Avgränsa felkälla per profil/worker före ett gemensamt återhämtningsbeslut. |
| Synliga men fastnade stop-/streaming-signaler | Begränsat av 4h-taket, inte eliminerat. | Verkliga tidsserier; skilj aktivitet från fastnat DOM-tillstånd. |
| Adressen raderades redan av en äldre version | Patchen kan inte rekonstruera en okänd tråd. | Återöppna den faktiskt ursprungliga konversationen och återläs owner-state. |
| GPT-/pluginövergången | Inte implementerad eller omprioriterad här. | Befintligt P0-spår och dess verifieringskrav äger arbetet. |
| Kontinuerlig UI-drift | Fortsatt extern kompatibilitetsrisk. | Befintliga DOM-verktyg plus verkliga runtime-observationer; inte en generell garanti. |

## Testdisciplin och releasegräns

Beteenderegressionerna från tidigare versioner är oförändrade.
Endast versionsliteralerna i `tests/static-contract.test.mjs` och
`tests/v137-multi-mission-static.test.mjs` flyttas från 1.8.7 till 1.8.8.
Inga assertions togs bort, inga tester skippades och inga modellkrav lättades.

V1.8.8 är en levererad, lokalt regressionstestad källpaketversion.
Den är inte påstådd installerad, inte GitHub-pushad, inte live-Chrome-godkänd och
inte bevis för att alla GFW redan tagit in den nya kunskapen.
Paketet bygger på artifact12194; det ersätter inte tyst Forgejo-mainens äldre
applikationsbaslinje. Dokumentation och source patch ska märkas med denna bas.
