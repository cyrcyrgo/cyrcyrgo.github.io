"""Email OTP authentication (SMTP) + JWT sessions."""
from __future__ import annotations

import hashlib
import hmac
import os
import secrets
import smtplib
import ssl
import time
from collections import defaultdict
from email.message import EmailMessage

import jwt

from . import config as cfg

# email -> {"code", "expires", "last_sent", "attempts"}
_CODES: dict[str, dict] = {}

# 发信 / 校验的 IP 维度限流（原本只有按邮箱 60s 冷却，可被无限轰炸 + 爆破）
_IP_HITS: dict[str, list[float]] = defaultdict(list)
IP_SEND_LIMIT = 10          # 同一 IP 每窗口最多请求发送几封验证码
IP_SEND_WINDOW = 3600.0     # 窗口长度（秒）
IP_VERIFY_LIMIT = 20        # 同一 IP 每窗口最多尝试校验几次
IP_VERIFY_WINDOW = 600.0

ALGO = "HS256"


def _ip_hit(key: str, ip: str, limit: int, window: float) -> bool:
    """记录一次命中；返回 True 表示已超限。"""
    if not ip:
        return False
    bucket = f"{key}:{ip}"
    now = time.time()
    hits = [t for t in _IP_HITS[bucket] if now - t < window]
    hits.append(now)
    _IP_HITS[bucket] = hits
    return len(hits) > limit


def ip_send_allowed(ip: str) -> bool:
    return not _ip_hit("send", ip, IP_SEND_LIMIT, IP_SEND_WINDOW)


def ip_verify_allowed(ip: str) -> bool:
    return not _ip_hit("verify", ip, IP_VERIFY_LIMIT, IP_VERIFY_WINDOW)


# --------------------------------------------------------------------------- #
# SMTP mail
# --------------------------------------------------------------------------- #
def _smtp() -> dict:
    s = cfg.CONFIG["smtp"]
    user = str(s.get("user") or "").strip()
    auth_code = str(s.get("auth_code") or "").strip()
    host = str(s.get("host") or "").strip()
    if not (user and auth_code and host):
        raise RuntimeError("SMTP 未配置：请在后台「邮件服务」中填写发件邮箱、授权码和服务器")
    return s


def send_mail(to: str, subject: str, html: str, text: str | None = None,
              attachments: list[tuple[str, bytes]] | None = None) -> None:
    """Send one UTF-8 HTML mail over SMTP (SSL or STARTTLS).

    ``attachments`` is an optional list of ``(filename, bytes)``.
    """
    s = _smtp()
    host = str(s["host"]).strip()
    port = int(s.get("port") or 465)
    user = str(s["user"]).strip()
    auth_code = str(s["auth_code"]).strip()
    protocol = str(s.get("protocol") or "ssl").strip().lower()

    msg = EmailMessage()
    name = str(s.get("from_name") or "").strip()
    msg["From"] = f"{name} <{user}>" if name else user
    msg["To"] = to.strip()
    msg["Subject"] = subject
    msg.set_content(text or "请使用支持 HTML 的客户端查看本邮件。")
    msg.add_alternative(html, subtype="html")

    import mimetypes
    for fname, blob in attachments or []:
        ctype, _ = mimetypes.guess_type(fname)
        maintype, subtype = (ctype.split("/", 1) if ctype else ("application", "octet-stream"))
        msg.add_attachment(blob, maintype=maintype, subtype=subtype, filename=fname)

    if protocol == "starttls":
        with smtplib.SMTP(host, port, timeout=30) as server:
            server.ehlo()
            server.starttls(context=ssl.create_default_context())
            server.ehlo()
            server.login(user, auth_code)
            server.send_message(msg)
    else:
        context = ssl.create_default_context()
        with smtplib.SMTP_SSL(host, port, context=context, timeout=30) as server:
            server.login(user, auth_code)
            server.send_message(msg)


def check_mail() -> str:
    """Open an SMTP connection to validate credentials (admin "test" button)."""
    s = _smtp()
    host = str(s["host"]).strip()
    port = int(s.get("port") or 465)
    user = str(s["user"]).strip()
    auth_code = str(s["auth_code"]).strip()
    protocol = str(s.get("protocol") or "ssl").strip().lower()
    if protocol == "starttls":
        with smtplib.SMTP(host, port, timeout=20) as server:
            server.ehlo()
            server.starttls(context=ssl.create_default_context())
            server.ehlo()
            server.login(user, auth_code)
    else:
        with smtplib.SMTP_SSL(host, port,
                             context=ssl.create_default_context(),
                             timeout=20) as server:
            server.login(user, auth_code)
    return user


def _wrap(title: str, body_html: str) -> str:
    return (
        "<div style='font-family:system-ui,Arial;padding:24px;color:#111'>"
        f"<h2 style='margin:0 0 12px'>{title}</h2>{body_html}"
        "<p style='color:#888;font-size:12px;margin-top:20px'>此邮件由 Lumina LLM Agent 发送</p>"
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
    _smtp()
    # CSPRNG：random 是 Mersenne Twister，可被观测值预测，不能用于验证码。
    code = f"{secrets.randbelow(1_000_000):06d}"
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
            "Lumina LLM Agent 重置密码验证码",
            f"<p>你正在重置登录密码，验证码是：</p>"
            f"<p style='font-size:32px;font-weight:700;letter-spacing:6px;color:#dc2626'>{code}</p>"
            f"<p style='color:#666'>10 分钟内有效，请勿泄露给他人。"
            f"如果不是你本人操作，请忽略此邮件。</p>",
        )
        send_mail(email, "Lumina LLM Agent 重置密码验证码", body)
    else:
        body = _wrap(
            "Lumina LLM Agent 登录验证码",
            f"<p>你的验证码是：</p>"
            f"<p style='font-size:32px;font-weight:700;letter-spacing:6px;color:#2563eb'>{code}</p>"
            f"<p style='color:#666'>10 分钟内有效，请勿泄露给他人。</p>",
        )
        send_mail(email, "Lumina LLM Agent 登录验证码", body)


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
