"""YJS LLM Agent -- FastAPI application (local agent server + static frontend)."""
from __future__ import annotations

import asyncio
import io
import json
import os
import random
import re
import threading
import time
import uuid
import zipfile
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
    # A hard freeze logs the account out EVERYWHERE immediately: every token
    # (on every device, issued at any time) is rejected until the freeze is
    # lifted server-side and the user logs in again.
    if store.get_auth_state(user.get("email", "")).get("hard_locked"):
        raise HTTPException(401, "账号已被安全冻结，请在解冻后重新登录")
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
async def verify(body: VerifyIn, request: Request):
    email = body.email.strip().lower()
    if not auth.verify_code(email, body.code):
        raise HTTPException(400, "验证码错误或已过期")
    if _frozen_state(email):
        raise HTTPException(423, "账号已被安全冻结，请先完成账号解冻申请")
    user = store.get_user_by_email(email)
    if not user:
        if not cfg.CONFIG["allow_register"]:
            raise HTTPException(403, "暂不允许注册")
        user = store.create_user(email)
    store.touch_login(user["uid"], _client_ip(request))
    _flush_unfreeze_notice(user)
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
    data = _public_user(user)
    data["quota_request"] = store.latest_quota_request(user["uid"])
    return {"ok": True, "user": data}


class PasswordLoginIn(BaseModel):
    email: str
    password: str


@app.post("/api/auth/login")
async def password_login(body: PasswordLoginIn, request: Request):
    """Email + password login with server-side brute-force protection.

    - 3 wrong attempts  -> 30s soft lock (any client/device, server timed)
    - 4th wrong attempt -> hard freeze; an unfreeze request is required
    """
    email = body.email.strip().lower()
    state = store.get_auth_state(email)
    now = time.time()

    if state.get("hard_locked"):
        raise HTTPException(423, {
            "code": "hard_locked",
            "message": "密码连续错误，账号已被安全冻结，请发起账号解冻申请",
        })
    locked_until = float(state.get("locked_until") or 0)
    if locked_until > now:
        raise HTTPException(429, {
            "code": "soft_locked",
            "wait": int(locked_until - now) + 1,
            "message": f"密码错误次数过多，请 {int(locked_until - now) + 1} 秒后再试",
        })

    user = store.get_user_by_email(email)
    valid = bool(user) and auth.check_password(body.password,
                                               user.get("password_hash"))
    if not valid:
        fails = int(state.get("fails") or 0) + 1
        state["fails"] = fails
        state["last_fail_at"] = now
        if fails >= PW_HARD_LOCK_FAILS:
            state["hard_locked"] = True
            state["frozen_at"] = now
            # one freeze episode = one allowed questionnaire submission
            state["freeze_id"] = uuid.uuid4().hex
            state["unfreeze_id"] = ""
            store.set_auth_state(email, state)
            # requests left over from a previous freeze cannot be reused
            store.supersede_open_unfreeze(email)
            print(f"[security] account hard-frozen after {fails} fails: {email}")
            raise HTTPException(423, {
                "code": "hard_locked",
                "message": "第 4 次密码错误，账号已被安全冻结，请发起账号解冻申请",
            })
        if fails >= PW_SOFT_LOCK_FAILS:
            state["locked_until"] = now + PW_SOFT_LOCK_SECONDS
            store.set_auth_state(email, state)
            raise HTTPException(429, {
                "code": "soft_locked",
                "wait": PW_SOFT_LOCK_SECONDS,
                "message": f"已连续错误 {fails} 次，请 {PW_SOFT_LOCK_SECONDS} 秒后再试；"
                           "再错一次账号将被冻结",
            })
        store.set_auth_state(email, state)
        left = PW_SOFT_LOCK_FAILS - fails
        raise HTTPException(400, f"邮箱或密码错误（还可尝试 {left} 次）")

    store.reset_auth_state(email)
    store.touch_login(user["uid"], _client_ip(request))
    _flush_unfreeze_notice(user)
    token = auth.make_token(user["uid"], email)
    return {"ok": True, "token": token, "user": _public_user(user)}


PW_SOFT_LOCK_FAILS = 3
PW_SOFT_LOCK_SECONDS = 30
PW_HARD_LOCK_FAILS = 4
UNFREEZE_PASS_SCORE = 50.0


def _client_ip(request: Request) -> str:
    fwd = request.headers.get("x-forwarded-for", "")
    if fwd:
        return fwd.split(",")[0].strip()[:64]
    return (request.client.host if request.client else "")[:64]


def _frozen_state(email: str) -> dict | None:
    st = store.get_auth_state((email or "").lower())
    return st if st.get("hard_locked") else None


def _flush_unfreeze_notice(user: dict) -> None:
    """Deliver a queued "account unfrozen" notice on the next login (once)."""
    uid = user.get("uid")
    if not uid:
        return
    pend = store.take_pending_unfreeze_notice(uid)
    if not pend:
        return
    when = time.strftime("%Y-%m-%d %H:%M",
                         time.localtime(pend.get("at") or time.time()))
    store.create_user_notice(
        uid, "账号已解冻",
        f"你的账号已于 {when} 完成安全解冻，现已恢复正常使用。"
        "如非本人操作，请立即修改登录密码。",
        author=(pend.get("by") or "管理员"), kind="unfreeze")


# --------------------------------------------------------------- unfreeze -- #
# Multiple-choice usage-trace questionnaire. Choices are generated SERVER-SIDE
# from the account's real data plus plausible distractors; only the option
# strings ever leave the server (never which one is correct).
UNFREEZE_QUESTIONS = [
    {"key": "name", "label": "账号昵称（我的账户中显示的名称）", "weight": 20},
    {"key": "register_month", "label": "账号注册的月份", "weight": 15},
    {"key": "last_login_days", "label": "你最近一次登录大概在什么时候", "weight": 15},
    {"key": "conversation_count", "label": "账号里历史对话的数量级", "weight": 15},
    {"key": "model", "label": "你最常用的模型", "weight": 15},
    {"key": "file_name", "label": "你的「我的文件」里有哪个文件", "weight": 20},
]

_DAY_BUCKETS = [
    ("今天", lambda d: d <= 1),
    ("2–3 天内", lambda d: 2 <= d <= 3),
    ("4–7 天内", lambda d: 4 <= d <= 7),
    ("8–30 天内", lambda d: 8 <= d <= 30),
    ("1–3 个月内", lambda d: 31 <= d <= 90),
    ("3 个月以上", lambda d: d > 90),
]
_CNT_BUCKETS = [
    ("0 个（没有对话）", lambda n: n == 0),
    ("1–5 个", lambda n: 1 <= n <= 5),
    ("6–20 个", lambda n: 6 <= n <= 20),
    ("21–50 个", lambda n: 21 <= n <= 50),
    ("51–100 个", lambda n: 51 <= n <= 100),
    ("100 个以上", lambda n: n > 100),
]
# Cloud-space allowance tiers (the real answer is the account's quota_bytes).
_QUOTA_BUCKETS = [
    ("50 MB（基础云空间）", 50),
    ("100 MB", 100),
    ("500 MB", 500),
    ("1 GB", 1024),
    ("2 GB", 2048),
    ("5 GB 或更多", 5120),
]
# How many files live in the workspace.
_FILE_CNT_BUCKETS = [
    ("0 个（还没有文件）", lambda n: n == 0),
    ("1–3 个", lambda n: 1 <= n <= 3),
    ("4–10 个", lambda n: 4 <= n <= 10),
    ("11–30 个", lambda n: 11 <= n <= 30),
    ("31–100 个", lambda n: 31 <= n <= 100),
    ("100 个以上", lambda n: n > 100),
]
_NAME_DISTRACTORS = [
    "小明", "阿杰", "测试用户", "云影", "星辰", "Alex", "小雨",
    "管理员", "匿名用户", "路人甲", "木子", "晨曦",
]
_FILE_DISTRACTORS = [
    "学习笔记.txt", "工作报告.docx", "数据统计.xlsx", "截图.png",
    "简历.pdf", "未命名文档.doc", "会议记录.txt", "计划表.xlsx",
]
_NO_FILE_OPTION = "（我还没有上传过文件）"
_UNFREEZE_TOTAL_QUESTIONS = 20
_UNFREEZE_AI_QUESTIONS = 8


def _month_label(ts: float) -> str:
    return time.strftime("%Y-%m", time.localtime(ts))


def _month_offset(ts: float, delta: int) -> str:
    lt = time.localtime(ts)
    idx = (lt.tm_year * 12 + (lt.tm_mon - 1)) + delta
    return f"{idx // 12:04d}-{idx % 12 + 1:02d}"


def _day_bucket(days: float) -> str:
    return next((lab for lab, f in _DAY_BUCKETS if f(days)), _DAY_BUCKETS[-1][0])


def _cnt_bucket(n: int) -> str:
    return next((lab for lab, f in _CNT_BUCKETS if f(n)), _CNT_BUCKETS[-1][0])


def _shuffle_take(pool: list, n: int) -> list:
    p = list(pool)
    random.shuffle(p)
    return p[:n]


def _quota_bucket(quota_bytes: int) -> str:
    mb = int(round((quota_bytes or 0) / (1024 * 1024)))
    if mb <= 50:
        return _QUOTA_BUCKETS[0][0]
    for i in range(1, len(_QUOTA_BUCKETS)):
        prev_mb, cur_mb = _QUOTA_BUCKETS[i - 1][1], _QUOTA_BUCKETS[i][1]
        if prev_mb < mb <= cur_mb:
            return _QUOTA_BUCKETS[i][0]
    return _QUOTA_BUCKETS[-1][0]


