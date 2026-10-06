"""Command line entry point: `greensea --config /etc/greensea/greensea.toml`."""

from __future__ import annotations

import argparse
import logging
import os
import sys

from aiohttp import web

from . import APP_NAME, APP_VERSION
from .config import DEFAULT_CONFIG_PATH, SettingsError, load_config


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="greensea", description=f"{APP_NAME} {APP_VERSION}")
    parser.add_argument("--config", default=os.environ.get("GREENSEA_CONFIG", DEFAULT_CONFIG_PATH),
                        help=f"TOML configuration file (default {DEFAULT_CONFIG_PATH})")
    parser.add_argument("--check", action="store_true", help="validate the configuration and exit")
    parser.add_argument("--log-level", default=os.environ.get("GREENSEA_LOG_LEVEL", "INFO"))
    parser.add_argument("--version", action="version", version=f"{APP_NAME} {APP_VERSION}")
    args = parser.parse_args(argv)

    logging.basicConfig(level=args.log_level.upper(),
                        format="%(levelname)s %(name)s: %(message)s", stream=sys.stderr)
    try:
        config = load_config(args.config)
    except (SettingsError, FileNotFoundError, ValueError) as exc:
        print(f"greensea: configuration error: {exc}", file=sys.stderr)
        return 2
    if args.check:
        print(f"configuration OK: listen {config.server.host}:{config.server.port}, "
              f"data {config.server.data_dir}, llama {config.llama.base_url}, "
              f"auth {'on' if config.server.auth_token else 'OFF'}")
        return 0
    if not config.server.auth_token and config.server.host not in ("127.0.0.1", "::1", "localhost"):
        logging.getLogger("greensea").warning(
            "server.auth_token is empty while listening on %s: anyone who can reach the port controls GreenSea",
            config.server.host)

    from .web import build_app  # imported late so --check works without side effects
    url = f"http://{config.server.host}:{config.server.port}/"
    try:
        # aiohttp calls `print` once the socket is bound, so "listening" is only logged on success.
        web.run_app(build_app(config), host=config.server.host, port=config.server.port,
                    access_log=None, shutdown_timeout=30,
                    print=lambda _msg: logging.getLogger("greensea.web").info("listening on %s", url))
    except OSError as exc:  # e.g. address already in use, permission denied on data_dir
        print(f"greensea: {exc}", file=sys.stderr)
        return 1
    except RuntimeError as exc:
        if "database schema" not in str(exc):
            raise
        print(f"greensea: {exc}", file=sys.stderr)  # newer database than this version
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
