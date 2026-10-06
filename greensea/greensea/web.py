"""HTTP API, Server-Sent Events and the static web interface.

Security model:
  * default bind 127.0.0.1; with server.auth_token set, every /api route except
    /api/session and /api/login needs either the session cookie (HttpOnly,
    SameSite=Strict, derived from the token by HMAC, never the token itself) or
    "Authorization: Bearer <token>";
  * every state-changing request must carry the header "X-GreenSea: 1". Browsers
    cannot add custom headers cross-origin without a CORS preflight, which this
    server never grants, so a foreign page cannot drive the API (CSRF);
  * strict Content-Security-Policy: only same-origin scripts and styles, no inline code;
  * model output is only ever inserted as text by the interface, never as HTML.
"""

from __future__ import annotations

import asyncio
import hashlib
import hmac
import json
import logging
import time
import uuid
from pathlib import Path
from typing import Any

from aiohttp import web

from . import APP_NAME, APP_VERSION
from . import db as dbm
from .bus import EventBus
from .config import RUNTIME_SPEC, AppConfig, SettingsError
from .contracts import MAX_GOAL_CHARS, MAX_TITLE_CHARS, PRIORITIES
from .engine import Engine, EngineError
from .llama import LlamaClient

log = logging.getLogger("greensea.web")

STATIC_DIR = Path(__file__).parent / "static"
COOKIE = "greensea_session"
CSRF_HEADER = "X-GreenSea"
SSE_PING_S = 15.0
MAX_BODY = 2 * 1024 * 1024

ENGINE_KEY = web.AppKey("engine", Engine)
CONFIG_KEY = web.AppKey("config", AppConfig)
BUS_KEY = web.AppKey("bus", EventBus)
DB_KEY = web.AppKey("db", dbm.Database)
LLAMA_KEY = web.AppKey("llama", LlamaClient)

SECURITY_HEADERS = {
    "Content-Security-Policy": ("default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; "
                                "connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"),
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "X-Frame-Options": "DENY",
}


def session_value(token: str) -> str:
    return hmac.new(token.encode("utf-8"), b"greensea-session-v1", hashlib.sha256).hexdigest()


def is_authenticated(request: web.Request) -> bool:
    token = request.app[CONFIG_KEY].server.auth_token
    if not token:
        return True
    auth = request.headers.get("Authorization", "")
    if auth.startswith("Bearer ") and hmac.compare_digest(auth[7:].strip(), token):
        return True
    cookie = request.cookies.get(COOKIE, "")
    return bool(cookie) and hmac.compare_digest(cookie, session_value(token))


def json_error(message: str, status: int) -> web.Response:
    return web.json_response({"error": message}, status=status)


@web.middleware
async def guard(request: web.Request, handler):
    path = request.path
    if path.startswith("/api/"):
        if request.method not in ("GET", "HEAD", "OPTIONS") and request.headers.get(CSRF_HEADER) != "1":
            return json_error(f"missing {CSRF_HEADER} header", 403)
        if path not in ("/api/session", "/api/login") and not is_authenticated(request):
            return json_error("login required", 401)
    try:
        response = await handler(request)
    except EngineError as exc:
        response = json_error(str(exc), exc.status)
    except SettingsError as exc:
        response = json_error(str(exc), 400)
    except json.JSONDecodeError:
        response = json_error("invalid JSON body", 400)
    if not response.prepared:  # the SSE stream has sent its headers already
        for k, v in SECURITY_HEADERS.items():
            response.headers.setdefault(k, v)
        if path.startswith("/api/"):
            response.headers.setdefault("Cache-Control", "no-store")
    return response


async def body_json(request: web.Request) -> dict:
    if not request.can_read_body:
        return {}
    data = await request.json()
    if not isinstance(data, dict):
        raise EngineError("the request body must be a JSON object", 400)
    return data


def engine_of(request: web.Request) -> Engine:
    return request.app[ENGINE_KEY]


# ---------------------------------------------------------------- session

async def get_session(request: web.Request) -> web.Response:
    token = request.app[CONFIG_KEY].server.auth_token
    return web.json_response({"app": APP_NAME, "version": APP_VERSION, "auth_required": bool(token),
                              "authenticated": is_authenticated(request)})