def _file_cnt_bucket(n: int) -> str:
    return next((lab for lab, f in _FILE_CNT_BUCKETS if f(n)),
                _FILE_CNT_BUCKETS[-1][0])


def _unfreeze_truth(user: dict) -> dict:
    """The correct choice for every question, computed from server data."""
    email = user.get("email", "")
    name = (user.get("name") or "").strip() or email.split("@")[0]
    created = float(user.get("created_at") or time.time())
    last = float(user.get("last_login") or created)
    real_days = max(0.0, (time.time() - last) / 86400)
    convs = store.list_conversations(user["uid"])
    real_cnt = len(convs)
    titles = [c.get("title", "") for c in convs if (c.get("title") or "").strip()]
    files = sorted({p.name for p in store.workspace(user["uid"]).glob("**/*")
                    if p.is_file()})
    quota = int(user.get("quota_bytes") or cfg.CONFIG.get("quota_bytes") or 0)
    return {
        "name": name,
        "email_local": email.split("@")[0],
        "email_domain": email.split("@")[1] if "@" in email else "",
        "register_month": _month_label(created),
        "register_date": time.strftime("%Y-%m-%d", time.localtime(created)),
        "last_login_days": _day_bucket(real_days),
        "conversation_count": _cnt_bucket(real_cnt),
        "model": (user.get("model_preference") or cfg.CONFIG.get("model") or ""),
        "file_name": _NO_FILE_OPTION if not files else files,  # any own file ok
        "file_count": _file_cnt_bucket(len(files)),
        "file_count_n": len(files),
        "conv_titles": titles,
        "quota": _quota_bucket(quota),
        "created": created,
        "last": last,
    }


def _unfreeze_options(user: dict) -> dict:
    """Build the shuffled choice list for each question."""
    truth = _unfreeze_truth(user)
    opts: dict[str, list] = {}

    # name: real nickname + generic distractors (never leak other users)
    name_pool = [n for n in _NAME_DISTRACTORS if n != truth["name"]]
    names = [truth["name"]] + _shuffle_take(name_pool, 3)
    random.shuffle(names)
    opts["name"] = names

    # register month: real month + 3 nearby/random months
    offs = [d for d in range(-6, 7) if d != 0]
    months = {truth["register_month"]}
    for d in _shuffle_take(offs, 3):
        months.add(_month_offset(float(user.get("created_at") or time.time()), d))
    months = list(months)
    random.shuffle(months)
    opts["register_month"] = months

    # buckets: every bucket is a possible choice
    opts["last_login_days"] = [b[0] for b in _DAY_BUCKETS]
    opts["conversation_count"] = [b[0] for b in _CNT_BUCKETS]

    # model: preferred model + other enabled models
    enabled = [m.get("name") for m in cfg.CONFIG.get("models", [])
               if m.get("enabled") and m.get("name")]
    real_model = truth["model"]
    others = [m for m in enabled if m != real_model]
    picks = [real_model] if real_model else []
    for m in _shuffle_take(others, 3):
        picks.append(m)
    if real_model and len(picks) < 4:
        for m in ["qwen3.5:0.8b", "qwen3.5:2b", "qwen3:4b", "qwen3:8b"]:
            if m not in picks:
                picks.append(m)
            if len(picks) >= 4:
                break
    random.shuffle(picks)
    opts["model"] = picks

    # files: one of the user's own files + generic distractors; if the account
    # has never uploaded anything, the correct choice says so explicitly
    own = truth["file_name"]
    if isinstance(own, list):
        correct = random.choice(own)
        pool = [f for f in _FILE_DISTRACTORS if f not in own]
        files = [correct] + _shuffle_take(pool, 3)
    else:
        files = [own] + _shuffle_take(_FILE_DISTRACTORS, 3)
    random.shuffle(files)
    opts["file_name"] = files
    return opts


def _pick_quiz_model() -> str:
    """Prefer the small local 0.8B model for quiz generation."""
    for m in cfg.CONFIG.get("models", []):
        name = m.get("name") or ""
        if m.get("enabled") and "0.8b" in name.lower():
            return name
    return cfg.CONFIG.get("model") or "qwen3.5:0.8b"


def _parse_json_array(text: str) -> list | None:
    """Best-effort extraction of the first JSON array from a model reply."""
    if not text:
        return None
    s = text.strip()
    if s.startswith("```"):
        s = re.sub(r"^```[a-zA-Z]*\s*", "", s)
        s = re.sub(r"```\s*$", "", s).strip()
    try:
        data = json.loads(s)
        return data if isinstance(data, list) else None
    except Exception:
        pass
    m = re.search(r"\[.*\]", s, re.S)
    if not m:
        return None
    try:
        data = json.loads(m.group(0))
        return data if isinstance(data, list) else None
    except Exception:
        return None


def _norm_answer(s: str) -> str:
    """Normalise free text for tolerant comparison (spaces / punctuation / case)."""
    s = str(s or "").strip().lower()
    s = re.sub(r"[\s　·.,，。、:：;；!！?？()（）\[\]【】'\"`~@#$%^&*_+\-=/\\|<>]+",
               "", s)
    return s


def _text_correct(val: str, correct: list) -> bool:
    v = _norm_answer(val)
    if not v:
        return False
    for c in correct:
        cv = _norm_answer(c)
        if not cv:
            continue
        if v == cv or (len(v) >= 2 and (cv in v or v in cv)):
            return True
    return False


def _mcq(key: str, label: str, options: list, correct: list) -> dict:
    return {"key": key, "label": label, "type": "choice", "weight": 0.0,
            "options": [str(o) for o in options],
            "correct": [str(c) for c in correct]}


def _text_q(key: str, label: str, correct: list) -> dict:
    return {"key": key, "label": label, "type": "text", "weight": 0.0,
            "options": [], "correct": [str(c) for c in correct]}


def _enabled_model_names() -> list:
    return [m.get("name") for m in cfg.CONFIG.get("models", [])
            if m.get("enabled") and m.get("name")]


# --------------------------------------------------------------------------- #
# Fixed (system-authored) multiple-choice questions about deterministic params.
# Returns ONE distinct pool; callers shuffle + slice so keys never duplicate.
# --------------------------------------------------------------------------- #
def _system_quiz(user: dict, truth: dict) -> list[dict]:
    options = _unfreeze_options(user)
    qs: list[dict] = []

    enabled = _enabled_model_names()
    real_model = truth["model"]

    # most-used / default model
    others = [m for m in enabled if m != real_model]
    model_opts = ([real_model] if real_model else []) + _shuffle_take(others, 4)
    if len(model_opts) < 4:
        for m in ["qwen3.5:0.8b", "qwen3.5:2b", "qwen3:4b", "qwen3:8b"]:
            if m not in model_opts:
                model_opts.append(m)
    if real_model and len(set(model_opts)) >= 2:
        random.shuffle(model_opts)
        qs.append(_mcq("s_model_1", "在你使用过的模型中，哪一个是你最常用 / 默认的模型？",
                       model_opts, [real_model]))

    # the smallest local model on this service
    if enabled:
        small = next((m for m in enabled if "0.8b" in m.lower()), None)
        if small:
            opts = [small] + _shuffle_take([m for m in enabled if m != small], 3)
            random.shuffle(opts)
            qs.append(_mcq("s_small_model", "本机最小、最轻量的本地模型是下面哪一个？",
                           opts, [small]))

    # whether the account uses an external API model as default
    qs.append(_mcq("s_model_kind", "关于你默认使用的模型，下面哪个描述正确？",
                   ["它是本机运行的本地模型", "它是云端 API 模型",
                    "它是第三方付费模型", "没有默认模型"],
                   ["它是云端 API 模型" if llm.api_credentials(real_model)
                    else "它是本机运行的本地模型"]))

    # cloud-space allowance
    qs.append(_mcq("s_quota", "你的账号当前配置的云空间容量是多少？",
                   [b[0] for b in _QUOTA_BUCKETS], [truth["quota"]]))

    # number of files
    qs.append(_mcq("s_file_cnt", "你的「我的文件」里大约有多少个文件？",
                   [b[0] for b in _FILE_CNT_BUCKETS], [truth["file_count"]]))

    # files that belong to this account
    own = truth["file_name"]
    if isinstance(own, list) and own:
        for gi in range(2):
            correct = random.choice(own)
            pool = [f for f in _FILE_DISTRACTORS if f not in own]
            opts = [correct] + _shuffle_take(pool, 3)
            if len(set(opts)) >= 2:
                random.shuffle(opts)
                qs.append(_mcq(f"s_file_{gi}", "下面哪个文件名确实出现在你的「我的文件」中？",
                               opts, [correct]))
    else:
        opts = [_NO_FILE_OPTION] + _shuffle_take(_FILE_DISTRACTORS, 3)
        random.shuffle(opts)
        qs.append(_mcq("s_file_0", "关于你的「我的文件」，下面哪个说法是正确的？",
                       opts, [_NO_FILE_OPTION]))

    # conversation count bucket
    qs.append(_mcq("s_conv_cnt", "你的账号里历史对话的数量级是多少？",
                   [b[0] for b in _CNT_BUCKETS], [truth["conversation_count"]]))

    # a real conversation title
    titles = truth["conv_titles"]
    if titles:
        real_title = random.choice(titles)
        fake = ["你好", "测试一下", "帮我写代码", "翻译一段话", "总结文档",
                "制作表格", "闲聊", "学习计划"]
        opts = [real_title] + _shuffle_take([f for f in fake if f != real_title], 3)
        if len(set(opts)) >= 2:
            random.shuffle(opts)
            qs.append(_mcq("s_conv_title", "下面哪个是你曾经创建过的对话标题？",
                           opts, [real_title]))

    # last login bucket
    qs.append(_mcq("s_last_login", "你最近一次登录大概在什么时候？",
                   [b[0] for b in _DAY_BUCKETS], [truth["last_login_days"]]))

    # register month
    qs.append(_mcq("s_reg_month", "你的账号是在哪个月份注册的？",
                   options["register_month"], [truth["register_month"]]))

    # weekday of registration
    wk = "星期" + "一二三四五六日"[time.localtime(truth["created"]).tm_wday]
    wk_opts = ["星期一", "星期二", "星期三", "星期四", "星期五", "星期六", "星期日"]
    random.shuffle(wk_opts)
    qs.append(_mcq("s_reg_weekday", "你的账号注册那天是星期几？", wk_opts, [wk]))

    # register year
    yr = time.strftime("%Y", time.localtime(truth["created"]))
    cur = int(yr)
    yr_opts = [str(y) for y in (cur, cur - 1, cur + 1, cur - 2)]
    random.shuffle(yr_opts)
    qs.append(_mcq("s_reg_year", "你的账号是在哪一年注册的？", yr_opts, [yr]))

    # email provider domain (always available)
    domain = truth["email_domain"]
    if domain:
        dom_pool = ["hotmail.com", "outlook.com", "qq.com", "163.com",
                    "gmail.com", "126.com", "foxmail.com"]
        opts = [domain] + [d for d in dom_pool if d != domain][:3]
        random.shuffle(opts)
        qs.append(_mcq("s_email_domain", "你的登录邮箱是在哪个邮箱服务商（@ 后面的域名）注册的？",
                       opts, [domain]))

    return qs


