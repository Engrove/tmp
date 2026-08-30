# Verification — EIC Autonom Agent v0.10.4

## Baseline

Input source:

- v0.10.3 source SHA-256: `3d5936a611b96225b565312708e424d2a5edc1f8fbb5f71ad07a3571d5fbbe7e`
- size: 1,011,231 bytes
- ZIP entries: 386
- CRC, unsafe-path, symlink and encryption checks: PASS

Unchanged baseline:

- full regression: 762/762 PASS
- validator: PASS
- syntax: 145/145 PASS
- packaging: PASS

## v0.10.4 focused fixtures

Final direct source gates:

- focused v0.10.4 fixtures: 15/15 PASS;
- full regression: 777/777 PASS;
- validator: PASS;
- syntax: 151/151 PASS.

The focused set covers:

- stable fingerprint and one automatic attempt;
- volatile document epoch exclusion;
- paused/stopped run blocking;
- active sweep cancellation;
- five-minute auto-apply scheduling and disabling;
- attention priority and locator routing;
- ordered Autostart presets and D1/D2 confirmation.

## Required final gates

- focused v0.10.4 fixtures;
- full regression;
- validator;
- syntax check;
- package creation;
- ZIP CRC/path/symlink/encryption checks;
- independent rerun from the frozen source ZIP.

## Claim boundary

A green source/package gate does not prove installed-runtime behavior. Desktop Chrome must separately verify capture cancellation, no-repeat behavior, TTL application, attention navigation and Autostart.
