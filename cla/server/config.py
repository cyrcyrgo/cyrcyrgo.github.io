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
    "default_model": "",           # "" = fall back to "model"
    "github": {
        "token": "",
        "repo": "cyrcyrgo/cyrcyrgo.github.io",
        "branch": "main",
        "path_prefix": "cla",
    },
    "ngrok": {"token": "", "domain": ""},
    # Admin dashboard access. Leave ``emails`` empty to let the
    # earliest-registered account act as the owner instead.
    "admin": {"emails": [], "password_hash": ""},
    "smtp": {
        "host": "smtp.qq.com",
        "port": 465,
        "user": "",
        "auth_code": "",
        "from_name": "YJS LLM Agent",
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
    {"name": "qwen3.5:9b", "display": "高级 · Qwen3.5 9B",
     "tier": "高级", "size_mb": 6600, "enabled": True,
     "provider": "ollama", "base_url": "", "context_len": 8192,
     "desc": "9.7B参数 Q4量化 约6.6GB显存，推理最强，复杂任务首选"},
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
    for d in (DATA_DIR, USERS_DIR, RUNTIME_DIR, BIN_DIR):
        d.mkdir(parents=True, exist_ok=True)
    return cfg


def save(cfg: dict) -> None:
    """Persist the *secret* portion of the config (always UTF-8, no BOM)."""
    secret_keys = ("github", "ngrok", "smtp", "session_secret",
                   "mcp_servers", "models", "api_keys", "admin",
                   "allow_register", "ai_enabled", "allow_model_add",
                   "announcement", "default_model", "max_tool_calls_per_step")
    payload = {k: cfg[k] for k in secret_keys if k in cfg}
    LOCAL_CONFIG.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8"
    )


CONFIG = load()
