# Architecture — EIC Autonom Agent v0.6.1

## Komponenter

- `content.js`: DOM owner för aktuell ChatGPT-snapshot, foreground/background-signaler och promptreadback.
- `background.js`: durable state machine, observation freshness, Nano coordination, PAUSE-adjudikering, Mjölnar och effect journal.
- `sidepanel.js`: användargesterad Nano-host, beslutsschema och operatörsstatus.
- `lib/destructiveness.mjs`: EIC_DESTRUCTIVENESS/1 och Hjalmar mental-control gate.
- `lib/mjolnar.mjs`: action allowlist, idempotency, delegation och readback.
- `lib/fallback-planner.mjs`: deterministic protocol fallback.
- `lib/migration-v7-v8.mjs`: v8 migration.

## Foreground response trust chain

```text
DOM snapshot
  → scoped Stop control
  → assistant streaming marker
  → composer busy marker
  → terminal EIC trailer candidate
  → protocol completion override
  → stable repeated response hash
  → parser
```

En Stop-knapp ensam är medium confidence. Streaming/composer busy är high confidence. Terminal EIC-trailer utan streaming/composer busy kan ge `COMPLETE_PROTOCOL_OVERRIDE`.

## Nano trust chain

```text
stable observation
  → claimed Nano request
  → isolated task session
  → grounding validation
  → local destructiveness classification
  → local continuation disposition
```

Nano kan inte skapa permissions, owner evidence, trusted Hjalmar provenance eller arbitrary actions.

## Mjölnar trust chain

`NANO_PROPOSED` är endast input. `LOCAL_STATE_MACHINE` skapas först efter statisk action lookup och exakt target binding. Dispatch är at-most-once och följs av owner-readback. Unknown prior effect under nivå 10 leder till ny owner-read; nivå 10 leder till human gate.

## State machine

Viktiga states:

- `WAITING_FOREGROUND`
- `WAITING_BACKGROUND`
- `WAITING_FOR_RESPONSE`
- `ASSESSING`
- `RECOVERING`
- `CONTINUING`
- `MJOLNAR_*`
- `HUMAN_REQUIRED`
- `DONE`
- `STOPPED`

`SOFT_PAUSED` finns för backward compatibility och direkt operatörspaus. v8 omklassificerar automatiska legacy-pauser till `RECOVERING`.

## Schema v8

- config: `eic.autonom.config.v8`
- runtime: `eic.autonom.runtime.v8`
- export: `eic.autonom.export.v8`
- run: `eic.autonom.run.v8`
- audit: `eic.autonom.audit.v8`

Run lagrar riskbedömning, Hjalmar mental-control, foreground evidence och autonomy policy version.

## Claim boundary

Lokala tester verifierar modullogik och source wiring. De verifierar inte aktuell ChatGPT DOM, faktisk Chrome Prompt API-runtime, installation, deployment eller externa owner-effekter.
