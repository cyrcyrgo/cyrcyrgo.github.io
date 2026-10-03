"""YJS LLM Agent -- FastAPI application (local agent server + static frontend)."""
from __future__ import annotations

import asyncio
import json
import os
import time
from html import escape as _esc
from pathlib import Path

import uvicorn
import httpx
from fastapi import Depends, FastAPI, Header, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from . import agent, agents, auth, config as cfg, github_sync, llm, mcp_client, metrics, store, tools, tunnel

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
    agent: str | None = None  # domain agent id (dev | office | writer | study | life)


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
        "avatar": user.get("avatar") or "",
        "created_at": user.get("created_at"),
        "model_preference": user.get("model_preference"),
        "quota_bytes": int(user.get("quota_bytes") or cfg.CONFIG["quota_bytes"]),
        "has_password": bool(user.get("password_hash")),
        "is_admin": store.is_admin(user),
        "usage": store.usage(user["uid"]),
    }


@app.get("/api/me")
async def me(user: dict = Depends(current_user)):
    return {"ok": True, "user": _public_user(user)}


class PasswordLoginIn(BaseModel):
    email: str
    password: str


@app.post("/api/auth/login")
async def password_login(body: PasswordLoginIn):
    """Alternative login: email + password (set by the user or an admin)."""
    email = body.email.strip().lower()
    user = store.get_user_by_email(email)
    if not user or not auth.check_password(body.password, user.get("password_hash")):
        raise HTTPException(400, "邮箱或密码错误")
    store.touch_login(user["uid"])
    token = auth.make_token(user["uid"], email)
    return {"ok": True, "token": token, "user": _public_user(user)}


class SetPasswordIn(BaseModel):
    password: str


@app.post("/api/auth/password")
async def set_own_password(body: SetPasswordIn, user: dict = Depends(current_user)):
    """Let a signed-in user set/change their own password."""
    ok, msg = auth.valid_password(body.password)
    if not ok:
        raise HTTPException(400, msg)
    store.set_password_hash(user["uid"], auth.hash_password(body.password))
    return {"ok": True}


class ResetSendIn(BaseModel):
    email: str


@app.post("/api/auth/reset/send-code")
async def send_reset_code(body: ResetSendIn):
    """Forgot-password flow: email a reset code to a registered address."""
    email = body.email.strip().lower()
    if "@" not in email or len(email) < 5:
        raise HTTPException(400, "邮箱格式不正确")
    if not store.get_user_by_email(email):
        # Same wording as a normal "sent" reply on purpose? We keep it explicit:
        # registration is closed by default, so no reset target exists.
        raise HTTPException(404, "该邮箱尚未注册")
    ok, wait = auth.can_send(email)
    if not ok:
        raise HTTPException(429, f"请 {wait} 秒后再试")
    try:
        await asyncio.to_thread(auth.send_code, email, "reset")
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(500, f"验证码发送失败：{exc}") from exc
    return {"ok": True, "message": "重置验证码已发送，请查收邮件"}


class ResetPasswordIn(BaseModel):
    email: str
    code: str
    password: str


@app.post("/api/auth/reset/password")
async def reset_password(body: ResetPasswordIn):
    """Set a new password using the emailed reset code; logs the user in."""
    email = body.email.strip().lower()
    if not auth.verify_code(email, body.code, purpose="reset"):
        raise HTTPException(400, "验证码错误或已过期")
    user = store.get_user_by_email(email)
    if not user:
        raise HTTPException(404, "该邮箱尚未注册")
    ok, msg = auth.valid_password(body.password)
    if not ok:
        raise HTTPException(400, msg)
    store.set_password_hash(user["uid"], auth.hash_password(body.password))
    store.touch_login(user["uid"])
    token = auth.make_token(user["uid"], email)
    return {"ok": True, "token": token, "user": _public_user(user)}


# --------------------------------------------------------------------------- #
# my account: profile / email change / feedback   (settings panel)
# --------------------------------------------------------------------------- #
class ProfileIn(BaseModel):
    name: str | None = None
    avatar: str | None = None       # data:image/...  ("空串" clears it)


@app.post("/api/me/profile")
async def update_my_profile(body: ProfileIn, user: dict = Depends(current_user)):
    try:
        profile = store.update_profile(user["uid"], name=body.name, avatar=body.avatar)
    except ValueError as exc:
        raise HTTPException(400, str(exc))
    if not profile:
        raise HTTPException(404, "用户不存在")
    return {"ok": True, "user": _public_user(profile)}


class EmailCodeIn(BaseModel):
    email: str


@app.post("/api/me/email/send-code")
async def send_change_email_code(body: EmailCodeIn, user: dict = Depends(current_user)):
    """Send a verification code to a *new* address before switching to it."""
    email = body.email.strip().lower()
    if "@" not in email or len(email) < 5:
        raise HTTPException(400, "邮箱格式不正确")
    other = store.get_user_by_email(email)
    if other and other["uid"] != user["uid"]:
        raise HTTPException(400, "该邮箱已被其他账号使用")
    ok, wait = auth.can_send(email)
    if not ok:
        raise HTTPException(429, f"请 {wait} 秒后再试")
    try:
        await asyncio.to_thread(auth.send_code, email)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(500, f"验证码发送失败：{exc}") from exc
    return {"ok": True, "message": "验证码已发送到新邮箱"}


class EmailChangeIn(BaseModel):
    email: str
    code: str


@app.post("/api/me/email")
async def change_my_email(body: EmailChangeIn, user: dict = Depends(current_user)):
    email = body.email.strip().lower()
    if not auth.verify_code(email, body.code):
        raise HTTPException(400, "验证码错误或已过期")
    ok, msg = store.change_email(user["uid"], email)
    if not ok:
        raise HTTPException(400, msg)
    updated = store.get_user(user["uid"]) or {}
    # The old token still carries the stale email; hand back a fresh one.
    return {"ok": True, "token": auth.make_token(user["uid"], email),
            "user": _public_user(updated)}


class FeedbackIn(BaseModel):
    category: str = "其他"
    content: str


