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

**Utdata (8.3.5):** källkod, binär, ADMX/ADML (en-US, sv-SE), README med kravspårning (§2), detta underlag.

**Granskning (8.3.4):** varje version granskas mot kraven med uppmätta resultat i commit-meddelandet och README.

**Verifiering (8.3.4):** `verify/run_all.sh` kör sex steg:
- Python-referensen (33 kontroller);
- DSP-kontroll;
- konsistens mellan ADMX och kod;
- paritetsfil;
- C#-testerna mot den riktiga motorn (149 för version 0.6.0, bit-identisk paritet 28/28 parametrar);
- bygge för .NET Framework 4.8 med 0 varningar.

Acceptanskriterier sätts **före** körningen och redovisas, även när de fallerar (se avsnitt 4).

**Validering (8.3.4):** **ej genomförd.** Validering i avsedd miljö sker i pilot enligt README, pilotchecklistan punkt 1–16. Ingen Windows-dator fanns i utvecklingsmiljön.

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
| 0.7.0 | se `RELEASE-MANIFEST.json` | Rättningar efter extern djupgranskning: låskedja, guard, policyscope, I/O, installation, releasemanifest | regressionstester T01–T14, se åtgärdsdokumentet |

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

### Extern granskning 2026-11-12 (9.2/10.2)

Den externa granskningen av 0.6.1 rapporterade 30 fynd, varav 7 med prioritet P0. Varje fynd har status, åtgärd, belägg och kvarstående del i `docs/review/2026-11-12-granskning-atgarder.md`. Granskarens reproducerade testfall är införda som regressionstester. **Validering i avsedd miljö (Windows-acceptans W01–W18) är inte gjord.** Releasen är därför en utvecklingskandidat.

## 5. Uppföljning och mätning (9.1)

Programmet mäter sig själv i skarpt läge:
- Wilson 95 %-övre gräns för felaktiga dämpningar över de senaste 200 episoderna;
- tid olåst före bekräftade lås, de senaste 50;
- modellskyddets beslut;
- städtjänstens körningar.

Källor: `--status` och händelse 1010–1016. **Förslag:** gör ett kvartalsvis uttag från ett urval datorer till ledningens genomgång (9.3).

## 6. Ständig förbättring (10.3)

- **Kontinuerlig inlärning med kontroll:** varje modelländring jämförs mot den senast godkända på osedda etiketter och rullas tillbaka om den är sämre (händelse 1012).
- **Kvalitetsvarning** (1010) när målet överskrids. Åtgärd: granska parametrarna, till exempel taket för horisonten.
- **Lagringstider och städtjänst** utan manuella moment.

## 7. Risker och möjligheter (6.1) för produkten

Se NIS2-åtgärdsbeskrivningen avsnitt 5 och DPIA avsnitt 4. Största öppna risken: **validering i skarp miljö saknas**. Åtgärd: pilot enligt checklistan.
