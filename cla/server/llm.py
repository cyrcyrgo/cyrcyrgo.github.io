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


def model_config(name: str | None) -> dict:
    """Config entry for a model name (``{}`` when the name is unknown)."""
    for m in cfg.CONFIG.get("models", []):
        if m.get("name") == name:
            return m
    return {}


def api_credentials(name: str | None) -> tuple[str, str] | None:
    """``(base_url, api_key)`` when *name* is an external API model, else ``None``.

    A model is treated as external as soon as it carries its own ``base_url``;
    local Ollama models leave that field empty.
    """
    m = model_config(name)
    base = (m.get("base_url") or "").strip()
    if not base:
        return None
    ref = m.get("api_key_ref") or ""
    key = (cfg.CONFIG.get("api_keys") or {}).get(ref, "")
    return base, key


def _completions_url(base: str) -> str:
    """Normalise a provider base URL to its chat-completions endpoint.

    Accepts ``https://api.deepseek.com``, ``.../v1`` or a full endpoint and
    always yields one that ends in ``/chat/completions``.
    """
    b = base.rstrip("/")
    if b.endswith("/chat/completions"):
        return b
    return b + "/chat/completions"


async def probe(base_url: str, api_key: str, model: str) -> str:
    """Minimal round-trip used by the admin model editor's "test" button.

    Returns the provider's reply text, or raises with the provider's message
    so the dashboard can show exactly why a key / URL / model is rejected.
    """
    url = _completions_url(base_url)
    headers = {"Content-Type": "application/json"}
    if api_key:
        headers["Authorization"] = "Bearer " + api_key
    payload = {"model": model, "messages": [{"role": "user", "content": "请只回复两个字：连通"}],
               "max_tokens": 128, "stream": False}
    timeout = httpx.Timeout(connect=15, read=60, write=30, pool=None)
    async with httpx.AsyncClient(timeout=timeout) as c:
        r = await c.post(url, json=payload, headers=headers)
        if r.status_code >= 400:
            raise RuntimeError(f"HTTP {r.status_code}: {r.text[:300]}")
        data = r.json()
    try:
        msg = data["choices"][0]["message"]
        return (msg.get("content") or msg.get("reasoning_content") or "").strip() or "(空回复)"
    except (KeyError, IndexError, TypeError):
        return json.dumps(data, ensure_ascii=False)[:200]


async def health() -> dict:
    try:
        async with httpx.AsyncClient(timeout=5) as c:
            r = await c.get(f"{base_url()}/api/tags")
            r.raise_for_status()
            models = [m["name"] for m in r.json().get("models", [])]
            return {"ok": True, "models": models, "model": cfg.CONFIG["model"]}
    except Exception as exc:
        return {"ok": False, "error": str(exc), "model": cfg.CONFIG["model"]}


async def ps() -> dict:
    """Models currently loaded in memory / VRAM (Ollama /api/ps).

    Used by the admin dashboard to show, in real time, which model is
    resident on the GPU right now.
    """
    try:
        async with httpx.AsyncClient(timeout=5) as c:
            r = await c.get(f"{base_url()}/api/ps")
            r.raise_for_status()
            data = r.json()
            models = []
            for m in data.get("models", []):
                size = m.get("size") or 0
                vram = m.get("size_vram") or 0
                models.append({
                    "name": m.get("name") or m.get("model"),
                    "size": size,
                    "vram": vram,
                    "gpu_ratio": round(vram / size * 100, 1) if size else 0,
                    "expires_at": m.get("expires_at"),
                })
            return {"ok": True, "models": models}
    except Exception as exc:
        return {"ok": False, "error": str(exc), "models": []}


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


def _tool_call_size(tool_calls: list[dict]) -> tuple[str, int]:
    """(name, total argument characters) of the tool calls seen so far."""
    name = ""
    chars = 0
    for tc in tool_calls:
        fn = tc.get("function", {}) or {}
        if fn.get("name"):
            name = fn["name"]
        chars += len(fn.get("arguments") or "")
    return name, chars


