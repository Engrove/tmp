# v0.10.15 incident basis

Observed v0.10.14 failure:

`UI_COMMAND_PAYLOAD_KEY_NOT_ALLOWED:NANO_DECISION:baselineAnalysis`

The installed run had already delivered and ACKed the baseline prompt, parsed the
adversarial baseline, claimed one `CONTINUATION_ANALYSIS` request and produced
1595 characters / 387 chunks in about 107.8 seconds. The 180-second baseline
limit did not fire.

Root cause: `sidepanel.js` emitted `baselineAnalysis` and `forensics`, while
`lib/ui-contract.mjs` still carried the older NANO_DECISION/NANO_FAILURE
allowlists. The result therefore died before `background.js`, and forensic
output was lost.

v0.10.15 makes the command contract match the producer and consumer and adds a
bounded terminal-transport recovery guard.
