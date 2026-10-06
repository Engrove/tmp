"""Client for llama.cpp's llama-server.

Verified against llama.cpp master (tools/server, 2026-10):
  * GET  /health          200 {"status":"ok"} | 503 while loading (public, no API key)
  * GET  /props           default_generation_settings.n_ctx (per slot), total_slots,
                          model_path, build_info, is_sleeping
  * POST /tokenize        {"content": str} -> {"tokens": [...]}
  * POST /v1/chat/completions (stream=true, SSE "data: {...}" lines, "data: [DONE]")
      - stream_options.include_usage=true adds a final chunk with "usage"
        (prompt_tokens = full prompt incl. cached tokens; cached in
        prompt_tokens_details.cached_tokens) and "timings";
      - errors before the first chunk: non-200 HTTP with {"error": {...}};
        errors mid-stream: "data: {"error": {...}}";
      - context overflow: error type "exceed_context_size_error" with n_prompt_tokens, n_ctx;
      - response_format {"type":"json_schema","json_schema":{"schema":...}} or
        {"type":"json_object"} constrains output by grammar;
      - delta.reasoning_content carries reasoning for reasoning models.
Closing the HTTP connection makes llama-server stop the generation.
"""

from __future__ import annotations

import asyncio
import json
import time
from dataclasses import dataclass, field
from typing import Any, Awaitable, Callable

import aiohttp


class ErrorKind:
    CONNECT = "CONNECT"
    TIMEOUT_FIRST_TOKEN = "TIMEOUT_FIRST_TOKEN"
    STALL = "STALL"
    TIMEOUT_TURN = "TIMEOUT_TURN"
    HTTP = "HTTP"
    CONTEXT_EXCEEDED = "CONTEXT_EXCEEDED"
    PROTOCOL = "PROTOCOL"


class LlamaError(Exception):
    def __init__(self, kind: str, message: str, *, status: int = 0, transient: bool = True,
                 data: dict | None = None):
        super().__init__(f"{kind}: {message}")
        self.kind = kind
        self.message = message
        self.status = status
        self.transient = transient
        self.data = data or {}

    def as_dict(self) -> dict:
        return {"kind": self.kind, "message": self.message[:1000], "status": self.status,
                "transient": self.transient}


@dataclass
class ChatResult:
    content: str = ""
    reasoning: str = ""
    finish_reason: str = ""
    completion_id: str = ""
    usage: dict = field(default_factory=dict)
    timings: dict = field(default_factory=dict)
    elapsed_s: float = 0.0
    first_token_s: float | None = None

    @property
    def prompt_tokens(self) -> int | None:
        v = self.usage.get("prompt_tokens")
        return int(v) if isinstance(v, (int, float)) else None

    @property
    def completion_tokens(self) -> int | None:
        v = self.usage.get("completion_tokens")
        return int(v) if isinstance(v, (int, float)) else None

    @property
    def cached_tokens(self) -> int | None:
        details = self.usage.get("prompt_tokens_details") or {}
        v = details.get("cached_tokens") if isinstance(details, dict) else None
        if isinstance(v, (int, float)):
            return int(v)
        v = self.timings.get("cache_n")
        return int(v) if isinstance(v, (int, float)) else None


def _classify_error_body(status: int, body: Any) -> LlamaError:
    err = body.get("error") if isinstance(body, dict) else None
    if isinstance(err, dict):
        etype = str(err.get("type") or "")
        message = str(err.get("message") or etype or f"HTTP {status}")
        code = int(err.get("code") or status or 0)
        if etype == "exceed_context_size_error":
            return LlamaError(ErrorKind.CONTEXT_EXCEEDED, message, status=code, transient=False,
                              data={"n_prompt_tokens": err.get("n_prompt_tokens", body.get("n_prompt_tokens")),
                                    "n_ctx": err.get("n_ctx", body.get("n_ctx"))})
        status = code or status
    else:
        message = str(body)[:500] if body else f"HTTP {status}"
    # 408/429/5xx are worth retrying; other 4xx mean the request itself is wrong.
    transient = status in (0, 408, 429) or status >= 500
    return LlamaError(ErrorKind.HTTP, message, status=status, transient=transient)


DeltaCallback = Callable[[str, str], Awaitable[None] | None]


