"""Engine: operator actions, reviewer, capacity, artifact reads, mission edits."""

from __future__ import annotations

import asyncio
import json
import time

from greensea import db as dbm
from greensea.contracts import Phase, TurnState

from fake_llama import Reply, last_user, worker_reply
from harness import Harness, run


def test_pause_during_generation_waits_for_turn_then_resume_continues(tmp_path):
    async def main():
        calls = {"n": 0}

        def responder(body):
            calls["n"] += 1
            if calls["n"] == 1:
                return Reply(content=worker_reply(summary="first", output="o1", next_step="second").content,
                             delay_s=1.0)
            return worker_reply(status="DONE", summary="second done", output="o2")

        async with Harness(tmp_path) as h:
            h.fake.responder = responder
            m = await h.engine.create_mission(title="P", goal="Mål.", start=True)
            await h.wait_phase(m["id"], Phase.GENERATING)
            await h.engine.pause_mission(m["id"])
            assert (await h.mission(m["id"]))["pause_requested"] == 1
            paused = await h.wait_phase(m["id"], Phase.PAUSED)
            assert paused["turn_count"] == 1, "the in-flight turn is never interrupted"
            assert paused["phase_reason"] == "OPERATOR_PAUSE" and paused["pause_until"] is None
            await asyncio.sleep(0.3)
            assert calls["n"] == 1, "nothing is sent while paused"
            await h.engine.resume_mission(m["id"])
            await h.wait_phase(m["id"], Phase.DONE)

    run(main())


def test_stop_aborts_generation_and_reopen_continues_in_new_session(tmp_path):
    async def main():
        calls = {"n": 0}

        def responder(body):
            calls["n"] += 1
            if calls["n"] == 1:
                return Reply(content=worker_reply().content, delay_s=30)
            return worker_reply(status="DONE", summary="did what the operator said")

        async with Harness(tmp_path) as h:
            h.fake.responder = responder
            m = await h.engine.create_mission(title="S", goal="Mål.", start=True)
            await h.wait_phase(m["id"], Phase.GENERATING)
            await h.engine.stop_mission(m["id"])
            stopped = await h.mission(m["id"])
            assert stopped["phase"] == Phase.STOPPED
            turns = await h.turns(m["id"])
            assert turns[0]["state"] == TurnState.ABANDONED
            async def stream_closed():
                return h.fake.active == 0
            await h.wait_for(stream_closed, what="the aborted llama stream to close")
            await h.engine.reopen_mission(m["id"], "Skriv slutsatsen nu.")
            await h.wait_phase(m["id"], Phase.DONE)
            sessions = await h.database.read(dbm.list_sessions, m["id"])
            assert [s["reason"] for s in sessions] == ["MISSION_START", "OPERATOR_REOPEN"]
            assert "Skriv slutsatsen nu." in last_user(h.fake.requests[-1])
            assert "NEW SESSION (reason: OPERATOR_REOPEN)" in last_user(h.fake.requests[-1])

    run(main())


def test_instruction_is_delivered_exactly_once(tmp_path):
    async def main():
        calls = {"n": 0}

        def responder(body):
            calls["n"] += 1
            if calls["n"] == 1:
                return Reply(content=worker_reply(next_step="two", output="a").content, delay_s=0.6)
            if calls["n"] < 4:
                return worker_reply(next_step=f"step {calls['n'] + 1}", output=f"o{calls['n']}")
            return worker_reply(status="DONE", summary="end")

        async with Harness(tmp_path) as h:
            h.fake.responder = responder
            m = await h.engine.create_mission(title="I", goal="Mål.", start=True)
            await h.wait_phase(m["id"], Phase.GENERATING)
            await h.engine.add_instruction(m["id"], "Byt språk till engelska.")
            await h.wait_phase(m["id"], Phase.DONE)
            hits = [i for i, r in enumerate(h.fake.requests) if "Byt språk till engelska." in last_user(r)]
            assert hits == [1], hits
            rows = await h.database.read(dbm.list_instructions, m["id"])
            assert rows[0]["consumed_turn"] == 2

    run(main())


