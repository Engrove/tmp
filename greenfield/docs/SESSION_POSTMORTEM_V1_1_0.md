# Session postmortem — Greenfield v1.1.0

## Outcome

The first live v1.1.0 shakedown proved that the isolated Nano Task lane works, but
exposed a false fail-closed at the Hjalmar/runtime boundary.

Source Audit SHA-256:
`b6b99faea6ce58b961b1780fdc51e994d2ced4174eb0bb87cc7387feb5ce1343`

The supplied Audit contains 97 valid `eic.greenfield.audit.v2` events.

## Verified chain

- Nano Task executed exactly once in a fresh one-prompt session.
- Nano returned `NANO_TEST_ANSWER=703`.
- Hjalmar then emitted `nanoTaskAssessment=NOT_REQUESTED` while its own
  `progressEvidence` referenced `37 * 19 = 703`.
- Hjalmar also repeated the already-consumed `NANO_TASK:` directive as `nextPrompt`.
- The v1.1.0 evidence binding did not reject `COMPLETED + NOT_REQUESTED`.
- Deterministic continuation admission correctly rejected the repeated directive as
  `NANO_TASK_REISSUE`.
- The process therefore transitioned `ANALYZING -> BLOCKED` even though local Nano
  execution had succeeded.

## Root cause

Runtime facts were still represented as model-authored mirror fields. The deterministic
guard was correct, but it received an unsanitized Hjalmar continuation candidate. A
correctable local-model contradiction was therefore promoted into a terminal process
state.

## v1.1.1 repair

v1.1.1 keeps the deterministic guard and changes the ownership boundary:

1. Raw Hjalmar output is preserved for forensic Audit.
2. Runtime checks raw mirror fields against canonical target/Nano facts.
3. `COMPLETED + NOT_REQUESTED` is explicitly detected.
4. Runtime overwrites target/Nano mirror fields after model output.
5. Completed Nano execution is reported as semantic `UNVERIFIED` unless an independent
   verifier closes task-specific correctness.
6. A repeated consumed `NANO_TASK:` directive is replaced with a deterministic
   evidence-based continuation candidate.
7. Corrections are emitted as `HJALMAR_RUNTIME_FACTS_RECONCILED`.
8. Residual deterministic continuation guards remain defense in depth.

This repair converts the observed v1.1.0 false fail-closed into a bounded, auditable,
non-terminal normalization path.
