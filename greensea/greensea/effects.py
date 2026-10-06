"""Model-requested effects: memory notes, artifacts and runtime control.

GreenSea is the effect owner. Every request is checked against a closed whitelist
and hard bounds, simulated in order against the current state, and turned into a
typed operation plus a receipt. Nothing is evaluated, followed or spread from
model output into runtime state. Planning is pure; applying happens in the same
database transaction as the controller decision (engine.py), so an effect is
applied exactly once or not at all.

Precedence (from Greenfield runtime-control): operator > GreenSea owner state >
model request. A model SET_PRIORITY is rejected when the operator changed the
mission after the turn was dispatched, and can never exceed the operator ceiling.
"""

from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass, field
from typing import Any

from .contracts import (
    ARTIFACT_MAX_BYTES, ARTIFACT_MAX_COUNT, ARTIFACT_NAME_MAX_CHARS, MAX_ARTIFACT_OPS,
    MAX_CONTROL_OPS, MAX_MEMORY_OPS, MAX_READ_ARTIFACT_OPS, MEMORY_KEY_MAX_CHARS,
    MEMORY_MAX_KEYS, MEMORY_VALUE_MAX_CHARS, MODEL_PRIORITIES, PAUSE_MAX_SECONDS,
    PAUSE_MIN_SECONDS, PRIORITIES, Receipt,
)
from .protocol import ParsedResponse

KEY_RE = re.compile(r"^[A-Za-z0-9_.-]+$")
NAME_RE = re.compile(r"^[A-Za-z0-9_-][A-Za-z0-9_.-]*$")


