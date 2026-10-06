"""Reviewer: a second, bounded opinion on a claim (Greenfield's Hjalmar D2, adapted).

The reviewer runs on the same llama-server, with a small prompt that contains
only bounded evidence, and returns a closed verdict. It is advisory: the
controller (control.apply_review) decides what the verdict changes, and every
dispute is bounded. Greenfield 1.8.14 showed that analysis should run only where
it can change the outcome; mode "terminal" therefore reviews only DONE and
BLOCKED claims.
"""

from __future__ import annotations

import json

from .control import Review
from .protocol import ParsedResponse, object_spans, strip_reasoning

REVIEW_SCHEMA = {
    "type": "object",
    "properties": {
        "reason": {"type": "string"},
        "verdict": {"type": "string", "enum": ["ACCEPT", "REJECT"]},
        "nextStep": {"type": "string"},
    },
    "required": ["reason", "verdict", "nextStep"],
    "additionalProperties": False,
}

SYSTEM = """You are the reviewer in GreenSea, an autonomous long-session runner. A worker model works on a mission over many turns. You judge ONE claim from its latest turn, using only the evidence below. You cannot see anything else, and the worker has no tools: it cannot have run code or read files.
Be strict and concrete. Answer with one JSON object: {"reason": "...", "verdict": "ACCEPT" or "REJECT", "nextStep": "..."}. nextStep: when you REJECT, the single most useful concrete next step for the worker; otherwise an empty string."""

TASKS = {
    Review.DONE_CLAIM: ("CLAIM: the worker says the WHOLE mission is DONE.\n"
                        "ACCEPT only if the evidence shows that every deliverable and requirement of the mission "
                        "is satisfied. REJECT if anything required is missing, unverified by the evidence, or only "
                        "promised."),
    Review.BLOCKED_CLAIM: ("CLAIM: the worker says it cannot continue without the human operator.\n"
                           "ACCEPT if the question truly needs information, a decision or a permission that only the "
                           "operator can give. REJECT if the worker can make progress on its own (difficulty, or "
                           "uncertainty that a stated reasonable assumption resolves, is not a blocker)."),
    Review.PROGRESS: ("CLAIM: the worker says it made progress and proposes nextStep.\n"
                      "ACCEPT if the turn moved the mission forward and nextStep is a sensible next step. REJECT if "
                      "the worker is looping, drifting from the mission, or claims things it cannot have done."),
}


def _clip(text: str, limit: int) -> str:
    text = text or ""
    return text if len(text) <= limit else text[:limit] + f" ...[{len(text) - limit} more chars]"


def build_review_messages(*, kind: str, goal: str, parsed: ParsedResponse, objective: str,
                          memory: dict[str, str], artifacts: dict[str, dict],
                          progress: list[tuple[int, str]]) -> list[dict]:
    mem_lines = [f"- {k}: {_clip(v, 300)}" for k, v in list(memory.items())[:30]]
    art_lines = [f"- {n} ({a.get('size', 0)} bytes)" for n, a in list(artifacts.items())[:40]]
    log_lines = [f"#{n}: {_clip(s, 240)}" for n, s in progress[-10:]]
    user = "\n".join([
        TASKS[kind],
        "",
        "MISSION",
        _clip(goal, 4000),
        "",
        f"OBJECTIVE OF THE TURN: {_clip(objective, 600)}",
        f"WORKER STATUS: {parsed.status}",
        f"WORKER SUMMARY: {_clip(parsed.summary, 1500)}",
        f"WORKER NEXT STEP: {_clip(parsed.next_step, 600) or '(none)'}",
        f"WORKER QUESTION: {_clip(parsed.question, 800) or '(none)'}",
        f"WORKER BLOCKERS: {json.dumps(parsed.blockers[:5], ensure_ascii=False)}",
        "",
        "WORKER OUTPUT (excerpt)",
        _clip(parsed.output, 3000) or "(empty)",
        "",
        "ARTIFACTS",
        "\n".join(art_lines) or "(none)",
        "",
        "MEMORY NOTES",
        "\n".join(mem_lines) or "(none)",
        "",
        "PROGRESS LOG (latest last)",
        "\n".join(log_lines) or "(none)",
    ])
    return [{"role": "system", "content": SYSTEM}, {"role": "user", "content": user}]


def parse_verdict(content: str) -> dict | None:
    """Closed verdict or None (unavailable). Unclosed JSON is never accepted."""
    text = strip_reasoning(content)
    candidates: list = []
    try:
        candidates.append(json.loads(text))
    except json.JSONDecodeError:
        for start, end in reversed(object_spans(text)):
            try:
                candidates.append(json.loads(text[start:end]))
            except json.JSONDecodeError:
                continue
    for obj in candidates:
        if not isinstance(obj, dict):
            continue
        verdict = str(obj.get("verdict") or "").strip().upper()
        if verdict in ("ACCEPT", "REJECT"):
            return {"verdict": verdict, "reason": str(obj.get("reason") or "")[:2000],
                    "nextStep": str(obj.get("nextStep") or "")[:4000]}
    return None
