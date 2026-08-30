# v0.11.8 Architecture — Bounded session-init baseline correction

## Live defect

v0.11.7 source/package closure fixed typed Nano JSON completeness, but Desktop Chrome shakedown exposed a different liveness defect: a structurally valid `eic.main-task-baseline.v2` could be Nano-non-ACCEPTed, converted into a fresh correction request, observed under a new response identity, and rejected again indefinitely.

The exact v0.11.7 target baseline parser accepts the required minimal baseline shape. Therefore fresh response identity is not, by itself, a reason to re-arm semantic correction.

## Episode identity

v0.11.8 binds correction budget to the local session-init episode:

`sessionContextInit.needKey + sessionContextInit.catchResponseIdentity`

The baseline response identity is deliberately excluded from this key because it changes on every correction response and would recreate the loop.

## State contract

1. First Nano non-ACCEPT in an episode:
   - records `baselineCorrectionFence` generation `1`;
   - allows exactly one corrective baseline target prompt;
   - continues normal session-init waiting/analysis.
2. Second Nano non-ACCEPT in the same episode:
   - does not set `baselinePromptOnly`;
   - creates no third baseline target effect;
   - fails session initialization with `BASELINE_CORRECTION_EXHAUSTED`;
   - transitions the run to `PROGRAM_BLOCKED`;
   - records bounded verdict/reason/violations for diagnosis.
3. A new session-init episode or changed pre-baseline catch identity starts with generation `0`.

## Preserved controls

- v0.11.7 `NANO_INCOMPLETE_JSON` typed completeness remains unchanged.
- v0.11.6 6,000-character soft threshold and schema-derived hard output ceiling remain unchanged.
- v0.11.5 actor/capability topology and one-diagnostic/no-repeat Nano failure suppression remain unchanged.
- The fence does not promote Nano to an EIC owner and does not add owner-route capability to AGENT/NANO.
