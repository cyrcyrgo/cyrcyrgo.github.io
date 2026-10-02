"""The agent loop: think -> call tools -> observe -> ... -> report."""
from __future__ import annotations

import json
import time
from pathlib import Path
from typing import Awaitable, Callable

from . import config as cfg
from . import llm, store, tools

Emit = Callable[[dict], Awaitable[None]]

SYSTEM_PROMPT = """你是「YJS LLM Agent」，一个运行在用户本机上的自主智能体。
你可以使用工具直接操作这台电脑：读写/删除文件、执行 Python 与 Node.js 代码、
运行 PowerShell 命令、发送 HTTP 请求、控制无头浏览器、以及调用 MCP 服务器。

工作区目录：{workspace}
（相对路径都以该目录为基准；也可以使用绝对路径操作整台电脑。）

工作原则：
1. 先理解任务，必要时拆解为若干步骤。
2. 主动使用工具获取信息、编写与运行代码、验证结果，直到任务真正完成。
3. 产出的成果文件请放入工作区，并用 report_file 工具登记为用户可下载的文件。
4. 全部完成后，调用 finish 工具提交最终汇报：说明做了什么、产出了哪些文件、结论是什么。
5. 汇报用简体中文，简洁清晰。不要编造未实际执行的结果。
"""


def _fmt_result(res: dict) -> str:
    if not isinstance(res, dict):
        return str(res)
    if res.get("ok") is False:
        return f"错误: {res.get('error', '未知错误')}"
    payload = {k: v for k, v in res.items() if k != "ok"}
    text = json.dumps(payload, ensure_ascii=False)
    return text[:6000]


def _record_file(name: str, result: dict, produced: list[dict],
                 seen: set[str], workspace: Path) -> None:
    """Inspect a tool result for a produced file and append to *produced*.

    Handles ``write_file`` (resolve to workspace-relative) and ``report_file``
    (the agent explicitly registered it as a deliverable). Deduplicates by
    workspace-relative path so retries don't multiply the list.
    """
    if not result.get("ok"):
        return
    if name == "write_file":
        path = result.get("path")
        if not path:
            return
        p = Path(path)
        try:
            rel = p.resolve().relative_to(workspace.resolve()).as_posix()
        except ValueError:
            if not p.is_file():
                return
            rel = p.name
        if rel in seen:
            return
        seen.add(rel)
        try:
            size = p.stat().st_size
        except OSError:
            size = 0
        produced.append({"path": rel, "size": size, "name": p.name})
    elif name == "report_file":
        fname = result.get("file")
        if not fname:
            return
        if fname in seen:
            return
        seen.add(fname)
        produced.append({
            "path": fname,
            "size": result.get("size") or 0,
            "name": fname,
            "description": result.get("description", ""),
            "reported": True,
        })


async def run_agent(uid: str, cid: str, emit: Emit, model: str | None = None) -> None:
    conv = store.get_conversation(uid, cid)
    if not conv:
        await emit({"type": "error", "error": "对话不存在"})
        return

    usage = store.usage(uid)
    if usage["full"]:
        await emit({
            "type": "error",
            "error": "你的 1GB 存储空间已满，无法开启新的对话任务。请先清理文件后重试。",
        })
        return

    ctx = tools.ToolContext(uid=uid, cid=cid, workspace=store.workspace(uid))

    # rebuild model history from stored messages
    messages: list[dict] = [
        {"role": "system", "content": SYSTEM_PROMPT.format(workspace=str(ctx.workspace))}
    ]
    for m in conv["messages"]:
        if m["role"] in ("user", "assistant") and m.get("content"):
            messages.append({"role": m["role"], "content": m["content"]})

    schemas = tools.openai_schemas()
    final_summary = None
    produced_files: list[dict] = []
    seen_paths: set[str] = set()

    for step in range(cfg.CONFIG["max_agent_steps"]):
        await emit({"type": "status", "text": f"思考中…（第 {step + 1} 步）"})

        async def on_delta(piece: str, _cid: str = cid) -> None:
            await emit({"type": "assistant_delta", "content": piece})

        async def on_tool_progress(name: str, chars: int) -> None:
            label = f"{name} " if name else ""
            await emit({
                "type": "progress",
                "name": name,
                "text": f"正在生成 {label}内容…（已 {chars} 字）",
            })

        try:
            msg = await llm.chat_once(
                messages, tools=schemas,
                on_delta=on_delta, on_tool_progress=on_tool_progress,
                model=model,
            )
        except Exception as exc:  # noqa: BLE001
            await emit({"type": "error", "error": f"模型调用失败：{exc}"})
            return

        tool_calls = msg.get("tool_calls") or []
        content = msg.get("content") or ""

        if content.strip():
            await emit({"type": "assistant", "content": content})
            store.append_message(uid, cid, {
                "role": "assistant", "content": content, "ts": time.time(),
            })

        assistant_msg = {"role": "assistant", "content": content}
        if tool_calls:
            assistant_msg["tool_calls"] = tool_calls
        messages.append(assistant_msg)

        if not tool_calls:
            final_summary = final_summary or content or "任务结束。"
            break

        for call in tool_calls:
            fn = call.get("function", {})
            name = fn.get("name", "")
            raw_args = fn.get("arguments", {})
            if isinstance(raw_args, str):
                try:
                    raw_args = json.loads(raw_args or "{}")
                except json.JSONDecodeError:
                    raw_args = {}
            await emit({"type": "tool_call", "name": name, "args": raw_args})

            result = await tools.execute(name, raw_args, ctx)

            await emit({
                "type": "tool_result",
                "name": name,
                "ok": result.get("ok", True),
                "summary": _fmt_result(result)[:800],
            })
            messages.append({
                "role": "tool",
                "content": _fmt_result(result),
                "name": name,
            })
            store.append_message(uid, cid, {
                "role": "tool", "name": name, "content": _fmt_result(result), "ts": time.time(),
            })

            _record_file(name, result, produced_files, seen_paths, ctx.workspace)

            if name == "finish":
                final_summary = raw_args.get("summary") or final_summary
                if produced_files:
                    await emit({"type": "files", "files": list(produced_files)})
                await emit({"type": "done", "summary": final_summary})
                if produced_files:
                    store.append_message(uid, cid, {
                        "role": "assistant",
                        "content": "",
                        "files": list(produced_files),
                        "ts": time.time(),
                    })
                return

    if produced_files:
        await emit({"type": "files", "files": list(produced_files)})
    if final_summary:
        await emit({"type": "done", "summary": final_summary})
    else:
        await emit({
            "type": "done",
            "summary": f"已达到最大步数（{cfg.CONFIG['max_agent_steps']}），任务可能未完全结束。",
        })

    if produced_files:
        store.append_message(uid, cid, {
            "role": "assistant",
            "content": "",
            "files": list(produced_files),
            "ts": time.time(),
        })