@app.post("/api/feedback")
async def submit_feedback(body: FeedbackIn, user: dict = Depends(current_user)):
    """「向作者反馈」—— stored server-side for the admin to review."""
    content = (body.content or "").strip()
    if len(content) < 2:
        raise HTTPException(400, "请填写反馈内容")
    item = store.add_feedback(user["uid"], user.get("email", ""), body.category, content)
    return {"ok": True, "id": item["id"]}


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
    # Global master switch: an admin can suspend every model call at once.
    if not cfg.CONFIG.get("ai_enabled", True):
        raise HTTPException(403, "管理员已暂停全部模型调用，请稍后再试")
    text = (body.content or "").strip()
    if not text:
        raise HTTPException(400, "内容为空")
    store.append_message(uid, cid, {"role": "user", "content": text, "ts": time.time()})

    # Resolve which model to run this conversation with.
    # Order: request body override -> user profile preference ->
    # domain agent's suggested (small, low-spec-friendly) model -> server default.
    agent_meta = agents.get_agent(body.agent)
    resolved_model = body.model
    if not resolved_model:
        resolved_model = user.get("model_preference")
    if not resolved_model and agent_meta and agent_meta.get("suggest_model"):
        resolved_model = agent_meta["suggest_model"]
    if not resolved_model:
        resolved_model = cfg.CONFIG.get("default_model") or cfg.CONFIG["model"]
    # Validate — intersect the globally-enabled set with the user's allow-list.
    known = {m["name"] for m in cfg.CONFIG.get("models", []) if m.get("enabled", True)}
    profile = store.get_user(uid) or {}
    allow_list = profile.get("model_allowed")
    if allow_list is not None:
        known &= set(allow_list)
        if not known:
            raise HTTPException(403, "你的账户已被暂停所有模型调用，请联系管理员")
    if known and resolved_model not in known:
        resolved_model = next(iter(known), cfg.CONFIG.get("default_model") or cfg.CONFIG["model"])
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
        task = asyncio.create_task(agent.run_agent(uid, cid, emit, model=resolved_model,
                                                   mode=resolved_mode, agent_id=body.agent))
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


MAX_UPLOAD_BYTES = 100 * 1024 * 1024          # 100 MB per uploaded file


@app.post("/api/files/upload")
async def upload_file(request: Request, path: str = Query(...),
                      user: dict = Depends(current_user)):
    """Upload a user file straight into their workspace (quota-checked).

    Sent as a raw octet-stream body with the destination path in ``?path=``
    (no multipart dependency needed). The body is streamed to a ``.part`` file
    and only moved into place once the size and quota checks pass.
    """
    raw = (path or "").strip().replace("\\", "/")
    if not raw or raw.endswith("/"):
        raise HTTPException(400, "请提供文件名")
    parts = [p for p in raw.split("/") if p not in ("", ".")]
    if any(p == ".." for p in parts):
        raise HTTPException(400, "非法路径")
    rel = "/".join(parts)
    root = store.workspace(user["uid"]).resolve()
    target = (root / rel).resolve()
    if root not in target.parents:
        raise HTTPException(403, "非法路径")
    if target.exists() and target.is_dir():
        raise HTTPException(400, "目标是一个目录")

    usage = store.usage(user["uid"])
    if usage["full"]:
        raise HTTPException(403, "你的云空间已满，请清理文件后再上传")

    target.parent.mkdir(parents=True, exist_ok=True)
    tmp = target.with_name(target.name + ".part")
    total = 0
    try:
        with tmp.open("wb") as fh:
            async for chunk in request.stream():
                if not chunk:
                    continue
                total += len(chunk)
                if total > MAX_UPLOAD_BYTES:
                    raise HTTPException(
                        413, f"单个文件不能超过 {MAX_UPLOAD_BYTES // (1024 * 1024)}MB")
                fh.write(chunk)
        if total == 0:
            raise HTTPException(400, "文件内容为空")
        if usage["used"] + total > usage["quota"]:
            raise HTTPException(413, "云空间不足，无法上传该文件")
    except HTTPException:
        tmp.unlink(missing_ok=True)
        raise
    tmp.replace(target)
    return {"ok": True, "path": rel, "size": total, "usage": store.usage(user["uid"])}


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


@app.get("/api/settings")
async def public_settings():
    """Runtime switches the chat page reads before/after login (no auth)."""
    return {
        "ok": True,
        "ai_enabled": bool(cfg.CONFIG.get("ai_enabled", True)),
        "allow_register": bool(cfg.CONFIG.get("allow_register", True)),
        "announcement": cfg.CONFIG.get("announcement", "") or "",
    }


# --------------------------------------------------------------------------- #
# model selection
# --------------------------------------------------------------------------- #
def _user_visible_models(user: dict) -> tuple[list[dict], set[str]]:
    """Return (models, names) visible to *user*.

    Admins see every configured model (enabled or disabled) so they can toggle
    them; ordinary users only see models that are both globally enabled AND in
    their per-user allow-list (if they have one).
    """
    all_models = cfg.CONFIG.get("models", [])
    if store.is_admin(user):
        visible = list(all_models)
    else:
        visible = [m for m in all_models if m.get("enabled", True)]
        profile = store.get_user(user["uid"]) or {}
        allow_list = profile.get("model_allowed")
        if allow_list is not None:
            visible = [m for m in visible if m["name"] in allow_list]
    return visible, {m["name"] for m in visible}


@app.get("/api/models")
async def list_models(user: dict = Depends(current_user)):
    """Return models the current user may use + their saved preference."""
    models, known_names = _user_visible_models(user)
    try:
        ollama = await llm.health()
        known_cfg = {m["name"]: m for m in cfg.CONFIG.get("models", [])}
        is_admin = store.is_admin(user)
        for m in ollama.get("models", []):
            if m not in known_cfg:
                models.append({"name": m, "display": m, "provider": "ollama",
                               "enabled": True, "desc": "(未在配置中登记)"})
            elif not is_admin and not known_cfg[m].get("enabled", True):
                pass   # non-admin: don't re-surface disabled via Ollama
    except Exception:
        pass
    default = cfg.CONFIG["model"]
    if known_names and default not in known_names:
        default = models[0]["name"] if models else default
    return {"ok": True, "models": models, "default": default,
            "preference": user.get("model_preference")}


