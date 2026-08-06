# Arkitektur — EIC Autonom Agent v0.6.0

## Översikt

```text
Sidepanel/UI
  ├─ user-gesture LanguageModel base session
  ├─ fresh task clone per inference
  └─ claim/heartbeat/result + host telemetry
            │
            ▼
MV3 background service worker
  ├─ persistent WindowContext/run/continuity
  ├─ response stability candidate
  ├─ observation supersede gates
  ├─ grounding/anti-loop/completion
  ├─ effect journal and readback-before-retry
  ├─ Mjölnar policy/registry
  └─ reconciliation scheduler
            │
            ▼
Content bridge in exact ChatGPT tab
  ├─ bounded DOM snapshot
  ├─ background signal detector
  ├─ assistant/user hashes and turn IDs
  ├─ exact composer submit
  └─ DOM acknowledgement
```

`chrome.storage.local` är state owner. Service-worker-globaler, panelprocess och LanguageModel-task-sessioner är utbytbara processvärdar.

## Ny-session-kedja

```text
exact operator string
→ SHA-256 + contract inspection
→ chunk analyses in isolated task clones
→ deterministic start-analysis validation/one repair
→ seed continuity v2
→ persist PREPARED receipt/effect
→ submit exact raw string
→ user-message digest readback
→ ACKED
```

Det finns inget target-envelope runt operatorprompten. Intern `turnId` används endast som receipt/effect identity när raw prompt inte själv kräver den.

## Foreground response trust chain

```text
DOM assistant text/hash
→ latestAssistantComplete candidate
→ repeated identical hash/epoch
→ minimum settle time
→ pending observation
→ owner-read before Nano claim
→ owner-read before decision/repair
→ owner-read before prompt submit
```

En ändrad hash/epoch ger `SUPERSEDED` och en ny stabiliseringscykel. Stale modelloutput kan aldrig skapa prompt.

## Nano trust chain

```text
minimal immutable base session
→ clone task session
→ exact request/claim/lease
→ model output
→ local parse/normalize
→ grounding
→ background freshness readback
→ deterministic progress/completion
→ continuity update
→ prompt compiler
→ destroy task clone
```

Om clone saknas används basen som compatibility fallback. 80-procents high-watermark kräver då omstart med explicit reason; i clone-läget roteras tasken automatiskt.

## Effect journal

Continuation readback använder turn-ID. Raw start readback använder canonical promptdigest. Unknown effects läses från target DOM före bounded retry. Effect innehåller dessutom source observation hash/epoch; mismatch före submit avbryter effekten.

## State och migration

- config/runtime/export v7;
- run v7;
- window v5;
- continuity v2.

Migration v6→v7 bevarar custom mandates och state, lägger till hosttelemetri och observationsfält samt uppgraderar endast det kända gamla standardmandatet.

## Säkerhetsgränser

- host allowlist endast ChatGPT;
- authhost är human boundary;
- inga credentials/cookies/tokens;
- ingen remote code eller arbitrary eval;
- ingen generell click automation;
- ingen merge/release/deploy;
- Nano kan inte skapa trusted Hjalmar- eller Mjölnar-proveniens.
