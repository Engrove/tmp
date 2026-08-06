# Desktop Chrome acceptance v0.10.9

Run against the unpacked BROWSER package in the intended Chrome profile.

## A. Manual continuation start

1. Link a ChatGPT conversation.
2. Start manually while the last message is a user prompt or the page is generating.
3. Verify UI/overlay says `Väntar på initiering av sessionskontext (catch)`.
4. Complete one stable assistant response.
5. Verify the exact canonical `HUVUDUPPGIFTSKONTROLL` request appears once.
6. Verify all other prompt/effect processing waits.
7. Respond with a valid `eic.main-task-baseline.v1`.
8. Verify Nano analyzes the response and initialization reaches `READY`.

## B. Manual special mission

Start an enabled special mode. Verify it is deferred until A.3–A.8 complete, then starts exactly once.

## C. Autostart

Run one Autostart preset. Verify it enters the same state sequence and does not bypass catch or Nano analysis.

## D. Overlay

1. Close the overlay with X during one phase.
2. Verify it stays hidden for that need.
3. Trigger the next initialization phase or a new run.
4. Verify the overlay appears again.
5. Verify overlay text is absent from transcript/capture evidence.

## E. Negative twins

- Symbolic `baselineRequestPrompt` must never be dispatched.
- An action-shaped stop criterion must be rejected by validation and must not be emitted by the fallback planner.
- A non-terminal Nano stream must become `HOST_STREAM_STALLED` within the bounded idle period, then receive at most one fresh-session retry.
- No ordinary mission prompt may dispatch before `READY`.

## F. Evidence

Export runtime and full audit. Record app version, run id, ordered state transitions, prompt identity, Nano request/decision identity and final status. Installed-runtime PASS requires these owner-visible observations.
