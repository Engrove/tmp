# Greenfield Session Rotation Contract v1.2.3

## Purpose

Session rotation lets one Greenfield mission continue through a fresh ChatGPT/EIC
conversation without converting the rotation into a new mission or replaying completed work.

## Control

Target EIC response may include:

- `sessionAction=KEEP` — continue in the current conversation.
- `sessionAction=ROTATE_SESSION_NOW` — immediately move the same mission to a fresh EIC chat.
- `sessionAction=STOP_PROCESS` — terminate the Greenfield process.
- `status=DONE` remains a backward-compatible explicit terminal mission signal.

`ROTATE_SESSION_NOW` is a machine control. Ordinary prose, `blockers[]`, or the word BLOCKER
does not request rotation.

EIC should request proactive rotation when the current session is still functioning but has a
material risk of context noise, context drift, contradictory accumulated state, stale
assumptions, overload, or degraded decision quality.

## Runtime recovery

The stale WAIT ladder is:

`30m F5 -> 60m Ctrl-F5 -> 90m Ctrl-F5 -> 120m SESSION_ROTATION`

Repeated failure to reattach a missing managed tab may also arm the same rotation path.

## Identity and owner continuity

Rotation preserves the same `processId`, `runId`, goal and canonical mission. It increments
`generation`, `sessionSeq` and turn ownership. The prior session is therefore stale after the
rotation write-ahead commit.

The receiving chat gets `messageType=SESSION_ROTATION`, not `MISSION_START`. It must reconstruct
current work from Greenfield Works plus fresh owner routes. It must not infer current position
from the repeated mission text and must not replay completed work.

## GPT target resolution

The runtime derives the custom-GPT root from the managed `chrome.tabs.Tab.url` when that URL
contains `/g/<gpt-id-slug>`. If the current conversation URL no longer carries that segment,
the process-persisted `gptRoot` is the fallback. A replacement tab is created only when a
usable managed/matching tab is unavailable.

## Exactly-once boundary

A prompt dispatch with an unacknowledged possible/unknown effect is not rotated into a new
conversation. That state is fail-closed because a new chat cannot prove whether replaying the
pending prompt would duplicate the effect.

## Acceptance boundary

Source/package tests can verify the state machine, parser, URL resolver, control mapping and
static Chrome API wiring. Live Desktop Chrome/ChatGPT acceptance is separate and must verify at
least one real old-chat -> fresh-chat -> continuation handoff before deployment is called live.