# --------------------------------------------------------------------------- #
# AI-authored open identity questions. The model only rewrites question text
# using the provided facts; the reference answers come from server data and
# are graded server-side (free text, tolerant match).
# --------------------------------------------------------------------------- #
def _identity_facts(truth: dict) -> list[dict]:
    local, domain = truth["email_local"], truth["email_domain"]
    facts = [
        {"answer": truth["name"],
         "fact": f"账号昵称为「{truth['name']}」"},
        {"answer": local,
         "fact": f"登录邮箱 @ 符号前面的用户名是「{local}」"},
        {"answer": truth["register_date"],
         "fact": f"账号注册日期是 {truth['register_date']}（注册月份 {truth['register_month']}）"},
        {"answer": truth["register_month"],
         "fact": f"账号注册月份是 {truth['register_month']}"},
        {"answer": truth["last_login_days"],
         "fact": f"最近一次登录距今的时间档是「{truth['last_login_days']}」"},
        {"answer": truth["conversation_count"],
         "fact": f"历史对话数量档是「{truth['conversation_count']}」"},
        {"answer": truth["file_count"],
         "fact": f"工作区文件数量档是「{truth['file_count']}」"},
        {"answer": truth["model"],
         "fact": f"最常用模型是「{truth['model']}」"},
    ]
    if domain:
        facts.append({"answer": domain, "fact": f"登录邮箱的域名（@ 后面）是「{domain}」"})
    titles = truth["conv_titles"]
    if titles:
        facts.append({"answer": titles[0],
                      "fact": f"最近的一个对话标题是「{titles[0]}」"})
    return facts


def _parse_json_obj(text: str) -> dict | None:
    s = (text or "").strip()
    if s.startswith("```"):
        s = re.sub(r"^```[a-zA-Z]*\s*", "", s)
        s = re.sub(r"```\s*$", "", s).strip()
    try:
        d = json.loads(s)
        return d if isinstance(d, dict) else None
    except Exception:
        m = re.search(r"\{.*\}", s, re.S)
        if m:
            try:
                d = json.loads(m.group(0))
                return d if isinstance(d, dict) else None
            except Exception:
                return None
    return None


async def _ai_identity_quiz(truth: dict, n: int) -> list[dict]:
    facts = _identity_facts(truth)
    chosen = facts[:n]
    qs: list[dict] = []
    for i, fc in enumerate(chosen):
        prompt = (
            "你是账号安全出题器。请把下面一条真实资料，改写成一句自然、口语化、"
            "需要用户用文字作答的中文验证题（不要给选项，不要在题目里泄露答案，"
            "答案必须能直接用资料里的值填写）。\n"
            f"资料：{fc['fact']}\n"
            '只输出 JSON 对象：{"label":"问题文本"}，禁止其它内容。 /no_think'
        )
        label = ""
        for _ in range(2):
            try:
                text = await llm.raw_chat(_pick_quiz_model(), prompt,
                                          max_tokens=200, temperature=0.7)
                obj = _parse_json_obj(text)
                if obj and str(obj.get("label") or "").strip():
                    label = str(obj["label"]).strip()
                    break
            except Exception:  # noqa: BLE001
                break
        if not label:
            # deterministic wording if the small model fails on this item
            label = f"请根据你的真实情况填写：{fc['fact'].split('是')[0]}是什么？"
        qs.append(_text_q(f"a_id_{i}", label, [fc["answer"]]))
    return qs


async def _build_quiz(user: dict) -> dict:
    """Build the 20-question quiz: AI identity + fixed system questions."""
    truth = _unfreeze_truth(user)
    pool = _system_quiz(user, truth)
    random.shuffle(pool)
    need_sys = _UNFREEZE_TOTAL_QUESTIONS - _UNFREEZE_AI_QUESTIONS
    sys_qs = pool[:need_sys]
    spare = pool[need_sys:]
    ai_qs: list[dict] = []
    try:
        ai_qs = await _ai_identity_quiz(truth, _UNFREEZE_AI_QUESTIONS)
    except Exception as exc:  # noqa: BLE001
        print(f"[security] ai identity questions failed: {exc}")
    # keep exactly the AI count; pad failures with spare system questions
    if len(ai_qs) < _UNFREEZE_AI_QUESTIONS:
        ai_qs += spare[:_UNFREEZE_AI_QUESTIONS - len(ai_qs)]
    ai_qs = ai_qs[:_UNFREEZE_AI_QUESTIONS]
    qs = ai_qs + sys_qs
    qs = qs[:_UNFREEZE_TOTAL_QUESTIONS]
    weight = round(100.0 / max(len(qs), 1), 3)
    for q in qs:
        q["weight"] = weight
    random.shuffle(qs)
    n_ai = sum(1 for q in qs if q["key"].startswith("a_id_"))
    source = "ai+system" if n_ai else "system"
    return {"source": source, "questions": qs}


def _fallback_quiz(user: dict) -> dict:
    """All-system deterministic quiz (used if the combined build fails)."""
    truth = _unfreeze_truth(user)
    qs = _system_quiz(user, truth)
    if len(qs) < _UNFREEZE_TOTAL_QUESTIONS:
        options = _unfreeze_options(user)
        for q in UNFREEZE_QUESTIONS:
            if any(x["key"].startswith("s_") and x.get("correct") ==
                   ([str(truth[q["key"]])] if not isinstance(truth[q["key"]], list)
                    else [str(c) for c in truth[q["key"]]]) for x in qs):
                continue
            real = truth[q["key"]]
            correct = real if isinstance(real, list) else [str(real)]
            qs.append(_mcq(f"fb_{q['key']}", q["label"], options[q["key"]], correct))
    random.shuffle(qs)
    qs = qs[:_UNFREEZE_TOTAL_QUESTIONS]
    weight = round(100.0 / max(len(qs), 1), 3)
    for q in qs:
        q["weight"] = weight
    return {"source": "fallback", "questions": qs}


async def _quiz_for_state(user: dict, st: dict) -> dict:
    """Return the frozen quiz for this freeze episode, generating it once."""
    fid = st.get("freeze_id", "")
    cached = st.get("unfreeze_quiz")
    if cached and cached.get("freeze_id") == fid and cached.get("quiz", {}).get("questions"):
        return cached["quiz"]
    quiz = None
    try:
        quiz = await _build_quiz(user)
    except Exception as exc:  # noqa: BLE001
        print(f"[security] quiz generation failed: {exc}")
    if not quiz or not quiz.get("questions"):
        quiz = _fallback_quiz(user)
    st["unfreeze_quiz"] = {"freeze_id": fid, "quiz": quiz}
    store.set_auth_state(user.get("email", ""), st)
    return quiz


def _score_quiz(quiz: dict, answers: dict) -> tuple[float, list, list]:
    """Grade submitted answers against the server-sealed correct values.

    Choice questions match the selected option; text questions use tolerant
    free-text comparison against the server reference answer.
    """
    qs = quiz.get("questions") or []
    total = sum(float(q.get("weight") or 0) for q in qs) or 1.0
    matched, missed = [], []
    gained = 0.0
    for q in qs:
        val = (answers.get(q["key"]) or "").strip()
        correct = q.get("correct") or []
        if q.get("type") == "text":
            ok = _text_correct(val, correct)
        else:
            ok = bool(val) and val.lower() in [str(c).lower() for c in correct]
        (matched if ok else missed).append(q.get("label", ""))
        if ok:
            gained += float(q.get("weight") or 0)
    return round(gained / total * 100, 1), matched, missed


class UnfreezeCheckIn(BaseModel):
    email: str


def _unfreeze_request_for_state(st: dict) -> dict | None:
    rid = st.get("unfreeze_id")
    return store.get_unfreeze(rid) if rid else None


