# v0.11.7 Verification

Required discriminating checks:

- stream-mode schema-bound EOF with incomplete JSON throws `NANO_INCOMPLETE_JSON`;
- request-mode schema-bound incomplete JSON throws `NANO_INCOMPLETE_JSON`;
- complete JSON with trailing host chatter is reduced to the first complete object;
- valid complete JSON above the 6,000-character advisory threshold remains non-fatal below the schema hard cap;
- incomplete JSON at the schema hard cap remains bounded by the existing hard limit;
- one JSON-format repair remains the only semantic repair; incomplete repaired output terminalizes with the typed error;
- v0.11.5 actor/capability and one-diagnostic/no-repeat controls remain byte-identical where unchanged.

This document records source/package acceptance only. Desktop Chrome runtime acceptance requires installed live evidence.
