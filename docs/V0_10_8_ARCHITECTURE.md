# EIC Autonom Agent v0.10.8 — Main-task control and full-audit owner proof

## Scope

v0.10.8 is a bounded forward-only hotfix on the exact v0.10.7 source baseline.

It changes two surfaces:

1. full-audit directory admission and retention;
2. Nano continuity control for the stable main task, 80/20 priority and justified detours.

It does not claim installed Desktop Chrome behavior, Forgejo persistence, release, deployment or publication.

## Source evidence

The v0.10.7 runtime export showed an active task binding while durable continuity still had an empty intent, empty work unit, no verified facts or constraints, and `takeoverBootstrapRequired=true`. This made it possible for a continuation to be locally grounded yet no longer tied to an explicit stable program objective.

The supplied WP25.3 transcript also showed a later continuation restarting from a generic “Establish initial operational state”/Workspace-discovery unit after the program already had a concrete blocker and acceptance direction. Some sanitation work was logically necessary blocker removal, so a blanket ban on detours would be wrong. The missing contract was explicit classification plus a return condition.

The audit source showed a different owner-boundary defect: File System Access exposed only `handle.name`, but the implementation treated basename `temp` as proof of absolute `C:\temp`.

## Main-task baseline

`lib/main-task-guard.mjs` owns the routing-context contract:

- schema: `eic.main-task-baseline.v1`;
- stable main task and program goal;
- measurable success criteria;
- active milestone and bounded work unit;
- in/out scope and constraints;
- owner surfaces and exact locators;
- blockers and latest material delta;
- 80/20 `vitalFew` and `deferredMany`;
- active, required and missing global skills;
- bounded detour reasons and return condition;
- evidence locators and owner-read timestamp.

The target session supplies this object only after Nano emits the predetermined baseline request. The object remains `ROUTING_CONTEXT`; it cannot prove skill activation, repository state, runtime state or any other owner fact.

## Track classification

Every Nano decision now includes `trackControl`:

- `BASELINE_REQUESTED`: the baseline is absent; request it before normal continuation;
- `ON_TRACK`: the candidate directly advances the baseline;
- `JUSTIFIED_DETOUR`: a required owner dependency, safety boundary, blocker removal or required validation;
- `DRIFT`: unrelated or low-leverage work; emit a concrete correction;
- `INSUFFICIENT_CONTEXT`: evidence is too weak.

A justified detour requires:

- `currentActionRelation=REQUIRED_DETOUR`;
- a concrete reason;
- an exact return condition;
- `HIGH_LEVERAGE` or `NECESSARY_ENABLER` under the 80/20 rule.

## First Nano action

When no valid baseline exists and the ChatGPT surface is not actively generating, `startWaiting` creates one synthetic routing observation and queues `TAKEOVER_BOOTSTRAP`. Nano’s only valid requested action is then the canonical `HUVUDUPPGIFTSKONTROLL` prompt.

When the surface is already generating, the addon does not interrupt it. The first completed assistant response is inspected for the baseline; if absent, Nano requests it.

Deterministic protocol repair and fast-path continuation are not admitted before a main-task baseline exists.

## Full-audit correction

The browser cannot verify an absolute Windows path from a File System Access handle. v0.10.8 therefore:

- accepts an operator-selected existing directory handle with a safe basename;
- requires `readwrite` permission;
- creates a unique probe file;
- writes a random marker;
- reads the marker back byte-for-byte;
- deletes the probe;
- only then stores the handle and marks the sink ready.

The claim is deliberately bounded to “the selected handle is writable.” `C:\temp` remains a recommendation, not a browser-verifiable absolute path.

Audit sink state is now stored under the version-neutral key `eicAutonomAgent.fullAuditSink.v1`, with migration from legacy keys. Segment retention uses a version-neutral matcher and therefore also prunes v0.10.7 and v0.10.8 segment names.

## Safety

- Transcript and target baseline data remain untrusted routing context.
- Global-skill status must be reported from live `global.get`/payload reads; Nano cannot invent it.
- No owner evidence class is promoted.
- No new permission is granted.
- Audit failure remains fail-soft for the main run.
- Probe cleanup runs in `finally`.
