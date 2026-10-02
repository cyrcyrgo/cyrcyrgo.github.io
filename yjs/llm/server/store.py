"""User / conversation / file storage with per-user 1GB quota.

Layout::

    data/users.json                     # email -> uid index
    data/users/<uid>/profile.json
    data/users/<uid>/conversations/<cid>.json
    data/users/<uid>/workspace/         # agent working directory (counts to quota)
    data/users/<uid>/files/             # artifacts reported back to the user
"""
from __future__ import annotations

import json
import shutil
import time
import uuid
from pathlib import Path

from . import config as cfg

USERS_INDEX = cfg.USERS_DIR / "users.json"


# --------------------------------------------------------------------------- #
# helpers
# --------------------------------------------------------------------------- #
def _now() -> float:
    return time.time()


def _read_json(path: Path, default):
    if not path.exists():
        return default
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return default


def _write_json(path: Path, payload) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    tmp.replace(path)


def dir_size(path: Path) -> int:
    total = 0
    if not path.exists():
        return 0
    for p in path.rglob("*"):
        if p.is_file():
            try:
                total += p.stat().st_size
            except OSError:
                pass
    return total


# --------------------------------------------------------------------------- #
# users
# --------------------------------------------------------------------------- #
def load_index() -> dict:
    return _read_json(USERS_INDEX, {})


def user_dir(uid: str) -> Path:
    return cfg.USERS_DIR / uid


def get_user_by_email(email: str) -> dict | None:
    entry = load_index().get(email.lower())
    if not entry:
        return None
    return _read_json(user_dir(entry["uid"]) / "profile.json", None)


def get_user(uid: str) -> dict | None:
    return _read_json(user_dir(uid) / "profile.json", None)


def create_user(email: str) -> dict:
    uid = uuid.uuid4().hex[:16]
    profile = {
        "uid": uid,
        "email": email.lower(),
        "name": email.split("@")[0],
        "created_at": _now(),
        "last_login": _now(),
    }
    (user_dir(uid) / "conversations").mkdir(parents=True, exist_ok=True)
    (user_dir(uid) / "workspace").mkdir(parents=True, exist_ok=True)
    (user_dir(uid) / "files").mkdir(parents=True, exist_ok=True)
    _write_json(user_dir(uid) / "profile.json", profile)
    idx = load_index()
    idx[email.lower()] = {"uid": uid, "created_at": profile["created_at"]}
    _write_json(USERS_INDEX, idx)
    return profile


def touch_login(uid: str) -> None:
    p = user_dir(uid) / "profile.json"
    profile = _read_json(p, None)
    if profile:
        profile["last_login"] = _now()
        _write_json(p, profile)


def usage(uid: str) -> dict:
    used = dir_size(user_dir(uid))
    quota = cfg.CONFIG["quota_bytes"]
    return {
        "used": used,
        "quota": quota,
        "free": max(quota - used, 0),
        "percent": round(used / quota * 100, 2) if quota else 0,
        "full": used >= quota,
    }


# --------------------------------------------------------------------------- #
# conversations
# --------------------------------------------------------------------------- #
def _conv_path(uid: str, cid: str) -> Path:
    return user_dir(uid) / "conversations" / f"{cid}.json"


def list_conversations(uid: str) -> list[dict]:
    cdir = user_dir(uid) / "conversations"
    out = []
    for p in sorted(cdir.glob("*.json")):
        c = _read_json(p, None)
        if not c:
            continue
        out.append(
            {
                "id": c["id"],
                "title": c.get("title", "新对话"),
                "created_at": c.get("created_at"),
                "updated_at": c.get("updated_at"),
                "messages": len(c.get("messages", [])),
            }
        )
    out.sort(key=lambda x: x.get("updated_at") or 0, reverse=True)
    return out


def create_conversation(uid: str, title: str = "新对话") -> dict:
    cid = uuid.uuid4().hex[:16]
    conv = {
        "id": cid,
        "title": title,
        "created_at": _now(),
        "updated_at": _now(),
        "messages": [],
    }
    _write_json(_conv_path(uid, cid), conv)
    return conv


def get_conversation(uid: str, cid: str) -> dict | None:
    return _read_json(_conv_path(uid, cid), None)


def save_conversation(uid: str, conv: dict) -> None:
    conv["updated_at"] = _now()
    _write_json(_conv_path(uid, conv["id"]), conv)


def delete_conversation(uid: str, cid: str) -> bool:
    p = _conv_path(uid, cid)
    if p.exists():
        p.unlink()
        return True
    return False


def append_message(uid: str, cid: str, message: dict) -> dict:
    conv = get_conversation(uid, cid)
    if not conv:
        raise KeyError(cid)
    conv["messages"].append(message)
    if len(conv["messages"]) == 1 and message.get("role") == "user":
        title = (message.get("content") or "新对话").strip().replace("\n", " ")
        conv["title"] = title[:24] or "新对话"
    save_conversation(uid, conv)
    return conv


# --------------------------------------------------------------------------- #
# files
# --------------------------------------------------------------------------- #
def workspace(uid: str) -> Path:
    p = user_dir(uid) / "workspace"
    p.mkdir(parents=True, exist_ok=True)
    return p


def files_dir(uid: str) -> Path:
    p = user_dir(uid) / "files"
    p.mkdir(parents=True, exist_ok=True)
    return p


def list_files(uid: str) -> list[dict]:
    root = workspace(uid)
    out = []
    for p in root.rglob("*"):
        if p.is_file():
            rel = p.relative_to(root).as_posix()
            st = p.stat()
            out.append({"path": rel, "size": st.st_size, "modified": st.st_mtime})
    out.sort(key=lambda x: x["modified"], reverse=True)
    return out


def delete_file(uid: str, rel: str) -> bool:
    root = workspace(uid).resolve()
    target = (root / rel).resolve()
    if root not in target.parents and target != root:
        return False
    if target.is_file():
        target.unlink()
        return True
    if target.is_dir():
        shutil.rmtree(target, ignore_errors=True)
        return True
    return False


def delete_all_files(uid: str) -> None:
    root = workspace(uid)
    for p in root.iterdir():
        if p.is_dir():
            shutil.rmtree(p, ignore_errors=True)
        else:
            p.unlink(missing_ok=True)