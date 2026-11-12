# PresenceLock

Självlärande närvaroagent för Windows 10/11. Låser arbetsstationen när användaren har gått, och lär sig per användare skillnaden mellan *sitter still och läser* och *har rest sig och gått*. Agenten syns bara som en ikon i meddelandefältet. Den distribueras och styrs via GPO, utan MSI och utan kodsignering.

> Repo: `tmp` (Claude Code-experiment). Den här katalogen innehåller experimentet PresenceLock.

---

## 1. Status: vad är bevisat, vad är bara kompilerat, vad är otestat

| Del | Status | Bevis |
|---|---|---|
| Modell, inlärning, befordringsgrind (`src/PresenceLock.Core`) | **Verifierad** | 33 kontroller i Python-referensen, 29 C#-tester. C#-motorn ger **bit-identiska** parametrar mot referensen efter 45–60 simulerade dagar (24/24 parametrar, max avvikelse 0,0). |
| Profil-JSON, export, baslinje, sammanslagning | **Verifierad** | C#-tester: round-trip, atomisk skrivning, korrupt fil, saknade fält, anonymisering, medelvärde. |
| Goertzel-DSP för ultraljudssensorn | **Verifierad** | `verify/goertzel_check.py`. |
| ADMX/ADML ↔ kod | **Verifierad** | `verify/check_admx.py`: alla värdenamn och strängar matchar i båda riktningar. |
| Windows-agenten (`src/PresenceLock.App`) | **Kompilerad, ej körd** | Byggd mot .NET Framework 4.8:s referensassemblies med 0 varningar och varningar som fel. Binären är kontrollerad: 50 176 byte (49 KiB), `ILOnly` (64-bit på x64), `WindowsGui`, refererar enbart in-box-assemblies. **Ingen Windows-maskin fanns i byggmiljön.** Se pilotchecklistan (§9). |
| Install-/avinstallationsskript | **Syntaxkontrollerade, ej körda** | PowerShells egen parser (7.4), ingen 7-specifik syntax. |
| Ljudinspelning (WASAPI) och BLE-watcher | **Ingår inte** | Endast gränssnitt och signalbehandling. Se §7. |
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
| Bara sensorer utan extra tillåtelse | Kärnan använder musens råinput, `GetLastInputInfo`, förgrundsprocessens **namn** och klockan. Inget av det kräver tillstånd. Tangentbordet registreras **inte** (§6). |
| "Visa låsning": notis, klick = oberättigad | Ballongnotis i inlärningsläget. Klick ger en stark negativ etikett (vikt 2) och räknas emot befordran. Kan bara tillämpas en gång per beslut. Testat. |
| Exportera profil för bred implementation | Tray-meny, CLI (`--export`, `--export-baseline`, `--merge-baseline`), automatisk daglig insamling till en filresurs, och baslinje-seedning för nya användare (GPO). |
| Läge 2 automatiskt vid "säker" nivå, utan att informera | Statistisk grind (§5). Bytet är tyst: ikon, tooltip och meny är identiska i båda lägena. Bytet loggas bara i admin-loggen. |
| GPO-distribution utan certifiering | En fil (`PresenceLock.exe` + `.exe.config`). Kopiering och Run-nyckel via GP Preferences, alternativt startskript. Se §8. |
| Styrning via AD GPO | `deploy/PresenceLock.admx` med sv-SE och en-US: läge, gränser, inlärningsgrind, notis, applistor, sensorer, avslut, export, insamling och baslinje. |

---

## 3. Arkitektur

```
src/PresenceLock.Core/        ren logik, inga OS-anrop (net48 + net8.0)
  PresenceModel.cs            P(borta|x,t), online-SGD, LockTime()
  PresenceEngine.cs           episod-tillståndsmaskin + feedback-hooks
  ModeController.cs           inlärning -> skarpt: fönster + Wilson-gräns
  ProfileStore.cs             JSON, atomisk skrivning, export/baslinje/merge
src/PresenceLock.App/         Windows-skalet, kompileras till EN exe
  TrayApplicationContext.cs   orkestrering (allt på UI-tråden, inga lås)
  Interop/MessageWindow.cs    WM_INPUT (endast mus) + WTS lås/upplås
  Sensors/                    kinematik, förgrundsapp, tidsprior, (sonar, BLE)
  Policy/SoftDimOverlay.cs    3 s dimning, WS_EX_TRANSPARENT|NOACTIVATE|TOPMOST
  Settings/PolicyReader.cs    HKLM-policy > HKCU-policy > HKCU-preferens
  Cli.cs                      --status/--export/--export-baseline/--merge-baseline
deploy/                       ADMX/ADML, installations-/avinstallationsskript, task-XML
verify/                       Python-referens, simulering, alla kontroller
tests/                        xUnit: enhet + paritet mot den riktiga C#-motorn
```

Motorn har inga timers och gör inga OS-anrop. Värden matar den med tid, idle-tid och facit. Därför kan exakt samma kod testas utanför Windows.

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
3. *Ultraljudssonar och BLE som stealth-sensorer.* Se §7. Mikrofonanvändning tänder Windows integritetsindikator, vilket inte är förenligt med stealth.
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

**Simuleringen är syntetisk.** Den bevisar att algoritmen gör det den påstår under kontrollerade förhållanden, inte hur verkliga användare beter sig. Det besvaras av piloten.

