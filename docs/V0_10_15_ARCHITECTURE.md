# v0.10.15 architecture delta

Critical baseline Nano terminal path:

`sidepanel -> createUiRuntimeClient -> createUiCommand/validatePayload ->
chrome.runtime -> background UI_COMMAND_HANDLERS -> apply/fail Nano request`

Contract law:

- NANO_DECISION may carry `baselineAnalysis` and `forensics`.
- NANO_FAILURE may carry `forensics`.
- both objects are bounded and type checked at the UI boundary.
- unknown fields remain rejected fail-closed.
- a claimed baseline Nano request with no heartbeat for 90 seconds is requeued
  while claim budget remains, otherwise session init fails visibly.
- the 90-second stale guard is independent of the 180-second baseline model
  deadline and the 30-minute global Nano wall timeout.
