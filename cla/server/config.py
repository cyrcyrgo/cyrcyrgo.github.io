"""Central configuration for the YJS LLM Agent backend.

Secrets live in ``config.local.json`` (git-ignored) and never get published.
Runtime data lives under ``D:/yjs/data``.
"""
from __future__ import annotations

import hashlib
import hmac
import json
import os
import secrets
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent          # D:\yjs
DATA_DIR = ROOT / "data"
USERS_DIR = DATA_DIR / "users"
RUNTIME_DIR = DATA_DIR / "runtime"
BIN_DIR = ROOT / "bin"
LOCAL_CONFIG = ROOT / "config.local.json"
PUBLIC_CONFIG = ROOT / "config.json"


# --------------------------------------------------------------------------- #
# symmetric encryption for secrets at rest (stdlib only)
#
# A PBKDF2-derived key drives an HMAC-SHA256 counter keystream (CTR-like) and an
# HMAC tag proves integrity. Used to keep the GitHub token as ciphertext on disk
# until the repo password is entered. No third-party crypto dependency needed.
# --------------------------------------------------------------------------- #
PBKDF2_ITER = 120_000


def _derive_key(material: str, salt: bytes) -> bytes:
    return hashlib.pbkdf2_hmac("sha256", material.encode("utf-8"), salt, PBKDF2_ITER, dklen=32)


def _keystream(key: bytes, nonce: bytes, length: int) -> bytes:
    out = bytearray()
    counter = 0
    while len(out) < length:
        out += hmac.new(key, nonce + counter.to_bytes(8, "big"), hashlib.sha256).digest()
        counter += 1
    return bytes(out[:length])


def encrypt_secret(plaintext: str, material: str) -> dict:
    """Return an opaque dict {salt, nonce, ct, tag} for *plaintext*."""
    salt, nonce = os.urandom(16), os.urandom(16)
    key = _derive_key(material, salt)
    data = plaintext.encode("utf-8")
    ct = bytes(a ^ b for a, b in zip(data, _keystream(key, nonce, len(data))))
    tag = hmac.new(key, nonce + ct, hashlib.sha256).hexdigest()
    return {"salt": salt.hex(), "nonce": nonce.hex(), "ct": ct.hex(), "tag": tag}


def decrypt_secret(blob: dict | None, material: str) -> str | None:
    """Inverse of :func:`encrypt_secret`; ``None`` when *material* is wrong."""
    if not isinstance(blob, dict):
        return None
    try:
        salt = bytes.fromhex(blob["salt"])
        nonce = bytes.fromhex(blob["nonce"])
        ct = bytes.fromhex(blob["ct"])
        key = _derive_key(material, salt)
        if not hmac.compare_digest(
            hmac.new(key, nonce + ct, hashlib.sha256).hexdigest(), blob["tag"]
        ):
            return None
        ks = _keystream(key, nonce, len(ct))
        return bytes(a ^ b for a, b in zip(ct, ks)).decode("utf-8")
    except Exception:
        return None

DEFAULTS: dict = {
    "host": "127.0.0.1",
    "port": 8787,
    "model": "qwen3.5:0.8b",
    "ollama_url": "http://127.0.0.1:11434",
    "quota_bytes": 50 * 1024 * 1024,        # 50 MB base cloud space per user
    "max_agent_steps": 24,
    "max_tool_calls_per_step": 8,       # cap tool calls executed in one agent step
    "code_timeout": 120,
    "session_secret": "",
    "code_ttl_seconds": 600,
    "code_resend_seconds": 60,
    "allow_register": True,
    # ---- admin-controlled global permissions -------------------------------
    "ai_enabled": True,            # master switch: suspend ALL model calls
    "allow_model_add": True,       # whether admins may still add new models
    "announcement": "",            # site-wide notice shown on the chat page
    "notification": {              # structured notice, mirrored to the repo
        "title": "", "body": "", "updated_at": "", "author": "",
    },
    "default_model": "",           # "" = fall back to "model"
    "github": {
        "token": "",                  # legacy plaintext (runtime copy only once encrypted)
        "token_secret": {},           # token encrypted with the repo password
        "password_hash": "",          # repo-management password (separate from admin lockdown)
        "repo": "cyrcyrgo/cyrcyrgo.github.io",
        "branch": "main",
        "path_prefix": "cla",
    },
    "ngrok": {"token": "", "domain": ""},   # legacy, kept for compatibility
    "cpolar": {"authtoken": ""},
    # Admin dashboard access. Leave ``emails`` empty to let the
    # earliest-registered account act as the owner instead.
    "admin": {"emails": [], "password_hash": ""},
    # Outgoing mail goes through SMTP (SSL on 465 or STARTTLS on 587).
    "smtp": {
        "host": "",           # e.g. smtp.office365.com / smtp.qq.com / smtp.163.com
        "port": 465,
        "protocol": "ssl",    # ssl | starttls
        "user": "",           # sender mailbox
        "auth_code": "",      # SMTP authorization code / app password
        "from_name": "YJS Cloud LLM Agent",
    },
    "mcp_servers": {},
}


