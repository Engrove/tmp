# Uppdatera Greenfield 1.8.12 → 1.8.13

1. Säkerhetskopiera tilläggsmappen och spara aktiv kö som kö-set.
2. Packa upp `EIC_Autonom_Agent_Greenfield_v1.8.13.zip` och kopiera innehållet över **samma mapp** som Chrome redan använder. Då behålls extension-ID, köerna, reservationen och fönstrens worker-bindning.
3. I `chrome://extensions`: välj **Läs in igen**. Panelen ska visa `Greenfield v1.8.13`.
4. Inga inställningar ändras. En tur som redan väntar fortsätter som förut och lämnar tillbaka sin plats vid nästa kontroll, om villkoren nedan gäller.

## Vad diagnostiken 2026-10-05 visade

Underlag: 4 fönster, Max parallella 2 med ett reserverat fönster, 532 utskick från 09-30 05:00 till 10-05 06:01 (alla tider UTC).

### Döda turer höll platsen i 120 minuter

- **30 utskick fick aldrig något färdigt svar** (22 FULL, 8 COMPACT, ungefär 6 % av båda). Ett 31:a pågick fortfarande när exporten gjordes och är inte medräknat.
  - Varje sådan tur höll sitt fönster och sin plats under hela stegen: F5 vid 30 min, Ctrl-F5 vid 60 och 90 min, köbyte vid 120 min.
  - Det var inte generering som höll platsen. Stegen skjuts upp så länge ChatGPT visar Stopp-knappen, och efter dessa turer kom nästa utskick 123–127 min senare.
- **Tid som gick förlorad** (budgetstoppen nedan är borträknade):
  - I den delade platsen för de tre övriga fönstren: 1 918 av 5 810 minuter (33 %).
  - I det reserverade fönstret: 1 337 minuter (23 %).
- **10-01 17:16–19:16 stod alla fyra fönstren stilla i 120 minuter.**
  - Båda platserna hölls av döda turer.
  - Ett väntande fönster skickade 2 sekunder efter att den ena turen gav upp.
- **Varför svaren uteblev syns inte i exporten**, eftersom granskningsloggen inte sparas som standard. Mönstret:
  - Ett uppdrag föll 7 gånger i rad med lika lång prompt och lyckades sedan med i stort sett samma prompt.
  - Antalet döda turer sjönk från 12 per dygn (09-30) till 2 per dygn (10-03 och 10-04).
  - Det pekar på ett tillstånd utanför Greenfield under perioden, alltså i ChatGPT eller på EIC-sidan. Det är en slutsats, inte avläst.

### Alla fönster stod still på grund av lokala budgetgränser

| Stopp | Gräns | Hur stoppet slutade |
|---|---|---|
| 10-02 17:16–19:16 | 24 h-tokenbudgeten | När ett utskick från dygnet innan föll ur 24 h-fönstret |
| 10-03 17:19–19:17 | 24 h-tokenbudgeten | Samma sätt (19:16:48 ett dygn, 19:16:54 nästa) |
| 10-04 23:35–10-05 04:19 | 24 h-tokenbudgeten | 11 s efter att policyn ändrades 04:19:10 |
| 10-03 23:35–10-04 11:59 (12,4 h) | 7-dygnsgränsen, 400 meddelanden | Ej avläst |

- **Tokengränsen.** Det enda värde som förklarar alla tre tokenstopp ligger mellan 2 593 009 och 2 601 143, alltså ungefär 2,6 M.
  - Värdet är inte avläst, eftersom exporten saknar äldre policyhändelser.
  - Nu är gränsen 3,2 M.
- **7-dygnsgränsen.** Utskick nummer 400 inom 7 dygn gjordes 23:35:38, och 400 är standardgränsen.
  - Det är en slutsats, inte avläst.
  - Nu är gränsen 1 000.
- **Svarsreserven räknas med.** Tokenbudgeten räknar varje svar som minst **Reserv per svar** (8 192).
  - Svaren var i median ungefär 2 000 token, så ungefär 6 000 token per utskick är reserv.
  - Det är en säkerhetsregel och har inte ändrats.

### Kostnad och rotationer

- **FULL-prompter.** 402 av 532 utskick (76 %) var FULL-prompter i ny chatt, ungefär 18 000 token mot ungefär 3 800 för COMPACT.
  - Varje köaktivering startar en ny chatt, så är kön byggd.
  - De flesta köplatser har kvant 1 och slutar med att AI:n lämnar över till kön.
  - Det är inget fel, men det avgör hur fort tokenbudgeten tar slut.
- **Rotationer.** Samma uppdrag startades om i ny chatt direkt efter ett färdigt svar bara 5 gånger (4 av dem i följd samma morgon).
  - Orsaken syns inte i exporten.
  - Inte heller en nystart 54 minuter efter ett utskick går att förklara därifrån.
- **De tre icke-reserverade fönstren** delar 1 plats. Den var upptagen 79 % av tiden, varav 33 % av döda turer.

