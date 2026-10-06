"""Capacity scheduler for llama-server slots.

llama-server processes at most `total_slots` requests in parallel. GreenSea runs
any number of missions, so each request (worker turn or reviewer call) first
takes a lease here. Order: effective priority, then waiting time, then arrival.
Effective priority ages upward by one level per `aging_seconds` of waiting, so a
LOW mission is never starved (Greenfield's starvation-safe aging). A lease is
held for one request only; a running generation is never preempted.
"""

from __future__ import annotations

import asyncio
import itertools
import time
from dataclasses import dataclass, field
from typing import Callable

from .contracts import PRIORITIES, normalize_priority

TOP_RANK = max(PRIORITIES.values())


@dataclass
class _Waiter:
    mission_id: str
    rank: int
    enqueued_at: float
    seq: int
    kind: str
    future: asyncio.Future = field(repr=False)


@dataclass
class Lease:
    mission_id: str
    kind: str
    granted_at: float
    seq: int
    released: bool = False


class CapacityScheduler:
    def __init__(self, capacity: int = 1, aging_seconds: float = 180.0,
                 clock: Callable[[], float] = time.monotonic):
        self._capacity = max(0, int(capacity))
        self._aging = float(aging_seconds)
        self._clock = clock
        self._waiters: list[_Waiter] = []
        self._active: dict[int, Lease] = {}
        self._seq = itertools.count(1)

    @property
    def capacity(self) -> int:
        return self._capacity

    def configure(self, *, capacity: int | None = None, aging_seconds: float | None = None) -> None:
        if capacity is not None:
            self._capacity = max(0, int(capacity))
        if aging_seconds is not None:
            self._aging = float(aging_seconds)
        self._dispatch()

    def effective_rank(self, waiter: _Waiter, now: float) -> int:
        if self._aging <= 0:
            return waiter.rank
        steps = int((now - waiter.enqueued_at) // self._aging)
        return min(TOP_RANK, waiter.rank + max(0, steps))

    def _dispatch(self) -> None:
        now = self._clock()
        self._waiters = [w for w in self._waiters if not w.future.done()]
        while self._waiters and len(self._active) < self._capacity:
            best = min(self._waiters, key=lambda w: (-self.effective_rank(w, now), w.enqueued_at, w.seq))
            self._waiters.remove(best)
            lease = Lease(best.mission_id, best.kind, now, best.seq)
            self._active[best.seq] = lease
            best.future.set_result(lease)

    async def acquire(self, mission_id: str, priority: str, kind: str = "turn") -> Lease:
        loop = asyncio.get_running_loop()
        waiter = _Waiter(mission_id, PRIORITIES[normalize_priority(priority)], self._clock(),
                         next(self._seq), kind, loop.create_future())
        self._waiters.append(waiter)
        self._dispatch()
        try:
            return await waiter.future
        except asyncio.CancelledError:
            if waiter.future.done() and not waiter.future.cancelled():
                # Granted while being cancelled: give the slot back.
                self.release(waiter.future.result())
            else:
                self._waiters = [w for w in self._waiters if w is not waiter]
            self._dispatch()
            raise

    def release(self, lease: Lease) -> None:
        if lease.released:
            return
        lease.released = True
        self._active.pop(lease.seq, None)
        self._dispatch()

    def update_priority(self, mission_id: str, priority: str) -> None:
        rank = PRIORITIES[normalize_priority(priority)]
        for w in self._waiters:
            if w.mission_id == mission_id:
                w.rank = rank
        self._dispatch()

    def snapshot(self) -> dict:
        now = self._clock()
        return {
            "capacity": self._capacity,
            "aging_seconds": self._aging,
            "active": [{"mission_id": l.mission_id, "kind": l.kind,
                        "held_s": round(now - l.granted_at, 1)} for l in self._active.values()],
            "waiting": [{"mission_id": w.mission_id, "kind": w.kind,
                         "waited_s": round(now - w.enqueued_at, 1),
                         "effective_priority": next(k for k, v in PRIORITIES.items()
                                                    if v == self.effective_rank(w, now))}
                        for w in sorted(self._waiters, key=lambda w: (-self.effective_rank(w, now),
                                                                      w.enqueued_at, w.seq))
                        if not w.future.done()],
        }
