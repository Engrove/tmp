# Uppdatera till Greenfield 1.9.15

1. Pausa befintliga workers och köer. Exportera diagnostik och spara den tidigare
   tilläggsmappen samt den befintliga konfigurationens återställningskopia. Ett
   osäkert redan skickat arbete ska rekoncileras i sin ursprungliga konversation.
2. Packa upp ZIP-filen. Ersätt hela innehållet i den **befintliga** tilläggsmappen
   med innehållet i paketets `greenfield/`. Lägg inte bara bakgrundsfilen ovanpå
   äldre moduler, och läs inte in en andra parallell installation.
3. Öppna `chrome://extensions`, välj **Läs in igen** för rätt tillägg. Ladda om
   tillhörande ChatGPT-flikar så att också innehållsbryggan uppdateras. Öppna
   sidopanelen på nytt. Kontrollera att tillägg, panel och **Körande motor** visar
   v1.9.15 och att ingen versionsvarning återstår.
4. Behåll tidigare sparade missions-ID:n, köplatser och historik. Återställ inte
   en hel gammal storage-dump ovanpå körande ny kod. Befintliga tillstånd läses
   med de gamla normaliserarna; den nya broker-checkpointen börjar räknas när
   ett nytt giltigt svar har fångats. En osäker äldre gräns kan ge en tidig kall
   rotation för att etablera en bevisad konversation.
5. Uppdatera EIC:s befintliga skills och kunskap enligt
   `../EIC_v1.9.15_instruktioner.txt`. Anslut sedan den autentiserade ägarläsningen
   enligt `../eic-integration/OWNER_PROGRESS_CONTRACT.md`. Routen i exemplet är
   inte redan verifierad i drift. Klistra in endast den godkända endpoint-URL:en
   i panelens Drift-inställning för ägarläsning och spara. Ange aldrig en token
   eller ett lösenord i fältet. Sparad URL är inte ett lyckat ägarkvitto.
6. Prova först ett redan auktoriserat, avgränsat verkligt uppdrag. Kontrollera
   del-PASS → nästa arbete, beroende-WAIT utan nya AI-promptar, paus/STOP, rätt
   savedMissionId och root efter rotation samt avslut med verkligt ägarkvitto.
   Spara version och exakta readback-referenser före påståendet att beteendet
   är aktiverat i Chrome. Återuppta övriga uppdrag när detta är verifierat.

## Vad ändras i körningen?

Ett modell-DONE räcker inte längre för missionens avslut. En giltig ägarläsning
kan i stället välja nästa avgränsade åtgärd i samma slot. En spärrad gren kan
lämna andra oberoende grenar/slots körbara. WAIT behåller missionen och gör inga
nya AI-utskick utan ändrad ägarrevision eller aktuell operatörsinstruktion.

Ordinarie icke-terminalt arbete fortsätter med befintliga grindar även om den
nya ägaradaptern saknas. Full ägarstyrd grenplanering kräver integrationen.
Terminalförsök utan giltig ägarkälla får högst en återläsningsprompt och går
sedan till WAIT. Panelen visar orsak och återstartsvillkor. En sparad ny endpoint
läser inte automatiskt omedelbart: nästa begränsade ägarkontroll eller en explicit
återkontroll återupptar den. Ändra inte status till DONE manuellt för att kringgå
saknat kvitto.

Sessionens tak är nu tre fullbordade kvantum eller femton operativa promptar,
det som nås först. Per-slot-kvantum, normalt fem, gäller separat. Rotation kan
ske tidigare av en verklig säkerhets-/identitetsorsak. Missionen avslutas inte
av rotationen. Initiering och samma turns transportfortsättning räknas separat.

## Återställning och tester

Vid återställning: pausa först, exportera det nya tillståndet och återställ hela
föregående kodmapp. Tänk på att äldre versioner saknar den nya terminalgrinden;
håll berörda missioner pausade tills deras verkliga ägarläge är kontrollerat.
Radera inte köer, workerhistorik eller osäkra effektkvitton.

Tester från `greenfield/`: `npm ci --ignore-scripts --no-audit --no-fund`, sedan
`npm test`. Node.js och testberoenden behövs för testerna, inte för tilläggets
vanliga körning. Kör från paketroten
`python3 verification/1.9.15/verify_release.py` för statisk paketkontroll.

Verifieringens exakta kommandon, resultat och avgränsningar finns i
`../verification/1.9.15/VERIFIERING.md`. Den levererade verifieringen omfattar
inte användarens inloggade Chrome eller EIC:s produktionsserver.
