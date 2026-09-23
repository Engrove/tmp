# Greenfield v1.5.2 — Background sleep, EIC surface recovery and Arbetsläge

Baseline: v1.5.1.

## Runtime corrections

### BACKGROUND_SLEEP
`PAUSE_PROCESS` retains its v1.5.1 meaning: hold the worker until the not-before time.
`BACKGROUND_SLEEP` is available only for queue-managed work and requires `status=CONTINUE`, a restart-safe `nextSuggestedAction`, and `pauseSeconds=300..86400`.

When another queue item is runnable, Greenfield checkpoints the current mission, stores its process snapshot, marks the item PAUSED until `pauseUntilMs`, and immediately activates the next READY item. If no alternate item exists, it falls back to a normal timed process pause rather than spinning.

### Managed EIC surface guard
Greenfield remembers only verified custom-GPT roots (`/g/<id>`). A generic ChatGPT root or another custom GPT is not accepted as the managed EIC surface. A mismatch receives a 10 second grace period; if still wrong, the managed tab is navigated to the last-known-good EIC root. Generic `https://chatgpt.com/` can never replace the remembered good root.

## Arbetsläge (WORK_MODE)

Arbetsläge is opt-in and disabled by default. Enabling it binds one Greenfield worker as the supervisor for this Chrome profile.

Expected EIC Backend endpoint:
`https://api.elho.fi/greenfield/work-mode/v1`

Client contract:
- `GET /tasks/next?workerId=<id>&ts=<unix-ms>` -> 204 or a `eic.greenfield.work-mode.pointer.v1`
- `POST /status` -> compact `eic.greenfield.work-mode.status.v1`

A WMT pointer carries `taskRef`, `revision`, short `objective`, `issuedAtMs`, `expiresAtMs`, `nonce`, and a short-lived backend-issued `taskKey`. The browser does not require interactive login. Timestamp is freshness only; it is not treated as sender authentication. `taskKey` is the bounded capability used for the WMT transaction.

Nano/runtime stores accepted pointers in a local deduped prequeue. When profile capacity is available, Greenfield opens a background EIC custom-GPT window, creates an isolated worker identity, and starts the WMT using a short A2A pointer prompt. The full immutable WMT package remains backend-owned and is resolved by `taskRef`/`taskKey`.

Manual Uppdragskö is not replaced and its v1.5.1 worker-isolation guarantees remain in force.

## Load boundary
Ordinary Greenfield sessions pay only the small deterministic EIC-surface classification. Work Mode network polling is disabled unless explicitly enabled, is bound to one supervisor worker, and is throttled to one poll per 15 seconds. Worker materialization checks the existing global scheduler capacity first.

## Backend boundary
This extension implements the Greenfield client/runtime half of Work Mode. The `api.elho.fi` WMT addon is a separate backend-owned effect and must implement the documented endpoints before live Work Mode can return tasks.
