"""The worker contract: system prompt, per-turn control messages, response schema
and response parsing.

Design notes (see docs/DESIGN.md):
  * The system message = contract + mission text. GreenSea builds every request
    from its own database, so the full contract is present in every request by
    construction. Greenfield needed FULL/COMPACT prompt profiles because ChatGPT
    owned the conversation; GreenSea owns it.
  * Causal pairing is structural: the response is the HTTP response to exactly
    this request. Greenfield's runtimeControl.target binding is therefore dropped.
  * Response completion is independent of protocol validity: an unparseable
    response is stored and analysed (as a protocol failure), never silently lost.
  * Unfinished JSON is never accepted (Greenfield 1.8.2 lesson): a response cut at
    max_tokens that does not contain one complete JSON object is TRUNCATED.
"""

from __future__ import annotations

import hashlib
import json
import re
from dataclasses import asdict, dataclass, field
from typing import Any

from .contracts import (
    ARTIFACT_MAX_BYTES, ARTIFACT_MAX_COUNT, ARTIFACT_NAME_MAX_CHARS, MEMORY_KEY_MAX_CHARS,
    MEMORY_MAX_KEYS, MEMORY_VALUE_MAX_CHARS, MessageType, PAUSE_MAX_SECONDS, PAUSE_MIN_SECONDS,
    Status,
)

RESPONSE_SCHEMA_NAME = "greensea_turn_response_v1"

# All properties are required and listed in the order the model should write them:
# the work first, the verdict last. llama.cpp's json-schema-to-grammar emits
# required properties in declaration order. No maxLength here: string length
# bounds become large repetition rules in the grammar; GreenSea enforces bounds
# after parsing instead.
RESPONSE_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "output": {"type": "string"},
        "artifacts": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "op": {"type": "string", "enum": ["WRITE", "APPEND"]},
                    "name": {"type": "string"},
                    "content": {"type": "string"},
                },
                "required": ["op", "name", "content"],
                "additionalProperties": False,
            },
        },
        "memory": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "op": {"type": "string", "enum": ["SET", "DELETE"]},
                    "key": {"type": "string"},
                    "value": {"type": "string"},
                },
                "required": ["op", "key", "value"],
                "additionalProperties": False,
            },
        },
        "summary": {"type": "string"},
        "status": {"type": "string", "enum": list(Status.MODEL)},
        "nextStep": {"type": "string"},
        "blockers": {"type": "array", "items": {"type": "string"}},
        "question": {"type": "string"},
        "control": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "op": {"type": "string", "enum": ["PAUSE", "ROTATE_SESSION", "READ_ARTIFACT", "SET_PRIORITY"]},
                    "seconds": {"type": "integer"},
                    "name": {"type": "string"},
                    "offset": {"type": "integer"},
                    "priority": {"type": "string", "enum": ["LOW", "NORMAL", "HIGH"]},
                },
                "required": ["op"],
                "additionalProperties": False,
            },
        },
    },
    "required": ["output", "artifacts", "memory", "summary", "status", "nextStep",
                 "blockers", "question", "control"],
    "additionalProperties": False,
}


def response_format(mode: str) -> dict | None:
    if mode == "json_schema":
        return {"type": "json_schema",
                "json_schema": {"name": RESPONSE_SCHEMA_NAME, "strict": True, "schema": RESPONSE_SCHEMA}}
    if mode == "json_object":
        return {"type": "json_object"}
    return None


