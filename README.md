# PresenceLock

Självlärande närvaroagent för Windows 10/11. Låser arbetsstationen när användaren har gått, och lär sig per användare skillnaden mellan *sitter still och läser* och *har rest sig och gått*. Agenten syns bara som en ikon i meddelandefältet. Den distribueras och styrs via GPO, utan MSI och utan kodsignering.

> Repo: `tmp` (Claude Code-experiment). Den här katalogen innehåller experimentet PresenceLock.

---

## 1. Status: vad är bevisat, vad är bara kompilerat, vad är otestat

| Del | Status | Bevis |
|---|---|---|
| Modell, inlärning, befordringsgrind (`src/PresenceLock.Core`) | **Verifierad** | 33 kontroller i Python-referensen, 47 C#-tester. C#-motorn ger **bit-identiska** parametrar mot referensen efter 45–60 simulerade dagar (26/26 parametrar, max avvikelse 0,0). |
| Beslutsflöde: passiv paus, kontrollprob, absolut backstop (`PresenceCoordinator`) | **Verifierad** | 14 enhetstester, bland annat ett egenskapstest med 500 slumpade modeller och slumpmässigt fladdrande signaler (låsning sker alltid ≤ `HoldMax` + grace). Två jämförande 60-dagarssimuleringar (§6). |
| Passiva OS-signaler (`PassiveSignalReader`) | **Kompilerad, ej körd. Semantiken är delvis odokumenterad** | ConsentStore är odokumenterad. Om `SystemExecutionState` aggregerar andra processers begäranden är inte dokumenterat. Verifiera på målmaskin med `PresenceLock.exe --probe-signals` (§6). Ett fel i signalerna kan bara fördröja låsning upp till `HoldMax` + grace. |
| Profil-JSON, export, baslinje, sammanslagning | **Verifierad** | C#-tester: round-trip, atomisk skrivning, korrupt fil, saknade fält, anonymisering, medelvärde. |
| Goertzel-DSP för ultraljudssensorn | **Verifierad** | `verify/goertzel_check.py`. |
| ADMX/ADML ↔ kod | **Verifierad** | `verify/check_admx.py`: alla värdenamn och strängar matchar i båda riktningar. |
| Windows-agenten (`src/PresenceLock.App`) | **Kompilerad, ej körd** | Byggd mot .NET Framework 4.8:s referensassemblies med 0 varningar och varningar som fel. Binären är kontrollerad: 78 848 byte (77 KiB), `ILOnly` (64-bit på x64), `WindowsGui`, refererar enbart in-box-assemblies. **Ingen Windows-maskin fanns i byggmiljön.** Se pilotchecklistan (§11). |
| Manipulationsskydd, NIS2-läge (`TamperProtection`, guard-tjänst) | **Reglerna verifierade, Windows-delen kompilerad men ej körd** | 19 enhetstester: process-SDDL (även injektionsförsök), återställning av raderad/nedgraderad profil, monoton skyddad kopia, guardens tillståndsmaskin (start, lås vid dödad agent, ignorerar utloggning och session 0). Om processens DACL faktiskt nekar Aktivitetshanteraren måste provas på Windows (§11). |
| Install-/avinstallationsskript | **Syntaxkontrollerade, ej körda** | PowerShells egen parser (7.4), ingen 7-specifik syntax. |
| Ljudinspelning (WASAPI) och BLE-watcher | **Ingår inte** | Endast gränssnitt och signalbehandling. Se §9. |
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
| Bara sensorer utan extra tillåtelse | Kärnan använder musens råinput, `GetLastInputInfo`, förgrundsprocessens **namn** och klockan. Inget av det kräver tillstånd. Tangentbordet registreras **inte** (§8). |
| "Visa låsning": notis, klick = oberättigad | Ballongnotis i inlärningsläget. Klick ger en stark negativ etikett (vikt 2) och räknas emot befordran. Kan bara tillämpas en gång per beslut. Testat. |
| Exportera profil för bred implementation | Tray-meny, CLI (`--export`, `--export-baseline`, `--merge-baseline`), automatisk daglig insamling till en filresurs, och baslinje-seedning för nya användare (GPO). |
| Läge 2 automatiskt vid "säker" nivå, utan att informera | Statistisk grind (§5). Bytet är tyst: ikon, tooltip och meny är identiska i båda lägena. Bytet loggas bara i admin-loggen. |
| Låsa inte mitt i en video eller ett möte, men inte heller hållas öppen av musik | Passiv paus på synlig video (display-required) och på mikrofon/kamera som används av en körande process. Ljud räknas inte som närvaro. Pausen begränsas alltid av backstopet (§6). |
| Ska inte gå att stänga av (NIS2), styrt via central GPO | `AllowUserExit = 0` som datorprincip, plus guard-tjänsten (§7). |
| GPO-distribution utan certifiering | En fil (`PresenceLock.exe` + `.exe.config`). Kopiering och Run-nyckel via GP Preferences, alternativt startskript. Se §10. |
| Styrning via AD GPO | `deploy/PresenceLock.admx` med sv-SE och en-US: läge, gränser, inlärningsgrind, notis, applistor, sensorer, avslut, export, insamling och baslinje. |

