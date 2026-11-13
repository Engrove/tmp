---
title: "PresenceLock 0.7.0 – åtgärder efter djupgranskningen av 0.6.1 (2026-11-12)"
status: "Utvecklingskandidat – inte godkänd för bred produktion"
---

# Åtgärder efter djupgranskningen av 0.6.1

Granskningen omfattar 28 sidor, 30 fynd och 14 testfall (T01–T14) som granskaren reproducerade i 0.6.1-binären. Felvägarna är **bekräftade genom läsning av källkoden** (exempelvis släppte `OnLockRefused` låset, bekräftelsen mättes med väggklocka och säkerhetsfälten lästes från HKCU). Varje testfall är omskrivet till ett regressionstest som kräver det rättade beteendet: `tests/PresenceLock.Core.Tests/ReviewFindingsTests.cs`. Alla går igenom i 0.7.0. Testen använder nya gränssnitt och har därför inte körts mot 0.6.1-källan. Att felen fanns där vilar på granskarens reproduktion. Granskarens positiva kontrollfall C01 och C02 går fortfarande igenom.

**Bedömning efter rättningarna: fortfarande inte produktionsklar** (F30). Windows-kedjan, alltså riktiga lås, sessionshändelser, processrättigheter, GPO och installation, är inte körd på Windows. Behåll Windows egen inaktivitetsgräns (*Interactive logon: Machine inactivity limit*, eller den befintliga skärmsläckar-GPO:n) som **säkerhetsgolv**. PresenceLock är ett komplement som kan låsa tidigare.

Status: **Rättad** = ändrad kod och test som belägger rättningen. **Delvis** = huvudrisken hanterad, rest angiven. **Öppen** = kräver Windows, pilot eller beslut.

