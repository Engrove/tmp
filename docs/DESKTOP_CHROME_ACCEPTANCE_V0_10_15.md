# Desktop Chrome acceptance — v0.10.15

Re-run the same adversarial baseline scenario.

PASS requires:

- baseline prompt is delivered exactly once and ACKed;
- exactly one Nano claim;
- NANO_DECISION reaches background with baselineAnalysis + forensic evidence;
- application/full-audit contains output SHA-256, bounded output segments,
  captured/omitted counts, parse/init metadata and baseline verdict;
- DRIFT/INSUFFICIENT_CONTEXT produces only canonical baseline correction;
- no `UI_COMMAND_PAYLOAD_KEY_NOT_ALLOWED` error;
- if the panel disappears after claim, stale heartbeat requeues or visibly
  fails rather than leaving RUNNING/NANO_ANALYZING indefinitely;
- unknown UI command payload keys still fail closed.

The 180-second baseline deadline remains unchanged for this acceptance run.
