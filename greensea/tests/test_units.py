"""Unit tests of the pure decision modules."""

from __future__ import annotations

import asyncio
import json

import pytest

from greensea.config import SettingsError, load_config, validate_runtime_patch
from greensea.context import (CheckpointInput, ContextVerdict, TokenEstimator, build_checkpoint,
                              check_context, checkpoint_budget_tokens)
from greensea.contracts import IllegalTransition, Phase, check_transition
from greensea.control import Action, MissionView, Review, apply_review, decide
from greensea.effects import EffectState, plan_effects
from greensea.protocol import RESPONSE_SCHEMA, parse_response, render_turn_message, response_format
from greensea.reviewer import parse_verdict
from greensea.scheduler import CapacityScheduler


def obj(**kw):
    base = {"output": "", "artifacts": [], "memory": [], "summary": "s", "status": "CONTINUE",
            "nextStep": "n", "blockers": [], "question": "", "control": []}
    base.update(kw)
    return json.dumps(base)


# ---------------------------------------------------------------- protocol

def test_schema_orders_work_before_verdict_and_has_no_length_bounds():
    assert RESPONSE_SCHEMA["required"][:5] == ["output", "artifacts", "memory", "summary", "status"]
    assert "maxLength" not in json.dumps(RESPONSE_SCHEMA)
    assert response_format("json_schema")["json_schema"]["schema"] is RESPONSE_SCHEMA
    assert response_format("off") is None


@pytest.mark.parametrize("content,mode", [
    (obj(), "STRICT"),
    ("```json\n" + obj() + "\n```", "EXTRACTED"),
    ("Here you go:\n" + obj() + "\nThanks!", "EXTRACTED"),
    ("<think>plan { not json</think>" + obj(), "STRICT"),
])
def test_parse_accepts_complete_objects(content, mode):
    p = parse_response(content)
    assert p.ok and p.mode == mode and p.status == "CONTINUE"


def test_parse_never_accepts_unfinished_json():
    p = parse_response('{"output": "abc", "summary": "x", "status": "CONT', "length")
    assert not p.ok and p.mode == "TRUNCATED"
    p = parse_response('prefix {"summary": "x", "status": "DONE"', "stop")
    assert not p.ok and p.mode == "NONE"


def test_parse_braces_inside_strings_and_bounds():
    p = parse_response(obj(output="code { with } braces \" and quotes", summary="x" * 9000))
    assert p.ok and "braces" in p.output and len(p.summary) == 4000


def test_parse_unknown_status_is_flagged_not_fatal():
    p = parse_response(obj(status="MAYBE"))
    assert p.ok and p.status == "UNKNOWN" and "STATUS_INVALID" in p.errors


def test_render_contains_all_sections():
    text = render_turn_message(message_type="SESSION_ROTATION", number=12, session_seq=3, session_turn=1,
                               objective="do it", now_text="t", context_used=0, n_ctx=8192, turns_left=5,
                               rotation_reason="CONTEXT_PRESSURE", checkpoint="CHECKPOINT x",
                               notices=["memory SET a: APPLIED"], instructions=["use B"],
                               reads=[{"header": "ARTIFACT CONTENT r.md characters 0..3 of 3 (end)", "text": "abc"}])
    for part in ("NEW SESSION (reason: CONTEXT_PRESSURE)", "CHECKPOINT x", "memory SET a: APPLIED",
                 "OPERATOR INSTRUCTION", "use B", "ARTIFACT CONTENT r.md", "OBJECTIVE\ndo it"):
        assert part in text


# ---------------------------------------------------------------- effects

def state(**kw):
    base = dict(memory={}, artifact_sizes={}, priority="NORMAL", operator_priority="NORMAL",
                operator_edited_at=0.0, dispatched_at=100.0)
    base.update(kw)
    return EffectState(**base)


def test_effects_memory_and_artifact_rules():
    p = parse_response(obj(
        memory=[{"op": "SET", "key": "plan", "value": "v"}, {"op": "SET", "key": "bad key", "value": "v"},
                {"op": "DELETE", "key": "missing", "value": ""}, {"op": "SET", "key": "x", "value": "y" * 3000}],
        artifacts=[{"op": "WRITE", "name": "a.md", "content": "1"}, {"op": "APPEND", "name": "a.md", "content": "2"},
                   {"op": "WRITE", "name": "../etc/passwd", "content": "x"}]))
    plan = plan_effects(p, state())
    statuses = [(r["area"], r["target"], r["status"], r["reason"]) for r in plan.receipts]
    assert ("memory", "plan", "APPLIED", "") in statuses
    assert ("memory", "bad key", "INVALID", "KEY_INVALID") in statuses
    assert ("memory", "missing", "ALREADY_APPLIED", "NOT_PRESENT") in statuses
    assert ("memory", "x", "REJECTED", "VALUE_TOO_LONG") in statuses
    assert ("artifact", "../etc/passwd", "INVALID", "NAME_INVALID") in statuses
    assert [op["op"] for op in plan.artifact_ops] == ["WRITE", "APPEND"]
    assert plan.applied_count == 3


