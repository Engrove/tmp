"""HTTP API: authentication, CSRF guard, mission lifecycle over HTTP, SSE stream."""

from __future__ import annotations

import asyncio
import json

from aiohttp.test_utils import TestClient, TestServer

from greensea.config import AppConfig, LlamaConfig, ServerConfig, merge_runtime, runtime_defaults
from greensea.web import build_app

from fake_llama import FakeLlama, worker_reply
from harness import run

H = {"X-GreenSea": "1"}


async def make_client(tmp_path, *, token: str = "", fake: FakeLlama | None = None):
    fake = fake or FakeLlama()
    llama_server = TestServer(fake.app())
    await llama_server.start_server()
    runtime = runtime_defaults()
    runtime["timeouts"]["health_interval_seconds"] = 2
    runtime["reviewer"]["mode"] = "off"
    config = AppConfig(server=ServerConfig(data_dir=str(tmp_path), auth_token=token),
                       llama=LlamaConfig(base_url=str(llama_server.make_url("")).rstrip("/")),
                       runtime_defaults=runtime)
    client = TestClient(TestServer(build_app(config)))
    await client.start_server()
    return client, llama_server, fake


async def wait_phase(client, mid, phase, headers=None, timeout=15):
    loop = asyncio.get_running_loop()
    deadline = loop.time() + timeout
    while True:
        r = await client.get(f"/api/missions/{mid}", headers=headers or {})
        data = await r.json()
        if data["mission"]["phase"] == phase:
            return data
        if loop.time() > deadline:
            raise AssertionError(f"stuck in {data['mission']['phase']}")
        await asyncio.sleep(0.05)


def test_auth_and_csrf(tmp_path):
    async def main():
        client, llama_server, _ = await make_client(tmp_path, token="s3cret-token")
        try:
            r = await client.get("/api/session")
            assert (await r.json()) == {"app": "GreenSea", "version": "0.1.0", "auth_required": True,
                                        "authenticated": False}
            assert (await client.get("/api/missions")).status == 401
            # Mutations without the CSRF header are refused before auth is even considered.
            assert (await client.post("/api/login", json={"token": "s3cret-token"})).status == 403
            assert (await client.post("/api/login", json={"token": "wrong"}, headers=H)).status == 401
            r = await client.post("/api/login", json={"token": "s3cret-token"}, headers=H)
            assert r.status == 200
            cookie = r.cookies["greensea_session"]
            assert cookie.value != "s3cret-token" and cookie["httponly"] and cookie["samesite"] == "Strict"
            assert (await client.get("/api/missions")).status == 200
            # Bearer token works for scripts.
            client.session.cookie_jar.clear()
            r = await client.get("/api/missions", headers={"Authorization": "Bearer s3cret-token"})
            assert r.status == 200
            r = await client.get("/")
            assert r.status == 200
            assert "script-src 'self'" in r.headers["Content-Security-Policy"]
        finally:
            await client.close()
            await llama_server.close()

    run(main())


