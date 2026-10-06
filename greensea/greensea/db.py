"""Durable state in SQLite.

All database work runs on one dedicated thread with one connection, so the
asyncio event loop never blocks on disk and writes are serialized. Every state
change of a mission is one transaction (``Database.tx``): a crash leaves either
the old or the new state, never a mixture. This is what makes the write-ahead
turn protocol in engine.py safe.
"""

from __future__ import annotations

import asyncio
import functools
import json
import sqlite3
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Any, Callable

SCHEMA_VERSION = 1

SCHEMA = """
CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS missions (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  goal TEXT NOT NULL,
  goal_rev INTEGER NOT NULL DEFAULT 1,
  priority TEXT NOT NULL,
  operator_priority TEXT NOT NULL,
  operator_edited_at REAL NOT NULL DEFAULT 0,
  phase TEXT NOT NULL,
  phase_reason TEXT NOT NULL DEFAULT '',
  max_turns INTEGER NOT NULL,
  turn_count INTEGER NOT NULL DEFAULT 0,
  session_seq INTEGER NOT NULL DEFAULT 0,
  objective TEXT NOT NULL DEFAULT '',
  notices TEXT NOT NULL DEFAULT '[]',
  counters TEXT NOT NULL DEFAULT '{}',
  pause_until REAL,
  pause_requested INTEGER NOT NULL DEFAULT 0,
  rotate_requested TEXT NOT NULL DEFAULT '',
  recovery TEXT NOT NULL DEFAULT '{}',
  question TEXT NOT NULL DEFAULT '',
  last_decision TEXT NOT NULL DEFAULT '{}',
  context_tokens INTEGER NOT NULL DEFAULT 0,
  template_id TEXT NOT NULL DEFAULT '',
  created_at REAL NOT NULL,
  updated_at REAL NOT NULL,
  started_at REAL,
  completed_at REAL
);
CREATE TABLE IF NOT EXISTS sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  mission_id TEXT NOT NULL REFERENCES missions(id) ON DELETE CASCADE,
  seq INTEGER NOT NULL,
  reason TEXT NOT NULL,
  system_prompt TEXT NOT NULL,
  goal_rev INTEGER NOT NULL,
  n_ctx INTEGER NOT NULL,
  turn_count INTEGER NOT NULL DEFAULT 0,
  started_at REAL NOT NULL,
  ended_at REAL,
  UNIQUE (mission_id, seq)
);
CREATE TABLE IF NOT EXISTS turns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  mission_id TEXT NOT NULL REFERENCES missions(id) ON DELETE CASCADE,
  session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  number INTEGER NOT NULL,
  session_turn INTEGER NOT NULL,
  message_type TEXT NOT NULL,
  objective TEXT NOT NULL,
  rotation_reason TEXT NOT NULL DEFAULT '',
  user_content TEXT NOT NULL DEFAULT '',
  state TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  assistant_content TEXT NOT NULL DEFAULT '',
  reasoning_content TEXT NOT NULL DEFAULT '',
  finish_reason TEXT NOT NULL DEFAULT '',
  prompt_tokens INTEGER,
  completion_tokens INTEGER,
  cached_tokens INTEGER,
  timings TEXT NOT NULL DEFAULT '{}',
  parse TEXT NOT NULL DEFAULT '{}',
  decision TEXT NOT NULL DEFAULT '{}',
  receipts TEXT NOT NULL DEFAULT '[]',
  read_requests TEXT NOT NULL DEFAULT '[]',
  error TEXT NOT NULL DEFAULT '',
  created_at REAL NOT NULL,
  dispatched_at REAL,
  completed_at REAL,
  UNIQUE (mission_id, number)
);
CREATE INDEX IF NOT EXISTS turns_session ON turns (session_id, session_turn);
CREATE TABLE IF NOT EXISTS instructions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  mission_id TEXT NOT NULL REFERENCES missions(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  created_at REAL NOT NULL,
  consumed_turn INTEGER
);
CREATE TABLE IF NOT EXISTS memory (
  mission_id TEXT NOT NULL REFERENCES missions(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  updated_turn INTEGER NOT NULL,
  updated_at REAL NOT NULL,
  PRIMARY KEY (mission_id, key)
);
CREATE TABLE IF NOT EXISTS artifacts (
  mission_id TEXT NOT NULL REFERENCES missions(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  content TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  size INTEGER NOT NULL,
  updated_turn INTEGER NOT NULL,
  updated_at REAL NOT NULL,
  PRIMARY KEY (mission_id, name)
);
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at REAL NOT NULL,
  mission_id TEXT NOT NULL DEFAULT '',
  kind TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS events_mission ON events (mission_id, id);
CREATE TABLE IF NOT EXISTS templates (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  title TEXT NOT NULL,
  goal TEXT NOT NULL,
  priority TEXT NOT NULL,
  max_turns INTEGER NOT NULL,
  created_at REAL NOT NULL,
  updated_at REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS settings (
  section TEXT NOT NULL,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  PRIMARY KEY (section, key)
);
"""

