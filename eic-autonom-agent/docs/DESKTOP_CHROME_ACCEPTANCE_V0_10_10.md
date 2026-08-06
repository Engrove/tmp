# Desktop Chrome acceptance — v0.10.10

## Build identity

Verify the panel and export report `0.10.10` and match the delivered browser package SHA-256.

## A. Manual start and deferred automatic review

1. Open the sidepanel and activate the Chrome on-device LanguageModel.
2. Start a manual continuation in a linked ChatGPT session with no prior `mainTaskBaseline`.
3. Observe the universal initialization phases through `READY`.
4. Trigger or wait for the first automatic Session Capture.
5. Verify that the core-surface review becomes `PENDING_ANALYSIS` if mission Nano owns the model.
6. Verify that after initialization reaches `READY`, the review changes to `ANALYZING` and then `PROPOSAL_READY` or `APPLIED/NO_CHANGE`.
7. Verify exactly one automatic review for the application session.

Expected audit evidence:

- `Initial Nano-granskning uppskjuten`
- `Uppskjuten Nano-granskning återupptagen`
- one review with trigger `AUTO_INITIAL_CAPTURE`

## B. Autostart

Repeat A through an Autostart preset. Confirm the same replay behavior and no duplicate review.

## C. Priority twin

Create a state where an ordinary mission Nano request and the deferred automatic review are both pending after `READY`.

Expected:

- core-surface review receives the first model turn;
- mission Nano waits;
- no concurrent LanguageModel request;
- mission Nano continues after the review finishes.

## D. Panel/model dependency

Close the sidepanel while the review is pending.

Expected:

- review remains `PENDING_ANALYSIS`;
- no false completion claim;
- reopening the panel with an available non-stale model starts the review.

## E. Safety

Verify:

- transcript content is marked untrusted;
- `activeTaskProjectId`, permissions, target mode, Mjölnar rollout, owner authority, credentials, release and deployment are not patchable;
- Nano and target/EIC mandate rewrites require operator acceptance;
- TTL auto-apply remains limited to eligible low-risk local settings/continuity.

## PASS criterion

PASS requires owner-visible evidence for one exactly-once automatic review after `READY` in both manual and Autostart paths, plus the priority, panel dependency and safety twins.