class LlamaClient:
    def __init__(self, base_url: str, *, api_key: str = "", model: str = "",
                 session: aiohttp.ClientSession | None = None):
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key
        self.model = model
        self._session = session
        self._own_session = session is None

    async def __aenter__(self) -> "LlamaClient":
        return self

    async def __aexit__(self, *exc: Any) -> None:
        await self.close()

    def _http(self) -> aiohttp.ClientSession:
        if self._session is None or self._session.closed:
            self._session = aiohttp.ClientSession()
            self._own_session = True
        return self._session

    async def close(self) -> None:
        if self._own_session and self._session is not None and not self._session.closed:
            await self._session.close()

    def _headers(self) -> dict[str, str]:
        headers = {"Content-Type": "application/json"}
        if self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"
        return headers

    async def _get_json(self, path: str, timeout: float) -> tuple[int, Any]:
        try:
            async with self._http().get(self.base_url + path, headers=self._headers(),
                                        timeout=aiohttp.ClientTimeout(total=timeout)) as resp:
                try:
                    body = await resp.json(content_type=None)
                except (json.JSONDecodeError, aiohttp.ContentTypeError, UnicodeDecodeError):
                    body = None
                return resp.status, body
        except asyncio.TimeoutError as exc:
            raise LlamaError(ErrorKind.CONNECT, f"timeout on GET {path}") from exc
        except aiohttp.ClientError as exc:
            raise LlamaError(ErrorKind.CONNECT, f"{type(exc).__name__}: {exc}") from exc

    async def _post_json(self, path: str, payload: dict, timeout: float) -> dict:
        try:
            async with self._http().post(self.base_url + path, json=payload, headers=self._headers(),
                                         timeout=aiohttp.ClientTimeout(total=timeout)) as resp:
                try:
                    body = await resp.json(content_type=None)
                except (json.JSONDecodeError, aiohttp.ContentTypeError, UnicodeDecodeError):
                    body = None
                if resp.status != 200:
                    raise _classify_error_body(resp.status, body)
                if not isinstance(body, dict):
                    raise LlamaError(ErrorKind.PROTOCOL, f"non-JSON response from {path}")
                return body
        except asyncio.TimeoutError as exc:
            raise LlamaError(ErrorKind.TIMEOUT_TURN, f"timeout on POST {path}") from exc
        except aiohttp.ClientError as exc:
            raise LlamaError(ErrorKind.CONNECT, f"{type(exc).__name__}: {exc}") from exc

    async def health(self, timeout: float = 5.0) -> tuple[bool, str]:
        status, body = await self._get_json("/health", timeout)
        if status == 200:
            return True, "ok"
        if isinstance(body, dict) and isinstance(body.get("error"), dict):
            return False, str(body["error"].get("message") or f"HTTP {status}")
        return False, f"HTTP {status}"

    async def props(self, timeout: float = 10.0) -> dict:
        path = "/props" + (f"?model={self.model}" if self.model else "")
        status, body = await self._get_json(path, timeout)
        if status != 200 or not isinstance(body, dict):
            raise _classify_error_body(status, body)
        return body

    async def count_tokens(self, text: str, timeout: float = 30.0) -> int:
        payload: dict[str, Any] = {"content": text}
        if self.model:
            payload["model"] = self.model
        body = await self._post_json("/tokenize", payload, timeout)
        tokens = body.get("tokens")
        if not isinstance(tokens, list):
            raise LlamaError(ErrorKind.PROTOCOL, "tokenize response without tokens")
        return len(tokens)

    def _chat_payload(self, payload: dict, stream: bool) -> dict:
        body = dict(payload)
        body["stream"] = stream
        if stream:
            body["stream_options"] = {"include_usage": True}
        if self.model and "model" not in body:
            body["model"] = self.model
        return body

    async def chat(self, payload: dict, *, timeout: float) -> ChatResult:
        """Non-streaming chat completion (used by the reviewer)."""
        started = time.monotonic()
        body = await self._post_json("/v1/chat/completions", self._chat_payload(payload, False), timeout)
        choices = body.get("choices") or []
        if not choices or not isinstance(choices[0], dict):
            raise LlamaError(ErrorKind.PROTOCOL, "chat response without choices")
        msg = choices[0].get("message") or {}
        return ChatResult(
            content=str(msg.get("content") or ""),
            reasoning=str(msg.get("reasoning_content") or ""),
            finish_reason=str(choices[0].get("finish_reason") or ""),
            completion_id=str(body.get("id") or ""),
            usage=body.get("usage") if isinstance(body.get("usage"), dict) else {},
            timings=body.get("timings") if isinstance(body.get("timings"), dict) else {},
            elapsed_s=time.monotonic() - started,
        )

    async def stream_chat(self, payload: dict, *, on_delta: DeltaCallback | None,
                          first_token_timeout: float, stall_timeout: float,
                          turn_timeout: float) -> ChatResult:
        """Streaming chat completion with liveness timeouts.

        first_token_timeout: max wait for the first content/reasoning delta
            (covers prompt processing, which can take minutes on CPU);
        stall_timeout: max gap between received lines once tokens flow;
        turn_timeout: max total duration.
        """
        try:
            return await asyncio.wait_for(
                self._stream(payload, on_delta, first_token_timeout, stall_timeout),
                timeout=turn_timeout,
            )
        except asyncio.TimeoutError as exc:
            raise LlamaError(ErrorKind.TIMEOUT_TURN, f"turn exceeded {turn_timeout:.0f} s") from exc

    async def _stream(self, payload: dict, on_delta: DeltaCallback | None,
                      first_token_timeout: float, stall_timeout: float) -> ChatResult:
        result = ChatResult()
        started = time.monotonic()
        content_parts: list[str] = []
        reasoning_parts: list[str] = []
        got_token = False
        body = self._chat_payload(payload, True)
        try:
            async with self._http().post(
                self.base_url + "/v1/chat/completions", json=body, headers=self._headers(),
                timeout=aiohttp.ClientTimeout(total=None, sock_connect=30),
            ) as resp:
                if resp.status != 200:
                    try:
                        err_body = await asyncio.wait_for(resp.json(content_type=None), timeout=30)
                    except Exception:
                        err_body = None
                    raise _classify_error_body(resp.status, err_body)
                while True:
                    wait = stall_timeout if got_token else first_token_timeout
                    try:
                        raw = await asyncio.wait_for(resp.content.readline(), timeout=wait)
                    except asyncio.TimeoutError as exc:
                        if got_token:
                            raise LlamaError(ErrorKind.STALL, f"no data for {wait:.0f} s") from exc
                        raise LlamaError(ErrorKind.TIMEOUT_FIRST_TOKEN,
                                         f"no token within {wait:.0f} s") from exc
                    if not raw:
                        break  # connection closed by server
                    line = raw.decode("utf-8", errors="replace").strip()
                    if not line or line.startswith(":") or not line.startswith("data:"):
                        continue
                    data = line[5:].strip()
                    if data == "[DONE]":
                        break
                    try:
                        chunk = json.loads(data)
                    except json.JSONDecodeError:
                        raise LlamaError(ErrorKind.PROTOCOL, f"invalid SSE JSON: {data[:200]}")
                    if not isinstance(chunk, dict):
                        continue
                    if "error" in chunk:
                        raise _classify_error_body(500, chunk if isinstance(chunk.get("error"), dict)
                                                   else {"error": {"message": str(chunk["error"])}})
                    if chunk.get("id"):
                        result.completion_id = str(chunk["id"])
                    if isinstance(chunk.get("usage"), dict):
                        result.usage = chunk["usage"]
                    if isinstance(chunk.get("timings"), dict):
                        result.timings = chunk["timings"]
                    for choice in chunk.get("choices") or []:
                        if not isinstance(choice, dict):
                            continue
                        delta = choice.get("delta") or {}
                        c = delta.get("content") or ""
                        r = delta.get("reasoning_content") or ""
                        if c or r:
                            if not got_token:
                                result.first_token_s = time.monotonic() - started
                            got_token = True
                            if c:
                                content_parts.append(c)
                            if r:
                                reasoning_parts.append(r)
                            if on_delta is not None:
                                maybe = on_delta(c, r)
                                if asyncio.iscoroutine(maybe):
                                    await maybe
                        if choice.get("finish_reason"):
                            result.finish_reason = str(choice["finish_reason"])
        except aiohttp.ClientError as exc:
            raise LlamaError(ErrorKind.CONNECT, f"{type(exc).__name__}: {exc}") from exc
        result.content = "".join(content_parts)
        result.reasoning = "".join(reasoning_parts)
        result.elapsed_s = time.monotonic() - started
        if not result.finish_reason:
            raise LlamaError(ErrorKind.PROTOCOL, "stream ended without finish_reason")
        return result