async def login(request: web.Request) -> web.Response:
    token = request.app[CONFIG_KEY].server.auth_token
    data = await body_json(request)
    given = str(data.get("token") or "")
    if token and not hmac.compare_digest(given, token):
        await asyncio.sleep(1.0)  # slow down guessing
        return json_error("wrong token", 401)
    resp = web.json_response({"ok": True})
    if token:
        resp.set_cookie(COOKIE, session_value(token), httponly=True, samesite="Strict",
                        secure=request.secure, max_age=30 * 24 * 3600, path="/")
    return resp


async def logout(request: web.Request) -> web.Response:
    resp = web.json_response({"ok": True})
    resp.del_cookie(COOKIE, path="/")
    return resp


# ---------------------------------------------------------------- status & settings

async def get_status(request: web.Request) -> web.Response:
    return web.json_response(await engine_of(request).status())


def settings_spec() -> dict:
    out: dict[str, dict] = {}
    for section, keys in RUNTIME_SPEC.items():
        for key, (kind, default, constraint) in keys.items():
            entry: dict[str, Any] = {"kind": kind, "default": default}
            if kind in ("int", "float"):
                entry["min"], entry["max"] = constraint
            elif kind == "choice":
                entry["choices"] = list(constraint)
            out.setdefault(section, {})[key] = entry
    return out


async def get_settings(request: web.Request) -> web.Response:
    engine = engine_of(request)
    return web.json_response({"settings": engine.settings, "defaults": engine.config.runtime_defaults,
                              "spec": settings_spec()})


async def put_settings(request: web.Request) -> web.Response:
    data = await body_json(request)
    settings = await engine_of(request).update_settings(data)
    return web.json_response({"settings": settings})


async def reset_settings(request: web.Request) -> web.Response:
    return web.json_response({"settings": await engine_of(request).reset_settings()})


# ---------------------------------------------------------------- missions

async def list_missions(request: web.Request) -> web.Response:
    engine = engine_of(request)
    missions = await request.app[DB_KEY].read(dbm.list_missions)
    return web.json_response({"missions": [engine.mission_summary(m) for m in missions]})


def _int_or_none(value: Any, name: str) -> int | None:
    if value is None or value == "":
        return None
    if isinstance(value, bool):
        raise EngineError(f"{name} must be an integer", 400)
    try:
        return int(value)
    except (TypeError, ValueError):
        raise EngineError(f"{name} must be an integer", 400) from None


async def create_mission(request: web.Request) -> web.Response:
    data = await body_json(request)
    m = await engine_of(request).create_mission(
        title=str(data.get("title") or ""), goal=str(data.get("goal") or ""),
        priority=data.get("priority"), max_turns=_int_or_none(data.get("max_turns"), "max_turns"),
        start=bool(data.get("start")), template_id=str(data.get("template_id") or ""))
    return web.json_response({"mission": engine_of(request).mission_summary(m)}, status=201)


async def get_mission(request: web.Request) -> web.Response:
    engine = engine_of(request)
    mid = request.match_info["mid"]
    m = await engine.get_mission(mid)

    def load(conn):
        return (dbm.list_sessions(conn, mid), dbm.list_instructions(conn, mid, 30),
                dbm.get_memory(conn, mid), dbm.artifact_index(conn, mid), dbm.pending_turn(conn, mid))

    sessions, instructions, memory, artifacts, pending = await request.app[DB_KEY].read(load)
    summary = engine.mission_summary(m)
    summary["goal"] = m["goal"]
    return web.json_response({
        "mission": summary, "sessions": sessions, "instructions": instructions,
        "memory": list(memory.values()), "artifacts": list(artifacts.values()),
        "pending_turn": ({"number": pending["number"], "state": pending["state"],
                          "message_type": pending["message_type"], "objective": pending["objective"],
                          "attempts": pending["attempts"], "error": pending["error"]} if pending else None),
        "live": engine.live(mid),
    })


