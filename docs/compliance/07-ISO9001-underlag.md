---
title: "ISO 9001-underlag – PresenceLock"
subtitle: "Konstruktion och utveckling (8.3), dokumenterad information (7.5), uppföljning (9.1), avvikelser (10.2), ständig förbättring (10.3)"
status: "UTKAST"
---

# ISO 9001-underlag: PresenceLock

## 1. Produkt och ansvar

| | |
|---|---|
| Produkt | PresenceLock: internt utvecklad Windows-agent för automatisk skärmlåsning |
| Ägare / ansvarig | Jan-Eric Enlund, Elho |
| Konfigurationsstyrning | Git-repo (`engrove/tmp`, gren `claude/pensive-albattani-5qjypw`), en commit per förändring med verifieringsresultat i meddelandet |
| Distribution | GPO-paket (zip med SHA256SUMS): `PresenceLock.exe`, installationsskript, ADMX/ADML, README |

## 2. Konstruktion och utveckling (8.3)

**Indata (8.3.3), krav från beställaren:**
1. Windows 10 och 11. Körs i bakgrunden och syns bara som ikon.
2. Inlärningsläge 15–30 dagar utan låsning, endast sensorer som inte kräver tillstånd, valfri notis "Visa låsning".
3. Byter automatiskt och tyst till skarpt läge när det är säkert.
4. Distribueras och styrs med GPO, utan kodsignering.
5. NIS2: ska inte kunna stängas av via central GPO.
6. Video- och mötessignaler.
7. Vaneinlärning modellerad efter Elli.
8. Hänsyn till RDP.
9. Tyst arbete, betraktande i CAD, ska läras in.
10. Profilen ska anpassas efter användarens mönster.
11. Ständig förbättring även efter dag 30.
12. Inga filer får växa obehindrat, och städtjänst utan utgångsdatum.
13. Användarpaus med GPO-styrd maxtid, skydd mot skriptning.
14. Om-ruta med ansvarig, NIS2- och GDPR-information.
15. Lägsta tid före automatisk låsning via GPO, standard 120 s (beställaren 2026-11-13: den korta tiden ger klagomål).
16. Versionen som körs ska gå att avgöra ur loggen (beställarens rapport 2026-11-13: menyn från en äldre version visades efter att 0.7.1 startats).

**Utdata (8.3.5):** källkod, binär, ADMX/ADML (en-US, sv-SE), README med kravspårning (§2), detta underlag.

**Granskning (8.3.4):** varje version granskas mot kraven med uppmätta resultat i commit-meddelandet och README.

**Verifiering (8.3.4):** `verify/run_all.sh` kör sju steg:
- Python-referensen (43 kontroller i 0.7.1, bland annat fältreproduktionen från 2026-11-13);
- DSP-kontroll;
- konsistens mellan ADMX och kod;
- paritetsfil;
- C#-testerna mot den riktiga motorn (188 i 0.7.1, 197 i 0.7.2, bit-identisk paritet 28/28 parametrar);
- bygge för .NET Framework 4.8 med 0 varningar;
- analysverktyget för profiler på en syntetisk fixtur: Python och C# ska ge samma siffror.

Sedan 0.7.1 använder simuleringarna den **uppmätta** episodfördelningen från fältprofilen 2026-11-13: korta pauser på 2–29 s mellan 5–60 s aktivt arbete. Kontrollen "minst 85 % korta episoder" ingår i verifieringen, så en simulering som glider ifrån fältdata fallerar.

Acceptanskriterier sätts **före** körningen och redovisas, även när de fallerar (se avsnitt 4).

**Validering (8.3.4):** **påbörjad.** En första fältprofil (2026-11-13, en dator, lokal körning utan GPO, cirka en halv dag) har analyserats och ledde till 0.7.1, se avvikelse 11–17. Validering i avsedd miljö sker i pilot enligt README (pilotchecklistan) och Windows-acceptans W01–W18. Ingen Windows-dator fanns i utvecklingsmiljön.