@app.get("/api/auth/unfreeze/questions")
async def unfreeze_questions(email: str = ""):
    email = (email or "").strip().lower()
    user = store.get_user_by_email(email) if email else None
    if not user:
        raise HTTPException(404, "该邮箱尚未注册")
    st = store.get_auth_state(email)
    if not st.get("hard_locked"):
        raise HTTPException(400, "该账号当前未被冻结")
    # Only ONE questionnaire submission per freeze: once submitted, choices are
    # never shown again and cannot be re-fetched for a second guessing round.
    existing = _unfreeze_request_for_state(st)
    if existing:
        return {"ok": True, "questions": [], "submitted": True,
                "request": existing, "pass_score": UNFREEZE_PASS_SCORE}
    # The 0.8B model authors the quiz from this account's real traces; generated
    # once per freeze episode and cached, so refreshing cannot reroll questions.
    quiz = await _quiz_for_state(user, st)
    qs = [{"key": q["key"], "label": q["label"], "weight": q["weight"],
           "type": q.get("type", "choice"), "options": q["options"]}
          for q in quiz["questions"]]
    random.shuffle(qs)
    return {"ok": True, "questions": qs, "submitted": False,
            "pass_score": UNFREEZE_PASS_SCORE, "source": quiz.get("source", "")}


@app.post("/api/auth/unfreeze/check")
async def unfreeze_check(body: UnfreezeCheckIn):
    email = body.email.strip().lower()
    st = store.get_auth_state(email)
    return {
        "ok": True,
        "hard_locked": bool(st.get("hard_locked")),
        "submitted": bool(st.get("unfreeze_id")),
        "request": _unfreeze_request_for_state(st),
    }


class UnfreezeIn(BaseModel):
    email: str
    reason: str
    answers: dict = {}


@app.post("/api/auth/unfreeze/request")
async def unfreeze_request(body: UnfreezeIn):
    email = body.email.strip().lower()
    user = store.get_user_by_email(email)
    if not user:
        raise HTTPException(404, "该邮箱尚未注册")
    st = store.get_auth_state(email)
    if not st.get("hard_locked"):
        raise HTTPException(400, "该账号当前未被冻结，无需申请解冻")
    # Hard rule: exactly one submission per freeze episode. A denied (<50)
    # questionnaire can never be retried this freeze — only the PIN route can
    # still unlock the account.
    if st.get("unfreeze_id"):
        raise HTTPException(400, {
            "code": "already_submitted",
            "message": "本次冻结仅可提交一次解冻申请；系统评分不足时，"
                       "只能等待管理员发送高级解冻 PIN 邮件",
        })
    if len((body.reason or "").strip()) < 5:
        raise HTTPException(400, "请填写解冻原因（至少 5 个字）")
    answers = body.answers or {}
    quiz = await _quiz_for_state(user, st)
    if any(not (answers.get(q["key"]) or "").strip() for q in quiz["questions"]):
        raise HTTPException(400, "请完成全部选择题后再提交")
    score, matched, missed = _score_quiz(quiz, answers)
    denied = score < UNFREEZE_PASS_SCORE
    item = store.create_unfreeze(email, user["uid"], body.reason, answers,
                                 score, matched, missed,
                                 freeze_id=st.get("freeze_id", ""),
                                 auto_denied=denied)
    # lock the one-shot on THIS freeze episode
    st["unfreeze_id"] = item["id"]
    store.set_auth_state(email, st)
    print(f"[security] unfreeze request {item['id']} for {email} score={score} "
          f"auto={'denied' if denied else 'admin-review'}")
    if denied:
        # Below 50 the system denies it: auto-email a fresh PIN to the mailbox
        # manager so only the PIN route can unlock this account.
        asyncio.create_task(_send_manager_pin(item["id"], "自助解冻未达标（系统评分低于 50）"))
    return {"ok": True, "request": item, "auto_denied": denied}


@app.post("/api/auth/unfreeze/status")
async def unfreeze_status(body: UnfreezeCheckIn):
    email = body.email.strip().lower()
    st = store.get_auth_state(email)
    return {"ok": True,
            "hard_locked": bool(st.get("hard_locked")),
            "submitted": bool(st.get("unfreeze_id")),
            "request": _unfreeze_request_for_state(st)}


class SetPasswordIn(BaseModel):
    password: str
    old_password: str = ""


@app.post("/api/auth/password")
async def set_own_password(body: SetPasswordIn, user: dict = Depends(current_user)):
    """Let a signed-in user set/change their own password.

    Accounts that already have a password must verify it before replacing it.
    Code-only accounts (password never set) may create one directly.
    """
    if user.get("password_hash"):
        if not body.old_password:
            raise HTTPException(400, "请先输入旧密码")
        if not auth.check_password(body.old_password, user["password_hash"]):
            raise HTTPException(400, "旧密码不正确")
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
    if _frozen_state(email):
        raise HTTPException(423, "账号已被安全冻结，无法通过重置密码解锁，请先申请解冻")
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
    if _frozen_state(email):
        raise HTTPException(423, "账号已被安全冻结，请先完成账号解冻申请")
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


# --------------------------------------------------------------------------- #
# cloud-space ADJUSTMENT requests — grow OR shrink (user side)
# --------------------------------------------------------------------------- #
MAX_QUOTA_REQUEST_MB = 51200          # cap an application at 50 GB
MIN_QUOTA_REQUEST_MB = 1


class QuotaRequestIn(BaseModel):
    size_mb: int
    reason: str


@app.get("/api/quota/request")
async def my_quota_request(user: dict = Depends(current_user)):
    return {"ok": True, "request": store.latest_quota_request(user["uid"]),
            "base_quota": cfg.CONFIG["quota_bytes"]}


@app.post("/api/quota/request")
async def apply_quota(body: QuotaRequestIn, user: dict = Depends(current_user)):
    size_mb = int(body.size_mb or 0)
    reason = (body.reason or "").strip()
    if size_mb < MIN_QUOTA_REQUEST_MB:
        raise HTTPException(400, "请填写申请的空间大小（至少 1MB）")
    if size_mb > MAX_QUOTA_REQUEST_MB:
        raise HTTPException(400, f"单次申请不能超过 {MAX_QUOTA_REQUEST_MB // 1024}GB")
    if len(reason) < 5:
        raise HTTPException(400, "请填写至少 5 个字的申请理由")
    current = int((store.get_user(user["uid"]) or {}).get("quota_bytes")
                  or cfg.CONFIG["quota_bytes"])
    if size_mb * 1024 * 1024 == current:
        raise HTTPException(400, "申请大小与当前云空间相同，无需调整")
    item = store.create_quota_request(user["uid"], size_mb * 1024 * 1024, reason)
    return {"ok": True, "request": item}


class FeedbackIn(BaseModel):
    category: str = "其他"
    content: str
    # email -> delivered to the author mailbox only (no admin inbox, no reply)
    # admin -> stored for the admin console only (no email)
    target: str = "admin"


# User feedback choosing the mailbox route is forwarded here over SMTP.
FEEDBACK_RECIPIENT = "YJS-CLA@hotmail.com"
FEEDBACK_MIN_INTERVAL = 180          # seconds between submissions, server-timed


async def _forward_feedback_mail(item: dict) -> None:
    """Best-effort SMTP forward of a feedback item to the author mailbox."""
    subject = f"[YJS 用户反馈] {item.get('category') or '其他'} · {item.get('email')}"
    rows = [
        ("提交人", _esc(f"{item.get('name') or '（未命名）'} <{item.get('email')}>")),
        ("分类", item.get("category") or "其他"),
        ("时间", time.strftime("%Y-%m-%d %H:%M:%S",
                               time.localtime(item.get("created_at") or time.time()))),
    ]
    table = "".join(
        f"<tr><td style='padding:4px 14px 4px 0;color:#666'>{_esc(k)}</td>"
        f"<td style='padding:4px 0'>{v}</td></tr>" for k, v in rows)
    html = auth._wrap("新的用户使用意见",
                      "<table style='font-size:14px'>" + table + "</table>"
                      "<div style='margin-top:14px;padding:12px 14px;"
                      "background:#f6f8fb;border-radius:8px;line-height:1.7;white-space:pre-wrap'>"
                      + _esc(item.get("content") or "") + "</div>")
    try:
        await asyncio.to_thread(auth.send_mail, FEEDBACK_RECIPIENT, subject, html)
        store.update_feedback_email(item["id"], "sent")
    except Exception as exc:  # noqa: BLE001
        print(f"[feedback] forward failed: {exc}")
        store.update_feedback_email(item["id"], "failed", str(exc))


@app.post("/api/feedback")
async def submit_feedback(body: FeedbackIn, user: dict = Depends(current_user)):
    """使用意见 — choose mailbox (one-way) or the admin inbox."""
    content = (body.content or "").strip()
    if len(content) < 2:
        raise HTTPException(400, "请填写反馈内容")
    target = body.target if body.target in ("email", "admin") else "admin"
    last = store.last_feedback_time(user["uid"])
    wait = int(FEEDBACK_MIN_INTERVAL - (time.time() - last))
    if wait > 0:
        raise HTTPException(429, f"两次反馈需间隔 3 分钟，请 {wait} 秒后再试")
    item = store.add_feedback(user["uid"], user.get("email", ""),
                              body.category, content, target)
    if target == "email":
        # Mailbox route: delivered to the author mailbox only, never tracked
        # in the admin inbox. Best-effort in the background.
        asyncio.create_task(_forward_feedback_mail(item))
    return {"ok": True, "id": item["id"], "target": target}


