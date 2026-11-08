# Uppdatera till Greenfield 1.9.19

1. Exportera en säkerhetskopia från den befintliga klienten. Pausa nya utskick.
2. Packa upp paketet. Ersätt innehållet i den befintliga tilläggsmappen med
   innehållet i den nya mappen `greenfield`. Behåll samma installerade tillägg.
   Avinstallera inte, radera inte Chrome-lagringen och skapa inte nya GFW-ID:n.
3. Öppna `chrome://extensions` och välj **Läs in igen** för Greenfield.
   Stäng och öppna sidopanelen. Kontrollera att både panel och körande motor
   visar **1.9.19**. Vid kvarvarande gammal brygga: ladda om den berörda EIC-fliken.
4. Återuppta nya utskick när versionerna stämmer. Den gamla transportspärren
   omprövas vid nästa kontroll; Pro ska verifieras med aktuell meny/kvittens.
   Ingen gammal arbetsprompt ska skickas om för att återställa dessa spärrar.
5. Kontrollera ett verkligt flöde: synligt leveransfel → Fortsätt 1/3, vid
   nytt fel 2/3 och 3/3 → vid kvarstående fel sparad BLOCKED-post och nästa
   körbara uppgift. Ett riktigt svar avbryter felkedjan. Pågående generering,
   kvotspärr, operatörspaus och okänd utskickseffekt har fortsatt egna spärrar.
6. Kontrollera samtidigt ett annat fönster: rätt uppdrag, egna räknare och
   oförändrat operatörsschema. Exportera diagnostik som livekvitto.

Efter tre misslyckade fortsättningar visas att originalsvaret behöver stämmas
av. Postens fulla checkpoint och konversationsreferens finns kvar i diagnostiken.
Denna version utför ingen automatisk ny start av den posten på oförändrat underlag.
Ett sent svar eller tidigare verktygseffekter måste läsas i originalkonversationen
före återupptagning; köväxlingen är inte bevis på att åtgärderna uteblivit.

Vid återgång: pausa utskick, återställ de tidigare programfilerna och läs in
samma tillägg igen. Behåll lagring och säkerhetskopia. Återgång till äldre kod
kan inte garantera samma spärrbeteende för nya checkpoints; granska dem först.

Status: lokalt verifierad källleverans. Installation i din Chrome och verkligt
GFW-/EIC-resultat ska inte kallas PASS förrän motsvarande kvitton finns.
