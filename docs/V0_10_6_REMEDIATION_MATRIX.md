# v0.10.6 remediation matrix

| Finding | Implementation | Verification |
|---|---|---|
| Continuity backup frozen | semantic N-1 rollforward plus digest readback | focused continuity fixtures; Desktop section C |
| Continuity empty versus run | active run projection | focused projection fixture |
| Nano lease drift | heartbeat copies claim lease | source assertion and live section D |
| Watchdog period stale | compare/recreate mismatched alarm | source assertion |
| Brittle source-anchor test | explicit anchor existence assertions | v0.10.5 regression fixture |
| Slow/uncertain prompt ACK | MutationObserver, visibility/timing diagnostics | live section A/D |
| Dead `PORTS` | removed | source search/validator |
| Control/target project mismatch | separate target binding | focused mismatch fixture |
| Capture interrupts Nano | mission Nano priority gate | focused gate; live section E |
| Non-monotonic virtualized capture | cumulative delta/full reconciliation | focused fixtures |
| Unstable capture fingerprint | remove count/epoch; normalized message text | focused fingerprint fixture |
| Repeated core review | defer during active mission/Nano | source assertion; live section E |
| Nano echo ambiguity | discrimination telemetry without overclaim | negative-twin live test |
| Clone/busy/status inconsistencies | normalized partial telemetry and terminal cleanup | focused/live section D |
| Mission projection stale | step/next/risk/status projection | focused fixture |
| Empty claim gate | typed strong claims require owner receipts | focused fixture |
| Optional diagnostic files | default-OFF redacted rotated audit sink | focused/live section H |
| M2 mandate | explicit 9.9999 exact-action mandate; level 10 excluded | focused/live section I |
