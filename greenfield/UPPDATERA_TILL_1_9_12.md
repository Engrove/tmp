# Installera Greenfield 1.9.12

1. Packa upp paketet. Kopiera **hela innehållet i greenfield** till samma tilläggsmapp som Chrome använder för Greenfield.
2. Öppna `chrome://extensions` och klicka **Läs in igen** på Greenfield. Öppna därefter sidopanelen på nytt. I bifogad logg körde motorn fortfarande 1.9.10 medan panelen visade 1.9.11. [E201,E202]
3. Ladda om de ChatGPT-flikar som tillägget styr för att ersätta äldre innehållsskript. Den senare bilagans fel gäller en invaliderad tilläggskontext. [E208,E209]
4. Kontrollera raden **Körande motor v1.9.12** under panelrubriken. Om versionerna skiljer sig visar panelen nu en varning. [E206,E207]
5. I den aktiva EIC-fliken: välj **Kontrollera modell igen**. Den nya kontrollen verifierar maximum och köar återupptagningen för en sändande worker. Resultatet visar om kontrollen lyckades eller vilken spärr som återstår. [E206]

Om den gamla starten inte längre är ansluten till en flik: öppna avsedd EIC-flik, välj din uppdragskö och **Starta arbetskö**. En historisk frånkopplad process utan konversations-ID kan inte återanslutas enbart genom modellknappen. De två sådana posterna i bifogad logg är separata från den aktiva SENDING-processen. [E201; `lib/restart-recovery.mjs`]

För en ny installation väljer du **Läs in okomprimerat tillägg** och mappen greenfield. Ingen byggning behövs för användning; alla manifestfiler och runtime-moduler finns i paketet. [E207]

Verifierat här: 80/80 automatiska tester. Din inloggade Chrome-session har inte körts i testmiljön. [E206,A201]

Evidens-ID finns i `rare/evidence_log.md`.
