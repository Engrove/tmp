"""Configuration.

Two layers:
  * the TOML file (deployment: listen address, data dir, llama.cpp endpoint, auth),
    read once at start;
  * runtime settings (generation, context, scheduler, timeouts, reviewer, mission
    defaults), whose defaults come from the TOML file and which the operator may
    override from the web interface. Overrides are stored in the database and
    validated against the closed specification in RUNTIME_SPEC.

Environment variables GREENSEA_<SECTION>_<KEY> override the TOML file
(for example GREENSEA_LLAMA_API_KEY, GREENSEA_SERVER_AUTH_TOKEN).
"""

from __future__ import annotations

import copy
import os
import tomllib
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any


DEFAULT_CONFIG_PATH = "/etc/greensea/greensea.toml"


@dataclass(frozen=True)
class ServerConfig:
    host: str = "127.0.0.1"
    port: int = 8765
    data_dir: str = "/var/lib/greensea"
    # Empty = no login (only acceptable when bound to 127.0.0.1 / behind a trusted proxy).
    auth_token: str = ""


@dataclass(frozen=True)
class LlamaConfig:
    base_url: str = "http://127.0.0.1:8080"
    api_key: str = ""
    # Only needed when llama-server runs in router (multi-model) mode.
    model: str = ""


# key -> (kind, default, constraint). kind: int | float | str | bool | choice.
# For int/float the constraint is (min, max); for choice a tuple of allowed values;
# for str the max length.
RUNTIME_SPEC: dict[str, dict[str, tuple[str, Any, Any]]] = {
    "generation": {
        "max_tokens": ("int", 2048, (64, 32768)),
        "temperature": ("float", 0.6, (0.0, 2.0)),
        "top_p": ("float", 0.95, (0.0, 1.0)),
        "structured_output": ("choice", "json_schema", ("json_schema", "json_object", "off")),
        "store_reasoning": ("bool", True, None),
    },
    "context": {
        # 0 = read the per-slot n_ctx from llama-server /props.
        "n_ctx": ("int", 0, (0, 4_194_304)),
        "rotate_at": ("float", 0.75, (0.30, 0.95)),
        "checkpoint_share": ("float", 0.35, (0.10, 0.60)),
        # 0 = unlimited; otherwise rotate after this many turns in one session.
        "max_session_turns": ("int", 0, (0, 10_000)),
        "progress_log_items": ("int", 20, (3, 200)),
        "artifact_read_chars": ("int", 6000, (500, 200_000)),
    },
    "scheduler": {
        # 0 = use llama-server total_slots.
        "max_parallel": ("int", 0, (0, 64)),
        "aging_seconds": ("int", 180, (10, 3600)),
    },
    "timeouts": {
        "first_token_seconds": ("int", 900, (10, 86_400)),
        "stall_seconds": ("int", 180, (5, 86_400)),
        "turn_seconds": ("int", 3600, (30, 172_800)),
        "health_interval_seconds": ("int", 15, (2, 3600)),
    },
    "reviewer": {
        "mode": ("choice", "terminal", ("off", "terminal", "every_turn")),
        "max_tokens": ("int", 600, (64, 8192)),
        "max_rejections": ("int", 2, (1, 10)),
    },
    "missions": {
        "default_max_turns": ("int", 200, (1, 1_000_000)),
        "default_priority": ("choice", "NORMAL", ("LOW", "NORMAL", "HIGH", "URGENT")),
    },
}


class SettingsError(ValueError):
    pass


def _coerce(kind: str, value: Any, constraint: Any, where: str) -> Any:
    if kind == "bool":
        if isinstance(value, bool):
            return value
        raise SettingsError(f"{where}: expected boolean")
    if kind == "int":
        if isinstance(value, bool) or not isinstance(value, (int, float)) or int(value) != value:
            raise SettingsError(f"{where}: expected integer")
        lo, hi = constraint
        v = int(value)
        if not lo <= v <= hi:
            raise SettingsError(f"{where}: {v} outside {lo}..{hi}")
        return v
    if kind == "float":
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            raise SettingsError(f"{where}: expected number")
        lo, hi = constraint
        v = float(value)
        if not lo <= v <= hi:
            raise SettingsError(f"{where}: {v} outside {lo}..{hi}")
        return v
    if kind == "choice":
        if value not in constraint:
            raise SettingsError(f"{where}: must be one of {', '.join(constraint)}")
        return value
    if kind == "str":
        if not isinstance(value, str) or len(value) > constraint:
            raise SettingsError(f"{where}: expected string of at most {constraint} chars")
        return value
    raise SettingsError(f"{where}: unknown kind {kind}")


