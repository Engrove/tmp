# Uppdatera samma Greenfield-installation till v1.9.22

1. Exportera aktuell diagnostik och återställningskopia. Välj **Pausa nya utskick**; behåll befintliga uppdrag och konversationer.
2. Packa upp hela paketet. Uppdatera den befintliga tilläggsmappen med innehållet i `greenfield/`, eller använd samma etablerade uppdateringsmetod som tidigare. Klicka **Läs in igen** för samma tillägg i `chrome://extensions`. Skapa inte en andra installation med en separat lagring.
3. Kontrollera **v1.9.22** i panelen, **Körande motor v1.9.22** och sidans Greenfield-overlay. Om en gammal sidbrygga kvarstår, låt ett pågående svar slutföras innan originalkonversationens flik laddas om. Bevara fönster, köer och konversationsadresser.
4. Kontrollera de två befintliga inställningarna: **Paus mellan analys och post** respektive **Minst mellan utskick, s** under körkraven. I den analyserade körningen var de 115 och 180 sekunder. Uppdateringen sänker ingen operatörsinställd gräns.
5. Återuppta nya utskick. Verifiera att en tidsväntande worker skickar en gång efter den senare av sina tidsgränser, får korrekt svar och går vidare i samma uppdrag/kö. Prova med tre fönster och kontrollera att väntande uppdrag visas även innan de får en kapacitetsplats.

En tidigare 1.9.21-post utan verifierad klicktid backdateras inte. Dess befintliga tidsgräns kan därför gälla ytterligare en gång. Ett osäkert utskick avstäms mot sin originalkonversation; uppdateringen skickar inte om uppdraget för att bli av med väntan.

Kvotspärr, operatörspaus, schema, ägarbyte, modellfel och osäkra sidoeffekter är fortfarande verkliga stoppvillkor. Att 1 av 3 kapacitetsplatser används betyder inte att nästa utskicks tidsvillkor redan är uppfyllt.

Lokala tester och källkodskontroller dokumenteras i `../verification/1.9.22/`. Installation och verkligt GFW-flöde i operatörens Chrome är ännu **NOT_VERIFIED** i denna leverans. Versionsavsnitt för äldre utgåvor är historik.