# Default Ollama-builtin models. ``_merge_models`` backfills new fields into
# admin-tweaked entries in config.local.json and appends API-backed extras.
DEFAULT_MODELS = [
    {"name": "qwen3.5:0.8b", "display": "Flash版高速 · Qwen3.5 0.8B",
     "tier": "Flash版高速", "size_mb": 500, "enabled": True,
     "provider": "ollama", "base_url": "", "context_len": 8192,
     "desc": "0.8B参数 极致轻量 几乎零显存，极速响应，适合一句话任务"},
    {"name": "qwen3.5:2b", "display": "超高速 · Qwen3.5 2B",
     "tier": "超高速", "size_mb": 1200, "enabled": True,
     "provider": "ollama", "base_url": "", "context_len": 8192,
     "desc": "2B参数 Q4量化 约1.2GB显存，极快响应，简单任务首选"},
    {"name": "qwen3:4b", "display": "高速 · Qwen3 4B",
     "tier": "高速", "size_mb": 2500, "enabled": True,
     "provider": "ollama", "base_url": "", "context_len": 8192,
     "desc": "4B参数 Q4量化 约2.5GB显存，响应最快，轻量任务"},
    {"name": "qwen3:8b", "display": "中级中速 · Qwen3 8B",
     "tier": "中级中速", "size_mb": 4500, "enabled": True,
     "provider": "ollama", "base_url": "", "context_len": 8192,
     "desc": "8B参数 Q4量化 约4.5GB显存，质量与速度平衡"},
]

DEFAULT_MODELS_NAMES = {m["name"] for m in DEFAULT_MODELS}

def _deep_merge(base: dict, extra: dict) -> dict:
    out = dict(base)
    for k, v in extra.items():
        if isinstance(v, dict) and isinstance(out.get(k), dict):
            out[k] = _deep_merge(out[k], v)
        else:
            out[k] = v
    return out


def _merge_models(defaults: list, custom: list) -> list:
    """Merge defaults with admin-edited ``config.local.json.models``."""
    if not custom:
        return list(defaults)
    idx = {m["name"]: m for m in custom if isinstance(m, dict) and m.get("name")}
    out = []
    for base in defaults:
        merged = dict(base)
        if base["name"] in idx:
            merged.update(idx[base["name"]])
            idx.pop(base["name"])
        merged.setdefault("enabled", True)
        merged.setdefault("provider", "ollama")
        merged.setdefault("base_url", "")
        merged.setdefault("api_key_ref", "")
        merged.setdefault("context_len", 8192)
        out.append(merged)
    for extra in idx.values():
        m = dict(extra)
        m.setdefault("enabled", True)
        m.setdefault("provider", "openai" if m.get("base_url") else "ollama")
        m.setdefault("context_len", 8192)
        m.setdefault("size_mb", 0)
        m.setdefault("display", m["name"])
        m.setdefault("tier", "自定义")
        out.append(m)
    return out


def load() -> dict:
    cfg = json.loads(json.dumps(DEFAULTS))
    cfg["models"] = _merge_models(DEFAULT_MODELS, [])
    read_ok = False
    if LOCAL_CONFIG.exists():
        try:
            raw = LOCAL_CONFIG.read_text(encoding="utf-8-sig")
            raw_data = json.loads(raw)
            if "models" in raw_data:
                cfg["models"] = _merge_models(DEFAULT_MODELS, raw_data["models"])
                raw_data.pop("models", None)
            cfg = _deep_merge(cfg, raw_data)
            read_ok = True
        except Exception as exc:  # pragma: no cover
            print(f"[config] failed to read {LOCAL_CONFIG}: {exc}")
    if not cfg.get("session_secret"):
        cfg["session_secret"] = secrets.token_urlsafe(48)
        if read_ok or not LOCAL_CONFIG.exists():
            save(cfg)
    _migrate_github_token(cfg)
    _migrate_mail(cfg)
    _migrate_base_quota(cfg)
    for d in (DATA_DIR, USERS_DIR, RUNTIME_DIR, BIN_DIR):
        d.mkdir(parents=True, exist_ok=True)
    return cfg


