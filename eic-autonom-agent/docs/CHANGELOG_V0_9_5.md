# Changelog v0.9.5

## Runtime defect

The v0.9.4 Desktop Chrome emit twin proved that `Starta valt uppdrag` could create a mission without starting the Chrome LanguageModel host. The first pre-existing response was then classified as invalid protocol and dispatched through deterministic `PROTOCOL_REPAIR`, producing immediate standard replies with zero Nano input/output.

## Changes

- All active mission modes now require a gesture-bound Nano host.
- LanguageModel creation begins synchronously inside the mission-start click before config or input awaits.
- Mission start fails closed with `NANO_HOST_NOT_READY` if the host is unavailable.
- `TAKEOVER_BOOTSTRAP` always routes through Nano, regardless of the observed footer.
- An invalid response after a `PROTOCOL_REPAIR` routes through Nano instead of creating another repair.
- Repair action text is rebound to the newly allocated repair turn ID.
- EIC-AA/4 parser now enforces the current completion taxonomy:
  - `CONTINUE` + `UNIT_DONE|MILESTONE_CONTINUE`;
  - `USER_PAUSE` + `PROGRAM_BLOCKED`;
  - `DONE` + `PROGRAM_DONE`.
- Retired `PAUSE` and `FULL_STOP` statuses are rejected.
- Mutable continuity work copies no longer alias sealed runtime snapshots.

## Boundary

This source/package change does not prove installation, live Nano inference or Desktop Chrome acceptance. Those require a new runtime emit twin.
