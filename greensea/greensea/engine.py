"""The GreenSea engine: one runner task per active mission.

Turn protocol (write-ahead, crash-safe):
  1. PREPARED   the next turn (objective, message type) is committed together with
                the decision that produced it.
  2. DISPATCHED the rendered user message is committed before it is sent
                (instructions consumed in the same transaction); phase GENERATING.
  3. COMPLETED  the assistant response is committed; phase ANALYZING.
  4. analysis   parse, effects, controller decision and the next PREPARED turn are
                one transaction.
A session's context is rebuilt from COMPLETED turns only. A request that died
(crash, timeout, llama restart) never reached the context, and llama.cpp has no
side effects, so re-sending a DISPATCHED turn is safe and exact: the same stored
user message is sent again. Greenfield needed a send fence and DOM causality
checks because ChatGPT owned the conversation; GreenSea owns it.

Concurrency: every state change of a mission happens under that mission's
asyncio.Lock inside one database transaction that re-checks the phase. Operator
actions use the same lock, so a runner and an operator can never interleave a
transition.
"""

from __future__ import annotations

import asyncio
import logging
import time
import traceback
import uuid
from collections import defaultdict
from datetime import datetime
from typing import Any

from . import APP_VERSION
from . import db as dbm
from .bus import EventBus
from .config import AppConfig, merge_runtime, validate_runtime_patch
from .context import (CheckpointInput, ContextVerdict, TokenEstimator, build_checkpoint,
                      check_context, checkpoint_budget_tokens, memory_budget_chars)
from .contracts import (
    MAX_GOAL_CHARS, MAX_INSTRUCTION_CHARS, MAX_TITLE_CHARS, PRIORITIES, OPERATOR_WAIT_PHASES,
    TERMINAL_PHASES, MessageType, Phase, RotationReason, TurnState, check_transition,
    normalize_priority,
)
from .control import Action, MissionView, Review, apply_review, decide
from .effects import EffectState, plan_effects, receipt_line, sha256_text
from .llama import ErrorKind, LlamaClient, LlamaError
from .monitor import LlamaMonitor
from .protocol import (build_system_prompt, parse_response, render_turn_message, response_format,
                       strip_reasoning)
from .reviewer import REVIEW_SCHEMA, build_review_messages, parse_verdict
from .scheduler import CapacityScheduler

log = logging.getLogger("greensea.engine")

START_OBJECTIVE = ("Start the mission: restate its goal and acceptance criteria in your own words, store a short "
                   "plan in memory (key \"plan\"), and complete the first concrete step.")
RESUME_AFTER_OPERATOR = ("Continue the mission. Take the operator instruction into account; it answers or "
                         "overrides what stopped you.")
DELTA_FLUSH_S = 0.15


class EngineError(Exception):
    """Operator request that cannot be honoured in the current state (HTTP 409/400)."""

    def __init__(self, message: str, status: int = 409):
        super().__init__(message)
        self.status = status


def recovery_delay_s(attempts: int) -> float:
    """Greenfield withRecovery: 1..30 s for the first four, then 15 min doubling to 6 h."""
    if attempts >= 5:
        return min(6 * 3600.0, 15 * 60.0 * (2 ** min(5, attempts - 5)))
    return min(30.0, max(1.0, float(2 ** min(5, attempts - 1))))


def local_now_text() -> str:
    return datetime.now().astimezone().isoformat(timespec="seconds")