### Missvisande återanslutningsrad

Raden **restored** i exporten visade en flera dagar gammal återanslutning under tiden för den senaste skanningen. Raderna samlas så länge service workern lever och hade ingen egen tid.

## Vad som ändras

### En död tur lämnar tillbaka platsen

**Villkor.** Turen lämnar tillbaka sin plats när allt detta gäller:

1. Det har gått minst 60 s efter Greenfields första omladdning vid 30 minuter.
2. Sidan är färdigladdad.
3. Varken Stopp-knapp, strömmande svar eller upptagen inmatning syns.
4. Inget svar har tagits emot.

**Vad som händer sedan:**

- Turen fortsätter att vänta, och stegen är oförändrad: Ctrl-F5 vid 60 och 90 min, köbyte vid 120 min.
- Kommer svaret senare läses det som vanligt. Ingenting skickas om.
- Ett annat fönster som väntar på platsen väcks och kan skicka direkt. I diagnostiken hade det kortat väntan bakom en död tur från 120 till ungefär 32 minuter.
- Visar sidan Stopp-knapp eller strömmande svar igen tar turen tillbaka platsen, även över Max parallella. Den släpper den inte igen förrän efter nästa omladdning. En upptagen inmatning ensam räcker inte, eftersom den också syns medan sidan laddar.
- Minutskanningen tar inte platsen åt en tur som har lämnat tillbaka den.
- På workerkortet står: ”Platsen lämnad tillbaka HH:MM: ingen generering efter omladdningen. Svaret läses ändå om det kommer.”

### Händelselogg i diagnostiken

Nyckeln är `eic.gf.incident-log.v1` och rymmer de senaste 400 raderna. Den innehåller bara id, koder, tal och flaggor; ingen prompt-, svars- eller sidtext sparas. Varje rad är något Greenfield gjorde av sig själv:

- **`STALE_LADDER_STEP`:** F5, Ctrl-F5 eller köbyte, med vad sidan visade just då:
  - Stopp-knapp, strömning och upptagen inmatning.
  - Om prompten hittades och om något svar fanns.
  - Spärrnotis, varning om för många förfrågningar och kvotnotis.
  - Laddningsläge och synlighet.
- **`STALE_TURN_SLOT_RELEASED`** och **`STALE_TURN_SLOT_READOPTED`**.
- **`SESSION_ROTATION_ARMED`:** varje ny chatt för samma uppdrag, med orsakskod och vem som begärde den.
- **`QUEUE_SLOT_PARKED`** och **`QUEUE_ITEM_ACTIVATED`:** köbyten med utfall och nästa köplats.
- **`SAFETY_HOLD_STARTED`:** en spärr som börjar eller byter kod, till exempel budget, modell eller kvot, med tid för nästa försök. Takten mellan utskick loggas inte.
- **`PROVIDER_CONTENT_BLOCK`**, **`TAB_RECOVERY_STEP`**, **`RESTART_RESTORED`** och **`SAFETY_POLICY_UPDATED`**.

Exporten tar också med:

- händelseloggen och en sammanställning per typ och kod (`incidents`);
- kapacitetsschemaläggaren (vem som har platserna och vem som väntar);
- promptgrinden.

### Mindre rättelser

- Policyhändelsen säger vad som ändrades, till exempel `messages7d 400→1000`.
- Raderna om återanslutning har egen tid (`atMs`).

## Rekommendationer

Allt här är ditt beslut. Inget av det är ändrat i leveransen.

- **Max parallella 3**, om ChatGPT tål det. Då delar de tre övriga fönstren på 2 platser i stället för 1.
- **Tokenbudget.** Med ungefär 110 utskick per dygn, 76 % FULL och reserven inräknad landade den räknade belastningen kring 2,6 M per 24 h.
  - Den nuvarande gränsen på 3,2 M ger marginal.
  - Det andra alternativet är att sänka **Reserv per svar**.

## Gränser

- **Omladdning under pågående svar.** Enligt ChatGPT:s egen kod frågar sidan efter en omladdning servern om svaret fortfarande skapas (`stream_status`) och hämtar konversationen när det är klart.
  - Om Stopp-knappen inte syns under den tiden räknas ett pågående svar som dött och platsen lämnas tillbaka medan det pågår.
  - Då kan det bli högst ett extra samtidigt svar per sådan tur. Svaret läses ändå.
  - Det är avläst i koden, inte uppmätt live.
- **Orsaken till de döda turerna är fortfarande okänd.** Nästa export visar vad sidan visade vid varje steg.
- **Live-Chrome är inte verifierat** i denna leverans. Panelens kortrad är kontrollerad i Chromium med den riktiga panelkoden.

## Om det ändå fastnar

Exportera diagnostiken och skicka den. Läs först:

- `incidents`, för en översikt;
- `storage["eic.gf.incident-log.v1"].rows`, rad för rad;
- `storage["eic.gf.global-capacity-scheduler.v1"]`, för vem som har platserna.
