# Installera Greenfield 1.9.13

1. Kopiera **hela innehållet i greenfield** till samma tilläggsmapp som Chrome använder för Greenfield.
2. Öppna `chrome://extensions` och välj **Läs in igen** för Greenfield. Öppna sedan sidopanelen på nytt.
3. Ladda om de ChatGPT-flikar som tillägget styr. Bakgrunden byter då ut sidkoden, eftersom bryggversionen inte längre är `APP_VERSION` (`background.js:662–676`).
4. Kontrollera att panelen visar **Körande motor v1.9.13**.
5. En worker som står kvar i `SENDING` med spärren `THINKING_CONTROL_AMBIGUOUS` kontrolleras igen automatiskt inom cirka 30 s. Vill du inte vänta väljer du **Kontrollera modell igen**. [E310]

Om spärren ändå återkommer: välj **Exportera diagnostik**. Exporten innehåller nu `ordinalCandidates` med `describedBy`, och det avgör det öppna antagandet A301.

**Verifierat här:** 86/86 automatiska tester och en fältbaserad rigg (0/10 fel efter åtgärden mot 10/10 före). Din inloggade Chrome-session har inte körts. [E317, E319, A303]

Evidens-ID finns i `../rare/evidence_log.md`.