def test_reviewer_rejects_false_done_then_accepts(tmp_path):
    async def main():
        work = iter([
            worker_reply(status="DONE", summary="claims done too early"),
            worker_reply(status="DONE", summary="now really done",
                         artifacts=[{"op": "WRITE", "name": "result.md", "content": "complete"}]),
        ])
        verdicts = iter([
            Reply(content=json.dumps({"reason": "no deliverable exists", "verdict": "REJECT",
                                      "nextStep": "write result.md"})),
            Reply(content=json.dumps({"reason": "result.md present", "verdict": "ACCEPT", "nextStep": ""})),
        ])
        async with Harness(tmp_path, runtime={"reviewer": {"mode": "terminal"}}) as h:
            h.fake.responder = lambda body: next(work)
            h.fake.reviewer = lambda body: next(verdicts)
            m = await h.engine.create_mission(title="R", goal="Leverera result.md.", start=True)
            done = await h.wait_phase(m["id"], Phase.DONE)
            assert done["turn_count"] == 2
            turns = await h.turns(m["id"])
            assert turns[0]["decision"]["reason"] == "REVIEW_REJECTED_DONE"
            assert turns[1]["objective"] == "write result.md"
            assert "not accepted by the reviewer: no deliverable exists" in turns[1]["user_content"]
            reviews = [r for r in h.fake.requests if "greensea_review_v1" in json.dumps(r.get("response_format"))]
            assert len(reviews) == 2 and not reviews[0].get("stream")

    run(main())


def test_capacity_limits_parallel_requests_across_missions(tmp_path):
    async def main():
        def responder(body):
            return Reply(content=worker_reply(status="DONE", summary="ok").content, delay_s=0.3)

        async with Harness(tmp_path, runtime={"scheduler": {"max_parallel": 1}}) as h:
            h.fake.responder = responder
            ids = []
            for i in range(3):
                m = await h.engine.create_mission(title=f"M{i}", goal="Mål.", start=True)
                ids.append(m["id"])
            for mid in ids:
                await h.wait_phase(mid, Phase.DONE)
            assert h.fake.max_active == 1

    run(main())


def test_read_artifact_content_arrives_in_next_message(tmp_path):
    async def main():
        script = iter([
            worker_reply(artifacts=[{"op": "WRITE", "name": "notes.md", "content": "ABCDEFGHIJ" * 100}],
                         control=[{"op": "READ_ARTIFACT", "name": "notes.md", "offset": 990}], output="w"),
            worker_reply(status="DONE", summary="read it"),
        ])
        async with Harness(tmp_path) as h:
            h.fake.responder = lambda body: next(script)
            m = await h.engine.create_mission(title="A", goal="Mål.", start=True)
            await h.wait_phase(m["id"], Phase.DONE)
            msg = last_user(h.fake.requests[1])
            assert "ARTIFACT CONTENT notes.md characters 990..1000 of 1000 (end)" in msg
            assert "ABCDEFGHIJ" in msg

    run(main())


def test_goal_edit_rotates_and_model_pause_is_timed(tmp_path):
    async def main():
        calls = {"n": 0}

        def responder(body):
            calls["n"] += 1
            if calls["n"] == 1:
                return Reply(content=worker_reply(output="x", next_step="continue").content, delay_s=0.5)
            if calls["n"] == 2:
                return worker_reply(output="y", control=[{"op": "PAUSE", "seconds": 600}], next_step="after pause")
            return worker_reply(status="DONE", summary="z")

        async with Harness(tmp_path) as h:
            h.fake.responder = responder
            m = await h.engine.create_mission(title="G", goal="Gammalt mål.", start=True)
            await h.wait_phase(m["id"], Phase.GENERATING)
            await h.engine.update_mission(m["id"], goal="Nytt mål.")
            paused = await h.wait_phase(m["id"], Phase.PAUSED)
            assert paused["phase_reason"] == "MODEL_PAUSE"
            assert 590 < paused["pause_until"] - time.time() <= 600
            sessions = await h.database.read(dbm.list_sessions, m["id"])
            assert [s["reason"] for s in sessions] == ["MISSION_START", "MISSION_UPDATED"]
            assert "Nytt mål." in h.fake.requests[1]["messages"][0]["content"]
            await h.engine.resume_mission(m["id"])
            await h.wait_phase(m["id"], Phase.DONE)

    run(main())


def test_llama_down_waits_without_burning_retries(tmp_path):
    async def main():
        async with Harness(tmp_path) as h:
            h.fake.healthy = False
            await h.engine.monitor.check_once()
            h.fake.responder = lambda body: worker_reply(status="DONE", summary="ok")
            m = await h.engine.create_mission(title="D", goal="Mål.", start=True)
            await asyncio.sleep(0.5)
            cur = await h.mission(m["id"])
            assert cur["phase"] in (Phase.ROTATING, Phase.SENDING) and not h.fake.requests
            h.fake.healthy = True
            h.engine.monitor.kick()
            await h.wait_phase(m["id"], Phase.DONE)
            assert (await h.mission(m["id"]))["recovery"] == {}

    run(main())
