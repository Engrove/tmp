# Uppdatera till Greenfield 1.9.17

1. Låt ett pågående utskick och svar avslutas. Stoppa arbetskön vid en säker gräns;
   uppdatera inte genom att avbryta en tur med okänd effekt.
2. Packa upp leveransen. Uppdatera hela innehållet i `greenfield/` i **samma
   tilläggsmapp** som Chrome redan använder. Behåll en kopia av föregående filer.
   Avinstallera inte tillägget och radera inte lokal lagring.
3. Öppna `chrome://extensions` och välj **Läs in igen** för Greenfield. Öppna
   sidopanelen igen. Kontrollera att panel, manifest och **Körande motor** visar
   **1.9.17**. Uppdatera ChatGPT-fliken vid behov, när ingen tur pågår.
4. Under **Drift → EIC:s startadress** visas adressen som används vid ny bindning.
   EIC:s kända standardadress medföljer, så ett manuellt testmeddelande behövs inte.
5. Starta den befintliga arbetskön från en ChatGPT-flik. Greenfield navigerar till
   rätt GPT och gör sina vanliga kontroller före initiering och arbetsprompt.

## Ändra EIC-adressen utan kod

Klistra in GPT-adressen eller en full EIC-konversationsadress i **GPT-adress** och
tryck **Spara startadress**. En konversationsadress sparas som GPT-rot: `/c/...`
följer inte med. Inställningen finns kvar vid omstart av samma tillägg.

Adressen måste använda HTTPS på `chatgpt.com` eller `chat.openai.com`, med sökväg
`/g/g-...`. Projektadresser, inloggningsuppgifter, query-parametrar och fragment
nekas. Tomt fält tar bort det manuella valet och använder tidigare observerad
adress, eller EIC-standard om ingen sådan finns.

Inställningen ändrar **nya bindningar**. Pågående och parkerade missioner behåller
sin GPT. Ett adressbyte flyttar inte automatiskt ett pågående uppdrag eller dess
frusna terminalmål. En flytt av ett redan bundet uppdrag måste hanteras med dess
bevarade checkpoint och effektkvitton; skapa inte dubbletter eller radera tillstånd.

Startadress och observerad identitet är separata värden. En sparad adress säger
inte att EIC är tillgängligt för kontot eller att rätt modell är vald. Modell-,
identitets-, kvot-, operatörs- och utskicksspärrar gäller fortfarande.

## Installation och verifieringsnivå

Tillägget körs direkt från `greenfield/`; npm behövs bara för utvecklingstester.
För reproduktion: `npm ci --ignore-scripts --no-audit --no-fund`, därefter `npm test`.
Leveransens testkvitto anger vilka kommandon som faktiskt kördes här.

De lokala testerna ersätter inte observation i din Chrome-session. Kontrollera
att start från EIC vid `/` fungerar, att rätt GPT binds och att första utskicket
sker en gång. Spara aktuellt diagnostik-/ägarkvitto innan driftacceptans hävdas.
Fortsatt arbete och slutacceptans följer reglerna från v1.9.16.

## Återställning

Vid ett konkret fel: stoppa vid säker gräns, återlägg föregående kompletta
filer i samma mapp och läs in tillägget igen. Radera inte missioner eller kvitton.
Den nya startadressinställningen ignoreras av v1.9.16; den versionen kan därför
åter visa det ursprungliga felet när EIC-adressen saknas.
# Korrigerad kandidat: Initialization ACK

Använd ZIP-filen med `Initialization_ACK` i namnet. Den korrigerar även
initieringsstoppet som finns i den tidigare v1.9.17-byggnaden.

Uppdatera samma tilläggsmapp, läs in tillägget igen och öppna panelen på nytt.
Behåll lokal lagring och köer. Vid en ännu pågående operativ tur, invänta ett
färdigt svar före omladdning. De diagnostiserade äldre READY-initieringarna
uppgraderas automatiskt om svarskopplingen och den osända uppdragsprompten kan
verifieras; ingen ny mission eller ny köpost skapas.

Kontrollera `Senast kontrollerad`, fasta uppdragskort och en initieringsprompt
med en unik kvittenshash. Versionsfältet är fortsatt 1.9.17. Denna byggnads
källhash, testkvitton och avgränsningar finns i `../verification/1.9.17-ack/`.
Faktisk Chrome-körning är inte verifierad av de lokala testerna.

---