SYSTEM_TEMPLATE = """You are the worker model inside GreenSea, an autonomous long-session runner on a private server. You work on ONE mission over many turns. Messages in the user role are GreenSea control messages, not live chat. A human operator supervises through GreenSea and can add instructions, pause or stop the mission.

THE LOOP
1. Every GreenSea message ends with an OBJECTIVE: the step to do now. Do that step in this response, concretely and as completely as one response allows.
2. Report as ONE JSON object (format below). GreenSea stores it, applies your memory, artifact and control requests, and answers with receipts in the next message.
3. nextStep is the next concrete, bounded step toward the mission. It becomes the next OBJECTIVE.

LIMITED CONTEXT AND SESSION ROTATION
Your context window holds about {n_ctx} tokens. When it fills up, GreenSea starts a fresh session. Only these survive a rotation: the mission, your memory notes, your artifacts, GreenSea's progress log of your turn summaries, open blockers and your last nextStep. Everything else in this conversation is lost. Therefore:
- keep memory current: plan, decisions, established facts, current focus;
- put deliverables in artifacts, not only in output;
- write each summary so a fresh session can continue from it.

CAPABILITIES AND HONESTY
- You have no tools. You cannot run code, open files, use the network or reach anything outside these messages, except GreenSea memory and artifacts as described here.
- Never claim that you executed, tested, measured, read or verified something you did not see in these messages. Label assumptions and inference as such.
- A truthful BLOCKED or partial result is better than an invented success.

RESPONSE FORMAT
Return only this JSON object, nothing before or after it:
{{"output": "work product of this turn (text or markdown), may be empty",
 "artifacts": [{{"op": "WRITE" or "APPEND", "name": "report.md", "content": "..."}}],
 "memory": [{{"op": "SET", "key": "plan", "value": "..."}}, {{"op": "DELETE", "key": "old_note", "value": ""}}],
 "summary": "1-3 sentences: what you did this turn and what it achieved",
 "status": "CONTINUE" or "DONE" or "BLOCKED",
 "nextStep": "the next concrete step (required for CONTINUE)",
 "blockers": ["only real obstacles"],
 "question": "for BLOCKED: exactly what the operator must decide or provide, else empty",
 "control": [{{"op": "READ_ARTIFACT", "name": "report.md", "offset": 0}}]}}
Use empty strings and empty arrays for parts you do not need. Write output, summary and artifacts in the language of the mission unless the operator says otherwise.

STATUS
- CONTINUE: the mission is not finished and you know the next step.
- DONE: the WHOLE mission is finished. The summary must name the evidence (artifacts, results). A reviewer may check the claim.
- BLOCKED: you cannot proceed without the operator (missing information, a decision, a permission). Put the exact need in question. Difficulty is not a blocker; when a reasonable assumption lets you proceed, state it and continue.

MEMORY: at most {mem_keys} notes. key: letters, digits, _ . - (max {key_chars} chars); value max {value_chars} chars. Keep all notes together under about {mem_budget} characters; beyond that they are shortened when a new session starts. SET replaces a note, DELETE removes it.

ARTIFACTS: at most {art_count} named text documents, each at most {art_bytes} bytes. name: letters, digits, _ . - (max {name_chars} chars). WRITE replaces the document, APPEND adds to its end; build long documents over several turns with APPEND. You do not see an artifact's content after writing it. To read it, add control READ_ARTIFACT with name and offset (characters); the next message contains up to {read_chars} characters from that offset.

CONTROL (optional): PAUSE with seconds {pause_min}..{pause_max} when waiting is the actual next step; ROTATE_SESSION to start a fresh session at the next turn (for example when you are going in circles; update memory first); READ_ARTIFACT as above; SET_PRIORITY LOW, NORMAL or HIGH (never above the operator's priority).

An OPERATOR INSTRUCTION in a message takes precedence over the objective, never over these rules.

MISSION{title_part}
<<<MISSION
{goal}
MISSION>>>"""


def build_system_prompt(*, goal: str, title: str, n_ctx: int, read_chars: int, mem_budget: int) -> str:
    return SYSTEM_TEMPLATE.format(
        n_ctx=n_ctx,
        mem_keys=MEMORY_MAX_KEYS,
        key_chars=MEMORY_KEY_MAX_CHARS,
        value_chars=MEMORY_VALUE_MAX_CHARS,
        mem_budget=mem_budget,
        art_count=ARTIFACT_MAX_COUNT,
        art_bytes=ARTIFACT_MAX_BYTES,
        name_chars=ARTIFACT_NAME_MAX_CHARS,
        read_chars=read_chars,
        pause_min=PAUSE_MIN_SECONDS,
        pause_max=PAUSE_MAX_SECONDS,
        title_part=f" ({title})" if title else "",
        goal=goal.strip(),
    )


