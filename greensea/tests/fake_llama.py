"""A scripted stand-in for llama-server, faithful to the parts GreenSea uses.

Wire format follows llama.cpp tools/server (2026-10): /health, /props,
/tokenize, /v1/chat/completions with SSE streaming, stream_options.include_usage
(final chunk with empty choices + usage + timings), mid-stream errors as
`data: {"error": {...}}`, and exceed_context_size_error with n_prompt_tokens/n_ctx.
Tokens are approximated as 4 characters each.
"""

from __future__ import annotations

import asyncio
import json
from dataclasses import dataclass, field
from typing import Any, Callable

from aiohttp import web


def tokens_of(text: str) -> int:
    return max(1, (len(text) + 3) // 4)


@dataclass
class Reply:
    content: str = ""
    finish_reason: str = "stop"
    reasoning: str = ""
    error: dict | None = None          # HTTP error before streaming: {"status":..., "type":..., "message":...}
    midstream_error: str = ""          # error after first chunk
    delay_s: float = 0.0               # before first token
    stall_after_first: float = 0.0     # stall after the first token


@dataclass
class FakeLlama:
    n_ctx: int = 8192
    total_slots: int = 2
    healthy: bool = True
    responder: Callable[[dict], Reply] | None = None
    reviewer: Callable[[dict], Reply] | None = None
    requests: list[dict] = field(default_factory=list)
    active: int = 0
    max_active: int = 0

    def app(self) -> web.Application:
        app = web.Application()
        app.router.add_get("/health", self.health)
        app.router.add_get("/props", self.props)
        app.router.add_post("/tokenize", self.tokenize)
        app.router.add_post("/v1/chat/completions", self.chat)
        return app

    async def health(self, request: web.Request) -> web.Response:
        if not self.healthy:
            return web.json_response({"error": {"code": 503, "message": "Loading model",
                                                "type": "unavailable_error"}}, status=503)
        return web.json_response({"status": "ok"})

    async def props(self, request: web.Request) -> web.Response:
        return web.json_response({
            "default_generation_settings": {"n_ctx": self.n_ctx, "params": {}},
            "total_slots": self.total_slots, "model_path": "/models/fake.gguf",
            "build_info": "b0-fake", "is_sleeping": False,
        })

    async def tokenize(self, request: web.Request) -> web.Response:
        body = await request.json()
        return web.json_response({"tokens": list(range(tokens_of(body.get("content", ""))))})

    def _prompt_tokens(self, body: dict) -> int:
        return sum(tokens_of(m.get("content", "")) + 4 for m in body.get("messages", []))

    async def chat(self, request: web.Request) -> web.StreamResponse:
        body = await request.json()
        self.requests.append(body)
        is_review = "greensea_review_v1" in json.dumps(body.get("response_format") or {})
        responder = self.reviewer if is_review and self.reviewer else self.responder
        reply = responder(body) if responder else Reply(content="{}")
        n_prompt = self._prompt_tokens(body)
        if n_prompt >= self.n_ctx:
            return web.json_response({"error": {
                "code": 400, "type": "exceed_context_size_error",
                "message": f"request ({n_prompt} tokens) exceeds the available context size ({self.n_ctx} tokens)",
                "n_prompt_tokens": n_prompt, "n_ctx": self.n_ctx}}, status=400)
        if reply.error:
            return web.json_response({"error": {"code": reply.error.get("status", 500),
                                                "type": reply.error.get("type", "server_error"),
                                                "message": reply.error.get("message", "boom")}},
                                     status=reply.error.get("status", 500))
        usage = {"prompt_tokens": n_prompt, "completion_tokens": tokens_of(reply.content),
                 "total_tokens": n_prompt + tokens_of(reply.content),
                 "prompt_tokens_details": {"cached_tokens": 0}}
        timings = {"cache_n": 0, "prompt_n": n_prompt, "predicted_n": tokens_of(reply.content)}
        if not body.get("stream"):
            return web.json_response({
                "id": "chatcmpl-fake", "object": "chat.completion",
                "choices": [{"index": 0, "finish_reason": reply.finish_reason,
                             "message": {"role": "assistant", "content": reply.content}}],
                "usage": usage, "timings": timings})
        self.active += 1
        self.max_active = max(self.max_active, self.active)
        resp = web.StreamResponse(headers={"Content-Type": "text/event-stream"})
        try:
            await resp.prepare(request)

            async def send(obj: Any) -> None:
                await resp.write(f"data: {json.dumps(obj)}\n\n".encode())

            if reply.delay_s:
                await asyncio.sleep(reply.delay_s)
            base = {"id": "chatcmpl-fake", "object": "chat.completion.chunk", "model": "fake"}
            if reply.reasoning:
                await send({**base, "choices": [{"index": 0, "delta": {"reasoning_content": reply.reasoning},
                                                 "finish_reason": None}]})
            pieces = [reply.content[i:i + 7] for i in range(0, len(reply.content), 7)] or [""]
            for n, piece in enumerate(pieces):
                await send({**base, "choices": [{"index": 0, "delta": {"content": piece}, "finish_reason": None}]})
                if n == 0 and reply.midstream_error:
                    await send({"error": {"code": 500, "type": "server_error", "message": reply.midstream_error}})
                    return resp
                if n == 0 and reply.stall_after_first:
                    await asyncio.sleep(reply.stall_after_first)
            await send({**base, "choices": [{"index": 0, "delta": {}, "finish_reason": reply.finish_reason}]})
            await send({**base, "choices": [], "usage": usage, "timings": timings})
            await resp.write(b"data: [DONE]\n\n")
            return resp
        finally:
            self.active -= 1


def worker_reply(*, status: str = "CONTINUE", summary: str = "did a step", output: str = "",
                 next_step: str = "next", memory: list | None = None, artifacts: list | None = None,
                 control: list | None = None, question: str = "", blockers: list | None = None) -> Reply:
    return Reply(content=json.dumps({
        "output": output, "artifacts": artifacts or [], "memory": memory or [], "summary": summary,
        "status": status, "nextStep": next_step, "blockers": blockers or [], "question": question,
        "control": control or []}))


def last_user(body: dict) -> str:
    return [m for m in body["messages"] if m["role"] == "user"][-1]["content"]
