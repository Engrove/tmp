"""Test harness: a fake llama-server plus a real Engine on a temporary database."""

from __future__ import annotations

import asyncio
import time
from pathlib import Path
from typing import Any

from aiohttp.test_utils import TestServer

from greensea import db as dbm
from greensea.bus import EventBus
from greensea.config import AppConfig, LlamaConfig, ServerConfig, merge_runtime, runtime_defaults
from greensea.engine import Engine
from greensea.llama import LlamaClient

from fake_llama import FakeLlama


def run(coro):
    return asyncio.run(coro)


class Harness:
    def __init__(self, tmp_path: Path, fake: FakeLlama | None = None, runtime: dict | None = None):
        self.tmp_path = tmp_path
        self.fake = fake or FakeLlama()
        base = runtime_defaults()
        base["timeouts"].update(first_token_seconds=10, stall_seconds=5, turn_seconds=60,
                                health_interval_seconds=2)
        base["reviewer"]["mode"] = "off"
        self.runtime = merge_runtime(base, runtime or {})
        self.server: TestServer | None = None
        self.engine: Engine | None = None
        self.database: dbm.Database | None = None
        self.llama: LlamaClient | None = None
        self.bus = EventBus()

    async def __aenter__(self) -> "Harness":
        self.server = TestServer(self.fake.app())
        await self.server.start_server()
        base_url = str(self.server.make_url("")).rstrip("/")
        self.config = AppConfig(server=ServerConfig(data_dir=str(self.tmp_path)),
                                llama=LlamaConfig(base_url=base_url), runtime_defaults=self.runtime)
        self.database = dbm.Database(self.config.db_path)
        await self.database.open()
        self.llama = LlamaClient(base_url)
        self.engine = Engine(self.config, self.database, self.llama, self.bus)
        await self.engine.start()
        await asyncio.wait_for(self.engine.monitor.wait_ok(), 10)
        return self

    async def restart_engine(self) -> None:
        """Simulate a service restart: new Engine on the same database."""
        await self.engine.shutdown()
        self.engine = Engine(self.config, self.database, self.llama, self.bus)
        await self.engine.start()
        await asyncio.wait_for(self.engine.monitor.wait_ok(), 10)

    async def __aexit__(self, *exc: Any) -> None:
        if self.engine:
            await self.engine.shutdown()
        if self.llama:
            await self.llama.close()
        if self.database:
            await self.database.close()
        if self.server:
            await self.server.close()

    async def mission(self, mid: str) -> dict:
        return await self.database.read(dbm.get_mission, mid)

    async def turns(self, mid: str) -> list[dict]:
        rows = await self.database.read(dbm.list_turns, mid, before=None, limit=1000)
        return list(reversed(rows))

    async def events(self, mid: str) -> list[dict]:
        return list(reversed(await self.database.read(dbm.list_events, mid, 1000)))

    async def wait_phase(self, mid: str, phases: set[str] | str, timeout: float = 15.0) -> dict:
        if isinstance(phases, str):
            phases = {phases}
        deadline = time.monotonic() + timeout
        while True:
            m = await self.mission(mid)
            if m["phase"] in phases:
                return m
            if time.monotonic() > deadline:
                raise AssertionError(f"mission stuck in {m['phase']} ({m['phase_reason']}), wanted {phases}")
            await asyncio.sleep(0.05)

    async def wait_for(self, predicate, timeout: float = 15.0, what: str = "condition"):
        deadline = time.monotonic() + timeout
        while True:
            value = await predicate()
            if value:
                return value
            if time.monotonic() > deadline:
                raise AssertionError(f"timed out waiting for {what}")
            await asyncio.sleep(0.05)
