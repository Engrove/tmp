# Desktop Chrome acceptance v0.11.15

Source/package closure is not a runtime PASS.

Focused live oracle:

1. Install the exact v0.11.15 BROWSER package.
2. Start one fresh linked-session mission.
3. Reach a valid `OPERATOR_ACTION_REQUIRED + OPERATOR_ACTION` response.
4. The terminal assistant response must settle even if the MV3 worker suspends between candidate reads.
5. Runtime must enter `AWAITING_OPERATOR_ACTION`; it must not remain `WAITING_FOREGROUND`.
6. Pause/Resume/watchdog/reload/delayed callbacks must not leave the human boundary.
7. Submit the exact operator-action receipt and verify exactly one controlled resume.
8. Repeat the structured `USER_PAUSE / AWAITING_OPERATOR_DECISION` path.
9. Only then continue broader preserved acceptance.