async def patch_mission(request: web.Request) -> web.Response:
    data = await body_json(request)
    allowed = {"title", "goal", "priority", "max_turns"}
    unknown = set(data) - allowed
    if unknown:
        raise EngineError(f"unknown fields: {', '.join(sorted(unknown))}", 400)
    m = await engine_of(request).update_mission(
        request.match_info["mid"], title=data.get("title"), goal=data.get("goal"),
        priority=data.get("priority"), max_turns=_int_or_none(data.get("max_turns"), "max_turns"))
    return web.json_response({"mission": engine_of(request).mission_summary(m)})


async def delete_mission(request: web.Request) -> web.Response:
    await engine_of(request).delete_mission(request.match_info["mid"])
    return web.json_response({"ok": True})


async def mission_action(request: web.Request) -> web.Response:
    engine = engine_of(request)
    mid = request.match_info["mid"]
    action = request.match_info["action"]
    if action == "start":
        await engine.start_mission(mid)
    elif action == "pause":
        await engine.pause_mission(mid)
    elif action == "resume":
        await engine.resume_mission(mid)
    elif action == "stop":
        await engine.stop_mission(mid)
    elif action == "rotate":
        await engine.rotate_mission(mid)
    elif action == "reopen":
        data = await body_json(request)
        await engine.reopen_mission(mid, str(data.get("instruction") or ""))
    else:
        raise EngineError("unknown action", 404)
    m = await engine.get_mission(mid)
    return web.json_response({"mission": engine.mission_summary(m)})


async def add_instruction(request: web.Request) -> web.Response:
    data = await body_json(request)
    iid = await engine_of(request).add_instruction(request.match_info["mid"], str(data.get("text") or ""),
                                                   resume=bool(data.get("resume")))
    return web.json_response({"id": iid}, status=201)


async def delete_instruction(request: web.Request) -> web.Response:
    iid = _int_or_none(request.match_info["iid"], "instruction id")
    await engine_of(request).delete_instruction(request.match_info["mid"], iid)
    return web.json_response({"ok": True})


def _preview(text: str, limit: int) -> str:
    return text if len(text) <= limit else text[:limit] + "…"


def turn_public(t: dict, full: bool) -> dict:
    out = {k: t[k] for k in ("id", "number", "session_id", "session_turn", "message_type", "objective",
                             "rotation_reason", "state", "attempts", "finish_reason", "prompt_tokens",
                             "completion_tokens", "cached_tokens", "timings", "parse", "decision",
                             "receipts", "error", "created_at", "dispatched_at", "completed_at")}
    if full:
        out["user_content"] = t["user_content"]
        out["assistant_content"] = t["assistant_content"]
        out["reasoning_content"] = t["reasoning_content"]
    else:
        parse = dict(out["parse"] or {})
        parse.pop("output_tail", None)
        out["parse"] = parse
        out["assistant_chars"] = len(t["assistant_content"])
    return out


async def list_turns(request: web.Request) -> web.Response:
    mid = request.match_info["mid"]
    await engine_of(request).get_mission(mid)
    before = _int_or_none(request.query.get("before"), "before")
    limit = max(1, min(200, _int_or_none(request.query.get("limit"), "limit") or 30))
    rows = await request.app[DB_KEY].read(dbm.list_turns, mid, before=before, limit=limit)
    return web.json_response({"turns": [turn_public(t, False) for t in rows]})


async def get_turn(request: web.Request) -> web.Response:
    mid = request.match_info["mid"]
    number = _int_or_none(request.match_info["number"], "turn number")
    t = await request.app[DB_KEY].read(dbm.get_turn_by_number, mid, number)
    if t is None:
        raise EngineError("turn not found", 404)
    return web.json_response({"turn": turn_public(t, True)})


async def get_artifact(request: web.Request) -> web.Response:
    mid = request.match_info["mid"]
    name = request.match_info["name"]
    art = await request.app[DB_KEY].read(dbm.get_artifact, mid, name)
    if art is None:
        raise EngineError("artifact not found", 404)
    headers = {"X-Artifact-Sha256": art["sha256"]}
    if request.query.get("download"):
        safe = "".join(c for c in name if c.isalnum() or c in "._-") or "artifact.txt"
        headers["Content-Disposition"] = f'attachment; filename="{safe}"'
    return web.Response(text=art["content"], content_type="text/plain", charset="utf-8", headers=headers)