**Ändringar (8.3.6):** varje ändring har en commit med motivering, verifiering och kända begränsningar.

## 3. Versionsförteckning

| Version | Commit | Innehåll | Verifiering |
|---|---|---|---|
| 0.1.0 | `ea240ce` | Grundversion: modell, grind, agent, GPO | Python 33/33, C# 47 |
| 0.2.0 | `5bc0f31` | Passiv paus (video och möte), absolut backstop | +14 koordinatortester |
| 0.3.0 | `2da233d` | NIS2-läge: manipulationsskydd, guard-tjänst | +19 tester |
| 0.4.0 | `107b735` | Vaneinlärning (Elli), RDP | 92 tester |
| 0.5.0 | `0fc6c01` | Tyst arbete (inlärd horisont), tystnadsprofil, Kaizen (modellskydd, kvalitet) | 119 tester |
| 0.5.1 | `79ad0f4` | Diskbudget, storleksgränser, spärr mot loggflod | 127 tester |
| 0.5.2 | `a48a8df` | Städtjänst, självläkning | 139 tester |
| 0.6.0 | `b792fa0` | Användarpaus med budget | 149 tester |
| 0.6.1 | commit "v0.6.1: About box …" | Om-ruta; insamlingen rensad från aktivitetstider; detta underlag | Python 33/33, C# 153/153, ADMX ok, net48 0 varningar |
| 0.7.0 | `038185f` | Rättningar efter extern djupgranskning: låskedja, guard, policyscope, I/O, installation, releasemanifest | regressionstester T01–T14, se åtgärdsdokumentet |
| 0.7.1 | `a89ea33` | Rättningar efter analys av första fältprofilen (2026-11-13): grinden räknar beslutstillfällen i ett tidsmedvetet fönster, kalibrerat kvalitetslarm, simuleringar med uppmätt episodfördelning, diagnostik (`--diagnose`, `verify/analyse_profile.py`) | avvikelse 11–17 nedan; kriterier A1–A8 satta före körningen |
| 0.7.2 | se `RELEASE-MANIFEST.json` | Krav 15–16: GPO-golvet `MinLockIdleSeconds` (standard 120 s). Version och commit i `agent.log` och `--status`. Händelse 1019 vid två agenter i samma session. Rättning: en vanebekräftelse kunde fördröja modellens lås 1 s när de blev aktuella samtidigt, vilket golvet gjorde möjligt. Upptäckt av egenskapstestet för vanor | Kriterier F1–F4 satta före körningen. F1: 1500 slumpade fall, tidigaste åtgärd exakt vid golvet. F2/F3: tidigare gränser håller. F4: avvägningstabell i README §5c |

## 4. Avvikelser och korrigerande åtgärder (10.2) under utvecklingen

