"""Deterministic controller: what happens after a response.

Adapted from Greenfield's control projection (greenfield-control.mjs) and
continuation guard (continuation-guard.mjs):
  * protocol validity is not a continuation requirement; a protocol failure is
    repaired, then escalated (rotation at 3, operator at 6 consecutive failures);
  * DONE/BLOCKED are claims; with a reviewer enabled they are checked before they
    take effect, and disputes are bounded (max_rejections) and end with the operator;
  * repetition without progress is a liveness problem, not a blocker: it is
    replanned with a fingerprinted alternative step, escalated to a fresh session,
    and only then to the operator;
  * progress is measured by applied effects (memory/artifacts) or new output,
    so an iterative step ("append the next section") is not mistaken for a loop.

Precedence: operator stop > DONE / operator decision > turn budget >
operator pause > model pause > continue.
"""

from __future__ import annotations

import hashlib
from dataclasses import asdict, dataclass, field

from .contracts import RotationReason, Status
from .effects import EffectPlan
from .protocol import ParsedResponse, output_fingerprint

PROTOCOL_ROTATE_EVERY = 3
PROTOCOL_OPERATOR_AT = 6
REPLAN_ROTATE_EVERY = 3
REPLAN_OPERATOR_AT = 6
RECENT_OBJECTIVES = 3


class Action:
    CONTINUE = "CONTINUE"
    PAUSE = "PAUSE"
    DONE = "DONE"
    NEEDS_OPERATOR = "NEEDS_OPERATOR"


class Review:
    NONE = ""
    DONE_CLAIM = "DONE_CLAIM"
    BLOCKED_CLAIM = "BLOCKED_CLAIM"
    PROGRESS = "PROGRESS"


@dataclass
class MissionView:
    objective: str
    recent_objectives: list[str]
    turn_count: int                 # completed turns including the one being analysed
    max_turns: int
    session_turn: int               # index of the analysed turn inside its session
    max_session_turns: int          # 0 = unlimited
    counters: dict
    previous_output_fp: str = ""
    pause_requested: bool = False
    rotate_requested: str = ""      # OPERATOR | MISSION_UPDATED | ""
    reviewer_mode: str = "off"
    max_rejections: int = 2


@dataclass
class Decision:
    action: str
    reason: str
    next_objective: str = ""
    rotate: str = ""
    pause_seconds: int = 0
    pause_by: str = ""
    question: str = ""
    review: str = Review.NONE
    review_verdict: dict | None = None
    replanned: bool = False
    notices: list[str] = field(default_factory=list)
    counters: dict = field(default_factory=dict)
    output_fp: str = ""

    def as_dict(self) -> dict:
        return asdict(self)


def norm(text: str) -> str:
    return " ".join((text or "").split()).lower()


def fingerprint(text: str) -> str:
    return hashlib.sha256(norm(text).encode("utf-8")).hexdigest()[:8]


def alternative_step(objective: str) -> str:
    return (
        f"[GreenSea replan {fingerprint(objective)}] The previous step repeated without material progress. "
        "Choose exactly one materially different, concrete next step toward the mission: "
        "(1) the next unmet requirement or acceptance criterion, (2) a step that settles an open question, "
        "or (3) an unfinished part of the deliverable. Do not repeat earlier steps. "
        "If the mission is complete, return DONE with evidence; if you truly cannot proceed, "
        "return BLOCKED with a precise question."
    )


PROTOCOL_NOTICES = {
    "TRUNCATED": ("Your previous response was cut off at the token limit before the JSON object was complete. "
                  "Nothing in it was applied. Write less per turn: put long content into artifacts with APPEND "
                  "over several turns."),
    "EMPTY": "Your previous response was empty. Nothing was applied.",
    "NONE": ("Your previous response did not contain the required JSON object. Its text remains in this "
             "conversation, but no memory, artifact or control request in it was applied."),
}