async def list_events(request: web.Request) -> web.Response:
    mid = request.match_info.get("mid")
    before = _int_or_none(request.query.get("before"), "before")
    limit = max(1, min(500, _int_or_none(request.query.get("limit"), "limit") or 100))
    rows = await request.app[DB_KEY].read(dbm.list_events, mid, limit, before)
    return web.json_response({"events": rows})


async def export_mission(request: web.Request) -> web.Response:
    engine = engine_of(request)
    mid = request.match_info["mid"]
    m = await engine.get_mission(mid)

    def load(conn):
        return {
            "sessions": [dict(r) for r in conn.execute(
                "SELECT * FROM sessions WHERE mission_id=? ORDER BY seq", (mid,)).fetchall()],
            "turns": list(reversed(dbm.list_turns(conn, mid, before=None, limit=1_000_000))),
            "instructions": dbm.list_instructions(conn, mid, 10_000),
            "memory": list(dbm.get_memory(conn, mid).values()),
            "artifacts": [dict(r) for r in conn.execute(
                "SELECT * FROM artifacts WHERE mission_id=? ORDER BY name", (mid,)).fetchall()],
            "events": list(reversed(dbm.list_events(conn, mid, 1_000_000))),
        }

    data = await request.app[DB_KEY].read(load)
    payload = {"schema": "greensea.mission-export.v1", "app": APP_NAME, "version": APP_VERSION,
               "exported_at": time.time(), "settings": engine.settings, "mission": m, **data}
    return web.Response(
        text=json.dumps(payload, ensure_ascii=False, indent=1), content_type="application/json",
        headers={"Content-Disposition": f'attachment; filename="greensea-{mid}.json"'})


# ---------------------------------------------------------------- templates

def _template_fields(data: dict) -> dict:
    goal = str(data.get("goal") or "").strip()
    if not goal or len(goal) > MAX_GOAL_CHARS:
        raise EngineError("the template mission text is empty or too long", 400)
    label = str(data.get("label") or data.get("title") or goal.splitlines()[0]).strip()[:120]
    priority = str(data.get("priority") or "NORMAL").upper()
    if priority not in PRIORITIES:
        raise EngineError("unknown priority", 400)
    max_turns = _int_or_none(data.get("max_turns"), "max_turns") or 200
    if not 1 <= max_turns <= 1_000_000:
        raise EngineError("max turns must be 1..1000000", 400)
    return {"label": label, "title": str(data.get("title") or label).strip()[:MAX_TITLE_CHARS],
            "goal": goal, "priority": priority, "max_turns": max_turns}


async def list_templates(request: web.Request) -> web.Response:
    return web.json_response({"templates": await request.app[DB_KEY].read(dbm.list_templates)})


async def create_template(request: web.Request) -> web.Response:
    fields = _template_fields(await body_json(request))
    now = time.time()
    tpl = {"id": uuid.uuid4().hex[:10], **fields, "created_at": now, "updated_at": now}
    await request.app[DB_KEY].tx(dbm.upsert_template, tpl)
    return web.json_response({"template": tpl}, status=201)


async def update_template(request: web.Request) -> web.Response:
    tid = request.match_info["tid"]
    current = await request.app[DB_KEY].read(dbm.get_template, tid)
    if current is None:
        raise EngineError("template not found", 404)
    fields = _template_fields(await body_json(request))
    tpl = {**current, **fields, "updated_at": time.time()}
    await request.app[DB_KEY].tx(dbm.upsert_template, tpl)
    return web.json_response({"template": tpl})


async def delete_template(request: web.Request) -> web.Response:
    if not await request.app[DB_KEY].tx(dbm.delete_template, request.match_info["tid"]):
        raise EngineError("template not found", 404)
    return web.json_response({"ok": True})


# ---------------------------------------------------------------- live stream