class SetModelIn(BaseModel):
    model: str | None


@app.post("/api/models/set")
async def set_model(body: SetModelIn, user: dict = Depends(current_user)):
    model = body.model
    if model is not None:
        known_all, _ = _user_visible_models(user)
        known = {m["name"] for m in known_all}
        if known and model not in known:
            raise HTTPException(400, f"未知模型: {model}")
    ok = store.set_model_preference(user["uid"], model)
    return {"ok": ok, "model_preference": user.get("model_preference") if ok else None}


@app.get("/api/tools")
async def list_tools():
    return {"ok": True, "tools": tools.openai_schemas()}


# --------------------------------------------------------------------------- #
# domain agents (locally "trained" presets for the small on-device models)
# --------------------------------------------------------------------------- #
@app.get("/api/agents")
async def list_agents(user: dict = Depends(current_user)):
    return {"ok": True, "agents": agents.public_list(), "default": agents.DEFAULT_AGENT_ID}


# --------------------------------------------------------------------------- #
# admin dashboard
# --------------------------------------------------------------------------- #
async def require_admin(user: dict = Depends(current_user)) -> dict:
    if not store.is_admin(user):
        raise HTTPException(403, "需要管理员权限")
    return user


def _admin_password_hash() -> str:
    return ((cfg.CONFIG.get("admin") or {}).get("password_hash") or "").strip()


async def require_admin_gate(request: Request,
                             user: dict = Depends(require_admin)) -> dict:
    """Admin endpoints additionally require the dashboard password.

    When no ``admin.password_hash`` is configured the gate is a no-op, so
    existing installs keep working until a password is set.
    """
    if _admin_password_hash():
        token = request.headers.get("x-admin-token")
        if not (token and auth.decode_admin_token(token)):
            raise HTTPException(401, "管理后台需要密码解锁")
    return user


@app.get("/api/admin/status")
async def admin_status(request: Request, user: dict = Depends(require_admin)):
    has_pw = bool(_admin_password_hash())
    token = request.headers.get("x-admin-token")
    unlocked = bool(token and auth.decode_admin_token(token)) if has_pw else True
    return {"ok": True, "has_password": has_pw, "locked": not unlocked,
            "email": user.get("email")}


class AdminUnlockIn(BaseModel):
    password: str


@app.post("/api/admin/unlock")
async def admin_unlock(body: AdminUnlockIn, user: dict = Depends(require_admin)):
    stored = _admin_password_hash()
    if not stored:
        raise HTTPException(400, "尚未设置管理密码")
    if not auth.check_password(body.password, stored):
        raise HTTPException(401, "管理密码错误")
    return {"ok": True, "admin_token": auth.make_admin_token(user["uid"], user["email"])}


@app.get("/api/admin/overview")
async def admin_overview(user: dict = Depends(require_admin_gate)):
    """Live dashboard payload: per-model token usage, VRAM residency, calls."""
    snap = metrics.snapshot()
    ollama = await llm.health()
    ps = await llm.ps()
    installed = set(ollama.get("models") or [])
    loaded = {m["name"] for m in ps.get("models", [])}
    live = metrics.live_models()

    catalog: dict[str, dict] = {}
    for m in cfg.CONFIG.get("models", []):
        catalog[m["name"]] = {
            "name": m["name"], "display": m.get("display"), "tier": m.get("tier"),
            "enabled": m.get("enabled", True), "provider": m.get("provider", "ollama"),
            "is_builtin": m["name"] in cfg.DEFAULT_MODELS_NAMES,
            "base_url": m.get("base_url", ""), "context_len": m.get("context_len", 8192),
            "desc": m.get("desc", ""), "has_key": bool(m.get("api_key_ref")),
        }
    for name in installed:
        catalog.setdefault(name, {"name": name, "display": name, "tier": "未登记",
                                    "enabled": False, "is_builtin": False,
                                    "base_url": "", "context_len": 8192,
                                    "desc": "", "has_key": False})

    rows = []
    for name, meta in catalog.items():
        stat = snap["by_model"].get(name, {})
        rows.append({
            **meta,
            "installed": name in installed,
            "loaded": name in loaded,
            "active": live.get(name, 0),
            "calls": stat.get("calls", 0),
            "prompt_tokens": stat.get("prompt_tokens", 0),
            "completion_tokens": stat.get("completion_tokens", 0),
            "total_tokens": stat.get("total_tokens", 0),
            "seconds": stat.get("seconds", 0),
            "last_used": stat.get("last_used"),
        })
    rows.sort(key=lambda r: (r["total_tokens"], r["calls"]), reverse=True)

    return {
        "ok": True,
        "server_time": time.time(),
        "totals": snap["totals"],
        "models": rows,
        "live": snap["live"],
        "recent": snap["recent"][:40],
        "by_day": snap["by_day"],
        "by_mode": snap["by_mode"],
        "by_user": snap["by_user"],
        "users_total": store.total_users(),
        "feedback_unread": store.feedback_unread(),
        "vram": ps.get("models", []),
        "ollama_ok": ollama.get("ok", False),
    }


@app.get("/api/admin/users")
async def admin_users(user: dict = Depends(require_admin_gate)):
    users = store.list_users()
    tokens = metrics.snapshot()["by_user"]
    for u in users:
        tk = tokens.get(u["uid"], {})
        u["tokens"] = {
            "calls": tk.get("calls", 0),
            "prompt_tokens": tk.get("prompt_tokens", 0),
            "completion_tokens": tk.get("completion_tokens", 0),
            "total_tokens": tk.get("total_tokens", 0),
            "last_used": tk.get("last_used"),
        }
    return {"ok": True, "users": users}


@app.get("/api/admin/users/{uid}/conversations")
async def admin_user_conversations(uid: str, user: dict = Depends(require_admin_gate)):
    if not store.get_user(uid):
        raise HTTPException(404, "用户不存在")
    return {"ok": True, "conversations": store.all_conversations(uid)}


