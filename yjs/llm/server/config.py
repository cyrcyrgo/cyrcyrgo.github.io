"""Central configuration for the YJS LLM Agent backend.

Secrets live in ``config.local.json`` (git-ignored) and never get published.
Runtime data lives under ``D:/yjs/data``.
"""
from __future__ import annotations

import json
import secrets
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent          # D:\yjs
DATA_DIR = ROOT / "data"
USERS_DIR = DATA_DIR / "users"
RUNTIME_DIR = DATA_DIR / "runtime"
BIN_DIR = ROOT / "bin"
LOCAL_CONFIG = ROOT / "config.local.json"
PUBLIC_CONFIG = ROOT / "config.json"

DEFAULTS: dict = {
    "host": "127.0.0.1",
    "port": 8787,
    "model": "qwen3.5:9b",
    "ollama_url": "http://127.0.0.1:11434",
    "quota_bytes": 1073741824,          # 1 GB per user
    "max_agent_steps": 24,
    "code_timeout": 120,
    "session_secret": "",
    "code_ttl_seconds": 600,
    "code_resend_seconds": 60,
    "allow_register": True,
    "github": {
        "token": "",
        "repo": "cyrcyrgo/cyrcyrgo.github.io",
        "branch": "main",
        "path_prefix": "yjs/llm",
    },
    "ngrok": {"token": "", "domain": ""},
    "smtp": {
        "host": "smtp.qq.com",
        "port": 465,
        "user": "",
        "auth_code": "",
        "from_name": "YJS LLM Agent",
    },
    "mcp_servers": {},
}


def _deep_merge(base: dict, extra: dict) -> dict:
    out = dict(base)
    for k, v in extra.items():
        if isinstance(v, dict) and isinstance(out.get(k), dict):
            out[k] = _deep_merge(out[k], v)
        else:
            out[k] = v
    return out


def load() -> dict:
    cfg = json.loads(json.dumps(DEFAULTS))
    if LOCAL_CONFIG.exists():
        try:
            cfg = _deep_merge(cfg, json.loads(LOCAL_CONFIG.read_text(encoding="utf-8")))
        except Exception as exc:  # pragma: no cover - defensive
            print(f"[config] failed to read {LOCAL_CONFIG}: {exc}")
    if not cfg.get("session_secret"):
        cfg["session_secret"] = secrets.token_urlsafe(48)
        save(cfg)
    for d in (DATA_DIR, USERS_DIR, RUNTIME_DIR, BIN_DIR):
        d.mkdir(parents=True, exist_ok=True)
    return cfg


def save(cfg: dict) -> None:
    """Persist the *secret* portion of the config."""
    secret_keys = ("github", "ngrok", "smtp", "session_secret", "mcp_servers")
    payload = {k: cfg[k] for k in secret_keys if k in cfg}
    LOCAL_CONFIG.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8"
    )


CONFIG = load()