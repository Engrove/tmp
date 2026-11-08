# Greenfield v1.9.21 – köer och fastnade initieringar

Uppdatera samma installerade tillägg. Behåll dess uppdrag, köer, fönster och
originalkonversationer. Skapa inte parallella workers för att komma runt ett
blockerat uppdrag.

1. Pausa nya utskick i panelen och exportera en säkerhetskopia av inställningar
   och uppdrag. Pågående svar får slutföras.
2. Packa upp leveransen. Ersätt filerna i den befintliga installationsmappen
   med innehållet i `greenfield/`. Läs in samma tillägg igen via
   `chrome://extensions`; avinstallera det inte och radera inte tilläggsdata.
3. Öppna panelen och kontrollera att panel, bakgrund och sidbrygga visar 1.9.21.
   Återuppta nya utskick när uppdateringen är inläst.
4. Den ordinarie återställningskontrollen ska inom ungefär en minut hitta det
   avgränsade tillståndet från diagnostiken: ett färdigt, källbundet föregående
   svar och en oskickad fortsättning efter sessions-timeout. Köplatsen får
   ordinarie väntetid för återförsök. Andra körbara uppdrag kan fortsätta direkt.
5. En oförändrad initiering utan rätt hash får efter en minuts respit en enda
   begäran om kompletterad kvittens i samma verifierade konversation. Den får
   inte öppna projektet igen eller utföra arbetsåtgärder. Saknas kvittensen även
   efter det nya svaret och dess respit, parkeras bara den berörda köplatsen.
   Saknas körbara syskon går kön till uttrycklig väntan.
6. För en sådan parkerad plats visas **Försök initiera igen**. Använd knappen
   efter att det verkliga initieringshindret åtgärdats. Den behåller uppdrag,
   checkpoint och schema. Oklara tidigare utskick kan inte frikännas med knappen.

En global promptpaus, ett schema eller ett pågående svar är fortfarande normal
väntan. Ett gammalt svar blir inte aktuellt genom ett versionsbyte. Uppdragets
slutmål eller färdigstatus ändras inte av återställningen.

Den medföljande rapporten skiljer körda lokala regressionstester och loggreplay
från faktisk Chrome-drift. Installation och en verklig köväxling i 1.9.21 återstår
att verifiera i operatörens miljö.