@app.get("/api/admin/users/{uid}/conversations/{cid}")
async def admin_user_conversation(uid: str, cid: str, user: dict = Depends(require_admin_gate)):
    conv = store.get_conversation(uid, cid)
    if not conv:
        raise HTTPException(404, "对话不存在")
    return {"ok": True, "conversation": conv}


class AdminPasswordIn(BaseModel):
    password: str


@app.post("/api/admin/users/{uid}/password")
async def admin_set_password(uid: str, body: AdminPasswordIn,
                             user: dict = Depends(require_admin_gate)):
    ok, msg = auth.valid_password(body.password)
    if not ok:
        raise HTTPException(400, msg)
    if not store.get_user(uid):
        raise HTTPException(404, "用户不存在")
    store.set_password_hash(uid, auth.hash_password(body.password))
    return {"ok": True}


class AdminQuotaIn(BaseModel):
    quota_bytes: int


@app.post("/api/admin/users/{uid}/quota")
async def admin_set_quota(uid: str, body: AdminQuotaIn,
                          user: dict = Depends(require_admin_gate)):
    if body.quota_bytes < 0:
        raise HTTPException(400, "配额不能为负")
    if not store.get_user(uid):
        raise HTTPException(404, "用户不存在")
    store.set_quota(uid, body.quota_bytes)
    return {"ok": True, "usage": store.usage(uid)}


class AdminModelToggleIn(BaseModel):
    enabled: bool


@app.post("/api/admin/models/toggle")
async def admin_toggle_model(body: AdminModelToggleIn, name: str = Query(...),
                             user: dict = Depends(require_admin_gate)):
    models = list(cfg.CONFIG.get("models", []))
    for m in models:
        if m.get("name") == name:
            m["enabled"] = body.enabled
            break
    else:
        raise HTTPException(404, f"model {name} not found")
    cfg.CONFIG["models"] = models
    cfg.save(cfg.CONFIG)
    return {"ok": True, "name": name, "enabled": body.enabled}


class AdminSettingsIn(BaseModel):
    ai_enabled: bool | None = None
    allow_register: bool | None = None
    allow_model_add: bool | None = None
    announcement: str | None = None
    default_model: str | None = None
    max_tool_calls_per_step: int | None = None


@app.get("/api/admin/settings")
async def admin_get_settings(user: dict = Depends(require_admin_gate)):
    models = cfg.CONFIG.get("models", [])
    return {
        "ok": True,
        "ai_enabled": bool(cfg.CONFIG.get("ai_enabled", True)),
        "allow_register": bool(cfg.CONFIG.get("allow_register", True)),
        "allow_model_add": bool(cfg.CONFIG.get("allow_model_add", True)),
        "announcement": cfg.CONFIG.get("announcement", "") or "",
        "default_model": cfg.CONFIG.get("default_model") or cfg.CONFIG.get("model"),
        "max_tool_calls_per_step": int(cfg.CONFIG.get("max_tool_calls_per_step") or 8),
        "models": [
            {"name": m["name"], "display": m.get("display") or m["name"],
             "enabled": m.get("enabled", True)}
            for m in models
        ],
    }


@app.post("/api/admin/settings")
async def admin_set_settings(body: AdminSettingsIn,
                             user: dict = Depends(require_admin_gate)):
    if body.ai_enabled is not None:
        cfg.CONFIG["ai_enabled"] = bool(body.ai_enabled)
    if body.allow_register is not None:
        cfg.CONFIG["allow_register"] = bool(body.allow_register)
    if body.allow_model_add is not None:
        cfg.CONFIG["allow_model_add"] = bool(body.allow_model_add)
    if body.announcement is not None:
        cfg.CONFIG["announcement"] = body.announcement.strip()[:500]
    if body.max_tool_calls_per_step is not None:
        cfg.CONFIG["max_tool_calls_per_step"] = max(1, min(int(body.max_tool_calls_per_step), 50))
    if body.default_model is not None:
        names = {m["name"] for m in cfg.CONFIG.get("models", [])}
        if body.default_model and body.default_model not in names:
            raise HTTPException(400, f"未知模型: {body.default_model}")
        cfg.CONFIG["default_model"] = body.default_model
    cfg.save(cfg.CONFIG)
    return {"ok": True}


class AdminModelEditIn(BaseModel):
    name: str
    display: str | None = None
    tier: str | None = None
    base_url: str | None = None
    api_key: str | None = None
    context_len: int | None = None
    desc: str | None = None
    enabled: bool | None = None


@app.post("/api/admin/models/edit")
async def admin_edit_model(body: AdminModelEditIn,
                           user: dict = Depends(require_admin_gate)):
    """Edit an existing model (built-in or API). Empty api_key keeps the old one."""
    import secrets as _sec
    models = list(cfg.CONFIG.get("models", []))
    target = next((m for m in models if m.get("name") == body.name), None)
    if target is None:
        raise HTTPException(404, f"model {body.name} not found")
    if body.display is not None:
        target["display"] = body.display
    if body.tier is not None:
        target["tier"] = body.tier
    if body.base_url is not None:
        target["base_url"] = body.base_url
    if body.context_len is not None:
        target["context_len"] = int(body.context_len)
    if body.desc is not None:
        target["desc"] = body.desc
    if body.enabled is not None:
        target["enabled"] = bool(body.enabled)
    if body.api_key:
        ref = target.get("api_key_ref") or f"sk__{_sec.token_hex(6)}"
        cfg.CONFIG.setdefault("api_keys", {})[ref] = body.api_key
        target["api_key_ref"] = ref
    cfg.CONFIG["models"] = models
    cfg.save(cfg.CONFIG)
    return {"ok": True, "model": target}


class AdminModelTestIn(BaseModel):
    name: str = ""            # model id sent to the provider
    base_url: str = ""
    api_key: str = ""         # empty + model_ref = reuse the stored key
    model_ref: str = ""       # test an already-saved model instead


