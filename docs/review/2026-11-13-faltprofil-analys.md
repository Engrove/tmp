---
title: "PresenceLock – analys av första fältprofilen och rättningar i 0.7.1"
date: 2026-11-13
status: "Utvecklingens analys, inte oberoende granskning"
---

# Första fältprofilen (2026-11-13) och 0.7.1

## Underlag

- En profil exporterad via ikonmenyn ("Exportera profil…") från en pilotdator.
- Lokal körning utan GPO, alltså med standardinställningar och utan NIS2-läge.
- Profilen skapades 2026-11-12 kl. 21:05 och uppdaterades senast 2026-11-13 kl. 11:54 (lokal tid, UTC+2).
- Under den tiden kördes tre versioner: profilen skapades av 0.5.2, pausen 21:23–21:53 gjordes under 0.6.0, och 0.7.0 har kört sedan 08:26.
- Identitetsuppgifterna (SID, datornamn) återges inte här.

**Metod.** Varje fält stämdes av mot koden och mot de andra fälten. Analysen är sedan 0.7.1 kod och kan upprepas: `python3 verify/analyse_profile.py <fil>` offline, eller `PresenceLock.exe --diagnose` på datorn.

## Resultat: profilen var konsistent

| Kontroll | Profilen | Resultat |
|---|---|---|
| Episoder och utfall i fönstret | 362 påbörjade och 364 utfall (fönstret har varvat: 200 + 164). Skillnaden är 2 Win+L direkt efter inmatning, som ger ett utfall utan episod | ✓ |
| Etiketter | 10 etiketter med vikt 13. Kodens vikter ger bara en lösning: 6 närvaro × 1 + 2 Win+L × 2 + 2 långa frånvaron × 1,5 | ✓ |
| Beslut | 9 = 6 fel + 2 overifierade + 1 rätt | ✓ |
| Medelvärde för fel | Räknat ur fönstret 0,0199749, lagrat 0,0199749 | ✓ |
| Valfria sensorer, paus, städtjänst, låskedja | Alla som förväntat | ✓ |
| Observerade avfärder 2, bekräftade 4 | Räknaren för observerade avfärder finns bara i 0.7.0 och senare | ✓ förklarat |

Modellen lärde sig i väntad riktning. Fabriksmodellen dämpar efter 37 s och låser efter 47 s. Den lärda modellen dämpar efter 147 s och låser efter 186 s i neutralt sammanhang. Den är 2,49 nat per etikett bättre än fabriksmodellen, mätt innan den lärt sig av respektive etikett.

## Fynd och rättningar

Numren motsvarar avvikelserna i [07 ISO 9001-underlag](../compliance/07-ISO9001-underlag.md).