def test_effects_priority_operator_precedence_and_ceiling():
    p = parse_response(obj(control=[{"op": "SET_PRIORITY", "priority": "HIGH"}]))
    assert plan_effects(p, state()).receipts[0]["reason"] == "ABOVE_OPERATOR_PRIORITY"
    assert plan_effects(p, state(operator_priority="HIGH")).priority == "HIGH"
    edited_after = state(operator_priority="HIGH", operator_edited_at=150.0, dispatched_at=100.0)
    assert plan_effects(p, edited_after).receipts[0]["reason"] == "OPERATOR_PRECEDENCE"


def test_effects_control_validation():
    p = parse_response(obj(control=[{"op": "PAUSE", "seconds": 10}, {"op": "READ_ARTIFACT", "name": "none"},
                                    {"op": "ROTATE_SESSION"}, {"op": "ROTATE_SESSION"}, {"op": "EXEC"}]))
    reasons = [r["reason"] for r in plan_effects(p, state()).receipts]
    assert reasons == ["SECONDS_OUT_OF_RANGE", "ARTIFACT_NOT_FOUND", "NEXT_TURN_STARTS_NEW_SESSION",
                       "DUPLICATE_OPERATION", "TOO_MANY_CONTROL_OPS"]


# ---------------------------------------------------------------- control

def view(**kw):
    base = dict(objective="write chapter", recent_objectives=[], turn_count=3, max_turns=100, session_turn=3,
                max_session_turns=0, counters={})
    base.update(kw)
    return MissionView(**base)


def test_repetition_without_progress_is_replanned_and_escalated():
    # Reworded summary, no output, no effects: not progress.
    p = parse_response(obj(nextStep="write chapter", summary="reworded summary", output=""))
    v = view(previous_output_fp="")
    d = decide(p, plan_effects(p, state()), v)
    assert d.action == Action.CONTINUE and d.replanned and "[GreenSea replan" in d.next_objective
    d = decide(p, plan_effects(p, state()), view(counters={"replans": 2}))
    assert d.rotate == "REPETITION"
    d = decide(p, plan_effects(p, state()), view(counters={"replans": 5}))
    assert d.action == Action.NEEDS_OPERATOR and d.reason == "REPETITION"


def test_same_step_with_applied_effect_is_progress_not_repetition():
    p = parse_response(obj(nextStep="write chapter",
                           artifacts=[{"op": "APPEND", "name": "book.md", "content": "more"}]))
    d = decide(p, plan_effects(p, state(artifact_sizes={"book.md": 10})), view())
    assert not d.replanned and d.next_objective == "write chapter"


def test_done_and_blocked_claims_with_reviewer():
    done = parse_response(obj(status="DONE"))
    d = decide(done, plan_effects(done, state()), view(reviewer_mode="terminal"))
    assert d.action == Action.DONE and d.review == Review.DONE_CLAIM
    rejected = apply_review(d, {"verdict": "REJECT", "reason": "chapter 3 missing", "nextStep": "write ch 3"},
                            view(reviewer_mode="terminal"))
    assert rejected.action == Action.CONTINUE and rejected.next_objective == "write ch 3"
    again = decide(done, plan_effects(done, state()), view(reviewer_mode="terminal", counters={"done_rejections": 1}))
    twice = apply_review(again, {"verdict": "REJECT", "reason": "r", "nextStep": "s"}, view(reviewer_mode="terminal"))
    assert twice.action == Action.NEEDS_OPERATOR and twice.reason == "DONE_DISPUTED"
    assert apply_review(d, None, view()).action == Action.DONE
    blocked = parse_response(obj(status="BLOCKED", question="which?"))
    b = decide(blocked, plan_effects(blocked, state()), view(reviewer_mode="terminal"))
    assert b.action == Action.NEEDS_OPERATOR and b.question == "which?"
    unblocked = apply_review(b, {"verdict": "REJECT", "reason": "assume A", "nextStep": "use A"}, view())
    assert unblocked.action == Action.CONTINUE and unblocked.next_objective == "use A"


def test_finalize_precedence_budget_and_operator_pause():
    p = parse_response(obj(control=[{"op": "PAUSE", "seconds": 600}]))
    d = decide(p, plan_effects(p, state()), view())
    assert d.action == Action.PAUSE and d.pause_by == "MODEL" and d.pause_seconds == 600
    d = decide(p, plan_effects(p, state()), view(pause_requested=True))
    assert d.action == Action.PAUSE and d.pause_by == "OPERATOR"
    d = decide(p, plan_effects(p, state()), view(turn_count=100, max_turns=100))
    assert d.action == Action.NEEDS_OPERATOR and d.reason == "TURN_BUDGET_EXHAUSTED"
    done = parse_response(obj(status="DONE"))
    assert decide(done, plan_effects(done, state()), view(turn_count=100, max_turns=100)).action == Action.DONE


