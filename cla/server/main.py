"""YJS LLM Agent -- FastAPI application (local agent server + static frontend)."""
from __future__ import annotations

import asyncio
import json
import time
from pathlib import Path

import uvicorn
from fastapi import Depends, FastAPI, Header, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from . import agent, auth, config as cfg, github_sync, llm, store, tools, tunnel

app = FastAPI(title="YJS LLM Agent", version="1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


# --------------------------------------------------------------------------- #
# auth helpers
# --------------------------------------------------------------------------- #
def _token_from(request: Request, authorization: str | None, token_q: str | None) -> str | None:
    if authorization and authorization.lower().startswith("bearer "):
        return authorization[7:]
    if token_q:
        return token_q
    return request.query_params.get("token")


async def current_user(request: Request,
                       authorization: str | None = Header(default=None),
                       token: str | None = Query(default=None)) -> dict:
    raw = _token_from(request, authorization, token)
    if not raw:
        raise HTTPException(401, "未登录")
    payload = auth.decode_token(raw)
    if not payload:
        raise HTTPException(401, "登录已过期，请重新登录")
    user = store.get_user(payload["uid"])
    if not user:
        raise HTTPException(401, "用户不存在")
    return user


# --------------------------------------------------------------------------- #
# models
# --------------------------------------------------------------------------- #
class SendCodeIn(BaseModel):
    email: str


class VerifyIn(BaseModel):
    email: str
    code: str


class ChatIn(BaseModel):
    content: str
    model: str | None = None
    mode: str | None = None   # fast | think | work | expert


# --------------------------------------------------------------------------- #
# auth routes
# --------------------------------------------------------------------------- #
@app.post("/api/auth/send-code")
async def send_code(body: SendCodeIn):
    email = body.email.strip().lower()
    if "@" not in email or len(email) < 5:
        raise HTTPException(400, "邮箱格式不正确")
    ok, wait = auth.can_send(email)
    if not ok:
        raise HTTPException(429, f"请 {wait} 秒后再试")
    existing = store.get_user_by_email(email)
    if not existing and not cfg.CONFIG["allow_register"]:
        raise HTTPException(403, "暂不允许新用户注册")
    try:
        await asyncio.to_thread(auth.send_code, email)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(500, f"验证码发送失败：{exc}") from exc
    return {"ok": True, "is_new": existing is None, "message": "验证码已发送，请查收邮件"}


@app.post("/api/auth/verify")
async def verify(body: VerifyIn):
    email = body.email.strip().lower()
    if not auth.verify_code(email, body.code):
        raise HTTPException(400, "验证码错误或已过期")
    user = store.get_user_by_email(email)
    if not user:
        if not cfg.CONFIG["allow_register"]:
            raise HTTPException(403, "暂不允许注册")
        user = store.create_user(email)
    store.touch_login(user["uid"])
    token = auth.make_token(user["uid"], email)
    return {"ok": True, "token": token, "user": _public_user(user)}


def _public_user(user: dict) -> dict:
    return {
        "uid": user["uid"],
        "email": user["email"],
        "name": user.get("name"),
        "created_at": user.get("created_at"),
        "model_preference": user.get("model_preference"),
        "usage": store.usage(user["uid"]),
    }


@app.get("/api/me")
async def me(user: dict = Depends(current_user)):
    return {"ok": True, "user": _public_user(user)}


# --------------------------------------------------------------------------- #
# conversations
# --------------------------------------------------------------------------- #
@app.get("/api/conversations")
async def list_conversations(user: dict = Depends(current_user)):
    return {"ok": True, "conversations": store.list_conversations(user["uid"])}


@app.post("/api/conversations")
async def create_conversation(user: dict = Depends(current_user)):
    usage = store.usage(user["uid"])
    if usage["full"]:
        raise HTTPException(403, "存储空间已满（1GB），请清理文件后再开启新对话")
    return {"ok": True, "conversation": store.create_conversation(user["uid"])}


@app.get("/api/conversations/{cid}")
async def get_conversation(cid: str, user: dict = Depends(current_user)):
    conv = store.get_conversation(user["uid"], cid)
    if not conv:
        raise HTTPException(404, "对话不存在")
    return {"ok": True, "conversation": conv}


@app.delete("/api/conversations/{cid}")
async def delete_conversation(cid: str, user: dict = Depends(current_user)):
    ok = store.delete_conversation(user["uid"], cid)
    return {"ok": ok}


# Strong refs to in-flight agent tasks so a run survives a client disconnect.
_RUNNING: set = set()
# Per-uid active model during a running chat (for SSE model event).
_active_model: dict[str, str] = {}


@app.post("/api/conversations/{cid}/chat")
async def chat(cid: str, body: ChatIn, user: dict = Depends(current_user)):
    uid = user["uid"]
    if not store.get_conversation(uid, cid):
        raise HTTPException(404, "对话不存在")
    text = (body.content or "").strip()
    if not text:
        raise HTTPException(400, "内容为空")
    store.append_message(uid, cid, {"role": "user", "content": text, "ts": time.time()})

    # Resolve which model to run this conversation with.
    # Order: request body override -> user profile preference -> server default.
    resolved_model = body.model
    if not resolved_model:
        resolved_model = user.get("model_preference")
    if not resolved_model:
        resolved_model = cfg.CONFIG["model"]
    # Validate against configured models (fall back to default if unknown).
    known = {m["name"] for m in cfg.CONFIG.get("models", [])}
    if known and resolved_model not in known:
        resolved_model = cfg.CONFIG["model"]
    # Emit a model event so the UI updates the active tag.
    _active_model[uid] = resolved_model

    # Resolve mode: fast | think | work | expert  (default work).
    MODE_ALLOWED = {"fast", "think", "work", "expert"}
    resolved_mode = (body.mode or "work").lower()
    if resolved_mode not in MODE_ALLOWED:
        resolved_mode = "work"

    queue: asyncio.Queue = asyncio.Queue()
    started = time.time()

    async def emit(ev: dict) -> None:
        await queue.put(ev)

    def sse(ev: dict) -> str:
        return f"data: {json.dumps(ev, ensure_ascii=False)}\n\n"

    async def gen():
        # Notify the UI which model is about to run, so it updates the chip.
        await emit({"type": "model", "model": resolved_model})
        await emit({"type": "mode", "mode": resolved_mode})
        task = asyncio.create_task(agent.run_agent(uid, cid, emit, model=resolved_model, mode=resolved_mode))
        _RUNNING.add(task)
        task.add_done_callback(_RUNNING.discard)
        idle = 0
        try:
            while True:
                try:
                    ev = await asyncio.wait_for(queue.get(), timeout=0.5)
                except asyncio.TimeoutError:
                    if task.done():
                        break
                    idle += 1
                    # Comment pings keep the TCP stream warm; a real data event
                    # every ~10s lets the browser show "still running".
                    if idle % 20 == 0:
                        yield sse({"type": "heartbeat",
                                   "elapsed": int(time.time() - started)})
                    yield ": ping\n\n"
                    continue
                idle = 0
                yield sse(ev)
                if ev.get("type") in ("done", "error"):
                    break
        finally:
            # Do NOT cancel the agent when the browser goes away: the run keeps
            # going and persists its results, so reopening the conversation shows
            # the finished work instead of losing it to a dropped connection.
            if task.done():
                _RUNNING.discard(task)
        while not queue.empty():
            yield sse(queue.get_nowait())
        yield sse({"type": "end"})

    return StreamingResponse(
        gen(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


# --------------------------------------------------------------------------- #
# files & quota
# --------------------------------------------------------------------------- #
@app.get("/api/files")
async def list_files(user: dict = Depends(current_user)):
    return {"ok": True, "files": store.list_files(user["uid"]),
            "usage": store.usage(user["uid"])}


@app.get("/api/files/download")
async def download(path: str, user: dict = Depends(current_user)):
    root = store.workspace(user["uid"]).resolve()
    target = (root / path).resolve()
    if root not in target.parents and target != root:
        raise HTTPException(403, "非法路径")
    if not target.is_file():
        raise HTTPException(404, "文件不存在")
    return FileResponse(target, filename=target.name)


@app.delete("/api/files")
async def delete_file(path: str, user: dict = Depends(current_user)):
    return {"ok": store.delete_file(user["uid"], path),
            "usage": store.usage(user["uid"])}



@app.get("/api/files/preview")
async def preview_file(path: str, user: dict = Depends(current_user)):
    """Return text content of a workspace file for online preview.

    Safe whitelist: .txt .md .json .html .py .js .css .csv ...
    Binary or unknown types get HTTP 400.
    """
    import base64 as _b
    root = store.workspace(user["uid"]).resolve()
    target = (root / path).resolve()
    if root not in target.parents and target != root:
        raise HTTPException(403, "非法路径")
    if not target.is_file():
        raise HTTPException(404, "文件不存在")

    TEXT_EXTS = {
        ".txt", ".md", ".markdown", ".json", ".yaml", ".yml",
        ".py", ".js", ".ts", ".jsx", ".tsx",
        ".css", ".csv", ".log", ".ini", ".toml", ".xml",
        ".sh", ".bat", ".ps1", ".rs", ".go", ".java",
        ".c", ".cpp", ".h", ".vue", ".svelte", ".htm", ".html",
    }
    ext = target.suffix.lower()
    size = target.stat().st_size

    if ext in (".html", ".htm"):
        raw = target.read_bytes()
        data_uri = "data:text/html;base64," + _b.b64encode(raw).decode("ascii")
        return {"ok": True, "kind": "html", "path": path, "size": size,
                "data_uri": data_uri, "filename": target.name}

    if ext not in TEXT_EXTS:
        raise HTTPException(400, f"不支持预览该文件类型 ({ext})，请使用下载")

    if size > 256 * 1024:
        raise HTTPException(400, f"文件太大 ({size // 1024} KB)，请下载后查看")

    try:
        text = target.read_text(encoding="utf-8")
    except UnicodeDecodeError:
        text = target.read_text(encoding="gbk", errors="replace")

    return {"ok": True, "kind": "text", "path": path, "size": size,
            "filename": target.name, "content": text, "language": ext.lstrip(".")}


@app.post("/api/files/clear")
async def clear_files(user: dict = Depends(current_user)):
    store.delete_all_files(user["uid"])
    return {"ok": True, "usage": store.usage(user["uid"])}


# --------------------------------------------------------------------------- #
# system
# --------------------------------------------------------------------------- #
@app.get("/api/health")
async def health():
    return {
        "ok": True,
        "model": cfg.CONFIG["model"],
        "models": cfg.CONFIG.get("models", []),
        "ollama": await llm.health(),
        "tunnel": tunnel.TUNNEL.url,
        "quota_bytes": cfg.CONFIG["quota_bytes"],
    }


# --------------------------------------------------------------------------- #
# model selection
# --------------------------------------------------------------------------- #
@app.get("/api/models")
async def list_models(user: dict = Depends(current_user)):
    """Return available models + the requesting user's saved preference."""
    models = cfg.CONFIG.get("models", [])
    # If Ollama has models that aren't listed in config, surface them too
    # (so newly-pulled models show up without restarting).
    ollama = await llm.health()
    known_names = {m["name"] for m in models}
    for m in ollama.get("models", []):
        if m not in known_names:
            models.append({"name": m, "display": m, "desc": "(未在配置中登记)"})
    return {
        "ok": True,
        "models": models,
        "default": cfg.CONFIG["model"],
        "preference": user.get("model_preference"),
    }


class SetModelIn(BaseModel):
    model: str | None


@app.post("/api/models/set")
async def set_model(body: SetModelIn, user: dict = Depends(current_user)):
    model = body.model
    if model is not None:
        known = {m["name"] for m in cfg.CONFIG.get("models", [])}
        if known and model not in known:
            raise HTTPException(400, f"未知模型: {model}")
    ok = store.set_model_preference(user["uid"], model)
    return {"ok": ok, "model_preference": user.get("model_preference") if ok else None}


@app.get("/api/tools")
async def list_tools():
    return {"ok": True, "tools": tools.openai_schemas()}


# --------------------------------------------------------------------------- #
# static frontend
# --------------------------------------------------------------------------- #
@app.get("/")
async def index():
    return FileResponse(cfg.ROOT / "index.html")


@app.get("/config.json")
async def public_config():
    if cfg.PUBLIC_CONFIG.exists():
        return JSONResponse(json.loads(cfg.PUBLIC_CONFIG.read_text(encoding="utf-8")))
    return JSONResponse({"api_url": "", "model": cfg.CONFIG["model"]})


if (cfg.ROOT / "assets").exists():
    app.mount("/assets", StaticFiles(directory=str(cfg.ROOT / "assets")), name="assets")


@app.on_event("startup")
async def _startup():
    port = cfg.CONFIG["port"]
    print(f"[yjs] local server: http://127.0.0.1:{port}")
    print(f"[yjs] model: {cfg.CONFIG['model']}")
    tunnel.TUNNEL.start(port)


def main() -> None:
    uvicorn.run(app, host=cfg.CONFIG["host"], port=cfg.CONFIG["port"], log_level="info")


if __name__ == "__main__":
    main()