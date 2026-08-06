# Scenario Matrix — EIC Autonom Agent v0.6.2

## Scope

This matrix turns the 1–10 ladder into operational scenario families. It is not a claim that every future event can be enumerated. Unknown events are decomposed into target, effect, reversibility, owner route, rollback, readback and human-authority requirements, then classified by `EIC_DESTRUCTIVENESS/1`.

## Precedence

1. Direct operator **Stop/Paus** always stops.
2. A separate level-10 signal wins over all lower classifications.
3. Workbench/Workspace/work-package effects are capped at level 5 unless a separate level-10 signal exists.
4. Levels 6–9 require local Hjalmar mental control. Missing target/mandate/rollback/readback becomes `READ_REQUIRED`, not human pause.
5. Levels 1–5 continue, reconcile, retry, replan or wait.
6. Only level 10 becomes `HUMAN_REQUIRED`.
7. A target-authored `PAUSE` is data to classify; the word alone is not a stop authority.
8. A valid terminal `EIC_AUTONOMY: CONTINUE` plus `EIC_NEXT` is continuation data, not owner proof and not execution proof.

## Scenario families

| Family | Example | Level | Autonomous result |
|---|---|---:|---|
| Project read | Read project status, updates or milestones | 1 | Read and continue |
| Repo read | Read branch, commit, issue or PR state through owner route | 1 | Read and continue |
| Artifact metadata read | Inspect id, size, SHA or path | 1 | Read and continue |
| Runtime health read | Read health/version/log status | 1 | Read and continue |
| Lock owner read | Read lock owner, lease and expiry | 1 | Read and continue |
| Publication receipt read | Re-read publication/completion receipt | 1 | Read and continue |
| Poll transient wait | Wait for trusted-session terminalization or lease expiry | 2 | Poll/reconcile |
| Correct bootstrap order | Re-run carrier-free resolver or correct route order | 2 | Correct and continue |
| Stale owner state | Refresh mutable alias/HEAD/current state | 2 | Re-read and continue |
| Network retry | Retry read after bounded transient failure | 2 | Bounded retry |
| Tab navigation | Focus/reselect exact linked tab | 2 | Navigate and continue |
| Reconnect content bridge | Reconnect Port/content script | 3 | Recover locally |
| Reload linked tab | Reload exact already-authorized ChatGPT tab | 3 | Recover locally |
| Reinject packaged content | Reinject packaged `content.js` on allowed host | 3 | Recover locally |
| Service-worker restart | Rehydrate durable extension state | 3 | Reconcile and continue |
| Browser wake | Resume after sleep/freeze/discard | 3 | Reconcile and continue |
| Stale Stop control | Terminal trailer exists but stale Stop remains | 3 | Protocol override, continue |
| Verified background wait | Same task still works in background | 3 | Wait without application TTL |
| Workspace resolve | Resolve/open exact Workspace | 4 | Continue |
| Work-package lock | Acquire/read/release temporary lock or lease | 4 | Continue |
| Trusted-session handoff | Let owning session terminalize then re-read state | 4 | Continue/poll |
| Temporary package | Build/rebuild ephemeral package | 4–5 | Continue |
| Clean Workspace | Create/reset temporary work area | 4–5 | Continue |
| Local apply/reverse | Apply or reverse frozen candidate locally | 5 | Hash/readback, continue |
| Source patch | Reversible source change | 5 | Patch/test/readback |
| Test or preflight | Unit/integration/static/graph/preflight | 5 | Run and continue |
| Candidate branch | Create/update review candidate branch | 5 | Continue |
| PR preparation | Prepare bounded PR without final authority effect | 5 | Continue |
| Forgejo issue/comment | Record defect/evidence | 5–6 | Continue; control at 6 |
| Project projection write | Update project chronology/focus | 5–6 | Continue; control at 6 |
| Core admin metadata | Bounded EIC backend admin write | 6 | Hjalmar control |
| Core registry update | Reversible registry/owner-route configuration | 6 | Hjalmar control |
| Single core restart | Restart/reload one core service | 7 | Hjalmar control + health readback |
| Rolling restart | Bounded rolling restart | 7 | Hjalmar control + rollback |
| Core config change | Reversible runtime configuration | 8 | Hjalmar control |
| Schema migration | Reversible schema/database migration | 8 | Hjalmar control + tested rollback |
| Multi-service restart | Coordinated core restart | 8 | Hjalmar control |
| Main merge | Merge exact reviewed commit | 9 | Hjalmar control + owner authorization/readback |
| Release | Create/publish exact release | 9 | Hjalmar control + owner authorization/readback |
| Deployment | Deploy exact build to exact environment | 9 | Hjalmar control + rollback/readback |
| Permission/share effect | Exact reversible access change | 9 | Hjalmar control + owner authorization/readback |
| Force push | Exact explicitly authorized reversible history rewrite | 9, or 5 when purely ephemeral Workbench candidate | Hjalmar control unless capped |
| Production migration | High-impact but bounded/reversible production migration | 9 | Hjalmar control |
| Login/sign-in | User identity/authentication required | 10 | Human required |
| CAPTCHA/user presence | Physical human-presence challenge | 10 | Human required |
| Password/token/private key | Secret handling or entry | 10 | Human required |
| Permanent deletion | Data deletion without rollback | 10 | Human required |
| Unknown blast radius | Effect cannot be bounded | 10 | Human required |
| Safety/policy exception | Bypass safety/auth/security policy | 10 | Human required |
| Legal/payment/medical decision | Material human value/risk decision | 10 | Human required |
| Physical observation | No trusted sensor/owner route exists | 10 | Human required |
| Irreversible scope change | Material product scope or authority change with no rollback | 10 | Human required |

## Error and ambiguity mapping

| Condition | Result |
|---|---|
| Missing low-risk owner fact | Owner-read and continue |
| Missing level 6–9 target/rollback/readback | `READ_REQUIRED`, then re-adjudicate |
| Unknown prior effect but idempotent/readable | Owner-read-before-retry |
| Unknown prior effect and unbounded blast radius | Level 10 |
| Conflicting non-owner text | Ignore as authority; re-read owner |
| Trusted external Hjalmar `BLOCK` | Treat as control evidence, select owner-read/replan; human pause only when level 10 |
| Nano missing/unavailable | Deterministic protocol fallback for valid CONTINUE trailer |
| Repeated no-progress loop | Change recovery path/checkpoint; do not human-pause below level 10 |
| Max-turn reached | Durable checkpoint rollover; continue below level 10 |
| Missing `requestedAction` | Generate bounded owner-read action |
| Manual operator Stop/Paus | Stop immediately, outside ladder |