def _migrate_mail(cfg: dict) -> None:
    """Mail is SMTP again.

    Drop the obsolete Microsoft Graph block. If SMTP has no sender yet, carry
    over the mailbox address / display name that Graph used so the admin only
    has to fill host + authorization code.
    """
    g = cfg.pop("msgraph", None)
    s = cfg.get("smtp")
    if not isinstance(s, dict):
        s = {}
        cfg["smtp"] = s
    changed = g is not None
    if isinstance(g, dict):
        if g.get("user") and not s.get("user"):
            s["user"] = g["user"]
        if g.get("from_name") and not s.get("from_name"):
            s["from_name"] = g["from_name"]
    s.setdefault("host", "")
    s.setdefault("port", 465)
    s.setdefault("protocol", "ssl")
    s.setdefault("auth_code", "")
    if changed and LOCAL_CONFIG.exists():
        save(cfg)


_OLD_DEFAULT_QUOTA = 1024 * 1024 * 1024       # the original 1 GB base quota


def _migrate_base_quota(cfg: dict) -> None:
    """The base cloud space was lowered from 1 GB to 50 MB.

    Only rewrite the local config value when it still equals the factory
    default — an admin-chosen custom global quota is left untouched.
    Per-user profiles are migrated separately in ``store.migrate_quotas``.
    """
    if int(cfg.get("quota_bytes") or 0) == _OLD_DEFAULT_QUOTA:
        cfg["quota_bytes"] = DEFAULTS["quota_bytes"]
        if LOCAL_CONFIG.exists():
            save(cfg)


def set_github_token(conf: dict, token: str, repo_password: str | None = None) -> None:
    """Store *token* under both encryption regimes.

    * ``token_secret`` (mode ``repo``) is opened ONLY by the repo-management
      password the admin types in the dashboard — it gates interactive writes
      such as publishing a site-wide notice.
    * ``token_session_secret`` (mode ``session``) lets unattended boot jobs —
      pushing the tunnel domain to the repo on every startup — run without a
      human typing the password. It is encrypted with the local session secret.
    """
    gh = conf["github"]
    gh["token"] = token
    if repo_password:
        gh["token_secret"] = {"mode": "repo",
                              **encrypt_secret(token, repo_password)}
    gh["token_session_secret"] = {
        "mode": "session", **encrypt_secret(token, conf["session_secret"])}


def _migrate_github_token(conf: dict) -> None:
    """Load the GitHub token into memory from the right ciphertext.

    * legacy plaintext token  -> encrypted with the session secret ("session" mode)
    * primary ``token_secret`` in "session" mode -> decrypted straight away
    * primary in "repo" mode   -> left password-locked for interactive use, but
      the ``token_session_secret`` companion still unlocks unattended boot jobs
    """
    gh = conf.get("github")
    if not isinstance(gh, dict):
        return
    sec = gh.get("token_secret") or {}
    mode = sec.get("mode") or ("repo" if sec else "")
    companion = gh.get("token_session_secret") or {}
    if not gh.get("token"):
        if mode == "session":
            tok = decrypt_secret(sec, conf["session_secret"])
            if tok:
                gh["token"] = tok
        if not gh.get("token") and companion:
            tok = decrypt_secret(companion, conf["session_secret"])
            if tok:
                gh["token"] = tok
    # Legacy: a plaintext token with NO encrypted blob at all gets wrapped once.
    if gh.get("token") and not sec:
        gh["token_secret"] = {"mode": "session",
                              **encrypt_secret(gh["token"], conf["session_secret"])}
        save(conf)


def save(cfg: dict) -> None:
    """Persist the *secret* portion of the config (always UTF-8, no BOM)."""
    secret_keys = ("github", "ngrok", "cpolar", "smtp", "session_secret",
                   "mcp_servers", "models", "api_keys", "admin",
                   "allow_register", "ai_enabled", "allow_model_add",
                   "announcement", "default_model", "max_tool_calls_per_step",
                   "notification")
    payload = {k: cfg[k] for k in secret_keys if k in cfg}
    # Never persist the GitHub token in the clear: only its encrypted form
    # (github.token_secret) belongs on disk. The plaintext copy stays in memory
    # for the running process, decrypted on demand after the repo password.
    gh = payload.get("github")
    if isinstance(gh, dict):
        gh = dict(gh)
        gh.pop("token", None)
        payload["github"] = gh
    LOCAL_CONFIG.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8"
    )


CONFIG = load()
