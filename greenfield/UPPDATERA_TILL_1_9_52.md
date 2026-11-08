# Greenfield v1.9.52 – installation

1. Packa upp hela ZIP-paketet.
2. Ersätt innehållet i den befintliga Greenfield-extensionens katalog med kataloginnehållet i `greenfield`.
3. Öppna `chrome://extensions` och välj **Läs in igen** för Greenfield.
4. Ladda om EIC-flikarna som hanteras av Greenfield.
5. Kontrollera att både extension och service worker visar version `1.9.52`.
6. Öppna diagnostikpanelen och kontrollera att köposter återaktiveras efter en tidigare `QUEUE_WAIT` med observerad respons; en gammal prompt ska aldrig skickas igen.

## Vad som ändrats

- Återstart av terminal `QUEUE_WAIT` när endast causal-pairing-kvittot saknas efter en observerad respons. Återstarten går till en ny konversation med no-replay-karantän och färsk ägarinläsning.
- Exakt processidentitet används vid ownership/liveness-kontroll.
- Sessionsstartarkiv kan gzip-komprimeras utan dataförlust.
- Diagnostiken innehåller tydligare kö-/processidentitet och dispatchstatus.

Inga befintliga köer, scheman, prioriteringar, budgetar eller modellkrav behöver ändras manuellt.
