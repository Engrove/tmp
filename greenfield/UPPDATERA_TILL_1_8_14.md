# Uppdatera Greenfield 1.8.13 → 1.8.14

1. Säkerhetskopiera tilläggsmappen och spara aktiv kö som kö-set.
2. Packa upp `EIC_Autonom_Agent_Greenfield_v1.8.14.zip` och kopiera innehållet över **samma mapp** som Chrome redan använder. Då behålls extension-ID, köerna, reservationen och fönstrens worker-bindning.
3. I `chrome://extensions`: välj **Läs in igen**. Panelen ska visa `Greenfield v1.8.14`.
4. Inga inställningar ändras. En process som redan står i ANALYZING när du uppdaterar följer de nya reglerna vid nästa omprövning.

## Nytt: ingen analys när kön ändå går vidare

Önskemål 2026-10-05: när en kvant är fullbordad, till exempel 1/1, 15/15 eller 1000/1000, ska svaret inte analyseras. Nästa steg är ändå nästa GFW i kön.

### Så var det i 1.8.13

- Varje svar kontrollerades av Nano och Hjalmar (”Kontrollerar svaret med Nano och Hjalmar”), även när kvanten var slut.
- Analysen tog fram en uppföljningsprompt till samma GFW, men den prompten skickades aldrig, eftersom kön genast bytte till nästa GFW.
- Det gällde också när svaret självt lämnade platsen till kön: `YIELD_TO_QUEUE`, `PAUSE_PROCESS` (som i din skärmbild, 3600 s vid 1/1) och `BACKGROUND_SLEEP`.

### Så är det nu

Greenfield parkerar köplatsen direkt och startar nästa GFW. Ingen analys körs och inget analysfönster startas.

**Detta görs precis som efter en analys:**

- Kvanträknaren nollställs vid fullbordad kvant. Vid tidigt köbyte på AI:ns begäran sparas räknaren, som förut.
- Runtime-kontroller i svaret verkställs med kvitton: kvant, prioritet och schema. AI:n kan inte höja prioriteten över din nivå; det avvisas med kvitto.
- Delegerade uppdrag (`missionDelegations`) registreras.
- En paus som AI:n begärt gäller, till exempel 3600 s.
- Schemaspärren kontrolleras.
- Checkpoint och sammanfattning sparas på köplatsen.

**Vad GFW:n tar med sig till nästa gång den kommer tillbaka:**

- Nästa steg är svarets eget `nextSuggestedAction`. Saknas det används uppdragets nuvarande mål.
- Analysfältet i prompten anger hur svaret togs emot och vad A2A-kontrollen sade. Fältet för Hjalmar är tomt (`null`), så ingen bedömning påstås som inte har gjorts.
- Det parkerade beslutet är märkt `QUEUE_BOUNDARY_NO_ANALYSIS`.

### När analysen fortfarande körs

Analysen körs som förut i alla fall där den kan ändra vad som händer:

- **Kvanten är inte slut** och svaret begär inget köbyte. Då ska nästa prompt till samma GFW planeras.
- **Ingen annan köplats kan ta över.** Då fortsätter samma GFW och behöver en planerad prompt.
- **Svaret saknar strukturerad A2A-kontroll**, till exempel ren text. Då är svarets status och nästa steg okända.
- **Status är inte CONTINUE**, till exempel DONE eller BLOCKED, eller svaret avslutar uppdraget (`STOP_PROCESS`, `COMPLETE_MISSION`).
- **Svaret begär en Nano-uppgift** (`NANO_TASK:`). Resultatet hör till GFW:ns nästa prompt.
- **Du har skrivit en instruktion** till nästa prompt för den här GFW:n.

### Var det syns

- Händelseloggen i diagnostiken får raden `ANALYSIS_SKIPPED_AT_QUEUE_BOUNDARY`, med utfallet: `QUANTUM_EXHAUSTED`, `EIC_YIELD_TO_QUEUE`, `EIC_PAUSE_PARKED` eller `EIC_BACKGROUND_SLEEP`.
- Köplatsens senaste utfall är detsamma som förut.

## Gränser

- **Hur mycket tid det sparar är inte uppmätt.** Exporten 2026-10-05 innehåller inte hur lång tid analysen tog.
- **Hjalmar ser inte svaret vid köbytet.** I 1.8.13 kunde Hjalmar på egen hand förklara en GFW klar eller blockerad vid kvantens slut, utan att AI:n hade sagt det. Nu avgör AI:ns egen status det: DONE eller STOP_PROCESS går fortfarande till full analys och avslut.
- **Live-Chrome är inte verifierat** i denna leverans.