def test_state_machine_rejects_illegal_transitions():
    check_transition(Phase.ANALYZING, Phase.DONE)
    with pytest.raises(IllegalTransition):
        check_transition(Phase.SENDING, Phase.DONE)
    with pytest.raises(IllegalTransition):
        check_transition(Phase.DONE, Phase.SENDING)


def test_reviewer_verdict_parsing():
    assert parse_verdict('{"reason": "ok", "verdict": "ACCEPT", "nextStep": ""}')["verdict"] == "ACCEPT"
    assert parse_verdict('text {"reason": "r", "verdict": "reject", "nextStep": "x"}')["verdict"] == "REJECT"
    assert parse_verdict('{"reason": "r", "verdict": "MAYBE"}') is None
    assert parse_verdict('{"reason": "unclosed", "verdict": "ACCEPT"') is None


# ---------------------------------------------------------------- context

def test_context_check():
    assert check_context(projected_prompt=5000, max_tokens=1000, n_ctx=8192, rotate_at=0.75,
                         session_opening=False).verdict == ContextVerdict.OK
    assert check_context(projected_prompt=6500, max_tokens=1000, n_ctx=8192, rotate_at=0.75,
                         session_opening=False).verdict == ContextVerdict.ROTATE
    assert check_context(projected_prompt=6500, max_tokens=1000, n_ctx=8192, rotate_at=0.75,
                         session_opening=True).verdict == ContextVerdict.OK
    assert check_context(projected_prompt=7500, max_tokens=1000, n_ctx=8192, rotate_at=0.75,
                         session_opening=True).verdict == ContextVerdict.TOO_SMALL


def test_checkpoint_trims_to_budget_but_keeps_keys_and_index():
    est = TokenEstimator(3.0)
    cp_in = CheckpointInput(
        memory={f"k{i}": "v" * 1500 for i in range(10)},
        artifacts={"report.md": {"size": 99, "sha256": "ab" * 32, "updated_turn": 7}},
        progress=[(i, "CONTINUE", "summary " * 40) for i in range(1, 41)], total_turns=40,
        blockers=["need data"], last_output="o" * 5000, objective="next")
    budget = checkpoint_budget_tokens(n_ctx=8192, share=0.35, system_tokens=1500, max_tokens=1024, rotate_at=0.75)
    cp = build_checkpoint(cp_in, budget_tokens=budget, estimator=est, max_progress_items=20)
    assert cp.trimmed and cp.estimated_tokens <= budget
    for i in range(10):
        assert f"k{i}:" in cp.text
    assert "report.md" in cp.text and "need data" in cp.text


def test_estimator_calibrates_towards_observation():
    est = TokenEstimator(3.2)
    for _ in range(10):
        est.calibrate(40_000, 10_000)
    assert 3.9 < est.ratio <= 4.0


# ---------------------------------------------------------------- scheduler

def test_scheduler_priority_order_capacity_and_aging():
    async def main():
        now = [0.0]
        s = CapacityScheduler(capacity=1, aging_seconds=100, clock=lambda: now[0])
        first = await s.acquire("busy", "NORMAL")
        order: list[str] = []

        async def want(name, prio):
            lease = await s.acquire(name, prio)
            order.append(name)
            s.release(lease)

        low = asyncio.create_task(want("low", "LOW"))
        await asyncio.sleep(0)
        now[0] = 250.0  # low has aged two levels: LOW -> HIGH
        high = asyncio.create_task(want("high", "HIGH"))
        normal = asyncio.create_task(want("normal", "NORMAL"))
        await asyncio.sleep(0)
        s.release(first)
        await asyncio.gather(low, high, normal)
        # low (aged to HIGH, waited longer) beats high; normal last.
        assert order == ["low", "high", "normal"]

        # Cancelling a waiter never leaks a slot.
        held = await s.acquire("a", "NORMAL")
        waiter = asyncio.create_task(s.acquire("b", "NORMAL"))
        await asyncio.sleep(0)
        waiter.cancel()
        await asyncio.gather(waiter, return_exceptions=True)
        s.release(held)
        again = await asyncio.wait_for(s.acquire("c", "LOW"), 1)
        assert again.mission_id == "c"

    asyncio.run(main())


# ---------------------------------------------------------------- config

def test_config_file_and_validation(tmp_path):
    f = tmp_path / "g.toml"
    f.write_text('[server]\nport = 9000\nauth_token = "t"\n[llama]\nbase_url = "http://10.0.0.5:8080"\n'
                 '[context]\nrotate_at = 0.6\n')
    cfg = load_config(f)
    assert cfg.server.port == 9000 and cfg.runtime_defaults["context"]["rotate_at"] == 0.6
    f.write_text('[context]\nrotate_at = 3\n')
    with pytest.raises(SettingsError):
        load_config(f)
    f.write_text('[server]\nprot = 1\n')
    with pytest.raises(SettingsError):
        load_config(f)
    with pytest.raises(SettingsError):
        validate_runtime_patch({"generation": {"max_tokens": True}})
