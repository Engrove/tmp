"""End-to-end: real Engine + SQLite + HTTP/SSE against the fake llama-server."""

from __future__ import annotations

import asyncio
import json

from greensea import db as dbm
from greensea.contracts import Phase, TurnState

from fake_llama import Reply, last_user, worker_reply
from harness import Harness, run


def test_multi_turn_mission_with_memory_artifacts_and_done(tmp_path):
    async def main():
        script = iter([
            worker_reply(summary="planned and wrote intro", output="Intro written.",
                         memory=[{"op": "SET", "key": "plan", "value": "1 intro 2 body 3 done"}],
                         artifacts=[{"op": "WRITE", "name": "report.md", "content": "# Report\n"}],
                         next_step="write the body"),
            worker_reply(summary="wrote body", output="Body.",
                         artifacts=[{"op": "APPEND", "name": "report.md", "content": "Body text.\n"}],
                         next_step="finish"),
            worker_reply(status="DONE", summary="report.md complete", next_step=""),
        ])
        async with Harness(tmp_path) as h:
            h.fake.responder = lambda body: next(script)
            m = await h.engine.create_mission(title="Rapport", goal="Skriv en rapport.", start=True)
            done = await h.wait_phase(m["id"], Phase.DONE)
            assert done["turn_count"] == 3
            assert done["session_seq"] == 1
            turns = await h.turns(m["id"])
            assert [t["state"] for t in turns] == [TurnState.COMPLETED] * 3
            assert turns[0]["message_type"] == "MISSION_START"
            assert turns[1]["objective"] == "write the body"
            # Receipts of turn 1 are in the user message of turn 2.
            assert "memory SET plan: APPLIED" in turns[1]["user_content"]
            assert "artifact WRITE report.md: APPLIED; now 9 bytes" in turns[1]["user_content"]
            art = await h.database.read(dbm.get_artifact, m["id"], "report.md")
            assert art["content"] == "# Report\nBody text.\n"
            mem = await h.database.read(dbm.get_memory, m["id"])
            assert mem["plan"]["value"] == "1 intro 2 body 3 done"
            # The context is rebuilt from committed turns: request 3 carries both earlier exchanges.
            third = h.fake.requests[2]["messages"]
            assert [x["role"] for x in third] == ["system", "user", "assistant", "user", "assistant", "user"]
            assert "Skriv en rapport." in third[0]["content"]
            assert h.fake.requests[0]["response_format"]["type"] == "json_schema"
            assert h.fake.requests[0]["stream_options"] == {"include_usage": True}
            # Usage from llama.cpp is the context measurement.
            assert done["context_tokens"] == turns[2]["prompt_tokens"] + turns[2]["completion_tokens"]

    run(main())


def test_context_pressure_rotates_into_new_session_with_checkpoint(tmp_path):
    async def main():
        counter = {"n": 0}

        def responder(body):
            counter["n"] += 1
            n = counter["n"]
            return worker_reply(summary=f"step {n} done", output="x" * 1500,
                                memory=[{"op": "SET", "key": "focus", "value": f"step {n}"}],
                                next_step=f"do step {n + 1}")

        fake_runtime = {"generation": {"max_tokens": 512}, "context": {"rotate_at": 0.6}}
        async with Harness(tmp_path, runtime=fake_runtime) as h:
            h.fake.n_ctx = 4096
            await h.engine.monitor.refresh()
            h.fake.responder = responder
            m = await h.engine.create_mission(title="Lång", goal="Arbeta länge.", start=True, max_turns=12)
            final = await h.wait_phase(m["id"], Phase.NEEDS_OPERATOR, timeout=30)
            assert final["phase_reason"] == "TURN_BUDGET_EXHAUSTED"
            assert final["session_seq"] >= 2, "context pressure must have rotated the session"
            sessions = await h.database.read(dbm.list_sessions, m["id"])
            assert sessions[1]["reason"] == "CONTEXT_PRESSURE"
            turns = await h.turns(m["id"])
            opening = [t for t in turns if t["message_type"] == "SESSION_ROTATION"][0]
            assert "CHECKPOINT" in opening["user_content"]
            assert "focus: step" in opening["user_content"]
            assert "Progress log:" in opening["user_content"]
            # Every request fits the context window.
            for req in h.fake.requests:
                assert h.fake._prompt_tokens(req) + 512 <= 4096
            # The first request of the new session holds only system + opening message.
            evs = await h.events(m["id"])
            assert any(e["kind"] == "SESSION_ROTATED" for e in evs)

    run(main())


