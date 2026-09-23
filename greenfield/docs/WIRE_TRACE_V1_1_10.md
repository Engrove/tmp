# Wire trace — Greenfield v1.1.10

## Purpose

Two-ended trace for the v1.1.10 continuity/liveness changes. Each row names the producer,
transport, consumer, invariant and deterministic regression surface.

| Concern | Producer | Transport / persisted field | Consumer | Invariant | Regression |
|---|---|---|---|---|---|
| Closed autonomous response slot | `content.js::resolveAutonomousTurn` | `autonomousTurn.nextUserTurnId`, `responseSlotClosed` | `lib/turn-causality.mjs::autonomousResponseObservation` | A later user boundary before a paired assistant makes the old response producer impossible | `v1110-continuity-liveness-regression`: closed slot + exact content resolver |
| Producer-loss recovery | causality reason `AUTONOMOUS_RESPONSE_PRODUCER_LOST` | Audit + new pending A2A objective | `background.js::tickWaiting` | Never blind-replay the lost effect; reconcile owner state before one new bounded continuation | producer-loss ordering + WAITING->SENDING tests |
| Repeated controller prompt | Hjalmar `decision.nextPrompt` | continuation admission result | `background.js` | Repetition is no-progress, not a terminal safety boundary | current-objective and prior-decision replan tests |
| Newer target guidance | target `nextSuggestedAction` | `targetNextSuggestedAction` | `safeTargetAlternative` | Use only material guidance that differs from current/previous and does not reissue consumed Nano work | target-guidance replan test |
| No newer guidance | continuation guard | `effectiveNextPrompt` with deterministic fingerprint | pending A2A objective | Generate one materially different bounded instruction rather than resend the same prompt | prior-decision/no-target regression |
| Real Nano exact-once boundary | `nanoTask.status` | continuation admission | controller | Unknown effect, incomplete work or consumed directive reissue remains fail-closed before liveness replanning | unknown-effect Nano regression + inherited Nano tests |
| Long unresolved acknowledged WAIT | `lastPrompt.sentAt`, `waitingRefresh` | process storage | `evaluateWaitingRefresh` + `executeWaitingRefresh` | 30m F5, 90s Ctrl-F5, 90s real blocker; never resend prompt during reload recovery | three-stage ladder tests |
| Recovered causal response | paired autonomous assistant | causal observation | waiting refresh evaluator | Any causally ready response cancels refresh escalation | recovery-cancel test |

## Ordering constraints

1. Exact causal turn binding is evaluated before accepting a response.
2. Producer loss is evaluated before generic idle keepalive.
3. Real exact-once/evidence barriers are evaluated before repetition recovery.
4. Waiting refresh stages are persisted before the Chrome reload side effect.
5. Controller `effectiveNextPrompt`, not the rejected repetitive candidate, becomes the next
   objective and A2A payload.
6. A2A protocol status remains advisory; it does not directly terminalize WAITING.

## Claim boundary

This trace maps source behavior to deterministic tests. It does not prove live Chrome,
network, ChatGPT renderer, or local LanguageModel behavior outside the tested source/package
surface.
