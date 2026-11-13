# PresenceLock

Självlärande närvaroagent för Windows 10/11. Låser arbetsstationen när användaren har gått, och lär sig per användare skillnaden mellan *sitter still och läser* och *har rest sig och gått*. Agenten syns bara som en ikon i meddelandefältet. Den distribueras och styrs via GPO, utan MSI och utan kodsignering.

> Repo: `tmp` (Claude Code-experiment). Den här katalogen innehåller experimentet PresenceLock.

> **Status 0.7.1: utvecklingskandidat, inte godkänd för bred produktion.** 0.7.0 rättade låskedjan efter en extern djupgranskning av 0.6.1 ([åtgärdsdokument](docs/review/2026-11-12-granskning-atgarder.md)). 0.7.1 rättar befordringsgrinden efter analysen av den första fältprofilen ([fältanalys](docs/review/2026-11-13-faltprofil-analys.md)). Ingen Windows-acceptans är gjord (W01–W18 i pilotchecklistan, §13). **Behåll Windows egen inaktivitetsgräns** (skärmsläckar-GPO eller *Interactive logon: Machine inactivity limit*) som säkerhetsgolv. PresenceLock är ett komplement som kan låsa tidigare.

---

## 1. Status: vad är bevisat, vad är bara kompilerat, vad är otestat

| Del | Status | Bevis |
|---|---|---|
| Modell, inlärning, befordringsgrind (`src/PresenceLock.Core`) | **Verifierad i simulering; grinden omgjord efter fältdata (0.7.1)** | 43 kontroller i Python-referensen, bland annat fältreproduktionen från 2026-11-13. Hela C#-sviten är 188 tester: 19 regressionstester från den externa granskningen och 16 från fältanalysen. Simuleringarna har sedan 0.7.1 den uppmätta pausfördelningen. C#-motorn ger **bit-identiska** parametrar mot referensen efter 45–60 simulerade dagar (28/28 parametrar, max avvikelse 0,0; modellskyddet i §5b ligger utanför motorn och påverkar inte detta). |
| Beslutsflöde: passiv paus, kontrollprob, absolut backstop (`PresenceCoordinator`) | **Verifierad** | 14 enhetstester, bland annat ett egenskapstest med 500 slumpade modeller och slumpmässigt fladdrande signaler (låsning sker alltid ≤ `HoldMax` + grace). Två jämförande 60-dagarssimuleringar (§6). |
| Passiva OS-signaler (`PassiveSignalReader`) | **Kompilerad, ej körd. Semantiken är delvis odokumenterad** | ConsentStore är odokumenterad. Om `SystemExecutionState` aggregerar andra processers begäranden är inte dokumenterat. Verifiera på målmaskin med `PresenceLock.exe --probe-signals` (§6). Ett fel i signalerna kan bara fördröja låsning upp till `HoldMax` + grace. |
| Profil-JSON, export, baslinje, sammanslagning | **Verifierad** | C#-tester: round-trip, atomisk skrivning, korrupt fil, saknade fält, anonymisering, medelvärde. |
| Goertzel-DSP för ultraljudssensorn | **Verifierad** | `verify/goertzel_check.py`. |
| ADMX/ADML ↔ kod | **Verifierad** | `verify/check_admx.py`: alla värdenamn och strängar matchar i båda riktningar. |
| Windows-agenten (`src/PresenceLock.App`) | **Kompilerad, ej körd** | Byggd mot .NET Framework 4.8:s referensassemblies med 0 varningar och varningar som fel. Binärens storlek, SHA-256 och commit står i `RELEASE-MANIFEST.json` i paketet, `ILOnly` (64-bit på x64), `WindowsGui`, refererar enbart in-box-assemblies. **Ingen Windows-maskin fanns i byggmiljön.** Se pilotchecklistan (§13). |
| Manipulationsskydd, NIS2-läge (`TamperProtection`, guard-tjänst) | **Reglerna verifierade, Windows-delen kompilerad men ej körd** | 19 enhetstester: process-SDDL (även injektionsförsök), återställning av raderad/nedgraderad profil, monoton skyddad kopia, guardens tillståndsmaskin (start, lås vid dödad agent, ignorerar utloggning och session 0). Om processens DACL faktiskt nekar Aktivitetshanteraren måste provas på Windows (§13). |
| Vaneinlärning (`HabitModel`, modellerad efter Elli) | **Verifierad i simulering** | 13 modelltester (bland annat överlevnadsintervallet mot brute force i 200 slumpfall, censurering, sommartid, kärnor, Wilson), 11 koordinatortester (bland annat egenskapen *aldrig senare lås* i 300 parade körningar) och en 70-dygns rutinsimulering (§8). |
| Tyst arbete: etiketter i efterhand, inlärd horisont, tystnadsprofil (v0.5) | **Verifierad i simulering** | Inventor-scenariot (§4b) på 4 frön med och utan notis, kontorsscenariot (§6) på 3 frön, 9 koordinatortester och 7 tester för tystnadsprofilen, bland annat att jämnt spridda betraktanden *inte* får delas i två grupper. |
| Kaizen: modellskydd och kvalitetsuppföljning (v0.5) | **Verifierad i simulering. Händelseloggen är kompilerad men inte körd** | 100 frön × 4000 etiketter: 1 återställning, som inte försämrade modellen. En skadad modell återställs inom 2 block, och en verklig vaneförändring följs utan att rullas tillbaka (§5b). |
| RDP-hantering (frånkoppling, `RemoteSession`, säkert skrivbord) | **Reglerna verifierade, Windows-händelserna ej körda** | 3 koordinatortester (§9). |
| Install-/avinstallationsskript | **Syntaxkontrollerade, ej körda** | PowerShells egen parser (7.4), ingen 7-specifik syntax. |
| Ljudinspelning (WASAPI) och BLE-watcher | **Ingår inte** | Endast gränssnitt och signalbehandling. Se §11. |
| RAM/CPU (< 15 MB / < 0,2 %) | **Ej uppmätt** | Kan inte mätas utan Windows. Mät i piloten. |

Kör hela beviskedjan (Linux eller Windows med Python 3 och .NET 8 SDK):

```bash
./verify/run_all.sh
```

---

## 2. Kravspårning

| Krav | Lösning |
|---|---|
| Windows 10 & 11 | .NET Framework 4.8, som är inbyggt i Win10 1903+ och Win11. Ingen runtime behöver distribueras. Manifest: `asInvoker`, Win10/11, PerMonitorV2. |
| Bakgrund, bara ikon vid klockan | `ApplicationContext` utan fönster. `NotifyIcon` är enda UI. Dimningslagret är klick-genomsläppligt och stjäl inte fokus. |
| Användarprofil per inloggad användare | `%LOCALAPPDATA%\PresenceLock\profile.json`, en per Windows-konto. En instans per session (mutex `Local\PresenceLock-<SID>`). |
| Läge 1: inlärning 15–30 dagar, ingen låsning | Besluten beräknas men är **osynliga**. Ingen dimning och ingen låsning. |
| Lära sig av rätt/fel och korrigera sig | Online-SGD på självgenererade etiketter (§4). |
| Extra sensorer under inlärning, inte förutsatta i läge 2 | Valfria sensorer räknas per episod. I skarpt läge **nollställs** varje valfri feature som inte var tillgänglig i ≥ 50 episoder och ≥ 80 % av dem. Testat (`Enforcing_IgnoresUnconfirmedOptionalSensor`). |
| Bara sensorer utan extra tillåtelse | Kärnan använder musens råinput, `GetLastInputInfo`, förgrundsprocessens **namn** och klockan. Inget av det kräver tillstånd. Tangentbordet registreras **inte** (§10). |
| "Visa låsning": notis, klick = oberättigad | Ballongnotis i inlärningsläget. Klick ger en stark negativ etikett (vikt 2) och räknas emot befordran. Kan bara tillämpas en gång per beslut. Testat. |
| Exportera profil för bred implementation | Tray-meny, CLI (`--export`, `--export-baseline`, `--merge-baseline`), automatisk daglig insamling till en filresurs, och baslinje-seedning för nya användare (GPO). |
| Läge 2 automatiskt vid "säker" nivå, utan att informera | Statistisk grind (§5). Bytet är tyst: ikon, tooltip och meny är identiska i båda lägena. Bytet loggas bara i admin-loggen. |
| Låsa inte mitt i en video eller ett möte, men inte heller hållas öppen av musik | Passiv paus på synlig video (display-required) och på mikrofon/kamera som används av en körande process. Ljud räknas inte som närvaro. Pausen begränsas alltid av backstopet (§6). |
| Lära sig att *betraktande* (tyst arbete) inte är frånvaro | Tystnad i en tyst arbetsapp ger ingen "borta"-etikett förrän det är säkert. Horisonten för säker frånvaro följer den egna modellen, upp till ett admin-tak (§4b). |
| Profil anpassad efter användarens olika mönster under dagen | Per användare: modellen per sammanhang (app, sätt att sluta röra musen), tystnadsprofilen per apptyp och vanejournalen per klockslag och veckodag (§4b, §8). |
| Ständig förbättring även efter 15–30 dagar (Kaizen) | Inlärningen slutar aldrig. Varje ändring jämförs mot den senaste godkända modellen och rullas tillbaka om den blev sämre. Kvaliteten följs i skarpt läge, med händelse 1010 till admin (§5b). |
| Lära sig av vanor (t.ex. aldrig nattetid) som tillägg | Elli-modellerad vanejournal och "utanför arbetstid"-detektor; får bara tidigarelägga en synlig bekräftelse, och först när den bevisat sig (§8). |
| Användaren ska kunna pausa en GPO-styrd maxtid (t.ex. vid avläsning av mätningar), utan att det går att skripta bort | Pausmeny med 3 GPO-styrda längder och en budget per rullande dygn. Pausen hanteras som en video, så NIS2-gränsen `HoldMax` + nådetid gäller fortfarande. Varje paus loggas (§7b). |
| Om-ruta med ansvarig, beskrivning, NIS2-grund och GDPR-information | *Om PresenceLock…* i snabbmenyn (modal ruta) och `--about`. Texten byggs från de principer som gäller, så den kan inte glida isär från beteendet (testat). Ansvarig, personuppgiftsansvarig, kontakt och länk ställs in med GPO. Knappen *Öppna mina data* (art. 15). |
| Underlag för GDPR-, NIS2- och ISO 9001-dokumentationen | Utkast i `docs/compliance/` (§10) |
| Ska inte gå att stänga av (NIS2), styrt via central GPO | `AllowUserExit = 0` som datorprincip, plus guard-tjänsten (§7). |
| GPO-distribution utan certifiering | En fil (`PresenceLock.exe` + `.exe.config`). Kopiering och Run-nyckel via GP Preferences, alternativt startskript. Se §12. |
| Styrning via AD GPO | `deploy/PresenceLock.admx` med sv-SE och en-US: läge, gränser, inlärningsgrind, notis, applistor, sensorer, avslut, export, insamling och baslinje. |

---

## 3. Arkitektur

