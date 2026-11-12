---
title: "NIS2 / cybersäkerhetslagen 124/2025 – åtgärdsbeskrivning: automatisk skärmlåsning (PresenceLock)"
status: "UTKAST"
---

# Åtgärdsbeskrivning: PresenceLock

## 1. Grund

- **Cybersäkerhetslagen 124/2025**, i kraft 8.4.2025, genomför NIS2-direktivet (EU) 2022/2555 i Finland.
  - 9 § 1 mom.: aktören ska vidta *proportionella tekniska, driftsrelaterade eller organisatoriska* åtgärder för att hantera risker mot säkerheten i kommunikationsnät och informationssystem.
  - 9 § 2 mom. punkterna 1–12 motsvarar direktivets art. 21.2.
- **Omfattas Elho?** Bedöms och registreras av Elho (**VERIFIERA**). NIS2 bilaga II omfattar tillverkning av maskiner (NACE C28) för medelstora och större företag.
- **Traficoms rekommendation** till tillsynsmyndigheterna om åtgärder för riskhantering (svensk version) beskriver per kapitel vad tillsynen verifierar: dokumentation, intervjuer och tekniska bevis. Kapitelindelningen nedan följer den.

## 2. Vad åtgärden gör

Den låser arbetsstationen när användaren har lämnat den. Den kompletterar skärmsläckarlåset med fast tid (GPO 15/30/60 min).

| Egenskap | Värde (standard, GPO-styrt) | Belägg |
|---|---|---|
| Avfärd med tydliga signaler | median 5–80 s, högst cirka 4 min (253 s) i simulering | README §4b, §6 |
| Avfärd som ser ut exakt som tyst arbete | låst senast efter taket + 15 s (10 min 15 s) | README §4b. Taket via GPO |
| Video, möte eller användarpaus | låst senast efter `HoldMax` + 15 s (15 min 15 s) | Egenskapstest med 500 slumpade modeller |
| Kan inte stängas av av användaren (NIS2-läge) | processen nekar avslut; guard-tjänsten låser sessionen inom cirka 4 s om agenten försvinner | README §7. Ej provat på Windows |
| Skydd mot manipulation av profil och pausbudget | skyddad kopia, sammanslagning som bara kan öka debiterad tid | Enhetstester |
| Spårbarhet | händelser 1000–1016 i programloggen | README §12 |

## 3. Koppling till 9 § 2 mom. och rekommendationens kapitel

| Kapitel i rekommendationen | Hur PresenceLock bidrar | Vad den *inte* täcker |
|---|---|---|
| 1 Riktlinjer för riskhantering och bedömning av effektivitet | Mätbar effekt: kvalitetsuppföljning i skarpt läge (andel felaktiga dämpningar, tid olåst före bekräftade lås), händelse 1010/1011, `--status` | Elhos riskbedömning och handlingsmodell |
| 6 Personalsäkerhet och utbildning i cybersäkerhet | Påminner genom att faktiskt låsa, och information om varför | Utbildning och instruktion om att själv låsa med Win+L |
| 7 Åtkomsthantering och autentisering | En obevakad session låses och kräver ny autentisering. Kompletterar fast skärmsläckartid | Behörigheter, MFA, kontohantering |
| 11 Grundläggande praxis för informationssäkerhet (bl.a. 11.10 säkert konfigurerade enheter, 11.13 loggning) | Centralt styrd konfiguration (GPO, ADMX). Revisionslogg för pauser och säkerhetshändelser | Övrig härdning |
| 12 Fysisk miljö och lokalsäkerhet | Minskar risken med obevakade skärmar i delade utrymmen (verkstad, mätrum, kontor) | Tillträdesskydd |

Rekommendationen innehåller inget uttryckligt krav på skärmlåsning. Åtgärden motiveras som en proportionell teknisk åtgärd enligt 9 § 1 mom. utifrån Elhos riskbedömning [[referens till risk]].

## 4. Bevis för tillsyn (förslag)

1. Detta dokument och beslutet om parametrar (GPO-export).
2. Testrapport: `verify/run_all.sh` (Python 33/33, C# 149/149 för version 0.6.x) och pilotprotokoll (pilotchecklistan punkt 1–16).
3. Utdrag ur programloggen: 1001 (agent stoppad, session låst), 1010 (kvalitetsvarning), 1015/1016 (pauser), 1006 (rensning).
4. `PresenceLock.exe --status` från ett urval datorer: läge, spärrens siffror, kvalitet, städtjänst, paus.
5. Konsekvensbedömning och samarbetsprotokoll (dataskydd).

## 5. Kända begränsningar (ska stå i riskregistret)

- **Windows-agenten är inte körd** på riktig hårdvara (kompilerad, enhetstestad logik). Pilot krävs.
- **Lokala administratörer** kan stänga av programmet. Det ligger utanför programmets skyddsmodell.
- **Musjigglers** (programvara eller hårdvara) kringgår alla lås som bygger på inaktivitet, även Windows eget. Det är en fråga för policy och disciplin.
- **Pausen kan skriptas.** Den kan bara förbruka budgeten och loggas.
- **En avfärd som ser exakt ut som tyst arbete** låses först vid taket. Det är en avvägning mot dämpningar av betraktande.