| # | Fynd | Rättning i 0.7.1 | Belägg |
|---|---|---|---|
| 11 | **Grindens fönster mätte fel sak.** En episod startar vid 2 s inaktivitet. Profilen hade 362 episoder på 4–5 timmars användning, och minst 85 % var kortare än 30 s. 200 episoder täckte cirka 2,7 timmar i stället för "≈ 11 arbetsdagar", och felandelen späddes ut ungefär 10 gånger. Simuleringarna hade 18 episoder per dag och inga korta pauser | Bara **beslutstillfällen** räknas: episoder med ett beslut eller minst 30 s utan. Underlaget kräver minst 200 tillfällen **och** minst 5 olika dagar. Simuleringarna har den uppmätta fördelningen. Gamla fönster nollställs vid uppgraderingen | Fältreproduktion i Python (`run_verification.py` 6b) och C# (`GateTests.FieldProfile_*`). Ett fel eller ett overifierat beslut per timme: 0.7.0 befordrar dag 15, 0.7.1 aldrig. En användare utan fel befordras dag 15 |
| 12 | Den första rättningen (fast fönster på 200 plus krav på 5 dagar) gjorde befordran omöjlig för en CAD-användare med cirka 55 tillfällen per dag | Tidsmedvetet underlag: det kortaste nyaste avsnittet som uppfyller båda kraven, högst 1000 sparade. Äldre poster nollställs, dagnummer inräknade | CAD-simuleringen befordras dag 21–23. `HeavyUser_WindowGrowsToFiveDays_AndCanBePromoted`, `OutcomesOlderThanTheEvidence_AreCleared` |
| 13 | Kvalitetslarmet jämförde den övre 95 %-gränsen med målet. Det gav falsklarm för 98 % av användarna med verklig felandel 5,5 % och för 28 % vid 3 % | Larm när den uppmätta andelen överstiger målet, återställning vid 80 %. **Kriteriet ändrades efter att utfallet observerats**, och det redovisas här | Styrkeberäkning med 200 användare × 1000 tillfällen: 0 % larm vid 3 %, 10,5 % vid 5,5 %, 100 % vid ≥ 12 %. Kontorssimuleringen: inget larm med passiv paus (5,0–5,5 %), larm utan signaler (15–19 %) |
| 14 | En användarkorrigering från notisen vände den senaste fönsterplatsen, inte det flaggade beslutet | Det senaste beslutets plats sparas och vänds | `UserCorrection_FlipsTheFiredDecision_NotTheLatestEpisode` |
| 15 | Profilen kunde inte svara på om något CAD-program setts, om det var fjärrskrivbord eller varför profilen skapats på nytt | Räknare per programtyp och för fjärrskrivbord (bara antal). Profilens ursprung sparas. `--diagnose` och `verify/analyse_profile.py` | `DiagnosticsTests` (6). Python och C# ger identiska siffror på en syntetisk fixtur |
| 16 | Baslinjeexporten nollställde inte beslutstypfönstret | `ModeController.ResetCalibration()` | `ExportBaseline_KeepsWeights_DropsIdentity_ResetsCalibration` |
| 17 | `TimeDepartPrior` beskrevs som inlärd men är en fast kurva (toppar 09, 12, 15, 17). `HoldStarts` omfattar även användarpauser | Kommentarerna rättade | — |

## Acceptanskriterier (satta före körningen) och utfall

| | Kriterium | Utfall |
|---|---|---|
| A1–A2 | Ett fältliknande flöde med ett overifierat eller felaktigt beslut per timme godkänns av 0.7.0-regeln men inte av 0.7.1-regeln | uppfyllt (Python och C#) |
| A3 | En användare utan fel enligt fältfördelningen godkänns efter dag 15 | uppfyllt: dag 15 |
| A4 | Korta episoder utan beslut kommer inte in i underlaget | uppfyllt |
| A5 | Fönster från 0.7.0 nollställs, allt inlärt behålls | uppfyllt |
| A6 | Python-simuleringarna: tidigare säkerhetskrav oförändrade, högst 1 % av korta pauser dämpas | uppfyllt: 0 skarpa lås på närvarande, 0 dämpade korta pauser, 97,8–98,7 % av avgångarna låsta inom 180 s. Den tvetydiga användaren befordras inte (0.7.0: 2 av 5) |
| A7 | C#-simuleringarna (CAD och kontor): tidigare gränser oförändrade, inga lås och högst 1 % dämpningar i korta pauser | uppfyllt: CAD befordras dag 21–23 med 1 % dämpade studiepauser och 0 dämpade korta pauser |
| A8 | Bit-exakt paritet mellan Python och C# | uppfyllt: 28/28 parametrar, max avvikelse 0,0 |

Hela kedjan (`verify/run_all.sh`, 7 steg) passerar: Python 43/43, C# 188/188 och net48 med 0 varningar.

## Det som inte är belagt

- **Gränsen 30 s och andelen ≥ 85 % kommer från en enda profil**, från en dator och ungefär en halv dag. Pilotdatorerna ska analyseras på samma sätt (pilotchecklistan punkt 18) innan siffrorna kan räknas som representativa.
- **De tre öppna frågorna är fortfarande obesvarade för den analyserade profilen:** användes Inventor, var kvällen fjärrskrivbord, och raderades den äldre profilen? Profilen skrevs före 0.7.1. Med 0.7.1 besvaras frågorna av `--diagnose` efter några dagars körning.
- **Upprepad prövning (F19).** Kravet på 5 dagar hindrar en ensam lugn eftermiddag från att avgöra, men grinden prövas fortfarande om efter varje episod.
- **Windows-acceptans W01–W18 är inte gjord.**
