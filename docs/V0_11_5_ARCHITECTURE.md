# v0.11.5 architecture — terminal Nano failure diagnostic and wake suppression

## Live defect

v0.11.4 correctly separated `EIC_AI_SESSION`, `AGENT`, `NANO` and `EXTERNAL_SYSTEM`, but live
shakedown exposed a recovery/liveness defect: once a terminal Nano failure fenced an unchanged
observation/material input, local recovery could repeatedly surface `NANO_FAILURE_INPUT_UNCHANGED`
as another chat-control wake after each ACKed EIC turn. The secondary anti-loop reason hid the
original Nano failure details.

## v0.11.5 state contract

One terminal Nano failure generation owns one immutable bounded diagnostic identity:

`requestId + errorCode + inputDigest + observationKey + materialStateDigest + taskAttempt + failedAt`.

The first attempted local rearm of that unchanged failed input:

1. builds `diagnostics.nanoFailure` from Agent-owned runtime state;
2. emits exactly one `NANO_FAILURE_DIAGNOSTIC` EIC-AA/5 control turn;
3. stores `nanoFailureDiagnosticReceipt` keyed to the diagnostic identity.

A later equivalent rearm of the same failure generation:

1. creates no new control turn;
2. enters `PROGRAM_BLOCKED`;
3. records `chat-control=0`;
4. waits for genuinely new material input or a new failure generation.

## Diagnostic boundary

The diagnostic is local Agent evidence, not EIC owner truth. It excludes prompt bodies, provider
output, credentials, hidden reasoning and arbitrary source content.

## Actor topology

The v0.11.4 actor/capability contract is unchanged. Surfacing a Nano diagnostic to
`EIC_AI_SESSION` does not grant Nano EIC Backend/project/artifact/APIG/Git/Workspace/repository
capability.
