"""Thin async client for the local Ollama server (OpenAI-ish agent chat)."""
from __future__ import annotations

import json
from typing import AsyncIterator

import httpx

from . import config as cfg


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


async def chat_once(messages: list[dict], tools: list[dict] | None = None) -> dict:
    """Single non-streaming call. Returns the assistant message dict."""
    payload = {
        "model": cfg.CONFIG["model"],
        "messages": messages,
        "stream": False,
        "options": {"temperature": 0.6, "num_ctx": 16384},
    }
    if tools:
        payload["tools"] = tools
    async with httpx.AsyncClient(timeout=600) as c:
        r = await c.post(f"{base_url()}/api/chat", json=payload)
        r.raise_for_status()
        return r.json().get("message", {})


async def chat_stream(messages: list[dict], tools: list[dict] | None = None) -> AsyncIterator[dict]:
    """Yield raw Ollama streaming chunks (each has .message / .done)."""
    payload = {
        "model": cfg.CONFIG["model"],
        "messages": messages,
        "stream": True,
        "options": {"temperature": 0.6, "num_ctx": 16384},
    }
    if tools:
        payload["tools"] = tools
    async with httpx.AsyncClient(timeout=600) as c:
        async with c.stream("POST", f"{base_url()}/api/chat", json=payload) as r:
            r.raise_for_status()
            async for line in r.aiter_lines():
                if not line.strip():
                    continue
                try:
                    yield json.loads(line)
                except json.JSONDecodeError:
                    continue