@app.get("/api/feedback/mine")
async def my_feedback(user: dict = Depends(current_user)):
    return {"ok": True, "items": store.list_feedback_for_user(user["uid"])}


@app.post("/api/feedback/{fid}/revoke")
async def revoke_my_feedback(fid: str, user: dict = Depends(current_user)):
    if not store.revoke_feedback(fid, user["uid"]):
        raise HTTPException(400, "该反馈无法撤销（发送到邮箱的反馈不支持撤销）")
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
        raise HTTPException(403, "存储空间已满，请清理文件后再开启新对话")
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
# Conversations that currently have an agent run in progress
# (uid, cid) -> monotonic start time. Survives client disconnects; a second
# message is rejected until the first run finishes, preventing interleaving.
_RUNNING_CONV: dict[tuple[str, str], float] = {}


@app.get("/api/conversations/{cid}/status")
async def conversation_status(cid: str, user: dict = Depends(current_user)):
    conv = store.get_conversation(user["uid"], cid)
    if not conv:
        raise HTTPException(404, "对话不存在")
    started = _RUNNING_CONV.get((user["uid"], cid))
    return {
        "ok": True,
        "running": started is not None,
        "elapsed": int(time.monotonic() - started) if started else 0,
        "messages": len(conv.get("messages", [])),
    }


@app.post("/api/conversations/{cid}/chat")
async def chat(cid: str, body: ChatIn, user: dict = Depends(current_user)):
    uid = user["uid"]
    if not store.get_conversation(uid, cid):
        raise HTTPException(404, "对话不存在")
    run_key = (uid, cid)
    if run_key in _RUNNING_CONV:
        raise HTTPException(409, "上一个任务还在执行中，请等它完成后再发送（断线也没关系，完成后会自动保存）")
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
        _RUNNING_CONV[run_key] = time.monotonic()
        task = asyncio.create_task(agent.run_agent(uid, cid, emit, model=resolved_model,
                                                   mode=resolved_mode, agent_id=body.agent))
        _RUNNING.add(task)
        task.add_done_callback(_RUNNING.discard)
        # The lock is tied to the AGENT task, not this SSE stream: closing the
        # browser does not cancel the run, and the lock clears only when the
        # agent itself finishes (its result is already saved to disk).
        task.add_done_callback(lambda _t: _RUNNING_CONV.pop(run_key, None))
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
# batch file operations (multi-select in 我的文件)
# --------------------------------------------------------------------------- #
MAX_BATCH_FILES = 20
MAX_MAIL_ATTACHMENT_BYTES = 25 * 1024 * 1024


def _safe_workspace_file(uid: str, rel: str):
    """Resolve a user-supplied relative path inside their workspace."""
    rel = (rel or "").strip().replace("\\", "/")
    parts = [p for p in rel.split("/") if p not in ("", ".")]
    if not parts or any(p == ".." for p in parts):
        raise HTTPException(400, "非法路径")
    root = store.workspace(uid).resolve()
    target = (root / "/".join(parts)).resolve()
    if root not in target.parents and target != root:
        raise HTTPException(403, "非法路径")
    if not target.is_file():
        raise HTTPException(404, "文件不存在：" + rel)
    return target


class BatchFilesIn(BaseModel):
    paths: list[str]


@app.post("/api/files/batch-delete")
async def batch_delete_files(body: BatchFilesIn, user: dict = Depends(current_user)):
    paths = (body.paths or [])[:MAX_BATCH_FILES]
    deleted, failed = [], []
    for rel in paths:
        try:
            target = _safe_workspace_file(user["uid"], rel)
            rel_posix = target.relative_to(store.workspace(user["uid"]).resolve()).as_posix()
            if store.delete_file(user["uid"], rel_posix):
                deleted.append(rel_posix)
            else:
                failed.append(rel)
        except HTTPException as exc:
            failed.append(f"{rel}（{exc.detail}）")
    return {"ok": True, "deleted": deleted, "failed": failed,
            "usage": store.usage(user["uid"])}


