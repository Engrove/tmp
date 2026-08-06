# Root cause och fix — v0.7.6

## Observerat fel

Ett faktiskt EIC-AA/3-svar innehöll följande typ av värde i `workUnit.statement`:

```text
Skapa en initial sqlite databas i workbench och logga every fynd.”，“requestedAction":"Skapa en SQLite databas i workbench och logga every fynd.
```

`requestedAction` förekom alltså både som eget fält och som ett JSON-liknande fragment inuti `workUnit`.

## Verifierad källkedja

1. `sidepanel.js::normalizeDecision()` accepterade `value.workUnit` med endast text- och längdsanering.
2. `background.js::buildCandidate()` prioriterade detta värde framför den rena fallbackåtgärden.
3. `lib/prompt-contract.mjs::buildTurnObject()` kopierade värdet till `workUnit.statement`.
4. `renderTurnMarkdown()` renderade värdet oförändrat.

Ingen renderare konkatenerade fälten. Rotorsaken var avsaknad av cross-field-isolering vid både indata- och konstruktionsgränsen.

## Fix

`sanitizeIsolatedTurnField()` i `lib/prompt-contract.mjs`:

- sanerar och begränsar texten;
- identifierar turnobjektets syskonfältsnamn i JSON-liknande label-/kolonsyntax;
- stöder raka och typografiska citattecken samt ASCII- och fullbreddskomma/kolon;
- kastar `FIELD_ISOLATION_VIOLATION` med `fieldName` och `embeddedField`.

Grinden används i:

- `sidepanel.js::normalizeDecision()` för `workUnit`;
- `buildTurnObject()` före konstruktion av `workUnit.statement`.

Den dubbla grinden gör att även andra callers än Nano-normaliseringen inte kan skapa samma felaktiga envelope.

## Avgränsning

Vanlig prosa som nämner `requestedAction` utan label-/kolonsyntax tillåts. Fixen ändrar inte sessionstart, owner routes, APP_AUDIT_LONG, destruktivitetsklassificering eller persistence.