async def chat_stream(messages: list[dict], tools: list[dict] | None = None,
                     model: str | None = None) -> AsyncIterator[dict]:
    """Yield raw Ollama streaming chunks (each has .message / .done)."""
    payload = {
        "model": model or cfg.CONFIG["model"],
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


def _for_openai(messages: list[dict]) -> list[dict]:
    """Normalise the agent history into strict OpenAI chat-completions shape.

    Tool messages must carry ``tool_call_id`` and assistant tool_calls must
    repeat ``id``/``type`` — providers such as DeepSeek reject anything else.
    """
    out: list[dict] = []
    for m in messages:
        role = m.get("role")
        if role == "tool":
            out.append({"role": "tool", "tool_call_id": m.get("tool_call_id", ""),
                        "content": m.get("content") or ""})
        elif role == "assistant" and m.get("tool_calls"):
            calls = []
            for i, tc in enumerate(m["tool_calls"]):
                fn = tc.get("function") or {}
                args = fn.get("arguments")
                if not isinstance(args, str):
                    args = json.dumps(args or {}, ensure_ascii=False)
                calls.append({"id": tc.get("id") or f"call_{i}", "type": "function",
                              "function": {"name": fn.get("name", ""), "arguments": args}})
            out.append({"role": "assistant", "content": m.get("content") or "",
                        "tool_calls": calls})
        else:
            out.append({"role": role, "content": m.get("content") or ""})
    return out


async def _openai_once(
    messages: list[dict],
    tools: list[dict] | None,
    base_url: str,
    api_key: str,
    model: str | None,
    on_delta=None,
    on_tool_progress=None,
) -> dict:
    """One full turn against an external OpenAI-compatible provider.

    Works with DeepSeek / OpenAI / SiliconFlow / Moonshot and similar services
    that expose ``POST {base}/chat/completions`` with SSE streaming.
    """
    url = _completions_url(base_url)
    headers = {"Content-Type": "application/json"}
    if api_key:
        headers["Authorization"] = "Bearer " + api_key
    payload: dict = {
        "model": model or "",
        "messages": _for_openai(messages),
        "stream": True,
        "stream_options": {"include_usage": True},
    }
    if tools:
        payload["tools"] = tools

    content_parts: list[str] = []
    tool_calls: list[dict] = []
    last_reported = 0
    usage = {"prompt_tokens": 0, "completion_tokens": 0,
             "total_tokens": 0, "seconds": 0.0}
    timeout = httpx.Timeout(connect=15, read=300, write=60, pool=None)
    async with httpx.AsyncClient(timeout=timeout) as c:
        async with c.stream("POST", url, json=payload, headers=headers) as r:
            if r.status_code >= 400:
                body = (await r.aread()).decode("utf-8", "replace")
                raise RuntimeError(f"API HTTP {r.status_code}: {body[:400]}")
            async for line in r.aiter_lines():
                line = (line or "").strip()
                if not line or not line.startswith("data:"):
                    continue
                data = line[5:].strip()
                if data == "[DONE]":
                    break
                try:
                    chunk = json.loads(data)
                except json.JSONDecodeError:
                    continue
                if chunk.get("error"):
                    err = chunk["error"]
                    raise RuntimeError(err.get("message") if isinstance(err, dict)
                                       else str(err))
                for choice in chunk.get("choices") or []:
                    delta = choice.get("delta") or {}
                    text = delta.get("content") or ""
                    if text:
                        content_parts.append(text)
                        if on_delta is not None:
                            await on_delta(text)
                    if delta.get("tool_calls"):
                        _merge_tool_calls(tool_calls, delta["tool_calls"])
                        if on_tool_progress is not None:
                            name, chars = _tool_call_size(tool_calls)
                            if chars - last_reported >= 64:
                                last_reported = chars
                                await on_tool_progress(name, chars)
                u = chunk.get("usage")
                if u:
                    usage["prompt_tokens"] += int(u.get("prompt_tokens") or 0)
                    usage["completion_tokens"] += int(u.get("completion_tokens") or 0)

    usage["total_tokens"] = usage["prompt_tokens"] + usage["completion_tokens"]
    out: dict = {"role": "assistant", "content": "".join(content_parts)}
    if tool_calls:
        out["tool_calls"] = tool_calls
    out["usage"] = usage
    return out


async def chat_once(
    messages: list[dict],
    tools: list[dict] | None = None,
    on_delta=None,
    on_tool_progress=None,
    model: str | None = None,
) -> dict:
    """One full turn for the selected model (external API or local Ollama)."""
    creds = api_credentials(model or cfg.CONFIG["model"])
    if creds:
        return await _openai_once(messages, tools, creds[0], creds[1], model,
                                  on_delta=on_delta, on_tool_progress=on_tool_progress)
    return await _ollama_once(messages, tools, on_delta=on_delta,
                              on_tool_progress=on_tool_progress, model=model)


async def _ollama_once(
    messages: list[dict],
    tools: list[dict] | None = None,
    on_delta=None,
    on_tool_progress=None,
    model: str | None = None,
) -> dict:
    """One full turn, assembled from the streaming endpoint.

    ``on_delta(text)`` is awaited for every token chunk so callers can stream
    the answer to the UI as it is generated. ``on_tool_progress(name, chars)``
    fires while a (potentially huge) tool-call argument is being generated,
    which on a slow local model can take minutes with no other output.

    Returns the assistant message dict, e.g.
    {"role": "assistant", "content": "...", "tool_calls": [...]}.
    """
    content_parts: list[str] = []
    tool_calls: list[dict] = []
    last_reported = 0
    usage = {"prompt_tokens": 0, "completion_tokens": 0,
             "total_tokens": 0, "seconds": 0.0}
    async for chunk in chat_stream(messages, tools=tools, model=model):
        msg = chunk.get("message") or {}
        text = msg.get("content") or ""
        if text:
            content_parts.append(text)
            if on_delta is not None:
                await on_delta(text)
        if msg.get("tool_calls"):
            _merge_tool_calls(tool_calls, msg["tool_calls"])
            if on_tool_progress is not None:
                name, chars = _tool_call_size(tool_calls)
                if chars - last_reported >= 64:
                    last_reported = chars
                    await on_tool_progress(name, chars)
        if chunk.get("done"):
            # Ollama reports real evaluated-token counts on the final chunk.
            p_tok = int(chunk.get("prompt_eval_count") or 0)
            c_tok = int(chunk.get("eval_count") or 0)
            usage["prompt_tokens"] += p_tok
            usage["completion_tokens"] += c_tok
            usage["total_tokens"] += p_tok + c_tok
            dur = chunk.get("total_duration") or 0
            if dur:
                usage["seconds"] += dur / 1e9
            break

    out: dict = {"role": "assistant", "content": "".join(content_parts)}
    if tool_calls:
        out["tool_calls"] = tool_calls
    out["usage"] = usage
    return out
