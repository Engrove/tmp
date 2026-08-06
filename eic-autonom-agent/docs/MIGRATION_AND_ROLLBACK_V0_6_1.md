# Migration and Rollback — v0.6.1

## Uppgradering v0.6.0/v7 → v0.6.1/v8

Migrationen:

- uppgraderar config/runtime/export/run till v8;
- aktiverar `maxAutonomousMode=true`;
- aktiverar `mjolnarEnabled=true`;
- sätter `mjolnarRolloutMode=D1_LIVE`;
- aktiverar deterministic protocol fallback;
- uppgraderar standardmandat till Nano v3 och target v2;
- lägger till destructiveness, Hjalmar mental-control, foreground evidence och policy version;
- markerar legacy `SOFT_PAUSED`, `HARD_BLOCKED` och `HUMAN_REQUIRED` för omklassificering när de inte kommer från operatör/auth/nivå 10.

Egna mandat bevaras om de inte exakt är äldre standardmandat.

## Uppgradering

1. Exportera v0.6.0-state.
2. Installera v0.6.1 och ladda om extensionen.
3. Ladda om kopplad ChatGPT-flik.
4. Öppna sidepanelen och aktivera Nano.
5. Kontrollera att version 0.6.1, config v8 och content v0.6.1 visas.
6. Kör acceptansfallen.

## Rollback

1. Stoppa aktiv run med operatörens Stop.
2. Exportera v8-state för felsökning.
3. Installera v0.6.0 i separat katalog.
4. Importera inte v8-state i v0.6.0 om äldre version inte uttryckligen stöder schema v8.
5. Återställ i stället den v7-export som togs före uppgraderingen.
6. Ladda om target-fliken.

## Risk

v0.6.1 är mer autonom. Därför måste nivå-10-regressionerna, direkt operator Stop/Pause och auth/CAPTCHA-boundary köras innan bred användning.