def decide(parsed: ParsedResponse, plan: EffectPlan, view: MissionView) -> Decision:
    counters = dict(view.counters)
    notices: list[str] = []

    if not parsed.ok:
        failures = int(counters.get("protocol_failures", 0)) + 1
        counters["protocol_failures"] = failures
        notices.append(PROTOCOL_NOTICES.get(parsed.mode, PROTOCOL_NOTICES["NONE"]))
        if failures >= PROTOCOL_OPERATOR_AT:
            return Decision(
                action=Action.NEEDS_OPERATOR, reason="PROTOCOL_FAILURES",
                question=(f"The model failed to return a valid response {failures} times in a row "
                          f"(last: {parsed.mode}). Check the model, max_tokens or structured output mode."),
                notices=notices, counters=counters,
            )
        rotate = (RotationReason.PROTOCOL_FAILURES
                  if failures % PROTOCOL_ROTATE_EVERY == 0 and view.session_turn > 1 else "")
        return finalize(Decision(action=Action.CONTINUE, reason="PROTOCOL_REPAIR",
                                 next_objective=view.objective, rotate=rotate,
                                 notices=notices, counters=counters), view)

    counters["protocol_failures"] = 0
    if parsed.errors:
        notices.append("Response format issues: " + ", ".join(parsed.errors) + ".")

    if parsed.status == Status.DONE:
        return Decision(action=Action.DONE, reason="MODEL_DONE",
                        review=Review.DONE_CLAIM if view.reviewer_mode != "off" else Review.NONE,
                        notices=notices, counters=counters, output_fp=output_fingerprint(parsed))

    if parsed.status == Status.BLOCKED:
        question = parsed.question or "; ".join(parsed.blockers) or parsed.summary
        return Decision(action=Action.NEEDS_OPERATOR, reason="MODEL_BLOCKED", question=question,
                        next_objective=parsed.next_step,
                        review=Review.BLOCKED_CLAIM if view.reviewer_mode != "off" else Review.NONE,
                        notices=notices, counters=counters, output_fp=output_fingerprint(parsed))

    if parsed.status == Status.UNKNOWN:
        notices.append("status was missing or invalid; GreenSea treated the response as CONTINUE.")

    out_fp = output_fingerprint(parsed)
    progress = plan.applied_count > 0 or (bool(out_fp) and out_fp != view.previous_output_fp)
    candidate = parsed.next_step.strip()
    recent = {norm(o) for o in view.recent_objectives[-RECENT_OBJECTIVES:] if o}
    repeated = bool(candidate) and (norm(candidate) == norm(view.objective) or norm(candidate) in recent)

    decision = Decision(action=Action.CONTINUE, reason="MODEL_CONTINUE", next_objective=candidate,
                        notices=notices, counters=counters, output_fp=out_fp)

    if not candidate or (repeated and not progress):
        replans = int(counters.get("replans", 0)) + 1
        counters["replans"] = replans
        decision.replanned = True
        decision.reason = "REPLAN_EMPTY_NEXT_STEP" if not candidate else "REPLAN_REPETITION"
        decision.next_objective = alternative_step(view.objective)
        decision.notices.append(
            "nextStep was empty; GreenSea chose a replanning objective." if not candidate else
            "nextStep repeated an earlier objective without any applied effect or new output; "
            "GreenSea chose a replanning objective."
        )
        if replans >= REPLAN_OPERATOR_AT:
            return Decision(action=Action.NEEDS_OPERATOR, reason="REPETITION",
                            question=(f"The mission repeated itself {replans} times without progress, "
                                      "also across a fresh session. Give the next step or adjust the mission."),
                            notices=decision.notices, counters=counters, output_fp=out_fp)
        if replans % REPLAN_ROTATE_EVERY == 0:
            decision.rotate = RotationReason.REPETITION
    else:
        counters["replans"] = 0

    if plan.pause_seconds:
        decision.action = Action.PAUSE
        decision.pause_seconds = plan.pause_seconds
        decision.pause_by = "MODEL"
    if plan.rotate and not decision.rotate:
        decision.rotate = RotationReason.MODEL_REQUEST
    if view.reviewer_mode == "every_turn":
        decision.review = Review.PROGRESS
    return finalize(decision, view)


def apply_review(decision: Decision, verdict: dict | None, view: MissionView) -> Decision:
    """Combine a reviewer verdict ({"verdict","reason","nextStep"} or None) with a claim."""
    d = Decision(**{**decision.as_dict(), "notices": list(decision.notices),
                    "counters": dict(decision.counters)})
    d.review_verdict = verdict
    kind = decision.review
    if verdict is None:
        d.notices.append("The reviewer was unavailable; the claim was taken as stated.")
        return finalize(d, view)
    accepted = verdict.get("verdict") == "ACCEPT"
    reason = str(verdict.get("reason") or "")[:1000]
    next_step = str(verdict.get("nextStep") or "").strip()

    if kind == Review.DONE_CLAIM:
        if accepted:
            d.counters["done_rejections"] = 0
            return d
        rejections = int(d.counters.get("done_rejections", 0)) + 1
        d.counters["done_rejections"] = rejections
        if rejections >= view.max_rejections:
            d.action = Action.NEEDS_OPERATOR
            d.reason = "DONE_DISPUTED"
            d.question = (f"The model reports the mission as DONE; the reviewer disagrees ({rejections} times): "
                          f"{reason} Decide: reopen with an instruction, or stop the mission.")
            return d
        d.action = Action.CONTINUE
        d.reason = "REVIEW_REJECTED_DONE"
        d.next_objective = next_step or alternative_step(view.objective)
        d.notices.append(f"Your DONE claim was not accepted by the reviewer: {reason}")
        return finalize(d, view)

    if kind == Review.BLOCKED_CLAIM:
        if accepted or not next_step:
            d.counters["blocked_rejections"] = 0
            return d
        rejections = int(d.counters.get("blocked_rejections", 0)) + 1
        d.counters["blocked_rejections"] = rejections
        if rejections >= view.max_rejections:
            return d  # stays NEEDS_OPERATOR with the model's question
        d.action = Action.CONTINUE
        d.reason = "REVIEW_REJECTED_BLOCKED"
        d.question = ""
        d.next_objective = next_step
        d.notices.append(f"The reviewer judged that this does not need the operator: {reason}")
        return finalize(d, view)

    if kind == Review.PROGRESS and not accepted and next_step:
        d.reason = "REVIEW_REDIRECTED"
        d.next_objective = next_step
        d.notices.append(f"The reviewer redirected the next step: {reason}")
    return d


def finalize(d: Decision, view: MissionView) -> Decision:
    if d.action not in (Action.CONTINUE, Action.PAUSE):
        return d
    if view.max_turns and view.turn_count >= view.max_turns:
        d.action = Action.NEEDS_OPERATOR
        d.reason = "TURN_BUDGET_EXHAUSTED"
        d.question = (f"The turn budget ({view.max_turns}) is used up. Raise max turns to continue, "
                      "or stop the mission.")
        return d
    if view.pause_requested:
        d.action = Action.PAUSE
        d.pause_by = "OPERATOR"
        d.pause_seconds = 0
    if not d.rotate and view.rotate_requested:
        d.rotate = view.rotate_requested
    if (not d.rotate and view.max_session_turns
            and view.session_turn >= view.max_session_turns):
        d.rotate = RotationReason.SESSION_TURN_LIMIT
    return d
