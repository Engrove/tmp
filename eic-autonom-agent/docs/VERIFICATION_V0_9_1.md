# EIC Autonom Agent v0.9.1 — verification record

## Source baseline

- v0.9.0 source ZIP SHA-256:
  `2262dd7880454b5a5977a8e6895ca7f9d6a5f63758137ecee42b05874df6240c`
- Size: `885270` bytes
- ZIP entries: `306`
- ZIP CRC/path/symlink/encryption preflight: PASS

## Required focused coverage

The focused suite contains matched block and emit cases. Block-only cases are not described
as full utility coverage.

- deterministic observation identity;
- semantic normalization and deduplication;
- unchanged-reference reuse with no context/Twin/receipt inflation;
- two-cycle `NON_PROGRESSING_LOOP`;
- exactly-one post-cutoff action;
- emit twin for fresh owner evidence;
- block twin for unchanged meta-grounding;
- explicit subtask/program terminality;
- unknown request fields rejected;
- Decision Capsule locator limit;
- Nano activation reuse;
- background/prompt/sidepanel integration assertions.

## Execution results

Direct command summaries from this working copy:

- Focused: `node --test tests/v091-observation-loop.test.mjs`
  - exit `0`
  - `18/18 PASS`
- Targeted compatibility rerun:
  - exit `0`
  - `97/97 PASS`
- Full regression: `npm test`
  - exit `0`
  - `601/601 PASS`
- Validator: `npm run validate`
  - exit `0`
  - `VALIDATE CORE PASS` and `VALIDATE PASS`
- Syntax: `node --check` over every `.js`/`.mjs` file
  - exit `0`
  - `124/124 PASS`

The first full regression run found four compatibility assertions after the version bump and
anti-loop integration. The corrected, final full run above is the direct terminal result used
for this gate.

No Desktop Chrome runtime result is claimed by source-level tests.