EVENT_RETENTION = 50_000
_JSON_COLUMNS = {
    "missions": ("notices", "counters", "recovery", "last_decision"),
    "turns": ("timings", "parse", "decision", "receipts", "read_requests"),
}


def dumps(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def _row(table: str, row: sqlite3.Row | None) -> dict | None:
    if row is None:
        return None
    out = dict(row)
    for col in _JSON_COLUMNS.get(table, ()):
        if col in out and isinstance(out[col], str):
            out[col] = json.loads(out[col] or "null")
    return out


class Database:
    def __init__(self, path: str | Path):
        self.path = str(path)
        self._executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="greensea-db")
        self._conn: sqlite3.Connection | None = None

    def _open(self) -> None:
        if self.path != ":memory:":
            Path(self.path).parent.mkdir(parents=True, exist_ok=True)
        conn = sqlite3.connect(self.path, check_same_thread=False, isolation_level=None)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA synchronous=FULL")
        conn.execute("PRAGMA foreign_keys=ON")
        conn.execute("PRAGMA busy_timeout=5000")
        conn.executescript(SCHEMA)
        cur = conn.execute("SELECT value FROM meta WHERE key='schema_version'").fetchone()
        if cur is None:
            conn.execute("INSERT INTO meta (key, value) VALUES ('schema_version', ?)", (str(SCHEMA_VERSION),))
        elif int(cur[0]) > SCHEMA_VERSION:
            raise RuntimeError(f"database schema {cur[0]} is newer than this GreenSea ({SCHEMA_VERSION})")
        self._conn = conn

    async def open(self) -> None:
        await asyncio.get_running_loop().run_in_executor(self._executor, self._open)

    def _close(self) -> None:
        if self._conn is not None:
            self._conn.close()
            self._conn = None

    async def close(self) -> None:
        await asyncio.get_running_loop().run_in_executor(self._executor, self._close)
        self._executor.shutdown(wait=True)

    def _run_tx(self, fn: Callable, args: tuple) -> Any:
        conn = self._conn
        if conn is None:
            raise RuntimeError("database is not open")
        conn.execute("BEGIN IMMEDIATE")
        try:
            result = fn(conn, *args)
        except BaseException:
            conn.execute("ROLLBACK")
            raise
        conn.execute("COMMIT")
        return result

    async def tx(self, fn: Callable, *args: Any, **kwargs: Any) -> Any:
        """Run fn(conn, *args, **kwargs) in one write transaction on the database thread."""
        if kwargs:
            fn = functools.partial(fn, **kwargs)
        return await asyncio.get_running_loop().run_in_executor(self._executor, self._run_tx, fn, args)

    def _run_read(self, fn: Callable, args: tuple) -> Any:
        conn = self._conn
        if conn is None:
            raise RuntimeError("database is not open")
        conn.execute("BEGIN")
        try:
            return fn(conn, *args)
        finally:
            conn.execute("COMMIT")

    async def read(self, fn: Callable, *args: Any, **kwargs: Any) -> Any:
        """Run fn(conn, *args, **kwargs) with a consistent read snapshot."""
        if kwargs:
            fn = functools.partial(fn, **kwargs)
        return await asyncio.get_running_loop().run_in_executor(self._executor, self._run_read, fn, args)


# ---------------------------------------------------------------------------
# Repository functions. All take an open connection and run inside the caller's
# transaction (Database.tx / Database.read).


def now() -> float:
    return time.time()


def get_mission(conn: sqlite3.Connection, mission_id: str) -> dict | None:
    return _row("missions", conn.execute("SELECT * FROM missions WHERE id=?", (mission_id,)).fetchone())


def list_missions(conn: sqlite3.Connection) -> list[dict]:
    rows = conn.execute("SELECT * FROM missions ORDER BY created_at DESC").fetchall()
    return [_row("missions", r) for r in rows]


def insert_mission(conn: sqlite3.Connection, mission: dict) -> None:
    cols = list(mission)
    values = [dumps(mission[c]) if c in _JSON_COLUMNS["missions"] else mission[c] for c in cols]
    conn.execute(
        f"INSERT INTO missions ({', '.join(cols)}) VALUES ({', '.join('?' for _ in cols)})", values
    )