async def stream(request: web.Request) -> web.StreamResponse:
    bus = request.app[BUS_KEY]
    engine = engine_of(request)
    mission_filter = request.query.get("mission") or None
    resp = web.StreamResponse(headers={"Content-Type": "text/event-stream", "Cache-Control": "no-cache",
                                       "X-Accel-Buffering": "no", **SECURITY_HEADERS})
    await resp.prepare(request)
    sub = bus.subscribe(mission_filter)

    async def send(obj: dict) -> None:
        await resp.write(f"data: {json.dumps(obj, ensure_ascii=False)}\n\n".encode("utf-8"))

    try:
        await send({"type": "hello", "version": APP_VERSION, "llama": engine.llama_state()})
        if mission_filter:
            live = engine.live(mission_filter)
            if live:
                await send({"type": "live", "mission_id": mission_filter, "live": live})
        while True:
            try:
                msg = await asyncio.wait_for(sub.queue.get(), timeout=SSE_PING_S)
            except asyncio.TimeoutError:
                await resp.write(b": ping\n\n")
                continue
            if msg.get("type") == "shutdown":
                break
            await send(msg)
            if msg.get("type") == "resync":
                break
    except (ConnectionResetError, asyncio.CancelledError):
        pass
    finally:
        bus.unsubscribe(sub)
    return resp


# ---------------------------------------------------------------- static

async def index(request: web.Request) -> web.FileResponse:
    return web.FileResponse(STATIC_DIR / "index.html")


# ---------------------------------------------------------------- app

def build_app(config: AppConfig, *, database: dbm.Database | None = None, llama: LlamaClient | None = None,
              bus: EventBus | None = None, manage_lifecycle: bool = True) -> web.Application:
    app = web.Application(middlewares=[guard], client_max_size=MAX_BODY)
    database = database or dbm.Database(config.db_path)
    llama = llama or LlamaClient(config.llama.base_url, api_key=config.llama.api_key, model=config.llama.model)
    bus = bus or EventBus()
    engine = Engine(config, database, llama, bus)
    app[CONFIG_KEY] = config
    app[DB_KEY] = database
    app[LLAMA_KEY] = llama
    app[BUS_KEY] = bus
    app[ENGINE_KEY] = engine

    if manage_lifecycle:
        async def on_startup(app: web.Application) -> None:
            await database.open()
            await engine.start()
            log.info("%s %s listening, llama-server at %s", APP_NAME, APP_VERSION, config.llama.base_url)

        async def on_shutdown(app: web.Application) -> None:
            bus.close_all()
            await engine.shutdown()

        async def on_cleanup(app: web.Application) -> None:
            await llama.close()
            await database.close()

        app.on_startup.append(on_startup)
        app.on_shutdown.append(on_shutdown)
        app.on_cleanup.append(on_cleanup)

    r = app.router
    r.add_get("/", index)
    r.add_static("/static/", STATIC_DIR, show_index=False)
    r.add_get("/api/session", get_session)
    r.add_post("/api/login", login)
    r.add_post("/api/logout", logout)
    r.add_get("/api/status", get_status)
    r.add_get("/api/settings", get_settings)
    r.add_put("/api/settings", put_settings)
    r.add_post("/api/settings/reset", reset_settings)
    r.add_get("/api/missions", list_missions)
    r.add_post("/api/missions", create_mission)
    r.add_get("/api/missions/{mid}", get_mission)
    r.add_patch("/api/missions/{mid}", patch_mission)
    r.add_delete("/api/missions/{mid}", delete_mission)
    r.add_post("/api/missions/{mid}/instructions", add_instruction)
    r.add_delete("/api/missions/{mid}/instructions/{iid}", delete_instruction)
    r.add_get("/api/missions/{mid}/turns", list_turns)
    r.add_get("/api/missions/{mid}/turns/{number}", get_turn)
    r.add_get("/api/missions/{mid}/artifacts/{name}", get_artifact)
    r.add_get("/api/missions/{mid}/events", list_events)
    r.add_get("/api/missions/{mid}/export", export_mission)
    r.add_post("/api/missions/{mid}/{action}", mission_action)
    r.add_get("/api/events", list_events)
    r.add_get("/api/templates", list_templates)
    r.add_post("/api/templates", create_template)
    r.add_put("/api/templates/{tid}", update_template)
    r.add_delete("/api/templates/{tid}", delete_template)
    r.add_get("/api/stream", stream)
    return app
