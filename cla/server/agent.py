"""The agent loop: think -> call tools -> observe -> ... -> report."""
from __future__ import annotations

import json
import time
from pathlib import Path
from typing import Awaitable, Callable

from . import agents as agents_mod
from . import config as cfg
from . import llm, metrics, store, tools

Emit = Callable[[dict], Awaitable[None]]

SYSTEM_PROMPT_BASE = """你是「YJS Cloud LLM Agent」，运行在用户本机的智能体。
你可以使用工具读写文件、执行 Python/Node.js、运行 PowerShell、
发 HTTP 请求、控制无头浏览器、调用 MCP 服务器。

工作区目录：{workspace} （相对路径以此为基准）

工作原则：
1. 先理解任务，拆解为步骤。
2. 主动用工具获取信息、编写运行代码、验证结果，直到完成。
3. 产出的成果文件放入工作区，用 report_file 登记让用户下载。
4. 完成后调用 finish 提交汇报：做了什么、产出哪些文件、结论是什么。
5. 汇报用简体中文，简洁清晰。不编造未执行的结果。"""

SYSTEM_PROMPT_FAST = """你是一个快速回答助手。用户提问，直接给出简明答案，
不要调用任何工具，不要执行任何操作。回答要快、要准、要短。"""

SYSTEM_PROMPT_THINK = """你是一个深度思考助手。先仔细分析问题（可以写在回答里），
再给出高质量答案。可以调用工具查证，但重点是思考深度，而非执行复杂任务。"""

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


async def run_agent(uid: str, cid: str, emit: Emit,
                    model: str | None = None, mode: str = "work",
                    agent_id: str | None = None) -> None:
    """Public entry point: wraps the loop with live-call bookkeeping."""
    user = store.get_user(uid) or {}
    call_id = metrics.start_live(
        uid, user.get("email", ""), model or cfg.CONFIG["model"], (mode or "work").lower()
    )
    try:
        await _run_agent_inner(uid, cid, emit, model=model, mode=mode,
                               agent_id=agent_id, call_id=call_id)
    finally:
        metrics.end_live(call_id)


async def _run_agent_inner(uid: str, cid: str, emit: Emit,
                           model: str | None = None, mode: str = "work",
                           agent_id: str | None = None, call_id: str = "") -> None:
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

    # Pick system prompt / tool policy.
    # fast / think keep their built-in personalities; work / expert run the
    # selected domain agent (编程、办公、写作、学习、生活 …), with expert
    # unlocking the full step budget and work using the agent's own budget.
    mode = (mode or "work").lower()
    agent_meta = agents_mod.get_agent(agent_id) or agents_mod.AGENTS_BY_ID[agents_mod.DEFAULT_AGENT_ID]
    if mode == "fast":
        system_prompt = SYSTEM_PROMPT_FAST
        use_tools = False
        max_steps = 1
    elif mode == "think":
        system_prompt = SYSTEM_PROMPT_THINK
        use_tools = True
        max_steps = min(2, cfg.CONFIG["max_agent_steps"])
    elif mode == "expert":
        system_prompt, _, _, agent_meta = agents_mod.system_prompt(agent_id, ctx.workspace)
        use_tools = True
        max_steps = cfg.CONFIG["max_agent_steps"]
    else:  # work — domain agent presets
        system_prompt, use_tools, agent_steps, agent_meta = agents_mod.system_prompt(
            agent_id, ctx.workspace)
        max_steps = min(int(agent_steps), cfg.CONFIG["max_agent_steps"])

    await emit({"type": "agent", "id": agent_meta["id"], "name": agent_meta["name"],
                "icon": agent_meta.get("icon", "🤖"), "mode": mode})

    # rebuild model history from stored messages
    messages: list[dict] = [
        {"role": "system", "content": system_prompt}
    ]
    for m in conv["messages"]:
        if m["role"] in ("user", "assistant") and m.get("content"):
            messages.append({"role": m["role"], "content": m["content"]})

    schemas = tools.openai_schemas()
    final_summary = None
    produced_files: list[dict] = []
    seen_paths: set[str] = set()

    for step in range(max_steps):
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
            metrics.update_live(call_id, phase=f"出错：{exc}"[:80])
            return

        _u = msg.get("usage") or {}
        metrics.record_call(
            uid, (store.get_user(uid) or {}).get("email", ""),
            model or cfg.CONFIG["model"], mode,
            _u.get("prompt_tokens", 0), _u.get("completion_tokens", 0),
            _u.get("seconds", 0.0),
        )
        metrics.update_live(call_id, step=step + 1, phase="生成回答")

        tool_calls = msg.get("tool_calls") or []
        content = msg.get("content") or ""

        # External OpenAI-compatible providers require every tool call to carry
        # an id so the matching tool message can reference it on the next turn.
        for i, call in enumerate(tool_calls):
            if not call.get("id"):
                call["id"] = f"call_{step}_{i}"

        if content.strip():
            await emit({"type": "assistant", "content": content})
            store.append_message(uid, cid, {
                "role": "assistant", "content": content, "ts": time.time(),
            })

        assistant_msg = {"role": "assistant", "content": content}
        if tool_calls:
            assistant_msg["tool_calls"] = tool_calls
        messages.append(assistant_msg)

        # fast mode: ignore tool calls, just answer
        if not use_tools and tool_calls:
            await emit({"type": "status", "text": "快速模式忽略工具调用，直接回答"})
            break

        if not tool_calls:
            final_summary = final_summary or content or "任务结束。"
            break

        # Cap how many tools run in a single step (admin-configurable). Provider
        # APIs require a tool message for EVERY tool_call id, so the skipped
        # calls still get a short "not executed" reply below instead of being
        # dropped silently.
        limit = max(1, int(cfg.CONFIG.get("max_tool_calls_per_step") or 8))
        skipped: list[dict] = []
        if len(tool_calls) > limit:
            skipped = tool_calls[limit:]
            tool_calls = tool_calls[:limit]
            await emit({
                "type": "status",
                "text": f"本轮工具调用 {len(skipped) + limit} 个，超过上限 {limit}，仅执行前 {limit} 个",
            })

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
            metrics.update_live(call_id, phase=f"执行 {name}")

            result = await tools.execute(name, raw_args, ctx)

            await emit({
                "type": "tool_result",
                "name": name,
                "ok": result.get("ok", True),
                "summary": _fmt_result(result)[:800],
            })
            tool_msg = {"role": "tool", "content": _fmt_result(result), "name": name}
            if call.get("id"):
                tool_msg["tool_call_id"] = call["id"]
            messages.append(tool_msg)
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

        # Reply to the over-limit tool calls so every tool_call id has a match.
        for call in skipped:
            name = (call.get("function") or {}).get("name", "")
            note = f"未执行：本轮工具调用数量超过上限（{limit}），请在下一轮重新调用。"
            tool_msg = {"role": "tool", "content": note, "name": name}
            if call.get("id"):
                tool_msg["tool_call_id"] = call["id"]
            messages.append(tool_msg)
            await emit({"type": "tool_result", "name": name, "ok": False, "summary": note})

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
        conv = store.get_conversation(uid, cid)
        if conv and conv["messages"]:
            last = conv["messages"][-1]
            if last.get("role") == "assistant":
                last["files"] = list(produced_files)
                store.save_conversation(uid, conv)
            else:
                store.append_message(uid, cid, {
                    "role": "assistant",
                    "content": "",
                    "files": list(produced_files),
                    "ts": time.time(),
                })
        else:
            store.append_message(uid, cid, {
                "role": "assistant",
                "content": "",
                "files": list(produced_files),
                "ts": time.time(),
            })
