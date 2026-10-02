"""Agent tool registry: files, code execution, HTTP, browser, MCP, reporting.

The whole local machine is treated as the sandbox (per project spec). Relative
paths resolve inside the user's workspace; absolute paths are allowed so the
agent can operate on the real machine.
"""
from __future__ import annotations

import asyncio
import json
import os
import shutil
import sys
import tempfile
import time
from dataclasses import dataclass
from pathlib import Path

import httpx

from . import config as cfg
from . import store

MAX_OUT = 20000          # chars of stdout kept per command


@dataclass
class ToolContext:
    uid: str
    cid: str
    workspace: Path

    def resolve(self, path: str) -> Path:
        p = Path(path)
        if not p.is_absolute():
            p = self.workspace / p
        return p.resolve()


# --------------------------------------------------------------------------- #
# registry
# --------------------------------------------------------------------------- #
REGISTRY: dict[str, dict] = {}


def tool(name: str, description: str, parameters: dict, sensitive: bool = False):
    def deco(fn):
        REGISTRY[name] = {
            "name": name,
            "description": description,
            "parameters": parameters,
            "fn": fn,
            "sensitive": sensitive,
        }
        return fn

    return deco


def openai_schemas() -> list[dict]:
    return [
        {
            "type": "function",
            "function": {
                "name": t["name"],
                "description": t["description"],
                "parameters": t["parameters"],
            },
        }
        for t in REGISTRY.values()
    ]


async def execute(name: str, args: dict, ctx: ToolContext) -> dict:
    entry = REGISTRY.get(name)
    if not entry:
        return {"ok": False, "error": f"未知工具: {name}"}
    try:
        result = await entry["fn"](ctx, **(args or {}))
        if isinstance(result, dict):
            result.setdefault("ok", True)
            return result
        return {"ok": True, "result": result}
    except Exception as exc:  # noqa: BLE001 - surfaced to the model
        return {"ok": False, "error": f"{type(exc).__name__}: {exc}"}


def _quota_guard(ctx: ToolContext) -> str | None:
    u = store.usage(ctx.uid)
    if u["full"]:
        return "用户存储空间已满（1GB），请先清理文件后再写入。"
    return None


def _truncate(text: str, limit: int = MAX_OUT) -> str:
    if len(text) <= limit:
        return text
    return text[:limit] + f"\n...[输出被截断，共 {len(text)} 字符]"


# --------------------------------------------------------------------------- #
# filesystem
# --------------------------------------------------------------------------- #
@tool(
    "list_files",
    "列出目录内容。path 可为相对路径（默认用户工作区根目录）。",
    {
        "type": "object",
        "properties": {"path": {"type": "string", "description": "目录路径，默认 '.'"}},
    },
)
async def list_files(ctx: ToolContext, path: str = "."):
    p = ctx.resolve(path)
    if not p.exists():
        return {"ok": False, "error": f"路径不存在: {p}"}
    if p.is_file():
        return {"ok": True, "path": str(p), "size": p.stat().st_size}
    items = []
    for c in sorted(p.iterdir()):
        try:
            items.append(
                {
                    "name": c.name,
                    "type": "dir" if c.is_dir() else "file",
                    "size": c.stat().st_size if c.is_file() else None,
                }
            )
        except OSError:
            pass
    return {"ok": True, "path": str(p), "items": items}


@tool(
    "read_file",
    "读取文本文件内容。",
    {
        "type": "object",
        "properties": {
            "path": {"type": "string"},
            "max_bytes": {"type": "integer", "description": "最多读取字节数，默认 200000"},
        },
        "required": ["path"],
    },
)
async def read_file(ctx: ToolContext, path: str, max_bytes: int = 200000):
    p = ctx.resolve(path)
    if not p.is_file():
        return {"ok": False, "error": f"文件不存在: {p}"}
    data = p.read_bytes()[:max_bytes]
    try:
        text = data.decode("utf-8")
    except UnicodeDecodeError:
        text = data.decode("utf-8", errors="replace")
    return {"ok": True, "path": str(p), "content": _truncate(text)}


@tool(
    "write_file",
    "创建或覆盖写入文本文件，自动创建父目录。",
    {
        "type": "object",
        "properties": {"path": {"type": "string"}, "content": {"type": "string"}},
        "required": ["path", "content"],
    },
)
async def write_file(ctx: ToolContext, path: str, content: str):
    guard = _quota_guard(ctx)
    if guard:
        return {"ok": False, "error": guard}
    p = ctx.resolve(path)
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(content, encoding="utf-8")
    return {"ok": True, "path": str(p), "bytes": len(content.encode("utf-8"))}