def sha256_text(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def utf8_len(text: str) -> int:
    return len(text.encode("utf-8"))


@dataclass
class EffectState:
    memory: dict[str, str]
    artifact_sizes: dict[str, int]
    priority: str
    operator_priority: str
    operator_edited_at: float
    dispatched_at: float


@dataclass
class EffectPlan:
    memory_ops: list[dict] = field(default_factory=list)      # {"op","key","value"}
    artifact_ops: list[dict] = field(default_factory=list)    # {"op","name","content"}
    pause_seconds: int = 0
    rotate: bool = False
    priority: str = ""
    reads: list[dict] = field(default_factory=list)           # {"name","offset"}
    receipts: list[dict] = field(default_factory=list)

    @property
    def applied_count(self) -> int:
        return sum(1 for r in self.receipts
                   if r["status"] == Receipt.APPLIED and r["area"] in ("memory", "artifact"))


def _receipt(area: str, op: str, target: str, status: str, reason: str = "", **extra: Any) -> dict:
    r = {"area": area, "op": op, "target": target[:100], "status": status, "reason": reason}
    r.update(extra)
    return r


def _plan_memory(items: list[dict], state: EffectState, plan: EffectPlan) -> None:
    sim = dict(state.memory)
    for index, item in enumerate(items):
        op = str(item.get("op") or "").upper()
        key = item.get("key")
        target = key if isinstance(key, str) else ""
        if index >= MAX_MEMORY_OPS:
            plan.receipts.append(_receipt("memory", op or "?", target, Receipt.INVALID, "TOO_MANY_MEMORY_OPS"))
            continue
        if op not in ("SET", "DELETE"):
            plan.receipts.append(_receipt("memory", op or "?", target, Receipt.INVALID, "UNKNOWN_OPERATION"))
            continue
        if not isinstance(key, str) or not key or len(key) > MEMORY_KEY_MAX_CHARS or not KEY_RE.match(key):
            plan.receipts.append(_receipt("memory", op, target, Receipt.INVALID, "KEY_INVALID"))
            continue
        if op == "DELETE":
            if key not in sim:
                plan.receipts.append(_receipt("memory", op, key, Receipt.ALREADY_APPLIED, "NOT_PRESENT"))
                continue
            del sim[key]
            plan.memory_ops.append({"op": "DELETE", "key": key, "value": ""})
            plan.receipts.append(_receipt("memory", op, key, Receipt.APPLIED))
            continue
        value = item.get("value")
        if not isinstance(value, str):
            plan.receipts.append(_receipt("memory", op, key, Receipt.INVALID, "VALUE_NOT_STRING"))
            continue
        if len(value) > MEMORY_VALUE_MAX_CHARS:
            plan.receipts.append(_receipt("memory", op, key, Receipt.REJECTED, "VALUE_TOO_LONG",
                                          limit=MEMORY_VALUE_MAX_CHARS, length=len(value)))
            continue
        if not value.strip():
            plan.receipts.append(_receipt("memory", op, key, Receipt.INVALID, "VALUE_EMPTY_USE_DELETE"))
            continue
        if sim.get(key) == value:
            plan.receipts.append(_receipt("memory", op, key, Receipt.ALREADY_APPLIED, "VALUE_UNCHANGED"))
            continue
        if key not in sim and len(sim) >= MEMORY_MAX_KEYS:
            plan.receipts.append(_receipt("memory", op, key, Receipt.REJECTED, "MEMORY_FULL",
                                          limit=MEMORY_MAX_KEYS))
            continue
        sim[key] = value
        plan.memory_ops.append({"op": "SET", "key": key, "value": value})
        plan.receipts.append(_receipt("memory", op, key, Receipt.APPLIED))


def _plan_artifacts(items: list[dict], state: EffectState, plan: EffectPlan) -> None:
    sizes = dict(state.artifact_sizes)
    for index, item in enumerate(items):
        op = str(item.get("op") or "").upper()
        name = item.get("name")
        target = name if isinstance(name, str) else ""
        if index >= MAX_ARTIFACT_OPS:
            plan.receipts.append(_receipt("artifact", op or "?", target, Receipt.INVALID, "TOO_MANY_ARTIFACT_OPS"))
            continue
        if op not in ("WRITE", "APPEND"):
            plan.receipts.append(_receipt("artifact", op or "?", target, Receipt.INVALID, "UNKNOWN_OPERATION"))
            continue
        if (not isinstance(name, str) or not name or len(name) > ARTIFACT_NAME_MAX_CHARS
                or not NAME_RE.match(name)):
            plan.receipts.append(_receipt("artifact", op, target, Receipt.INVALID, "NAME_INVALID"))
            continue
        content = item.get("content")
        if not isinstance(content, str):
            plan.receipts.append(_receipt("artifact", op, name, Receipt.INVALID, "CONTENT_NOT_STRING"))
            continue
        if op == "APPEND" and not content:
            plan.receipts.append(_receipt("artifact", op, name, Receipt.ALREADY_APPLIED, "EMPTY_APPEND"))
            continue
        new_size = utf8_len(content) + (sizes.get(name, 0) if op == "APPEND" else 0)
        if new_size > ARTIFACT_MAX_BYTES:
            plan.receipts.append(_receipt("artifact", op, name, Receipt.REJECTED, "ARTIFACT_TOO_LARGE",
                                          limit=ARTIFACT_MAX_BYTES, size=new_size))
            continue
        if name not in sizes and len(sizes) >= ARTIFACT_MAX_COUNT:
            plan.receipts.append(_receipt("artifact", op, name, Receipt.REJECTED, "ARTIFACT_LIMIT",
                                          limit=ARTIFACT_MAX_COUNT))
            continue
        sizes[name] = new_size
        plan.artifact_ops.append({"op": op, "name": name, "content": content})
        # size/sha256 are filled in from the stored content when the op is applied.
        plan.receipts.append(_receipt("artifact", op, name, Receipt.APPLIED))


def _plan_control(items: list[dict], state: EffectState, plan: EffectPlan,
                  artifact_names_after: set[str]) -> None:
    seen: dict[str, int] = {}
    for index, item in enumerate(items):
        op = str(item.get("op") or "").upper()
        if index >= MAX_CONTROL_OPS:
            plan.receipts.append(_receipt("control", op or "?", "", Receipt.INVALID, "TOO_MANY_CONTROL_OPS"))
            continue
        seen[op] = seen.get(op, 0) + 1
        limit = MAX_READ_ARTIFACT_OPS if op == "READ_ARTIFACT" else 1
        if seen[op] > limit:
            plan.receipts.append(_receipt("control", op, "", Receipt.INVALID, "DUPLICATE_OPERATION"))
            continue
        if op == "PAUSE":
            seconds = item.get("seconds")
            if isinstance(seconds, bool) or not isinstance(seconds, int):
                plan.receipts.append(_receipt("control", op, "", Receipt.INVALID, "SECONDS_NOT_INTEGER"))
            elif not PAUSE_MIN_SECONDS <= seconds <= PAUSE_MAX_SECONDS:
                plan.receipts.append(_receipt("control", op, "", Receipt.INVALID, "SECONDS_OUT_OF_RANGE",
                                              min=PAUSE_MIN_SECONDS, max=PAUSE_MAX_SECONDS))
            else:
                plan.pause_seconds = seconds
                plan.receipts.append(_receipt("control", op, str(seconds), Receipt.APPLIED))
        elif op == "ROTATE_SESSION":
            plan.rotate = True
            plan.receipts.append(_receipt("control", op, "", Receipt.APPLIED, "NEXT_TURN_STARTS_NEW_SESSION"))
        elif op == "READ_ARTIFACT":
            name = item.get("name")
            offset = item.get("offset", 0)
            if not isinstance(name, str) or name not in artifact_names_after:
                plan.receipts.append(_receipt("control", op, name if isinstance(name, str) else "",
                                              Receipt.REJECTED, "ARTIFACT_NOT_FOUND"))
            elif isinstance(offset, bool) or not isinstance(offset, int) or offset < 0:
                plan.receipts.append(_receipt("control", op, name, Receipt.INVALID, "OFFSET_INVALID"))
            else:
                plan.reads.append({"name": name, "offset": offset})
                plan.receipts.append(_receipt("control", op, name, Receipt.APPLIED, "CONTENT_IN_NEXT_MESSAGE"))
        elif op == "SET_PRIORITY":
            prio = str(item.get("priority") or "").upper()
            if prio not in MODEL_PRIORITIES:
                plan.receipts.append(_receipt("control", op, prio, Receipt.INVALID, "PRIORITY_NOT_ALLOWED"))
            elif state.operator_edited_at and state.operator_edited_at >= state.dispatched_at:
                plan.receipts.append(_receipt("control", op, prio, Receipt.REJECTED, "OPERATOR_PRECEDENCE"))
            elif PRIORITIES[prio] > PRIORITIES.get(state.operator_priority, PRIORITIES["NORMAL"]):
                plan.receipts.append(_receipt("control", op, prio, Receipt.REJECTED,
                                              "ABOVE_OPERATOR_PRIORITY", ceiling=state.operator_priority))
            elif prio == state.priority:
                plan.receipts.append(_receipt("control", op, prio, Receipt.ALREADY_APPLIED, "VALUE_UNCHANGED"))
            else:
                plan.priority = prio
                plan.receipts.append(_receipt("control", op, prio, Receipt.APPLIED))
        else:
            plan.receipts.append(_receipt("control", op or "?", "", Receipt.INVALID, "UNKNOWN_OPERATION"))


def plan_effects(parsed: ParsedResponse, state: EffectState) -> EffectPlan:
    plan = EffectPlan()
    if not parsed.ok:
        return plan
    _plan_memory(parsed.memory, state, plan)
    _plan_artifacts(parsed.artifacts, state, plan)
    names_after = set(state.artifact_sizes) | {op["name"] for op in plan.artifact_ops}
    _plan_control(parsed.control, state, plan, names_after)
    return plan


def receipt_line(r: dict) -> str:
    """Human/model readable receipt for the next control message."""
    area = {"memory": "memory", "artifact": "artifact", "control": "control"}.get(r.get("area"), "?")
    head = f"{area} {r.get('op')}"
    if r.get("target"):
        head += f" {r['target']}"
    tail = r.get("status", "")
    if r.get("reason"):
        tail += f" ({r['reason']})"
    if r.get("area") == "artifact" and r.get("status") == Receipt.APPLIED and "size" in r:
        tail += f"; now {r['size']} bytes, sha256 {str(r.get('sha256', ''))[:12]}"
    for k in ("limit", "length", "ceiling", "min", "max"):
        if k in r and r.get("status") != Receipt.APPLIED:
            tail += f"; {k}={r[k]}"
    return f"{head}: {tail}"
