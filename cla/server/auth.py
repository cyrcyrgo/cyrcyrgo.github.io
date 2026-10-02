"""Email OTP authentication (QQ SMTP) + JWT sessions."""
from __future__ import annotations

import hashlib
import hmac
import os
import random
import smtplib
import time
from email.header import Header
from email.mime.text import MIMEText

import jwt

from . import config as cfg

# email -> {"code", "expires", "last_sent", "attempts"}
_CODES: dict[str, dict] = {}

ALGO = "HS256"


# --------------------------------------------------------------------------- #
# verification codes
# --------------------------------------------------------------------------- #
def _smtp():
    s = cfg.CONFIG["smtp"]
    if not s.get("user") or not s.get("auth_code"):
        raise RuntimeError("SMTP 未配置：请在 config.local.json 中填写 smtp.user / smtp.auth_code")
    return s


def can_send(email: str) -> tuple[bool, int]:
    rec = _CODES.get(email.lower())
    if rec:
        wait = int(cfg.CONFIG["code_resend_seconds"] - (time.time() - rec["last_sent"]))
        if wait > 0:
            return False, wait
    return True, 0


def send_code(email: str) -> None:
    email = email.lower()
    s = _smtp()
    code = f"{random.randint(0, 999999):06d}"
    if cfg.CONFIG.get("debug_codes"):
        print(f"[auth] code for {email} = {code}", flush=True)
    _CODES[email] = {
        "code": code,
        "expires": time.time() + cfg.CONFIG["code_ttl_seconds"],
        "last_sent": time.time(),
        "attempts": 0,
    }
    body = (
        f"<div style='font-family:system-ui,Arial;padding:24px'>"
        f"<h2>YJS LLM Agent 登录验证码</h2>"
        f"<p>你的验证码是：</p>"
        f"<p style='font-size:32px;font-weight:700;letter-spacing:6px;color:#2563eb'>{code}</p>"
        f"<p style='color:#666'>10 分钟内有效，请勿泄露给他人。</p></div>"
    )
    msg = MIMEText(body, "html", "utf-8")
    msg["Subject"] = Header("YJS LLM Agent 登录验证码", "utf-8")
    msg["From"] = f"{s.get('from_name', 'YJS')} <{s['user']}>"
    msg["To"] = email

    with smtplib.SMTP_SSL(s["host"], int(s.get("port", 465)), timeout=20) as smtp:
        smtp.login(s["user"], s["auth_code"])
        smtp.sendmail(s["user"], [email], msg.as_string())


def verify_code(email: str, code: str) -> bool:
    rec = _CODES.get(email.lower())
    if not rec:
        return False
    if time.time() > rec["expires"]:
        _CODES.pop(email.lower(), None)
        return False
    rec["attempts"] += 1
    if rec["attempts"] > 8:
        _CODES.pop(email.lower(), None)
        return False
    if rec["code"] != str(code).strip():
        return False
    _CODES.pop(email.lower(), None)
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
