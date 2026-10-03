"""Email OTP authentication (Microsoft Graph) + JWT sessions."""
from __future__ import annotations

import hashlib
import hmac
import json
import os
import random
import time
import urllib.error
import urllib.parse
import urllib.request

import jwt

from . import config as cfg

# email -> {"code", "expires", "last_sent", "attempts"}
_CODES: dict[str, dict] = {}

ALGO = "HS256"

LOGIN_BASE = "https://login.microsoftonline.com"
GRAPH_BASE = "https://graph.microsoft.com/v1.0"
GRAPH_SCOPE = "https://graph.microsoft.com/Mail.Send offline_access"

# Cached access token for the running process: {"value", "exp", "rt"}.
# Refresh tokens are long-lived; access tokens last ~1 hour.
_token_cache: dict[str, object] = {"value": "", "exp": 0.0, "rt": ""}


# --------------------------------------------------------------------------- #
# Microsoft Graph mail (OAuth2 delegated flow)
# --------------------------------------------------------------------------- #
_GRAPH_FIELDS = (("client_id", "客户端 ID"),
                 ("refresh_token", "刷新令牌"),
                 ("user", "发件邮箱"))


def _graph() -> dict:
    g = cfg.CONFIG["msgraph"]
    missing = [label for name, label in _GRAPH_FIELDS
               if not str(g.get(name) or "").strip()]
    if missing:
        raise RuntimeError(
            "Microsoft Graph 未配置：请在后台「邮件服务」中填写"
            + "、".join(missing))
    return g


def _http_json(url: str, *, data: bytes | None, headers: dict,
               timeout: int = 30) -> tuple[int, str]:
    req = urllib.request.Request(url, data=data, headers=headers, method="POST" if data is not None else "GET")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return resp.status, resp.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as exc:
        return exc.code, exc.read().decode("utf-8", "replace")


def _mint_token(g: dict, *, force: bool = False) -> str:
    """Exchange the stored refresh token for a Graph access token (cached)."""
    rt = str(g.get("refresh_token") or "").strip()
    now = time.time()
    if (not force and _token_cache["value"] and _token_cache["rt"] == rt
            and now < float(_token_cache["exp"]) - 120):
        return str(_token_cache["value"])

    tenant = urllib.parse.quote(str(g.get("tenant_id") or "common").strip() or "common",
                                safe="")
    url = f"{LOGIN_BASE}/{tenant}/oauth2/v2.0/token"
    fields = {
        "client_id": str(g.get("client_id") or "").strip(),
        "grant_type": "refresh_token",
        "refresh_token": rt,
        "scope": GRAPH_SCOPE,
    }
    if str(g.get("client_secret") or "").strip():
        fields["client_secret"] = str(g["client_secret"]).strip()
    body = urllib.parse.urlencode(fields).encode("utf-8")
    status, raw = _http_json(
        url, data=body,
        headers={"Content-Type": "application/x-www-form-urlencoded"})
    if status != 200:
        detail = ""
        try:
            d = json.loads(raw)
            detail = (d.get("error_description") or d.get("error") or
                      json.dumps(d, ensure_ascii=False))
        except Exception:  # noqa: BLE001
            detail = raw[:300]
        raise RuntimeError(f"获取 Graph 访问令牌失败（{status}）：{detail[:400]}")
    d = json.loads(raw)
    token = d.get("access_token") or ""
    if not token:
        raise RuntimeError("获取 Graph 访问令牌失败：响应中没有 access_token")
    # Microsoft rotates refresh tokens; persist the new one immediately.
    new_rt = d.get("refresh_token")
    if new_rt and new_rt != rt:
        g["refresh_token"] = new_rt
        cfg.save(cfg.CONFIG)
        rt = new_rt
    _token_cache.update(value=token, exp=now + int(d.get("expires_in") or 3600), rt=rt)
    return token


def _graph_call(token: str, path: str, payload: dict | None = None) -> dict:
    """Call Graph: a payload makes it a POST (sendMail), otherwise GET."""
    url = GRAPH_BASE + path
    headers = {"Authorization": "Bearer " + token}
    data = None
    if payload is not None:
        data = json.dumps(payload).encode("utf-8")
        headers["Content-Type"] = "application/json"
    status, raw = _http_json(url, data=data, headers=headers)
    if not (200 <= status < 300):
        detail = raw
        try:
            d = json.loads(raw)
            detail = (d.get("error", {}) or {}).get("message") or json.dumps(
                d, ensure_ascii=False)
        except Exception:  # noqa: BLE001
            pass
        err = RuntimeError(f"Microsoft Graph 请求失败（{status}）：{detail[:400]}")
        err.code = status  # type: ignore[attr-defined]
        raise err
    if not raw:
        return {}
    try:
        return json.loads(raw)
    except Exception:  # noqa: BLE001
        return {}


def send_mail(to: str, subject: str, html: str, text: str | None = None) -> None:
    """Send one UTF-8 HTML mail through Microsoft Graph ``/sendMail``."""
    g = _graph()
    sender = str(g["user"]).strip()
    message: dict = {
        "subject": subject,
        "body": {"contentType": "HTML", "content": html},
        "toRecipients": [{"emailAddress": {"address": to.strip()}}],
    }
    name = str(g.get("from_name") or "").strip()
    if name:
        message["from"] = {"emailAddress": {"address": sender, "name": name}}
    path = f"/users/{urllib.parse.quote(sender, safe='')}/sendMail"
    payload = {"message": message, "saveToSentItems": True}
    try:
        _graph_call(_mint_token(g), path, payload)
    except RuntimeError as exc:
        # Access token rejected mid-flight — force one renewal and retry once.
        if getattr(exc, "code", 0) in (401, 403):
            _graph_call(_mint_token(g, force=True), path, payload)
        else:
            raise


