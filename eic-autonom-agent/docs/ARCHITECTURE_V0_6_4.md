# Architecture — EIC Autonom Agent v0.6.4

## Översikt

```text
ChatGPT DOM
  → trusted content snapshot
  → session readiness gate (endast NEW_SESSION)
  → response stability + protocol parser
  → observation
  → protocol fast path eller Nano
  → nano input budget (contextfönster → teckenbudget → sektionsallokering)
  → decision grounding
  → destructiveness/Hjalmar control
  → optional Mjölnar delegation
  → anti-loop korrigering (bifogar, ersätter inte konkret arbete)
  → turn compiler
  → effect journal + prompt submit
  → DOM acknowledgement/readback
```

Durable state ligger i `chrome.storage.local`. Sidepanelen är UI och Nano-host, inte source of truth.

## Nano input budget (nytt i v0.6.4)

```text
contextWindow (host)
  − contextUsage (bassession)
  − outputReserveTokens
  − frameReserveTokens
  × safetyFactor
  = availableTokens
  × charsPerToken (konservativt 2,6)
  × degradeFactor (1,0 → 0,6 → 0,35)
  = maxPromptChars
```

Sektionsprioritet: continuity-projektion → senaste målsvar → target mandate →
konversationsutdrag. Byggaren mäter den **faktiska** promptlängden och krymper i högst fyra
rundor. `measureInputUsage()` används som förmätning när Chrome exponerar det.
`QuotaExceededError` startar nästa degraderingssteg; en uttömd stege rapporteras som verkligt
Nano-fel.

## Kontinuitetens livscykel

```text
applyNanoDecision
  → position (workUnit + provenance + phase)
  → items (dedupe on write)
  → antiLoop (progress → productive; segmentklassificering)
  → expireStaleBlockers (silence → open:false + closedReason)
  → compactContinuity (semantisk merge + åldersgallring → count trim → bytetak)
```

Projektionen kan dessutom bindas till promptbudgeten via `maxChars`. Intent, position och
öppna blockerare gallras aldrig.

## Session initialisation gate

```text
PENDING_TAB_READY
  → PENDING_COMPOSER_STABLE   (3 stabila probes, oförändrad epoch/URL/locator, bridge-version)
  → PENDING_PROMPT_ACK        (endast engångsstarten får levereras här)
  → PENDING_FIRST_RESPONSE    (all autonom dispatch spärrad)
  → INITIALIZED
```

`FAILED_TIMEOUT` kan bara inträffa före leverans. En run utan gate spärrar ingenting.
Spärren sitter i `executePreparedEffectUnlocked()` — den enda punkt där en prompt når mål-DOM.

## Revision discipline

Oförändrad från v0.6.3: `stateRevision` ökar vid durable mutation, och `tickWindow`
returnerar endast snapshot under aktiv deterministic callback-lease.

## Mjölnar separation

Oförändrad från v0.6.3. `VERIFIED_EFFECT` kräver fortfarande allowlistad dispatch följd av
matchande owner-readback.

## Security

- targettext är untrusted data;
- måltext får sätta position, aldrig owner-bevis eller behörighet;
- inga nya permissions från modelltext;
- ingen auth/CAPTCHA/secretautomation;
- ingen generell DOM-click/exekvering;
- Mjölnar använder statisk action registry;
- en stängd blockerare påstår aldrig resolution.
