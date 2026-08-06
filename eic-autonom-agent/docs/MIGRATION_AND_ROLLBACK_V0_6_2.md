# Migration and Rollback — v0.6.2

## Schema

v0.6.2 behåller config/runtime/export schema v8. Ingen destruktiv datamigrering behövs.

## Uppgradering från v0.6.1

1. Exportera befintlig state.
2. Installera/ladda v0.6.2 unpacked.
3. Ladda om extension och kopplad ChatGPT-flik.
4. Importera v0.6.1-exporten vid behov.
5. Öppna sidepanelen och aktivera Nano.
6. Verifiera version `0.6.2`, content version `0.6.2` och schema v8.
7. Vid den observerade stuck-state ska audit visa att bevarad giltig trailer återtas genom deterministic protocol fast path.
8. Exakt en ny turn får skickas; ingen dubblett och inget Nano-mellanstopp får förekomma.

## Rollback

1. Stoppa runnen med operatörens Stop.
2. Exportera v0.6.2-state.
3. Installera v0.6.1 i separat katalog.
4. v8-state är schema-kompatibel, men en v0.6.2-state med `DETERMINISTIC_PENDING` bör inte importeras till äldre kod.
5. Använd helst exporten som togs före uppgraderingen.

## Bevarat

- linked tabs;
- target mode;
- continuity;
- effect journal;
- Mjölnar ledger;
- audit;
- operator settings.

Direkt Stop/Paus och nivå-10-gränser påverkas inte.
