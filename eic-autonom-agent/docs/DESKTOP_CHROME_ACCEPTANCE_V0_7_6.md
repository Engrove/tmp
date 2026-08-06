# Desktop Chrome acceptance — v0.7.6

## Förutsättningar

- Ladda det uppackade v0.7.6-installationspaketet i Chrome.
- Koppla och välj en användarförberedd ChatGPT-session.
- Kontrollera att ingen generation pågår.

## A. Normal continuation

1. Starta en vanlig Nano-continuation.
2. Låt Nano producera ett rent `workUnit`.
3. Verifiera att prompten levereras i samma valda flik.
4. Verifiera att `workUnit.statement` och `requestedAction.instruction` är separata.

Förväntat: continuation fungerar som i v0.7.5.

## B. Kontaminerat Nano-beslut

Mata i en kontrollerad testmiljö följande `workUnit`:

```text
Skapa en initial sqlite databas i workbench och logga every fynd.”，“requestedAction":"Skapa en SQLite databas i workbench och logga every fynd.
```

Förväntat:

- beslutet stoppas före promptleverans;
- felet är `FIELD_ISOLATION_VIOLATION`;
- ingen kontaminerad EIC-AA-envelope skickas;
- ingen ny ChatGPT-flik eller session skapas.

## C. Legitima omnämnanden

Använd `Kontrollera requestedAction innan nästa steg.` som arbetsenhet.

Förväntat: texten accepteras eftersom den inte använder syskonfältet i label-/kolonsyntax.
