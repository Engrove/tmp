# Greenfield v1.9.53

## Automatic worker takeover

Worker collisions no longer require manual acknowledgement. Process-generation and exact queue-slot fencing preserve single-owner execution while fresh sessions take over automatically with no-replay quarantine for uncertain prior effects. A new process in the same Chrome window is not blocked by an older process that used the same workerId.

See `UPPDATERA_TILL_1_9_53.md` for installation and `RAPPORT_v1.9.53.txt` for root-cause analysis, replay evidence and test limitations.