@tool(
    "make_dir",
    "创建目录（递归）。",
    {"type": "object", "properties": {"path": {"type": "string"}}, "required": ["path"]},
)
async def make_dir(ctx: ToolContext, path: str):
    p = ctx.resolve(path)
    p.mkdir(parents=True, exist_ok=True)
    return {"ok": True, "path": str(p)}


@tool(
    "delete_path",
    "删除文件或目录（目录递归删除）。",
    {"type": "object", "properties": {"path": {"type": "string"}}, "required": ["path"]},
    sensitive=True,
)
async def delete_path(ctx: ToolContext, path: str):
    p = ctx.resolve(path)
    if not p.exists():
        return {"ok": False, "error": f"不存在: {p}"}
    if p.is_dir():
        shutil.rmtree(p, ignore_errors=True)
    else:
        p.unlink(missing_ok=True)
    return {"ok": True, "deleted": str(p)}


@tool(
    "move_path",
    "移动或重命名文件/目录。",
    {
        "type": "object",
        "properties": {"src": {"type": "string"}, "dst": {"type": "string"}},
        "required": ["src", "dst"],
    },
)
async def move_path(ctx: ToolContext, src: str, dst: str):
    s, d = ctx.resolve(src), ctx.resolve(dst)
    if not s.exists():
        return {"ok": False, "error": f"源不存在: {s}"}
    d.parent.mkdir(parents=True, exist_ok=True)
    shutil.move(str(s), str(d))
    return {"ok": True, "src": str(s), "dst": str(d)}


