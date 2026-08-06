# Desktop Chrome acceptance — v0.6.7

## A. Existing completed answer

1. Open a linked ChatGPT conversation whose latest item is a completed assistant answer.
2. Ensure the answer contains no EIC trailer variables.
3. Activate `WAITING`.
4. Expected: the current assistant answer is armed, stabilizes, and enters processing exactly once.

## B. Latest item is a user prompt

1. Submit a user prompt.
2. Before ChatGPT creates an assistant turn, activate or refresh `WAITING`.
3. Expected: state remains waiting; the previous assistant answer is not processed again.
4. Expected: processing begins only after the new assistant response stabilizes.

## C. Soft stale UI

1. Observe a completed answer while a Stop control or composer-busy state remains visible.
2. Expected: the answer uses the dynamic candidate path.
3. Expected: no trigger before three identical reads and four seconds of unchanged hash.
4. Expected: processing begins without requiring an EIC trailer.

## D. Real generation

1. Observe a latest assistant node with an explicit streaming marker.
2. Expected: no response trigger.
3. Remove/end streaming and allow the text to stabilize.
4. Expected: processing begins after the applicable stability gate.

## E. Trusted background task

1. Start a ChatGPT feature that exposes trusted structured background-work status.
2. Expected: no prompt is sent and the timeout remains suspended.
3. When the background status ends and the assistant answer stabilizes, expected: processing begins.

## F. Duplicate protection

1. Allow one stable answer to process.
2. Refresh the side panel and wait through watchdog cycles.
3. Expected: the same response identity is not processed a second time.

## G. Extension reload

1. Install/reload v0.6.7.
2. Reload the ChatGPT target tab.
3. Confirm side panel and content bridge both report v0.6.7 before judging behavior.
