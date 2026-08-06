# Migration and Rollback — EIC Autonom Agent v0.6.3

## Kompatibilitet

v0.6.3 använder samma config/runtime/export huvudschema v8 som v0.6.2. Ingen destruktiv datamigrering krävs.

Nya run/requestfält är bakåtkompatibla:

- `deterministicGroundingFailure`;
- `deterministicDispatchState`;
- `deterministicDispatchAttempts`;
- `deterministicFailureDigest`;
- `deterministicFailureCount`;
- audit `repeatCount`.

Saknade fält behandlas som:

- dispatchstate `ARMED`;
- attempts `0`;
- failure digest tom;
- repeat count `1`.

## Uppgradering

1. Exportera v0.6.2-state.
2. Stoppa eller pausa inte en aktiv ChatGPT-generation genom extensionen.
3. Ersätt unpacked-katalogen med v0.6.3.
4. Klicka **Ladda om** i `chrome://extensions`.
5. Ladda om den kopplade ChatGPT-fliken.
6. Öppna sidepanelen.
7. Kontrollera att header/content bridge visar v0.6.3.
8. Importera exporten om Chrome storage inte redan bevarats.
9. Kör incidentreplay A i acceptansdokumentet.

## Självreparation av stuck v0.6.2-state

Vid import av ett state med:

- `state=ASSESSING`;
- `pendingNanoRequest.status=DETERMINISTIC_PENDING`;
- giltig `pendingObservation.targetResult.status=CONTINUE`;
- samma conversation/response/turn;
- gammal eller saknad dispatchstate;

ska v0.6.3:

1. defaulta requesten till `ARMED`;
2. schemalägga högst en callback;
3. acceptera den konkreta actionen eller reparera den exakt en gång;
4. rensa pending request;
5. bygga exakt en ny turn;
6. vänta på prompt acknowledgement;
7. inte fortsätta öka revisionen utan stateprogress.

## Rollback

Rollback till v0.6.2 rekommenderas inte för en state som redan träffar incidenten, eftersom felet finns där. Om rollback ändå krävs:

1. exportera v0.6.3-state;
2. stoppa addonet manuellt;
3. byt unpacked-katalog;
4. ladda om extension och targettab;
5. importera endast en verifierad v0.6.2-export;
6. förvänta inte att v0.6.2 förstår alla nya diagnostikfält;
7. rensa inte audit/effect journal innan nödvändig felsökning är säkrad.

## Safe reset

`Återställ fönsterkontext` får användas när state är korrupt eller target identity inte längre kan bindas. Detta raderar inte extern ChatGPT-konversation eller backenddata men avslutar extensionens lokala runkontext. Exportera först när felsökning behövs.

## Claim boundary

Schema- och sourcekompatibilitet kan verifieras lokalt. Faktisk storageimport, service-worker wakeup, content-script reinjection och promptsubmission måste verifieras i desktop Chrome.
