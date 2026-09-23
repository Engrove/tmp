# v1.1.9 two-ended runtime wire trace

Release rule: every decision-critical field/function must have producer, transport or
persistence, consumer, invariant and regression coverage.

## Manual interleave path

| Field / function | Producer | Transport / persistence | Consumer | Invariant | Regression |
|---|---|---|---|---|---|
| autonomous expected user turn | send result / `lastPrompt.dispatchedUserTurnId` | canonical process state -> page-state request | content autonomous-turn resolver | autonomous ownership is anchored to the exact dispatched user turn | `turn-causality`, `v117-live-regression`, deterministic interleave fixture |
| paired autonomous assistant | content `autonomousTurn` | page state -> `autonomousResponseObservation()` | response stability | later manual turns do not replace the assistant paired with expected user | deterministic interleave fixture |
| external interleave classification | `externalAssistantInterleaveEvidence()` | WAIT tick | Audit + persisted `responseInterleave` | latest manual assistant is observable but never admissible as autonomous response | `turn-causality`, `v118-manual-interleave-deterministic`, static |
| `responseInterleave` | first distinct external pair in WAIT | process store | response capture | evidence persists across subsequent stability reads for the same autonomous turn | deterministic fixture + observation-wire |
| `externalInterleave.observed` | persisted runtime interleave | `lastResponse.observation` -> analysis evidence -> A2A sanitizer | next target/operator evidence | live envelope can prove external turn was seen without using raw external text | `a2a`, deterministic fixture, observation-wire |
| external turn ids | page latest turn + causal autonomous turn | bounded response observation | Audit / next A2A envelope | external ids cannot overwrite expected/paired autonomous ids | deterministic fixture |
| interleave reset | next `ANALYZING -> SENDING` transition | process patch `responseInterleave:null` | next WAIT | evidence is scoped to one autonomous response and cannot leak into later turns | static contract |
| response candidate after count drift | response stability | process `responseCandidate` | next WAIT read | manual assistant-count increment may restart stability, but candidate remains autonomous and can re-stabilize | deterministic staged fixture |
| production timing | scheduler / normal WAIT loop | none added | runtime | no test-only admission delay or artificial manual hold in production | deterministic test `doesNotMatch` |

## Protocol path

A2A protocol remains optional. A causally complete response always reaches `ANALYZING`;
protocol `VALID`, `INVALID`, `ABSENT`, `CONTINUE`, `DONE`, or `BLOCKED` is advisory evidence
only. Protocol parser errors never own manual-turn causality.

## Deterministic staged acceptance

`tests/fixtures/v1.1.8-deterministic-manual-interleave.json` has three ordered snapshots:

1. autonomous response is observed and stabilizing;
2. a manual user/assistant pair becomes latest and global `assistantCount` changes;
3. the manual pair remains latest while the causally paired autonomous response
   re-stabilizes.

The regression requires the admitted candidate id to remain the autonomous assistant id,
requires explicit external-interleave evidence, and verifies that the next A2A envelope
carries the bounded evidence.