```
src/PresenceLock.Core/        ren logik, inga OS-anrop (net48 + net8.0)
  PresenceModel.cs            P(borta|x,t), online-SGD, LockTime()
  PresenceEngine.cs           episod-tillståndsmaskin + feedback-hooks
  PresenceCoordinator.cs      hela beslutsflödet: indata > passiv paus > modell, + backstop
  ModeController.cs           inlärning -> skarpt: beslutsunderlag (>= 200 tillfällen på >= 5 dagar) + Wilson-gräns
  ProfileDiagnostics.cs       konsistens- och täckningskontroll av en profil (--diagnose)
  ProfileStore.cs             JSON, atomisk skrivning, export/baslinje/merge, schemamigrering
  TamperProtection.cs         NIS2: process-SDDL, betrodd profil, guardens tillståndsmaskin
  HabitModel.cs, HabitStore.cs  vaneinlärning (Elli-modellerad), egen fil habits.json
src/PresenceLock.App/         Windows-skalet, kompileras till EN exe
  TrayApplicationContext.cs   tunt skal: läser OS-tillstånd, utför koordinatorns åtgärd
  Interop/MessageWindow.cs    WM_INPUT (endast mus) + WTS lås/upplås
  Sensors/                    kinematik, förgrundsapp, tidsprior, passiva OS-signaler, (sonar, BLE)
  Policy/SoftDimOverlay.cs    3 s dimning, WS_EX_TRANSPARENT|NOACTIVATE|TOPMOST
  Settings/PolicyReader.cs    HKLM-policy > HKCU-policy > HKCU-preferens
  Guard/                      LocalSystem-tjänst: startar om agenten, låser vid avbrott, skyddad kopia
  Cli.cs                      --status/--diagnose/--export/--export-baseline/--merge-baseline/--probe-signals/--reset-profile/--lock-now
deploy/                       ADMX/ADML, installations-/avinstallationsskript, task-XML
verify/                       Python-referens, simulering, alla kontroller; analyse_profile.py (exporterad profil, offline)
tests/                        xUnit: enhet + paritet mot den riktiga C#-motorn
```

Motorn och koordinatorn har inga timers och gör inga OS-anrop. Värden matar den med tid, idle-tid och facit. Därför kan exakt samma kod testas utanför Windows.

---

## 4. Modellen och vad den lär sig av

```
z(x,t) = w0 + w·x + λ(x)·t        λ(x) = softplus(u0 + u·x) ≥ 0
P(borta | x, t) = σ(z)
```

`x` är signaturen när inaktiviteten började: scroll-andel, inbromsning, tvärstopp, kantkast, mikroryck, läs-/lämnar-app och tidsprior. `λ` är kontextens hazard. Läskontext lär sig ett litet λ (minuter), avgångssignatur ett stort λ (sekunder).

Startvikterna `w0 = −3,0` och `λ = 0,110` återger exakt kurvan i den ursprungliga simuleringen: **75 % vid 37,3 s och 90 % vid 47,2 s** (uppmätt 37,26 s och 47,25 s). Gradienterna är analytiskt härledda och kontrollerade mot finita differenser med max fel 1,2·10⁻¹⁰.

**Etiketter (inget frågas, användarens beteende är facit):**

| Händelse | Etikett | Var på tidsaxeln |
|---|---|---|
| Win+L (låst ≤ 5 s efter indata) | borta, vikt 2 | vid låsningen |
| Inaktiv ≥ horisonten (180 s, eller den inlärda) i en vanlig app | borta, vikt 1,5 | **vid observerad idle-tid** (censurerad, se nedan) |
| Inaktiv i en *tyst arbetsapp* (läslistan: CAD, PDF, IDE) | **ingen etikett** förrän `HoldMax` (säker frånvaro) | vid observerad idle-tid |
| Windows eget lås (skärmsläckar-GPO) | avgörs vid upplåsningen: ≤ 10 s = närvarande, senare = borta | vid låsningen |
| Indata ≤ 10 s efter (eventuellt osynlig) dimning eller låsning | närvarande, vikt 1 | vid beslutet |
| Skarpt lås, upplåst ≤ 10 s | närvarande, vikt 1 | vid beslutet |
| Skarpt lås, upplåst > 10 s | borta, vikt 1,5 | vid beslutet (den synliga dimningen besvarades inte) |
| Klick på "Visa låsning"-notis | närvarande, vikt 2 | vid beslutet |
| Osynligt beslut + indata *efter* 10 s | **ingen etikett**, men räknas som fel i grinden, utom när tystnadsprofilen med ≥ 90 % säger "borta" (§4b) | — |

### Rättelser till den ursprungliga analysen

1. *"När 25 minuter har passerat vet mjukvaran med 100 % säkerhet att du lämnade vid t = 0."* **Fel.** Man vet bara att användaren var borta vid t = 180 s, inte när hen gick. Om etiketten backdateras till t₀ lär sig modellen att *läsning betyder att gå*. Här labbas observationen censurerat vid den observerade tiden (testet `LongAbsence_IsCensored_…`).
2. *En EMA över fel-andelen som tröskel för "säker".* En brusig EMA som korsar en tröskel är ett first-passage-fenomen. Med tillräckligt många dagar korsar den vilken tröskel som helst. Mätt: en användare med verklig fel-andel 15 % hade "befordrats" 5 492 gånger av en naiv EMA ≤ 10 %-grind. Med Wilson-grinden: aldrig.
3. *Ultraljudssonar och BLE som stealth-sensorer.* Se §11. Mikrofonanvändning tänder Windows integritetsindikator, vilket inte är förenligt med stealth.
4. *"< 15 MB RAM, < 0,2 % CPU"*. Ej belagt. Ska mätas.

---

## 4b. Tyst arbete: betraktande i CAD, och användarens mönster

**Frågan:** en användare ritar i Inventor, sitter sedan och betraktar modellen i 1–8 minuter utan att röra något, ritar igen, läser mejl och går på kaffe. Lär sig appen att betraktandet inte är frånvaro?

**Före v0.5: nej.** All tystnad över 180 s märktes "borta" i inlärningsläget. Varje långt betraktande blev alltså en felaktig etikett, och i skarpt läge dimmade den fasta 180-sekundersgränsen 7 av 10 betraktanden, vecka efter vecka.

**Från v0.5:** etiketterna är bara fakta, och horisonten är inlärd.

1. **Tvetydig tystnad ger ingen etikett.** En tystnad som slutar med att användaren rör datorn igen kan vara betraktande eller ett kort ärende. Ingen tillståndsfri sensor kan skilja dem åt. I appar på läslistan (CAD, PDF, IDE; utökas med GPO `ExtraReadingApps`) blir frånvaro säker först vid `HoldMax`. Ett lås från Windows (skärmsläckar-GPO) avgörs av upplåsningen: inom 10 s betyder att användaren satt där, senare att hen hade gått.
2. **Horisonten följer modellen.** Bekräftelsen "är du kvar?" kommer där användarens egen modell förväntar sig frånvaro i just det sammanhanget, P(borta) = 75 %. Den kommer aldrig före 180 s och aldrig efter admin-taket `MaxLearnedHorizonMinutes` (standard 10 min).
3. **Tystnadsprofilen** (per användare och apptyp, nedräknade räknare med halveringstid 14 dygn, inga tidsstämplar) lär sig hur långa tystnaderna brukar vara. Den kan bara säga "kort = vid datorn, lång = borta" när datat visar två tydligt åtskilda grupper med en verklig dal emellan. För CAD-användaren går betraktandena kontinuerligt över i kaffepauserna, så profilen svarar "kan inte avgöra". För en kontorsläsare (pauser på 30–100 s, avfärder på 5–16 min) svarar den med en gräns på ≈ 200 s. Svaret används **bara** i grindens bokföring av osynliga beslut, aldrig som etikett till modellen.

### Uppmätt: Inventor-användare, 63 dygn, standardinställningar

Användaren ritar 1–5 min, betraktar 1–8 min eller läser mejl 0,5–3 min, tar kaffe 10:00 och 14:30 (8–15 min, varav hälften utan någon "gå"-signal), luncher 11:50 och trycker Win+L vid hemgång.

| | Före v0.5 | v0.5 (frö 3, 7, 11; med och utan notis) |
|---|---|---|
| Felaktiga "borta"-etiketter under inlärning | 537 | **0** |
| Skarpt läge av sig själv | aldrig (övre gräns 50 %) | **dag 21** |
| Betraktanden som dimmas i skarpt läge | 68–72 % per vecka, ingen förbättring | **0,7–1,0 %** |
| Kaffe *med* gå-signal, tid olåst | median 103 s | median 50–74 s |
| Kaffe *utan* signal (ser ut exakt som betraktande), tid olåst | högst 195 s | median ≈ 560 s, **högst 615 s** |
| Skarpa lås på närvarande användare | 0 | 0 |

**Avvägningen sätts av admin med taket.** En avfärd som ser exakt ut som betraktande (användaren reser sig bara) låses senast efter taket plus 15 s. Uppmätt med samma användare: 3 min 68–74 % dimmade / högst 195 s; 5 min 38–47 % / 315 s; 10 min ≈ 1 % / 615 s; 15 min ≈ 0,5–1 % / gräns 915 s (uppmätt 873 s). Det går inte att få både få dimningar och kort tid olåst när de två situationerna ser likadana ut. Det är en egenskap hos datat, inte hos modellen. Avfärder *med* signaler (app som föregår avfärd, tvärstopp) låses inom 1–4 min oavsett tak.

**Mönstren per användare** finns i tre lager:
- vad användaren gör, i modellen (app och hur rörelsen slutade);
- hur länge hen brukar vara tyst i varje apptyp, i tystnadsprofilen;
- när på dygnet hen brukar gå, i vanejournalen (§8).

`--status` visar alla tre. Det som **inte** går att lära sig utan facit är en regelbunden kaffepaus som ser exakt ut som betraktande. Tid på dygnet ensam skiljer dem inte åt, eftersom betraktanden pågår vid samma klockslag.

---

## 5. Befordringsgrinden (inlärning → skarpt läge)

Alla villkor måste vara uppfyllda:
- minst `MinLearningDays` dagar (15);
- minst 30 bekräftade avgångar;
- ett **beslutsunderlag** på minst **200 beslutstillfällen**, fördelade på minst **5 olika dagar**. Ett beslutstillfälle är en inaktiv period där modellen fattade ett beslut, eller som varade minst 30 s utan beslut. Kortare pauser utan beslut är skrivrytm: där fattar ingen modell något beslut, och de räknas bara (`ShortEpisodesIgnored`). Underlaget är det kortaste avsnittet bakåt från det senaste tillfället som uppfyller båda kraven (högst 1000 sparade). Äldre poster behövs aldrig mer och rensas. För en lätt användare blir det 200 tillfällen över två till tre veckor. För en tung CAD-användare blir det tillfällena från de senaste fem arbetsdagarna;
- **Wilson 95 %-övre gränsen** för andelen beslutstillfällen där en närvarande användare skulle ha dämpats eller låsts ≤ `TargetFalsePositivePercent` (10 %);
- högst hälften av de verifierade besluten fel (Wilson-övre gräns ≤ 50 %, sedan 0.7.0).

**Varför (0.7.1, fältprofilen 2026-11-13).** 0.7.0 räknade varje inaktiv period från 2 s. Den första fältprofilen hade 362 sådana på 4–5 timmars användning, och minst 85 % var kortare än 30 s. De 200 senaste täckte alltså cirka 2,7 timmar, inte "≈ 11 arbetsdagar", och felandelen späddes ut ungefär 10 gånger. En modell som i snitt dämpar en närvarande användare en gång per timme gick igenom 0.7.0-grinden dag 15. 0.7.1-grinden släpper inte igenom den (`run_verification.py` 6b och `GateTests.FieldProfile_*`). Simuleringarna saknade korta pauser och hade därför validerat grinden på en fördelning som verkliga användare inte har. Sedan 0.7.1 har alla simuleringar den uppmätta fördelningen: 5–60 s arbete och 2–29 s paus om vartannat.