def runtime_defaults() -> dict[str, dict[str, Any]]:
    return {sec: {k: spec[1] for k, spec in keys.items()} for sec, keys in RUNTIME_SPEC.items()}


def validate_runtime_patch(patch: Any) -> dict[str, dict[str, Any]]:
    """Validate a (partial) runtime settings patch. Unknown keys are errors."""
    if not isinstance(patch, dict):
        raise SettingsError("settings patch must be an object")
    out: dict[str, dict[str, Any]] = {}
    for sec, values in patch.items():
        if sec not in RUNTIME_SPEC:
            raise SettingsError(f"unknown section {sec!r}")
        if not isinstance(values, dict):
            raise SettingsError(f"{sec}: must be an object")
        for key, value in values.items():
            spec = RUNTIME_SPEC[sec].get(key)
            if spec is None:
                raise SettingsError(f"unknown setting {sec}.{key}")
            out.setdefault(sec, {})[key] = _coerce(spec[0], value, spec[2], f"{sec}.{key}")
    return out


def merge_runtime(base: dict[str, dict[str, Any]], patch: dict[str, dict[str, Any]]) -> dict[str, dict[str, Any]]:
    merged = copy.deepcopy(base)
    for sec, values in patch.items():
        merged.setdefault(sec, {}).update(values)
    return merged


@dataclass(frozen=True)
class AppConfig:
    server: ServerConfig = field(default_factory=ServerConfig)
    llama: LlamaConfig = field(default_factory=LlamaConfig)
    # Runtime defaults as configured in the TOML file (before database overrides).
    runtime_defaults: dict[str, dict[str, Any]] = field(default_factory=runtime_defaults)

    @property
    def db_path(self) -> Path:
        return Path(self.server.data_dir) / "greensea.sqlite3"


def _env_override(section: str, key: str, current: Any) -> Any:
    raw = os.environ.get(f"GREENSEA_{section.upper()}_{key.upper()}")
    if raw is None:
        return current
    if isinstance(current, bool):
        return raw.strip().lower() in ("1", "true", "yes", "on")
    if isinstance(current, int):
        return int(raw)
    if isinstance(current, float):
        return float(raw)
    return raw


def load_config(path: str | os.PathLike | None = None) -> AppConfig:
    data: dict[str, Any] = {}
    if path is not None:
        p = Path(path)
        if p.exists():
            with p.open("rb") as fh:
                data = tomllib.load(fh)
        elif str(path) != DEFAULT_CONFIG_PATH:
            raise FileNotFoundError(f"config file not found: {p}")

    def section(name: str, cls):
        raw = data.get(name, {})
        if not isinstance(raw, dict):
            raise SettingsError(f"[{name}] must be a table")
        defaults = cls()
        values = {}
        for fname in cls.__dataclass_fields__:
            current = raw.get(fname, getattr(defaults, fname))
            values[fname] = _env_override(name, fname, current)
        unknown = set(raw) - set(cls.__dataclass_fields__)
        if unknown:
            raise SettingsError(f"[{name}] unknown keys: {', '.join(sorted(unknown))}")
        return cls(**values)

    server = section("server", ServerConfig)
    llama = section("llama", LlamaConfig)
    if not isinstance(server.port, int) or not 1 <= server.port <= 65535:
        raise SettingsError("server.port must be 1..65535")
    if not str(llama.base_url).startswith(("http://", "https://")):
        raise SettingsError("llama.base_url must start with http:// or https://")

    runtime_patch = {sec: data[sec] for sec in RUNTIME_SPEC if sec in data}
    runtime = merge_runtime(runtime_defaults(), validate_runtime_patch(runtime_patch))
    return AppConfig(server=server, llama=llama, runtime_defaults=runtime)
