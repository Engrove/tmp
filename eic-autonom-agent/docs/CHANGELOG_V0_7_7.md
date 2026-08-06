# Changelog — v0.7.7

## Fixed

- `SEND_CONTROL_MISSING` blockerar inte längre en tom men stabil ChatGPT-kompositor före textinmatning.
- Start av systematisk granskning och ny-session-läget kan köas medan samma förberedda flik fortfarande genererar.
- Aktivt bakgrundsarbete spärrar submit på samma sätt som foreground-generation.
- Köad engångsleverans faller inte igenom sessionsgatens pre-delivery-timeout.
- Readiness och effektjournal använder nu samma busy-begrepp.

## Preserved

- addonen skapar aldrig en ny ChatGPT-flik eller session;
- pågående svar avbryts aldrig;
- endast den uttryckligen kopplade och valda fliken används;
- v0.7.6:s dubbla fältisoleringsgrindar;
- APP_AUDIT_LONG-ledger- och owner-route-gränser.

