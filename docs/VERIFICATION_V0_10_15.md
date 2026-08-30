# v0.10.15 verification

Required release gates:

1. UI contract accepts bounded baselineAnalysis/forensics.
2. NANO_FAILURE accepts bounded forensics.
3. unknown additional keys remain rejected.
4. oversized forensic segments/envelopes are rejected.
5. fake-Chrome end-to-end decision traverses UI runtime client, contract parser
   and background and leaves `mission.nano.decision` evidence.
6. terminal-receipt fallback and heartbeat stale guard are present.
7. full regression, validator, syntax and package gates pass.

Desktop Chrome remains a separate acceptance surface.