def update_mission(conn: sqlite3.Connection, mission_id: str, **fields: Any) -> None:
    if not fields:
        return
    fields.setdefault("updated_at", now())
    sets, values = [], []
    for col, value in fields.items():
        sets.append(f"{col}=?")
        values.append(dumps(value) if col in _JSON_COLUMNS["missions"] else value)
    values.append(mission_id)
    cur = conn.execute(f"UPDATE missions SET {', '.join(sets)} WHERE id=?", values)
    if cur.rowcount != 1:
        raise KeyError(f"mission {mission_id} not found")


def delete_mission(conn: sqlite3.Connection, mission_id: str) -> None:
    conn.execute("DELETE FROM missions WHERE id=?", (mission_id,))
    conn.execute("DELETE FROM events WHERE mission_id=?", (mission_id,))


def insert_session(conn: sqlite3.Connection, *, mission_id: str, seq: int, reason: str,
                   system_prompt: str, goal_rev: int, n_ctx: int) -> int:
    cur = conn.execute(
        "INSERT INTO sessions (mission_id, seq, reason, system_prompt, goal_rev, n_ctx, started_at) "
        "VALUES (?, ?, ?, ?, ?, ?, ?)",
        (mission_id, seq, reason, system_prompt, goal_rev, n_ctx, now()),
    )
    return int(cur.lastrowid)


def current_session(conn: sqlite3.Connection, mission_id: str) -> dict | None:
    row = conn.execute(
        "SELECT * FROM sessions WHERE mission_id=? ORDER BY seq DESC LIMIT 1", (mission_id,)
    ).fetchone()
    return dict(row) if row else None


def end_session(conn: sqlite3.Connection, session_id: int) -> None:
    conn.execute("UPDATE sessions SET ended_at=? WHERE id=? AND ended_at IS NULL", (now(), session_id))


def bump_session_turns(conn: sqlite3.Connection, session_id: int) -> None:
    conn.execute("UPDATE sessions SET turn_count=turn_count+1 WHERE id=?", (session_id,))


def list_sessions(conn: sqlite3.Connection, mission_id: str) -> list[dict]:
    rows = conn.execute(
        "SELECT id, mission_id, seq, reason, goal_rev, n_ctx, turn_count, started_at, ended_at "
        "FROM sessions WHERE mission_id=? ORDER BY seq", (mission_id,)
    ).fetchall()
    return [dict(r) for r in rows]


def insert_turn(conn: sqlite3.Connection, turn: dict) -> int:
    turn = dict(turn)
    turn.setdefault("created_at", now())
    cols = list(turn)
    values = [dumps(turn[c]) if c in _JSON_COLUMNS["turns"] else turn[c] for c in cols]
    cur = conn.execute(
        f"INSERT INTO turns ({', '.join(cols)}) VALUES ({', '.join('?' for _ in cols)})", values
    )
    return int(cur.lastrowid)


def update_turn(conn: sqlite3.Connection, turn_id: int, **fields: Any) -> None:
    sets, values = [], []
    for col, value in fields.items():
        sets.append(f"{col}=?")
        values.append(dumps(value) if col in _JSON_COLUMNS["turns"] else value)
    values.append(turn_id)
    cur = conn.execute(f"UPDATE turns SET {', '.join(sets)} WHERE id=?", values)
    if cur.rowcount != 1:
        raise KeyError(f"turn {turn_id} not found")


def get_turn(conn: sqlite3.Connection, turn_id: int) -> dict | None:
    return _row("turns", conn.execute("SELECT * FROM turns WHERE id=?", (turn_id,)).fetchone())


def get_turn_by_number(conn: sqlite3.Connection, mission_id: str, number: int) -> dict | None:
    return _row("turns", conn.execute(
        "SELECT * FROM turns WHERE mission_id=? AND number=?", (mission_id, number)
    ).fetchone())


def pending_turn(conn: sqlite3.Connection, mission_id: str) -> dict | None:
    """The single turn that is prepared or dispatched but not yet committed."""
    rows = conn.execute(
        "SELECT * FROM turns WHERE mission_id=? AND state IN ('PREPARED','DISPATCHED') ORDER BY number",
        (mission_id,),
    ).fetchall()
    if len(rows) > 1:
        raise RuntimeError(f"INVARIANT: mission {mission_id} has {len(rows)} pending turns")
    return _row("turns", rows[0]) if rows else None


