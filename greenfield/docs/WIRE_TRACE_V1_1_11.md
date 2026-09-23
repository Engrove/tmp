# Wire trace — Greenfield v1.1.11

## Purpose

Two-ended trace for the v1.1.11 stale-session policy. The stale mechanism is a browser
liveness watchdog only; it does not own autonomous response admission or protocol semantics.

| Concern | Producer | Persisted state | Consumer | Invariant | Regression |
|---|---|---|---|---|---|
| WAIT stale anchor | acknowledged autonomous dispatch | `waitingRefresh.staleSince`, prompt hash, turn | `evaluateWaitingRefresh` | Timer begins only for the current WAIT turn | `v1111-stale-session-regression`: initialization |
| Any completed assistant response | content page latest assistant marker | assistant id/hash/count + reset count + new `staleSince` | `resetWaitingRefreshOnAssistantResponse` | Every completed response resets stale time regardless of protocol/type/causal admissibility | identical-text/count-change + protocol-agnostic background checks |
| Streaming assistant output | content `generating=true` | no reset commit | stale reset classifier | Partial/generating output is not a returned response | streaming non-reset fixture |
| Reload-only DOM churn | same assistant count/hash after reload | prior response marker retained | stale reset classifier | DOM identity rewrite alone cannot fake a response | DOM-churn fixture |
| 30-minute stale edge | stale evaluator | stage `F5_30` write-ahead | Chrome tabs reload | First escalation is F5-equivalent | threshold fixture |
| 60-minute stale edge | stale evaluator | stage `CTRL_F5_60` write-ahead | Chrome tabs reload | Second escalation is bypass-cache Ctrl-F5 | threshold fixture |
| 90-minute stale edge | stale evaluator | stage `CTRL_F5_90` write-ahead | Chrome tabs reload | Third escalation repeats bypass-cache Ctrl-F5 | threshold fixture |
| 120-minute stale edge | stale evaluator | exhaustion evidence | controller | No response for 120m becomes `STALE_SESSION_120M_EXHAUSTED` | threshold + background contract |
| Upgrade compatibility | persisted v1.1.10 stage | normalized stage | v1.1.11 evaluator | `F5` -> `F5_30`; `CTRL_F5` -> `CTRL_F5_60` | legacy-stage fixture |
| Scope isolation | process phase | phase guard | stale escalation consumer | Only `WAITING` may spend stale ladder | background WAIT-only fixture |

## Ordering constraints

1. Prompt dispatch/acknowledgement establishes the WAIT turn and stale anchor.
2. Every WAIT observation checks for a newly completed assistant response before stale
   escalation is evaluated.
3. A stale reset does not admit the observed response as autonomous; normal causal binding
   still owns autonomous response capture.
4. Every reload stage is persisted before `chrome.tabs.reload`.
5. The next stale escalation cannot occur before the next 30-minute boundary from the
   current `staleSince`.
6. `ANALYZING` and `RECOVERING` never consume this browser stale ladder.

## Claim boundary

This trace plus deterministic tests proves source/package behavior only. Live Chrome,
ChatGPT renderer/network behavior and actual F5/Ctrl-F5 recovery remain runtime acceptance.
