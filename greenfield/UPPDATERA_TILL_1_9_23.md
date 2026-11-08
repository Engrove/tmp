# Uppdatera samma Greenfield-installation till v1.9.23

Den här ändringen rättar en kvarliggande initieringsspärr. Loggarna från
18 oktober visar att v1.9.22 skickade Projekt 71:s initieringsprompt efter
minimiintervallet på 180 sekunder. Det utskicket var inte permanent låst.

1. Spara diagnostik och återställningskopia före uppdatering. Använd **Pausa nya utskick** och låt ett pågående svar slutföras innan konversationens flik laddas om.
2. Packa upp paketet. Uppdatera den befintliga tilläggsmappen med innehållet i `greenfield/` och välj **Läs in igen** för samma tillägg i `chrome://extensions`. Behåll samma installation, lagring, fönster och konversationer.
3. Kontrollera **v1.9.23** i panelen, **Körande motor v1.9.23** och sidans Greenfield-overlay. En äldre sidbrygga kräver omladdning av originalkonversationen när dess pågående svar är klart.
4. Återuppta nya utskick. Vid nästa verifierade avläsning kan den gamla initieringsspärren rensas för samma session, köpost och användartur. En redan godkänd initiering görs inte om och dess arbetsinstruktion bevaras.
5. Kontrollera att `SESSION_INITIALIZATION_CONVERSATION_UNPROVEN` upphör när konversationen faktiskt verifierats. Därefter visas aktuell initieringsväntan eller utskickstid. Ett nytt svar ska fortfarande ha rätt kvittenshash innan arbetsinstruktionen släpps.

**Minst mellan utskick, s** är separat från parallell kapacitet och **Paus mellan analys och post**. De observerade värdena 180 respektive 115 sekunder behålls. Inga tider eller kvoter sänks av uppdateringen.

Om modellreglaget inte kan avläsas ligger modellspärren kvar tills färsk evidens finns. Ett historiskt max-kvitto ersätter inte dagens modellkontroll.

Lokala testresultat finns i `../verification/1.9.23/`. Installation och verklig drift av v1.9.23 är **NOT_VERIFIED** i leveransen. v1.9.22:s observerade utskick är inte ett driftkvitto för v1.9.23.