| # | Avvikelse | Rotorsak | Åtgärd | Verifiering |
|---|---|---|---|---|
| 1 | CAD-användare: tyst betraktande märktes som "borta" (537 felaktiga etiketter), och 70 % dämpades | Fast regel: tystnad längre än 180 s räknades som frånvaro | Etiketter sätts i efterhand och bara på fakta. Inlärd horisont med admin-tak | 0 felaktiga etiketter, cirka 1 % dämpningar (v0.5) |
| 2 | Kontorsanvändare nådde inte längre skarpt läge (regression orsakad av nr 1) | Tvetydiga pauser räknades som felaktiga beslut | Tystnadsprofil med två grupper och dalkrav | Skarpt läge dag 15 igen, 3 slumpfrön |
| 3 | Tystnadsprofilen delade jämnt spridda betraktanden i två grupper (D = 2,0) | En blandningsmodell kan dela en sned fördelning | Krav på en verklig dal i histogrammet | Eget regressionstest |
| 4 | Modellskyddet rullade tillbaka i onödan, cirka 10 % av besluten, mot förväntade högst 2,5 % | Inlärning med fast takt varierar hela tiden kring optimum | Krav på praktisk betydelse (> 0,05 nat) och färre beslutstillfällen | 1 återställning på 100 × 4000 etiketter, utan försämring |
| 5 | Guard kunde fylla programloggen (43 200 händelser per dygn) | Händelser skrevs utan spärr | Spärr per nyckel med räknare | 24 händelser per dygn i stället för 43 200 |
| 6 | Filer lästes in utan storleksgräns, även av SYSTEM | Saknat krav | Storleksgränser, länkskydd i guard | Tester |
| 7 | Storleksgräns ensam gav ett "utgångsdatum" (beställarens granskning) | Ingen löpande pensionering av gammal data | Städtjänst och självläkning från reservkopia | 400-dygnssimulering: filerna planar ut |
| 8 | Skyddad kopia kunde pensioneras för en användare med manipulerad profil | Lagringstiden räknades från senaste skrivning | Räknas från "senast sedd" | Kodgranskning före commit |
| 9 | Insamlad profil innehöll pausernas tidpunkter | Hela profilen exporterades | Insamlingen rensas från aktivitetstider | Test `CollectedProfile_CarriesNoActivityTimes` |
| 10 | Profilens `AppVersion` visade skaparens version | Fältet uppdaterades aldrig | Sätts vid varje sparning | Upptäckt i pilot (skärmdump) |

