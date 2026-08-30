# v0.12.11 verification plan

## Required source/package gates

1. inherited v0.12.9 deep-repair suite PASS;
2. inherited v0.12.10 Autostart suite PASS;
3. v0.12.11 Nano owner-liveness suite PASS;
4. whole-package invariant suite PASS;
5. every JS/MJS file passes `node --check`;
6. every relative import resolves;
7. every local named import resolves to an exported binding;
8. local module graph has no cycles;
9. every lib MJS module evaluates without top-level exception under Node;
10. manifest entry points exist and release identities agree;
11. owner-invalidated classification survives wrapped transport error code+message forms;
12. all recurring sidepanel intervals have explicit cleanup;
13. product source contains no executable-string evaluation and no arbitrary remote network client;
14. exact final ZIP re-opened and every `build-info.json` payload hash matches.

## Desktop Chrome acceptance

Desktop Chrome is not source/package truth and must be tested separately.

Primary live oracle:

- start v0.12.11 and reach session-context `READY`;
- ordinary Nano may start over the current stable observation;
- if the target begins a newer foreground generation while Nano is running,
  the exact old Nano owner is superseded;
- within one heartbeat interval the old local inference must abort;
- no repeated stale `NANO_HEARTBEAT`, `NANO_DECISION` retry or `NANO_FAILURE`
  should be emitted for that retired request;
- if no owner change occurs, ordinary continuation analysis must finish or fail
  by its 180-second mode deadline rather than run toward the 30-minute global
  ceiling.

`WAITING_TARGET` is acceptable while a real foreground generation is active.
A stable wait with no causal producer must be diagnosed from a fresh runtime
export before being classified as another defect.
