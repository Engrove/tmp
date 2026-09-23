# Uppdatera Greenfield 1.7.6 → 1.7.7

1. Pausa nya Greenfield-utskick.
2. Säkerhetskopiera den unpacked extension-mappen och relevant lokal state (spara gärna aktiv kö som kö-set).
3. Packa upp `EIC_Autonom_Agent_Greenfield_v1.7.7.zip`.
4. Kopiera innehållet över samma unpacked Chrome-mapp om samma extension-ID/lokal state ska behållas.
5. I `chrome://extensions`, välj **Läs in igen**.
6. Verifiera att panelen visar `Greenfield v1.7.7`.
7. Kontrollera en genererad A2A-prompt:
   - `promptProfile.profile` = `FULL` på första prompten i konversationen
   - `responseContract.runtimeControlContract` finns med `COMPLETE_MISSION`, `SET_QUANTUM`, `SET_PRIORITY` (köstyrd)
   - `control.runtimeControl.target` innehåller `runId`, `turn`, `queueId`, `itemId`, `savedMissionId`
8. Verifiera live att `DONE`/`STOP_PROCESS` pensionerar alla dubblettplatser för samma GFW.
9. Verifiera live att en operatörsändring efter prompten vinner över ett äldre AI-svar.

Befintliga köer, sparade GFW:er och kö-set läses utan migrering. Äldre köplatser får operatörens prioritetstak lika med sin nuvarande prioritet. Svar utan `runtimeControl` beter sig som i 1.7.6, förutom att terminala `DONE`/`STOP_PROCESS` nu verkställs.

Lokal paketverifiering kan verifiera koden och regressionerna. Den ersätter inte live Chrome/ChatGPT-acceptans.
