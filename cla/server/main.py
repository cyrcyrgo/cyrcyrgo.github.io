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

from . import agent, auth, config as cfg, github_sync, llm, metrics, store, tools, tunnel

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
    # Order: request body override -> user profile preference -> server default.
    resolved_model = body.model
    if not resolved_model:
        resolved_model = user.get("model_preference")
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
        raise HTTPException(400, f"连接失败：{exc}")
    return {"ok": True, "reply": reply}


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


@app.get("/admin")
@app.get("/admin.html")
async def admin_page():
    f = cfg.ROOT / "admin.html"
    if not f.exists():
        raise HTTPException(404, "admin.html 缺失")
    return FileResponse(f)


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