Når profilen inte grinden efter `MaxLearningDays` (30) tvingas den **inte** över. Den markeras `LearningExtended` och syns i `--status`, `--diagnose` och i exporten. Vid befordran sparas en revisionsspårbar ögonblicksbild: tidpunkt, uppmätt andel, övre gräns och om bytet tvingades av policy. En profil från 0.7.0 eller äldre får sitt fönster nollställt vid första inläsningen (`WindowResets`). Allt inlärt behålls, men befordran och kvalitetsuppföljningen börjar om med ett nytt underlag.

### Uppmätt i simulering (0.7.1, 60 arbetsdagar med uppmätt pausfördelning)

*Separerbar användare:* 10 läspauser (15–100 s), 2 läs-och-gå, 3 avgångar och 2 Win+L per dag. Däremellan aktivt arbete med korta pauser (≥ 85 % av alla episoder är kortare än 30 s, som i fältprofilen).
*Tvetydig användare:* samma, plus 1 närvarande paus per dag med **identisk** signatur som en avgång. Den kan inte skiljas åt med någon sensor, och är där med flit.

| Scenario | Seed | Befordrad dag | Grind vid befordran (andel / övre 95 %) | Verklig andel i skarpt läge (per beslutstillfälle) | Skarpa lås på närvarande | Avgångar låsta < 180 s | Median tid till lås |
|---|---|---|---|---|---|---|---|
| separerbar | 1 | 15 | 4,0 % / 7,7 % | 3,9 % | **0** | 98,7 % | 4 s |
| separerbar | 7 | 15 | 4,5 % / 8,3 % | 4,0 % | **0** | 97,8 % | 4 s |
| separerbar | 42 | 15 | 3,0 % / 6,4 % | 4,0 % | **0** | 98,7 % | 4 s |
| separerbar | 999 | 15 | 5,5 % / 9,6 % | 4,1 % | **0** | 98,2 % | 4 s |
| separerbar | 2024 | 15 | 3,0 % / 6,4 % | 4,0 % | **0** | 97,8 % | 4 s |
| tvetydig | alla 5 | — | ej befordrad (LearningExtended) | — | **0** | — | — |

Observerat i alla 10 körningar, under simulatorns antaganden:
- **Noll skarpa lås på en närvarande användare.** Den synliga 3-sekundersdämpningen fångar alla.
- **Ingen av de korta pauserna (< 30 s) dämpades i skarpt läge.** Kravet är högst 1 %.
- **Varje befordrad profil låg inom målet (≤ 10 %) även i skarpt läge**, mätt per beslutstillfälle precis som i grinden.
- **När signalen inte räcker blir det administratörsgranskning (LearningExtended) i stället för befordran.** I 0.7.0 gick den tvetydiga användaren över i 2 av 5 körningar (dag 51 och dag 15), med verklig andel 8,5–9,2 %. Den låga andelen berodde på att Win+L och korta läsepisoder fanns med i nämnaren. Per beslutstillfälle går det inte att visa med 95 % säkerhet att användaren ligger under 10 %. Den stannar därför i inlärning, och det är grindens avsedda beteende: osäkerhet ska fördröja, aldrig påskynda.

**Vad grinden inte är** (granskningen F16–F18). Wilson-gränsen gäller *ett* underlag. Grinden prövas om vid varje ny episod tills den passerar, och underlagen överlappar medan modellen ändras. Gränsen är därför ingen livslång 95 %-garanti. Kravet på 5 olika dagar gör att en enda lugn eftermiddag inte kan avgöra, men det tar inte bort upprepningen. Etiketterna bygger på beteende (inaktivitet, lås, upplåsningstid), inte på oberoende närvaromätning. Modellens sannolikheter är alltså inte validerade som sannolikhet för fysisk närvaro. Validering med fryst modell och oberoende facit hör till piloten.

Tabellen ovan driver motorn direkt. De 1–5 % avgångar som modellen inte låste före 180 s stod i den versionen **olåsta tills användaren kom tillbaka**. Det var ett säkerhetsfel, och det är rättat av backstopet i §6. Med hela beslutsflödet: 0 återkomster till en olåst dator.

**Simuleringen är syntetisk.** Den bevisar att algoritmen gör det den påstår under kontrollerade förhållanden, inte hur verkliga användare beter sig. Det besvaras av piloten.

---

## 5b. Kaizen: inlärningen slutar aldrig, och varje steg kontrolleras

15–30 dagar avgör bara **när låsningen startar**. Modellen fortsätter att lära sig av varje faktisk etikett så länge agenten körs: varje besvarad dimning, varje obesvarat lås och dess upplåsningstid, varje Win+L. Inlärningstakten är konstant (0,05), så gamla vanor bleknar och nya tar över. Tystnadsprofilen och vanejournalen har halveringstid 14 dygn.

**Mät, justera, kontrollera:**
- **Modellskydd (`ModelGuard`).** Den senaste modellen som visat sig bra sparas. På varje ny etikett bedöms både den och den levande modellen *innan* den levande lär sig av etiketten. Ingen av dem har alltså sett datat. Måttet är log-loss, ett proper scoring rule, så en modell kan inte vinna genom att vara över- eller undersäker. Beslut fattas var 40:e etikett, högst 4 gånger per beslut. Om den levande modellen är sämre med mer än 0,05 nat per etikett **och** z > 2,5 rullas den tillbaka (händelse 1012). Är den minst lika bra blir den ny referens. Är det oavgjort efter 4 block godtas den, eftersom den kan följa en verklig vaneförändring.
- **Kvalitetsuppföljning (`QualityMonitor`).** I skarpt läge kontrolleras grindens mått löpande på samma beslutsunderlag. Larmet gäller den **uppmätta** andelen felaktiga dämpningar per beslutstillfälle. Fram till 0.7.0 gällde det den övre 95 %-gränsen, vilket betyder "inte bevisat bättre" och inte "sämre". Vid 200 simulerade användare och 1000 tillfällen vardera gav den gamla regeln falsklarm för 98 % av användarna med verklig andel 5,5 % och för 28 % vid 3 %. Den nya ger 10,5 % respektive 0 %, och larmar alltid vid ≥ 12 %. Grinden för påslag behåller den övre gränsen, eftersom påslag ska vara bevisat. Den tid datorn stod olåst före varje lås som användaren sedan bekräftade (långsam upplåsning) loggas också, de senaste 50. Över målet ger händelse **1010** till programloggen. Under 80 % av målet ger **1011**. Låsningen stängs **aldrig** av, och profilen degraderas aldrig till inlärningsläge, eftersom det i NIS2-läge vore ett sätt att slå av skyddet.

**Uppmätt.** Kriterierna sattes före körningen.

| Test | Resultat |
|---|---|
| Oförändrad användare, 100 frön × 4000 etiketter | 1 återställning totalt (gräns ≤ 100). Den förbättrade modellen på 2000 osedda etiketter (−0,0033 nat; gräns: får inte försämra > 0,005) |
| Skadad modell (w0 + 12) | återställd inom 2 block (80 etiketter) |
| Verklig vaneförändring (betraktar nu upp till 8 min) | följs och blir ny referens, 0 återställningar |
| Inventor- och kontorsscenarierna med standardinställningar | 0 återställningar, ingen kvalitetsvarning |
| Gamla fasta 180 s-regeln, Inventor | 1 respektive 17 återställningar (utan/med notis) och varning (övre gräns 50 % / 44 %): motstridiga etiketter upptäcks |
| Tak 5 min för Inventor-användaren | varning (29–31 %): taket är för snävt för den användaren, och admin ser det |

Utan Windows har händelseloggen inte provats. Källan `PresenceLock` registreras av installationsskriptet. Vanliga användare får skriva till den men inte skapa den. Om källan saknas skrivs raden bara i `agent.log`.

---

## 6. Passiva OS-signaler: video och möten

**Problemet:** den som tittar på en instruktionsvideo eller lyssnar i ett möte rör inte musen. Utan mer information gör modellen två fel:
1. **Fel etiketter i inlärningen.** "Inaktiv ≥ 180 s" märks som *borta* fast användaren satt kvar. Uppmätt: 79–85 felaktiga etiketter på 60 dagar.
2. **Säkerhetsgrinden luras.** De felaktiga etiketterna räknas som *korrekt bedömda frånvaron*, så profilen befordras ändå (dag 15). I skarpt läge får sedan **90 %** av video- och mötespauserna en dimning.

### Vad Windows faktiskt kan berätta: granskning av förslaget