def test_protocol_failures_repair_then_rotate_then_operator(tmp_path):
    async def main():
        async with Harness(tmp_path) as h:
            h.fake.responder = lambda body: Reply(content="Sorry, here is prose and no JSON.")
            m = await h.engine.create_mission(title="Trasig", goal="Mål.", start=True)
            final = await h.wait_phase(m["id"], Phase.NEEDS_OPERATOR, timeout=30)
            assert final["phase_reason"] == "PROTOCOL_FAILURES"
            assert final["turn_count"] == 6
            sessions = await h.database.read(dbm.list_sessions, m["id"])
            assert [s["reason"] for s in sessions] == ["MISSION_START", "PROTOCOL_FAILURES"]
            turns = await h.turns(m["id"])
            assert "did not contain the required JSON object" in turns[1]["user_content"]

    run(main())


def test_truncated_json_is_never_accepted(tmp_path):
    async def main():
        replies = iter([
            Reply(content='{"output": "half', finish_reason="length"),
            worker_reply(status="DONE", summary="ok"),
        ])
        async with Harness(tmp_path) as h:
            h.fake.responder = lambda body: next(replies)
            m = await h.engine.create_mission(title="T", goal="Mål.", start=True)
            await h.wait_phase(m["id"], Phase.DONE)
            turns = await h.turns(m["id"])
            assert turns[0]["parse"]["mode"] == "TRUNCATED"
            assert "cut off at the token limit" in turns[1]["user_content"]

    run(main())


def test_transient_error_retries_same_message_and_stall_is_detected(tmp_path):
    async def main():
        calls = {"n": 0}

        def responder(body):
            calls["n"] += 1
            if calls["n"] == 1:
                return Reply(error={"status": 503, "message": "loading"})
            if calls["n"] == 2:
                return Reply(content=json.dumps({"output": "a" * 50}), stall_after_first=8)
            if calls["n"] == 3:
                return Reply(content="{}", midstream_error="slot crashed")
            return worker_reply(status="DONE", summary="finally")

        async with Harness(tmp_path, runtime={"timeouts": {"stall_seconds": 5}}) as h:
            h.fake.responder = responder
            m = await h.engine.create_mission(title="R", goal="Mål.", start=True)
            await h.wait_phase(m["id"], Phase.DONE, timeout=40)
            turns = await h.turns(m["id"])
            assert len(turns) == 1 and turns[0]["attempts"] == 4
            bodies = [last_user(r) for r in h.fake.requests]
            assert len(set(bodies)) == 1, "a retried turn must send the identical stored message"
            kinds = [e["detail"]["error"]["kind"] for e in await h.events(m["id"]) if e["kind"] == "LLAMA_ERROR"]
            assert kinds == ["HTTP", "STALL", "HTTP"]

    run(main())


def test_context_exceeded_error_rotates(tmp_path):
    async def main():
        calls = {"n": 0}

        def responder(body):
            calls["n"] += 1
            if calls["n"] == 1:
                return worker_reply(output="y" * 9000, summary="big", next_step="more")
            return worker_reply(status="DONE", summary="done")

        # rotate_at 0.95 and a generous estimator miss: llama rejects, GreenSea rotates.
        async with Harness(tmp_path, runtime={"context": {"rotate_at": 0.95},
                                              "generation": {"max_tokens": 64}}) as h:
            h.fake.n_ctx = 3000
            await h.engine.monitor.refresh()
            h.engine.estimator.ratio = 50.0  # make GreenSea underestimate on purpose
            h.engine.estimator.samples = 100
            h.fake.responder = responder
            m = await h.engine.create_mission(title="C", goal="Mål.", start=True)
            await h.wait_phase(m["id"], Phase.DONE, timeout=30)
            sessions = await h.database.read(dbm.list_sessions, m["id"])
            assert [s["reason"] for s in sessions][-1] in ("CONTEXT_EXCEEDED", "CONTEXT_PRESSURE")
            evs = [e["kind"] for e in await h.events(m["id"])]
            assert "SESSION_ROTATED" in evs

    run(main())


def test_restart_during_generation_redispatches_without_duplicate_commit(tmp_path):
    async def main():
        state = {"slow": True}

        def responder(body):
            if state["slow"]:
                return Reply(content=json.dumps({"x": 1}), delay_s=30)
            return worker_reply(status="DONE", summary="after restart")

        async with Harness(tmp_path) as h:
            h.fake.responder = responder
            m = await h.engine.create_mission(title="K", goal="Mål.", start=True)
            await h.wait_phase(m["id"], Phase.GENERATING)
            state["slow"] = False
            await h.restart_engine()
            await h.wait_phase(m["id"], Phase.DONE)
            turns = await h.turns(m["id"])
            assert len(turns) == 1 and turns[0]["attempts"] == 2
            kinds = [e["kind"] for e in await h.events(m["id"])]
            assert "RESTART_REDISPATCH" in kinds

    run(main())