| Fynd | Status | Vad som är gjort (kod) | Belägg | Kvar |
|---|---|---|---|---|
| F01 Tidsgränsen upphör efter misslyckat lås | **Rättad** | Begärd ≠ bekräftad låsning. En begäran som avvisas eller inte kvitteras görs om (10 s utan kvittens, 15 s efter avslag), och efter 3 försök kopplas sessionen från. Säkerhetsgolvet vid HoldMax gäller även utan modellepisod. Om användaren återkommer före bekräftelse räknas det som exponering. | T01, T02, `F01_SafetyFloor…`, `F01_UserBack…` | W01 på Windows |
| F02 Guarden antar låst utan bekräftelse | **Rättad (logik)** | `GuardPolicy` räknar en session som låst först när Windows rapporterar det, via sessionshändelse eller avläst `WTSSessionInfoEx`. Hjälpprocessens returkod inväntas. Begäran upprepas, därefter frånkoppling. Om ingen frisk agent finns inom 120 s efter inloggning eller upplåsning låses sessionen (fail-closed). Händelser: 1001 begäran, 1003 misslyckad, 1007 frånkoppling, 1008 bekräftad. | T05, T06 | W01, W02. Offset i `WTSSessionInfoEx` ska verifieras |
| F03 Användarpolicy styr säkerhetsfält | **Rättad** | Alla skyddsrelevanta värden läses bara från datorpolicyn (`PolicyScope`). ADMX: allt utom *Visa låsning* är datorprincip. | T07 | W05 |
| F04 Processens existens som bevis på hälsa | **Delvis** | Agenten räknas bara om den körs i **agentrollen**: kommandoraden läses, och CLI-instanser räknas inte. Hjärtslag i HKCU var 5:e sekund. Inaktuellt i 60 s räknas som "svarar inte". Ett ockuperat mutex-namn gör inte längre att agenten avstår. | `F04_HungAgent…` | Hjärtslaget bevisar att agenten lever, inte att den är äkta, eftersom användaren kan skriva samma nyckel. Äktheten kommer från exakt sökväg, agentroll och process-DACL. W03, W06 |
| F05 I/O blockerar säkerhetsloopen | **Rättad (kod)** | Agentens sparning, export och rensning körs i en bakgrundstråd. Baslinjen läses med 5 s timeout. Guardens synk och rensning har en egen timer, skild från låsloopen. | – (trådning) | W09 |
| F06 Färsk indata missas | **Rättad** | Indata upptäcks också när inaktivitetstiden **minskar** mellan två avläsningar, så ett försenat tick missar inte indatan. | T04 | W04 (hjälpmedel) |
| F07 Väggklocka för säkerhetstider | **Rättad** | Bekräftelse, kvittens och omförsök mäts på inaktivitetsaxeln, som bygger på GetTickCount och därför är monoton. Kinematiken använder QPC. | T11 | Pausbudgeten är kalendertid (UTC), med avsikt. W11 |
| F08 Installation rapporterar framgång utan ny binär | **Rättad** | Manifestkontroll, mellanlagring, verifiering, byte med återställning vid fel, kontrollerade returkoder, återläsning av hash och version. Exit 0 bara när målversionen är aktiv. Loggrotation. | PowerShell-parser: 0 fel | W08 |
| F09 Ny GPO når inte en körande agent | **Rättad** | Policyn läses om var 5:e minut och tillämpas på koordinator, profil och meny. Härdning slås på direkt om avslut förbjuds. | – | Upp till 5 min fördröjning. Att lätta på härdningen kräver omstart. W05 |
| F10 Manipulerad årslång paus | **Rättad** | Pausposter accepteras bara om de är rimliga: högst 480 min och högst policyns längsta val. De rensas vid inläsning och innan de når den skyddade kopian. | T08 | – |
| F11 Saknad profil hoppar över reservkopian | **Rättad** | En saknad profil återställs från `.bak`, och bara om kopian hör till samma SID. | T09 | – |
| F12 Samtidiga sessioner, samma profil | **Delvis** | Unika temporära filnamn, så filkollisioner undviks. | – | Senast skrivna profil vinner fortfarande. W10. Beslut: ska samma användare kunna ha två sessioner? |
| F13 Gammal musgest återanvänds | **Delvis** | Kinematik skrivs bara om musen var den indata som slutade. Monoton tid. | T10 | Normalisering för CPI och Hz är inte gjord. W13 mäter |
| F14 Signalfel blir inte fel | **Rättad** | Om GetLastInputInfo fallerar fortsätter inaktivitetstiden att växa (fail-closed), och rå musindata räknas fortfarande. Registreringarnas returvärden kontrolleras, nytt försök varje minut, händelse 1018. | – | W12 |
| F15 Snabb upplåsning rättar inte alla lås | **Rättad** | En regel för alla låsorsaker: utfallet avgörs vid upplåsningen. | T03 | – |
| F16 Inaktivitet som facit | **Delvis** | Ingen antagen frånvaro i tysta arbetsappar. Antagna och observerade etiketter räknas separat (`--status`). | T14 | Sannolikheterna är **inte** validerade som sannolikhet för fysisk närvaro. Pilot med oberoende facit (W15) |
| F17 Grindens nämnare | **Rättad** | Ytterligare kriterium: Wilson-övre gränsen för andelen fel bland **verifierade** beslut ska vara ≤ 50 %. Båda måtten visas. | T13 | – |
| F18 95 % vid upprepad prövning | **Öppen (dokumenterad)** | README anger nu att gränsen gäller ett fönster, inte hela livslängden. | – | Förutbestämd validering med fryst modell i piloten |
| F19 Modellskyddet och modellversioner | **Öppen (dokumenterad)** | Beskrivs som övervakning av en adaptiv process. | – | Spårbar modellhash per godkännande (P2) |
| F20 Lagring förutsätter att städning körs | **Delvis (dokumenterad)** | Städningen körs vid varje start, så gammal data rensas senast vid nästa inloggning. | – | Konton som aldrig loggar in igen: Windows profilrensning eller avinstallation. Beslut |
| F21 Insamlad profil identifierbar | **Rättad** | Insamlingen bygger på en lista över tillåtna fält: ingen SID, inget datornamn, inga livscykeltider, uppdateringsdatum bara på dagsnivå. Filnamnet identifierar fortfarande användaren, vilket är dokumenterat. | T12 | – |
| F22 Insamling utan robust leverans | **Rättad (logik)** | Atomisk publicering. Lyckad och försökt export sparas beständigt. Nytt försök efter 1 h vid fel. | – | Behörigheter på resursen: W17 |
| F23 "NIS2-läge" beskriver konfiguration | **Rättad** | Om-rutan och `--status` visar **observerad** status för guard-tjänsten. Benämningen är nu "centralt skyddat läge". | AboutContentTests | – |
| F24 Paus och dimning, tillgänglighet | **Delvis** | Pausmenyn förklarar frågan "är du kvar?". | – | Text och nedräkning på dimningen, skärmläsare. W14 |
| F25 Ljud och BLE utan koppling | **Rättad** | Markerade "ej tillgänglig i denna version" i GPO-mallen. | check_admx | – |
| F26 SYSTEM läser användarfiler | **Rättad** | Guarden läser användarens profil **med användarens rättigheter** (impersonering) och vägrar länkar och för stora filer. | – | W06, W07 |
| F27 Versionsspårning | **Rättad** | `verify/make_release.sh`: bara från rent commit. Commit-hashen i EXE-filen kontrolleras mot HEAD. `RELEASE-MANIFEST.json` med hashvärden och testresultat. | – | – |
| F28 Loggning och exportkontroll | **Rättad** | install.log roteras. `--export` följer AllowProfileExport, utom för eleverad admin. Händelserna skiljer begäran, bekräftelse och reservåtgärd. Export beskrivs som funktionell begränsning, inte som DLP. | – | – |
| F29 Efterlevnadsutkasten | **Delvis** | Datakartan uppdaterad: insamlingens innehåll, hjärtslag, nya händelser. | – | Elhos beslut om ändamål, insamling under pilot och gallring |
| F30 Windows-acceptans saknas | **Öppen** | Testplanen W01–W18 ingår i README (pilotchecklistan). | – | Kör W01–W18 på avsedda Windows-versioner före produktionsbeslut |

