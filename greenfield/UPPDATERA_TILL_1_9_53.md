# Uppdatera Greenfield till v1.9.53

## Vad versionen rättar

v1.9.53 tar bort worker-krockar som manuell eller permanent köstartsspärr.

- Ny processgeneration tar automatiskt över samma logiska GFW.
- Tidigare processgenerationer spärras med process-ID, inte enbart worker-ID.
- Gamla köplatser för samma GFW fasas ut med exakt worker-/queue-/item-identitet.
- Osäkra tidigare utskick förs över till en no-replay-karantän. Gammal prompt skickas aldrig igen.
- Tidigare `MISSION_OWNERSHIP_WAIT`-pauser återgår till READY vid köinläsning.
- Manuell worker-reconciliation och dess kvittensformulär är borttagna.
- En ny process i samma Chrome-fönster kan starta även om en äldre process från samma worker har ersatts.

Äkta ködataintegritetsfel isoleras fortfarande till den berörda köplatsen. Schemapauser, operatörsstopp, leverantörens modell-/kvotbegränsningar och skydd mot okänd effekt är inte worker-krockar och har inte tagits bort.

## Installation

1. Låt pågående ChatGPT-svar avslutas.
2. Packa upp `Greenfield_v1.9.53.zip`.
3. Ersätt innehållet i den befintliga tilläggsmappen med innehållet från `Greenfield_v1.9.53/greenfield/`.
4. Behåll samma Chrome-profil och installationssökväg.
5. Öppna `chrome://extensions` och välj **Läs in igen** för Greenfield.
6. Ladda om EIC-flikarna.
7. Kontrollera att både panelen och runtime visar `1.9.53`.

## Förväntat beteende efter uppdatering

- Panelen kräver inte längre att operatören öppnar en gammal konversation eller fyller i ett avstämningskvitto för att starta en ny session.
- Äldre worker-generationer för samma GFW markeras som överförda.
- Den nya sessionen får en ny prompt med instruktion att läsa aktuell ägarstatus och aldrig återspela tidigare utskick.
- Andra oberoende köplatser fortsätter enligt sin ordning och sitt schema.

Paketet ändrar inte den aktiva Chrome-installationen förrän det laddats in där.
