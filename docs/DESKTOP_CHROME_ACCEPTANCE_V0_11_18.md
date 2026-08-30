# Desktop Chrome acceptance v0.11.18

## Claim boundary

Source/package verification is not Desktop Chrome runtime acceptance. Test the exact delivered
v0.11.18 package in a clean linked-session episode.

## Primary oracle: pre-Nano baseline handoff

Required order:

1. `CATCH_ARMED`
2. `CATCH_CAPTURED`
3. canonical baseline prompt becomes target-visible and a currentTurn/effect is created
4. effect acknowledgement
5. `WAITING_BASELINE_RESPONSE`
6. actual Nano baseline analysis
7. `READY`

Fail the episode if the captured source response repeatedly wins response-owner drain, if
`CATCH_HANDOFF_STALLED` or `BASELINE_DISPATCH_STALLED` occurs, or if the baseline prompt does not
appear in the target session.

## Continued production gate

After READY, continue the preserved acceptance path through:

- `OPERATOR_ACTION_REQUIRED -> AWAITING_OPERATOR_ACTION`;
- operator receipt/reload behavior; and
- structured `USER_PAUSE`.

Do not claim production acceptance until all required live boundaries pass on the exact package.