@app.post("/api/admin/models/test")
async def admin_test_model(body: AdminModelTestIn,
                           user: dict = Depends(require_admin_gate)):
    """Round-trip a provider to verify base_url / key / model before saving."""
    base = body.base_url.strip()
    key = body.api_key.strip()
    target = body.name.strip()
    if body.model_ref:
        m = llm.model_config(body.model_ref)
        if not m:
            raise HTTPException(404, f"model {body.model_ref} not found")
        base = base or (m.get("base_url") or "")
        target = target or m.get("name", "")
        if not key:
            key = (cfg.CONFIG.get("api_keys") or {}).get(m.get("api_key_ref") or "", "")
    if not base:
        raise HTTPException(400, "请填写 Base URL")
    if not target:
        raise HTTPException(400, "请填写模型名称")
    try:
        reply = await llm.probe(base, key, target)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(400, f"连接失败：{exc}") from exc
    return {"ok": True, "reply": reply}


class AdminModelRunTestIn(BaseModel):
    name: str          # catalog name of the model to exercise
    prompt: str = ""   # optional custom probe prompt


@app.post("/api/admin/models/run-test")
async def admin_run_test(body: AdminModelRunTestIn,
                         user: dict = Depends(require_admin_gate)):
    """Actually generate a few tokens with the model and report timing.

    Local Ollama models are timed through the native API (including cold-start
    load duration); external API models reuse the lightweight provider probe.
    This is the "检查本地部署模型是否能正常运行 / 长时间不输出" health check.
    """
    name = (body.name or "").strip()
    if not any(m.get("name") == name for m in cfg.CONFIG.get("models", [])):
        raise HTTPException(404, f"未知模型: {name}")
    m = llm.model_config(name)
    if (m.get("base_url") or "").strip():
        import time as _time
        key = (cfg.CONFIG.get("api_keys") or {}).get(m.get("api_key_ref") or "", "")
        started = _time.time()
        try:
            reply = await llm.probe(m["base_url"], key, name)
        except Exception as exc:  # noqa: BLE001
            raise HTTPException(400, f"试运行失败：{exc}") from exc
        return {"ok": True, "kind": "api", "wall_seconds": round(_time.time() - started, 2),
                "reply": reply}
    try:
        res = await llm.local_probe(name, prompt=body.prompt or "请用一句话介绍你自己。")
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(400, f"试运行失败：{exc}") from exc
    res["kind"] = "local"
    return res


class AdminModelAddIn(BaseModel):
    name: str
    display: str = ""
    tier: str = "自定义"
    provider: str = "openai"
    base_url: str = ""
    api_key: str = ""
    context_len: int = 8192
    size_mb: int = 0
    desc: str = ""


@app.post("/api/admin/models")
async def admin_add_model(body: AdminModelAddIn,
                          user: dict = Depends(require_admin_gate)):
    import secrets as _sec
    if not cfg.CONFIG.get("allow_model_add", True):
        raise HTTPException(403, "已暂停新增模型，请先在系统权限中开启")
    models = list(cfg.CONFIG.get("models", []))
    if any(m.get("name") == body.name for m in models):
        raise HTTPException(400, f"model {body.name} already exists")
    api_keys = cfg.CONFIG.setdefault("api_keys", {})
    key_ref = f"sk__{_sec.token_hex(6)}"
    api_keys[key_ref] = body.api_key
    entry = {
        "name": body.name, "display": body.display or body.name,
        "tier": body.tier, "size_mb": body.size_mb, "enabled": True,
        "provider": body.provider, "base_url": body.base_url,
        "api_key_ref": key_ref, "context_len": body.context_len, "desc": body.desc,
    }
    models.append(entry)
    cfg.CONFIG["models"] = models
    cfg.save(cfg.CONFIG)
    return {"ok": True, "model": entry}


@app.delete("/api/admin/models/delete")
async def admin_delete_model(name: str = Query(...),
                             user: dict = Depends(require_admin_gate)):
    from server import config as _cfg_mod
    defaults = {m["name"] for m in _cfg_mod.DEFAULT_MODELS}
    if name in defaults:
        raise HTTPException(400, "默认内置模型不能删除（可以暂停）")
    models = [m for m in cfg.CONFIG.get("models", []) if m.get("name") != name]
    for m in cfg.CONFIG.get("models", []):
        if m.get("name") == name and m.get("api_key_ref"):
            cfg.CONFIG.setdefault("api_keys", {}).pop(m["api_key_ref"], None)
    cfg.CONFIG["models"] = models
    cfg.save(cfg.CONFIG)
    return {"ok": True}


class AdminUserModelsIn(BaseModel):
    model_allowed: list[str] | None = None


@app.post("/api/admin/users/{uid}/models")
async def admin_set_user_models(uid: str, body: AdminUserModelsIn,
                                user: dict = Depends(require_admin_gate)):
    try:
        store.set_user_model_allowed(uid, body.model_allowed)
    except KeyError:
        raise HTTPException(404, "用户不存在")
    return {"ok": True, "model_allowed": body.model_allowed}


@app.delete("/api/admin/users/{uid}")
async def admin_delete_user(uid: str, user: dict = Depends(require_admin_gate)):
    if uid == user["uid"]:
        raise HTTPException(400, "不能删除当前登录的管理员账号")
    return {"ok": store.delete_user(uid)}


@app.post("/api/admin/metrics/reset")
async def admin_reset_metrics(user: dict = Depends(require_admin_gate)):
    metrics.reset()
    return {"ok": True}


# --------------------------------------------------------------------------- #
# mail service (admin): sender account settings + broadcast to all users
# --------------------------------------------------------------------------- #
class SmtpIn(BaseModel):
    host: str | None = None
    port: int | None = None
    protocol: str | None = None          # ssl | starttls
    user: str | None = None              # sender address
    auth_code: str | None = None         # empty = keep the stored one
    from_name: str | None = None


@app.get("/api/admin/email")
async def admin_get_email(user: dict = Depends(require_admin_gate)):
    s = cfg.CONFIG.get("smtp") or {}
    return {
        "ok": True,
        "host": s.get("host", ""),
        "port": int(s.get("port") or 465),
        "protocol": s.get("protocol") or "ssl",
        "user": s.get("user", ""),
        "from_name": s.get("from_name", ""),
        "has_auth_code": bool(s.get("auth_code")),
        "users_total": store.total_users(),
    }