def last_completed_turn(conn: sqlite3.Connection, mission_id: str) -> dict | None:
    return _row("turns", conn.execute(
        "SELECT * FROM turns WHERE mission_id=? AND state='COMPLETED' ORDER BY number DESC LIMIT 1",
        (mission_id,),
    ).fetchone())


def session_completed_turns(conn: sqlite3.Connection, session_id: int) -> list[dict]:
    rows = conn.execute(
        "SELECT * FROM turns WHERE session_id=? AND state='COMPLETED' ORDER BY session_turn",
        (session_id,),
    ).fetchall()
    return [_row("turns", r) for r in rows]


def recent_completed_turns(conn: sqlite3.Connection, mission_id: str, limit: int) -> list[dict]:
    rows = conn.execute(
        "SELECT * FROM turns WHERE mission_id=? AND state='COMPLETED' ORDER BY number DESC LIMIT ?",
        (mission_id, limit),
    ).fetchall()
    return [_row("turns", r) for r in reversed(rows)]


def list_turns(conn: sqlite3.Connection, mission_id: str, *, before: int | None, limit: int) -> list[dict]:
    if before is None:
        rows = conn.execute(
            "SELECT * FROM turns WHERE mission_id=? ORDER BY number DESC LIMIT ?", (mission_id, limit)
        ).fetchall()
    else:
        rows = conn.execute(
            "SELECT * FROM turns WHERE mission_id=? AND number<? ORDER BY number DESC LIMIT ?",
            (mission_id, before, limit),
        ).fetchall()
    return [_row("turns", r) for r in rows]


def count_completed_turns(conn: sqlite3.Connection, mission_id: str) -> int:
    return int(conn.execute(
        "SELECT COUNT(*) FROM turns WHERE mission_id=? AND state='COMPLETED'", (mission_id,)
    ).fetchone()[0])


def next_turn_number(conn: sqlite3.Connection, mission_id: str) -> int:
    row = conn.execute("SELECT MAX(number) FROM turns WHERE mission_id=?", (mission_id,)).fetchone()
    return int(row[0] or 0) + 1


# Instructions --------------------------------------------------------------

def add_instruction(conn: sqlite3.Connection, mission_id: str, text: str) -> int:
    cur = conn.execute(
        "INSERT INTO instructions (mission_id, text, created_at) VALUES (?, ?, ?)",
        (mission_id, text, now()),
    )
    return int(cur.lastrowid)


def pending_instructions(conn: sqlite3.Connection, mission_id: str) -> list[dict]:
    rows = conn.execute(
        "SELECT * FROM instructions WHERE mission_id=? AND consumed_turn IS NULL ORDER BY id",
        (mission_id,),
    ).fetchall()
    return [dict(r) for r in rows]


def consume_instructions(conn: sqlite3.Connection, ids: list[int], turn_number: int) -> None:
    for iid in ids:
        conn.execute("UPDATE instructions SET consumed_turn=? WHERE id=? AND consumed_turn IS NULL",
                     (turn_number, iid))


def list_instructions(conn: sqlite3.Connection, mission_id: str, limit: int = 50) -> list[dict]:
    rows = conn.execute(
        "SELECT * FROM instructions WHERE mission_id=? ORDER BY id DESC LIMIT ?", (mission_id, limit)
    ).fetchall()
    return [dict(r) for r in rows]


def delete_pending_instruction(conn: sqlite3.Connection, mission_id: str, instruction_id: int) -> bool:
    cur = conn.execute(
        "DELETE FROM instructions WHERE id=? AND mission_id=? AND consumed_turn IS NULL",
        (instruction_id, mission_id),
    )
    return cur.rowcount == 1


# Memory and artifacts ------------------------------------------------------

def get_memory(conn: sqlite3.Connection, mission_id: str) -> dict[str, dict]:
    rows = conn.execute(
        "SELECT key, value, updated_turn, updated_at FROM memory WHERE mission_id=? ORDER BY key",
        (mission_id,),
    ).fetchall()
    return {r["key"]: dict(r) for r in rows}


def set_memory(conn: sqlite3.Connection, mission_id: str, key: str, value: str, turn: int) -> None:
    conn.execute(
        "INSERT INTO memory (mission_id, key, value, updated_turn, updated_at) VALUES (?, ?, ?, ?, ?) "
        "ON CONFLICT (mission_id, key) DO UPDATE SET value=excluded.value, "
        "updated_turn=excluded.updated_turn, updated_at=excluded.updated_at",
        (mission_id, key, value, turn, now()),
    )


def delete_memory(conn: sqlite3.Connection, mission_id: str, key: str) -> None:
    conn.execute("DELETE FROM memory WHERE mission_id=? AND key=?", (mission_id, key))


