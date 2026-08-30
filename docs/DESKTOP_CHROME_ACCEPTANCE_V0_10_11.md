# Desktop Chrome acceptance — v0.10.11

## Build identity

Verify the panel and export report `0.10.11` and match the delivered browser package SHA-256.
Reload the target ChatGPT tab once after installing: `CONTENT_SCRIPT_VERSION` moved to `0.10.11`,
so a tab still holding the v0.10.10 content script is re-injected on first read.

## A. Happy path — the case that failed in v0.10.10

1. Open the sidepanel and activate the Chrome on-device LanguageModel.
2. Link a ChatGPT session whose latest turn is a completed assistant response and which has no
   prior `mainTaskBaseline`.
3. Start a manual continuation.

Expected, in order:

- overlay `3/6 · Catch mottagen`, titled **Sessions-catch mottagen** — it must **not** claim the
  session context is captured;
- audit `Sessions-catch klar — kanonisk baselineprompt schemalagd`;
- audit `Turn-bundet protokoll körs utan Nano-mellanstopp`;
- audit `Nästa substantiella tur förberedd`;
- **a visible user message in the ChatGPT composer/thread within a few seconds**;
- overlay `4/6 · Baselinefråga`, then `5/6 · Baselinesvar`;
- export shows a non-empty `effectJournal`, a non-null `currentTurn`, and
  `sessionContextInit.baselinePromptDigest` set.

Fail the acceptance if `run.state` becomes `WAITING_FOR_RESPONSE` while `currentTurn` is null and
`effectJournal` is empty — that is the exact v0.10.10 defect.

## B. Autostart

Repeat A through an Autostart preset. Exactly one baseline prompt must be sent, and repeated
watchdog ticks during the wait must not produce a second one.

## C. Injected dispatch failure

With the target tab present, force a content-bridge failure during the dispatch window (close and
immediately reopen the target tab, or navigate it away and back while the catch is being handed
off).

Expected:

- audit `Deterministisk dispatch återarmerad efter fel` with an `errorCode` and a
  re-arm counter, **not** silence;
- `Inställningar → Applikationslogg` contains `mission.deterministic.dispatch-failed`
  with `errorCode`, `errorDetail` and `stackDigest`;
- the baseline prompt is delivered on a later re-arm, or the run reaches D below.

## D. Liveness and operator recovery

Force the dispatch to keep failing past the re-arm budget (leave the target tab closed).

Expected within roughly two minutes of the phase entry:

- audit `Sessionsinitiering misslyckades — ingen prompt skickades`;
- run state `PROGRAM_BLOCKED`, pause origin `INTERNAL_INVARIANT`;
- sidepanel attention banner **Baselinefrågan kunde inte levereras** (CRITICAL);
- the **Baselinefrågan kunde inte levereras** card with **Försök igen** and **Visa fel**;
- overlay title **Baselinefrågan kunde inte levereras**, progress `Fel`.

Then restore the target tab and press **Försök igen**.

Expected: audit `Sessionsinitiering återarmerad av operatören`, the overlay returns to
`1/6 · Chatstatus`, and the chain completes as in A. Verify the attempt counter increments and
that the button disables after the third retry.

## E. Capture backoff

While a mission Nano request is pending, watch `Automatisk Session Capture avbruten`.

Expected: the repeat interval grows 2.5 s → 5 s → 10 s → 20 s → 30 s and then holds at 30 s. It
must not stay at 2.5 s, and capture must still complete once the pending request clears.

## F. No regression in the established surfaces

- exactly-once automatic core-surface review replay after `READY` (v0.10.10 acceptance A–C);
- five-minute TTL auto-apply for eligible low-risk settings;
- mandate/profile/autonomy changes still require explicit operator approval;
- level-10 boundaries still require the real operator;
- overlay X still affects display only, never run state.