---

## 3. Arkitektur

```
src/PresenceLock.Core/        ren logik, inga OS-anrop (net48 + net8.0)
  PresenceModel.cs            P(borta|x,t), online-SGD, LockTime()
  PresenceEngine.cs           episod-tillståndsmaskin + feedback-hooks
  PresenceCoordinator.cs      hela beslutsflödet: indata > passiv paus > modell, + backstop
  ModeController.cs           inlärning -> skarpt: fönster + Wilson-gräns
  ProfileStore.cs             JSON, atomisk skrivning, export/baslinje/merge, schemamigrering
  TamperProtection.cs         NIS2: process-SDDL, betrodd profil, guardens tillståndsmaskin
src/PresenceLock.App/         Windows-skalet, kompileras till EN exe
  TrayApplicationContext.cs   tunt skal: läser OS-tillstånd, utför koordinatorns åtgärd
  Interop/MessageWindow.cs    WM_INPUT (endast mus) + WTS lås/upplås
  Sensors/                    kinematik, förgrundsapp, tidsprior, passiva OS-signaler, (sonar, BLE)
  Policy/SoftDimOverlay.cs    3 s dimning, WS_EX_TRANSPARENT|NOACTIVATE|TOPMOST
  Settings/PolicyReader.cs    HKLM-policy > HKCU-policy > HKCU-preferens
  Guard/                      LocalSystem-tjänst: startar om agenten, låser vid avbrott, skyddad kopia
  Cli.cs                      --status/--export/--export-baseline/--merge-baseline/--probe-signals/--reset-profile/--lock-now
deploy/                       ADMX/ADML, installations-/avinstallationsskript, task-XML
verify/                       Python-referens, simulering, alla kontroller
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
| Inaktiv ≥ 180 s | borta, vikt 1,5 | **vid observerad idle-tid** (censurerad, se nedan) |
| Indata ≤ 10 s efter (eventuellt osynlig) dimning eller låsning | närvarande, vikt 1 | vid beslutet |
| Skarpt lås, upplåst ≤ 10 s | närvarande, vikt 1 | vid beslutet |
| Skarpt lås, upplåst > 10 s | borta, vikt 1,5 | vid beslutet (den synliga dimningen besvarades inte) |
| Klick på "Visa låsning"-notis | närvarande, vikt 2 | vid beslutet |
| Osynligt beslut + indata *efter* 10 s | **ingen etikett**, men räknas som fel i grinden | — |

### Rättelser till den ursprungliga analysen

1. *"När 25 minuter har passerat vet mjukvaran med 100 % säkerhet att du lämnade vid t = 0."* **Fel.** Man vet bara att användaren var borta vid t = 180 s, inte när hen gick. Om etiketten backdateras till t₀ lär sig modellen att *läsning betyder att gå*. Här labbas observationen censurerat vid den observerade tiden (testet `LongAbsence_IsCensored_…`).
2. *En EMA över fel-andelen som tröskel för "säker".* En brusig EMA som korsar en tröskel är ett first-passage-fenomen. Med tillräckligt många dagar korsar den vilken tröskel som helst. Mätt: en användare med verklig fel-andel 15 % hade "befordrats" 5 492 gånger av en naiv EMA ≤ 10 %-grind. Med Wilson-grinden: aldrig.
3. *Ultraljudssonar och BLE som stealth-sensorer.* Se §9. Mikrofonanvändning tänder Windows integritetsindikator, vilket inte är förenligt med stealth.
4. *"< 15 MB RAM, < 0,2 % CPU"*. Ej belagt. Ska mätas.

---

## 5. Befordringsgrinden (inlärning → skarpt läge)

Alla villkor måste vara uppfyllda:
- minst `MinLearningDays` dagar (15);
- minst 30 bekräftade avgångar;
- de senaste **200** avslutade episoderna (≈ 11 arbetsdagar), där **Wilson 95 %-övre gränsen** för andelen "skulle ha dimmat eller låst en närvarande användare" ≤ `TargetFalsePositivePercent` (10 %).

Når profilen inte grinden efter `MaxLearningDays` (30) tvingas den **inte** över. Den markeras `LearningExtended` och syns i `--status` och i exporten. Vid befordran sparas en revisionsspårbar ögonblicksbild: tidpunkt, uppmätt andel, övre gräns och om bytet tvingades av policy.

### Uppmätt i simulering (60 arbetsdagar, 18–19 inaktivitetsepisoder per dag)

*Separerbar användare:* 10 läspauser (15–100 s), 2 läs-och-gå, 3 avgångar, 2 Win+L per dag.
*Tvetydig användare:* samma plus 1 närvarande paus per dag med **identisk** signatur som en avgång. Den kan inte skiljas åt med någon sensor, och är där med flit.

| Scenario | Seed | Befordrad dag | Grind vid befordran (andel / övre 95 %) | Verklig andel i skarpt läge | Skarpa lås på närvarande | Avgångar låsta < 180 s | Median tid till lås |
|---|---|---|---|---|---|---|---|
| separerbar | 1 | 15 | 1,5 % / 4,3 % | 3,1 % | **0** | 97,8 % | 4 s |
| separerbar | 7 | 15 | 1,5 % / 4,3 % | 3,3 % | **0** | 98,7 % | 4 s |
| separerbar | 42 | 15 | 1,5 % / 4,3 % | 3,1 % | **0** | 99,1 % | 4 s |
| separerbar | 999 | 15 | 1,5 % / 4,3 % | 3,1 % | **0** | 98,2 % | 4 s |
| separerbar | 2024 | 15 | 2,0 % / 5,0 % | 3,0 % | **0** | 99,1 % | 4 s |
| tvetydig | 1 | — | ej befordrad (LearningExtended) | — | **0** | — | — |
| tvetydig | 7 | 51 | 5,5 % / 9,6 % | 9,2 % | **0** | 95,0 % | 21 s |
| tvetydig | 42 | 15 | 5,5 % / 9,6 % | 8,5 % | **0** | 98,2 % | 8 s |
| tvetydig | 999 | — | ej befordrad (LearningExtended) | — | **0** | — | — |
| tvetydig | 2024 | — | ej befordrad (LearningExtended) | — | **0** | — | — |

Slutsatser som håller i alla 10 körningar:
- **Noll skarpa lås på en närvarande användare.** Den synliga 3-sekundersdimningen fångar alla.
- **Grinden håller sitt löfte.** Varje befordrad profil låg inom målet (≤ 10 %) även i skarpt läge.
- **Osäkerhet fördröjer, den påskyndar aldrig.** När signalen inte räcker för 95 % säkerhet blir det admin-granskning istället för gissning.

Tabellen ovan driver motorn direkt. De 1–5 % avgångar som modellen inte låste före 180 s stod i den versionen **olåsta tills användaren kom tillbaka**. Det var ett säkerhetsfel, och det är rättat av backstopet i §6. Med hela beslutsflödet: 0 återkomster till en olåst dator.

**Simuleringen är syntetisk.** Den bevisar att algoritmen gör det den påstår under kontrollerade förhållanden, inte hur verkliga användare beter sig. Det besvaras av piloten.

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
- När 180-sekundershorisonten nås utan lås visas en **synlig** bekräftelsedimning. Ett svar ger en sann etikett "närvarande". Inget svar inom `ConfirmGraceSeconds` ger låsning.
- När `HoldMaxMinutes` inaktivitet nås, oavsett signaler och modell, visas samma bekräftelse.
- **Ingen dator står olåst längre än `HoldMax` + grace efter senaste indata.** Egenskapstestet kör 500 slumpade modeller med slumpmässigt fladdrande signaler, och gränsen håller i alla.

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

## 7. NIS2-läge: manipulationsskydd

**Hotmodell:** en vanlig användare *utan* lokal adminrätt som vill att datorn ska stå olåst. Lokala administratörer och fysiska attacker ligger per definition utanför.

**Aktivering** (två delar, båda centralt):
1. **Datorprincip:** PresenceLock → Administration → *Tillåt användaren att avsluta agenten* = **Inaktiverad** (`AllowUserExit = 0`). Den ska sättas som *dator*principen, eftersom guard-tjänsten bara läser den.
2. **Guard-tjänsten:** startskriptet med `-Guard` (§10, alternativ B). GP Preferences kan inte skapa tjänster.

| Sätt att lämna datorn olåst | Utan NIS2-läge | NIS2-läge | Mekanism | Belägg |
|---|---|---|---|---|
| "Avsluta" i menyn | möjligt | borttaget | GPO | kompilerad |
| Aktivitetshanteraren, `taskkill /f`, `Stop-Process` | möjligt | **åtkomst nekad** | Processens egen DACL: användaren och `OWNER RIGHTS` får bara `SYNCHRONIZE \| QUERY_LIMITED`. `OWNER RIGHTS` tar bort ägarens implicita rätt att skriva om DACL:en | SDDL enhetstestad; effekten provas på Windows |
| `WM_QUIT` / `WM_CLOSE` från ett eget program | agenten avslutas | meddelandeloopen startar om | `Program.cs` | kompilerad |
| Agenten dör ändå (krasch, admin-verktyg) | olåst | **sessionen låses inom ≈ 4 s**, agenten startas om, händelse 1001 | guard-tjänst (LocalSystem) | tillståndsmaskinen enhetstestad (7 tester) |
| Autostart avstängd | ingen agent | guarden startar den | guard-tjänst | enhetstestad |
| Egen kopia döpt till `PresenceLock.exe` för att lura guarden | — | räknas inte | guarden kräver exakt avbildssökväg i `Program Files` | kompilerad |
| Radera `profile.json`, ändra `Mode` till `Learning`, nollställa inlärningsklockan | 15+ dagar utan lås | **återställs** från skyddad kopia | `ChooseTrusted` + monoton `AcceptIntoProtected` | enhetstestad |
| Ändra policyfält i `profile.json` (trösklar, horisont, `MinLearningDays`, inlärningstakt) | verkar | **ignoreras**: läses alltid från GPO eller standard | `ResetPolicyFields` | enhetstestad |
| Ändra de inlärda vikterna | — | begränsat av backstopet: ≤ 180 s + grace, eller `HoldMax` + grace | `PresenceCoordinator` | egenskapstestad (500 slumpade modeller) |
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
   - *"Håll vaken"-verktyg som skickar tangenttryck* (t.ex. F15 var 59:e sekund) går bara att upptäcka om agenten registrerar tangentbordet för rå indata. Det räcker att läsa *enhetshandtaget*, aldrig tangentkoder. Det är ändå just det mönster jag valde bort av integritets- och EDR-skäl (§8).
   - *USB-hårdvarujigglers* ser ut som en riktig mus. Bara beteendeanalys (periodiska mikrorörelser utan annan aktivitet) kan avslöja dem.
2. **Inlärningsperioden (≥ 15 dagar) låser inte**, enligt kravspecifikationen. Er skärmsläckarprincip (15/30/60 min) är golvet under den perioden, så **behåll den**. Vill ni att agenten låser från dag 1: `ModePolicy = 2` tillsammans med `BaselineProfilePath` från en pilotgrupp.
3. **Felsäkert läge** (nås från inloggningsskärmen via Skift + Starta om): varken agent eller tjänst startar. Skärmsläckarprincipen gäller fortfarande.
4. **Pausen vid video eller möte** lämnar datorn olåst i upp till `HoldMax` + grace efter en avgång (§6). Det är inställbart.
5. **Den skyddade kopian synkas var 60:e sekund.** Ett fönster på högst en minut efter en befordran är inte täckt.

---

## 8. Integritet: vad agenten ser och inte ser

- **Mus:** relativ rörelse, hjul och tidpunkter i ett 3-sekunders RAM-fönster. Endast den sista markörpositionen används (för kantdetektering). Ingenting av detta sparas.
- **Tangentbord:** **registreras inte.** Tangentbordsaktivitet syns bara som "inte inaktiv" via `GetLastInputInfo`. Det finns ingen kodväg som kan se tangenttryck. En bakgrundsprocess som tar emot rå tangentbordsinput är det klassiska keylogger-mönstret, och det undviks medvetet.
- **Förgrundsapp:** endast **processnamnet** (`inventor`), aldrig fönstertitel eller innehåll.
- **Passiva signaler:** ConsentStore-posternas app-sökvägar och de körande processernas avbildsnamn läses i minnet för att avgöra om en mikrofon- eller kamerapost är levande. De sparas aldrig. Profilen får bara räknare (`HoldStarts`, `HoldProbes` …), inga appnamn och inga tider.
- **Kamera:** används inte. Den tänder lysdioden och integritetsindikatorn, och det skulle vara biometriknära personuppgifter.
- **Profil:** 11+11 vikter, räknare och 200 bitar utfall. Testet `Json_ContainsNoContent_…` vaktar detta.
- **Loggen** (`agent.log`): start, stopp, lägesbyten och fel. Inget om användarens aktivitet.

### Juridik (faktaunderlag, inte juridisk rådgivning)

Profilen är kopplad till en SID och beskriver en anställds beteende. Det är **personuppgifter** (GDPR art. 4.1).

- **Informationsplikt (art. 13)** gäller oavsett att appen är "stealth". Det tysta lägesbytet är ett UX-val och fungerar som det ska, men verktygets existens och syfte måste framgå av arbetsgivarens information eller IT-policy.
- **Konsekvensbedömning (art. 35):** systematisk övervakning av anställda uppfyller två kriterier i EDPB:s riktlinjer (WP248: systematisk övervakning + sårbara registrerade). Då krävs normalt en DPIA.
- **Insamlingsresursen** innehåller personuppgifter. Ge användare skrivrätt men inte läsrätt, och läsrätt bara för admin.

Designen hjälper vid bedömningen: lokal lagring, inget innehåll, inget tangentbord, ingen kamera och ett tydligt avgränsat ändamål (låsa den egna skärmen).

---

## 9. Valfria sensorer: ärlig status

| Sensor | I den här versionen | Fakta som avgör användbarhet |
|---|---|---|
| 20 kHz ultraljud (Doppler) | Goertzel-DSP och Doppler-logik finns och är verifierade. **Ljudinspelning finns inte.** `IAudioCaptureBackend` måste kopplas in (NAudio WASAPI rekommenderas). | Windows 11 visar mikrofonindikatorn, vilket inte är stealth. Sekretessinställningen "Tillåt skrivbordsappar att komma åt mikrofonen" måste vara på. Många bärbara har AGC eller lågpass under 20 kHz. Kräver 48 kHz. En kontinuerlig 20 kHz-ton kan höras av vissa och störa djur. |
| BLE RSSI | Logiken finns. **WinRT-watcher finns inte.** | RSSI är brusigt. Kan bara bli en svag bidragsgivare, aldrig en utlösare. |

Båda är **avstängda som standard**. Utan inspelning markeras de otillgängliga, och då kan skarpt läge aldrig bero av dem.

---

## 10. Bygga och distribuera via GPO

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

### GPO-inställningar (`HKLM\SOFTWARE\Policies\PresenceLock`; HKCU-policy fungerar också, HKLM vinner)

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
| `AllowUserExit` | DWORD | 1 | **0 = NIS2-läge** (§7); sätt som datorprincip |
| `AllowProfileExport` | DWORD | 1 | Exportval i menyn |
| `ProfileExportDirectory` | EXPAND_SZ | — | Daglig insamling `DATOR_ANVÄNDARE.json` |
| `BaselineProfilePath` | EXPAND_SZ | — | Startvikter för nya användare |

### Administration

```bash
PresenceLock.exe --status
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

