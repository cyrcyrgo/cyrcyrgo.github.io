"""Thin async client for the local Ollama server (OpenAI-ish agent chat)."""
from __future__ import annotations

import json
from typing import AsyncIterator

import httpx

from . import config as cfg

# Model context. The 9B model on an 8GB GPU is fastest with a modest window;
# a smaller KV cache lets more layers stay on the GPU.
NUM_CTX = 8192
KEEP_ALIVE = "30m"


def base_url() -> str:
    return cfg.CONFIG["ollama_url"].rstrip("/")


async def health() -> dict:
    try:
        async with httpx.AsyncClient(timeout=5) as c:
            r = await c.get(f"{base_url()}/api/tags")
            r.raise_for_status()
            models = [m["name"] for m in r.json().get("models", [])]
            return {"ok": True, "models": models, "model": cfg.CONFIG["model"]}
    except Exception as exc:
        return {"ok": False, "error": str(exc), "model": cfg.CONFIG["model"]}


def _merge_tool_calls(acc: list[dict], new: list[dict]) -> None:
    """Accumulate streamed tool_call fragments (Ollama may split args)."""
    for tc in new:
        idx = tc.get("index")
        fn = tc.get("function", {}) or {}
        if idx is None:
            acc.append(tc)
            continue
        while len(acc) <= idx:
            acc.append({"type": "function", "function": {"name": "", "arguments": ""}})
        slot = acc[idx]
        if tc.get("id"):
            slot["id"] = tc["id"]
        if tc.get("type"):
            slot["type"] = tc["type"]
        if fn.get("name"):
            slot["function"]["name"] = fn["name"]
        if fn.get("arguments"):
            slot["function"]["arguments"] = slot["function"].get("arguments", "") + fn["arguments"]


async def chat_stream(messages: list[dict], tools: list[dict] | None = None) -> AsyncIterator[dict]:
    """Yield raw Ollama streaming chunks (each has .message / .done)."""
    payload = {
        "model": cfg.CONFIG["model"],
        "messages": messages,
        "stream": True,
        "keep_alive": KEEP_ALIVE,
        "options": {"temperature": 0.6, "num_ctx": NUM_CTX},
    }
    if tools:
        payload["tools"] = tools
    # Streaming keeps the connection alive while the (slow) local model generates,
    # so we never hit the server's non-streaming request timeout.
    timeout = httpx.Timeout(connect=10, read=None, write=30, pool=None)
    async with httpx.AsyncClient(timeout=timeout) as c:
        async with c.stream("POST", f"{base_url()}/api/chat", json=payload) as r:
            if r.status_code >= 400:
                body = (await r.aread()).decode("utf-8", "replace")
                raise RuntimeError(f"Ollama HTTP {r.status_code}: {body[:300]}")
            async for line in r.aiter_lines():
                if not line.strip():
                    continue
                try:
                    chunk = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if chunk.get("error"):
                    raise RuntimeError(str(chunk["error"]))
                yield chunk


async def chat_once(
    messages: list[dict],
    tools: list[dict] | None = None,
    on_delta=None,
) -> dict:
    """One full turn, assembled from the streaming endpoint.

    ``on_delta(text)`` is awaited for every token chunk so callers can stream
    the answer to the UI as it is generated.

    Returns the assistant message dict, e.g.
    {"role": "assistant", "content": "...", "tool_calls": [...]}.
    """
    content_parts: list[str] = []
    tool_calls: list[dict] = []
    async for chunk in chat_stream(messages, tools=tools):
        msg = chunk.get("message") or {}
        text = msg.get("content") or ""
        if text:
            content_parts.append(text)
            if on_delta is not None:
                await on_delta(text)
        if msg.get("tool_calls"):
            _merge_tool_calls(tool_calls, msg["tool_calls"])
        if chunk.get("done"):
            break

    out: dict = {"role": "assistant", "content": "".join(content_parts)}
    if tool_calls:
        out["tool_calls"] = tool_calls
    return out