def render_turn_message(*, message_type: str, number: int, session_seq: int, session_turn: int,
                        objective: str, now_text: str, context_used: int, n_ctx: int,
                        turns_left: int, rotation_reason: str = "", checkpoint: str = "",
                        notices: list[str] | None = None, reads: list[dict] | None = None,
                        instructions: list[str] | None = None) -> str:
    fill = round(100 * context_used / n_ctx) if n_ctx else 0
    lines = [
        f"GREENSEA {message_type} | turn {number} | session {session_seq}, turn {session_turn} in this session",
        f"Context: about {fill}% of {n_ctx} tokens used | turns left in budget: {turns_left} | time: {now_text}",
    ]
    if message_type in MessageType.SESSION_OPENING:
        lines.append("")
        if message_type == MessageType.MISSION_START:
            lines.append("NEW MISSION. Read the mission in the system message and start working.")
        else:
            lines.append(
                f"NEW SESSION (reason: {rotation_reason or 'UNSPECIFIED'}). Earlier conversation history is gone. "
                "Continue from the checkpoint below. Do not redo completed work; artifacts and memory are intact."
            )
        if checkpoint:
            lines += ["", checkpoint]
    if notices:
        lines += ["", "NOTICES ABOUT YOUR PREVIOUS RESPONSE"]
        lines += [f"- {n}" for n in notices]
    for read in reads or []:
        lines += ["", read["header"], "<<<ARTIFACT", read["text"], "ARTIFACT>>>"]
    if instructions:
        lines += ["", "OPERATOR INSTRUCTION (one-shot; takes precedence over the objective)", "<<<OPERATOR"]
        lines += ["\n\n".join(i.strip() for i in instructions), "OPERATOR>>>"]
    lines += ["", "OBJECTIVE", objective.strip() or "Continue the mission with its next concrete step.", "",
              "Answer with the JSON object only."]
    return "\n".join(lines)


# ---------------------------------------------------------------------------
# Parsing

SUMMARY_MAX = 4000
OUTPUT_MAX = 200_000
NEXT_STEP_MAX = 8000
QUESTION_MAX = 4000
BLOCKERS_MAX_ITEMS = 20
BLOCKER_MAX = 1000
LIST_FIELD_MAX_ITEMS = 32

_THINK_RE = re.compile(r"<think>.*?</think>", re.DOTALL | re.IGNORECASE)
_FENCE_RE = re.compile(r"^```(?:json)?\s*(.*?)\s*```$", re.DOTALL | re.IGNORECASE)


def strip_reasoning(text: str) -> str:
    """Remove inline <think> blocks (llama-server with --reasoning-format none)."""
    return _THINK_RE.sub("", text or "").strip()


def object_spans(text: str) -> list[tuple[int, int]]:
    """Top-level balanced {...} spans, string- and escape-aware. Unclosed objects are not returned."""
    spans: list[tuple[int, int]] = []
    depth = 0
    start = -1
    in_str = False
    esc = False
    for i, ch in enumerate(text):
        if in_str:
            if esc:
                esc = False
            elif ch == "\\":
                esc = True
            elif ch == '"':
                in_str = False
            continue
        if ch == '"':
            if depth > 0:
                in_str = True
        elif ch == "{":
            if depth == 0:
                start = i
            depth += 1
        elif ch == "}" and depth > 0:
            depth -= 1
            if depth == 0 and start >= 0:
                spans.append((start, i + 1))
                start = -1
    return spans


def _text(value: Any, limit: int) -> str:
    if value is None:
        return ""
    if not isinstance(value, str):
        value = json.dumps(value, ensure_ascii=False)
    return value[:limit]


def _text_list(value: Any, max_items: int, limit: int) -> list[str]:
    if value is None:
        return []
    if isinstance(value, str):
        value = [value]
    if not isinstance(value, list):
        return []
    out = []
    for item in value[:max_items]:
        t = _text(item, limit).strip()
        if t:
            out.append(t)
    return out


