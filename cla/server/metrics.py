"""Runtime metrics: token metering, per-model call counts, live in-flight calls.

Everything is persisted to ``data/runtime/metrics.json`` so the admin dashboard
survives a backend restart. Live (in-flight) calls only exist in memory — they
are by definition transient.

Token counts come straight from the provider's ``usage`` block (external APIs
and the local llama.cpp engine alike), so they are the real evaluated-token
numbers, not an estimate.
"""
from __future__ import annotations

import json
import threading
import time
from pathlib import Path

from . import config as cfg

_STATS_PATH: Path = cfg.RUNTIME_DIR / "metrics.json"
_LOCK = threading.RLock()

# --- live (in-memory) state -------------------------------------------------
_LIVE: dict[str, dict] = {}
_SEQ = 0
_RECENT_MAX = 80
_RECENT: list[dict] = []


def _empty() -> dict:
    return {
        "totals": {"calls": 0, "prompt_tokens": 0, "completion_tokens": 0,
                   "total_tokens": 0, "seconds": 0.0, "errors": 0},
        "by_model": {},
        "by_user": {},
        "by_mode": {},
        "by_day": {},
        "first_call": None,
        "last_call": None,
    }


def _load() -> dict:
    if not _STATS_PATH.exists():
        return _empty()
    try:
        data = json.loads(_STATS_PATH.read_text(encoding="utf-8"))
    except Exception:
        return _empty()
    base = _empty()
    base.update(data)
    for k in ("totals", "by_model", "by_user", "by_mode", "by_day"):
        base.setdefault(k, {})
    base["totals"] = {**_empty()["totals"], **(base.get("totals") or {})}
    return base


def _save(stats: dict) -> None:
    _STATS_PATH.parent.mkdir(parents=True, exist_ok=True)
    tmp = _STATS_PATH.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(stats, ensure_ascii=False, indent=2), encoding="utf-8")
    tmp.replace(_STATS_PATH)


def _bump(bucket: dict, key: str, prompt: int, completion: int, seconds: float) -> None:
    row = bucket.setdefault(key, {
        "calls": 0, "prompt_tokens": 0, "completion_tokens": 0,
        "total_tokens": 0, "seconds": 0.0, "last_used": 0,
    })
    row["calls"] += 1
    row["prompt_tokens"] += prompt
    row["completion_tokens"] += completion
    row["total_tokens"] += prompt + completion
    row["seconds"] = round(row.get("seconds", 0) + seconds, 2)
    row["last_used"] = time.time()


# --------------------------------------------------------------------------- #
# live call tracking
# --------------------------------------------------------------------------- #
def start_live(uid: str, email: str, model: str, mode: str) -> str:
    global _SEQ
    with _LOCK:
        _SEQ += 1
        call_id = f"c{_SEQ}"
        _LIVE[call_id] = {
            "id": call_id,
            "uid": uid,
            "email": email,
            "model": model,
            "mode": mode,
            "phase": "思考中",
            "step": 0,
            "started": time.time(),
        }
        return call_id


def update_live(call_id: str, **fields) -> None:
    with _LOCK:
        row = _LIVE.get(call_id)
        if row:
            row.update(fields)


def end_live(call_id: str) -> None:
    with _LOCK:
        _LIVE.pop(call_id, None)


def live_snapshot() -> list[dict]:
    now = time.time()
    with _LOCK:
        rows = []
        for row in _LIVE.values():
            r = dict(row)
            r["elapsed"] = round(now - r.get("started", now), 1)
            rows.append(r)
        rows.sort(key=lambda x: x.get("started") or 0)
        return rows


def live_models() -> dict[str, int]:
    """model -> number of in-flight calls using it."""
    out: dict[str, int] = {}
    with _LOCK:
        for row in _LIVE.values():
            m = row.get("model") or "?"
            out[m] = out.get(m, 0) + 1
    return out


# --------------------------------------------------------------------------- #
# recording
# --------------------------------------------------------------------------- #
def record_call(uid: str, email: str, model: str, mode: str,
                prompt_tokens: int, completion_tokens: int,
                seconds: float = 0.0, ok: bool = True) -> None:
    prompt_tokens = int(prompt_tokens or 0)
    completion_tokens = int(completion_tokens or 0)
    with _LOCK:
        stats = _load()
        day = time.strftime("%Y-%m-%d")

        tot = stats["totals"]
        tot["calls"] += 1
        tot["prompt_tokens"] += prompt_tokens
        tot["completion_tokens"] += completion_tokens
        tot["total_tokens"] += prompt_tokens + completion_tokens
        tot["seconds"] = round(tot.get("seconds", 0) + (seconds or 0), 2)
        if not ok:
            tot["errors"] = tot.get("errors", 0) + 1

        _bump(stats["by_model"], model or "?", prompt_tokens, completion_tokens, seconds or 0)
        _bump(stats["by_user"], uid, prompt_tokens, completion_tokens, seconds or 0)
        _bump(stats["by_mode"], mode or "work", prompt_tokens, completion_tokens, seconds or 0)

        day_row = stats["by_day"].setdefault(day, {"calls": 0, "total_tokens": 0})
        day_row["calls"] += 1
        day_row["total_tokens"] += prompt_tokens + completion_tokens

        # keep at most 30 days
        for old in sorted(stats["by_day"].keys())[:-30]:
            stats["by_day"].pop(old, None)

        now = time.time()
        stats["first_call"] = stats.get("first_call") or now
        stats["last_call"] = now

        if email:
            stats["by_user"].setdefault(uid, {})["email"] = email
        _save(stats)

        _RECENT.insert(0, {
            "ts": now, "uid": uid, "email": email, "model": model, "mode": mode,
            "prompt_tokens": prompt_tokens, "completion_tokens": completion_tokens,
            "total_tokens": prompt_tokens + completion_tokens,
            "seconds": round(seconds or 0, 2), "ok": ok,
        })
        del _RECENT[_RECENT_MAX:]


def snapshot() -> dict:
    with _LOCK:
        stats = _load()
        out = json.loads(json.dumps(stats))
        out["recent"] = list(_RECENT)
        out["live"] = live_snapshot()
        return out


def reset() -> None:
    with _LOCK:
        _save(_empty())
        _RECENT.clear()