| Förslag | Bedömning | Belägg |
|---|---|---|
| Power request `DisplayRequired` | **Används.** Chromium håller video-wake-lock bara när videon spelas, sidan är synlig och videon är synlig och stor nog, hörbar eller en MediaStream. Minimerat fönster eller bakgrundsflik släpper den. | [video_wake_lock.cc](https://chromium.googlesource.com/chromium/src/+/main/third_party/blink/renderer/core/html/media/video_wake_lock.cc) |
| ... läst via `powercfg /requests` | **Kräver admin.** Den enda dokumenterade läsningen utan admin är aggregatet `CallNtPowerInformation(SystemExecutionState)`. Dokumentationen säger inte om den inkluderar andra processers `PowerSetRequest`. **Overifierat**, kontrollera med `--probe-signals`. | [CallNtPowerInformation](https://learn.microsoft.com/en-us/windows/win32/api/powerbase/nf-powerbase-callntpowerinformation) |
| GSMTC `PlaybackType` Video vs Music | **Används inte.** Chromium rapporterar alltid `MediaPlaybackType_Music`, även för video. YouTube i Chrome eller Edge går därför inte att skilja från Spotify. | [system_media_controls_win.cc](https://chromium.googlesource.com/chromium/src.git/+/main/components/system_media_controls/win/system_media_controls_win.cc) |
| ConsentStore `LastUsedTimeStop == 0` = mikrofon/kamera aktiv | **Används, med skydd.** Den är odokumenterad, och betydelsen av 0 är härledd, inte specificerad. En post räknas bara om ägarprocessen **körs** (en krasch kan lämna en gammal nolla kvar). Appar som alltid håller mikrofonen öppen kan undantas via GPO. | [elevenforum](https://www.elevenforum.com/t/clear-microphone-last-accessed-history-in-windows-11.8831/) |
| Mikrofon aktiv ⇒ "spärra låsning helt" | **Avvisat.** Att ansluta till ett möte och gå därifrån är vanligt. Pausen är alltid tidsbegränsad. | logik |
| GPU `VideoDecode` + PID → fönster | **Används inte.** Chromium avkodar i sin GPU-process, inte i den process som äger fönstret. Drivrutinen kan kalla motorn `VIDEO_DECODE` eller `VIDEO_CODEC`. Många VM saknar GPU. En CAD-animering är 3D-arbete, inte videoavkodning. | [DXGK_ENGINE_TYPE](https://learn.microsoft.com/en-us/windows-hardware/drivers/ddi/d3dkmdt/ne-d3dkmdt-dxgk_engine_type) |
| Ljudnivå per process (WASAPI) | **Används inte.** Ljud är inte närvaro, eftersom musik fortsätter spela under lunchen. Förslagets egen tabell (rad 5) ignorerar det också. | logik |

### Konstruktionen (`PresenceCoordinator`)

Varje sekund, i prioritetsordning:
1. **Indata** (idle < 1 s): användaren är här. Det som väntade avgörs: dimning, prob eller backstop.
2. **Passiv paus:** möte (mikrofon eller kamera hos en körande process) eller synlig media (display-required). Modellen pausas, och den pågående episoden **kasseras utan etikett**. När pausen slutar medan användaren fortfarande är inaktiv startar en ny episod med klockan från pausens slut. Den flaggas `PostHold`, kinematiken nollas (den är minuter gammal), och modellen lär sig en egen latens för "efter videon".
3. **Den inlärda modellen** beslutar som tidigare.

Plus en **absolut backstop** som gäller över alla tre lagren. Detta gäller i skarpt läge:
- När horisonten för säker frånvaro nås utan lås visas en **synlig** bekräftelsedimning. Horisonten är 180 s, eller längre där modellen lärt sig tyst arbete, högst `MaxLearnedHorizonMinutes` (§4b). Ett svar ger en sann etikett "närvarande". Inget svar inom `ConfirmGraceSeconds` ger låsning.
- När `HoldMaxMinutes` inaktivitet nås, oavsett signaler och modell, visas samma bekräftelse.
- **Låsning *begärs* senast vid `HoldMax` + grace efter senaste indata.** Egenskapstestet kör 500 slumpade modeller med slumpmässigt fladdrande signaler, och gränsen håller i alla. Säkerhetsgolvet gäller också utan pågående modellepisod.
- **En begäran är inte ett lås** (sedan 0.7.0). Låset räknas som genomfört först när Windows skickar sessionshändelsen *låst*, eller när sessionen kopplas från. Saknas kvittensen inom 10 s, eller avvisas anropet, begärs låsning igen (efter 15 s vid avslag). Efter 3 obekräftade försök kopplas sessionen från (`WTSDisconnectSession`). Alla tider mäts på inaktivitetsaxeln, så en ändrad klocka kan inte förlänga dem. Kommer användaren tillbaka innan något har bekräftats räknas tiden som exponering. Tiden till ett *verifierat* säkrat skrivbord mäts i Windows-acceptansen (W01).

I inlärningsläget visas ingenting (kravet: ingen låsning). Pausen stoppar ändå de felaktiga etiketterna.

### Uppmätt (60 dagar, 3 seeds; användaren ser 3 videor (4–25 min), sitter i 1 möte, och går 1 gång från en video som fortsätter spela och 1 gång från ett pågående möte per dag)

Kraven sattes före första körningen:

| | Utan signaler | Med passiv paus (15 min) |
|---|---|---|
| Felaktiga "borta"-etiketter medan användaren satt kvar | 79–85 | **0** |
| Video- och mötespauser som fick en dimning (skarpt läge) | 90–92 % | **30–33 %** |
| Skarpa lås på närvarande användare | 0 | 0 |
| Avgångar utan media: längsta olåsta tid | ≤ 185 s | ≤ 184 s |
| Alla avgångar: längsta olåsta tid | 185 s | **831–846 s** (≤ 917 s-gränsen) |
| Återkomst till olåst dator | 0 | 0 |

**Avvägningen** (seed 7), som admin styr med `HoldMaxMinutes`:

| `HoldMax` | Dimningar under video/möte | Längsta obevakade tid |
|---|---|---|
| inga signaler | 90 % | 184 s |
| 3 min | 90 % | 184 s |
| 5 min | 74 % | 238 s |
| 10 min | 49 % | 531 s |
| **15 min** | **30 %** | **831 s** |
| 20 min | 13 % | 1 096 s |

Med kort `HoldMax` försvinner störningsvinsten. Vinsten för inlärningen (inga felaktiga etiketter) finns kvar oavsett `HoldMax`. 15 min matchar den vanliga riktlinjen på 900 s för maskininaktivitet.

### Verifiera signalerna på målmaskinen

```bash
PresenceLock.exe --probe-signals 120
```

Kontrollera följande:
- **YouTube synligt:** `DisplayRequired True`.
- **Minimera eller byt flik:** `False`.
- **Teams-samtal:** en `claim microphone` med `running=True`, och `hold = Meeting`.
- **Avsluta samtalet:** ingen claim.

Visar `DisplayRequired` aldrig `True` under video är aggregatet inte användbart på den maskinen. Då gör media-pausen ingenting och modellen beter sig som förut. Visar den alltid `True` (till exempel PowerToys Awake) hålls varje paus till backstopet. Det syns som ett högt `hold starts` i `--status`, och då ska `MediaHoldEnabled` stängas av.

---

## 7. Centralt skyddat läge (stöd för NIS2): manipulationsskydd

**Hotmodell:** en vanlig användare *utan* lokal adminrätt som vill att datorn ska stå olåst. Lokala administratörer och fysiska attacker ligger per definition utanför.

**Aktivering** (två delar, båda centralt):
1. **Datorprincip:** PresenceLock → Administration → *Tillåt användaren att avsluta agenten* = **Inaktiverad** (`AllowUserExit = 0`). Den ska sättas som *dator*principen, eftersom guard-tjänsten bara läser den.
2. **Guard-tjänsten:** startskriptet med `-Guard` (§12, alternativ B). GP Preferences kan inte skapa tjänster.

| Sätt att lämna datorn olåst | Utan NIS2-läge | NIS2-läge | Mekanism | Belägg |
|---|---|---|---|---|
| "Avsluta" i menyn | möjligt | borttaget | GPO | kompilerad |
| Aktivitetshanteraren, `taskkill /f`, `Stop-Process` | möjligt | **åtkomst nekad** | Processens egen DACL: användaren och `OWNER RIGHTS` får bara `SYNCHRONIZE \| QUERY_LIMITED`. `OWNER RIGHTS` tar bort ägarens implicita rätt att skriva om DACL:en | SDDL enhetstestad; effekten provas på Windows |
| `WM_QUIT` / `WM_CLOSE` från ett eget program | agenten avslutas | meddelandeloopen startar om | `Program.cs` | kompilerad |
| Agenten dör ändå (krasch, admin-verktyg) | olåst | **låsning begärs inom ≈ 4 s** (1001) och upprepas tills Windows rapporterar sessionen låst (1008). Annars kopplas sessionen från (1007). Agenten startas om | guard-tjänst (LocalSystem) | tillståndsmaskinen enhetstestad (T05) |
| Agenten hänger (UI-tråden svarar inte) | olåst | samma som ovan när hjärtslaget är äldre än 60 s | hjärtslag i HKCU, guarden | enhetstestad |
| Agenten blir aldrig frisk efter inloggning eller upplåsning (trasig installation, ockuperad mutex) | olåst | låsning begärs efter 120 s (fail-closed) | guard-tjänst | enhetstestad (T06) |
| En CLI-instans av samma exe (`--probe-signals`) som "agent" | — | räknas inte: guarden läser processens kommandorad (agentroll) | `ProcessInfo` | kompilerad |
| Skriva säkerhetsvärden i den egna policygrenen (HKCU\Software\Policies) | — | **ignoreras**: skyddsrelevanta värden läses bara från datorpolicyn | `PolicyScope` | enhetstestad (T07) |
| Autostart avstängd | ingen agent | guarden startar den | guard-tjänst | enhetstestad |
| Egen kopia döpt till `PresenceLock.exe` för att lura guarden | — | räknas inte | guarden kräver exakt avbildssökväg i `Program Files` | kompilerad |
| Radera `profile.json`, ändra `Mode` till `Learning`, nollställa inlärningsklockan | 15+ dagar utan lås | **återställs** från skyddad kopia | `ChooseTrusted` + monoton `AcceptIntoProtected` | enhetstestad |
| Ändra policyfält i `profile.json` (trösklar, horisont, `MinLearningDays`, inlärningstakt) | verkar | **ignoreras**: läses alltid från GPO eller standard | `ResetPolicyFields` | enhetstestad |
| Ändra de inlärda vikterna | — | begränsat av backstopet: ≤ `MaxLearnedHorizonMinutes` + grace (10 min 15 s som standard; före v0.5 3 min 15 s), eller `HoldMax` + grace. Sätt taket till 3 för den gamla gränsen | `PresenceCoordinator` | egenskapstestad (500 slumpade modeller), taket enhetstestat |
| `PresenceLock.exe --reset-profile` | möjligt | kräver **eleverad administratör** | `Cli.cs` | kompilerad |
| Plantera egna "skyddade" kopior | — | omöjligt: lagret ligger i `%ProgramFiles%\PresenceLock\state`, inte i `%ProgramData%` där vanliga användare får skapa mappar | `ProtectedStore` | — |
| Stoppa guard-tjänsten | — | kräver admin (Windows standard-DACL för tjänster) | Windows | — |

**Händelselogg för SIEM** (Application, källa `PresenceLock`):

| ID | Betydelse |
|---|---|
| 1000 | guard startad |
| **1001** | agenten försvann ur en olåst session, sessionen låstes |
| 1002 | ändring av en profil som skulle ha nedgraderat den nekades |
| **1003** | **låsning misslyckades** |
| 1004 | agenten kunde inte startas |
| **1009** | **guard stoppad** (kräver admin) |

### Vad som återstår, och kräver ert beslut

1. **Injicerad indata.** Det är det största hålet i *all* tvingad låsning, även i er nuvarande skärmsläckarprincip: Windows räknar injicerade musrörelser och tangenttryck som aktivitet.
   - *Mjukvaru-musjigglers* (`SendInput`) går att upptäcka, eftersom injicerad musindata har `hDevice = NULL` i rå indata. Men hjälpmedel (ögonstyrning, röststyrning, skärmtangentbord) och fjärrsupport injicerar också. Det kräver en vitlista, annars låses personer med funktionsnedsättning ute.
   - *"Håll vaken"-verktyg som skickar tangenttryck* (t.ex. F15 var 59:e sekund) går bara att upptäcka om agenten registrerar tangentbordet för rå indata. Det räcker att läsa *enhetshandtaget*, aldrig tangentkoder. Det är ändå just det mönster jag valde bort av integritets- och EDR-skäl (§10).
   - *USB-hårdvarujigglers* ser ut som en riktig mus. Bara beteendeanalys (periodiska mikrorörelser utan annan aktivitet) kan avslöja dem.
2. **Inlärningsperioden (≥ 15 dagar) låser inte**, enligt kravspecifikationen. Er skärmsläckarprincip (15/30/60 min) är golvet under den perioden, så **behåll den**. Vill ni att agenten låser från dag 1: `ModePolicy = 2` tillsammans med `BaselineProfilePath` från en pilotgrupp.
3. **Felsäkert läge** (nås från inloggningsskärmen via Skift + Starta om): varken agent eller tjänst startar. Skärmsläckarprincipen gäller fortfarande.
4. **Pausen vid video eller möte** lämnar datorn olåst i upp till `HoldMax` + grace efter en avgång (§6). Det är inställbart.
5. **Den skyddade kopian synkas var 60:e sekund.** Ett fönster på högst en minut efter en befordran är inte täckt.

---

## 7b. Användarpaus: GPO-styrd, budgeterad, och inte värd att skripta

**Behovet:** att kunna läsa av skärmen länge utan att röra något, till exempel när mätningar loggas. **Risken:** en användare som låter AutoHotkey starta om pausen hela tiden.

**Konstruktionen:**
- **Snabbmenyn** har *Pausa* med upp till tre längder från GPO (standard 30, 60 och 90 min). Där visas också hur mycket budget som finns kvar och när ett nedtonat alternativ blir tillgängligt igen.
- **Pausen hanteras som en video som spelar.** Den inlärda modellen dimmar och låser inte, och inget lärs av tystnaden. Bekräftelsen "är du kvar?" efter `HoldMax` (15 min) **gäller fortfarande**, så en dator som lämnas under en paus låses inom `HoldMax` + nådetid. Det är samma gräns som i §6. NIS2-gränsen ändras alltså inte av att pausen finns. Admin kan välja fullständig paus (`PauseKeepsConfirmation = 0`). Då gäller bara Windows egna låsinställningar under pausen, och efter pausen låses en obevakad dator inom nådetiden.
- **Budget per rullande 24 timmar** (standard 120 min), hur pausen än delas upp eller startas om. En vald paus **debiteras fullt när den startar**. Att avsluta i förtid slår på skyddet igen men återbetalar inget, eftersom en återbetalning inte går att skilja från en redigerad fil.
- **Budgeten går inte att återställa.** Den lagras i profilen, så omstart och ny inloggning hjälper inte. I NIS2-läge slås den ihop med guardens skyddade kopia, och en sammanslagning kan bara *lägga till* debiterad tid. Att radera eller korta poster i filen ger därför ingenting.
- **Varje paus loggas** i programloggen: händelse **1015** när den startar (användare, längd, budget kvar) och **1016** när den slutar. De spärras aldrig, och budgeten begränsar antalet till ett fåtal per dygn. En användare som tömmer budgeten varje dag syns i SIEM.
- **Windows egna inställningar för skärmsläckare och inaktivitetslås påverkas inte.** Gäller er 15-minutersskärmsläckare på en mätdator låser Windows den ändå efter 15 min utan aktivitet. Mätdatorer behöver alltså ligga i en grupp med längre tid där.

**Varför den inte är värd att skripta.** Ett skript i användarens session har samma rättigheter som användaren. Det kan klicka i menyn precis som användaren, och ingen app i samma session kan skilja ett skriptat klick från ett riktigt på ett tillförlitligt sätt. Flaggor för injicerad indata finns, men hjälpmedel som skärmtangentbord och taligenkänning använder samma mekanism, och att blockera dem skulle stänga ute användare med funktionsnedsättning. Konstruktionen gör därför missbruk *meningslöst* i stället för att försöka upptäcka det: ett skript kan bara förbruka budgeten, aldrig förlänga den, och pausen håller fortfarande gränsen `HoldMax` + nådetid. Den som vill kringgå all låsning kan redan i dag använda en musjiggler, i mjukvara eller som hårdvara. Det gäller varje inaktivitetsbaserat lås, även Windows eget, och är en policyfråga snarare än en teknisk fråga (§13).

**Uppmätt (`UserPauseTests`).** Kriterierna sattes före körningen.

| Scenario | Resultat |
|---|---|
| Skript försöker starta 90/60/30 min varje minut i 7 dygn | 26 pauser; värsta 24-timmarsfönster **120 min = budgeten** |
| Skript startar 30 min och avslutar direkt, varje minut | värsta fönster **4 min**: varje start debiterar 30 |
| Slumpvisa längder | värsta fönster 120 min |
| Går från datorn i början av en 90-minuterspaus | låst efter **915 s** (`HoldMax` 900 + 15). Utan paus: 48 s |
| Fullständig paus på 30 min (policy), ingen vid datorn | låst efter **1815 s**: nådetiden efter pausens slut |
| 25 min tystnad under paus i inlärningsläge | 0 etiketter, modellen oförändrad |
| Pausen raderas ur filen | sammanslagningen med skyddad kopia återställer debiteringen (30 av 120 min kvar) |

---

## 8. Vaneinlärning (modellerad efter Elli Companion)

**Fråga:** kan användarens rutiner, till exempel *"arbetar aldrig nattetid"*, göra låsningen träffsäkrare?

**Utgångsläge:** *YouTube igång och användaren åker hem* var redan begränsat. Backstopet (§6) låser senast `HoldMax` + grace (15 min 15 s) efter senaste indata, dag som natt. Vanorna kan alltså bara korta **de första 15 minuterna**.

### Vad som är hämtat från Elli

Hämtat från Elli Companions `IdleForecast` / `IdleForecastEvidence`:
- **Episodjournal med intervall.** Varje inaktiv period lagras som [nedre, övre] längd, och slaget är avgränsad, högercensurerad eller exkluderad. Censurering görs aldrig om till en observerad händelse.
- **Lokal tid från UTC-offset vid episodens start**, vilket gör den säker vid sommartid.
- **Kärnvikter:** recency med halveringstid 14 dygn över 42 dygn, cirkulär klockdistans med triangulär kärna (±2 h).
- **Viktat empiriskt överlevnadsintervall.** Modellen ger en *nedre och övre* sannolikhet utan imputering och utan antagande om oberoende censurering.
- **Tillräcklighetskrav:** Kish effektivt N, andel användbara episoder, och ett uttryckligt policyavdrag på 0,1.
- **Prekventiell självutvärdering:** bedömningen är bestämd innan utfallet är känt.

### Avvikelser från Elli, med motivering och mätning

| | Elli | PresenceLock | Varför |
|---|---|---|---|
| Veckodagskärna | samma dag 1, intilliggande 0,25 | samma dag 1, **samma dagtyp** (vardag/helg) 0,5, annars 0 | Ellis kärna behandlar söndag som "nästan måndag". För kontorsnärvaro delar mån–fre rutin, inte helgen. |
| Minsta effektiva N | 20 | **10** | En hemgång sker en gång per dag. Sex måndagar på 42 dygn med halveringstid 14 dygn ger N ≈ 4,5, så N ≥ 20 kan *aldrig* nås. Med poolade vardagar blir N ≈ 19 (uppmätt 18,7). Åtgärden är bara en synlig bekräftelse, och en andra grind gäller (nedan). |
| Exkluderade episoder | datakvalitetsproblem, räknas mot andelsgrinden | video, möte och UAC är en **egen kategori (`Hold`)** som inte räknas mot grinden | Utan detta spärrades alla prognoser: andelsgrinden var 68 % mot kravet 80 %, eftersom 32 % av journalen var video och möten. Det är en definition ("närvaro okänd"), inte dålig data. |
| Poängsättning | prognos fryses live | **kontrafaktiskt** vid episodens slut: vid vilken ålder *skulle* bedömningen ha slagit till, med samma deterministiska funktion av data före episoden | Live-frysning svalt ihjäl grinden. Modellen låser en avgång efter ≈ 5 s, innan vanan (ålder ≥ 60 s) hinner bedöma, och en videoepisod kan inte poängsättas utan att agera. Uppmätt: 0–1 poäng på 70 dygn, mot 82–86 efter rättningen. |
| Tillägg | — | **"utanför arbetstid"-detektor:** aktivitetstakt per veckodag × timme relativt användarens egen topp (≤ 2 % ⇒ utanför) | Den betingar på episodens *start*, så Ellis modell har inga data om timmar då användaren aldrig börjar en paus. Det var exakt ditt exempel. |

### Säkerhetsregel: vanor kan bara tidigarelägga, aldrig låsa

- En vanebedömning ("användaren är sannolikt borta i ≥ 10 min") får bara visa den **synliga bekräftelsedimningen**, tidigast efter `HabitEarlyConfirmMinutes` (2 min). Lås följer bara om ingen svarar inom nådetiden.
- Modellen fortsätter besluta under tiden, så vanan kan aldrig *fördröja* ett lås. Det är rättat: min första konstruktion hade kunnat fördröja med upp till 15 s.
- Vanorna agerar först när deras bedömningar **visat sig träffsäkra på den egna användaren**: minst 20 bedömningar och Wilson 95 %-nedre gräns för träffsäkerheten ≥ 70 %. Fram till dess körs de i skuggläge.
- **Egenskapstest:** 300 parade körningar med identisk indata och slumpade modeller och signaler. Med vanor kom låset **aldrig senare** (108 av 300 kom tidigare), och varje vane-lås föregicks av en synlig dimning med full nådetid.

### Uppmätt: 70 dygn kontorsrutin, 3 seeds, skarpt läge från dag 21, passiva signaler på i båda varianterna

Rutinen: lunch ≈ 11:30–12:00, hemgång ≈ 16:30–17:30 (var tredje dag med video igång), sent arbete var tionde dag, helger lediga. Kraven sattes före körning: 0 skarpa lås på närvarande, exponering ≤ `HoldMax` + grace, och vane-dimningar på närvarande ≤ 5 %. **Alla uppfyllda.**

| Avgångstyp (median olåst tid) | Utan vanor | Med vanor |
|---|---|---|
| Sent på kvällen, video igång | 915 s | **135 s** |
| Hemgång ≈ 17:00, video igång | 915 / 915 / 915 s | 652 / 915 / 915 s |
| Lunch, video igång | 915 / 791 / 915 s | 860 / 791 / 886 s |
| Raster, vanlig hemgång, lunch utan video | oförändrat (≈ 5 s) | oförändrat |
| Vane-dimningar på närvarande användare | — | 9 / 12 / 9 av 701 pauser (≈ 1,5 %) |
| Vanornas träffsäkerhet (Wilson-nedre) | — | 90 % (81 %) / 84 % (75 %) / 89 % (80 %) |

**Slutsats:**
- Vanor ger **stor effekt när användarens mönster är tydligt avvikande**, till exempel en avgång vid en tid då hen aldrig brukar vara aktiv.
- Vid **vanlig hemgångstid är effekten liten**. De första minuterna av en hemgång kl. 17 ser ut som en kafferast kl. 16:45, och det är en egenskap hos datat. Ingen modell kan skilja dem åt utan fler signaler.

### Integritet

Journalen är en **närvarotidslinje** (starttid och längd på varje paus ≥ 60 s, 42 dygn):
- Den ligger i en egen fil, `%LOCALAPPDATA%\PresenceLock\habits.json`.
- Den **exporteras aldrig**, **samlas aldrig in** till admin-resursen och **kopieras aldrig** till guardens skyddade lagring.
- Att radera den kan bara ta bort accelerationen, aldrig sänka skyddet under policyn.
- GPO `HabitLearningEnabled = 0` stänger av insamlingen.
- Den ska med i er konsekvensbedömning (DPIA).

---

## 9. Fjärrskrivbord (RDP)

**Ändrat i koden** (du kör just nu via RDP, så det här berör direkt det du testar):

| Vad | Före | Nu |
|---|---|---|
| RDP-klienten stängs eller nätet faller (`WTS_REMOTE_DISCONNECT`) | Hanterades inte. Inaktiviteten växte, en censurerad "borta"-etikett sattes och backstopet försökte låsa en frånkopplad session. | Behandlas som **säkert tillstånd**: ingen etikett (att stänga ett RDP-fönster säger inget om att lämna skrivbordet), inga beslut. Återanslutning återupptar. Låsning *under* frånkoppling kräver den riktiga upplåsningen. |
| Konsol eller RDP i samma profil | Blandades | Ny feature `RemoteSession` (schema v3) gör att modellen lär sig separata nivåer. Kinematiken nollställs vid återanslutning. |
| UAC-dialog eller säkert skrivbord (Ellis `OpenInputDesktop`-kontroll) | Inaktiviteten tolkades som frånvaro | Paus (`SecureDesktop`), alltid begränsad av backstopet |
| Absoluta muskoordinater (RDP, VM) | Hanterat redan tidigare | Oförändrat |
| Guard-tjänsten | Hanterar RDP-sessioner (`WTSActive`) | Reservlösningen `WTSDisconnectSession` kopplar ner RDP-klienten, som då måste autentisera igen |

**Att ta hänsyn till (konfiguration, inte kod):**
1. **Den fysiska risken finns vid klienten.** PresenceLock i RDP-sessionen låser *fjärr*sessionen. Datorn användaren sitter vid måste låsas för sig: med PresenceLock om den är hanterad, och om det är en ohanterad hemdator är fjärrsessionens lås det enda skydd ni har.
2. **Sparade RDP-inloggningar** gör att vem som helst vid en olåst klient kan återansluta utan lösenord. Sätt *"Do not allow passwords to be saved"* (klient) och *"Always prompt for password upon connection"* (värd).
3. *"Set time limit for active but idle Remote Desktop Services sessions"* kompletterar som en klassisk spärr för inaktiva RDP-sessioner.
4. **Dina tester körs nu över RDP.** Kinematiken skiljer sig: absoluta koordinater och lägre takt. Upprepa piloten vid konsolen.
5. **Overifierat, kontrollera med `--probe-signals`:**
   - Registreras omdirigerad mikrofon i ConsentStore på värden?
   - Håller RDP-klienten (`mstsc`) `DisplayRequired` på *klienten* medan den är ansluten? Om ja, och PresenceLock körs på klienten, får varje paus där en mediapaus ända till `HoldMax`.
   - Ser RDP-indata injicerad ut (`hDevice = NULL`)? Det måste vara klarlagt innan jiggler-detektering (§7) aktiveras, annars låses RDP-användare ut.

---

## 10. Integritet: vad agenten ser och inte ser

- **Mus:** relativ rörelse, hjul och tidpunkter i ett 3-sekunders RAM-fönster. Endast den sista markörpositionen används (för kantdetektering). Ingenting av detta sparas.
- **Tangentbord:** **registreras inte.** Tangentbordsaktivitet syns bara som "inte inaktiv" via `GetLastInputInfo`. Det finns ingen kodväg som kan se tangenttryck. En bakgrundsprocess som tar emot rå tangentbordsinput är det klassiska keylogger-mönstret, och det undviks medvetet.
- **Förgrundsapp:** endast **processnamnet** (`inventor`), aldrig fönstertitel eller innehåll.
- **Passiva signaler:** ConsentStore-posternas app-sökvägar och de körande processernas avbildsnamn läses i minnet för att avgöra om en mikrofon- eller kamerapost är levande. De sparas aldrig. Profilen får bara räknare (`HoldStarts`, `HoldProbes` …), inga appnamn och inga tider.
- **Kamera:** används inte. Den tänder lysdioden och integritetsindikatorn, och det skulle vara biometriknära personuppgifter.
- **Profil:** 11+11 vikter, räknare och 200 bitar utfall. Testet `Json_ContainsNoContent_…` vaktar detta.
- **Loggen** (`agent.log`): start, stopp, lägesbyten och fel. Inget om användarens aktivitet.

### Juridik (faktaunderlag, inte juridisk rådgivning)

**Utkast till Elhos dokumentation finns i [`docs/compliance/`](docs/compliance/00-LAS-FORST.md)**, även som Word-filer i paketet: dataskyddsbeskrivning (art. 13), registerpost (art. 30), intresseavvägning (art. 6.1 f), DPIA (art. 35), samarbete med personalen, NIS2-åtgärdsbeskrivning och ISO 9001-underlag. Öppna punkter är märkta `[[…]]` och **VERIFIERA**.

**Finland** (kontrollerat mot primärkällor):
- **Cybersäkerhetslagen 124/2025**, i kraft 8.4.2025, genomför NIS2. 9 § kräver proportionella riskhanteringsåtgärder. Traficoms rekommendation (kap. 6, 7, 11 och 12) är grunden i åtgärdsbeskrivningen.
- **Lagen om integritetsskydd i arbetslivet 759/2004 21 §**, i lydelsen enligt 945/2025 (i kraft 1.1.2026): syftet med, införandet av och metoderna för teknisk övervakning av arbetstagare ska behandlas i dialog enligt samarbetslagen 1333/2021. Företag utanför samarbetslagen ska höra arbetstagarna före beslut. **Om-rutan och dokumenten ersätter inte den dialogen.**

Profilen är kopplad till en SID och beskriver en anställds beteende. Det är **personuppgifter** (GDPR art. 4.1).

- **Informationsplikt (art. 13)** gäller oavsett att appen är "stealth". Det tysta lägesbytet är ett UX-val och fungerar som det ska, men verktygets existens och syfte måste framgå av arbetsgivarens information eller IT-policy.
- **Konsekvensbedömning (art. 35):** systematisk övervakning av anställda uppfyller två kriterier i EDPB:s riktlinjer (WP248: systematisk övervakning + sårbara registrerade). Då krävs normalt en DPIA.
- **Insamlingsresursen** innehåller personuppgifter. Ge användare skrivrätt men inte läsrätt, och läsrätt bara för admin.

Designen hjälper vid bedömningen: lokal lagring, inget innehåll, inget tangentbord, ingen kamera och ett tydligt avgränsat ändamål (låsa den egna skärmen).

---

## 11. Valfria sensorer: ärlig status

| Sensor | I den här versionen | Fakta som avgör användbarhet |
|---|---|---|
| 20 kHz ultraljud (Doppler) | Goertzel-DSP och Doppler-logik finns och är verifierade. **Ljudinspelning finns inte.** `IAudioCaptureBackend` måste kopplas in (NAudio WASAPI rekommenderas). | Windows 11 visar mikrofonindikatorn, vilket inte är stealth. Sekretessinställningen "Tillåt skrivbordsappar att komma åt mikrofonen" måste vara på. Många bärbara har AGC eller lågpass under 20 kHz. Kräver 48 kHz. En kontinuerlig 20 kHz-ton kan höras av vissa och störa djur. |
| BLE RSSI | Logiken finns. **WinRT-watcher finns inte.** | RSSI är brusigt. Kan bara bli en svag bidragsgivare, aldrig en utlösare. |

Båda är **avstängda som standard**. Utan inspelning markeras de otillgängliga, och då kan skarpt läge aldrig bero av dem.

---

## 12. Bygga och distribuera via GPO

### Bygga (Windows)

```bash
dotnet build src/PresenceLock.App -c Release
```

Utdata: `src/PresenceLock.App/bin/Release/net48/PresenceLock.exe` och `PresenceLock.exe.config`. Visual Studio 2019+ eller Build Tools fungerar också. `.pdb` behöver inte distribueras.

### Alternativ A: ren GPO, inga skript (rekommenderas)

1. Lägg `PresenceLock.exe` och `PresenceLock.exe.config` i `\\<domän>\NETLOGON\PresenceLock\`.
2. Central Store: `deploy\PresenceLock.admx` → `\\<domän>\SYSVOL\<domän>\Policies\PolicyDefinitions\`, och `deploy\en-US\` och `deploy\sv-SE\` → motsvarande undermappar.
3. Skapa ett GPO och länka det till datorernas OU.
   - **Datorkonfiguration → Inställningar → Windows-inställningar → Filer**: Åtgärd *Uppdatera*, källa `\\<domän>\NETLOGON\PresenceLock\PresenceLock.exe`, mål `C:\Program Files\PresenceLock\PresenceLock.exe`. Upprepa för `.exe.config`.
   - **Datorkonfiguration → Inställningar → Windows-inställningar → Register**: *Uppdatera*, `HKEY_LOCAL_MACHINE\SOFTWARE\Microsoft\Windows\CurrentVersion\Run`, värde `PresenceLock` (REG_SZ) = `"C:\Program Files\PresenceLock\PresenceLock.exe"`.
   - **Datorkonfiguration → Principer → Administrativa mallar → PresenceLock**: konfigurera.
4. Uppdatering: byt filen i NETLOGON. Om exe-filen är låst av en körande agent kopieras den vid nästa omstart.

### Alternativ B: startskript

Datorkonfiguration → Principer → Windows-inställningar → Skript → Start → fliken *Skript*:

```
powershell.exe -NoProfile -ExecutionPolicy Bypass -File \\<domän>\NETLOGON\PresenceLock\Install-PresenceLock.ps1
```

Skriptet är idempotent (kopierar bara vid ändrad hash), kontrollerar .NET 4.8 och registrerar Run-nyckel eller schemalagd uppgift (`-Autostart Task`, som startar om vid krasch). **För NIS2-läget, lägg till `-Guard`:** då installeras tjänsten *PresenceLock Guard* (LocalSystem, automatisk start, citerad sökväg, omstart vid fel). Dessutom skapas den skyddade lagringen och händelsekällan. Avinstallation: `Uninstall-PresenceLock.ps1 [-RemoveUserProfiles]`.

### "Utan certifiering": var det håller och var det inte gör det

- **SmartScreen:** kontrollerar filer med Mark-of-the-Web. Filer som kopieras via SMB eller GPO får det inte, och skriptet kör dessutom `Unblock-File`.
- **AppLocker:** standardreglerna tillåter `%ProgramFiles%\*`.
- **WDAC med signaturkrav:** blockerar. Då är signering organisationens eget krav, och en intern AD CS-signatur räcker.
- **Defender/EDR:** en osignerad binär med låg spridning som tar emot rå musinput och anropar `LockWorkStation` kan flaggas heuristiskt. Testa i piloten. Om den flaggas: tillåt via hash eller sökväg (indicator), alternativt intern signering.

### GPO-inställningar (`HKLM\SOFTWARE\Policies\PresenceLock`)

Sedan 0.7.0 är alla principer **datorprinciper**. Agenten läser skyddsrelevanta värden bara från HKLM. Ett värde i användarens egen gren (`HKCU\Software\Policies\PresenceLock`) ignoreras, med ett undantag: `ShowLockNotification`, som är en användarpreferens. Policyn läses om var 5:e minut i en körande agent.

| Värde | Typ | Standard | Betydelse |
|---|---|---|---|
| `ModePolicy` | DWORD 0/1/2 | 0 | Automatiskt / tvinga inlärning / tvinga skarpt |
| `SoftDimThresholdPercent` / `LockThresholdPercent` | DWORD | 75 / 90 | Beslutsgränser |
| `MinLearningDays` / `MaxLearningDays` | DWORD | 15 / 30 | Inlärningsfönster / flagga för granskning |
| `TargetFalsePositivePercent` | DWORD | 10 | Grindens mål (95 %-gräns) |
| `ShowLockNotification` | DWORD | (användaren väljer) | "Visa låsning" |
| `ExtraReadingApps` / `ExtraLeavingApps` | SZ | — | Kommaseparerade processnamn |
| `EnableAudioSonar` / `EnableBleRssi` | DWORD | 0 | Valfria sensorer (ingen effekt utan backend) |
| `MediaHoldEnabled` / `MeetingHoldEnabled` | DWORD | 1 / 1 | Passiv paus vid synlig media / mikrofon-kamera (§6) |
| `HoldMaxMinutes` / `ConfirmGraceSeconds` | DWORD | 15 / 15 | Absolut backstop: bekräftelsedimning efter N min, lås efter M s |
| `HoldIgnoreApps` | SZ | — | Exe-namn eller paketprefix vars mikrofonanvändning ignoreras |
| `LogRetentionDays` / `ProtectedCopyRetentionDays` / `CollectedProfileRetentionDays` | DWORD | 30 / 180 / 90 | Städtjänstens lagringstider |
| `AllowUserPause` | DWORD | 1 | Pausval i snabbmenyn (§7b) |
| `AboutResponsible` / `AboutController` / `AboutPrivacyContact` / `AboutPolicyUrl` | SZ | "Jan-Eric Enlund – Elho" / "Elho" / – / – | Om-rutan: ansvarig, personuppgiftsansvarig, dataskyddskontakt och länk (bara http(s) eller UNC till .pdf/.htm/.docx öppnas) |
| `PauseOptionsMinutes` | SZ | `30,60,90` | Upp till tre pauslängder, 5–480 min |
| `PauseBudgetMinutesPerDay` | DWORD 0–1440 | 120 | Total paustid per rullande 24 h. 0 = ingen paus |
| `PauseKeepsConfirmation` | DWORD | 1 | 1 = "är du kvar?" efter `HoldMax` även under paus (NIS2-gränsen oförändrad). 0 = fullständig paus |
| `MaxLearnedHorizonMinutes` | DWORD 3–60 | 10 | Tak för den inlärda horisonten vid tyst arbete (§4b). 3 = fast 3-minutershorisont som före v0.5 |
| `AllowUserExit` | DWORD | 1 | **0 = NIS2-läge** (§7); sätt som datorprincip |
| `AllowProfileExport` | DWORD | 1 | Exportval i menyn |
| `HabitLearningEnabled` | DWORD | 1 | Vaneinlärning (§8); 0 = ingen journal |
| `HabitEarlyConfirmMinutes` | DWORD | 2 | Tidigaste vanebekräftelse |
| `ProfileExportDirectory` | EXPAND_SZ | — | Daglig insamling `DATOR_ANVÄNDARE.json` |
| `BaselineProfilePath` | EXPAND_SZ | — | Startvikter för nya användare |

### Administration

```bash
PresenceLock.exe --status
```

```bash
PresenceLock.exe --about
```

```bash
PresenceLock.exe --probe-signals 120
```

NIS2-läge, eleverad administratör, medan användaren är utloggad (annars skriver hens körande agent tillbaka sin profil):

```bash
PresenceLock.exe --reset-profile S-1-5-21-...
```

```bash
PresenceLock.exe --export-baseline baseline.json
```

```bash
PresenceLock.exe --merge-baseline fleet.json \\srv\pl$\PC1_anna.json \\srv\pl$\PC2_erik.json
```

Händelser i programloggen (källa `PresenceLock`), stabila id:n för SIEM:

| Id | Från | Betydelse |
|---|---|---|
| 1000 / 1009 | guard | guard startad / stoppad |
| 1001 | guard | agenten saknas, svarar inte eller blev aldrig frisk: låsning **begärd** (försök n), ännu inte bekräftad |
| 1003 | guard | låsbegäran misslyckades (hjälpprocessen startade inte eller LockWorkStation avvisades) |
| 1007 | guard | låset bekräftades inte efter 3 begäranden: reservåtgärd frånkoppling (lyckad eller misslyckad) |
| 1008 | guard | Windows rapporterar sessionen låst efter guardens begäran (bekräftelse) |
| 1002 / 1005 | guard | profilregression upptäckt / profil återställd från skyddad kopia |
| 1006 | guard | städtjänsten pensionerade skyddade kopior eller insamlade profiler |
| 1003 / 1004 | guard | låsning misslyckades / agenten kunde inte startas |
| 1010 / 1011 | agent | kvalitet under målet i skarpt läge / åter inom målet (§5b) |
| 1012 | agent | en inlärd modelländring förutsade sämre och rullades tillbaka (§5b) |
| 1013 | agent | `profile.json` oanvändbar: återställd från senast fungerande kopia (eller ny) |
| 1014 | agent | `habits.json` oanvändbar: ny journal startad, låsningen opåverkad |
| 1015 / 1016 | agent | användaren startade en paus (längd, budget kvar) / pausen slutade. Revisionsspår, aldrig spärrade (§7b) |
| 1017 | agent | en låsbegäran avvisades eller kvitterades inte: ny begäran (försök n), eller reservåtgärd frånkoppling |
| 1018 | agent | en signal som säkerhetsloopen behöver fallerar: inaktivitetstid (GetLastInputInfo), rå musindata eller sessionsnotiser. Utan sessionsnotiser kan ett lås inte bekräftas, och då begärs det igen och sessionen kopplas från |

### Loggar, städtjänst och diskbudget: inget växer obehindrat och inget har ett utgångsdatum

Tre lager, i den här ordningen:

1. **Städtjänst** (agenten och guarden, vid start och var 24:e timme). Den pensionerar gammal data löpande, utan administratör:
   - loggrader äldre än `LogRetentionDays` (30);
   - vanejournalens episoder äldre än 42 dygn, även när inget nytt registreras, till exempel efter en lång ledighet;
   - rester efter krasch (`*.tmp`);
   - guardens skyddade kopior för användare som inte setts på datorn under `ProtectedCopyRetentionDays` (180). Klockan räknas från när användaren senast *sågs*, inte från senaste godkända skrivning. En användare vars manipulerade profil nekas varje minut kan alltså aldrig överleva sin egen skyddade kopia;
   - den här datorns filer i insamlingsresursen äldre än `CollectedProfileRetentionDays` (90), om datorkontot har ändringsrätt. `--merge-baseline` ignorerar äldre filer i vilket fall.
   
   Varje körning loggas i `agent.log` och syns i `--status` (antal körningar, senaste körning, hur mycket som pensionerats).
2. **Självläkning.** Städtjänsten förnyar en senast fungerande kopia, `profile.json.bak`. Den skrivs bara efter att den aktuella filen lästs tillbaka och tolkats, så en trasig fil ersätter aldrig en bra kopia. Är `profile.json` någon gång oläsbar eller för stor laddas kopian, och händelse **1013** skrivs. Först om även kopian är oanvändbar börjar profilen om. En oanvändbar vanejournal ger en ny journal och händelse **1014**. Låsningen påverkas inte, och vanorna lärs in igen på 2–6 veckor.
3. **Storleksgräns vid läsning** som sista nödventil (tabellen nedan). En större fil behandlas som korrupt och läses aldrig in. En jättelik `profile.json` kan alltså varken krascha agenten i en slinga eller SYSTEM-guarden som synkar den.

**Uppmätt: 400 dygn utan administratör** (`HousekeepingTests`, Inventor-användaren, städtjänsten varje morgon):

| Dag | `profile.json` | `habits.json` (episoder) |
|---|---|---|
| 30 | 9,9 KB | 78 KB (1495) |
| 63 | 9,9 KB | 110 KB (2078) |
| 180 | 9,9 KB | 116 KB (2079) |
| 390 | 9,9 KB | 118 KB (2112) |

Båda planar ut. Profilen har bara strukturer med fast storlek, och journalen ligger på cirka 42 dygns data. Gränserna vid läsning (1 MB och 2 MB) nås aldrig. Efter 400 dygn är agenten fortfarande i skarpt läge: 0,86 % av betraktandena dimmas, kvaliteten är ok och modellskyddet har inte gjort någon återställning.

| Fil | Plats | Gräns (värsta fall) | Mekanism |
|---|---|---|---|
| `agent.log` + `agent.log.1` | `%LOCALAPPDATA%\PresenceLock` | **2 × 256 KB**, rader högst 30 dygn | Roterar innan en rad skulle passera 256 KB. Städtjänsten tar bort rader äldre än lagringstiden. En rad kapas vid 2048 tecken. Samma meddelande skrivs högst en gång per 10 min, med antal upprepningar. Innehåll: livscykel, lägesbyten och fel, aldrig indata, processnamn eller fönstertitlar. |
| `profile.json` (+ `.tmp` under skrivning, + `profile.json.bak`) | samma | uppmätt **9,9–10,0 KB** dag 30–390 (0.7.1). Läses inte om > 1 MB, och då laddas `.bak` | Bara strukturer med fast storlek: vikter, beslutsunderlaget (högst 1000 platser; poster äldre än underlaget nollställs), 144 räknare för tystnadsprofilen, 50 senaste exponeringar. |
| `habits.json` (+ `.tmp`) | samma | uppmätt **≈ 394 KB** vid taken. Läses inte om > 2 MB | Högst 42 dygn och 5000 episoder, 256 poäng. Rensas vid varje skrivning och vid inläsning. |
| Skyddad kopia | `%ProgramFiles%\PresenceLock\state\<SID>.json` | ≈ 10 KB per användare som setts de senaste 180 dygnen | Städtjänsten i guarden tar bort kopior för användare som inte setts under `ProtectedCopyRetentionDays` (händelse 1006). |
| Insamlad profil | `ProfileExportDirectory` | en fil per dator × användare, skrivs över dagligen | Guarden tar bort den egna datorns filer äldre än `CollectedProfileRetentionDays` (kräver ändringsrätt för datorkontot). `--merge-baseline` hoppar alltid över dem. |
| Programloggen | Windows | Windows egen maxstorlek (standard 20 MB, skriver över) | Agentens händelser: högst 1 per id och timme. Guardens: 1001/1003 högst 1 per session och minut, övriga 1 per session/SID och timme. Nästa post anger hur många som hölls tillbaka. |

**Uppmätt (testerna i `BoundedIoTests`).** Om agenten inte går att starta försöker guarden var 2:a sekund. Det blir 43 200 misslyckanden per dygn men bara **24 poster** i loggen, var och en med "1799 identical event(s) suppressed". 20 000 olika loggrader ger högst två filer inom budgeten. En rad på 100 000 tecken kapas.

Guarden läser användarens `profile.json` som SYSTEM. Därför vägrar den länkar (junction, symlink) på filen och dess mapp, och filer över 1 MB. I minnet är kinematikbufferten en ring på 512 händelser, vanejournalen har sina tak, och spärrtabellerna rymmer högst 256 nycklar.

Arbetsflöde för bred utrullning: pilotgrupp → profiler samlas in via `ProfileExportDirectory` → `--merge-baseline` → sätt `BaselineProfilePath` för resten av flottan. Nya användare startar då från pilotens vikter men måste ändå passera grinden på egen data. Medelvärdesbildning av logistiska modeller är inte detsamma som träning på poolad data, men det är en rimlig startpunkt.

---

## 13. Kända begränsningar

**Kvar efter granskningen 2026-11-12** (detaljer i [åtgärdsdokumentet](docs/review/2026-11-12-granskning-atgarder.md)):
- F30: Windows-kedjan är inte körd (lås, sessionshändelser, process-DACL, GPO, installation). Det gäller också positionen för `WTSSessionInfoEx` och kommandoradsläsningen.
- F04: hjärtslaget visar att agenten lever, inte att den är äkta (användaren kan skriva samma nyckel).
- F12: två samtidiga sessioner för samma användare delar profil, och den sist skrivna vinner.
- F13: kinematiken är inte normaliserad för musens CPI eller pollingfrekvens.
- F16, F18, F19: sannolikheterna är inte validerade mot fysisk närvaro, Wilson-gränsen är ingen livslång garanti vid upprepad prövning, och modellskyddet jämför en följd av modellversioner.
- F20: gammal data för ett konto som aldrig loggar in igen rensas först vid nästa inloggning, vid Windows profilrensning eller vid avinstallation.
- F24: dimningen saknar text och nedräkning och är inte prövad med skärmläsare.

- **Windows-skalet är inte kört.** Win32-signaturerna är granskade (bland annat `RAWMOUSE` med explicit layout, där unionen ligger på offset 4), men beteendet på riktig hårdvara är obekräftat.
- **Kinematiktrösklarna** (`HighSpeed = 40` counts, kantmarginal 8 px) beror på musens CPI och DPI. Modellen lär sig hur mycket den ska lita på varje feature, men feature-kvaliteten avgörs i piloten.
- **FP-fönstret på 10 s** inkluderar PIN-inmatning efter ett skarpt lås. Om upplåsning ofta tar längre än 10 s räknas äkta felaktiga lås som korrekta. Windows Hello gör det kortare.
- **SGD med konstant inlärningstakt** konvergerar aldrig till en punkt. Modellen följer användaren över tid, och grinden mäter prestanda, inte stillhet.
- **RDP:** absoluta muskoordinater hanteras. En frånkoppling (inte låsning) behandlas som inaktivitet.
- **Passiva signaler:** ConsentStore är odokumenterad och kan ändras i en Windows-uppdatering. Det kan också `SystemExecutionState`-aggregatets innehåll. Power-signalen är avstängd på serveroperativsystem, men **Windows Enterprise multi-session (AVD)** identifieras inte. Där är den maskinglobal, så stäng av `MediaHoldEnabled` via GPO.
- **Under en paus är datorn olåst** i upp till `HoldMax` + grace om användaren går från en pågående video eller ett möte. Det är en medveten och inställbar avvägning (§6).
- **En avfärd som ser exakt ut som tyst arbete** låses först efter den inlärda horisonten, högst `MaxLearnedHorizonMinutes` + grace (10 min 15 s som standard). Det är priset för att inte dimma betraktanden, och admin sätter det (§4b).
- **Tyst arbete i en app som inte står på läslistan** ger fortfarande "borta"-etiketter efter 180 s i inlärningsläget, eftersom inget annat skiljer den tystnaden från en avfärd. I skarpt läge rättar besvarade dimningar modellen, och horisonten flyttas ut. Lägg till sådana appar med `ExtraReadingApps`, eller slå på "Visa låsning" under inlärningen.
- **Utan passiva signaler** lär sig modellen att tyst videotittande är närvaro, och horisonten flyttas ut även där. Korta pauser från det sammanhanget kan då stå olåsta upp till taket. Uppmätt: 0–10 sådana återkomster på 45 dagar mot 0 med signaler (§6).
- **Tystnadsprofilen är en statistisk modell** (två lognormala grupper, med dalkrav). Den används bara för att bokföra osynliga beslut i grinden, aldrig som etikett. Vid tveksamhet svarar den "kan inte avgöra", och grinden förblir då försiktig.
- **Användarpausen kan inte skilja ett skriptat klick från ett riktigt.** Det är medvetet: budgeten, gränsen `HoldMax` + nådetid och revisionsloggen gör missbruk meningslöst och synligt. Detektering av injicerad indata skulle slå ut hjälpmedel (§7b). Windows egna skärmsläckar- och inaktivitetsinställningar påverkas inte av en paus.
- **Insamlingsresursen** rensas automatiskt bara om datorkontona har ändringsrätt på den. Annars ligger gamla filer kvar där, men de används aldrig: `--merge-baseline` hoppar över filer äldre än `CollectedProfileRetentionDays`. Agenterna läser aldrig resursen, så den kan inte påverka driften.
- **`LOCALAPPDATA` roamar inte.** Profilen och vanejournalen gäller per användare och dator.
- **Vanor vid vanlig hemgångstid ger liten vinst** (§8). Det är en egenskap hos datat, inte något en modell kan lösa utan fler signaler.
- **`OpenInputDesktop`:** om säkerhetsprogram nekar läsningen permanent blir varje paus en `SecureDesktop`-paus fram till backstopet. Det syns som ett högt `hold starts` i `--status`.

### Windows-acceptans (granskningens W01–W18; krävs före produktionsbeslut)

Kör på isolerade testdatorer med versionsidentifierad kandidat (hash i `RELEASE-MANIFEST.json`). Spara OS-build, effektiv policy, start- och sluttid, session, injicerat fel och observerad WTS-kvittens för varje fall. Tidskraven beslutas före körningen.

| Id | Område | Godkänt resultat |
|---|---|---|
| W01 | Alla låsorsaker (modell, backstop, vana, HoldProbe) med lyckat API, API-avslag och utebliven WTS-kvittens | ingen falsk framgång, tydlig återhämtning, verifierat slutläge (händelse 1017, 1007, 1008) |
| W02 | Kallstart och haveri | guarden agerar även utan tidigare frisk agent (120 s) |
| W03 | Hängning och fel process (fryst UI, CLI från installerad exe, ockuperad mutex) | räknas inte som frisk |
| W04 | Indata strax före timeout, fördröjt tick 1–5 s | indata avbryter, rätt programfokus |
| W05 | HKCU-värden som standardanvändare, HKLM ändrad under drift | miniminivån går inte att sänka, ändringen gäller inom 5 min |
| W06 | Tjänst- och processrättigheter (Aktivitetshanteraren, taskkill, trådåtkomst, förutöppnade handtag) | hotmodellen verifierad, kvarvarande begränsningar dokumenterade |
| W07 | Profilmanipulation (radera, regressera, långa pauser, byta fil eller sökväg under synk) | ogiltigt tillstånd accepteras aldrig som skyddat |
| W08 | Installation (låst exe, nekad ACL, avbruten kopiering, omstart, avinstallation) | returkod och aktiv hash stämmer, tidigare version återställs |
| W09 | Nätverk och lagring (SMB/DNS-avbrott, hög latens, full disk) | säkerhetsloopen påverkas inte |
| W10 | Sessioner (konsol, RDP, två användare, samma SID i två sessioner) | rätt session säkras |
| W11 | Tid och ström (UTC-steg, vila, viloläge) | monotona förlopp |
| W12 | Signalfel (RAWINPUT, WTS, GetLastInputInfo, säkert skrivbord) | synlig degradering (1018), fail-closed |
| W13 | Verklig hårdvara (mus 125/500/1000 Hz, CPI, pekplatta) | dokumenterade begränsningar |
| W14 | Visning och tillgänglighet (flera skärmar, DPI, HDR, skärmläsare) | bekräftelsen märks och kan besvaras |
| W15 | Arbetsmönster (CAD, PDF, möte, video, mätning, verklig avfärd) | oberoende facit, separata mått |
| W16 | Dataskydd och gallring (60 dagar inaktiv, funktion avstängd, export, skyddad kopia) | alla platser inventerade |
| W17 | Behörigheter för insamlingen (A mot B, datorkontots gallring) | minsta nödvändiga rättigheter |
| W18 | Driftmiljö (avsedda Windows-versioner, domän-GPO, EDR, patchnivå) | exakt release fungerar |

### Pilotchecklista (det som inte kan bevisas här)

1. Ikonen syns vid inloggning och inget annat fönster visas. `--status` visar `Learning` och att fönstret fylls på.
2. Win+L ökar `positives` med 1.
3. Testmaskin med `ModePolicy=2`: gå ifrån. Dimning ska komma vid cirka t₇₅ och lås vid t₉₀. **Skriv i Anteckningar medan skärmen dimmas.** Tangenttrycken ska hamna i Anteckningar, och dimningen ska släppa inom 1 s.
4. Med `DisableLockWorkstation` satt ska loggen visa "refused" och agenten inte krascha.
5. Flera skärmar med olika DPI: dimningen ska täcka allt. Testa också i en RDP-session.
6. `--probe-signals`: kontrollera video (synlig, minimerad), Teams-samtal och att `running=True` stämmer (§6).
7. Testmaskin i skarpt läge: titta på en video i mer än `HoldMax` minuter. En bekräftelsedimning ska komma, och en musrörelse ska släppa den. Gå sedan från en video som fortsätter spela. Låset ska komma senast `HoldMax` + grace efter din senaste rörelse.
8. **NIS2-läge** (`AllowUserExit = 0` som datorprincip och `-Guard`):
   - Som vanlig användare: *Avsluta aktivitet* på PresenceLock och `taskkill /im PresenceLock.exe /f` ska ge **åtkomst nekad**. `PresenceLock.exe --reset-profile` ska nekas.
   - Som eleverad admin, döda agenten: sessionen ska **låsas inom ≈ 4 s**, händelse **1001** ska finnas i programloggen, och agenten ska vara tillbaka efter upplåsning.
   - Vänta 1 min (synk), radera `profile.json`, logga ut och in igen: `--status` ska visa samma läge som före raderingen.
9. **RDP:** stäng RDP-klienten under en paus. `--status` ska visa `disconnects` + 1 och ingen ny `positives`. Återanslut och kontrollera att agenten fortsätter. Kör `--probe-signals` både i RDP-sessionen och på klienten (§9).
10. Defender/EDR ska vara tyst. Kontrollera särskilt guard-tjänsten, som startar processer i användarsessioner.
11. RAM och CPU över en arbetsdag (Process Explorer), mot påståendet < 15 MB och < 0,2 %.
12. Efter 15–30 dagar: `--status` (grindens siffror, vanejournalen och om vanorna är *ACTIVE* eller *shadow only*) samt upplevd störning.
13. **Tyst arbete:** en CAD-användare i skarpt läge betraktar en modell i 5 min utan att röra något. Efter några veckor ska det inte längre ge någon dimning. Kontrollera tystnadsprofilen och modellskyddet i `--status`.
14. Händelse 1010 ska finnas i programloggen hos en testanvändare med medvetet för snävt tak (`MaxLearnedHorizonMinutes = 3`, CAD-användare).
15. **Städtjänsten:** efter ett dygn ska `--status` visa `cleaning service: N runs` med senaste körning under 24 h och en backup (`profile.json.bak`). Gör `profile.json` oläsbar (skriv skräp i den) och logga in igen. Agenten ska fortsätta i samma läge, händelse 1013 ska finnas, och profilen ska *inte* ha börjat om.
16. **Användarpaus:** välj *Pausa → 30 minuter*. Händelse 1015 ska finnas, ikonens text ska visa "pausad till …", och efter 15 min utan aktivitet ska dimningen "är du kvar?" komma. Gå sedan ifrån datorn under en paus: den ska låsas inom 15 min 15 s. Använd hela budgeten. Menyvalen ska då vara nedtonade med "(från HH:MM)", och efter utloggning och inloggning ska budgeten fortfarande vara förbrukad.
17. **Om-rutan:** öppna *Om PresenceLock…*. Kontrollera ansvarig och personuppgiftsansvarig efter GPO, att *Öppna mina data* öppnar `%LOCALAPPDATA%\PresenceLock`, och att texten stämmer med `PresenceLock.exe --about`.
18. **Profilkontroll (sedan 0.7.1):** kör `PresenceLock.exe --diagnose` efter en dag och efter en vecka på varje pilotdator. Ingen rad får vara `[ERROR]`. Arbetar användaren i CAD, PDF, Office, en utvecklingsmiljö eller samtal ska *silent-work* vara större än 0. Annars saknas programmets processnamn i läslistan, och då ska det läggas till med `ExtraReadingApps`. `origin` ska vara `first start`, eller `recreated: …` med en förklaring. En exporterad profil kan analyseras på samma sätt utan Windows: `python3 verify/analyse_profile.py <fil>`.
