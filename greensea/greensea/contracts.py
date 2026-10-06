"""Closed vocabularies and the mission state machine.

Everything that is a decision boundary in GreenSea is an explicit constant here,
so the engine, the API and the tests share one definition.
"""

from __future__ import annotations


class Phase:
    DRAFT = "DRAFT"                    # created, never started
    SENDING = "SENDING"                # waiting for llama capacity, then dispatching
    GENERATING = "GENERATING"          # streaming response from llama.cpp
    ANALYZING = "ANALYZING"            # parse, effects, controller decision (+ reviewer)
    ROTATING = "ROTATING"              # building a fresh session from the checkpoint
    RECOVERING = "RECOVERING"          # technical backoff before retrying
    PAUSED = "PAUSED"                  # timed (model) or open-ended (operator) pause
    NEEDS_OPERATOR = "NEEDS_OPERATOR"  # waits for an operator decision; not terminal
    DONE = "DONE"                      # mission finished (operator may reopen)
    STOPPED = "STOPPED"                # operator stop (operator may reopen)

    ALL = (DRAFT, SENDING, GENERATING, ANALYZING, ROTATING, RECOVERING,
           PAUSED, NEEDS_OPERATOR, DONE, STOPPED)


# Phases in which a runner task drives the mission forward.
RUNNING_PHASES = frozenset({
    Phase.SENDING, Phase.GENERATING, Phase.ANALYZING, Phase.ROTATING, Phase.RECOVERING,
})
# Phases that end the active life of a mission until an operator acts.
TERMINAL_PHASES = frozenset({Phase.DONE, Phase.STOPPED})
# Phases where nothing happens without an operator (PAUSED only when open-ended).
OPERATOR_WAIT_PHASES = frozenset({Phase.DRAFT, Phase.NEEDS_OPERATOR, Phase.DONE, Phase.STOPPED})

_SAFETY = {Phase.NEEDS_OPERATOR, Phase.STOPPED}

ALLOWED_TRANSITIONS: dict[str, frozenset[str]] = {
    # Start = ROTATING into session 1 (the opening session is built like any rotation).
    Phase.DRAFT: frozenset({Phase.ROTATING, Phase.STOPPED}),
    Phase.SENDING: frozenset({Phase.GENERATING, Phase.ROTATING, Phase.RECOVERING, Phase.PAUSED} | _SAFETY),
    Phase.GENERATING: frozenset({Phase.ANALYZING, Phase.SENDING, Phase.ROTATING, Phase.RECOVERING, Phase.PAUSED} | _SAFETY),
    Phase.ANALYZING: frozenset({Phase.SENDING, Phase.ROTATING, Phase.RECOVERING, Phase.PAUSED, Phase.DONE} | _SAFETY),
    Phase.ROTATING: frozenset({Phase.SENDING, Phase.RECOVERING, Phase.PAUSED} | _SAFETY),
    Phase.RECOVERING: frozenset({Phase.SENDING, Phase.ANALYZING, Phase.ROTATING, Phase.PAUSED} | _SAFETY),
    Phase.PAUSED: frozenset({Phase.SENDING, Phase.ROTATING} | _SAFETY),
    Phase.NEEDS_OPERATOR: frozenset({Phase.SENDING, Phase.ROTATING, Phase.STOPPED}),
    Phase.DONE: frozenset({Phase.ROTATING, Phase.STOPPED}),
    Phase.STOPPED: frozenset({Phase.ROTATING}),
}


class IllegalTransition(RuntimeError):
    pass


def check_transition(current: str, nxt: str) -> None:
    if current == nxt:
        return
    if nxt not in ALLOWED_TRANSITIONS.get(current, frozenset()):
        raise IllegalTransition(f"ILLEGAL_TRANSITION:{current}->{nxt}")


class TurnState:
    PREPARED = "PREPARED"      # objective known, user message not yet rendered/sent
    DISPATCHED = "DISPATCHED"  # user message persisted (write-ahead) and sent
    COMPLETED = "COMPLETED"    # assistant response committed into the session
    ABANDONED = "ABANDONED"    # operator stop before completion


class MessageType:
    MISSION_START = "MISSION_START"
    CONTINUATION = "CONTINUATION"
    SESSION_ROTATION = "SESSION_ROTATION"

    SESSION_OPENING = frozenset({MISSION_START, SESSION_ROTATION})


class Status:
    CONTINUE = "CONTINUE"
    DONE = "DONE"
    BLOCKED = "BLOCKED"
    UNKNOWN = "UNKNOWN"

    MODEL = (CONTINUE, DONE, BLOCKED)


PRIORITIES: dict[str, int] = {"LOW": 0, "NORMAL": 1, "HIGH": 2, "URGENT": 3}
# The model may move its own mission inside this set, never above the operator ceiling.
MODEL_PRIORITIES = ("LOW", "NORMAL", "HIGH")


def normalize_priority(value: object, default: str = "NORMAL") -> str:
    v = str(value or "").strip().upper()
    return v if v in PRIORITIES else default


class Receipt:
    APPLIED = "APPLIED"
    ALREADY_APPLIED = "ALREADY_APPLIED"
    REJECTED = "REJECTED"
    INVALID = "INVALID"


class RotationReason:
    MISSION_START = "MISSION_START"
    CONTEXT_PRESSURE = "CONTEXT_PRESSURE"
    CONTEXT_EXCEEDED = "CONTEXT_EXCEEDED"
    MODEL_REQUEST = "MODEL_REQUEST"
    OPERATOR = "OPERATOR"
    OPERATOR_REOPEN = "OPERATOR_REOPEN"
    MISSION_UPDATED = "MISSION_UPDATED"
    SESSION_TURN_LIMIT = "SESSION_TURN_LIMIT"
    PROTOCOL_FAILURES = "PROTOCOL_FAILURES"
    REPETITION = "REPETITION"


# Hard caps on what the model may store through GreenSea.
MEMORY_MAX_KEYS = 64
MEMORY_KEY_MAX_CHARS = 64
MEMORY_VALUE_MAX_CHARS = 2000
ARTIFACT_MAX_COUNT = 64
ARTIFACT_NAME_MAX_CHARS = 80
ARTIFACT_MAX_BYTES = 1_000_000
MAX_MEMORY_OPS = 16
MAX_ARTIFACT_OPS = 4
MAX_CONTROL_OPS = 4
MAX_READ_ARTIFACT_OPS = 2
PAUSE_MIN_SECONDS = 60
PAUSE_MAX_SECONDS = 86_400

MAX_GOAL_CHARS = 60_000
MAX_TITLE_CHARS = 200
MAX_INSTRUCTION_CHARS = 12_000