| 11 | Grindens fönster mätte fel sak. Fältprofilen (en pilotdator, 0.7.0) hade 362 episoder på 4–5 timmars användning, minst 85 % under 30 s. 200 episoder täckte cirka 2,7 timmar i stället för "≈ 11 arbetsdagar", och kravet på högst 10 % fel per episod späddes ut ungefär 10 gånger | Antagandet om episodtakten (18 per dag) kom från simuleringen och verifierades aldrig mot verklig användning. Simuleringen saknade korta pauser | Bara **beslutstillfällen** räknas: episoder med ett beslut eller minst 30 s utan. Fönstret kräver minst 200 tillfällen **och** minst 5 olika dagar. Simuleringarna använder den uppmätta fördelningen. Befintliga fönster nollställs vid uppgraderingen | Fältreproduktion (Python och C#): 0.7.0-regeln släpper igenom en modell med ett fel eller ett overifierat beslut per timme, 0.7.1-regeln gör det inte. En användare utan fel godkänns dag 15 |
| 12 | Första versionen av rättning 11 (fast fönster på 200 plus krav på 5 dagar) gjorde befordran **omöjlig** för CAD-användaren, som har cirka 55 beslutstillfällen per dag. Upptäckt av CAD-simuleringen före release | Två villkor som inte alltid kan uppfyllas samtidigt | Tidsmedvetet fönster: det kortaste nyaste avsnittet med minst 200 tillfällen på minst 5 dagar, högst 1000 sparade. Äldre poster rensas | `HeavyUser_WindowGrowsToFiveDays_AndCanBePromoted`. CAD-simuleringen går till skarpt läge dag 21–23 |
| 13 | Kvalitetslarmet (1010) jämförde den **övre** 95 %-gränsen med målet. Det betyder "inte bevisat bättre", inte "sämre", och gav falsklarm för 98 % av användarna med verklig felandel 5,5 % och för 28 % vid 3 %. Utspädningen (nr 11) dolde felet | Larmregeln var aldrig styrkeberäknad | Larm när **uppmätt** andel > mål, återställs vid 80 % av målet. Grinden behåller den övre gränsen, eftersom påslag ska vara bevisat | 200 simulerade användare × 1000 tillfällen: 0 % larm vid 3 %, 10,5 % vid 5,5 %, 100 % vid ≥ 12 % (vid första fulla fönstret). **Obs:** larmkriteriet ändrades efter att utfallet observerats, och det redovisas här |
| 14 | En användarkorrigering från notisen vände den *senaste* fönsterplatsen, inte det flaggade beslutet | Antog att inget registrerades mellan beslutet och flaggningen | Platsen för det senaste beslutet sparas och vänds | `UserCorrection_FlipsTheFiredDecision_NotTheLatestEpisode` |
| 15 | Fältprofilen kunde inte besvara tre frågor: sågs något CAD-program, var det fjärrskrivbord, och varför skapades profilen på nytt? | Saknade räknare | Räknare per programtyp och för fjärrskrivbord (bara antal). Profilens ursprung sparas ("first start", "recreated: …", "seeded from baseline"). `--diagnose` och `verify/analyse_profile.py` | `DiagnosticsTests` (6). Fixturen ger identiska siffror i Python och C# |
| 16 | Baslinjeexporten nollställde inte beslutstypfönstret (0.7.0) | Fältet tillkom utan att exportfunktionen följde med | `ModeController.ResetCalibration()` används av exporten | `ExportBaseline_KeepsWeights_DropsIdentity_ResetsCalibration` |
| 17 | Dokumentationsfel: `TimeDepartPrior` beskrevs som inlärd (den är en fast kurva), `HoldStarts` omfattar även användarpauser, och kommentaren "≈ 11 arbetsdagar" var fel | Antaganden skrevs som fakta | Rättat i koden och i README | Granskning |

### Lärdomar som ändrar arbetssättet (10.3)

1. **Fältdata före antaganden.** Varje antagande som en grind eller ett larm vilar på (episodtakt, fördelningar) jämförs med uppmätt fältdata, och avvikelser blir avvikelserapporter. Simuleringarna kalibreras mot fältprofilen, och den kalibreringen ingår i verifieringen.
2. **Varje pilotprofil analyseras på samma sätt.** `PresenceLock.exe --diagnose` på datorn, eller `verify/analyse_profile.py` på en exporterad fil. Analysen är kod, inte handarbete.
3. **Larm och grindar styrkeberäknas** (andel falsklarm och upptäcktsförmåga) innan de införs.
4. **Kriterier sätts före körningen.** Ett kriterium som ändras efter att utfallet setts redovisas uttryckligen som en sådan ändring (nr 13).
5. **En simulering som inte kan misslyckas bevisar inget.** Nya villkor körs mot den användartyp de kan slå hårdast mot (nr 12) innan de godkänns.

### Extern granskning 2026-11-12 (9.2/10.2)

Den externa granskningen av 0.6.1 rapporterade 30 fynd, varav 7 med prioritet P0. Varje fynd har status, åtgärd, belägg och kvarstående del i `docs/review/2026-11-12-granskning-atgarder.md`. Granskarens reproducerade testfall är införda som regressionstester. **Validering i avsedd miljö (Windows-acceptans W01–W18) är inte gjord.** Releasen är därför en utvecklingskandidat.

## 5. Uppföljning och mätning (9.1)

Programmet mäter sig själv i skarpt läge:
- andel felaktiga dämpningar per beslutstillfälle (minst 200 tillfällen över minst 5 dagar). Larm 1010 när den uppmätta andelen överstiger målet, och 1011 när den åter ligger under 80 % av målet. Wilson 95 %-övre gräns visas som osäkerhetsmått;
- tid olåst före bekräftade lås, de senaste 50;
- modellskyddets beslut;
- städtjänstens körningar.

Källor: `--status`, `--diagnose` och händelse 1010–1016. **Förslag:** gör ett kvartalsvis uttag från ett urval datorer till ledningens genomgång (9.3).

## 6. Ständig förbättring (10.3)

- **Kontinuerlig inlärning med kontroll:** varje modelländring jämförs mot den senast godkända på osedda etiketter och rullas tillbaka om den är sämre (händelse 1012).
- **Kvalitetsvarning** (1010) när målet överskrids. Åtgärd: granska parametrarna, till exempel taket för horisonten.
- **Lagringstider och städtjänst** utan manuella moment.

## 7. Risker och möjligheter (6.1) för produkten

Se NIS2-åtgärdsbeskrivningen avsnitt 5 och DPIA avsnitt 4. Största öppna risken: **validering i skarp miljö saknas**. Åtgärd: pilot enligt checklistan.
