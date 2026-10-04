"""LLM client: local models run through llama.cpp (llama-server, OpenAI API),
external models through their own OpenAI-compatible provider."""
from __future__ import annotations

import json

import httpx

from . import config as cfg
from . import engine


def model_config(name: str | None) -> dict:
    """Config entry for a model name (``{}`` when the name is unknown)."""
    for m in cfg.CONFIG.get("models", []):
        if m.get("name") == name:
            return m
    return {}


def api_credentials(name: str | None) -> tuple[str, str] | None:
    """``(base_url, api_key)`` when *name* is an external API model, else ``None``.

    A model is treated as external as soon as it carries its own ``base_url``;
    local models (served by llama.cpp) leave that field empty.
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


def _local_payload(name: str, messages: list[dict], *, max_tokens: int,
                   temperature: float, stream: bool = False) -> dict:
    """OpenAI chat-completions body tuned for a local Qwen-style model.

    ``enable_thinking=false`` keeps Qwen3 thinking models from burning their
    first tokens (and the reply) on hidden reasoning.
    """
    return {
        "model": name,
        "messages": messages,
        "stream": stream,
        "max_tokens": max_tokens,
        "temperature": temperature,
        "chat_template_kwargs": {"enable_thinking": False},
    }


def _first_message(data: dict) -> dict:
    try:
        return (data.get("choices") or [{}])[0].get("message") or {}
    except (AttributeError, IndexError, TypeError):
        return {}


async def _local_post(name: str, payload: dict, read_timeout: float) -> dict:
    base = await engine.ensure(name)
    timeout = httpx.Timeout(connect=10, read=read_timeout, write=60, pool=None)
    async with httpx.AsyncClient(timeout=timeout) as c:
        r = await c.post(_completions_url(base), json=payload)
        if r.status_code >= 400:
            raise RuntimeError(f"引擎 HTTP {r.status_code}: {r.text[:300]}")
        return r.json()


async def local_probe(name: str, prompt: str = "请用一句话介绍你自己。",
                      max_tokens: int = 200) -> dict:
    """Short non-streaming generation against a local model.

    Loads the model first (cold start excluded from the timing) then times a
    real generation and reports tokens + tokens/s so the admin dashboard can
    prove a model works and spot "长时间不输出" (slow / stalled) models.
    """
    import time as _time

    await engine.ensure(name)   # cold load, not counted below
    payload = _local_payload(name, [{"role": "user", "content": prompt}],
                             max_tokens=max_tokens, temperature=0.6)
    started = _time.time()
    data = await _local_post(name, payload, read_timeout=300)
    wall = _time.time() - started
    msg = _first_message(data)
    reply = (msg.get("content") or msg.get("reasoning_content") or "").strip()
    usage = data.get("usage") or {}
    gen_tokens = int(usage.get("completion_tokens") or 0)
    return {
        "ok": True,
        "reply": reply[:300],
        "wall_seconds": round(wall, 2),
        "load_seconds": 0,
        "gen_tokens": gen_tokens,
        "gen_seconds": round(wall, 2),
        "tokens_per_second": round(gen_tokens / wall, 2) if wall else 0,
    }


async def raw_chat(name: str, prompt: str, max_tokens: int = 900,
                   temperature: float = 0.4) -> str:
    """Single non-streaming turn against a local model.

    Unlike :func:`local_probe` the full (untruncated) reply is returned, which
    lets callers ask a model to emit a complete JSON document.
    """
    payload = _local_payload(name, [{"role": "user", "content": prompt}],
                             max_tokens=max_tokens, temperature=temperature)
    data = await _local_post(name, payload, read_timeout=180)
    msg = _first_message(data)
    return (msg.get("content") or msg.get("reasoning_content") or "").strip()


async def health() -> dict:
    """Engine status: which local models are installed and which are resident."""
    st = engine.status()
    return {
        "ok": bool(st.get("installed")),
        "models": st.get("installed", []),
        "running": st.get("running", []),
        "engine_path": st.get("engine_path", ""),
        "model": cfg.CONFIG["model"],
    }


def _size_bytes(name: str) -> int:
    return int(model_config(name).get("size_mb") or 0) * 1024 * 1024


async def ps() -> dict:
    """Models currently resident in VRAM (live llama-server instances).

    Used by the admin dashboard to show, in real time, which model is loaded
    on the GPU right now. VRAM is approximated from the configured model size.
    """
    st = engine.status()
    models = []
    for inst in st.get("running", []):
        size = _size_bytes(inst["name"])
        models.append({
            "name": inst["name"],
            "size": size,
            "vram": size,
            "gpu_ratio": 100 if inst.get("ready") else 0,
            "expires_at": None,
            "port": inst.get("port"),
            "idle_seconds": inst.get("idle_seconds"),
        })
    return {"ok": bool(models), "models": models}


def _merge_tool_calls(acc: list[dict], new: list[dict]) -> None:
    """Accumulate streamed tool_call fragments (the model may split args)."""
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
    local: bool = False,
) -> dict:
    """One full turn against an OpenAI-compatible endpoint.

    Used for both external providers (DeepSeek / OpenAI / SiliconFlow …) and
    the local llama.cpp server. ``local`` disables Qwen thinking mode so the
    answer lands in ``content`` instead of hidden reasoning.
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
    if local:
        payload["chat_template_kwargs"] = {"enable_thinking": False}

    content_parts: list[str] = []
    reasoning_parts: list[str] = []
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
                    elif delta.get("reasoning_content"):
                        # Thinking model that ignored enable_thinking: keep the
                        # reasoning so the turn is not surfaced as empty.
                        reasoning_parts.append(delta["reasoning_content"])
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
    content = "".join(content_parts)
    if not content and reasoning_parts:
        content = "".join(reasoning_parts)
    out: dict = {"role": "assistant", "content": content}
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
    """One full turn for the selected model (external API or local engine)."""
    name = model or cfg.CONFIG["model"]
    creds = api_credentials(name)
    if creds:
        return await _openai_once(messages, tools, creds[0], creds[1], name,
                                  on_delta=on_delta, on_tool_progress=on_tool_progress)
    base = await engine.ensure(name)
    return await _openai_once(messages, tools, base, "", name,
                              on_delta=on_delta, on_tool_progress=on_tool_progress,
                              local=True)
