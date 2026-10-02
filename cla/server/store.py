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
        # Per-user cloud quota; the admin dashboard can raise/lower this.
        "quota_bytes": int(cfg.CONFIG["quota_bytes"]),
        "model_allowed": None,          # None = all enabled; [] = fully suspended
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
    profile = get_user(uid) or {}
    quota = int(profile.get("quota_bytes") or cfg.CONFIG["quota_bytes"])
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


def _prune_files_from_conversations(uid: str, paths: set[str]) -> None:
    """After deleting a file/dir, strip matching entries from every conversation.

    Matches both exact paths and anything under a deleted dir.
    """
    convs_dir = user_dir(uid) / "conversations"
    if not convs_dir.is_dir():
        return
    for jf in convs_dir.glob("*.json"):
        try:
            data = _read_json(jf, {}) or {}
        except Exception:
            continue
        changed = False
        for msg in data.get("messages", []):
            files = msg.get("files") or []
            if not files:
                continue
            new_files = []
            for f in files:
                fp = f.get("path")
                ok = fp not in paths and not any(
                    p and fp.startswith(p + "/") for p in paths
                )
                if ok:
                    new_files.append(f)
            if len(new_files) != len(files):
                msg["files"] = new_files
                changed = True
        if changed:
            _write_json(jf, data)


def delete_file(uid: str, rel: str) -> bool:
    root = workspace(uid).resolve()
    target = (root / rel).resolve()
    if root not in target.parents and target != root:
        return False
    if not target.exists():
        return False
    if target.is_file():
        target.unlink()
        _prune_files_from_conversations(uid, {rel})
        return True
    if target.is_dir():
        deleted = set()
        for f in target.rglob("*"):
            if f.is_file():
                try:
                    deleted.add(f.relative_to(root).as_posix())
                except ValueError:
                    pass
        shutil.rmtree(target, ignore_errors=True)
        deleted.add(rel.rstrip("/"))
        _prune_files_from_conversations(uid, deleted)
        return True
    return False


def delete_all_files(uid: str) -> None:
    root = workspace(uid)
    deleted = set()
    for p in root.rglob("*"):
        if p.is_file():
            try:
                deleted.add(p.relative_to(root).as_posix())
            except ValueError:
                pass
    for p in root.iterdir():
        if p.is_dir():
            shutil.rmtree(p, ignore_errors=True)
        else:
            p.unlink(missing_ok=True)
    _prune_files_from_conversations(uid, deleted)


def set_model_preference(uid: str, model: str | None) -> bool:
    """Persist the user's preferred model (None = use server default)."""
    p = user_dir(uid) / "profile.json"
    profile = _read_json(p, None)
    if not profile:
        return False
    if model is None:
        profile.pop("model_preference", None)
    else:
        profile["model_preference"] = model
    _write_json(p, profile)
    return True


# --------------------------------------------------------------------------- #
# account administration (used by the admin dashboard)
# --------------------------------------------------------------------------- #
def is_admin(user: dict | None) -> bool:
    """Decide whether *user* may open the admin dashboard.

    If ``admin.emails`` is configured it is authoritative. Otherwise the
    earliest-registered account acts as the owner, so a fresh install always
    has exactly one administrator instead of nobody.
    """
    if not user:
        return False
    admin_cfg = cfg.CONFIG.get("admin") or {}
    emails = [str(e).lower() for e in (admin_cfg.get("emails") or []) if e]
    if emails:
        return str(user.get("email", "")).lower() in emails
    idx = load_index()
    if not idx:
        return False
    oldest = min(idx.values(), key=lambda v: v.get("created_at") or 0)
    return oldest.get("uid") == user.get("uid")


def set_quota(uid: str, quota_bytes: int) -> bool:
    path = user_dir(uid) / "profile.json"
    profile = _read_json(path, None)
    if not profile:
        return False
    profile["quota_bytes"] = max(int(quota_bytes), 0)
    _write_json(path, profile)
    return True


def set_password_hash(uid: str, password_hash: str | None) -> bool:
    path = user_dir(uid) / "profile.json"
    profile = _read_json(path, None)
    if not profile:
        return False
    if password_hash:
        profile["password_hash"] = password_hash
        profile["password_set_at"] = _now()
    else:
        profile.pop("password_hash", None)
        profile.pop("password_set_at", None)
    _write_json(path, profile)
    return True


def delete_user(uid: str) -> bool:
    """Remove a user's profile, conversations and workspaces from disk."""
    profile = get_user(uid)
    if not profile:
        return False
    idx = load_index()
    idx.pop(str(profile.get("email", "")).lower(), None)
    _write_json(USERS_INDEX, idx)
    shutil.rmtree(user_dir(uid), ignore_errors=True)
    return True


def list_users() -> list[dict]:
    """Every registered account with its live usage (for the admin table)."""
    idx = load_index()
    out: list[dict] = []
    for _email, entry in idx.items():
        uid = entry.get("uid")
        if not uid:
            continue
        profile = get_user(uid)
        if not profile:
            continue
        out.append({
            "uid": uid,
            "email": profile.get("email"),
            "name": profile.get("name"),
            "created_at": profile.get("created_at"),
            "last_login": profile.get("last_login"),
            "quota_bytes": int(profile.get("quota_bytes") or cfg.CONFIG["quota_bytes"]),
            "has_password": bool(profile.get("password_hash")),
            "model_allowed": profile.get("model_allowed"),
            "is_admin": is_admin(profile),
            "conversation_count": len(list_conversations(uid)),
            "usage": usage(uid),
        })
    out.sort(key=lambda x: x.get("created_at") or 0)
    return out


def all_conversations(uid: str) -> list[dict]:
    """Admin view: conversation summaries for an arbitrary user."""
    return list_conversations(uid)


def total_users() -> int:
    return len(load_index())


def set_user_model_allowed(uid: str, allowed: list[str] | None) -> None:
    """Per-user model allow-list.

    ``None`` = all globally-enabled models; ``[]`` = fully suspended;
    ``["qwen3.5:0.8b"]`` = only that model. Intersected with the admin's
    global ``enabled`` flag when a model is chosen at call time.
    """
    p_path = user_dir(uid) / "profile.json"
    profile = _read_json(p_path, None)
    if profile is None:
        raise KeyError(uid)
    profile["model_allowed"] = list(allowed) if allowed is not None else None
    _write_json(p_path, profile)


def user_model_allowed(uid: str, model_name: str) -> bool:
    profile = get_user(uid) or {}
    allowed = profile.get("model_allowed")
    if allowed is None:
        return True
    return model_name in allowed
