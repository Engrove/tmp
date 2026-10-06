"""Health and capability monitor for llama-server.

GreenSea only dispatches while llama-server reports healthy (GET /health 200)
and its properties are known (GET /props: per-slot n_ctx, total_slots). Both
endpoints are exempt from llama-server's idle-sleep timer, so monitoring does
not keep a sleeping model loaded.
"""

from __future__ import annotations

import asyncio
import logging
import time
from typing import Callable

from .llama import LlamaClient, LlamaError

log = logging.getLogger("greensea.monitor")

PROPS_REFRESH_S = 300


class LlamaMonitor:
    def __init__(self, client: LlamaClient, *, interval: Callable[[], float],
                 on_change: Callable[[dict], None]):
        self.client = client
        self._interval = interval
        self._on_change = on_change
        self.ok_event = asyncio.Event()
        self.state: dict = {
            "ok": False, "health": "unknown", "detail": "not checked yet", "checked_at": None,
            "last_ok_at": None, "n_ctx": None, "total_slots": None, "model": "", "build": "",
            "sleeping": False, "props_at": None,
        }
        self._task: asyncio.Task | None = None
        self._kick = asyncio.Event()

    @property
    def ok(self) -> bool:
        return bool(self.state["ok"])

    def n_ctx(self) -> int | None:
        return self.state["n_ctx"]

    def total_slots(self) -> int | None:
        return self.state["total_slots"]

    def start(self) -> None:
        self._task = asyncio.create_task(self._run(), name="greensea-llama-monitor")

    async def stop(self) -> None:
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass

    def kick(self) -> None:
        """Check again now (for example after a request failed)."""
        self._kick.set()

    def invalidate_props(self) -> None:
        """Re-read /props at the next check (llama-server may have restarted with another n_ctx)."""
        self.state["props_at"] = None
        self._kick.set()

    async def refresh(self) -> None:
        self.state["props_at"] = None
        await self.check_once()

    async def wait_ok(self) -> None:
        await self.ok_event.wait()

    async def check_once(self) -> None:
        before = dict(self.state)
        now = time.time()
        try:
            healthy, detail = await self.client.health()
        except LlamaError as exc:
            healthy, detail = False, exc.message
        self.state["checked_at"] = now
        self.state["health"] = "ok" if healthy else "error"
        self.state["detail"] = detail
        if healthy:
            stale = (self.state["props_at"] is None or now - self.state["props_at"] > PROPS_REFRESH_S
                     or not before["ok"])
            if stale:
                try:
                    props = await self.client.props()
                    dgs = props.get("default_generation_settings") or {}
                    n_ctx = dgs.get("n_ctx")
                    self.state["n_ctx"] = int(n_ctx) if isinstance(n_ctx, (int, float)) and n_ctx > 0 else None
                    slots = props.get("total_slots")
                    self.state["total_slots"] = int(slots) if isinstance(slots, (int, float)) and slots > 0 else 1
                    self.state["model"] = str(props.get("model_alias") or props.get("model_path") or "")
                    self.state["build"] = str(props.get("build_info") or "")
                    self.state["sleeping"] = bool(props.get("is_sleeping", False))
                    self.state["props_at"] = now
                except LlamaError as exc:
                    self.state["detail"] = f"props: {exc.message}"
                    self.state["props_at"] = None
        ready = healthy and self.state["props_at"] is not None
        self.state["ok"] = ready
        if ready:
            self.state["last_ok_at"] = now
            self.ok_event.set()
        else:
            self.ok_event.clear()
        keys = ("ok", "health", "detail", "n_ctx", "total_slots", "model", "build", "sleeping")
        if any(before.get(k) != self.state.get(k) for k in keys):
            if ready != before["ok"]:
                log.info("llama-server %s (%s)", "ready" if ready else "not ready", self.state["detail"])
            self._on_change(dict(self.state))

    async def _run(self) -> None:
        while True:
            try:
                await self.check_once()
            except asyncio.CancelledError:
                raise
            except Exception:  # never let monitoring die
                log.exception("monitor check failed")
            self._kick.clear()
            delay = self._interval() if self.ok else min(5.0, self._interval())
            try:
                await asyncio.wait_for(self._kick.wait(), timeout=delay)
            except asyncio.TimeoutError:
                pass