# --------------------------------------------------------------------------- #
# code execution
# --------------------------------------------------------------------------- #
async def _run_process(cmd: list[str], cwd: Path, timeout: int) -> dict:
    proc = await asyncio.create_subprocess_exec(
        *cmd,
        cwd=str(cwd),
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    try:
        out, err = await asyncio.wait_for(proc.communicate(), timeout=timeout)
    except asyncio.TimeoutError:
        proc.kill()
        await proc.wait()
        return {"ok": False, "error": f"执行超时（>{timeout}s）"}
    return {
        "ok": proc.returncode == 0,
        "exit_code": proc.returncode,
        "stdout": _truncate(out.decode("utf-8", "replace")),
        "stderr": _truncate(err.decode("utf-8", "replace")),
    }


@tool(
    "run_python",
    "在本机执行 Python 代码并返回 stdout/stderr。",
    {"type": "object", "properties": {"code": {"type": "string"}}, "required": ["code"]},
)
async def run_python(ctx: ToolContext, code: str):
    fd, tmp = tempfile.mkstemp(suffix=".py", dir=str(ctx.workspace))
    os.close(fd)
    Path(tmp).write_text(code, encoding="utf-8")
    try:
        return await _run_process(
            [sys.executable, "-X", "utf8", tmp], ctx.workspace, cfg.CONFIG["code_timeout"]
        )
    finally:
        Path(tmp).unlink(missing_ok=True)


@tool(
    "run_node",
    "在本机执行 Node.js/JavaScript 代码并返回输出。",
    {"type": "object", "properties": {"code": {"type": "string"}}, "required": ["code"]},
)
async def run_node(ctx: ToolContext, code: str):
    fd, tmp = tempfile.mkstemp(suffix=".js", dir=str(ctx.workspace))
    os.close(fd)
    Path(tmp).write_text(code, encoding="utf-8")
    try:
        return await _run_process(
            ["node", tmp], ctx.workspace, cfg.CONFIG["code_timeout"]
        )
    finally:
        Path(tmp).unlink(missing_ok=True)


@tool(
    "run_shell",
    "在本机 PowerShell 中执行命令并返回输出。",
    {"type": "object", "properties": {"command": {"type": "string"}}, "required": ["command"]},
    sensitive=True,
)
async def run_shell(ctx: ToolContext, command: str):
    return await _run_process(
        ["powershell", "-NoProfile", "-NonInteractive", "-Command", command],
        ctx.workspace,
        cfg.CONFIG["code_timeout"],
    )


# --------------------------------------------------------------------------- #
# HTTP
# --------------------------------------------------------------------------- #
@tool(
    "http_request",
    "发送 HTTP 请求（GET/POST/PUT/DELETE 等）并返回状态码与响应体。",
    {
        "type": "object",
        "properties": {
            "method": {"type": "string", "description": "默认 GET"},
            "url": {"type": "string"},
            "headers": {"type": "object", "description": "请求头对象"},
            "body": {"type": "string", "description": "原始请求体"},
            "json_body": {"description": "JSON 请求体（对象）"},
        },
        "required": ["url"],
    },
    sensitive=True,
)
async def http_request(ctx: ToolContext, url: str, method: str = "GET",
                       headers: dict | None = None, body: str | None = None,
                       json_body=None):
    async with httpx.AsyncClient(timeout=60, follow_redirects=True) as c:
        r = await c.request(
            method.upper(), url, headers=headers or {},
            content=body.encode("utf-8") if isinstance(body, str) else None,
            json=json_body,
        )
        text = r.text
        return {
            "ok": True,
            "status": r.status_code,
            "headers": dict(r.headers),
            "body": _truncate(text),
        }


# --------------------------------------------------------------------------- #
# browser automation
# --------------------------------------------------------------------------- #
@tool(
    "browser",
    "浏览器自动化。action 取值：goto | click | type | press | get_text | get_html | "
    "screenshot | wait | back | close。返回页面文本或截图路径。",
    {
        "type": "object",
        "properties": {
            "action": {"type": "string"},
            "url": {"type": "string"},
            "selector": {"type": "string"},
            "text": {"type": "string"},
            "wait_ms": {"type": "integer", "description": "默认 800"},
        },
        "required": ["action"],
    },
    sensitive=True,
)
async def browser_tool(ctx: ToolContext, action: str, url: str = "", selector: str = "",
                       text: str = "", wait_ms: int = 800):
    from . import browser_tools

    return await browser_tools.run_action(
        ctx, action=action, url=url, selector=selector, text=text, wait_ms=wait_ms
    )


# --------------------------------------------------------------------------- #
# MCP
# --------------------------------------------------------------------------- #
@tool("mcp_list_servers", "列出已配置的 MCP 服务器。", {"type": "object", "properties": {}})
async def mcp_list_servers(ctx: ToolContext):
    from . import mcp_client

    return {"ok": True, "servers": mcp_client.list_servers()}


@tool(
    "mcp_list_tools",
    "列出某个 MCP 服务器提供的工具。",
    {"type": "object", "properties": {"server": {"type": "string"}}, "required": ["server"]},
)
async def mcp_list_tools(ctx: ToolContext, server: str):
    from . import mcp_client

    return await mcp_client.list_tools(server)


@tool(
    "mcp_call",
    "调用某个 MCP 服务器上的工具。arguments 为参数字典。",
    {
        "type": "object",
        "properties": {
            "server": {"type": "string"},
            "tool": {"type": "string"},
            "arguments": {"type": "object"},
        },
        "required": ["server", "tool"],
    },
    sensitive=True,
)
async def mcp_call(ctx: ToolContext, server: str, tool: str, arguments: dict | None = None):
    from . import mcp_client

    return await mcp_client.call_tool(server, tool, arguments or {})


# --------------------------------------------------------------------------- #
# reporting
# --------------------------------------------------------------------------- #
@tool(
    "report_file",
    "将工作区中的文件登记为用户可下载的成果文件，并返回其信息。",
    {
        "type": "object",
        "properties": {
            "path": {"type": "string"},
            "description": {"type": "string"},
        },
        "required": ["path"],
    },
)
async def report_file(ctx: ToolContext, path: str, description: str = ""):
    src = ctx.resolve(path)
    if not src.is_file():
        return {"ok": False, "error": f"文件不存在: {src}"}
    dest_dir = store.files_dir(ctx.uid)
    dest = dest_dir / src.name
    counter = 1
    while dest.exists():
        dest = dest_dir / f"{src.stem}_{counter}{src.suffix}"
        counter += 1
    shutil.copy2(src, dest)
    return {
        "ok": True,
        "file": dest.name,
        "size": dest.stat().st_size,
        "description": description,
    }


@tool(
    "finish",
    "完成任务时调用。summary 为给用户的最终汇报（含产出文件与结论）。",
    {"type": "object", "properties": {"summary": {"type": "string"}}, "required": ["summary"]},
)
async def finish(ctx: ToolContext, summary: str):
    return {"ok": True, "finished": True, "summary": summary}