@app.post("/api/admin/email")
async def admin_set_email(body: SmtpIn, user: dict = Depends(require_admin_gate)):
    s = cfg.CONFIG.setdefault("smtp", {})
    if body.host is not None:
        s["host"] = body.host.strip() or "smtp.qq.com"
    if body.port is not None:
        s["port"] = max(1, min(int(body.port), 65535))
    if body.protocol is not None:
        p = body.protocol.strip().lower()
        s["protocol"] = p if p in ("ssl", "starttls") else "ssl"
    if body.user is not None:
        s["user"] = body.user.strip()
    if body.auth_code:
        s["auth_code"] = body.auth_code.strip()
    if body.from_name is not None:
        s["from_name"] = body.from_name.strip() or "YJS LLM Agent"
    cfg.save(cfg.CONFIG)
    return {"ok": True}


class TestMailIn(BaseModel):
    to: str = ""


@app.post("/api/admin/email/test")
async def admin_test_email(body: TestMailIn, user: dict = Depends(require_admin_gate)):
    """Log in to the SMTP server and send one message to prove it works."""
    to = (body.to or "").strip() or user["email"]
    html = auth._wrap("邮件配置测试",
                      "<p>如果你收到这封邮件，说明后台的发件邮箱配置正确。</p>")
    try:
        await asyncio.to_thread(auth.send_mail, to, "YJS 邮件配置测试", html)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(400, f"发送失败：{exc}") from exc
    return {"ok": True, "to": to}


class BroadcastIn(BaseModel):
    subject: str
    body: str
    only_me: bool = False        # send only to the admin's own mailbox (dry run)


@app.post("/api/admin/email/broadcast")
async def admin_broadcast(body: BroadcastIn, user: dict = Depends(require_admin_gate)):
    """Send an announcement mail to every registered account."""
    subject = (body.subject or "").strip()[:120]
    content = (body.body or "").strip()
    if not subject:
        raise HTTPException(400, "请填写邮件主题")
    if not content:
        raise HTTPException(400, "请填写邮件正文")
    targets = [u["email"] for u in store.list_users() if u.get("email")]
    if body.only_me:
        targets = [user["email"]]
    targets = targets[:500]
    if not targets:
        raise HTTPException(400, "没有可发送的目标邮箱")
    html = auth._wrap(_esc(subject), "<p>" + _esc(content).replace("\n", "<br>") + "</p>")
    sent: list[str] = []
    failed: list[dict] = []
    for email in targets:
        try:
            await asyncio.to_thread(auth.send_mail, email, subject, html)
            sent.append(email)
        except Exception as exc:  # noqa: BLE001
            failed.append({"email": email, "error": str(exc)[:200]})
    return {"ok": True, "total": len(targets), "sent": len(sent), "failed": failed}


# --------------------------------------------------------------------------- #
# user feedback (admin review)
# --------------------------------------------------------------------------- #
@app.get("/api/admin/feedback")
async def admin_list_feedback(user: dict = Depends(require_admin_gate)):
    items = store.list_feedback()
    return {"ok": True, "items": items,
            "unread": sum(1 for i in items if i.get("status") == "new")}


class FeedbackStatusIn(BaseModel):
    status: str


@app.post("/api/admin/feedback/{fid}/status")
async def admin_feedback_status(fid: str, body: FeedbackStatusIn,
                                user: dict = Depends(require_admin_gate)):
    if not store.update_feedback(fid, body.status):
        raise HTTPException(404, "反馈不存在")
    return {"ok": True}


@app.delete("/api/admin/feedback/{fid}")
async def admin_feedback_delete(fid: str, user: dict = Depends(require_admin_gate)):
    return {"ok": store.delete_feedback(fid)}


# --------------------------------------------------------------------------- #
# GitHub repository (admin): encrypted token + repo password gate
# --------------------------------------------------------------------------- #
REPO_SESSION_TTL = 6 * 3600
_REPO_SESSION: dict[str, dict] = {}       # uid -> {"key": password, "exp": ts}

PUBLISH_EXCLUDES = (
    "config.local.json", "config.local.json.bak", "data", "models", ".venv",
    "bin", "__pycache__", ".git", "_probe.py", "_agenttest.py", "start-all.bat",
)


def _github_cfg() -> dict:
    return cfg.CONFIG.setdefault("github", {})


def _repo_unlocked(uid: str) -> bool:
    sess = _REPO_SESSION.get(uid)
    return bool(sess and sess.get("exp", 0) > time.time())


def _require_repo_unlocked(uid: str) -> dict:
    if not _repo_unlocked(uid):
        raise HTTPException(401, "请先输入仓库管理密码解锁")
    return _REPO_SESSION[uid]


class AdminPasswordIn(BaseModel):
    password: str


@app.get("/api/admin/github")
async def admin_github_status(user: dict = Depends(require_admin_gate)):
    gh = _github_cfg()
    sec = gh.get("token_secret") or {}
    unlocked = _repo_unlocked(user["uid"])
    return {
        "ok": True,
        "repo": gh.get("repo", ""),
        "branch": gh.get("branch", "main"),
        "path_prefix": gh.get("path_prefix", ""),
        "has_token": bool(gh.get("token")),
        "encrypted": bool(sec),
        "mode": sec.get("mode", ""),          # session | repo | ""
        "has_password": bool((gh.get("password_hash") or "").strip()),
        "unlocked": unlocked,
    }


class RepoPasswordIn(BaseModel):
    password: str
    token: str | None = None       # optional: encrypt & store this token right away


@app.post("/api/admin/github/password")
async def admin_github_set_password(body: RepoPasswordIn,
                                    user: dict = Depends(require_admin_gate)):
    """Set (or change) the repo password; optionally encrypt the token with it."""
    pw = (body.password or "").strip()
    if len(pw) < 6:
        raise HTTPException(400, "仓库管理密码至少 6 位")
    gh = _github_cfg()
    token = (body.token or "").strip() or str(gh.get("token") or "").strip()
    gh["password_hash"] = auth.hash_password(pw)
    if token:
        gh["token"] = token
        gh["token_secret"] = {"mode": "repo", **cfg.encrypt_secret(token, pw)}
    cfg.save(cfg.CONFIG)
    _REPO_SESSION[user["uid"]] = {"key": pw, "exp": time.time() + REPO_SESSION_TTL}
    return {"ok": True, "has_token": bool(token), "encrypted": bool(token)}