def check_mail() -> str:
    """Mint a fresh token and read the mailbox profile (admin "test" button)."""
    g = _graph()
    info = _graph_call(_mint_token(g, force=True), "/me")
    return info.get("mail") or info.get("userPrincipalName") or str(g["user"]).strip()


def _wrap(title: str, body_html: str) -> str:
    return (
        "<div style='font-family:system-ui,Arial;padding:24px;color:#111'>"
        f"<h2 style='margin:0 0 12px'>{title}</h2>{body_html}"
        "<p style='color:#888;font-size:12px;margin-top:20px'>此邮件由 YJS LLM Agent 发送</p>"
        "</div>"
    )


def can_send(email: str) -> tuple[bool, int]:
    rec = _CODES.get(email.lower())
    if rec:
        wait = int(cfg.CONFIG["code_resend_seconds"] - (time.time() - rec["last_sent"]))
        if wait > 0:
            return False, wait
    return True, 0


def send_code(email: str, purpose: str = "login") -> None:
    email = email.lower()
    _graph()
    code = f"{random.randint(0, 999999):06d}"
    if cfg.CONFIG.get("debug_codes"):
        print(f"[auth] {purpose} code for {email} = {code}", flush=True)
    _CODES[email] = {
        "code": code,
        "purpose": purpose,
        "expires": time.time() + cfg.CONFIG["code_ttl_seconds"],
        "last_sent": time.time(),
        "attempts": 0,
    }
    if purpose == "reset":
        body = _wrap(
            "YJS LLM Agent 重置密码验证码",
            f"<p>你正在重置登录密码，验证码是：</p>"
            f"<p style='font-size:32px;font-weight:700;letter-spacing:6px;color:#dc2626'>{code}</p>"
            f"<p style='color:#666'>10 分钟内有效，请勿泄露给他人。"
            f"如果不是你本人操作，请忽略此邮件。</p>",
        )
        send_mail(email, "YJS LLM Agent 重置密码验证码", body)
    else:
        body = _wrap(
            "YJS LLM Agent 登录验证码",
            f"<p>你的验证码是：</p>"
            f"<p style='font-size:32px;font-weight:700;letter-spacing:6px;color:#2563eb'>{code}</p>"
            f"<p style='color:#666'>10 分钟内有效，请勿泄露给他人。</p>",
        )
        send_mail(email, "YJS LLM Agent 登录验证码", body)


def verify_code(email: str, code: str, purpose: str = "login") -> bool:
    key = email.lower()
    rec = _CODES.get(key)
    if not rec:
        return False
    if time.time() > rec["expires"]:
        _CODES.pop(key, None)
        return False
    # A code minted for one flow (login/reset) must not unlock the other.
    if rec.get("purpose", "login") != purpose:
        return False
    rec["attempts"] += 1
    if rec["attempts"] > 8:
        _CODES.pop(key, None)
        return False
    if rec["code"] != str(code).strip():
        return False
    _CODES.pop(key, None)
    return True


# --------------------------------------------------------------------------- #
# JWT
# --------------------------------------------------------------------------- #
def make_token(uid: str, email: str) -> str:
    payload = {
        "uid": uid,
        "email": email,
        "iat": int(time.time()),
        "exp": int(time.time()) + 7 * 24 * 3600,
    }
    return jwt.encode(payload, cfg.CONFIG["session_secret"], algorithm=ALGO)


def decode_token(token: str) -> dict | None:
    try:
        return jwt.decode(token, cfg.CONFIG["session_secret"], algorithms=[ALGO])
    except Exception:
        return None


# --------------------------------------------------------------------------- #
# passwords (optional second login method; admins can reset these)
# --------------------------------------------------------------------------- #
PBKDF2_ITERATIONS = 200_000


def hash_password(password: str) -> str:
    """Return ``pbkdf2_sha256$iterations$salt$hash`` — stdlib only, no deps."""
    salt = os.urandom(16)
    dk = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, PBKDF2_ITERATIONS)
    return f"pbkdf2_sha256${PBKDF2_ITERATIONS}${salt.hex()}${dk.hex()}"


def check_password(password: str, stored: str | None) -> bool:
    if not stored or not password:
        return False
    try:
        algo, iters, salt_hex, hash_hex = stored.split("$")
        if algo != "pbkdf2_sha256":
            return False
        dk = hashlib.pbkdf2_hmac(
            "sha256", password.encode("utf-8"), bytes.fromhex(salt_hex), int(iters)
        )
        return hmac.compare_digest(dk.hex(), hash_hex)
    except Exception:
        return False


def valid_password(password: str) -> tuple[bool, str]:
    if not password or len(password) < 6:
        return False, "密码至少 6 位"
    if len(password) > 128:
        return False, "密码过长（最多 128 位）"
    return True, ""


# --------------------------------------------------------------------------- #
# admin dashboard gate (second factor on top of the admin account check)
# --------------------------------------------------------------------------- #
def make_admin_token(uid: str, email: str, hours: int = 12) -> str:
    """Short-lived token proving the admin password was entered."""
    payload = {
        "uid": uid,
        "email": email,
        "scope": "admin",
        "iat": int(time.time()),
        "exp": int(time.time()) + hours * 3600,
    }
    return jwt.encode(payload, cfg.CONFIG["session_secret"], algorithm=ALGO)


def decode_admin_token(token: str) -> dict | None:
    try:
        payload = jwt.decode(token, cfg.CONFIG["session_secret"], algorithms=[ALGO])
    except Exception:
        return None
    return payload if payload.get("scope") == "admin" else None