---

## 6. Integritet: vad agenten ser och inte ser

- **Mus:** relativ rörelse, hjul och tidpunkter i ett 3-sekunders RAM-fönster. Endast den sista markörpositionen används (för kantdetektering). Ingenting av detta sparas.
- **Tangentbord:** **registreras inte.** Tangentbordsaktivitet syns bara som "inte inaktiv" via `GetLastInputInfo`. Det finns ingen kodväg som kan se tangenttryck. En bakgrundsprocess som tar emot rå tangentbordsinput är det klassiska keylogger-mönstret, och det undviks medvetet.
- **Förgrundsapp:** endast **processnamnet** (`inventor`), aldrig fönstertitel eller innehåll.
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

## 7. Valfria sensorer: ärlig status

| Sensor | I den här versionen | Fakta som avgör användbarhet |
|---|---|---|
| 20 kHz ultraljud (Doppler) | Goertzel-DSP och Doppler-logik finns och är verifierade. **Ljudinspelning finns inte.** `IAudioCaptureBackend` måste kopplas in (NAudio WASAPI rekommenderas). | Windows 11 visar mikrofonindikatorn, vilket inte är stealth. Sekretessinställningen "Tillåt skrivbordsappar att komma åt mikrofonen" måste vara på. Många bärbara har AGC eller lågpass under 20 kHz. Kräver 48 kHz. En kontinuerlig 20 kHz-ton kan höras av vissa och störa djur. |
| BLE RSSI | Logiken finns. **WinRT-watcher finns inte.** | RSSI är brusigt. Kan bara bli en svag bidragsgivare, aldrig en utlösare. |

Båda är **avstängda som standard**. Utan inspelning markeras de otillgängliga, och då kan skarpt läge aldrig bero av dem.

---

## 8. Bygga och distribuera via GPO

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

Skriptet är idempotent (kopierar bara vid ändrad hash), kontrollerar .NET 4.8 och registrerar Run-nyckel eller schemalagd uppgift (`-Autostart Task`, som startar om vid krasch). Avinstallation: `Uninstall-PresenceLock.ps1 [-RemoveUserProfiles]`.

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
| `AllowUserExit` / `AllowProfileExport` | DWORD | 1 | Menyval |
| `ProfileExportDirectory` | EXPAND_SZ | — | Daglig insamling `DATOR_ANVÄNDARE.json` |
| `BaselineProfilePath` | EXPAND_SZ | — | Startvikter för nya användare |

### Administration

```bash
PresenceLock.exe --status
```

```bash
PresenceLock.exe --export-baseline baseline.json
```

```bash
PresenceLock.exe --merge-baseline fleet.json \\srv\pl$\PC1_anna.json \\srv\pl$\PC2_erik.json
```

Arbetsflöde för bred utrullning: pilotgrupp → profiler samlas in via `ProfileExportDirectory` → `--merge-baseline` → sätt `BaselineProfilePath` för resten av flottan. Nya användare startar då från pilotens vikter men måste ändå passera grinden på egen data. Medelvärdesbildning av logistiska modeller är inte detsamma som träning på poolad data, men det är en rimlig startpunkt.

---

## 9. Kända begränsningar

- **Windows-skalet är inte kört.** Win32-signaturerna är granskade (bland annat `RAWMOUSE` med explicit layout, där unionen ligger på offset 4), men beteendet på riktig hårdvara är obekräftat.
- **Kinematiktrösklarna** (`HighSpeed = 40` counts, kantmarginal 8 px) beror på musens CPI och DPI. Modellen lär sig hur mycket den ska lita på varje feature, men feature-kvaliteten avgörs i piloten.
- **FP-fönstret på 10 s** inkluderar PIN-inmatning efter ett skarpt lås. Om upplåsning ofta tar längre än 10 s räknas äkta felaktiga lås som korrekta. Windows Hello gör det kortare.
- **SGD med konstant inlärningstakt** konvergerar aldrig till en punkt. Modellen följer användaren över tid, och grinden mäter prestanda, inte stillhet.
- **RDP:** absoluta muskoordinater hanteras. En frånkoppling (inte låsning) behandlas som inaktivitet.
- **`LOCALAPPDATA` roamar inte.** Profilen gäller per användare och dator.

### Pilotchecklista (det som inte kan bevisas här)

1. Ikonen syns vid inloggning och inget annat fönster visas. `--status` visar `Learning` och att fönstret fylls på.
2. Win+L ökar `positives` med 1.
3. Testmaskin med `ModePolicy=2`: gå ifrån. Dimning ska komma vid cirka t₇₅ och lås vid t₉₀. **Skriv i Anteckningar medan skärmen dimmas.** Tangenttrycken ska hamna i Anteckningar, och dimningen ska släppa inom 1 s.
4. Med `DisableLockWorkstation` satt ska loggen visa "refused" och agenten inte krascha.
5. Flera skärmar med olika DPI: dimningen ska täcka allt. Testa också i en RDP-session.
6. Defender/EDR ska vara tyst.
7. RAM och CPU över en arbetsdag (Process Explorer), mot påståendet < 15 MB och < 0,2 %.
8. Efter 15–30 dagar: `--status`, grindens siffror och upplevd störning.
