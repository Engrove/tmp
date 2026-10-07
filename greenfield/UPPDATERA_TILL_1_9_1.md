# Uppdatera Greenfield 1.9.0 → 1.9.1

1. Säkerhetskopiera tilläggsmappen.
2. Packa upp `EIC_Autonom_Agent_Greenfield_v1.9.1.zip` och kopiera innehållet över **samma mapp** som Chrome redan använder. Då behålls extension-ID och all lokal state, och de körkrav du har sparat i 1.9.0 kopieras till bokmärkesvalvet vid första start (se avsnitt 3).
3. I `chrome://extensions`: välj **Läs in igen**. Det räcker inte att starta om Chrome.
   - I testet (Chromium 141, samma mapp) startades Chrome om efter att filerna kopierats över. Manifestet och panelen var då 1.9.1, men bakgrunden rapporterade fortfarande `appVersion 1.9.0` och körde den gamla koden.
   - Först **Läs in igen** bytte bakgrunden till 1.9.1.
4. Panelen ska visa `Greenfield v1.9.1`. Under **Drift → Körkrav** står en rad som börjar med **Bokmärkesvalv:**. Se avsnitt 2 för vad den betyder.
5. Under **Övriga bokmärken** finns nu mappen **EIC Greenfield · Run requirements v1**. Radera den inte. Den får flyttas till en annan plats bland bokmärkena.

Version 1.9.1 rättar ett fel: sparade körkrav gick tillbaka till standardvärdena när Greenfield laddades från en ny mapp.

## 1. Felet i 1.9.0

**Symtom.** Du sparade körkrav (till exempel 48 utskick / 3 h). När Greenfield startades upp på nytt visade panelen standardvärdena 24 / 96 / 400 / 800000 / 24000.

**Orsak (reproducerad i Chromium).**
- Spara körkrav fungerade. Värdena låg kvar efter omstart av Chrome så länge tillägget laddades från **samma** mapp.
- Körkraven fanns bara i `chrome.storage.local`, och den lagringen tillhör ett extension-ID.
- Ett uppackat tillägg får sitt ID från mappens sökväg. Varje release-zip packas upp i en ny mapp med versionsnamn (`EIC_Autonom_Agent_Greenfield_vX/`).
- Laddas Greenfield från en sådan ny mapp blir det alltså ett nytt ID med tom lagring, och då gäller standardvärdena.

Mätt i testet (`verification/v191-safety-policy-vault-browser.json`):
- I mapp A sparades 48/256/1024/3600000/30000.
- Samma Chrome-profil med mapp B gav ett nytt ID. I 1.9.0 visade B då 24/96/400/800000/24000. I 1.9.1 visade samma steg 48/256/1024/3600000/30000.

Sparade uppdrag och kö-set överlevde redan ett nytt ID, eftersom de sedan tidigare också ligger i Chrome-profilens bokmärken. Körkraven gjorde det inte förrän nu.

## 2. Så fungerar 1.9.1

**Spara körkrav** gör två saker:
- skriver värdena i installationens säkerhetsjournal som förut, nu med sparningstid;
- skriver dem i bokmärkesvalvet: först till en mellanmapp, sedan läses de tillbaka och jämförs, och först därefter ersätts den gamla kopian.

**Vid start** (en gång per Chrome-session, och efter **Läs in igen**) jämförs installationens körkrav med valvets. Den **senast sparade** versionen i Chrome-profilen gäller:

| Läge | Vad Greenfield gör |
|---|---|
| Ny installationsmapp (nytt ID) och valvet har körkrav | Valvets körkrav tas i bruk. Händelseloggen visar `SAFETY_POLICY_RESTORED`. |
| Valvet är senare sparat än installationen och värdena skiljer sig | Valvets körkrav tas i bruk. |
| Installationen är senare sparad än valvet | Valvet skrivs om med installationens värden. |
| Värden från 1.9.0 (utan sparningstid) och tomt valv | Värdena kopieras till valvet. Gäller bara om de skiljer sig från standard. |
| Värden från 1.9.0 och valvet har en sparning | Valvet gäller, eftersom det har en känd sparningstid. |
| Standardvärden och tomt valv | Inget görs. |

**Ett fel i bokmärkena stoppar aldrig Greenfield.**
- Svarar bokmärkes-API:t inte inom 8 s, eller ger det fel, startar Greenfield med installationens egna värden. Panelen visar felet.
- Lyckas inte valvet vid **Spara körkrav** är värdena ändå sparade i installationen. Panelen säger det, och valvet skrivs om vid nästa start.
- En skadad eller ofullständig valvpost används aldrig. Den räknas som saknad.

**Raden "Bokmärkesvalv:" i panelen:**

| Text | Betydelse |
|---|---|
| sparat … | Valvet har just skrivits med dessa körkrav. |
| körkraven återställdes från valvet … | Installationen tog valvets körkrav vid start. |
| körkraven hämtades från valvet och stämmer … | Som ovan, i en senare start i samma Chrome-session. |
| stämmer med senaste sparning … | Installationen och valvet har samma sparning. |
| inget giltigt sparat värde … | Valvet saknar körkrav. Fyll i och tryck **Spara körkrav**. |
| kunde inte läsas eller uppdateras … | Valvet kunde inte användas. Värdena gäller bara denna installation tills det lyckas. |

## 3. Gränser

- **Körkrav sparade i 1.9.0 i en mapp du inte längre använder** finns inte i valvet. Uppdatera den gamla mappen på plats (steg 2–3 ovan), eller fyll i körkraven en gång och spara.
- **Bara körkraven** följer med till en ny mapp. Detta tillhör fortfarande extension-ID:t:
  - paus mellan analys och post;
  - Max parallella Greenfield;
  - Grundparametrar för uppdragskö: kvant, cooldown, pauser, hård reload och varm återupptagning;
  - processer, köer och förbrukningshistorik.

  Flytta dem med **Exportera/Importera säkerhetskopia**, eller uppdatera i samma mapp.
- **Säkerhetskopia:** har valvet en senare sparning än kopian vinner valvet direkt efter importen. Importmeddelandet säger det.
- **Chrome Sync:** är bokmärkessynk påslagen följer mappen med till andra datorer i samma Chrome-konto. Där gäller också senaste sparning.
- **Ingen `key` i manifestet.** En fast nyckel skulle ge samma ID i alla mappar. Men den skulle samtidigt byta ditt nuvarande ID, och då blir dagens lokala lagring oåtkomlig. Därför har den inte lagts till.

## 4. Kontroller i leveransen

- `node --test tests/v191-safety-policy-vault.test.mjs`: 16 tester. De täcker valvets skrivning, läsning och felvägar, regeln om senaste sparning, uppgradering på plats, ny mapp, skrivfel, ett låst bokmärkes-API, tidsgränsen och en sparning gjord när datorns klocka gick före.
- Hela sviten: `npm test`.
- Chromium (Playwright, riktig Chrome-profil):
  - spara i mapp A, ladda mapp B → återställt;
  - samma steg med 1.9.0 → standardvärden (negativ kontroll);
  - 1.9.0-värden, uppdatering på plats med **Läs in igen**, sedan ny mapp → värdena följde med.

  Resultaten finns i `verification/v191-*.json`.
