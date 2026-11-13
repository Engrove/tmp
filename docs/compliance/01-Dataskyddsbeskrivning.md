---
title: "Dataskyddsbeskrivning – PresenceLock (automatisk skärmlåsning)"
subtitle: "Information enligt EU:s dataskyddsförordning (GDPR) artikel 13"
status: "UTKAST"
---

# Dataskyddsbeskrivning: PresenceLock

## 1. Personuppgiftsansvarig och kontakt

- **Personuppgiftsansvarig:** [[Oy El-Ho Ab – VERIFIERA juridiskt namn]], FO-nummer [[ ]], [[adress]]
- **Ansvarig för applikationen:** Jan-Eric Enlund, Elho
- **Kontakt i dataskyddsfrågor:** [[namn / dataskyddsombud, e-post]]

## 2. Ändamål

PresenceLock låser en arbetsstation automatiskt när användaren har lämnat den, så att ingen obehörig kan använda användarens inloggning, system och uppgifter. Behandlingen är en del av Elhos informationssäkerhet och åtkomsthantering, och där cybersäkerhetslagen (124/2025) gäller även av riskhanteringen enligt lagens 9 §.

Uppgifterna används **inte** för att följa upp arbetstid, närvaro, raster eller prestation. De används inte heller för något annat ändamål.

## 3. Rättslig grund

Berättigat intresse, GDPR art. 6.1 f: att skydda organisationens information och system mot obehörig åtkomst via obevakade datorer. Avvägningen finns i ett separat dokument ([[länk till intresseavvägningen]]). Om Elho omfattas av cybersäkerhetslagen sker behandlingen också för att fullgöra riskhanteringsskyldigheten i lagen (art. 6.1 c, **VERIFIERA** med dataskyddsansvarig).

## 4. Vilka uppgifter

Uppgifterna finns **lokalt på den dator du använder**, i din profilmapp `%LOCALAPPDATA%\PresenceLock`:

| Uppgift | Innehåll | Lagringstid |
|---|---|---|
| Inlärd modell (`profile.json`) | Siffervikter, räknare och utfallet av de senaste bedömningstillfällena (minst 200, spridda över minst 5 dagar) med **dagnummer utan klockslag**. Antal inaktiva perioder per programtyp (neutral, läs- eller ritprogram, "på väg bort") och i fjärrskrivbord, **bara antal**. Om profilen skapades första gången eller återskapades. Allt kopplat till ditt Windows-konto (SID) och datorns namn | Så länge du använder datorn. Dagnummer som inte längre behövs för bedömningen rensas vid varje ny bedömning. En kopia med samma innehåll förnyas dagligen som reserv |
| Tystnadsprofil (i profilen) | Hur långa dina tysta perioder brukar vara per typ av program, i form av räknare utan tidpunkter | Räknarna halveras var 14:e dygn |
| Vanejournal (`habits.json`) | Starttid och längd för dina inaktiva perioder, inget annat | 42 dygn, rensas dagligen. Lämnar aldrig datorn |
| Pauser (i profilen) | Start och slut för pauser du har valt | 24 timmar |
| Teknisk logg (`agent.log`) | Start, stopp, lägesbyten, fel, städning och pauser | 30 dygn |
| Windows händelselogg | Pauser (vem, när, längd), säkerhetshändelser (händelse 1000–1019): låsbegäran, bekräftelse, frånkoppling, signalfel | Enligt datorns inställning för programloggen [[ ]] |
| Hjärtslag (`HKCU\Software\PresenceLock\Agent`) | Tidpunkt när agenten senast svarade och dess processnummer. Skrivs över var 5:e sekund, ingen historik. Läses av bevakningstjänsten för att upptäcka en agent som hängt sig | Bara det senaste värdet |

**I NIS2-läge** [[om tillämpligt]] finns dessutom en skyddad kopia av profilen (inte vanejournalen) i `%ProgramFiles%\PresenceLock\state` på samma dator, så att skyddet inte kan nollställas. Den tas bort 180 dygn efter att du senast använde datorn.

**Insamling** [[om tillämpligt, annars stryk; rekommendation: avstängd under piloten]]: en gång per dygn skickas en kopia av modellen till en filresurs. Kopian innehåller vikter, lägesuppgifter och räknare. Den innehåller inte ditt Windows-konto (SID), datorns namn, livscykeltider, pausernas tidpunkter, bedömningstillfällenas dagnummer, tystnadsprofilen eller vanejournalen. Uppdateringsdatumet anges bara på dagsnivå. **Filnamnet (`DATOR_ANVÄNDARE.json`) identifierar dig.** Kopian är alltså personuppgifter om dig. Den används för att förbättra standardinställningarna och tas bort efter 90 dygn. Behörigheterna på resursen ska bestämmas så att användare inte kan läsa varandras filer [[verifiera]].

**Egen export** [[stryk om principen AllowProfileExport = 0]]: i ikonmenyn kan du spara en kopia av din profil som fil ("Exportera profil…"). Kopian innehåller allt i profilen, även SID, datornamn och pausernas tidpunkter, och hamnar där du själv väljer. "Exportera anonym baslinje…" ger bara vikterna utan identitet.

**Det som inte samlas in:** tangenttryckningar, skärm- eller dokumentinnehåll, fönstertitlar, webbhistorik, kamerabild, mikrofonljud och position. Om mikrofon eller kamera används läses bara av som ja eller nej, för att inte låsa under möten, och det sparas inte. Programnamnet i förgrunden används bara för att avgöra programtyp och sparas inte. Musrörelser används några sekunder i minnet och sparas inte.

## 5. Varifrån uppgifterna kommer

Från din dator: tid sedan senaste mus- eller tangentaktivitet, musrörelsens karaktär, programtyp, om video eller möte pågår, samt låsning och upplåsning.

## 6. Mottagare

- IT-administratörer med administratörsrätt på datorn kan läsa filerna och händelseloggen.
- [[Om händelseloggen skickas till ett SIEM eller en extern leverantör: ange mottagare och personuppgiftsbiträdesavtal.]]
- Uppgifterna överförs inte till länder utanför EU/EES.

## 7. Automatiserade beslut

Programmet bedömer automatiskt om datorn ska låsas. Låsningen har inga rättsliga följder och påverkar dig inte på liknande sätt i betydande grad: den låser skärmen, och du låser upp som vanligt. Innan låsning dämpas skärmen i några sekunder, och en musrörelse avbryter. Det är inte ett sådant beslut som avses i art. 22.

## 8. Dina rättigheter

Du har rätt att:
- få tillgång till dina uppgifter (art. 15). Knappen "Öppna mina data" i *Om PresenceLock* visar filerna;
- begära rättelse (art. 16) och radering (art. 17);
- begära begränsning (art. 18);
- **invända** mot behandlingen (art. 21). Elho prövar invändningen mot säkerhetsintresset;
- klaga hos tillsynsmyndigheten: i Finland **Dataombudsmannens byrå**, tietosuoja.fi.

Kontakta [[dataskyddskontakt]].

## 9. Skydd av uppgifterna

Uppgifterna lämnar inte datorn, med undantag för den valfria insamlingen ovan. Filerna skyddas av Windows behörigheter. Programmets egna filer har fasta storleksgränser och rensas automatiskt. Se den tekniska dokumentationen ([[länk]]).