## Regressionstester (från granskarens kontrollprogram)

| Fall | 0.6.1 (granskning) | 0.7.0 |
|---|---|---|
| T01 avvisat lås | ett försök vid 48 s, sedan inget till 2000 s | nytt försök var ≤ 16 s, frånkoppling efter 3 försök (≤ 915 s) |
| T02 utebliven kvittens | ingen ny begäran | begäran 48, 58, 68 s, frånkoppling vid 78 s |
| T03 snabb upplåsning efter backstop | positiv etikett, 0 fel | 0 positiva, 1 fel |
| T04 indata under bekräftelse | låst | inte låst, besvarad |
| T05 guard utan låskvittens | 1 begäran | upprepas tills Windows rapporterar låst, sedan frånkoppling |
| T06 guard, agenten blir aldrig frisk | 0 låsbegäranden | låsbegäran efter 120 s |
| T07 användarpolicy | ForceLearning från HKCU verksam | säkerhetsfält läses bara från datorpolicy |
| T08 årslång paus | accepterad, aktiv efter 180 dygn | rensad, inte aktiv |
| T09 saknad profil, giltig `.bak` | ny profil i inlärningsläge | återställd (skarpt läge), notis |
| T10 gammal musgest | återanvänd | inga kinematiska värden |
| T11 klockan bakåt | ingen låsning | låsning |
| T12 insamling | livscykeltider kvar | borttagna |
| T13 10 av 10 beslut fel | befordrad | kvar i inlärning |
| T14 lång stilla läsning | positiv etikett | ingen etikett |
