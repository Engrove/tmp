---
title: "PresenceLock – underlag för GDPR, NIS2 och ISO 9001"
subtitle: "Översikt och öppna punkter"
status: "UTKAST – ej granskat eller godkänt"
---

# PresenceLock – underlag för GDPR, NIS2 och ISO 9001

**Status: UTKAST.** Underlaget är skrivet av utvecklingen som stöd för Elhos egna dokument. Det är inte juridisk rådgivning. Allt i `[[dubbla hakparenteser]]` ska fyllas i eller beslutas av Elho. Punkter märkta **VERIFIERA** har inte kunnat kontrolleras mot en primärkälla.

| Dokument | Innehåll | Mottagare |
|---|---|---|
| [01 Dataskyddsbeskrivning](01-Dataskyddsbeskrivning.md) | Information till de registrerade enligt GDPR art. 13 | Alla användare |
| [02 Behandlingsregister](02-Behandlingsregister-art30.md) | Post i registret över behandlingar enligt art. 30 | Dataskydd |
| [03 Intresseavvägning](03-Intresseavvagning.md) | Rättslig grund, art. 6.1 f | Dataskydd |
| [04 Konsekvensbedömning (DPIA)](04-Konsekvensbedomning-DPIA.md) | Art. 35 | Dataskydd och ledning |
| [05 Samarbete och information](05-Samarbetsforfarande.md) | 759/2004 4 § och 21 §, samarbetslagen 1333/2021 | HR och personalföreträdare |
| [06 NIS2-åtgärdsbeskrivning](06-NIS2-atgardsbeskrivning.md) | Cybersäkerhetslagen 124/2025 9 §, bevisning | Informationssäkerhet och tillsyn |
| [07 ISO 9001-underlag](07-ISO9001-underlag.md) | Konstruktion och utveckling, verifiering, avvikelser, förbättring, versioner | Kvalitet |
| [08 Kort information till personalen](08-Kort-information.md) | Intranät- eller e-posttext | Alla användare |

## Dokumentstyrning (ISO 9001 7.5)

| Version | Datum | Ändring | Upprättad | Granskad | Godkänd |
|---|---|---|---|---|---|
| 0.1 | 2026-11-12 | Första utkast för PresenceLock 0.6.1 | Jan-Eric Enlund | [[ ]] | [[ ]] |

Källfilerna ligger i programmets repo under `docs/compliance/` och versionshanteras med programmet. Den gällande versionen ska föras in i Elhos dokumenthantering.

## Måste vara klart före införande i skarpt läge

1. **Samarbete med personalen** (Finland, 759/2004 21 §, i lydelsen enligt 945/2025, i kraft 1.1.2026). Syftet med, införandet av och metoderna för teknisk övervakning av arbetstagare ska behandlas i dialog enligt samarbetslagen 1333/2021. Företag som inte omfattas av samarbetslagen ska ge arbetstagarna tillfälle att bli hörda innan beslut. Se [05](05-Samarbetsforfarande.md). Det är försiktigast att behandla PresenceLock som teknisk övervakning, eftersom programmet registrerar inaktivitet per användare.
2. **Information före införandet** (GDPR art. 13 och 759/2004 4 §): [01](01-Dataskyddsbeskrivning.md) och [08](08-Kort-information.md) ska ha nått användarna. Om-rutan i programmet är ett komplement, inte en ersättning.
3. **DPIA** ([04](04-Konsekvensbedomning-DPIA.md)): systematisk övervakning och anställda som registrerade är två kriterier i EDPB:s riktlinjer (WP248). Normalt krävs då en konsekvensbedömning.
4. **Intresseavvägning** ([03](03-Intresseavvagning.md)) och **registerpost** ([02](02-Behandlingsregister-art30.md)) ska vara upprättade.
5. **Beslut om parametrar** via GPO: tak för inlärd horisont (standard 10 min), pausbudget (standard 120 min/dygn), om bekräftelsen ska gälla under paus (standard ja), lagringstider (30/180/90 dygn), om profiler ska samlas in (standard nej). Beslut och motivering ska dokumenteras.
6. **Juridiskt namn och kontaktuppgifter:** Om-rutan visar standard "Elho" som personuppgiftsansvarig. Ange det registrerade bolagsnamnet via GPO "Om-rutan" (OneDrive-namnet tyder på `Oy El-Ho Ab`, **VERIFIERA**). Ange också dataskyddskontakt och länk till den fullständiga dataskyddsbeskrivningen.
7. **Språk:** informationen ska finnas på ett språk som användarna förstår. Finsk version behövs om personal är finskspråkig ([[ ]]).
8. **Omfattas Elho av cybersäkerhetslagen?** NIS2 bilaga II omfattar tillverkning av maskiner (NACE C28) för medelstora och större företag. Bedömningen och registreringen hos tillsynsmyndigheten görs av Elho (**VERIFIERA**). PresenceLock är en motiverad säkerhetsåtgärd även om lagen inte gäller, men då kan NIS2 inte anges som grund i informationen. Om-rutans text skriver "där NIS2 gäller".
9. **Pilot** enligt README, pilotchecklistan punkt 1–17. Ingen del av Windows-agenten har ännu körts på en riktig dator.
10. **Windows-acceptans W01–W18** (extern granskning 2026-11-12, `docs/review/`). Den ska vara godkänd för exakt den releasehash som ska driftsättas.
11. **Säkerhetsgolv:** behåll Windows egen inaktivitetsgräns. PresenceLock får komplettera men inte ersätta den.
12. **Beslut per datamängd** (granskningen F29): ändamål, lagringstid och ansvar för gallring för profil, vanejournal, skyddad kopia, insamling, loggar och hjärtslag. Rekommendation: insamlingen avstängd under piloten.

## Källor som kontrollerats

- Cybersäkerhetslagen 124/2025, i kraft 8.4.2025. 9 § 1 mom. kräver proportionella tekniska, driftsrelaterade och organisatoriska åtgärder. 2 mom. punkterna 1–12 motsvarar NIS2 art. 21.2. Källa: Transport- och kommunikationsverket (Traficom), *Rekommendation till NIS-övervakande myndigheter om åtgärder för riskhantering* (svensk version), kyberturvallisuuskeskus.fi.
- Lag om ändring av 4 och 21 § i lagen om integritetsskydd i arbetslivet, 945/2025, utfärdad 29.10.2025, i kraft 1.1.2026 (Finlex).
- Europaparlamentets och rådets direktiv (EU) 2022/2555 (NIS2), art. 21.2 g (grundläggande cyberhygien och utbildning) och i (personalsäkerhet, policyer för åtkomstkontroll och tillgångsförvaltning).
- GDPR (EU) 2016/679, art. 5, 6, 13, 15–22, 25, 30, 32, 35. Artikel 29-gruppen WP248 rev.01 (EDPB-godkända riktlinjer om konsekvensbedömning).
