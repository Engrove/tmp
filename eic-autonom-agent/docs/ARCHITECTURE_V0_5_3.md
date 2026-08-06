# Arkitektur — EIC Autonom Agent v0.5.3

## Översikt

```text
Sidepanel/UI + Chrome Nano
        │ claim/heartbeat/result
        ▼
MV3 background service worker
  ├─ persistent run store
  ├─ response classifier policy
  ├─ Nano request owner
  ├─ grounding/anti-loop/completion gates
  ├─ effect journal
  ├─ Mjölnar policy/registry
  └─ reconciliation scheduler
        │ exact tab messages
        ▼
Content bridge i kopplad ChatGPT-tab
  ├─ bounded DOM snapshot
  ├─ background signal detector
  ├─ turn-ID extraction
  ├─ composer submit
  └─ DOM readback
```

`chrome.storage.local` är state owner. Service-worker-globaler och sidepanelen är utbytbara processvärdar.

## Komponenter

### `content.js`

- lagerindelade ChatGPT-selektorer;
- exact conversation locator;
- background/statusdetektor;
- explicit exkludering av extensionens egen UI;
- bounded user turn-ID set;
- response/task hashes;
- composer submit och acknowledgement;
- MutationObserver-dirty signal.

### `background.js`

- single-writer queue;
- storage-backed WindowContext;
- run state machine;
- watchdog/reconciliation;
- Nano request/claim owner;
- deterministic grounding/progress/completion;
- prompt journal och readback-before-retry;
- Mjölnar request/dispatch/readback;
- storage circuit breaker.

### `sidepanel.js`

- UI;
- direct-user-gesture LanguageModel creation;
- Nano inference;
- streaming och heartbeat;
- strict JSON normalization;
- config/export/import.

Sidepanelen äger inte run state och får inte skapa fallback continuation när den stängs.

### Pure policy modules

- `chatgpt-state-classifier.mjs`
- `background-wait-controller.mjs`
- `decision-grounding.mjs`
- `effect-journal.mjs`
- `fallback-planner.mjs`
- `mjolnar.mjs`
- `nano-pipeline.mjs`
- `prompt-contract.mjs`
- `runtime-safety.mjs`
- `state-machine.mjs`
- migrations.

## State ownership

| Data | Owner |
|---|---|
| Config/runtime/continuity | `chrome.storage.local` |
| Current DOM snapshot | exact content bridge read |
| Nano result | exact request+claim response |
| Prompt effect | target DOM readback |
| Tab URL/lifecycle | `chrome.tabs` |
| Alarm | wake/reconcile signal only |
| Sidepanel UI | presentation only |
| Nano model session | sidepanel process-local |

## Background trust chain

```text
DOM roots
→ exclude assistant messages
→ exclude [data-eic-own-ui]
→ structure/progress/control evidence
→ localized text fallback
→ classifier
→ WAITING_BACKGROUND
```

Extensionens egen badge är dekorativ, `aria-hidden` och inte trusted evidence.

## Effect journal trust chain

```text
PREPARED
→ storage write
→ all known turn IDs read
→ submit exact prompt
→ target DOM acknowledgement
→ ACKED
```

Vid unknown effect:

```text
read exact target
→ turn visible: ACKED
→ not visible and bounded retry safe: RETRY_PREPARED
→ ambiguous/limit: pause
```

Turn-ID-setet är bounded och bevaras i content bridge samt linked-tab state.

## Nano trust chain

```text
stable target observation
→ PENDING request in storage
→ sidepanel claims request
→ RUNNING lease + heartbeat
→ model output
→ parse/normalize
→ grounding
→ deterministic progress/completion
→ continuity update
→ prompt compiler
```

Modeloutput får inte:
- skapa trusted Mjölnar source class;
- skapa Hjalmar provenance;
- bevisa progress;
- bevisa completion;
- ändra hard boundaries.

## Locatorpromotion

Tillåtna locatorförändringar:

- tom → exakt conversation: `BIND`;
- root/GPT → exakt conversation: `PROMOTION`;
- samma → `UNCHANGED`.

All annan förändring är `MISMATCH` och failar stängt.

## State transition policy

Säkerhetsövergångar till:

```text
SOFT_PAUSED
HARD_BLOCKED
HUMAN_REQUIRED
ERROR_RETRYABLE
ERROR_TERMINAL
STOPPED
```

är tillåtna från varje icke-terminalt state. Terminala runs ignorerar sena tab-/window-events. Normala workflowövergångar följer explicit tabell och kan fortfarande kasta vid programmeringsfel.

`tickAll` isolerar varje window med egen try/catch.

## Storage policy

Före varje promptleverans måste relevant run/journal state vara persisterat.

Bounded data:
- recovery 40;
- effect journal 12;
- seen turn IDs 128;
- audit 240;
- compact continuity.

Storage rejection:
1. circuit öppnas;
2. emergency compact state försöker skrivas;
3. run markeras `HARD_BLOCKED(STORAGE_PERSISTENCE_FAILURE)`;
4. prompt paths vägrar exekvera.

## Mjölnar

### Proveniens

```text
NANO_PROPOSED             untrusted candidate
LOCAL_STATE_MACHINE       trusted trigger only if genuinely constructed locally
TRUSTED_EXTERNAL_CHANNEL  required Hjalmar provenance for D1
```

### Dispatch

D0/D1 kan endast välja statiskt registrerade action codes. D2 denylist använder token-boundary-matching över action, proposed action, effect, target, rollback och owner surface.

Efter verified effect omgrundas beslutet som `CONTINUE`.

## MV3-livscykel

Top-level listeners registreras synkront. State läses från storage vid varje operation. Alarm, tab events, startup, install, panelöppning och content dirty-signal triggar reconciliation.

Inga correctness-krav bygger på att service workern hålls levande.

## Säkerhetsgränser

- host allowlist endast ChatGPT;
- authhost behandlas som human boundary, ingen injektion;
- inga credentials/cookies/tokens;
- ingen remote code;
- ingen arbitrary eval;
- ingen generell click automation;
- ingen cross-origin agent;
- inget merge/release/deploy.
