# Uppdatera till v1.9.24

1. Pausa nya utskick i Drift. Låt redan skickade svar bli färdiga och avstämda.
2. Ta en säkerhetskopia via Greenfields befintliga export. Behåll den nuvarande
   installationsmappen och tilläggets identitet. Radera inte tillägget eller dess data.
3. Ersätt programfilerna i samma installationsmapp med innehållet i paketets
   `greenfield/`. Behåll sökvägen; ladda inte in en andra kopia från en ny mapp.
4. Läs in tillägget på nytt i `chrome://extensions` och läs in de berörda
   ChatGPT-flikarna på nytt. Kontrollera v1.9.24 i panel, motor och overlay.
5. Kontrollera varje fönsters kö och sparade scheman. Scheman hör till en köplats.
   Flera körfönster är alternativa tillåtna tider. Ledig global kapacitet öppnar
   inte ett stängt schema. Uppdateringen ändrar inga sparade tider.
6. Återuppta nya utskick. Kontrollera att stängda platser väntar och att oberoende
   öppna platser går vidare. Skicka inte om ett osäkert tidigare utskick manuellt.

En ny initiering eller ett `Fortsätt` följer samma schemakontroll. En tur som
redan skickats får observeras och avslutas när schemat stängt. En pågående kvant
får inte en ny 180-minuters väntetid inför varje tur; kvantintervallet gäller vid
ny kvant enligt befintlig inställning.

Godkända lokala tester innebär inte verifierad installation eller 100 % PASS för
hela GFW-flödet. Verifiera fem verkliga fönster, två med stängda och tre med öppna
köplatser, samt schemaändring under väntande utskick. Diagnostiken ska knyta varje
postning till rätt process, worker, köplats, aktuell körevision och kontrolltid.

Ett redan komponerat meddelandes `control.workQueue.schedule` beskriver tiden då
meddelandet skapades. Originalhash och initieringskvittens bevaras. Vid normal
kvitterad postning finns den färska kontrollen i `lastPrompt.queueAdmission`;
den är ett tekniskt schemakvitto, aldrig bevis på färdigställt uppdrag.
