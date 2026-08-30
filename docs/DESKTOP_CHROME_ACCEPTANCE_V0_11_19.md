# Desktop Chrome acceptance v0.11.19

## Claim boundary

Source/package verification is not Desktop Chrome runtime acceptance. Test the exact delivered
v0.11.19 package in clean linked-session episodes.

## Oracle A — fresh conversation isolation

1. Start a mission in conversation A and reach a valid baseline.
2. Link/start a clean conversation B.
3. B must not inherit A's `mainTaskBaseline`, intent, work-unit, claims or Session Memory summaries.
4. B must execute a fresh `CATCH -> baseline request/ACK -> baseline Nano -> READY` chain.
5. Raw Session Context for B must have no `conversationMismatch` or `bindingMismatch`.

## Oracle B — structured rendered baseline

Use a baseline response containing a fenced/structured JSON block and normal EIC footer metadata.

Required:
- runtime canonical extraction length/digest corresponds to the complete rendered response;
- parser sees the baseline without semantic correction;
- extraction diagnostics report complete;
- no `BASELINE_CORRECTION_EXHAUSTED` caused by lost DOM content.

Fault injection:
- if canonical extraction is deliberately marked incomplete, Nano must not consume baseline
  correction generation.

## Oracle C — retry episode

Force one typed pre-delivery init failure and one post-delivery semantic/extraction failure in
separate runs, then use the operator retry.

Required:
- `needKey` increments on either retry class;
- correction generation is zero and fence is clear for the retry episode;
- post-delivery retry does not resend the already ACKed baseline prompt;
- a later READY state contains no stale `EXHAUSTED` fence from the failed episode.

## Oracle D — investigative external wait

Run a bounded investigative mission that legitimately requires a genuinely independent external
producer after READY.

Required:
- `runtimeDecisionStatus=WAIT_EXTERNAL_EVENT`;
- timeout is suspended;
- no `PROGRAM_BLOCKED` solely because AGENT cannot be the external producer;
- no repeated target/chat-control turn for unchanged external-wait state;
- after new material is supplied, the controller may resume exactly once.

## Oracle E — protocol and capture hygiene

- An explanatory answer may contain earlier EIC-AA examples; the final exact trailer remains the
  authoritative target result.
- EIC `Status/Time/Project` metadata after the trailer does not trigger protocol repair.
- Arbitrary semantic text after the final trailer still fails closed.
- Capture/Session Memory contains no transient `request-placeholder-*` / `Tänker` turns.

## Preserved primary oracle

The v0.11.18 CATCH ownership oracle still applies:

`CATCH_ARMED -> CATCH_CAPTURED -> baseline dispatch/ACK -> WAITING_BASELINE_RESPONSE -> Nano -> READY`

The captured source response must never re-win RESPONSE_OWNER.

Do not lift production-blocked until all relevant live oracles pass on the exact v0.11.19 package.
