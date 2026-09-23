# Uppdatera Greenfield 1.7.5 → 1.7.6

1. Pausa nya Greenfield-utskick.
2. Säkerhetskopiera den unpacked extension-mappen och relevant lokal state.
3. Packa upp `EIC_Autonom_Agent_Greenfield_v1.7.6.zip`.
4. Kopiera innehållet över samma unpacked Chrome-mapp om samma extension-ID/lokal state ska behållas.
5. I `chrome://extensions`, välj **Läs in igen**.
6. Verifiera att panelen visar `Greenfield v1.7.6`.
7. Kontrollera en genererad A2A-prompt:
   - `control.ownerState.currentFocus.role` = `STEERING_POINTER_NOT_FACT_OWNER`
   - `responseContract.ownerStateRule` finns
   - focus-write är `MATERIAL_STEERING_OR_RESTART_DELTA_ONLY`
8. Verifiera live att stale `current_focus` inte replayar ett redan completed effect.
9. Verifiera live att unchanged restart state inte orsakar en focus-write-loop.

1.7.6 ändrar inte Greenfields scheduler/queue-arkitektur och stänger inte GF-001 issue #1 M3.

Lokal paketverifiering kan verifiera koden och regressionerna. Den ersätter inte live Chrome/ChatGPT-acceptans.