@app.get("/api/files/batch-download")
async def batch_download_files(paths: list[str] = Query(default=[]),
                               user: dict = Depends(current_user)):
    paths = paths[:MAX_BATCH_FILES]
    if not paths:
        raise HTTPException(400, "请先勾选文件")
    targets = [_safe_workspace_file(user["uid"], p) for p in paths]
    if len(targets) == 1:
        return FileResponse(targets[0], filename=targets[0].name)
    stamp = time.strftime("%Y%m%d-%H%M%S")
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        used_names: set[str] = set()
        for t in targets:
            name = t.name
            base, dot, ext = name.rpartition(".")
            n = name
            i = 1
            while n in used_names:
                n = f"{base}({i}){dot}{ext}" if dot else f"{name}({i})"
                i += 1
            used_names.add(n)
            zf.write(t, n)
    buf.seek(0)
    return StreamingResponse(
        buf, media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="yjs-files-{stamp}.zip"'})


class EmailFilesIn(BaseModel):
    paths: list[str]
    as_zip: bool = False


@app.post("/api/files/email")
async def email_files(body: EmailFilesIn, user: dict = Depends(current_user)):
    """Email selected files to the user's own mailbox as attachments."""
    paths = (body.paths or [])[:MAX_BATCH_FILES]
    if not paths:
        raise HTTPException(400, "请先勾选文件")
    to = (user.get("email") or "").strip()
    if not to:
        raise HTTPException(400, "当前账号没有邮箱地址")
    targets = [_safe_workspace_file(user["uid"], p) for p in paths]
    total = sum(t.stat().st_size for t in targets)
    if total > MAX_MAIL_ATTACHMENT_BYTES:
        raise HTTPException(413, f"附件总大小 {total // 1024 // 1024}MB 超过 "
                                f"{MAX_MAIL_ATTACHMENT_BYTES // 1024 // 1024}MB 限制")

    attachments: list[tuple[str, bytes]] = []
    if body.as_zip or len(targets) > 1:
        stamp = time.strftime("%Y%m%d-%HM%S")
        zbuf = io.BytesIO()
        with zipfile.ZipFile(zbuf, "w", zipfile.ZIP_DEFLATED) as zf:
            used: set[str] = set()
            for t in targets:
                n = t.name
                i = 1
                while n in used:
                    stem, dot, ext = t.name.rpartition(".")
                    n = f"{stem}({i}){dot}{ext}" if dot else f"{t.name}({i})"
                    i += 1
                used.add(n)
                zf.write(t, n)
        attachments.append((f"yjs-files-{stamp}.zip", zbuf.getvalue()))
        mode = "ZIP 压缩包"
    else:
        t = targets[0]
        attachments.append((t.name, t.read_bytes()))
        mode = "原文件"

    file_list = "".join(f"<li>{_esc(t.name)} · {t.stat().st_size // 1024} KB</li>"
                        for t in targets)
    html = auth._wrap(
        "你的 YJS 云空间文件",
        f"<p>你在 YJS Cloud LLM Agent 中选择的 {len(targets)} 个文件"
        f"（{mode}）已作为附件发送到本邮箱。</p><ul>{file_list}</ul>")
    try:
        await asyncio.to_thread(auth.send_mail, to, "YJS 云空间文件", html,
                                attachments=attachments)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(400, f"发送失败：{exc}") from exc
    return {"ok": True, "to": to, "count": len(targets), "mode": mode}


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
        "tunnel_pushed": tunnel.TUNNEL.pushed,
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


class AdminUserMailIn(BaseModel):
    subject: str
    body: str


@app.post("/api/admin/users/{uid}/email")
async def admin_mail_user(uid: str, body: AdminUserMailIn,
                          admin: dict = Depends(require_admin_gate)):
    """Send a letter from the administrator to one user's mailbox."""
    target = store.get_user(uid)
    if not target:
        raise HTTPException(404, "用户不存在")
    to = (target.get("email") or "").strip()
    if not to:
        raise HTTPException(400, "该用户没有邮箱地址")
    subject = (body.subject or "").strip()[:120]
    content = (body.body or "").strip()
    if not subject:
        raise HTTPException(400, "请填写邮件主题")
    if not content:
        raise HTTPException(400, "请填写邮件内容")
    html = auth._wrap(_esc(subject),
                      "<div style='line-height:1.8;white-space:pre-wrap'>"
                      + _esc(content) + "</div>")
    try:
        await asyncio.to_thread(auth.send_mail, to, f"[YJS 管理员来信] {subject}", html)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(400, f"发送失败：{exc}") from exc
    return {"ok": True, "to": to}


# --------------------------------------------------------------------------- #
# cloud-space expansion requests (admin review)
# --------------------------------------------------------------------------- #
@app.get("/api/admin/quota-requests")
async def admin_quota_requests(user: dict = Depends(require_admin_gate)):
    return {"ok": True, "requests": store.list_quota_requests(),
            "pending": store.quota_requests_unread()}


class QuotaDecisionIn(BaseModel):
    approve: bool
    note: str = ""
    # Temporary-adjustment lifetime in seconds. 0 / None = permanent.
    # Bounds (validated below): 30 seconds .. ~3 months (93 days).
    duration_seconds: int | None = None


MIN_QUOTA_TEMP_SECONDS = 30
MAX_QUOTA_TEMP_SECONDS = 93 * 24 * 3600


@app.post("/api/admin/quota-requests/{rid}/decide")
async def admin_decide_quota(rid: str, body: QuotaDecisionIn,
                             admin: dict = Depends(require_admin_gate)):
    duration = body.duration_seconds
    if body.approve and duration:
        if duration < MIN_QUOTA_TEMP_SECONDS:
            raise HTTPException(400, f"临时调整期限最短 {MIN_QUOTA_TEMP_SECONDS} 秒")
        if duration > MAX_QUOTA_TEMP_SECONDS:
            raise HTTPException(400, "临时调整期限最长三个月（93 天）")
    item = store.decide_quota_request(rid, body.approve, body.note,
                                      duration if duration else None)
    if not item:
        raise HTTPException(404, "申请不存在或已处理")
    # Best-effort email notification to the applicant.
    target = store.get_user(item["uid"])
    if target and target.get("email"):
        mb = item["request_bytes"] // 1024 // 1024
        if body.approve:
            if item.get("expire_at"):
                deadline = time.strftime(
                    "%Y-%m-%d %H:%M:%S",
                    time.localtime(item["expire_at"]))
                txt = (f"你的云空间调整申请已通过，当前云空间已调整为 {mb} MB。\n"
                       f"该调整为临时调整，将于 {deadline} 自动恢复为 "
                       f"{item.get('revert_bytes', 0) // 1024 // 1024} MB。")
            else:
                txt = (f"你的云空间调整申请已通过，当前云空间已永久调整为 {mb} MB。")
        else:
            txt = "你的云空间调整申请未通过。"
        if body.note.strip():
            txt += "\n管理员备注：" + body.note.strip()
        html = auth._wrap("云空间调整申请结果",
                          "<div style='line-height:1.8;white-space:pre-wrap'>"
                          + _esc(txt) + "</div>")
        try:
            await asyncio.to_thread(auth.send_mail, target["email"],
                                    "[YJS] 云空间调整申请结果", html)
        except Exception as exc:  # noqa: BLE001
            print(f"[quota] notify failed: {exc}")
    return {"ok": True, "request": item, "usage": store.usage(item["uid"])}


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
        "max_tool_calls_per_step": int(cfg.CONFIG.get("max_tool_calls_per_step") or 500),
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
        cfg.CONFIG["max_tool_calls_per_step"] = max(1, min(int(body.max_tool_calls_per_step), 500))
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


class AdminRoleIn(BaseModel):
    admin: bool


@app.post("/api/admin/users/{uid}/admin")
async def admin_set_role(uid: str, body: AdminRoleIn,
                         user: dict = Depends(require_admin_gate)):
    """Grant or revoke the administrator role (used to hand over ownership)."""
    target = store.get_user(uid)
    if not target:
        raise HTTPException(404, "用户不存在")
    email = str(target.get("email", "")).strip().lower()
    if not email:
        raise HTTPException(400, "该账号没有可用邮箱")
    admin_cfg = cfg.CONFIG.setdefault("admin", {})
    emails = [str(e).strip().lower() for e in (admin_cfg.get("emails") or []) if e]
    if not emails:
        # Materialise the implicit owner first, otherwise granting the very
        # first admin would silently demote the earliest-registered account.
        emails = [str(u.get("email", "")).lower()
                  for u in store.list_users() if store.is_admin(u)]
    if body.admin:
        if email not in emails:
            emails.append(email)
    else:
        remaining = [e for e in emails if e != email]
        if not remaining:
            raise HTTPException(400, "至少需要保留一名管理员，请先指定新的管理员")
        emails = remaining
    admin_cfg["emails"] = emails
    cfg.save(cfg.CONFIG)
    return {"ok": True, "admins": emails}


# --------------------------------------------------------------------------- #
# site notifications: FULL HISTORY stored locally + published to the repo
# --------------------------------------------------------------------------- #
NOTICE_FILE = cfg.ROOT / "notification.json"


def _notices_payload() -> dict:
    items = store.list_notices()
    latest = items[0] if items else {}
    # Keep legacy top-level fields for any old cached client; the new app reads
    # the "notifications" array.
    return {
        "version": 2,
        "notifications": items,
        "title": latest.get("title", ""),
        "body": latest.get("body", ""),
        "updated_at": latest.get("updated_at", ""),
        "author": latest.get("author", ""),
    }


def _write_public_notices() -> None:
    NOTICE_FILE.write_text(
        json.dumps(_notices_payload(), ensure_ascii=False, indent=2),
        encoding="utf-8")


async def _push_notices(commit_msg: str) -> None:
    """Upload the whole (history-retaining) notification.json to the repo."""
    _write_public_notices()
    await github_sync.put_file(
        "notification.json", NOTICE_FILE.read_bytes(), commit_msg)


def _notice_repo_info() -> dict:
    gh = _github_cfg()
    prefix = (gh.get("path_prefix") or "").strip("/")
    return {
        "repo": gh.get("repo", ""),
        "branch": gh.get("branch", "main"),
        "repo_file": f"{prefix}/notification.json" if prefix else "notification.json",
        "has_token": bool(gh.get("token")),
    }


@app.get("/api/notifications")
async def list_site_notifications(user: dict = Depends(current_user)):
    """Global service notices (history) + the user's personal notifications."""
    return {
        "ok": True,
        "notifications": store.list_notices(),
        "personal": store.list_user_notices(user["uid"]),
        "personal_unread": store.unread_user_notices(user["uid"]),
    }


@app.post("/api/notifications/read")
async def mark_notifications_read(user: dict = Depends(current_user)):
    store.mark_user_notices_read(user["uid"])
    return {"ok": True}


@app.get("/api/admin/notifications")
async def admin_list_notifications(user: dict = Depends(require_admin_gate)):
    return {
        "ok": True,
        "notifications": store.list_notices(),
        **_notice_repo_info(),
        "unlocked": _repo_unlocked(user["uid"]),
    }


class NoticeIn(BaseModel):
    title: str = ""
    body: str = ""
    publish: bool = True          # also push the whole history to GitHub


class NoticeEditIn(NoticeIn):
    id: str | None = None


@app.post("/api/admin/notifications")
async def admin_create_notification(body: NoticeIn,
                                    user: dict = Depends(require_admin_gate)):
    """Create a notification; publishing pushes history (old ones are kept)."""
    title = (body.title or "").strip()
    text = (body.body or "").strip()
    if not title and not text:
        raise HTTPException(400, "请填写通知标题或内容")
    item = store.create_notice(title, text, str(user.get("email", "")))

    pushed, err = False, ""
    if body.publish:
        try:
            _require_repo_unlocked(user["uid"])
            await _push_notices(f"chore: publish notification ({title or 'notice'})")
            pushed = True
        except HTTPException as exc:
            err = str(exc.detail)
        except Exception as exc:  # noqa: BLE001
            err = str(exc)[:200]
    else:
        _write_public_notices()
    return {"ok": True, "notification": item, "pushed": pushed, "error": err}


@app.post("/api/admin/notifications/{nid}")
async def admin_update_notification(nid: str, body: NoticeIn,
                                    user: dict = Depends(require_admin_gate)):
    title = (body.title or "").strip()
    text = (body.body or "").strip()
    if not title and not text:
        raise HTTPException(400, "请填写通知标题或内容")
    item = store.update_notice(nid, title, text)
    if not item:
        raise HTTPException(404, "公告不存在")
    pushed, err = False, ""
    if body.publish:
        try:
            _require_repo_unlocked(user["uid"])
            await _push_notices(f"chore: update notification {nid}")
            pushed = True
        except HTTPException as exc:
            err = str(exc.detail)
        except Exception as exc:  # noqa: BLE001
            err = str(exc)[:200]
    else:
        _write_public_notices()
    return {"ok": True, "notification": item, "pushed": pushed, "error": err}


@app.delete("/api/admin/notifications/{nid}")
async def admin_delete_notification(nid: str,
                                    publish: bool = True,
                                    user: dict = Depends(require_admin_gate)):
    if not store.get_notice(nid):
        raise HTTPException(404, "公告不存在")
    store.delete_notice(nid)
    pushed, err = False, ""
    if publish:
        try:
            _require_repo_unlocked(user["uid"])
            await _push_notices(f"chore: delete notification {nid}")
            pushed = True
        except HTTPException as exc:
            err = str(exc.detail)
        except Exception as exc:  # noqa: BLE001
            err = str(exc)[:200]
    else:
        _write_public_notices()
    return {"ok": True, "pushed": pushed, "error": err}


@app.post("/api/admin/notifications-republish")
async def admin_republish_notifications(user: dict = Depends(require_admin_gate)):
    """Force-push the complete local history to the GitHub repo."""
    try:
        _require_repo_unlocked(user["uid"])
        await _push_notices("chore: republish notification history")
        return {"ok": True, "pushed": True}
    except HTTPException as exc:
        raise
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(400, str(exc)[:200])


def migrate_legacy_notice() -> int:
    """Import the pre-history single notice once, if the store is empty."""
    legacy = cfg.CONFIG.get("notification") or {}
    title, body = legacy.get("title", "") or "", legacy.get("body", "") or ""
    if (not title and not body) or store.list_notices():
        return 0
    item = store.create_notice(title, body, str(legacy.get("author", "") or "admin"))
    if legacy.get("updated_at"):
        item["created_at"] = item["updated_at"] = _parse_legacy_time(
            legacy.get("updated_at"))
        from server import store as _store
        _store._write_json(_store._notice_path(item["id"]), item)
    _write_public_notices()
    cfg.CONFIG["announcement"] = ""
    cfg.save(cfg.CONFIG)
    return 1


def _parse_legacy_time(value) -> float:
    if isinstance(value, (int, float)):
        return float(value)
    try:
        return time.mktime(time.strptime(str(value)[:19], "%Y-%m-%dT%H:%M:%S"))
    except Exception:  # noqa: BLE001
        return time.time()


@app.post("/api/admin/metrics/reset")
async def admin_reset_metrics(user: dict = Depends(require_admin_gate)):
    metrics.reset()
    return {"ok": True}


# --------------------------------------------------------------------------- #
# mail service (admin): SMTP sender settings + broadcast to all
# --------------------------------------------------------------------------- #
class SmtpIn(BaseModel):
    host: str | None = None
    port: int | None = None
    protocol: str | None = None       # ssl | starttls
    user: str | None = None           # sender mailbox
    auth_code: str | None = None      # empty = keep the stored code
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
        s["host"] = body.host.strip()
    if body.port:
        s["port"] = int(body.port)
    if body.protocol is not None:
        s["protocol"] = body.protocol.strip() or "ssl"
    if body.user is not None:
        s["user"] = body.user.strip()
    if body.auth_code:
        s["auth_code"] = body.auth_code.strip()
    if body.from_name is not None:
        s["from_name"] = body.from_name.strip() or "YJS Cloud LLM Agent"
    cfg.save(cfg.CONFIG)
    return {"ok": True, "has_auth_code": bool(s.get("auth_code"))}


class TestMailIn(BaseModel):
    to: str = ""


@app.post("/api/admin/email/test")
async def admin_test_email(body: TestMailIn, user: dict = Depends(require_admin_gate)):
    """Log in to the SMTP server and send one message to prove the setup."""
    to = (body.to or "").strip() or user["email"]
    html = auth._wrap("邮件配置测试（SMTP）",
                      "<p>如果你收到这封邮件，说明后台的 SMTP 发件配置正确。</p>")
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
# host power + Ollama remote control
# --------------------------------------------------------------------------- #
import shutil  # noqa: E402
import subprocess  # noqa: E402
import sys  # noqa: E402
_OLLAMA_PROC: subprocess.Popen | None = None


def _ollama_exe() -> str | None:
    exe = cfg.BIN_DIR / "ollama" / ("ollama.exe" if os.name == "nt" else "ollama")
    return str(exe) if exe.exists() else shutil.which("ollama")


async def _ollama_alive() -> bool:
    try:
        async with httpx.AsyncClient(timeout=3) as c:
            r = await c.get(cfg.CONFIG.get("ollama_url", "http://127.0.0.1:11434")
                            + "/api/tags")
            return r.status_code == 200
    except Exception:  # noqa: BLE001
        return False


def _start_ollama_blocking() -> None:
    global _OLLAMA_PROC
    exe = _ollama_exe()
    if not exe:
        raise RuntimeError("未找到 ollama 程序")
    env = os.environ.copy()
    env["OLLAMA_HOST"] = "127.0.0.1:11434"
    env.setdefault("OLLAMA_MODELS", str(cfg.ROOT / "models"))
    flags = subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0
    _OLLAMA_PROC = subprocess.Popen([exe, "serve"], env=env,
                                    stdout=subprocess.DEVNULL,
                                    stderr=subprocess.DEVNULL,
                                    creationflags=flags)


def _stop_ollama_blocking() -> None:
    global _OLLAMA_PROC
    if _OLLAMA_PROC and _OLLAMA_PROC.poll() is None:
        _OLLAMA_PROC.terminate()
        try:
            _OLLAMA_PROC.wait(timeout=8)
        except Exception:  # noqa: BLE001
            _OLLAMA_PROC.kill()
    _OLLAMA_PROC = None
    if os.name == "nt":
        # Also stop a desktop-launched ollama.exe / the tray serve process.
        subprocess.run(["taskkill", "/IM", "ollama.exe", "/F"],
                       capture_output=True, timeout=20)
    else:
        subprocess.run(["pkill", "-f", "ollama serve"],
                       capture_output=True, timeout=20)


@app.get("/api/admin/system")
async def admin_system_status(user: dict = Depends(require_admin_gate)):
    return {"ok": True, "platform": sys.platform,
            "ollama_running": await _ollama_alive(),
            "ollama_path": _ollama_exe() or "",
            "tunnel": tunnel.TUNNEL.url,
            "tunnel_pushed": tunnel.TUNNEL.pushed}


class OllamaCtlIn(BaseModel):
    action: str            # start | stop | restart


@app.post("/api/admin/system/ollama")
async def admin_ollama_ctl(body: OllamaCtlIn, user: dict = Depends(require_admin_gate)):
    action = (body.action or "").strip().lower()
    if action not in ("start", "stop", "restart"):
        raise HTTPException(400, "action 必须是 start / stop / restart")
    if action in ("stop", "restart"):
        await asyncio.to_thread(_stop_ollama_blocking)
        await asyncio.sleep(1)
    if action in ("start", "restart"):
        if await _ollama_alive():
            return {"ok": True, "ollama_running": True, "note": "已在运行"}
        await asyncio.to_thread(_start_ollama_blocking)
        # Wait up to ~20 s for the API to come up.
        for _ in range(20):
            await asyncio.sleep(1)
            if await _ollama_alive():
                return {"ok": True, "ollama_running": True}
        raise HTTPException(400, "Ollama 启动超时，请查看本机日志")
    return {"ok": True, "ollama_running": await _ollama_alive()}


class ShutdownIn(BaseModel):
    delay: int = 3        # seconds before power-off


@app.post("/api/admin/system/shutdown")
async def admin_shutdown(body: ShutdownIn, user: dict = Depends(require_admin_gate)):
    """Power off the host machine (the one-click launcher box)."""
    delay = max(1, min(int(body.delay or 3), 120))

    def _do_poweroff() -> None:
        import time as _t
        _t.sleep(delay)
        try:
            if os.name == "nt":
                os.system(f'shutdown /s /t 0 /c "YJS admin requested shutdown"')
            else:
                os.system("sudo shutdown -h now || shutdown -h now")
        except Exception as exc:  # noqa: BLE001
            print(f"[system] shutdown failed: {exc}")

    threading.Thread(target=_do_poweroff, daemon=True).start()
    return {"ok": True, "delay": delay, "message": f"主机将在 {delay} 秒后关机"}


# --------------------------------------------------------------------------- #
# user feedback (admin review)
# --------------------------------------------------------------------------- #
@app.get("/api/admin/feedback")
async def admin_list_feedback(user: dict = Depends(require_admin_gate)):
    # The admin inbox shows backend-routed feedback only. Email-routed items
    # are one-way deliveries and never appear here.
    items = [i for i in store.list_feedback()
             if i.get("target") != "email" and not i.get("revoked")]
    return {"ok": True, "items": items,
            "unread": sum(1 for i in items if i.get("status") == "new"),
            "templates": store.list_reply_templates()}


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


class ReplyIn(BaseModel):
    content: str
    via_email: bool = True
    via_notice: bool = False


@app.post("/api/admin/feedback/{fid}/reply")
async def admin_reply_feedback(fid: str, body: ReplyIn,
                               admin: dict = Depends(require_admin_gate)):
    """Quick reply: to the user's mailbox, in-app notifications, or both."""
    item = store.get_feedback(fid) if hasattr(store, "get_feedback") else None
    if item is None:
        matches = [f for f in store.list_feedback() if f.get("id") == fid]
        item = matches[0] if matches else None
    if not item or item.get("target") == "email":
        raise HTTPException(404, "反馈不存在")
    content = (body.content or "").strip()
    if len(content) < 1:
        raise HTTPException(400, "回信内容不能为空")
    if not body.via_email and not body.via_notice:
        raise HTTPException(400, "请选择至少一种回信方式")
    author = str(admin.get("email", "管理员"))
    reply = store.add_feedback_reply(fid, content, body.via_email,
                                     body.via_notice, author)

    mail_err = ""
    if body.via_email:
        to = item.get("email")
        if not to:
            mail_err = "用户没有邮箱地址"
        else:
            html = auth._wrap(
                "管理员对你的使用意见的回复",
                "<div style='line-height:1.8;font-size:14px'>"
                "<p>你此前提交的意见：</p>"
                "<div style='padding:10px 12px;background:#f6f8fb;border-radius:8px;"
                "white-space:pre-wrap;color:#555'>" + _esc(item.get("content", "")) + "</div>"
                "<p style='margin-top:14px'>管理员回复：</p>"
                "<div style='padding:10px 12px;background:#eef6ff;border-radius:8px;"
                "white-space:pre-wrap'>" + _esc(content) + "</div></div>")
            try:
                await asyncio.to_thread(
                    auth.send_mail, to, "[YJS] 管理员回复了你的使用意见", html)
            except Exception as exc:  # noqa: BLE001
                mail_err = str(exc)[:200]
                print(f"[feedback] reply mail failed: {exc}")
    if body.via_notice:
        store.create_user_notice(
            item["uid"], "管理员回复了你的使用意见", content,
            author=author, kind="feedback_reply", ref_id=fid)
    return {"ok": True, "reply": reply, "mail_error": mail_err}


class TemplateIn(BaseModel):
    title: str
    body: str = ""


@app.post("/api/admin/reply-templates")
async def admin_add_template(body: TemplateIn,
                             user: dict = Depends(require_admin_gate)):
    title = (body.title or "").strip()
    if not title:
        raise HTTPException(400, "模板名称不能为空")
    return {"ok": True, "template": store.add_reply_template(title, body.body)}


@app.delete("/api/admin/reply-templates/{tid}")
async def admin_delete_template(tid: str,
                                user: dict = Depends(require_admin_gate)):
    return {"ok": store.delete_reply_template(tid)}


# --------------------------------------------------------------------------- #
# account unfreeze review (admin)
# --------------------------------------------------------------------------- #
def _manager_email() -> str:
    """The mailbox manager = the configured SMTP sender account."""
    return str((cfg.CONFIG.get("smtp") or {}).get("user") or "").strip()


def _alloc_unique_pin() -> str:
    """A fresh 6-digit PIN that no still-unverified record already holds."""
    used = {str(i.get("pin")) for i in store.list_unfreeze()
            if i.get("pin") and i.get("status") != "pin_unlocked"}
    while True:
        pin = f"{random.randint(0, 999999):06d}"
        if pin not in used:
            return pin


async def _send_manager_pin(rid: str, reason: str) -> None:
    """Assign a PIN and email it to the mailbox manager (not the user).

    Runs in the background; failures are recorded on the record so the admin
    dashboard can surface them, but never block the caller.
    """
    item = store.get_unfreeze(rid)
    if not item:
        return
    pin = _alloc_unique_pin()
    item["pin"] = pin
    item["pin_sent_at"] = time.time()
    item["pin_note"] = reason
    to = _manager_email()
    if not to:
        item["pin_error"] = "未配置发件邮箱（SMTP 发件账号），无法通知邮箱管理者"
        store.save_unfreeze(item)
        print(f"[security] pin {pin} allocated for {item.get('email')} but SMTP user unset")
        return
    html = auth._wrap(
        "YJS 高级解冻 PIN（邮箱管理者）",
        "<div style='line-height:1.8;font-size:14px'>"
        f"<p>账号 <b>{_esc(item.get('email', ''))}</b> 触发高级解冻。</p>"
        f"<p>原因：{_esc(reason)}（系统评分 {item.get('score')} 分）</p>"
        "<p>请在管理后台「账号安全 · 解冻申请」中输入以下 6 位 PIN 以解冻该账号：</p>"
        f"<p style='font-size:34px;font-weight:700;letter-spacing:8px;color:#dc2626'>{pin}</p>"
        "<p style='color:#888'>请勿向申请人泄露或转发本 PIN。</p></div>")
    try:
        await asyncio.to_thread(
            auth.send_mail, to, f"[YJS] 高级解冻 PIN · {item.get('email', '')}", html)
        item["pin_error"] = ""
        print(f"[security] advanced-unfreeze PIN sent to manager for {item.get('email')}")
    except Exception as exc:  # noqa: BLE001
        item["pin_error"] = str(exc)[:200]
        print(f"[security] PIN mail to manager failed: {exc}")
    store.save_unfreeze(item)


@app.get("/api/admin/unfreeze")
async def admin_list_unfreeze(user: dict = Depends(require_admin_gate)):
    items = store.list_unfreeze()
    # Never leak the PIN itself to the browser — the admin reads it from email.
    for it in items:
        it.pop("pin", None)
    return {"ok": True, "items": items,
            "pending": sum(1 for i in items if i.get("status") == "open"),
            "pass_score": UNFREEZE_PASS_SCORE}


class UnfreezeDecideIn(BaseModel):
    approve: bool


@app.post("/api/admin/unfreeze/{rid}/decide")
async def admin_decide_unfreeze(rid: str, body: UnfreezeDecideIn,
                                admin: dict = Depends(require_admin_gate)):
    item = store.get_unfreeze(rid)
    if not item or item.get("status") != "open":
        raise HTTPException(404, "申请不存在或已处理")
    # Below 50% the system has already denied it; admins cannot approve it —
    # only the PIN-verified advanced route can unlock the account.
    if body.approve and float(item.get("score") or 0) < UNFREEZE_PASS_SCORE:
        raise HTTPException(403, "安全评分不足 50%，系统已否决，仅可使用 PIN 高级解冻")
    if body.approve:
        item["status"] = "approved"
        store.add_pending_unfreeze_notice(item["uid"],
                                          str(admin.get("email", "")))
        store.reset_auth_state(item["email"])
    else:
        item["status"] = "denied"
    item["decided_at"] = time.time()
    item["decided_by"] = str(admin.get("email", ""))
    store.save_unfreeze(item)
    if not body.approve:
        # Admin refusal also escalates to the PIN route automatically.
        asyncio.create_task(_send_manager_pin(item["id"], "管理员拒绝了自助解冻申请"))
    out = dict(item)
    out.pop("pin", None)
    return {"ok": True, "request": out}


@app.post("/api/admin/unfreeze/{rid}/send-pin")
async def admin_send_unfreeze_pin(rid: str,
                                  admin: dict = Depends(require_admin_gate)):
    """Resend (or manually trigger) a PIN to the mailbox manager."""
    item = store.get_unfreeze(rid)
    if not item or item.get("status") not in ("open", "denied"):
        raise HTTPException(404, "申请不存在或已处理")
    await _send_manager_pin(rid, item.get("pin_note") or "管理员手动重发 PIN")
    item = store.get_unfreeze(rid)
    if item and item.get("pin_error"):
        raise HTTPException(400, f"PIN 邮件发送失败：{item['pin_error']}")
    return {"ok": True, "message": "PIN 已发送至邮箱管理者（请查收配置的发件邮箱）"}


class PinIn(BaseModel):
    pin: str


@app.post("/api/admin/unfreeze/{rid}/verify-pin")
async def admin_verify_unfreeze_pin(rid: str, body: PinIn,
                                    admin: dict = Depends(require_admin_gate)):
    item = store.get_unfreeze(rid)
    if not item or item.get("status") not in ("open", "denied"):
        raise HTTPException(404, "申请不存在或已处理")
    if not item.get("pin"):
        raise HTTPException(400, "尚未向邮箱管理者发送 PIN")
    if (body.pin or "").strip() != item["pin"]:
        raise HTTPException(400, "PIN 不正确")
    item["status"] = "pin_unlocked"
    item["decided_at"] = time.time()
    item["decided_by"] = str(admin.get("email", ""))
    item["pin"] = ""
    store.save_unfreeze(item)
    store.add_pending_unfreeze_notice(item["uid"], str(admin.get("email", "")))
    store.reset_auth_state(item["email"])
    out = dict(item)
    out.pop("pin", None)
    return {"ok": True, "request": out}


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
        cfg.set_github_token(cfg.CONFIG, token, pw)
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
    cfg.set_github_token(cfg.CONFIG, token, sess["key"])
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


@app.get("/notification.json")
async def public_notice():
    """History file the admin publishes to the repo; served locally too."""
    if NOTICE_FILE.exists():
        try:
            return JSONResponse(json.loads(NOTICE_FILE.read_text(encoding="utf-8")))
        except Exception:  # noqa: BLE001
            pass
    return JSONResponse(_notices_payload())


@app.get("/config.json")
async def public_config():
    if cfg.PUBLIC_CONFIG.exists():
        return JSONResponse(json.loads(cfg.PUBLIC_CONFIG.read_text(encoding="utf-8")))
    return JSONResponse({"api_url": "", "model": cfg.CONFIG["model"]})


if (cfg.ROOT / "assets").exists():
    app.mount("/assets", StaticFiles(directory=str(cfg.ROOT / "assets")), name="assets")


async def _quota_expiry_worker() -> None:
    """Restore temporary quota adjustments when their deadline passes."""
    while True:
        try:
            due = store.list_due_quota_reverts()
            for q in due:
                reverted = store.revert_quota_request(q["id"])
                if not reverted:
                    continue
                target = store.get_user(q["uid"])
                mb_to = int(reverted.get("revert_bytes", 0)) // 1024 // 1024
                mb_from = int(q.get("request_bytes", 0)) // 1024 // 1024
                print(f"[quota] temp adjustment expired for {q.get('email') or q['uid']}: "
                      f"{mb_from}MB -> {mb_to}MB")
                if target and target.get("email"):
                    txt = (f"你的临时云空间调整（{mb_from} MB）已到期，"
                           f"云空间已自动恢复为 {mb_to} MB。")
                    html = auth._wrap("云空间临时调整已到期",
                                      "<div style='line-height:1.8'>" + _esc(txt) + "</div>")
                    try:
                        await asyncio.to_thread(
                            auth.send_mail, target["email"],
                            "[YJS] 云空间临时调整已到期", html)
                    except Exception as exc:  # noqa: BLE001
                        print(f"[quota] expiry mail failed: {exc}")
        except Exception as exc:  # noqa: BLE001
            print(f"[quota] expiry worker error: {exc}")
        await asyncio.sleep(15)


@app.on_event("startup")
async def _startup():
    port = cfg.CONFIG["port"]
    print(f"[yjs] local server: http://127.0.0.1:{port}")
    print(f"[yjs] model: {cfg.CONFIG['model']}")
    try:
        n = store.migrate_quotas(cfg.CONFIG["quota_bytes"])
        if n:
            print(f"[yjs] migrated base cloud quota for {n} user(s) -> "
                  f"{cfg.CONFIG['quota_bytes'] // 1024 // 1024} MB")
    except Exception as exc:  # noqa: BLE001
        print(f"[yjs] quota migration failed: {exc}")
    try:
        m = migrate_legacy_notice()
        if m:
            print("[yjs] imported the previous single notice into history")
    except Exception as exc:  # noqa: BLE001
        print(f"[yjs] notice migration failed: {exc}")
    # Always make sure the public history file exists on disk.
    try:
        _write_public_notices()
    except Exception:  # noqa: BLE001
        pass
    asyncio.create_task(_quota_expiry_worker())
    tunnel.TUNNEL.start(port)


def main() -> None:
    uvicorn.run(app, host=cfg.CONFIG["host"], port=cfg.CONFIG["port"], log_level="info")


if __name__ == "__main__":
    main()