@app.post("/api/admin/github/unlock")
async def admin_github_unlock(body: AdminPasswordIn,
                              user: dict = Depends(require_admin_gate)):
    """Enter the repo password to decrypt the token and enable repo changes."""
    gh = _github_cfg()
    stored = (gh.get("password_hash") or "").strip()
    if not stored:
        raise HTTPException(400, "尚未设置仓库管理密码，请先设置")
    if not auth.check_password(body.password, stored):
        raise HTTPException(401, "仓库管理密码错误")
    sec = gh.get("token_secret") or {}
    if sec.get("mode") == "repo":
        token = cfg.decrypt_secret(sec, body.password)
        if not token:
            raise HTTPException(400, "密码与已加密的 token 不匹配")
        gh["token"] = token
    _REPO_SESSION[user["uid"]] = {"key": body.password,
                                  "exp": time.time() + REPO_SESSION_TTL}
    return {"ok": True, "has_token": bool(gh.get("token"))}


class RepoTokenIn(BaseModel):
    token: str


@app.post("/api/admin/github/token")
async def admin_github_set_token(body: RepoTokenIn,
                                 user: dict = Depends(require_admin_gate)):
    """Replace the token; encrypted with the repo password from the session."""
    sess = _require_repo_unlocked(user["uid"])
    token = (body.token or "").strip()
    if not token:
        raise HTTPException(400, "请填写 GitHub token")
    gh = _github_cfg()
    gh["token"] = token
    gh["token_secret"] = {"mode": "repo", **cfg.encrypt_secret(token, sess["key"])}
    cfg.save(cfg.CONFIG)
    return {"ok": True}


class RepoConfigIn(BaseModel):
    repo: str
    branch: str = "main"
    path_prefix: str = ""


@app.post("/api/admin/github/config")
async def admin_github_config(body: RepoConfigIn,
                              user: dict = Depends(require_admin_gate)):
    _require_repo_unlocked(user["uid"])
    repo = (body.repo or "").strip().strip("/")
    if repo.count("/") != 1:
        raise HTTPException(400, "仓库格式应为 owner/repo")
    gh = _github_cfg()
    gh["repo"] = repo
    gh["branch"] = (body.branch or "main").strip() or "main"
    gh["path_prefix"] = (body.path_prefix or "").strip().strip("/")
    cfg.save(cfg.CONFIG)
    return {"ok": True}


@app.post("/api/admin/github/test")
async def admin_github_test(user: dict = Depends(require_admin_gate)):
    _require_repo_unlocked(user["uid"])
    try:
        info = await github_sync.whoami()
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(400, f"连接失败：{exc}") from exc
    return {"ok": True, "repo": info}


@app.post("/api/admin/github/publish")
async def admin_github_publish(user: dict = Depends(require_admin_gate)):
    """Push the current workspace tree to the configured repository."""
    _require_repo_unlocked(user["uid"])
    try:
        uploaded = await github_sync.publish_tree(cfg.ROOT, excludes=PUBLISH_EXCLUDES)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(400, f"发布失败：{exc}") from exc
    return {"ok": True, "count": len(uploaded), "files": uploaded}


# --------------------------------------------------------------------------- #
# MCP servers (admin)
# --------------------------------------------------------------------------- #
def _parse_command(raw: str) -> list[str]:
    """Parse a shell-ish command line into argv.

    Accepts a JSON array (``["npx","-y","pkg"]``) or a plain space-separated
    string; quoted segments are kept together.
    """
    raw = (raw or "").strip()
    if not raw:
        return []
    if raw.startswith("["):
        try:
            arr = json.loads(raw)
            if isinstance(arr, list):
                return [str(x) for x in arr]
        except json.JSONDecodeError:
            pass
    import shlex

    try:
        tokens = shlex.split(raw, posix=False)
    except ValueError:
        tokens = raw.split()
    return [t[1:-1] if len(t) >= 2 and t[0] == t[-1] and t[0] in "\"'" else t
            for t in tokens if t]


class MCPServerIn(BaseModel):
    name: str
    command: str = ""
    env: dict[str, str] | None = None


@app.get("/api/admin/mcp")
async def admin_list_mcp(with_tools: bool = Query(default=False),
                         user: dict = Depends(require_admin_gate)):
    servers = cfg.CONFIG.get("mcp_servers", {}) or {}
    out: list[dict] = []
    for name, spec in servers.items():
        cmd = list(spec.get("command", []) or [])
        out.append({
            "name": name,
            "command": cmd,
            "command_str": " ".join(cmd),
            "env": spec.get("env", {}) or {},
        })
    if with_tools:
        for s in out:
            res = await mcp_client.list_tools(s["name"])
            s["tools"] = res.get("tools", []) if res.get("ok") else []
            s["error"] = None if res.get("ok") else res.get("error")
    return {"ok": True, "servers": out}


@app.post("/api/admin/mcp")
async def admin_save_mcp(body: MCPServerIn, user: dict = Depends(require_admin_gate)):
    """Add or update an MCP server (stdio command + optional env)."""
    name = body.name.strip()
    if not name:
        raise HTTPException(400, "请填写服务器名称")
    cmd = _parse_command(body.command)
    if not cmd:
        raise HTTPException(400, "请填写启动命令，例如：npx -y @modelcontextprotocol/server-filesystem D:/yjs")
    servers = cfg.CONFIG.setdefault("mcp_servers", {})
    entry: dict = {"command": cmd}
    env = {str(k).strip(): str(v) for k, v in (body.env or {}).items() if str(k).strip()}
    if env:
        entry["env"] = env
    servers[name] = entry
    cfg.CONFIG["mcp_servers"] = servers
    cfg.save(cfg.CONFIG)
    return {"ok": True, "name": name}


