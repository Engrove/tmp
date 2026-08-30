# Desktop Chrome acceptance v0.11.21

## Claim boundary

Use the exact delivered v0.11.21 BROWSER ZIP. Source/package PASS is not browser runtime PASS.

## Oracle A — conceptual assistant-turn ownership

Run a clean session where ChatGPT visibly shows a completed reasoning-duration disclosure before a
structured baseline response.

Required after the baseline response finishes:

- the selected semantic assistant response is the full final baseline, not the reasoning-duration
  disclosure;
- `baselineResponseExtraction.canonicalTextLength` is materially greater than the lifecycle label;
- `baselineResponseExtraction.baselineSchemaVisible=true`;
- `baselineResponseExtraction.complete=true`;
- `baselineCandidate` is present;
- no `MAIN_TASK_BASELINE_NOT_FOUND` is emitted for that visible valid baseline.

A lifecycle label such as `Arbetade i <n> sekunder >` must never receive response ownership on its
own.

## Oracle B — baseline Nano contract

For the same response:

- Nano receives `sessionContextBaselineAnalysis=true`;
- semantic coverage is present;
- mandatory baseline analysis validates;
- `sessionContextInit` reaches `READY` exactly once;
- no recovery path fabricates baseline completeness.

## Oracle C — Session Capture consistency

After READY, export raw Session Context.

Required:
- one conceptual assistant turn produces one assistant Capture turn;
- no standalone `Thinking`/`Working`/timed reasoning disclosure turn exists;
- the baseline Capture turn contains the structured baseline payload;
- conversation/capture provenance remains exact.

## Oracle D — v0.11.20 human-boundary preservation

After READY, exercise both:
1. a Nano-selected no-effect wait with model-only USER_PAUSE — no false level-10 gate;
2. a genuine operator decision — one click must persist/read back the exact receipt and continue
   exactly once without wrapper/root TypeError.

## Oracle E — post-READY work handoff

The first ordinary post-READY handoff must use
`mainTaskBaseline.current.nextHighLeverageAction`, not re-issue the init-only baseline-validation
instruction.

## Oracle F — current investigative session behavior

Continue the staged AI Language work as an investigative/non-ping-pong session.

Required:
- valid external waits remain passive;
- contextless counterpart turns are treated as material target responses, not lifecycle UI;
- no duplicate protocol-repair/local-state/chat-control churn occurs.

## Production gate

Production remains blocked until the exact v0.11.21 package passes Oracles A-F with export,
raw-session-context and audit evidence from the same installed episode.
