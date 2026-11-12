---
title: "Intresseavvägning (GDPR art. 6.1 f) – PresenceLock"
status: "UTKAST"
---

# Intresseavvägning: PresenceLock

Tretegsprövning enligt art. 6.1 f: berättigat intresse, nödvändighet och avvägning.

## 1. Berättigat intresse

Elho har ett berättigat intresse av att hindra att obehöriga använder en anställds inloggade session när datorn lämnats obevakad. En sådan session ger åtkomst till e-post, affärssystem, ritningar och kunddata i den anställdes namn. Intresset är:
- **verkligt och aktuellt:** obevakade olåsta datorer är en känd risk för obehörig åtkomst och spårbarhet;
- **lagligt:** det sammanfaller med kravet på åtkomsthantering och grundläggande säkerhetspraxis i cybersäkerhetslagen 124/2025 9 § (där lagen gäller) och med NIS2 art. 21.2 g och i;
- **tydligt avgränsat:** att låsa skärmen, inget annat.

## 2. Nödvändighet

| Alternativ | Varför det inte räcker ensamt |
|---|---|
| Användaren låser själv (Win+L) | Glöms bort. Det är just det fallet åtgärden ska täcka |
| Skärmsläckarlås efter fast tid (GPO 15/30/60 min, finns redan) | Lämnar datorn öppen hela tiden efter avfärd, och en kort tid stör den som läser eller studerar en ritning. En fast tid kan inte vara både kort och störningsfri |
| Närvarosensor eller kamera | Mer integritetskänsligt (bild), kräver hårdvara |
| Bluetooth-nyckel eller telefon | Kräver att varje användare bär en enhet. Faller när den glöms vid datorn |

PresenceLock använder den minsta mängd uppgifter som räcker för att avgöra *har gått* eller *sitter kvar*: tid sedan senaste aktivitet, musrörelsens karaktär, programtyp och om video eller möte pågår. Inget innehåll. Uppgifterna stannar på datorn och rensas automatiskt.

## 3. Avvägning mot den anställdes intressen

**Påverkan på den registrerade:**
- Ett tidsmönster för när personen är inaktiv vid datorn finns lokalt i 42 dygn (vanejournalen). Det är det mest känsliga. Det skulle kunna användas för närvarokontroll om det samlades in.
- En felaktig låsning stör arbetet.
- Känslan av att vara övervakad.

**Skyddsåtgärder som väger in:**
- Vanejournalen lämnar aldrig datorn. Den samlas inte in och tas inte med i den skyddade kopian.
- Den insamlade modellen innehåller inga aktivitetstider (testat i programmet, `CollectedProfile_CarriesNoActivityTimes`).
- Inget innehåll, inga tangenttryckningar, inga fönstertitlar, ingen kamerabild och inget ljud.
- Programmet dämpar skärmen innan det låser, så en musrörelse räcker. De första veckorna lär det sig utan att låsa. Tyst arbete som att läsa eller studera en ritning lärs in (uppmätt: cirka 1 % dämpningar efter inlärning).
- Pausfunktion med en begränsad budget per dygn, för långa avläsningar.
- Öppenhet: dataskyddsbeskrivning, kort information, Om-rutan i programmet med knappen "Öppna mina data", samt dialog med personalen enligt 759/2004 21 §.
- **Ändamålsbegränsning:** uppgifter från PresenceLock, inklusive pausposterna i händelseloggen, får inte användas för att följa upp arbetstid, närvaro eller prestation. [[Beslutas och dokumenteras i IT- eller personalpolicy.]]

**Rimliga förväntningar:** att en arbetsdator låses automatiskt är en förväntad och vanlig säkerhetsåtgärd. Att låsningen lär sig användarens arbetsrytm lokalt är det mindre förväntat. Därför behövs informationen och dialogen ovan.

## 4. Slutsats (förslag)

Intresset väger tyngre än intrånget, **förutsatt att** skyddsåtgärderna ovan genomförs och att ändamålsbegränsningen beslutas formellt. Den registrerade kan invända enligt art. 21. Elho prövar då om säkerhetsintresset väger tyngre i det enskilda fallet. Ett alternativ kan till exempel vara kortare fast skärmsläckartid för den användaren.

Beslut: [[ ]] Datum: [[ ]] Underskrift: [[ ]]