class Engine:
    def __init__(self, config: AppConfig, database: dbm.Database, llama: LlamaClient, bus: EventBus):
        self.config = config
        self.db = database
        self.llama = llama
        self.bus = bus
        self.settings = merge_runtime(config.runtime_defaults, {})
        self.scheduler = CapacityScheduler(capacity=0, aging_seconds=self.settings["scheduler"]["aging_seconds"])
        self.monitor = LlamaMonitor(llama, interval=lambda: float(self.settings["timeouts"]["health_interval_seconds"]),
                                    on_change=self._on_monitor_change)
        self.estimator = TokenEstimator()
        self._runners: dict[str, asyncio.Task] = {}
        self._locks: dict[str, asyncio.Lock] = defaultdict(asyncio.Lock)
        self._wake: dict[str, asyncio.Event] = defaultdict(asyncio.Event)
        self._live: dict[str, dict] = {}
        self._waiting: dict[str, str] = {}
        self._closing = False

    # ------------------------------------------------------------------ lifecycle

    async def start(self) -> None:
        overrides = await self.db.read(dbm.get_settings)
        try:
            self.settings = merge_runtime(self.config.runtime_defaults, validate_runtime_patch(overrides))
        except ValueError as exc:
            log.error("ignoring invalid stored settings: %s", exc)
        self._apply_settings()
        self.monitor.start()
        missions = await self.db.read(dbm.list_missions)
        for m in missions:
            if self._needs_runner(m):
                self._spawn(m["id"])
        await self._event("", "SERVICE_STARTED", {"version": APP_VERSION,
                                                  "runners": len(self._runners)})

    async def shutdown(self) -> None:
        self._closing = True
        tasks = list(self._runners.values())
        for t in tasks:
            t.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
        await self.monitor.stop()

    @staticmethod
    def _needs_runner(m: dict) -> bool:
        phase = m["phase"]
        if phase in (Phase.SENDING, Phase.GENERATING, Phase.ANALYZING, Phase.ROTATING, Phase.RECOVERING):
            return True
        return phase == Phase.PAUSED and m["pause_until"] is not None

    def _spawn(self, mission_id: str) -> None:
        if self._closing:
            return
        task = self._runners.get(mission_id)
        if task is not None and not task.done():
            return
        self._runners[mission_id] = asyncio.create_task(self._run(mission_id), name=f"mission-{mission_id}")

    async def _cancel_runner(self, mission_id: str) -> None:
        task = self._runners.get(mission_id)
        if task is None or task.done() or task is asyncio.current_task():
            return
        task.cancel()
        try:
            await task
        except (asyncio.CancelledError, Exception):
            pass

    def _apply_settings(self) -> None:
        sched = self.settings["scheduler"]
        self.scheduler.configure(capacity=sched["max_parallel"] or (self.monitor.total_slots() or 1),
                                 aging_seconds=sched["aging_seconds"])

    def _on_monitor_change(self, state: dict) -> None:
        self._apply_settings()
        self.bus.publish({"type": "llama", "llama": self.llama_state()})

    def n_ctx(self) -> int | None:
        return self.settings["context"]["n_ctx"] or self.monitor.n_ctx()

    def llama_state(self) -> dict:
        s = dict(self.monitor.state)
        s["n_ctx_effective"] = self.n_ctx()
        s["capacity"] = self.scheduler.capacity
        s["base_url"] = self.llama.base_url
        return s

    # ------------------------------------------------------------------ helpers

    async def _event(self, mission_id: str, kind: str, detail: dict | None = None) -> None:
        ev = await self.db.tx(dbm.add_event, mission_id, kind, detail or {})
        self.bus.publish({"type": "event", "event": ev})

    def _publish_events(self, events: list[dict]) -> None:
        for ev in events:
            self.bus.publish({"type": "event", "event": ev})

    async def _publish_mission(self, mission_id: str) -> None:
        m = await self.db.read(dbm.get_mission, mission_id)
        if m is not None:
            self.bus.publish({"type": "mission", "mission": self.mission_summary(m)})

    def mission_summary(self, m: dict) -> dict:
        n_ctx = self.n_ctx() or 0
        counters = m.get("counters") or {}
        return {
            "id": m["id"], "title": m["title"], "phase": m["phase"], "phase_reason": m["phase_reason"],
            "priority": m["priority"], "operator_priority": m["operator_priority"],
            "turn_count": m["turn_count"], "max_turns": m["max_turns"], "session_seq": m["session_seq"],
            "objective": m["objective"], "question": m["question"],
            "pause_until": m["pause_until"], "pause_requested": bool(m["pause_requested"]),
            "rotate_requested": m["rotate_requested"], "context_tokens": m["context_tokens"],
            "n_ctx": n_ctx,
            "context_fill": round(m["context_tokens"] / n_ctx, 3) if n_ctx else None,
            "recovery": m.get("recovery") or {}, "waiting_for": self._waiting.get(m["id"], ""),
            "live": m["id"] in self._live, "last_decision": m.get("last_decision") or {},
            "counters": {k: v for k, v in counters.items() if isinstance(v, (int, float))},
            "created_at": m["created_at"], "updated_at": m["updated_at"],
            "started_at": m["started_at"], "completed_at": m["completed_at"],
            "goal_rev": m["goal_rev"],
        }

    @staticmethod
    def _set_phase(conn, m: dict, phase: str, reason: str = "", **fields: Any) -> None:
        check_transition(m["phase"], phase)
        if phase in TERMINAL_PHASES:
            fields.setdefault("completed_at", dbm.now())
        dbm.update_mission(conn, m["id"], phase=phase, phase_reason=reason, **fields)
        m["phase"] = phase

    async def _transition(self, mission_id: str, expect: set[str] | None, phase: str, reason: str,
                          event: str | None = None, detail: dict | None = None, **fields: Any) -> bool:
        def fn(conn):
            m = dbm.get_mission(conn, mission_id)
            if m is None or (expect is not None and m["phase"] not in expect):
                return False, []
            self._set_phase(conn, m, phase, reason, **fields)
            evs = [dbm.add_event(conn, mission_id, event, detail or {})] if event else []
            return True, evs

        async with self._locks[mission_id]:
            ok, evs = await self.db.tx(fn)
        self._publish_events(evs)
        if ok:
            await self._publish_mission(mission_id)
        return ok

    async def _n_ctx_unknown(self, mission_id: str, phase: str) -> None:
        await self._transition(
            mission_id, {phase}, Phase.NEEDS_OPERATOR, "N_CTX_UNKNOWN", "N_CTX_UNKNOWN", {},
            question=("llama-server did not report its context size (n_ctx). Set Kontext → n_ctx in the "
                      "settings, then resume."))

    @staticmethod
    def _reset_pending(conn, mission_id: str) -> None:
        """Turn an unsent (DISPATCHED) turn back into PREPARED so it is rendered again.

        Safe because a DISPATCHED turn never entered the session context."""
        pending = dbm.pending_turn(conn, mission_id)
        if pending is not None and pending["state"] == TurnState.DISPATCHED:
            conn.execute("UPDATE instructions SET consumed_turn=NULL WHERE mission_id=? AND consumed_turn=?",
                         (mission_id, pending["number"]))
            dbm.update_turn(conn, pending["id"], state=TurnState.PREPARED, user_content="")

    async def _sleep_or_wake(self, mission_id: str, seconds: float) -> None:
        ev = self._wake[mission_id]
        ev.clear()
        try:
            await asyncio.wait_for(ev.wait(), timeout=max(0.0, seconds))
        except asyncio.TimeoutError:
            pass

    # ------------------------------------------------------------------ runner

    async def _run(self, mission_id: str) -> None:
        me = asyncio.current_task()
        try:
            while not self._closing:
                m = await self.db.read(dbm.get_mission, mission_id)
                if m is None:
                    return
                phase = m["phase"]
                if phase in (Phase.SENDING, Phase.GENERATING):
                    await self._step_send(m)
                elif phase == Phase.ANALYZING:
                    await self._step_analyze(m)
                elif phase == Phase.ROTATING:
                    await self._step_rotate(m)
                elif phase == Phase.RECOVERING:
                    await self._step_recovering(m)
                elif phase == Phase.PAUSED and m["pause_until"] is not None:
                    await self._step_timed_pause(m)
                else:
                    return
        except asyncio.CancelledError:
            raise
        except Exception as exc:  # a bug must not kill the mission silently or loop tightly
            log.exception("runner for %s failed", mission_id)
            await self._runner_failed(mission_id, exc)
        finally:
            self._waiting.pop(mission_id, None)
            self._live.pop(mission_id, None)
            if self._runners.get(mission_id) is me:
                self._runners.pop(mission_id, None)

    async def _runner_failed(self, mission_id: str, exc: Exception) -> None:
        detail = {"error": f"{type(exc).__name__}: {exc}"[:1000],
                  "trace": traceback.format_exc(limit=6)[-3000:]}

        def fn(conn):
            m = dbm.get_mission(conn, mission_id)
            if m is None or m["phase"] in OPERATOR_WAIT_PHASES or m["phase"] == Phase.PAUSED:
                return False, []
            attempts = int((m.get("recovery") or {}).get("attempts", 0)) + 1
            recover_to = Phase.SENDING if m["phase"] in (Phase.GENERATING, Phase.RECOVERING) else m["phase"]
            if attempts > 8:
                self._set_phase(conn, m, Phase.NEEDS_OPERATOR, "RUNNER_ERROR",
                                question="GreenSea hit an internal error repeatedly: " + detail["error"])
            else:
                delay = recovery_delay_s(attempts)
                self._set_phase(conn, m, Phase.RECOVERING, "RUNNER_ERROR", recovery={
                    "attempts": attempts, "recover_to": recover_to, "reason": "RUNNER_ERROR",
                    "detail": detail["error"], "next_attempt_at": dbm.now() + delay})
            return True, [dbm.add_event(conn, mission_id, "RUNNER_ERROR", detail)]

        try:
            async with self._locks[mission_id]:
                ok, evs = await self.db.tx(fn)
            self._publish_events(evs)
            await self._publish_mission(mission_id)
            if ok:
                asyncio.get_running_loop().call_soon(self._spawn, mission_id)
        except Exception:
            log.exception("could not record runner failure for %s", mission_id)

    # ------------------------------------------------------------------ SENDING

    async def _step_send(self, m: dict) -> None:
        mid = m["id"]
        if m["phase"] == Phase.GENERATING:
            # Only reachable after a restart: the stream died with the process.
            await self._transition(mid, {Phase.GENERATING}, Phase.SENDING, "RESTART_REDISPATCH",
                                   "RESTART_REDISPATCH", {})
            return
        if m["pause_requested"]:
            await self._transition(mid, {Phase.SENDING}, Phase.PAUSED, "OPERATOR_PAUSE", "PAUSED",
                                   {"by": "OPERATOR"}, pause_requested=0, pause_until=None)
            return
        rotation = await self._rotation_needed(m)
        if rotation:
            await self._transition(mid, {Phase.SENDING}, Phase.ROTATING, rotation, rotate_requested=rotation)
            return

        self._waiting[mid] = "LLAMA"
        await self._publish_mission(mid)
        await self.monitor.wait_ok()
        self._waiting[mid] = "CAPACITY"
        await self._publish_mission(mid)
        lease = await self.scheduler.acquire(mid, m["priority"], "turn")
        self._waiting.pop(mid, None)
        try:
            await self._dispatch_with_lease(mid)
        finally:
            self.scheduler.release(lease)

    async def _rotation_needed(self, m: dict) -> str:
        session = await self.db.read(dbm.current_session, m["id"])
        if session is None:
            return RotationReason.MISSION_START
        if m["rotate_requested"]:
            return m["rotate_requested"]
        if session["goal_rev"] != m["goal_rev"]:
            return RotationReason.MISSION_UPDATED
        return ""

    async def _dispatch_with_lease(self, mid: str) -> None:
        # Re-read: the operator may have acted while we waited for capacity.
        m = await self.db.read(dbm.get_mission, mid)
        if m is None or m["phase"] != Phase.SENDING or m["pause_requested"]:
            return
        if await self._rotation_needed(m):
            return  # next loop iteration converts to ROTATING
        n_ctx = self.n_ctx()
        if not n_ctx:
            await self._n_ctx_unknown(mid, Phase.SENDING)
            return
        gen = self.settings["generation"]
        req = await self._build_request(m, n_ctx)
        if req is None:
            return
        check = check_context(projected_prompt=req["projected"], max_tokens=gen["max_tokens"], n_ctx=n_ctx,
                              rotate_at=self.settings["context"]["rotate_at"],
                              session_opening=req["opening"])
        if check.verdict == ContextVerdict.ROTATE:
            await self._transition(mid, {Phase.SENDING}, Phase.ROTATING, RotationReason.CONTEXT_PRESSURE,
                                   "CONTEXT_PRESSURE", check.as_dict(),
                                   rotate_requested=RotationReason.CONTEXT_PRESSURE)
            return
        if check.verdict == ContextVerdict.TOO_SMALL:
            await self._transition(
                mid, {Phase.SENDING}, Phase.NEEDS_OPERATOR, "CONTEXT_TOO_SMALL", "CONTEXT_TOO_SMALL",
                check.as_dict(),
                question=(f"The opening of a new session needs about {check.projected_prompt} tokens plus "
                          f"{gen['max_tokens']} for the answer, but the context is {n_ctx} tokens. Shorten the "
                          "mission text, lower max_tokens or give llama-server a larger context."))
            return

        pending = req["pending"]
        user_content = req["user_content"]

        def commit_dispatch(conn):
            cur = dbm.get_mission(conn, mid)
            turn = dbm.get_turn(conn, pending["id"])
            if (cur is None or cur["phase"] != Phase.SENDING or turn is None
                    or turn["state"] not in (TurnState.PREPARED, TurnState.DISPATCHED)):
                return False, []
            if turn["state"] == TurnState.PREPARED:
                dbm.consume_instructions(conn, req["instruction_ids"], turn["number"])
            dbm.update_turn(conn, turn["id"], state=TurnState.DISPATCHED, user_content=user_content,
                            attempts=turn["attempts"] + 1, dispatched_at=dbm.now(), error="")
            self._set_phase(conn, cur, Phase.GENERATING, "")
            if cur["started_at"] is None:
                dbm.update_mission(conn, mid, started_at=dbm.now())
            ev = dbm.add_event(conn, mid, "TURN_DISPATCHED", {
                "turn": turn["number"], "attempt": turn["attempts"] + 1, "session": cur["session_seq"],
                "projected_prompt_tokens": check.projected_prompt, "message_type": turn["message_type"]})
            return True, [ev]

        async with self._locks[mid]:
            ok, evs = await self.db.tx(commit_dispatch)
        self._publish_events(evs)
        if not ok:
            return
        await self._publish_mission(mid)
        await self._generate(mid, pending, req["messages"], n_ctx)

    async def _build_request(self, m: dict, n_ctx: int) -> dict | None:
        mid = m["id"]

        def load(conn):
            session = dbm.current_session(conn, mid)
            pending = dbm.pending_turn(conn, mid)
            completed = dbm.session_completed_turns(conn, session["id"]) if session else []
            instructions = dbm.pending_instructions(conn, mid)
            last = dbm.last_completed_turn(conn, mid)
            return session, pending, completed, instructions, last

        session, pending, completed, instructions, last = await self.db.read(load)
        if session is None or pending is None:
            await self._transition(mid, {Phase.SENDING}, Phase.NEEDS_OPERATOR, "NO_PENDING_TURN",
                                   "INVARIANT_VIOLATION", {"detail": "no session or pending turn"},
                                   question="GreenSea found no prepared turn. Use Resume to continue.")
            return None
        messages: list[dict] = [{"role": "system", "content": session["system_prompt"]}]
        for t in completed:
            messages.append({"role": "user", "content": t["user_content"]})
            messages.append({"role": "assistant", "content": strip_reasoning(t["assistant_content"])})
        opening = pending["session_turn"] == 1 or not completed
        instruction_ids: list[int] = []
        if pending["state"] == TurnState.DISPATCHED and pending["user_content"]:
            user_content = pending["user_content"]
        else:
            instruction_ids = [i["id"] for i in instructions]
            user_content = await self._render_user(m, session, pending, last, instructions, n_ctx, opening)
        messages.append({"role": "user", "content": user_content})
        if opening:
            joined = session["system_prompt"] + "\n" + user_content
            try:
                projected = await self.llama.count_tokens(joined) + 2 * 12
                self.estimator.calibrate(len(joined), projected)
            except LlamaError:
                projected = self.estimator.estimate(joined)
        else:
            projected = int(m["context_tokens"]) + self.estimator.estimate(user_content)
        return {"messages": messages, "user_content": user_content, "pending": pending,
                "instruction_ids": instruction_ids, "projected": projected, "opening": opening}

    async def _render_user(self, m: dict, session: dict, pending: dict, last: dict | None,
                           instructions: list[dict], n_ctx: int, opening: bool) -> str:
        mid = m["id"]
        ctx = self.settings["context"]
        reads = []
        if last is not None:
            for req in (last.get("read_requests") or [])[:2]:
                art = await self.db.read(dbm.get_artifact, mid, req["name"])
                if art is None:
                    continue
                content = art["content"]
                start = min(int(req.get("offset", 0)), len(content))
                chunk = content[start:start + ctx["artifact_read_chars"]]
                end = start + len(chunk)
                reads.append({"header": (f"ARTIFACT CONTENT {req['name']} characters {start}..{end} of "
                                         f"{len(content)}" + (" (more remains; READ_ARTIFACT with offset "
                                                              f"{end})" if end < len(content) else " (end)")),
                              "text": chunk})
        checkpoint_text = ""
        if pending["message_type"] == MessageType.SESSION_ROTATION:
            checkpoint_text = await self._checkpoint_text(m, session, n_ctx, pending)
        return render_turn_message(
            message_type=pending["message_type"], number=pending["number"], session_seq=m["session_seq"],
            session_turn=pending["session_turn"], objective=pending["objective"], now_text=local_now_text(),
            context_used=0 if opening else int(m["context_tokens"]), n_ctx=n_ctx,
            turns_left=max(0, m["max_turns"] - m["turn_count"]),
            rotation_reason=pending["rotation_reason"], checkpoint=checkpoint_text,
            notices=list(m.get("notices") or []), reads=reads,
            instructions=[i["text"] for i in instructions])

    async def _checkpoint_text(self, m: dict, session: dict, n_ctx: int, pending: dict) -> str:
        mid = m["id"]
        ctx = self.settings["context"]

        def load(conn):
            memory = {k: v["value"] for k, v in dbm.get_memory(conn, mid).items()}
            artifacts = dbm.artifact_index(conn, mid)
            recent = dbm.recent_completed_turns(conn, mid, ctx["progress_log_items"])
            return memory, artifacts, recent

        memory, artifacts, recent = await self.db.read(load)
        progress = []
        last_output = ""
        for t in recent:
            p = t.get("parse") or {}
            progress.append((t["number"], p.get("status") or "?",
                             p.get("summary") or ("(no valid report: " + str(p.get("mode", "?")) + ")")))
        if recent:
            last_output = (recent[-1].get("parse") or {}).get("output_tail", "")
        counters = m.get("counters") or {}
        system_tokens = self.estimator.estimate(session["system_prompt"])
        budget = checkpoint_budget_tokens(n_ctx=n_ctx, share=ctx["checkpoint_share"],
                                          system_tokens=system_tokens,
                                          max_tokens=self.settings["generation"]["max_tokens"],
                                          rotate_at=ctx["rotate_at"])
        cp = build_checkpoint(CheckpointInput(
            memory=memory, artifacts=artifacts, progress=progress, total_turns=m["turn_count"],
            blockers=list(counters.get("open_blockers") or []), last_output=last_output,
            objective=pending["objective"]), budget_tokens=budget, estimator=self.estimator,
            max_progress_items=ctx["progress_log_items"])
        if cp.trimmed:
            await self._event(mid, "CHECKPOINT_TRIMMED", {"budget": budget, "estimated": cp.estimated_tokens,
                                                          "progress_items": cp.progress_items,
                                                          "memory_value_chars": cp.memory_value_chars})
        return cp.text

    def _chat_payload(self, messages: list[dict]) -> dict:
        gen = self.settings["generation"]
        payload: dict[str, Any] = {
            "messages": messages,
            "max_tokens": gen["max_tokens"],
            "temperature": gen["temperature"],
            "top_p": gen["top_p"],
            "cache_prompt": True,
        }
        fmt = response_format(gen["structured_output"])
        if fmt is not None:
            payload["response_format"] = fmt
        return payload

    async def _generate(self, mid: str, pending: dict, messages: list[dict], n_ctx: int) -> None:
        live = {"turn": pending["number"], "content": "", "reasoning": "", "started_at": time.time()}
        self._live[mid] = live
        buf = {"c": [], "r": [], "last": 0.0}

        def flush() -> None:
            if buf["c"] or buf["r"]:
                self.bus.publish({"type": "delta", "mission_id": mid, "turn": pending["number"],
                                  "content": "".join(buf["c"]), "reasoning": "".join(buf["r"])})
                buf["c"].clear()
                buf["r"].clear()
            buf["last"] = time.monotonic()

        def on_delta(content: str, reasoning: str) -> None:
            live["content"] += content
            live["reasoning"] += reasoning
            if content:
                buf["c"].append(content)
            if reasoning:
                buf["r"].append(reasoning)
            if time.monotonic() - buf["last"] >= DELTA_FLUSH_S:
                flush()

        timeouts = self.settings["timeouts"]
        try:
            result = await self.llama.stream_chat(
                self._chat_payload(messages), on_delta=on_delta,
                first_token_timeout=timeouts["first_token_seconds"], stall_timeout=timeouts["stall_seconds"],
                turn_timeout=timeouts["turn_seconds"])
        except LlamaError as err:
            flush()
            self._live.pop(mid, None)
            await self._llama_failed(mid, pending, err, messages)
            return
        flush()
        self._live.pop(mid, None)

        chars = sum(len(x["content"]) for x in messages) + len(result.content)
        if result.prompt_tokens is not None and result.completion_tokens is not None:
            context_tokens = result.prompt_tokens + result.completion_tokens
            self.estimator.calibrate(sum(len(x["content"]) for x in messages), result.prompt_tokens)
        else:
            context_tokens = self.estimator.estimate("x" * chars)
        store_reasoning = self.settings["generation"]["store_reasoning"]

        def commit_completion(conn):
            cur = dbm.get_mission(conn, mid)
            turn = dbm.get_turn(conn, pending["id"])
            if cur is None or cur["phase"] != Phase.GENERATING or turn is None \
                    or turn["state"] != TurnState.DISPATCHED:
                return False, []
            dbm.update_turn(conn, turn["id"], state=TurnState.COMPLETED, assistant_content=result.content,
                            reasoning_content=result.reasoning if store_reasoning else "",
                            finish_reason=result.finish_reason, prompt_tokens=result.prompt_tokens,
                            completion_tokens=result.completion_tokens, cached_tokens=result.cached_tokens,
                            timings={**result.timings, "elapsed_s": round(result.elapsed_s, 3),
                                     "first_token_s": round(result.first_token_s, 3)
                                     if result.first_token_s is not None else None},
                            completed_at=dbm.now())
            dbm.bump_session_turns(conn, turn["session_id"])
            self._set_phase(conn, cur, Phase.ANALYZING, "", turn_count=cur["turn_count"] + 1,
                            context_tokens=context_tokens, notices=[],
                            recovery={})
            ev = dbm.add_event(conn, mid, "TURN_COMPLETED", {
                "turn": turn["number"], "finish_reason": result.finish_reason,
                "prompt_tokens": result.prompt_tokens, "completion_tokens": result.completion_tokens,
                "cached_tokens": result.cached_tokens, "context_tokens": context_tokens, "n_ctx": n_ctx,
                "elapsed_s": round(result.elapsed_s, 1)})
            return True, [ev]

        async with self._locks[mid]:
            ok, evs = await self.db.tx(commit_completion)
        self._publish_events(evs)
        if ok:
            self.bus.publish({"type": "turn", "mission_id": mid, "turn": pending["number"]})
            await self._publish_mission(mid)

    async def _llama_failed(self, mid: str, pending: dict, err: LlamaError, messages: list[dict]) -> None:
        self.monitor.kick()
        if err.kind == ErrorKind.CONTEXT_EXCEEDED:
            self.monitor.invalidate_props()
            n_prompt = err.data.get("n_prompt_tokens")
            if isinstance(n_prompt, int) and n_prompt > 0:
                self.estimator.calibrate(sum(len(x["content"]) for x in messages), n_prompt)
            if pending["session_turn"] == 1:
                await self._transition(
                    mid, {Phase.GENERATING}, Phase.NEEDS_OPERATOR, "CONTEXT_TOO_SMALL", "CONTEXT_TOO_SMALL",
                    {"error": err.as_dict(), **err.data},
                    question=("llama-server rejected even the opening of a fresh session as too large: "
                              f"{err.message}. Shorten the mission text, lower max_tokens or raise the context."))
            else:
                await self._transition(mid, {Phase.GENERATING}, Phase.ROTATING, RotationReason.CONTEXT_EXCEEDED,
                                       "CONTEXT_EXCEEDED", {"error": err.as_dict(), **err.data},
                                       rotate_requested=RotationReason.CONTEXT_EXCEEDED)
            return
        if not err.transient:
            await self._transition(
                mid, {Phase.GENERATING}, Phase.NEEDS_OPERATOR, "LLAMA_REQUEST_REJECTED", "LLAMA_ERROR",
                {"error": err.as_dict(), "turn": pending["number"]},
                question=(f"llama-server rejected the request (HTTP {err.status}): {err.message}. "
                          "Check the llama settings (API key, model, structured output mode)."))
            return

        def fn(conn):
            cur = dbm.get_mission(conn, mid)
            if cur is None or cur["phase"] != Phase.GENERATING:
                return False, []
            attempts = int((cur.get("recovery") or {}).get("attempts", 0)) + 1
            delay = recovery_delay_s(attempts)
            dbm.update_turn(conn, pending["id"], error=f"{err.kind}: {err.message}"[:2000])
            self._set_phase(conn, cur, Phase.RECOVERING, err.kind, recovery={
                "attempts": attempts, "recover_to": Phase.SENDING, "reason": err.kind,
                "detail": err.message[:1000], "next_attempt_at": dbm.now() + delay})
            return True, [dbm.add_event(conn, mid, "LLAMA_ERROR", {
                "error": err.as_dict(), "turn": pending["number"], "attempt": attempts, "retry_in_s": delay})]

        async with self._locks[mid]:
            ok, evs = await self.db.tx(fn)
        self._publish_events(evs)
        await self._publish_mission(mid)

    # ------------------------------------------------------------------ RECOVERING / PAUSED

    async def _step_recovering(self, m: dict) -> None:
        rec = m.get("recovery") or {}
        wait = float(rec.get("next_attempt_at") or 0) - dbm.now()
        if wait > 0:
            await self._sleep_or_wake(m["id"], wait)
            cur = await self.db.read(dbm.get_mission, m["id"])
            if cur is None or cur["phase"] != Phase.RECOVERING:
                return
            if float((cur.get("recovery") or {}).get("next_attempt_at") or 0) > dbm.now():
                return  # woken for another reason; loop re-evaluates
        target = rec.get("recover_to") or Phase.SENDING
        if target not in (Phase.SENDING, Phase.ANALYZING, Phase.ROTATING):
            target = Phase.SENDING
        await self._transition(m["id"], {Phase.RECOVERING}, target, "RETRY", "RETRY",
                               {"attempt": rec.get("attempts"), "to": target})

    async def _step_timed_pause(self, m: dict) -> None:
        wait = float(m["pause_until"]) - dbm.now()
        if wait > 0:
            await self._sleep_or_wake(m["id"], wait)
            cur = await self.db.read(dbm.get_mission, m["id"])
            if cur is None or cur["phase"] != Phase.PAUSED or cur["pause_until"] is None \
                    or float(cur["pause_until"]) > dbm.now():
                return
        await self._transition(m["id"], {Phase.PAUSED}, Phase.SENDING, "PAUSE_ENDED", "PAUSE_ENDED", {},
                               pause_until=None)

    # ------------------------------------------------------------------ ROTATING

    async def _step_rotate(self, m: dict) -> None:
        mid = m["id"]
        self._waiting[mid] = "LLAMA"
        await self.monitor.wait_ok()
        self._waiting.pop(mid, None)
        n_ctx = self.n_ctx()
        if not n_ctx:
            await self._n_ctx_unknown(mid, Phase.ROTATING)
            return
        ctx = self.settings["context"]
        reason = m["rotate_requested"] or RotationReason.MODEL_REQUEST
        system_prompt = build_system_prompt(
            goal=m["goal"], title=m["title"], n_ctx=n_ctx, read_chars=ctx["artifact_read_chars"],
            mem_budget=memory_budget_chars(n_ctx=n_ctx, share=ctx["checkpoint_share"],
                                           chars_per_token=self.estimator.ratio))

        def fn(conn):
            cur = dbm.get_mission(conn, mid)
            if cur is None or cur["phase"] != Phase.ROTATING:
                return False, []
            old = dbm.current_session(conn, mid)
            first = old is None
            if old is not None:
                dbm.end_session(conn, old["id"])
            seq = (old["seq"] if old else 0) + 1
            session_id = dbm.insert_session(conn, mission_id=mid, seq=seq, reason=reason,
                                            system_prompt=system_prompt, goal_rev=cur["goal_rev"], n_ctx=n_ctx)
            mtype = MessageType.MISSION_START if first else MessageType.SESSION_ROTATION
            pending = dbm.pending_turn(conn, mid)
            if pending is not None:
                # Re-home the unsent turn into the new session; release consumed instructions.
                conn.execute("UPDATE instructions SET consumed_turn=NULL WHERE mission_id=? AND consumed_turn=?",
                             (mid, pending["number"]))
                dbm.update_turn(conn, pending["id"], session_id=session_id, session_turn=1, message_type=mtype,
                                rotation_reason=reason, state=TurnState.PREPARED, user_content="")
            else:
                dbm.insert_turn(conn, {
                    "mission_id": mid, "session_id": session_id, "number": dbm.next_turn_number(conn, mid),
                    "session_turn": 1, "message_type": mtype, "rotation_reason": reason,
                    "objective": cur["objective"] or START_OBJECTIVE, "state": TurnState.PREPARED})
            self._set_phase(conn, cur, Phase.SENDING, "", session_seq=seq, rotate_requested="",
                            context_tokens=0)
            return True, [dbm.add_event(conn, mid, "SESSION_STARTED" if first else "SESSION_ROTATED", {
                "reason": reason, "session": seq, "previous_session_turns": old["turn_count"] if old else 0,
                "n_ctx": n_ctx})]

        async with self._locks[mid]:
            ok, evs = await self.db.tx(fn)
        self._publish_events(evs)
        await self._publish_mission(mid)

    # ------------------------------------------------------------------ ANALYZING

    async def _step_analyze(self, m: dict) -> None:
        mid = m["id"]

        def load(conn):
            turn = dbm.last_completed_turn(conn, mid)
            memory = {k: v["value"] for k, v in dbm.get_memory(conn, mid).items()}
            artifacts = dbm.artifact_index(conn, mid)
            recent = dbm.recent_completed_turns(conn, mid, 6)
            session = dbm.current_session(conn, mid)
            return turn, memory, artifacts, recent, session

        turn, memory, artifacts, recent, session = await self.db.read(load)
        if turn is None or turn.get("decision"):
            await self._transition(mid, {Phase.ANALYZING}, Phase.NEEDS_OPERATOR, "NOTHING_TO_ANALYZE",
                                   "INVARIANT_VIOLATION", {"detail": "no unanalysed completed turn"},
                                   question="GreenSea found no response to analyse. Use Resume to continue.")
            return
        parsed = parse_response(turn["assistant_content"], turn["finish_reason"])
        plan = plan_effects(parsed, EffectState(
            memory=memory, artifact_sizes={n: a["size"] for n, a in artifacts.items()},
            priority=m["priority"], operator_priority=m["operator_priority"],
            operator_edited_at=float(m["operator_edited_at"] or 0),
            dispatched_at=float(turn["dispatched_at"] or 0)))
        counters = dict(m.get("counters") or {})
        rotate_requested = m["rotate_requested"]
        if not rotate_requested and session is not None and session["goal_rev"] != m["goal_rev"]:
            rotate_requested = RotationReason.MISSION_UPDATED
        reviewer = self.settings["reviewer"]
        view = MissionView(
            objective=turn["objective"],
            recent_objectives=[t["objective"] for t in recent if t["id"] != turn["id"]],
            turn_count=m["turn_count"], max_turns=m["max_turns"], session_turn=turn["session_turn"],
            max_session_turns=self.settings["context"]["max_session_turns"], counters=counters,
            previous_output_fp=str(counters.get("last_output_fp") or ""),
            pause_requested=bool(m["pause_requested"]), rotate_requested=rotate_requested,
            reviewer_mode=reviewer["mode"], max_rejections=reviewer["max_rejections"])
        decision = decide(parsed, plan, view)
        if decision.review:
            verdict = await self._review(m, turn, parsed, decision.review, memory, artifacts, recent)
            decision = apply_review(decision, verdict, view)
        await self._commit_analysis(mid, turn, parsed, plan, decision)

    async def _review(self, m: dict, turn: dict, parsed, kind: str, memory: dict, artifacts: dict,
                      recent: list[dict]) -> dict | None:
        mid = m["id"]
        progress = [(t["number"], (t.get("parse") or {}).get("summary", "")) for t in recent if t["id"] != turn["id"]]
        progress.append((turn["number"], parsed.summary))
        messages = build_review_messages(kind=kind, goal=m["goal"], parsed=parsed, objective=turn["objective"],
                                         memory=memory, artifacts=artifacts, progress=progress)
        payload: dict[str, Any] = {"messages": messages, "max_tokens": self.settings["reviewer"]["max_tokens"],
                                   "temperature": 0.2, "cache_prompt": False}
        if self.settings["generation"]["structured_output"] != "off":
            payload["response_format"] = {"type": "json_schema",
                                          "json_schema": {"name": "greensea_review_v1", "schema": REVIEW_SCHEMA}}
        self._waiting[mid] = "LLAMA"
        await self.monitor.wait_ok()
        self._waiting[mid] = "CAPACITY"
        lease = await self.scheduler.acquire(mid, m["priority"], "review")
        self._waiting[mid] = "REVIEW"
        await self._publish_mission(mid)
        verdict = None
        error = ""
        try:
            result = await self.llama.chat(payload, timeout=min(900, self.settings["timeouts"]["turn_seconds"]))
            verdict = parse_verdict(result.content)
            if verdict is None:
                error = f"unparseable verdict (finish_reason={result.finish_reason})"
        except LlamaError as err:
            error = f"{err.kind}: {err.message}"
        finally:
            self.scheduler.release(lease)
            self._waiting.pop(mid, None)
        await self._event(mid, "REVIEW", {"turn": turn["number"], "kind": kind, "verdict": verdict,
                                          "error": error[:500]})
        return verdict

    async def _commit_analysis(self, mid: str, turn: dict, parsed, plan, decision) -> None:
        def fn(conn):
            cur = dbm.get_mission(conn, mid)
            t = dbm.get_turn(conn, turn["id"])
            if cur is None or cur["phase"] != Phase.ANALYZING or t is None or t.get("decision"):
                return False, []
            receipts = [dict(r) for r in plan.receipts]
            # Effects: memory, artifacts (with readback evidence), priority.
            for op in plan.memory_ops:
                if op["op"] == "SET":
                    dbm.set_memory(conn, mid, op["key"], op["value"], t["number"])
                else:
                    dbm.delete_memory(conn, mid, op["key"])
            art_receipts = iter([r for r in receipts if r["area"] == "artifact" and r["status"] == "APPLIED"])
            for op in plan.artifact_ops:
                existing = dbm.get_artifact(conn, mid, op["name"])
                content = (existing["content"] if existing and op["op"] == "APPEND" else "") + op["content"]
                digest = sha256_text(content)
                dbm.put_artifact(conn, mid, op["name"], content, digest, t["number"])
                stored = dbm.get_artifact(conn, mid, op["name"])
                r = next(art_receipts)
                r["size"] = stored["size"]
                r["sha256"] = stored["sha256"]
            fields: dict[str, Any] = {}
            if plan.priority:
                fields["priority"] = plan.priority
            counters = dict(decision.counters)
            if decision.output_fp:
                counters["last_output_fp"] = decision.output_fp
            if parsed.ok:
                counters["open_blockers"] = parsed.blockers[:10]
            notices = [receipt_line(r) for r in receipts] + list(decision.notices)
            parse_record = {
                "ok": parsed.ok, "mode": parsed.mode, "errors": parsed.errors, "status": parsed.status,
                "summary": parsed.summary, "next_step": parsed.next_step, "question": parsed.question,
                "blockers": parsed.blockers, "ignored_keys": parsed.ignored_keys,
                "output_chars": len(parsed.output), "output_tail": parsed.output[-4000:],
                "memory_ops": len(parsed.memory), "artifact_ops": len(parsed.artifacts),
                "control_ops": len(parsed.control),
            }
            decision_record = decision.as_dict()
            dbm.update_turn(conn, t["id"], parse=parse_record, decision=decision_record, receipts=receipts,
                            read_requests=plan.reads)
            next_objective = decision.next_objective
            question = ""
            pause_until = None
            pause_requested = cur["pause_requested"]
            if decision.action == Action.DONE:
                phase, reason = Phase.DONE, decision.reason
            elif decision.action == Action.NEEDS_OPERATOR:
                phase, reason = Phase.NEEDS_OPERATOR, decision.reason
                question = decision.question
                next_objective = RESUME_AFTER_OPERATOR + (
                    f" Your own last proposed step was: {decision.next_objective}" if decision.next_objective else "")
            elif decision.action == Action.PAUSE:
                phase, reason = Phase.PAUSED, f"{decision.pause_by}_PAUSE"
                if decision.pause_by == "MODEL":
                    pause_until = dbm.now() + decision.pause_seconds
                pause_requested = 0
            else:
                phase, reason = Phase.SENDING, decision.reason
            rotate = decision.rotate or ""
            if phase not in TERMINAL_PHASES:
                session = dbm.current_session(conn, mid)
                dbm.insert_turn(conn, {
                    "mission_id": mid, "session_id": session["id"], "number": dbm.next_turn_number(conn, mid),
                    "session_turn": session["turn_count"] + 1, "message_type": MessageType.CONTINUATION,
                    "objective": next_objective or t["objective"], "state": TurnState.PREPARED})
            self._set_phase(conn, cur, phase, reason, objective=next_objective, question=question,
                            counters=counters, notices=notices, pause_until=pause_until,
                            pause_requested=pause_requested, rotate_requested=rotate,
                            last_decision={"turn": t["number"], "action": decision.action,
                                           "reason": decision.reason, "rotate": rotate,
                                           "review": decision.review,
                                           "verdict": (decision.review_verdict or {}).get("verdict", "")},
                            **fields)
            evs = [dbm.add_event(conn, mid, "TURN_ANALYZED", {
                "turn": t["number"], "parse_mode": parsed.mode, "status": parsed.status,
                "action": decision.action, "reason": decision.reason, "rotate": rotate,
                "review": decision.review, "applied": plan.applied_count,
                "rejected": sum(1 for r in receipts if r["status"] in ("REJECTED", "INVALID"))})]
            if decision.action == Action.DONE:
                evs.append(dbm.add_event(conn, mid, "MISSION_DONE", {"turn": t["number"]}))
            elif decision.action == Action.NEEDS_OPERATOR:
                evs.append(dbm.add_event(conn, mid, "NEEDS_OPERATOR", {"reason": decision.reason}))
            return True, evs

        async with self._locks[mid]:
            ok, evs = await self.db.tx(fn)
        self._publish_events(evs)
        if ok:
            if plan.priority:
                self.scheduler.update_priority(mid, plan.priority)
            self.bus.publish({"type": "turn", "mission_id": mid, "turn": turn["number"]})
            await self._publish_mission(mid)

    # ------------------------------------------------------------------ operator API

    async def get_mission(self, mid: str) -> dict:
        m = await self.db.read(dbm.get_mission, mid)
        if m is None:
            raise EngineError("mission not found", 404)
        return m

    async def create_mission(self, *, title: str, goal: str, priority: str | None = None,
                             max_turns: int | None = None, start: bool = False,
                             template_id: str = "") -> dict:
        title = (title or "").strip()[:MAX_TITLE_CHARS]
        goal = (goal or "").strip()
        if not goal:
            raise EngineError("the mission text is empty", 400)
        if len(goal) > MAX_GOAL_CHARS:
            raise EngineError(f"the mission text is longer than {MAX_GOAL_CHARS} characters", 400)
        defaults = self.settings["missions"]
        prio = normalize_priority(priority, defaults["default_priority"])
        turns = int(max_turns) if max_turns else defaults["default_max_turns"]
        if not 1 <= turns <= 1_000_000:
            raise EngineError("max turns must be 1..1000000", 400)
        now = dbm.now()
        mission = {
            "id": uuid.uuid4().hex[:12], "title": title or goal.splitlines()[0][:80],
            "goal": goal, "goal_rev": 1, "priority": prio, "operator_priority": prio,
            "operator_edited_at": 0, "phase": Phase.DRAFT, "phase_reason": "", "max_turns": turns,
            "objective": START_OBJECTIVE, "notices": [], "counters": {}, "recovery": {},
            "last_decision": {}, "template_id": template_id or "", "created_at": now, "updated_at": now,
        }

        def fn(conn):
            dbm.insert_mission(conn, mission)
            return dbm.add_event(conn, mission["id"], "MISSION_CREATED", {"title": mission["title"]})

        ev = await self.db.tx(fn)
        self._publish_events([ev])
        if start:
            await self.start_mission(mission["id"])
        else:
            await self._publish_mission(mission["id"])
        return await self.get_mission(mission["id"])

    async def start_mission(self, mid: str) -> None:
        m = await self.get_mission(mid)
        if m["phase"] != Phase.DRAFT:
            raise EngineError("only a draft mission can be started; use Resume or Reopen")
        if not await self._transition(mid, {Phase.DRAFT}, Phase.ROTATING, "START", "MISSION_STARTED", {},
                                      rotate_requested=RotationReason.MISSION_START):
            raise EngineError("the mission changed state; reload")
        self._spawn(mid)

    async def update_mission(self, mid: str, *, title: str | None = None, goal: str | None = None,
                             priority: str | None = None, max_turns: int | None = None) -> dict:
        changes: dict[str, Any] = {}

        def fn(conn):
            m = dbm.get_mission(conn, mid)
            if m is None:
                raise EngineError("mission not found", 404)
            fields: dict[str, Any] = {}
            if title is not None:
                t = title.strip()[:MAX_TITLE_CHARS]
                if not t:
                    raise EngineError("the title is empty", 400)
                fields["title"] = t
            if goal is not None:
                g = goal.strip()
                if not g or len(g) > MAX_GOAL_CHARS:
                    raise EngineError("the mission text is empty or too long", 400)
                if g != m["goal"]:
                    fields["goal"] = g
                    fields["goal_rev"] = m["goal_rev"] + 1
            if priority is not None:
                p = str(priority).upper()
                if p not in PRIORITIES:
                    raise EngineError("unknown priority", 400)
                fields.update(priority=p, operator_priority=p, operator_edited_at=dbm.now())
            if max_turns is not None:
                if not isinstance(max_turns, int) or not 1 <= max_turns <= 1_000_000:
                    raise EngineError("max turns must be 1..1000000", 400)
                fields["max_turns"] = max_turns
            if fields:
                dbm.update_mission(conn, mid, **fields)
                changes.update(fields)
                return [dbm.add_event(conn, mid, "MISSION_UPDATED",
                                      {k: (v if k != "goal" else f"{len(v)} chars") for k, v in fields.items()})]
            return []

        async with self._locks[mid]:
            evs = await self.db.tx(fn)
        self._publish_events(evs)
        if "priority" in changes:
            self.scheduler.update_priority(mid, changes["priority"])
        await self._publish_mission(mid)
        return await self.get_mission(mid)

    async def pause_mission(self, mid: str) -> None:
        async with self._locks[mid]:
            m = await self.db.read(dbm.get_mission, mid)
            if m is None:
                raise EngineError("mission not found", 404)
            phase = m["phase"]
            if phase in (Phase.SENDING, Phase.RECOVERING) or (phase == Phase.PAUSED and m["pause_until"]):
                await self._cancel_runner(mid)

                def fn(conn):
                    cur = dbm.get_mission(conn, mid)
                    self._set_phase(conn, cur, Phase.PAUSED, "OPERATOR_PAUSE", pause_until=None,
                                    pause_requested=0, recovery={})
                    return [dbm.add_event(conn, mid, "PAUSED", {"by": "OPERATOR", "from": phase})]
                evs = await self.db.tx(fn)
            elif phase in (Phase.GENERATING, Phase.ANALYZING, Phase.ROTATING):
                def fn(conn):
                    dbm.update_mission(conn, mid, pause_requested=1)
                    return [dbm.add_event(conn, mid, "PAUSE_REQUESTED", {"at_phase": phase})]
                evs = await self.db.tx(fn)
            else:
                raise EngineError(f"a mission in {phase} cannot be paused")
        self._publish_events(evs)
        await self._publish_mission(mid)

    async def resume_mission(self, mid: str) -> None:
        async with self._locks[mid]:
            m = await self.db.read(dbm.get_mission, mid)
            if m is None:
                raise EngineError("mission not found", 404)
            phase = m["phase"]
            if phase == Phase.RECOVERING:
                def fn(conn):
                    rec = dict(m.get("recovery") or {})
                    rec["next_attempt_at"] = dbm.now()
                    dbm.update_mission(conn, mid, recovery=rec)
                    return [dbm.add_event(conn, mid, "RETRY_NOW", {"by": "OPERATOR"})]
            elif phase in (Phase.PAUSED, Phase.NEEDS_OPERATOR):
                def fn(conn):
                    cur = dbm.get_mission(conn, mid)
                    # Settings or instructions may have changed: render the unsent turn again.
                    self._reset_pending(conn, mid)
                    if dbm.pending_turn(conn, mid) is None:
                        session = dbm.current_session(conn, mid)
                        if session is None:
                            raise EngineError("the mission has no session; use Reopen")
                        dbm.insert_turn(conn, {
                            "mission_id": mid, "session_id": session["id"],
                            "number": dbm.next_turn_number(conn, mid),
                            "session_turn": session["turn_count"] + 1,
                            "message_type": MessageType.CONTINUATION,
                            "objective": cur["objective"] or RESUME_AFTER_OPERATOR, "state": TurnState.PREPARED})
                    self._set_phase(conn, cur, Phase.SENDING, "OPERATOR_RESUME", pause_until=None,
                                    pause_requested=0, question="", recovery={})
                    return [dbm.add_event(conn, mid, "RESUMED", {"by": "OPERATOR", "from": phase})]
            else:
                raise EngineError(f"a mission in {phase} cannot be resumed")
            evs = await self.db.tx(fn)
        self._publish_events(evs)
        self._wake[mid].set()
        self._spawn(mid)
        await self._publish_mission(mid)

    async def stop_mission(self, mid: str) -> None:
        async with self._locks[mid]:
            m = await self.db.read(dbm.get_mission, mid)
            if m is None:
                raise EngineError("mission not found", 404)
            if m["phase"] == Phase.STOPPED:
                return
            await self._cancel_runner(mid)

            def fn(conn):
                cur = dbm.get_mission(conn, mid)
                pending = dbm.pending_turn(conn, mid)
                if pending is not None:
                    conn.execute("UPDATE instructions SET consumed_turn=NULL WHERE mission_id=? AND consumed_turn=?",
                                 (mid, pending["number"]))
                    dbm.update_turn(conn, pending["id"], state=TurnState.ABANDONED, error="OPERATOR_STOP")
                self._set_phase(conn, cur, Phase.STOPPED, "OPERATOR_STOP", pause_until=None, pause_requested=0,
                                rotate_requested="", recovery={})
                return [dbm.add_event(conn, mid, "STOPPED", {"by": "OPERATOR", "from": m["phase"]})]
            evs = await self.db.tx(fn)
        self._live.pop(mid, None)
        self._publish_events(evs)
        await self._publish_mission(mid)

    async def rotate_mission(self, mid: str) -> None:
        async with self._locks[mid]:
            m = await self.db.read(dbm.get_mission, mid)
            if m is None:
                raise EngineError("mission not found", 404)
            if m["phase"] in (Phase.DRAFT, Phase.DONE, Phase.STOPPED):
                raise EngineError(f"a mission in {m['phase']} has no session to rotate")

            def fn(conn):
                dbm.update_mission(conn, mid, rotate_requested=RotationReason.OPERATOR)
                return [dbm.add_event(conn, mid, "ROTATION_REQUESTED", {"by": "OPERATOR"})]
            evs = await self.db.tx(fn)
        self._publish_events(evs)
        await self._publish_mission(mid)

    async def reopen_mission(self, mid: str, instruction: str) -> None:
        text = (instruction or "").strip()
        if not text:
            raise EngineError("reopening needs an instruction for the model", 400)
        if len(text) > MAX_INSTRUCTION_CHARS:
            raise EngineError("the instruction is too long", 400)
        async with self._locks[mid]:
            m = await self.db.read(dbm.get_mission, mid)
            if m is None:
                raise EngineError("mission not found", 404)
            if m["phase"] not in (Phase.DONE, Phase.STOPPED):
                raise EngineError("only a finished or stopped mission can be reopened")
            first_start = m["session_seq"] == 0

            def fn(conn):
                cur = dbm.get_mission(conn, mid)
                dbm.add_instruction(conn, mid, text)
                if dbm.pending_turn(conn, mid) is None and not first_start:
                    session = dbm.current_session(conn, mid)
                    dbm.insert_turn(conn, {
                        "mission_id": mid, "session_id": session["id"], "number": dbm.next_turn_number(conn, mid),
                        "session_turn": session["turn_count"] + 1, "message_type": MessageType.CONTINUATION,
                        "objective": RESUME_AFTER_OPERATOR, "state": TurnState.PREPARED})
                self._set_phase(conn, cur, Phase.ROTATING, "OPERATOR_REOPEN", completed_at=None, question="",
                                rotate_requested=(RotationReason.MISSION_START if first_start
                                                  else RotationReason.OPERATOR_REOPEN),
                                objective=RESUME_AFTER_OPERATOR if not first_start else cur["objective"])
                return [dbm.add_event(conn, mid, "REOPENED", {"by": "OPERATOR", "from": m["phase"]})]
            evs = await self.db.tx(fn)
        self._publish_events(evs)
        self._spawn(mid)
        await self._publish_mission(mid)

    async def add_instruction(self, mid: str, text: str, *, resume: bool = False) -> int:
        text = (text or "").strip()
        if not text:
            raise EngineError("the instruction is empty", 400)
        if len(text) > MAX_INSTRUCTION_CHARS:
            raise EngineError(f"the instruction is longer than {MAX_INSTRUCTION_CHARS} characters", 400)

        def fn(conn):
            m = dbm.get_mission(conn, mid)
            if m is None:
                raise EngineError("mission not found", 404)
            if m["phase"] in (Phase.DONE, Phase.STOPPED):
                raise EngineError("the mission is finished; use Reopen with the instruction")
            iid = dbm.add_instruction(conn, mid, text)
            return iid, m["phase"], [dbm.add_event(conn, mid, "INSTRUCTION_ADDED", {"id": iid, "chars": len(text)})]

        async with self._locks[mid]:
            iid, phase, evs = await self.db.tx(fn)
        self._publish_events(evs)
        if resume and phase in (Phase.PAUSED, Phase.NEEDS_OPERATOR):
            await self.resume_mission(mid)
        else:
            await self._publish_mission(mid)
        return iid

    async def delete_instruction(self, mid: str, instruction_id: int) -> None:
        async with self._locks[mid]:
            ok = await self.db.tx(dbm.delete_pending_instruction, mid, instruction_id)
        if not ok:
            raise EngineError("the instruction was already sent or does not exist")
        await self._event(mid, "INSTRUCTION_DELETED", {"id": instruction_id})

    async def delete_mission(self, mid: str) -> None:
        async with self._locks[mid]:
            m = await self.db.read(dbm.get_mission, mid)
            if m is None:
                raise EngineError("mission not found", 404)
            if m["phase"] not in (Phase.DRAFT, Phase.DONE, Phase.STOPPED):
                raise EngineError("stop the mission before deleting it")
            await self.db.tx(dbm.delete_mission, mid)
        self._locks.pop(mid, None)
        self._wake.pop(mid, None)
        self.bus.publish({"type": "mission_deleted", "mission_id": mid})

    async def update_settings(self, patch: dict) -> dict:
        valid = validate_runtime_patch(patch)
        await self.db.tx(dbm.put_settings, valid)
        overrides = await self.db.read(dbm.get_settings)
        self.settings = merge_runtime(self.config.runtime_defaults, validate_runtime_patch(overrides))
        self._apply_settings()
        self.monitor.kick()
        await self._event("", "SETTINGS_UPDATED", {"changed": {s: list(v) for s, v in valid.items()}})
        self.bus.publish({"type": "settings", "settings": self.settings})
        self.bus.publish({"type": "llama", "llama": self.llama_state()})
        return self.settings

    async def reset_settings(self) -> dict:
        await self.db.tx(dbm.reset_settings)
        self.settings = merge_runtime(self.config.runtime_defaults, {})
        self._apply_settings()
        await self._event("", "SETTINGS_RESET", {})
        self.bus.publish({"type": "settings", "settings": self.settings})
        return self.settings

    def live(self, mid: str) -> dict | None:
        live = self._live.get(mid)
        return dict(live) if live else None

    async def status(self) -> dict:
        missions = await self.db.read(dbm.list_missions)
        phases: dict[str, int] = {}
        for m in missions:
            phases[m["phase"]] = phases.get(m["phase"], 0) + 1
        return {"version": APP_VERSION, "llama": self.llama_state(), "scheduler": self.scheduler.snapshot(),
                "phases": phases, "runners": len(self._runners),
                "estimator_chars_per_token": round(self.estimator.ratio, 3)}