@app.delete("/api/admin/mcp")
async def admin_delete_mcp(name: str = Query(...), user: dict = Depends(require_admin_gate)):
    servers = cfg.CONFIG.get("mcp_servers", {}) or {}
    if name not in servers:
        raise HTTPException(404, f"未配置的 MCP 服务器: {name}")
    servers.pop(name, None)
    cfg.CONFIG["mcp_servers"] = servers
    cfg.save(cfg.CONFIG)
    await mcp_client.shutdown()
    return {"ok": True}


@app.post("/api/admin/mcp/test")
async def admin_test_mcp(name: str = Query(...), user: dict = Depends(require_admin_gate)):
    """Start the server and list its tools to prove the command works."""
    servers = cfg.CONFIG.get("mcp_servers", {}) or {}
    if name not in servers:
        raise HTTPException(404, f"未配置的 MCP 服务器: {name}")
    await mcp_client.shutdown()
    res = await mcp_client.list_tools(name)
    if not res.get("ok"):
        raise HTTPException(400, f"连接失败：{res.get('error')}")
    return {"ok": True, "tools": res.get("tools", [])}


@app.get("/admin")
@app.get("/admin.html")
async def admin_page():
    f = cfg.ROOT / "admin.html"
    if not f.exists():
        raise HTTPException(404, "admin.html 缺失")
    return FileResponse(f)


# --------------------------------------------------------------------------- #
# WebGPU offline model weights proxy
#   browser -> (ngrok tunnel) -> local server -> hf-mirror / huggingface.co
# Browser network may be blocked while the local server can reach mirrors,
# so weights are relayed here and cached once on local disk (shared, not per-user).
# --------------------------------------------------------------------------- #
WEB_WEIGHTS_DIR = cfg.DATA_DIR / "web_weights"
_weight_locks: dict[str, asyncio.Lock] = {}
# Fastest mirror first (measured from the local server):
#   modelscope ~9 MB/s > hf-mirror ~2 MB/s > huggingface.co (often blocked).
# Each entry maps an HF-style path ("{model}/resolve/{revision}/{file}")
# to a full upstream URL, or returns None when the mirror cannot serve it.
def _mirror_modelscope(rest: str) -> str | None:
    # ModelScope keeps the same repo layout but uses "master" as the branch.
    parts = rest.split("/resolve/", 1)
    if len(parts) != 2:
        return None
    model, tail = parts
    rev, _, fname = tail.partition("/")
    branch = "master" if rev == "main" else rev
    return f"https://modelscope.cn/models/{model}/resolve/{branch}/{fname}"


def _mirror_hf(base: str):
    return lambda rest: f"{base}/{rest}"


_WEIGHT_MIRRORS = (
    ("modelscope", _mirror_modelscope),
    ("hf-mirror", lambda r: _mirror_hf("https://hf-mirror.com")(r)),
    ("huggingface", lambda r: _mirror_hf("https://huggingface.co")(r)),
)
_HF_PASS_HEADERS = (
    "content-type", "content-length", "accept-ranges",
    "content-range", "etag", "last-modified",
)


@app.get("/api/local-weights/{rest:path}")
async def local_weights_proxy(rest: str, request: Request):
    if not rest or "\\" in rest or ".." in rest.split("/"):
        raise HTTPException(400, "非法路径")
    cache_path = (WEB_WEIGHTS_DIR / rest).resolve()
    if WEB_WEIGHTS_DIR.resolve() not in cache_path.parents:
        raise HTTPException(400, "非法路径")
    if cache_path.is_file():
        return FileResponse(cache_path)

    lock = _weight_locks.setdefault(rest, asyncio.Lock())
    async with lock:
        if cache_path.is_file():
            return FileResponse(cache_path)
        cache_path.parent.mkdir(parents=True, exist_ok=True)
        part_path = cache_path.with_name(cache_path.name + ".part")

        last_error = "未知错误"
        last_status = 502
        for name, build_url in _WEIGHT_MIRRORS:
            url = build_url(rest)
            if not url:
                continue
            client = httpx.AsyncClient(
                follow_redirects=True,
                timeout=httpx.Timeout(60.0, connect=30.0, read=300.0),
            )
            try:
                req = client.build_request(
                    "GET", url, headers={"User-Agent": "yjs-webgpu/1.0"}
                )
                upstream = await client.send(req, stream=True)
            except Exception as e:  # network error -> try next mirror
                last_error = f"{name}: {e}"
                await client.aclose()
                continue
            if upstream.status_code >= 400:
                # Remember the status: a genuinely missing optional file
                # (transformers.js tolerates 404s) must look like a 404 to
                # the browser even after every mirror has been tried.
                last_status = upstream.status_code
                last_error = f"{name}: 上游 HTTP {upstream.status_code}"
                await upstream.aclose()
                await client.aclose()
                continue

            headers = {
                k: v for k, v in upstream.headers.items()
                if k.lower() in _HF_PASS_HEADERS
            }
            fout = open(part_path, "wb")

            async def _stream():
                ok = False
                try:
                    async for chunk in upstream.aiter_bytes(262144):
                        fout.write(chunk)
                        yield chunk
                    fout.flush()
                    ok = True
                finally:
                    fout.close()
                    await upstream.aclose()
                    await client.aclose()
                    if ok and await request.is_disconnected() is False:
                        try:
                            os.replace(part_path, cache_path)
                        except OSError:
                            pass
                    else:
                        # aborted/incomplete download: never serve a .part
                        try:
                            os.remove(part_path)
                        except OSError:
                            pass

            return StreamingResponse(_stream(), status_code=200, headers=headers)

        if last_status in (401, 403, 404, 410):
            return Response(status_code=last_status)
        raise HTTPException(502, f"权重上游不可用：{last_error}")


# --------------------------------------------------------------------------- #
# static frontend
# --------------------------------------------------------------------------- #
@app.get("/")
async def index():
    return FileResponse(cfg.ROOT / "index.html")


@app.get("/sw.js")
async def service_worker():
    f = cfg.ROOT / "sw.js"
    if not f.exists():
        raise HTTPException(404)
    return FileResponse(f, media_type="application/javascript")


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