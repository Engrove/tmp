# Säker svarsfångst och observationsspår i Greenfield 1.8.2

Underlaget är en diagnostikexport från den live-körda 1.8.0-sessionen, 2026-09-24 10:03Z.

## Fynd i exporten (verifierat ur filen)

- **Fångst av halvfärdiga svar.** Av 78 registrerade turer har 45 färre än 50 tecken. Av 26 lagrade svarstexter är 17 korta, och samtliga 17 är ett JSON-objekt som öppnats men inte stängts, till exempel `{`, `{"` eller `{\n"schema": "eic.a2a`. I två av dem står ett bilagekort före objektet (`…v2.jsonFil{…`, `…pdfPDF{…`), och i en har webbkällor skjutits in mitt i texten. Fångsten skedde efter 5–30 min med Greenfields genereringssignal falsk. Alla 9 fullständiga svar är stängd JSON.
- **Följd.** Greenfield analyserade ett icke-svar och skickade nästa prompt medan det riktiga svaret fortfarande skrevs. I `5df3f599` fångades `{` från nod `…-6` 09:50:29, tur 13 skickades 09:55:52, och samma nod blev färdig 10:00:18. Det registrerades som `EXTERNAL_TURN_INTERLEAVED`.
- **`P:3182ea75`, tur 2.**
  - Skickad 05:39:18.
  - Kl. 06:02:07 såg Greenfield ett nytt färdigt svar och startade om 120-minutersklockan (`lastMaterialAt`, `STALE_SESSION_COUNTER_RESET`), men godkände det aldrig som svar på sin egen prompt.
  - Köbyte 08:02:08.
  - Vilken kontroll som underkände svaret går inte att se. Persistent Audit var av, och köbytet rensade kandidattillståndet.

## 1. Spärr: oavslutad JSON är inget färdigt svar

`lib/response-observation.mjs` `responseStructuralCompleteness(text)` bedömer ett svar som ofärdigt när något av följande gäller:

- texten börjar, efter en eventuell kodblocksetikett (`JSON`, ```` ```json ````), med `{` och objektet stängs aldrig;
- det första JSON-objektet med nyckel (`{"…`) någonstans i texten stängs aldrig;
- texten slutar med `{`.

Strängar och escape-tecken hanteras, så klamrar inuti strängar räknas inte. Prosa, stängd JSON och stängd JSON följd av prosa (till exempel `Status: CONTINUE / YIELD_TO_QUEUE`) är färdiga.

I `tickWaiting` görs kontrollen efter stabilitetsfönstret och före fångsten. Ett ofärdigt svar fångas inte, Greenfield fortsätter vänta, och 30/60/90/120-minutersstegen är fortfarande den yttre gränsen.

Replik mot exporten: alla 17 korta fångster hålls kvar och alla 9 fullständiga svar godkänns.

## 2. Varaktigt observationsspår

`process.responseObservationTrace` är en begränsad ring med poster `{reason, turn, promptHash, firstAt, lastAt, count, detail}`.

**`detail`** innehåller bara id:n, längder, flaggor och korta hashar, aldrig svarstext. Exempel:
- vilken användartur som förväntas och vilken som faktiskt hittades;
- assistentnodens id, kortad hash och textlängd;
- ägartyp och om ägaren är betrodd;
- sidans och svarets genereringssignaler;
- antal läsningar och ålder i stabilitetsfönstret;
- var JSON-objektet börjar.

**Orsaker som registreras:**
- `SAFETY_HOLD:<kod>`
- kausala spärrar, till exempel `AUTONOMOUS_ASSISTANT_NOT_OBSERVED`
- `AUTONOMOUS_RESPONSE_STILL_GENERATING` / `…_NOT_NEW`
- `RESPONSE_STABILITY_<orsak>`
- `RESPONSE_STRUCTURALLY_INCOMPLETE:UNTERMINATED_JSON_OBJECT`
- `RESPONSE_STABLE_ADMISSIBLE`
- `COMPLETED_ASSISTANT_SEEN_STALE_CLOCK_RESET`
- `EXTERNAL_TURN_INTERLEAVED`
- `WAITING_REFRESH_F5` / `…_CTRL_F5`
- `STALE_SESSION_120M_ROTATE`
- `AUTONOMOUS_RESPONSE_PRODUCER_LOST_REARM`
- `RESPONSE_CAPTURED`

**Skrivningar:** spåret skrivs bara när orsaken eller identiteten ändras. En oförändrad orsak uppdateras högst en gång per minut (`count`, `lastAt`). Hashar och längder under strömning räknas som detaljer och ger inga nya poster. I stabilitets-, reset-, eskalerings- och fångstvägarna följer spåret med i den skrivning som ändå görs.

**Livslängd:** spåret följer med i den parkerade `processSnapshot` vid köbyte. Högst 16 poster finns i en levande process och högst 8 i en parkerad.

**Diagnostikexport:** exporten har nu `responseObservation`, en lista per levande process och per parkerad köplats med spåret. Råposterna finns kvar under `storage`.

## Gränser

- **Äkta avhuggna svar:** ett svar som verkligen slutat med oavslutad JSON, till exempel på grund av modellens utmatningsgräns, fångas inte längre. Det hanteras av 120-minutersstegen: köbyte eller ny chatt.
- **Korta fragment som inte är JSON** fångas fortfarande om Greenfields genereringssignal är falsk. Grundorsaken, att genereringssignalen inte känner igen dagens ChatGPT-läge under långa djupgående svar, är inte åtgärdad. Spärren bygger på svarsformatet, inte på sidans uppbyggnad.
- **`P:3182ea75`:** orsaken är fortfarande okänd. Nästa export efter en upprepning visar den i `responseObservation`.
- **Lagring:** i värsta fall ungefär 15 KB per levande process och 7,5 KB per parkerad plats. Checkpointen dubblerar detta.
- Ingen live-acceptans i Chrome/ChatGPT är gjord.