def test_mission_lifecycle_over_http(tmp_path):
    async def main():
        fake = FakeLlama()
        replies = iter([
            worker_reply(status="BLOCKED", summary="need a decision", question="Which format, A or B?",
                         next_step="write in chosen format"),
            worker_reply(status="DONE", summary="wrote it in B",
                         artifacts=[{"op": "WRITE", "name": "out.txt", "content": "<b>B</b>"}]),
        ])
        fake.responder = lambda body: next(replies)
        client, llama_server, _ = await make_client(tmp_path, fake=fake)
        try:
            assert (await client.post("/api/missions", json={"goal": "x"})).status == 403
            r = await client.post("/api/missions", json={"title": "Format", "goal": "Skriv ut.", "start": True},
                                  headers=H)
            assert r.status == 201
            mid = (await r.json())["mission"]["id"]
            data = await wait_phase(client, mid, "NEEDS_OPERATOR")
            assert data["mission"]["question"] == "Which format, A or B?"
            assert data["pending_turn"]["objective"].startswith("Continue the mission.")
            r = await client.post(f"/api/missions/{mid}/instructions", json={"text": "Use B.", "resume": True},
                                  headers=H)
            assert r.status == 201
            await wait_phase(client, mid, "DONE")
            r = await client.get(f"/api/missions/{mid}/turns/2")
            turn = (await r.json())["turn"]
            assert "OPERATOR INSTRUCTION" in turn["user_content"] and "Use B." in turn["user_content"]
            r = await client.get(f"/api/missions/{mid}/artifacts/out.txt?download=1")
            assert r.status == 200 and r.headers["Content-Type"].startswith("text/plain")
            assert await r.text() == "<b>B</b>"
            assert "attachment" in r.headers["Content-Disposition"]
            r = await client.get(f"/api/missions/{mid}/export")
            export = json.loads(await r.text())
            assert export["schema"] == "greensea.mission-export.v1" and len(export["turns"]) == 2
            # Operator actions are validated against the phase.
            r = await client.post(f"/api/missions/{mid}/pause", headers=H)
            assert r.status == 409
            r = await client.post(f"/api/missions/{mid}/reopen", json={"instruction": ""}, headers=H)
            assert r.status == 400
            r = await client.delete(f"/api/missions/{mid}", headers=H)
            assert r.status == 200
            assert (await client.get(f"/api/missions/{mid}")).status == 404
        finally:
            await client.close()
            await llama_server.close()

    run(main())


def test_settings_validation_and_templates(tmp_path):
    async def main():
        client, llama_server, _ = await make_client(tmp_path)
        try:
            r = await client.put("/api/settings", json={"context": {"rotate_at": 2}}, headers=H)
            assert r.status == 400
            r = await client.put("/api/settings", json={"nope": {}}, headers=H)
            assert r.status == 400
            r = await client.put("/api/settings", json={"context": {"rotate_at": 0.5},
                                                         "reviewer": {"mode": "every_turn"}}, headers=H)
            assert r.status == 200
            s = (await r.json())["settings"]
            assert s["context"]["rotate_at"] == 0.5 and s["reviewer"]["mode"] == "every_turn"
            r = await client.post("/api/settings/reset", headers=H)
            assert (await r.json())["settings"]["context"]["rotate_at"] == 0.75
            r = await client.post("/api/templates", json={"label": "Daglig", "goal": "Gör X.", "priority": "HIGH"},
                                  headers=H)
            tid = (await r.json())["template"]["id"]
            r = await client.put(f"/api/templates/{tid}", json={"label": "Daglig 2", "goal": "Gör Y."}, headers=H)
            assert (await r.json())["template"]["goal"] == "Gör Y."
            assert len((await (await client.get("/api/templates")).json())["templates"]) == 1
            assert (await client.delete(f"/api/templates/{tid}", headers=H)).status == 200
        finally:
            await client.close()
            await llama_server.close()

    run(main())


def test_sse_stream_delivers_mission_updates_and_token_deltas(tmp_path):
    async def main():
        fake = FakeLlama()
        fake.responder = lambda body: worker_reply(status="DONE", summary="streamed answer",
                                                   output="hello from the model " * 5)
        client, llama_server, _ = await make_client(tmp_path, fake=fake)
        try:
            r = await client.post("/api/missions", json={"title": "S", "goal": "Mål."}, headers=H)
            mid = (await r.json())["mission"]["id"]
            resp = await client.get(f"/api/stream?mission={mid}")
            assert resp.headers["Content-Type"] == "text/event-stream"
            seen: list[dict] = []

            async def reader():
                async for raw in resp.content:
                    line = raw.decode().strip()
                    if line.startswith("data: "):
                        msg = json.loads(line[6:])
                        seen.append(msg)
                        if msg.get("type") == "mission" and msg["mission"]["phase"] == "DONE":
                            return

            task = asyncio.create_task(reader())
            await asyncio.sleep(0.2)
            await client.post(f"/api/missions/{mid}/start", headers=H)
            await asyncio.wait_for(task, 15)
            types = {m["type"] for m in seen}
            assert {"hello", "mission", "delta", "event", "turn"} <= types
            text = "".join(m["content"] for m in seen if m["type"] == "delta")
            assert "hello from the model" in text
            resp.close()
        finally:
            await client.close()
            await llama_server.close()

    run(main())
