"""In-process publish/subscribe for the web interface (Server-Sent Events).

Bounded per subscriber: a slow browser never blocks the engine. When a
subscriber's queue is full, it receives one "resync" marker and must reload
its state over the REST API.
"""

from __future__ import annotations

import asyncio
from typing import Any

QUEUE_SIZE = 2000


class Subscriber:
    def __init__(self, mission_filter: str | None):
        self.mission_filter = mission_filter
        self.queue: asyncio.Queue[dict[str, Any]] = asyncio.Queue(maxsize=QUEUE_SIZE)
        self.overflowed = False


class EventBus:
    def __init__(self) -> None:
        self._subs: set[Subscriber] = set()

    def subscribe(self, mission_filter: str | None = None) -> Subscriber:
        sub = Subscriber(mission_filter)
        self._subs.add(sub)
        return sub

    def unsubscribe(self, sub: Subscriber) -> None:
        self._subs.discard(sub)

    def close_all(self) -> None:
        """Tell every subscriber to end its stream (service shutdown)."""
        for sub in list(self._subs):
            try:
                sub.queue.put_nowait({"type": "shutdown"})
            except asyncio.QueueFull:
                sub.overflowed = True

    @property
    def subscriber_count(self) -> int:
        return len(self._subs)

    def publish(self, message: dict[str, Any]) -> None:
        # Token deltas only go to subscribers watching that mission.
        is_delta = message.get("type") == "delta"
        for sub in list(self._subs):
            if is_delta and sub.mission_filter != message.get("mission_id"):
                continue
            if sub.overflowed:
                continue
            try:
                sub.queue.put_nowait(message)
            except asyncio.QueueFull:
                sub.overflowed = True
                # Make room for exactly one resync marker.
                try:
                    sub.queue.get_nowait()
                    sub.queue.put_nowait({"type": "resync"})
                except (asyncio.QueueEmpty, asyncio.QueueFull):
                    pass
