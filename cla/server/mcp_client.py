"""Minimal MCP (Model Context Protocol) stdio client.

Config shape (config.local.json -> mcp_servers)::

    "mcp_servers": {
      "filesystem": {"command": ["npx", "-y", "@modelcontextprotocol/server-filesystem", "D:/yjs"]},
      "fetch":      {"command": ["uvx", "mcp-server-fetch"], "env": {"FOO": "bar"}}
    }
"""
from __future__ import annotations

import asyncio
import json
import os
from typing import Any

from . import config as cfg

_PROCS: dict[str, dict] = {}
_LOCK = asyncio.Lock()
_ID = 0


def list_servers() -> list[dict]:
    return [
        {"name": name, "command": " ".join(cfg_["command"])}
        for name, cfg_ in cfg.CONFIG.get("mcp_servers", {}).items()
    ]


def _next_id() -> int:
    global _ID
    _ID += 1
    return _ID


async def _ensure(server: str) -> dict:
    async with _LOCK:
        proc = _PROCS.get(server)
        if proc and proc["proc"].returncode is None:
            return proc
        servers = cfg.CONFIG.get("mcp_servers", {})
        if server not in servers:
            raise KeyError(f"未配置的 MCP 服务器: {server}")
        spec = servers[server]
        env = dict(os.environ)
        env.update(spec.get("env", {}))
        p = await asyncio.create_subprocess_exec(
            *spec["command"],
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            env=env,
        )
        entry = {"proc": p, "lock": asyncio.Lock()}
        _PROCS[server] = entry
        # handshake
        await _request(server, "initialize", {
            "protocolVersion": "2024-11-05",
            "capabilities": {},
            "clientInfo": {"name": "yjs-agent", "version": "1.0"},
        })
        await _notify(server, "notifications/initialized", {})
        return entry


async def _write(server: str, payload: dict) -> None:
    proc = _PROCS[server]["proc"]
    proc.stdin.write((json.dumps(payload) + "\n").encode("utf-8"))
    await proc.stdin.drain()


async def _notify(server: str, method: str, params: dict) -> None:
    await _write(server, {"jsonrpc": "2.0", "method": method, "params": params})


async def _request(server: str, method: str, params: dict, timeout: float = 60) -> Any:
    entry = _PROCS[server]
    async with entry["lock"]:
        rid = _next_id()
        await _write(server, {"jsonrpc": "2.0", "id": rid, "method": method, "params": params})
        proc = entry["proc"]

        async def _read():
            while True:
                line = await proc.stdout.readline()
                if not line:
                    raise RuntimeError("MCP 服务器已关闭")
                try:
                    msg = json.loads(line.decode("utf-8"))
                except json.JSONDecodeError:
                    continue
                if msg.get("id") == rid:
                    return msg

        msg = await asyncio.wait_for(_read(), timeout=timeout)
        if "error" in msg:
            raise RuntimeError(msg["error"].get("message", str(msg["error"])))
        return msg.get("result")


async def list_tools(server: str) -> dict:
    try:
        await _ensure(server)
        res = await _request(server, "tools/list", {})
        return {"ok": True, "server": server, "tools": res.get("tools", [])}
    except Exception as exc:  # noqa: BLE001
        return {"ok": False, "error": f"{type(exc).__name__}: {exc}"}


async def call_tool(server: str, tool: str, arguments: dict) -> dict:
    try:
        await _ensure(server)
        res = await _request(server, "tools/call", {"name": tool, "arguments": arguments}, timeout=180)
        return {"ok": True, "server": server, "tool": tool, "result": res}
    except Exception as exc:  # noqa: BLE001
        return {"ok": False, "error": f"{type(exc).__name__}: {exc}"}


async def shutdown() -> None:
    for entry in list(_PROCS.values()):
        try:
            entry["proc"].kill()
        except Exception:
            pass
    _PROCS.clear()