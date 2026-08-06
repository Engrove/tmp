# Arkitektur v0.5.0

## Beslut

v0.5.0 är ett durable workflow. JavaScript-körkontext är utbytbar; persistent state är agentens kontinuitet.

## Komponenter

```text
chrome.storage.local
  ├─ config + Nano/target mandates
  ├─ continuity
  ├─ runtime.windows[windowId]
  ├─ effect journal
  ├─ start-prompt receipts
  └─ audit
          ▲
          │ single writer
background.js (MV3 service worker)
  ├─ alarms/startup/install
  ├─ tabs/windows lifecycle
  ├─ reconciliation
  ├─ state transitions
  ├─ prompt compilation
  └─ bounded recovery/fallback
      │                 ▲
      ▼                 │
content.js          sidepanel.js
DOM adapter         UI + optional Nano host
```

## Run states

`IDLE`, `PREPARING`, `WAITING_FOR_RESPONSE`, `ASSESSING`, `CONTINUING`, `RECOVERING`, `SOFT_PAUSED`, `HARD_BLOCKED`, `DONE`, `STOPPED`, `ERROR_RETRYABLE`, `ERROR_TERMINAL`.

`PAUSE` är input till pausklassificering, inte ett enda absorberande state.

## Waiting Mode

Start läser:

- response hash;
- complete-flagga;
- assistant count;
- conversation key;
- document epoch.

Ingen prompt eller stop-generation-effekt skickas. En response blir ny när den är komplett och minst ett av hash/count/complete-transition skiljer den från baseline.

## Ny session

1. använd aktiv tom stödd ChatGPT-flik eller skapa ny flik i samma Chrome-fönster;
2. verifiera composer, tom session och ingen generation;
3. Nano analyserar hela prompten i högst 16 segment om 10 000 tecken;
4. build canonical start-turn;
5. skriv PREPARED + sessionskvitto;
6. submit;
7. bekräfta turn-ID i senaste user-meddelande;
8. lagra post-conversation key;
9. vänta.

## Tab/window-kontrakt

`WindowContext`:
- exakt Chrome window id;
- target mode LOCKED/FOLLOW;
- selected tab;
- linked tabs;
- högst en aktiv run;
- per-window audit view.

`LinkedTabContext`:
- tab/window id;
- URL/origin;
- title;
- conversation key;
- document epoch;
- last observation;
- state badge.

Regler:
- endast uttryckligt kopplade flikar;
- FOLLOW får bara byta selected tab när ingen aktiv run finns;
- aktiv run fortsätter vara låst till sitt target tab;
- onDetached/onAttached flyttar link record men väljer aldrig automatiskt mål i nytt fönster;
- onReplaced migrerar tab-id och kräver reconciliation;
- onRemoved/origin navigation pausar och bevarar state;
- windows.onRemoved arkiverar run som orphaned utan extern stop-effekt.

Detta är en lokal anpassning av planerade WP30-principer, inte en implementation av EIC Home/Chrome Companion.

## Prompttrust

Målsessionens text är data. Enda vägen till kontrollbeslut går via:
- current-turn target-result parser;
- Nano schema;
- lokal boundary classifier;
- deterministic hard-stop policy.

Nano-mandatets canary måste vara absent från outbound prompt. Target claims får aldrig auto-promoveras till verified facts.

## Liveness

Varje icke-terminal run har minst en av:
- väntat DOM/event;
- alarm/watchdog;
- nextRecoveryAt;
- pending effect;
- pending Nano request;
- immediate deterministic transition.

Side panel kan stängas utan att run state försvinner. Lokal Nano saknas då, men Max Mode kan efter graceperiod använda en bounded deterministic fallback. Normal mode bevarar state och soft-pausar när semantisk modellbedömning verkligen krävs.

## Begränsningar

- ChatGPT DOM är inte ett officiellt transaktions-API.
- Exakt-once kan därför bara uppnås som effectively-once under observerbar DOM.
- Browser/desktop soak är inte utförd av Node-testsviten.
- Prompt API availability och modeldownload varierar mellan Chrome-profiler.