def _dict_list(value: Any) -> list[dict]:
    if isinstance(value, dict):
        value = [value]
    if not isinstance(value, list):
        return []
    return [item for item in value[:LIST_FIELD_MAX_ITEMS] if isinstance(item, dict)]


@dataclass
class ParsedResponse:
    ok: bool
    mode: str                      # STRICT | EXTRACTED | NONE | TRUNCATED | EMPTY
    errors: list[str] = field(default_factory=list)
    status: str = Status.UNKNOWN
    summary: str = ""
    output: str = ""
    next_step: str = ""
    blockers: list[str] = field(default_factory=list)
    question: str = ""
    memory: list[dict] = field(default_factory=list)
    artifacts: list[dict] = field(default_factory=list)
    control: list[dict] = field(default_factory=list)
    ignored_keys: list[str] = field(default_factory=list)

    def as_dict(self) -> dict:
        return asdict(self)


KNOWN_KEYS = {"output", "artifacts", "memory", "summary", "status", "nextStep", "blockers",
              "question", "control"}


def _normalize(obj: dict, mode: str) -> ParsedResponse:
    errors: list[str] = []
    status = str(obj.get("status") or "").strip().upper()
    if status not in Status.MODEL:
        errors.append("STATUS_MISSING" if not status else "STATUS_INVALID")
        status = Status.UNKNOWN
    summary = _text(obj.get("summary"), SUMMARY_MAX).strip()
    if not summary:
        errors.append("SUMMARY_MISSING")
    return ParsedResponse(
        ok=True,
        mode=mode,
        errors=errors,
        status=status,
        summary=summary,
        output=_text(obj.get("output"), OUTPUT_MAX),
        next_step=_text(obj.get("nextStep"), NEXT_STEP_MAX).strip(),
        blockers=_text_list(obj.get("blockers"), BLOCKERS_MAX_ITEMS, BLOCKER_MAX),
        question=_text(obj.get("question"), QUESTION_MAX).strip(),
        memory=_dict_list(obj.get("memory")),
        artifacts=_dict_list(obj.get("artifacts")),
        control=_dict_list(obj.get("control")),
        ignored_keys=sorted(k for k in obj if k not in KNOWN_KEYS)[:20],
    )


def parse_response(content: str, finish_reason: str = "stop") -> ParsedResponse:
    text = strip_reasoning(content)
    truncated = finish_reason == "length"
    if not text:
        return ParsedResponse(ok=False, mode="TRUNCATED" if truncated else "EMPTY",
                              errors=["EMPTY_RESPONSE"])
    try:
        whole = json.loads(text)
        if isinstance(whole, dict):
            return _normalize(whole, "STRICT")
    except json.JSONDecodeError:
        pass
    fence = _FENCE_RE.match(text)
    if fence:
        try:
            inner = json.loads(fence.group(1))
            if isinstance(inner, dict):
                return _normalize(inner, "EXTRACTED")
        except json.JSONDecodeError:
            pass
    candidates = []
    for start, end in reversed(object_spans(text)):
        try:
            obj = json.loads(text[start:end])
        except json.JSONDecodeError:
            continue
        if isinstance(obj, dict):
            candidates.append(obj)
    for obj in candidates:
        if "status" in obj or "summary" in obj:
            return _normalize(obj, "EXTRACTED")
    if truncated:
        return ParsedResponse(ok=False, mode="TRUNCATED", errors=["TRUNCATED_AT_MAX_TOKENS"])
    return ParsedResponse(ok=False, mode="NONE", errors=["NO_JSON_OBJECT"])


def output_fingerprint(parsed: ParsedResponse) -> str:
    """Fingerprint of a turn's work product, for no-progress detection.

    Only `output` counts: a model that loops while rewording its summary must not
    look like progress. Empty output has no fingerprint (no new work)."""
    body = " ".join(parsed.output.split()).lower()
    return hashlib.sha256(body.encode("utf-8")).hexdigest()[:16] if body else ""