Arbetsflöde för bred utrullning: pilotgrupp → profiler samlas in via `ProfileExportDirectory` → `--merge-baseline` → sätt `BaselineProfilePath` för resten av flottan. Nya användare startar då från pilotens vikter men måste ändå passera grinden på egen data. Medelvärdesbildning av logistiska modeller är inte detsamma som träning på poolad data, men det är en rimlig startpunkt.

---

## 11. Kända begränsningar

- **Windows-skalet är inte kört.** Win32-signaturerna är granskade (bland annat `RAWMOUSE` med explicit layout, där unionen ligger på offset 4), men beteendet på riktig hårdvara är obekräftat.
- **Kinematiktrösklarna** (`HighSpeed = 40` counts, kantmarginal 8 px) beror på musens CPI och DPI. Modellen lär sig hur mycket den ska lita på varje feature, men feature-kvaliteten avgörs i piloten.
- **FP-fönstret på 10 s** inkluderar PIN-inmatning efter ett skarpt lås. Om upplåsning ofta tar längre än 10 s räknas äkta felaktiga lås som korrekta. Windows Hello gör det kortare.
- **SGD med konstant inlärningstakt** konvergerar aldrig till en punkt. Modellen följer användaren över tid, och grinden mäter prestanda, inte stillhet.
- **RDP:** absoluta muskoordinater hanteras. En frånkoppling (inte låsning) behandlas som inaktivitet.
- **Passiva signaler:** ConsentStore är odokumenterad och kan ändras i en Windows-uppdatering. Det kan också `SystemExecutionState`-aggregatets innehåll. Power-signalen är avstängd på serveroperativsystem, men **Windows Enterprise multi-session (AVD)** identifieras inte. Där är den maskinglobal, så stäng av `MediaHoldEnabled` via GPO.
- **Under en paus är datorn olåst** i upp till `HoldMax` + grace om användaren går från en pågående video eller ett möte. Det är en medveten och inställbar avvägning (§6).
- **I inlärningsläget kan 180-sekundershorisonten inte verifieras** (inget syns). En användare som läser tyst i mer än 3 minuter utan video får fortfarande en censurerad "borta"-etikett. I skarpt läge verifieras horisonten med backstop-dimningen.
- **`LOCALAPPDATA` roamar inte.** Profilen gäller per användare och dator.

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
9. Defender/EDR ska vara tyst. Kontrollera särskilt guard-tjänsten, som startar processer i användarsessioner.
10. RAM och CPU över en arbetsdag (Process Explorer), mot påståendet < 15 MB och < 0,2 %.
11. Efter 15–30 dagar: `--status`, grindens siffror och upplevd störning.
