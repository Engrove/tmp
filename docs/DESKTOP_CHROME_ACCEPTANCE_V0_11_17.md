# Desktop Chrome acceptance v0.11.17

Source/package closure is not a runtime PASS.

Run one clean linked-session episode without changing settings or accepting a Core Surface Review
during the causal response test.

1. Install the exact v0.11.17 BROWSER ZIP identified by its SHA-256.
2. Wait for Chrome on-device LanguageModel readiness and start one fresh mission.
3. Let the initial stable assistant catch create the canonical `SESSION_CONTEXT_BASELINE_REQUEST`.
4. Verify the catch response is consumed exactly once: after baseline dispatch it must not remain an
   active `responseCandidate` and must never later emit `RESPONSE_SETTLE_LIVENESS_TIMEOUT`.
5. While the baseline effect is not ACKED, no assistant response candidate may bypass the effect owner.
6. After ACK, the source response must still be excluded.  The causally newer baseline response must
   be admitted, including the edge case where rendered text is identical but response identity differs.
7. Baseline Nano analysis must reach `READY` or a typed bounded failure; no ordinary mission work may
   pre-empt session initialization.
8. Produce a valid `OPERATOR_ACTION_REQUIRED + OPERATOR_ACTION` result.  Runtime must enter
   `AWAITING_OPERATOR_ACTION` before Nano/recovery/watchdog/deferred dispatch can continue.
9. Pause/Resume, service-worker reload, delayed callbacks and watchdog ticks must not leave that state.
10. Submit the exact operator-action receipt and verify exactly one controlled resume.
11. Repeat the structured `USER_PAUSE / AWAITING_OPERATOR_DECISION` boundary and exact decision receipt.
12. Run a semantically no-op Core Surface Review: it must remain `NO_CHANGE` and must not create a
    material owner event.
13. Verify normal Capture/Memory continuity and extension reload recovery after the human-boundary tests.

Fail the candidate if any response identity becomes simultaneously active in candidate and
processed/observation ownership, if a transferred response times out, if a human wait resumes without
its exact receipt, or if a terminal run leaves an active child owner.

Exact installed-byte provenance and production readiness require runtime/export evidence from this
episode.
