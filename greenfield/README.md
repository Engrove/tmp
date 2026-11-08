# Greenfield v2.0.0 — Progress Engine

Greenfield is a Chrome MV3 extension that runs autonomous EIC missions in
ChatGPT: SEND → WAIT → CAPTURE → ANALYSE → CONTINUE, with a work queue,
session rotation, dispatch fencing and an owner-verified terminal gate.

## What 2.0.0 changes
Up to 1.9.53 the runtime kept sessions alive reliably, but nothing measured
whether a mission advanced. The AI's own `nextSuggestedAction` became the next
objective verbatim, repeated blockers were invisible to every control, and the
operator was never asked anything. 2.0.0 makes Greenfield own progress:

| Component | File |
|---|---|
| Progress ledger, turn classification, escalation, capsule, objective | `lib/progress-engine.mjs` |
| Durable ledger storage + index | `lib/progress-store.mjs` |
| Prompt injection (`progress` field), turn hook, operator parking/answer | `background.js` (search "v2.0.0 progress engine glue") |
| `progress` in the request envelope and response schema; lint rule C18 admits it | `lib/a2a.mjs`, `lib/response-contract.mjs`, `lib/prompt-lint.mjs` |
| Compact session brief instead of a FULL contract copy at initialization | `lib/session-transport.mjs` |
| Session ceiling 10 prompts / 4 quanta; focus cycle over 10 prompts; ledger-aware rotation objective | `lib/session-broker.mjs`, `lib/focus-cycle.mjs` |
| AIK discovery at keypoints only; not again after an unavailable report | `lib/learning-control.mjs` |
| Shorter GFW policy note; one-paragraph reminder in COMPACT prompts | `lib/a2a.mjs` |
| "Framsteg" panel, operator answer form, queue row "Väntar på operatör" | `sidepanel.*` |

Escalation ladder: one turn without delta → `CHANGE_ROUTE`; two → `STRATEGY_SWITCH`
(the stalled handoff is not forwarded); three, or an AI operator request →
`OPERATOR_REQUIRED` (slot parked, operator asked, other missions continue).
A stage that takes more than six turns → `STRATEGY_SWITCH`.

See `UPPDATERA_TILL_2_0_0.md` (installation, Swedish) and `RAPPORT_v2.0.0.txt`
(verification). The matching AI Knowledge package is
`../knowledge/EIC_PROGRESS_KNOWLEDGE_v2/`; the analysis behind the change is
`../analys/ANALYS_Greenfield_stagnation.md`.

## Development
```bash
npm ci --ignore-scripts
```
```bash
npm test
```
```bash
node tools/update-integrity.mjs
```
```bash
node tools/verify-release-coherence.mjs
```
Run `update-integrity.mjs` after the last code change of a release.
