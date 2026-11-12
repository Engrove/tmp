---
title: "Konsekvensbedömning avseende dataskydd (GDPR art. 35) – PresenceLock"
status: "UTKAST"
---

# Konsekvensbedömning (DPIA): PresenceLock

## 1. Behövs en DPIA?

EDPB-godkända riktlinjer (WP248 rev.01) anger nio kriterier. Två eller fler innebär normalt att en DPIA krävs. Här är två uppfyllda:
- **systematisk övervakning:** inaktivitet registreras löpande per användare;
- **sårbara registrerade:** anställda, med tanke på beroendeförhållandet till arbetsgivaren.

Ett tredje kriterium, *ny teknik* i form av inlärd modell, kan diskuteras. **Slutsats: genomför en DPIA.** Kontrollera också Dataombudsmannens förteckning över behandlingar som kräver konsekvensbedömning (**VERIFIERA**).

## 2. Beskrivning av behandlingen

| | |
|---|---|
| Ändamål | Låsa obevakade datorer (informationssäkerhet) |
| Teknik | Windows-agent per användare. Lokal inlärd modell (logistisk modell per sammanhang), tystnadsprofil, vanejournal. Guard-tjänst i NIS2-läge |
| Uppgifter | Se dataskyddsbeskrivningen avsnitt 4 |
| Flöde | Allt lokalt. Valfri daglig insamling av modell utan aktivitetstider till administratörsresurs. Händelselogg lokalt [[eller till SIEM]] |
| Lagring | 24 h till 180 dygn beroende på uppgift. Automatisk rensning var 24:e timme |
| Antal registrerade | [[antal användare]] |

## 3. Nödvändighet och proportionalitet

Se intresseavvägningen. I korthet:
- **Uppgiftsminimering:** inget innehåll, inga tangenttryckningar, inga fönstertitlar, ingen kamerabild och inget ljud. Programtyp i stället för programnamn i lagrade data.
- **Lagringsbegränsning:** fasta lagringstider. Städtjänsten är verifierad i en 400-dygnssimulering där filerna planar ut (profil cirka 5 kB, journal cirka 116 kB).
- **Inbyggt dataskydd (art. 25):** vanejournalen är lokal och samlas aldrig in, och insamlingen rensas från aktivitetstider.

## 4. Risker för de registrerade och åtgärder

| # | Risk | Sannolikhet / konsekvens före åtgärd | Åtgärder | Kvarstående |
|---|---|---|---|---|
| R1 | **Ändamålsglidning:** uppgifterna (vanejournal, pausposter i händelseloggen) används för närvaro- eller prestationsuppföljning | Möjlig / hög | Journalen lämnar aldrig datorn. Insamlingen saknar aktivitetstider. Beslutad ändamålsbegränsning [[policy]]. Begränsad läsrätt till händelseloggen och SIEM [[ ]] | Låg, om policyn beslutas och efterlevs |
| R2 | **Felaktig låsning** stör arbetet eller ger känsla av kontroll | Trolig utan inlärning / låg till medel | Dämpning före låsning, inlärningsperiod utan låsning, inlärning av tyst arbete (cirka 1 % dämpningar efter inlärning), paus, kvalitetsuppföljning (händelse 1010) | Låg |
| R3 | **Bristande öppenhet** eftersom programmet är diskret ("stealth") | Möjlig / medel | Dataskyddsbeskrivning, kort information, Om-rutan med "Öppna mina data", dialog med personalen enligt 759/2004 21 § | Låg |
| R4 | **Obehörig åtkomst** till lokala filer | Osannolik / låg till medel | Windows behörigheter på profilmappen. Ingen överföring. Skyddad kopia endast för administratörer | Låg |
| R5 | **Ojämlik behandling:** användare med hjälpmedel eller som sitter stilla länge | Möjlig / medel | Inlärning per användare. Injicerad inmatning från hjälpmedel blockeras medvetet inte. Paus | Låg |
| R6 | **Pausloggen** visar när en enskild pausat | Säker (det är syftet med revisionsloggen) / låg till medel | Endast säkerhetsrevision. Behörighetsstyrd läsning. Lagringstid för händelseloggen [[ ]] | Låg |
| R7 | **Programfel** (krasch, korrupt fil) leder till omstart av inlärningen och därmed sämre skydd, eller till felaktiga lås | Möjlig / låg | Självläkning från reservkopia (händelse 1013), modellskydd (1012), storleksgränser, 149 automatiska tester. Pilot återstår | Låg till medel tills piloten är gjord |

## 5. Samråd

- Dataskyddsombud, eller ansvarig för dataskydd: [[yttrande, datum]].
- Personalen: genom dialog enligt samarbetslagen och 759/2004 21 § ([05](05-Samarbetsforfarande.md)). [[Protokoll]]
- Förhandssamråd med Dataombudsmannen (art. 36) behövs bara om en hög kvarstående risk inte kan hanteras. Bedömning: [[behövs inte / behövs]].

## 6. Beslut

[[Godkänd / godkänd med villkor / ej godkänd]] Datum: [[ ]] Beslutsfattare: [[ ]]. Ny bedömning: vid väsentlig ändring av programmet eller av insamlingen, dock senast [[datum]].