def artifact_index(conn: sqlite3.Connection, mission_id: str) -> dict[str, dict]:
    rows = conn.execute(
        "SELECT name, sha256, size, updated_turn, updated_at FROM artifacts WHERE mission_id=? ORDER BY name",
        (mission_id,),
    ).fetchall()
    return {r["name"]: dict(r) for r in rows}


def get_artifact(conn: sqlite3.Connection, mission_id: str, name: str) -> dict | None:
    row = conn.execute(
        "SELECT * FROM artifacts WHERE mission_id=? AND name=?", (mission_id, name)
    ).fetchone()
    return dict(row) if row else None


def put_artifact(conn: sqlite3.Connection, mission_id: str, name: str, content: str,
                 sha256: str, turn: int) -> None:
    conn.execute(
        "INSERT INTO artifacts (mission_id, name, content, sha256, size, updated_turn, updated_at) "
        "VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT (mission_id, name) DO UPDATE SET "
        "content=excluded.content, sha256=excluded.sha256, size=excluded.size, "
        "updated_turn=excluded.updated_turn, updated_at=excluded.updated_at",
        (mission_id, name, content, sha256, len(content.encode("utf-8")), turn, now()),
    )


# Events --------------------------------------------------------------------

def add_event(conn: sqlite3.Connection, mission_id: str, kind: str, detail: dict | None = None) -> dict:
    at = now()
    cur = conn.execute(
        "INSERT INTO events (at, mission_id, kind, detail) VALUES (?, ?, ?, ?)",
        (at, mission_id or "", kind, dumps(detail or {})),
    )
    event_id = int(cur.lastrowid)
    if event_id % 500 == 0:
        conn.execute("DELETE FROM events WHERE id <= ?", (event_id - EVENT_RETENTION,))
    return {"id": event_id, "at": at, "mission_id": mission_id or "", "kind": kind, "detail": detail or {}}


def list_events(conn: sqlite3.Connection, mission_id: str | None, limit: int, before: int | None = None) -> list[dict]:
    clauses, params = [], []
    if mission_id is not None:
        clauses.append("mission_id=?")
        params.append(mission_id)
    if before is not None:
        clauses.append("id<?")
        params.append(before)
    where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
    rows = conn.execute(
        f"SELECT * FROM events {where} ORDER BY id DESC LIMIT ?", (*params, limit)
    ).fetchall()
    out = []
    for r in rows:
        d = dict(r)
        d["detail"] = json.loads(d["detail"] or "{}")
        out.append(d)
    return out


# Templates -----------------------------------------------------------------

def list_templates(conn: sqlite3.Connection) -> list[dict]:
    return [dict(r) for r in conn.execute("SELECT * FROM templates ORDER BY label COLLATE NOCASE").fetchall()]


def get_template(conn: sqlite3.Connection, template_id: str) -> dict | None:
    row = conn.execute("SELECT * FROM templates WHERE id=?", (template_id,)).fetchone()
    return dict(row) if row else None


def upsert_template(conn: sqlite3.Connection, tpl: dict) -> None:
    conn.execute(
        "INSERT INTO templates (id, label, title, goal, priority, max_turns, created_at, updated_at) "
        "VALUES (:id, :label, :title, :goal, :priority, :max_turns, :created_at, :updated_at) "
        "ON CONFLICT (id) DO UPDATE SET label=excluded.label, title=excluded.title, goal=excluded.goal, "
        "priority=excluded.priority, max_turns=excluded.max_turns, updated_at=excluded.updated_at",
        tpl,
    )


def delete_template(conn: sqlite3.Connection, template_id: str) -> bool:
    return conn.execute("DELETE FROM templates WHERE id=?", (template_id,)).rowcount == 1


# Settings ------------------------------------------------------------------

def get_settings(conn: sqlite3.Connection) -> dict[str, dict[str, Any]]:
    out: dict[str, dict[str, Any]] = {}
    for r in conn.execute("SELECT section, key, value FROM settings").fetchall():
        out.setdefault(r["section"], {})[r["key"]] = json.loads(r["value"])
    return out


def put_settings(conn: sqlite3.Connection, patch: dict[str, dict[str, Any]]) -> None:
    for section, values in patch.items():
        for key, value in values.items():
            conn.execute(
                "INSERT INTO settings (section, key, value) VALUES (?, ?, ?) "
                "ON CONFLICT (section, key) DO UPDATE SET value=excluded.value",
                (section, key, dumps(value)),
            )


def reset_settings(conn: sqlite3.Connection) -> None:
    conn.execute("DELETE FROM settings")
