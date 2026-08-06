# Desktop Chrome acceptance — v0.10.12

## 0. Bridge identity — run this first

v0.10.11 failed here, before anything else could be tested.

1. Install the browser package and confirm the panel reports `0.10.12`.
2. Open a ChatGPT tab and press **Koppla aktiv flik**.

Expected: the tab links, the badge appears on the page, and the audit shows
`ChatGPT-flik kopplad`.

Fail immediately if the panel shows:

> Content bridge kunde inte verifieras (förväntad 0.10.12, observerad …)

If a tab was open across the upgrade, reload it once; the reinjected bridge must
report `0.10.12`. A bridge that still reports an older version after a reload is a
packaging defect, not a tab-state problem.

## A–E. The v0.10.11 chain, now reachable

The v0.10.11 dispatch and liveness work has never run in a live Chrome. Sections
A–E of `DESKTOP_CHROME_ACCEPTANCE_V0_10_11.md` apply unchanged and are the first
real test of it:

- **A** — catch → baseline prompt visibly delivered → `4/6 · Baselinefråga`;
- **B** — the same through an Autostart preset, exactly one prompt;
- **C** — an injected bridge fault produces an audited, application-logged
  dispatch failure with a re-arm counter, not silence;
- **D** — a persistent failure becomes `FAILED` / `PROGRAM_BLOCKED` with the
  **Försök igen / Visa fel** card within roughly two minutes;
- **E** — capture backoff grows 2.5 → 5 → 10 → 20 → 30 s.

## F. Autostart precondition and abort attribution

1. Select a non-ChatGPT tab (or no tab) and press **Autostart**.

Expected: the run is refused with `AUTOSTART_PRECONDITION_FAILED` **before** the
Nano host begins loading. The model status must not enter `loading` or
`preparing_assets`, and no activation is spent.

2. With a valid ChatGPT tab, force a post-activation precondition failure (close
   the target tab during the Autostart transaction).

Expected: the Nano host reports `abort-requested` with
`reasonCode: AUTOSTART_PRECONDITION_FAILED`, and the panel detail states that the
operator did not abort. Fail the acceptance if the export or the host telemetry
records `OPERATOR_ABORT` or "avbröts av operatören" for a failure the operator did
not cause.

3. Press the activation control twice deliberately.

Expected: that abort — and only that one — is `OPERATOR_ABORT`.

## G. Release identity, as an operator check

From the delivered browser ZIP:

```
unzip -p eic-autonom-agent-v0.10.12-browser.zip content.js | grep 'const VERSION'
```

Expected: `const VERSION = "0.10.12";` — matching the panel version, the manifest
version and the export's `appVersion`. Any difference means the package must not be
installed.

## H. No regression in the established surfaces

- exactly-once automatic core-surface review replay after `READY`;
- five-minute TTL auto-apply for eligible low-risk settings;
- mandate/profile/autonomy changes still require explicit operator approval;
- level-10 boundaries still require the real operator;
- overlay X affects display only, never run state.
