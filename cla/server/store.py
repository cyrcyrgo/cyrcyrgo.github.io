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


def touch_login(uid: str, ip: str = "") -> None:
    p = user_dir(uid) / "profile.json"
    profile = _read_json(p, None)
    if profile:
        now = _now()
        profile["last_login"] = now
        hist = profile.get("login_history") or []
        hist.append({"at": now, "ip": (ip or "")[:64]})
        profile["login_history"] = hist[-30:]
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


def set_quota(uid: str, quota_bytes: int, custom: bool = True) -> bool:
    """Set a user's quota. ``custom=True`` marks it as an explicit admin
    decision (or an approved application), so base-quota migrations skip it."""
    path = user_dir(uid) / "profile.json"
    profile = _read_json(path, None)
    if not profile:
        return False
    profile["quota_bytes"] = max(int(quota_bytes), 0)
    if custom:
        profile["quota_custom"] = True
    _write_json(path, profile)
    return True


_OLD_DEFAULT_QUOTA = 1024 * 1024 * 1024


def migrate_quotas(base_quota: int) -> int:
    """One-time migration: bring every non-customized account from the old
    1 GB default down to the new base quota. Returns how many profiles changed."""
    changed = 0
    idx = load_index()
    for entry in idx.values():
        uid = entry.get("uid")
        if not uid:
            continue
        p = user_dir(uid) / "profile.json"
        profile = _read_json(p, None)
        if not profile or profile.get("quota_custom"):
            continue
        if int(profile.get("quota_bytes") or 0) == _OLD_DEFAULT_QUOTA:
            profile["quota_bytes"] = int(base_quota)
            _write_json(p, profile)
            changed += 1
    return changed


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


# --------------------------------------------------------------------------- #
# user profile edits (served by the user-facing settings panel)
# --------------------------------------------------------------------------- #
MAX_AVATAR_CHARS = 400_000        # ~300 KB image as a data URI


def update_profile(uid: str, name: str | None = None,
                   avatar: str | None = None) -> dict | None:
    """Update nickname / avatar. Returns the refreshed profile (None if missing)."""
    path = user_dir(uid) / "profile.json"
    profile = _read_json(path, None)
    if not profile:
        return None
    if name is not None:
        clean = " ".join(str(name).split())[:32]
        if clean:
            profile["name"] = clean
    if avatar is not None:
        if avatar == "":
            profile.pop("avatar", None)
        else:
            if len(avatar) > MAX_AVATAR_CHARS:
                raise ValueError("头像图片过大（请选择 300KB 以内的图片）")
            if not str(avatar).startswith("data:image/"):
                raise ValueError("头像格式不支持")
            profile["avatar"] = avatar
    _write_json(path, profile)
    return profile


def change_email(uid: str, new_email: str) -> tuple[bool, str]:
    """Move a user to a new email address (index + profile kept in sync)."""
    new_email = new_email.strip().lower()
    profile = get_user(uid)
    if not profile:
        return False, "用户不存在"
    if "@" not in new_email or len(new_email) < 5:
        return False, "邮箱格式不正确"
    old_email = str(profile.get("email", "")).lower()
    if new_email == old_email:
        return False, "新邮箱与当前邮箱相同"
    idx = load_index()
    if new_email in idx and idx[new_email].get("uid") != uid:
        return False, "该邮箱已被其他账号使用"
    idx.pop(old_email, None)
    idx[new_email] = {"uid": uid, "created_at": profile.get("created_at") or _now()}
    profile["email"] = new_email
    profile["email_changed_at"] = _now()
    _write_json(user_dir(uid) / "profile.json", profile)
    _write_json(USERS_INDEX, idx)
    return True, ""


# --------------------------------------------------------------------------- #
# user feedback (「向作者反馈」) — admins review it in the dashboard
# --------------------------------------------------------------------------- #
FEEDBACK_DIR = cfg.DATA_DIR / "feedback"


def _feedback_path(fid: str) -> Path:
    return FEEDBACK_DIR / f"{fid}.json"


def add_feedback(uid: str, email: str, category: str, content: str,
                 target: str = "admin") -> dict:
    FEEDBACK_DIR.mkdir(parents=True, exist_ok=True)
    fid = uuid.uuid4().hex[:12]
    item = {
        "id": fid,
        "uid": uid,
        "email": email,
        "name": (get_user(uid) or {}).get("name") or "",
        "category": (category or "其他").strip()[:24],
        "content": content.strip()[:4000],
        "target": target if target in ("email", "admin") else "admin",
        "created_at": _now(),
        "status": "new",          # new | read | done
        "revoked": False,
        "replies": [],
    }
    _write_json(_feedback_path(fid), item)
    return item


def last_feedback_time(uid: str) -> float:
    times = [f.get("created_at", 0) for f in list_feedback() if f.get("uid") == uid]
    return max(times) if times else 0.0


def list_feedback_for_user(uid: str) -> list[dict]:
    return [f for f in list_feedback() if f.get("uid") == uid]


def revoke_feedback(fid: str, uid: str) -> bool:
    """Only backend-target (never emailed) feedback can be revoked."""
    p = _feedback_path(fid)
    item = _read_json(p, None)
    if (not item or item.get("uid") != uid
            or item.get("target") == "email" or item.get("revoked")):
        return False
    item["revoked"] = True
    item["status"] = "revoked"
    _write_json(p, item)
    return True


def add_feedback_reply(fid: str, content: str, via_email: bool,
                       via_notice: bool, author: str) -> dict | None:
    p = _feedback_path(fid)
    item = _read_json(p, None)
    if not item:
        return None
    reply = {
        "id": uuid.uuid4().hex[:10],
        "content": content.strip()[:4000],
        "via_email": bool(via_email),
        "via_notice": bool(via_notice),
        "author": (author or "管理员").strip()[:120],
        "created_at": _now(),
    }
    item.setdefault("replies", []).append(reply)
    item["status"] = "done"
    _write_json(p, item)
    return reply


def list_feedback() -> list[dict]:
    if not FEEDBACK_DIR.exists():
        return []
    out = []
    for p in FEEDBACK_DIR.glob("*.json"):
        item = _read_json(p, None)
        if item:
            out.append(item)
    out.sort(key=lambda x: x.get("created_at") or 0, reverse=True)
    return out


def get_feedback(fid: str) -> dict | None:
    return _read_json(_feedback_path(fid), None)


def update_feedback(fid: str, status: str) -> bool:
    p = _feedback_path(fid)
    item = _read_json(p, None)
    if not item:
        return False
    item["status"] = status if status in ("new", "read", "done") else "read"
    _write_json(p, item)
    return True


def delete_feedback(fid: str) -> bool:
    p = _feedback_path(fid)
    if p.exists():
        p.unlink()
        return True
    return False


def feedback_unread() -> int:
    return sum(1 for f in list_feedback() if f.get("status") == "new")


def update_feedback_email(fid: str, status: str, error: str = "") -> bool:
    """Record whether the feedback was forwarded to the author mailbox."""
    p = _feedback_path(fid)
    item = _read_json(p, None)
    if not item:
        return False
    item["email_status"] = status          # sent | failed | skipped
    item["email_error"] = error[:300]
    _write_json(p, item)
    return True


# --------------------------------------------------------------------------- #
# cloud-space expansion requests (user applies -> admin approves/rejects)
# --------------------------------------------------------------------------- #
QUOTA_REQ_DIR = cfg.DATA_DIR / "quota_requests"


def _qreq_path(rid: str) -> Path:
    return QUOTA_REQ_DIR / f"{rid}.json"


def create_quota_request(uid: str, request_bytes: int, reason: str) -> dict:
    QUOTA_REQ_DIR.mkdir(parents=True, exist_ok=True)
    profile = get_user(uid) or {}
    # Only one pending request per user: supersede the previous pending one.
    for item in list_quota_requests():
        if item.get("uid") == uid and item.get("status") == "pending":
            _qreq_path(item["id"]).unlink(missing_ok=True)
    rid = uuid.uuid4().hex[:12]
    item = {
        "id": rid,
        "uid": uid,
        "email": profile.get("email", ""),
        "name": profile.get("name", ""),
        "request_bytes": int(request_bytes),
        "current_bytes": int(profile.get("quota_bytes") or cfg.CONFIG["quota_bytes"]),
        "reason": reason.strip()[:1000],
        "status": "pending",               # pending | approved | rejected
        "created_at": _now(),
        "decided_at": None,
        "note": "",
    }
    _write_json(_qreq_path(rid), item)
    return item


def get_quota_request(rid: str) -> dict | None:
    return _read_json(_qreq_path(rid), None)


def list_quota_requests(status: str | None = None) -> list[dict]:
    if not QUOTA_REQ_DIR.exists():
        return []
    out = []
    for p in QUOTA_REQ_DIR.glob("*.json"):
        item = _read_json(p, None)
        if item and (status is None or item.get("status") == status):
            out.append(item)
    out.sort(key=lambda x: (x.get("status") != "pending",
                            -(x.get("created_at") or 0)))
    return out


def latest_quota_request(uid: str) -> dict | None:
    items = [q for q in list_quota_requests() if q.get("uid") == uid]
    return items[0] if items else None


def decide_quota_request(rid: str, approve: bool, note: str = "",
                         duration_seconds: int | None = None) -> dict | None:
    """Approve/reject a quota *adjustment* request.

    On approval the quota is changed to ``request_bytes``. When
    ``duration_seconds`` is given (>=30s), the change is temporary:
    ``expire_at`` is recorded and a background job restores
    ``revert_bytes`` (the quota in effect before the first still-active
    temporary adjustment) once it passes. ``None`` means permanent.
    """
    item = get_quota_request(rid)
    if not item or item.get("status") != "pending":
        return None
    item["status"] = "approved" if approve else "rejected"
    item["decided_at"] = _now()
    item["note"] = (note or "").strip()[:300]
    if approve:
        profile = get_user(item["uid"]) or {}
        current = int(profile.get("quota_bytes") or cfg.CONFIG["quota_bytes"])
        # If another temporary adjustment is still active for this user, keep
        # its original revert target so chains always restore the real base.
        revert_bytes = current
        for older in list_quota_requests():
            if (older.get("uid") == item["uid"]
                    and older.get("status") == "approved"
                    and not older.get("reverted")
                    and older.get("expire_at")):
                revert_bytes = int(older.get("revert_bytes", current))
                older["status"] = "superseded"
                older["reverted"] = True
                _write_json(_qreq_path(older["id"]), older)
                break
        item["revert_bytes"] = revert_bytes
        item["permanent"] = not bool(duration_seconds)
        item["expire_at"] = (_now() + int(duration_seconds)
                             if duration_seconds else None)
        item["reverted"] = False
        set_quota(item["uid"], item["request_bytes"], custom=True)
    _write_json(_qreq_path(rid), item)
    return item


def list_due_quota_reverts(now: float | None = None) -> list[dict]:
    """Approved temporary adjustments whose deadline has passed."""
    now = now if now is not None else _now()
    out = []
    for q in list_quota_requests():
        if (q.get("status") == "approved" and not q.get("reverted")
                and q.get("expire_at") and q["expire_at"] <= now):
            out.append(q)
    return out


def revert_quota_request(rid: str) -> dict | None:
    """Restore the quota captured before a temporary adjustment."""
    item = get_quota_request(rid)
    if not item or item.get("status") != "approved" or item.get("reverted"):
        return None
    target = int(item.get("revert_bytes", cfg.CONFIG["quota_bytes"]))
    profile = get_user(item["uid"])
    if profile:
        profile["quota_bytes"] = target
        # Restoring the factory base clears the "custom" marker so future
        # base-quota migrations still apply to this account.
        profile["quota_custom"] = target != int(cfg.CONFIG["quota_bytes"])
        _write_json(user_dir(item["uid"]) / "profile.json", profile)
    item["status"] = "expired"
    item["reverted"] = True
    item["reverted_at"] = _now()
    _write_json(_qreq_path(rid), item)
    return item


def quota_requests_unread() -> int:
    return sum(1 for q in list_quota_requests("pending"))


# --------------------------------------------------------------------------- #
# site notifications / announcements — full history, admins manage it
# --------------------------------------------------------------------------- #
NOTICE_DIR = cfg.DATA_DIR / "notifications"


def _notice_path(nid: str) -> Path:
    return NOTICE_DIR / f"{nid}.json"


def create_notice(title: str, body: str, author: str) -> dict:
    NOTICE_DIR.mkdir(parents=True, exist_ok=True)
    now = _now()
    item = {
        "id": uuid.uuid4().hex[:12],
        "title": title.strip()[:200],
        "body": body.strip()[:5000],
        "author": (author or "").strip()[:120],
        "created_at": now,
        "updated_at": now,
    }
    _write_json(_notice_path(item["id"]), item)
    return item


def get_notice(nid: str) -> dict | None:
    return _read_json(_notice_path(nid), None)


def list_notices() -> list[dict]:
    if not NOTICE_DIR.exists():
        return []
    out = []
    for p in NOTICE_DIR.glob("*.json"):
        item = _read_json(p, None)
        if item:
            out.append(item)
    out.sort(key=lambda x: x.get("updated_at") or x.get("created_at") or 0,
             reverse=True)
    return out


def update_notice(nid: str, title: str, body: str) -> dict | None:
    item = get_notice(nid)
    if not item:
        return None
    item["title"] = title.strip()[:200]
    item["body"] = body.strip()[:5000]
    item["updated_at"] = _now()
    _write_json(_notice_path(nid), item)
    return item


def delete_notice(nid: str) -> bool:
    p = _notice_path(nid)
    if p.exists():
        p.unlink()
        return True
    return False


# --------------------------------------------------------------------------- #
# per-user service notifications (e.g. admin replies delivered in-app)
# --------------------------------------------------------------------------- #
USER_NOTICE_DIR = cfg.DATA_DIR / "user_notifications"


def _user_notice_dir(uid: str) -> Path:
    d = USER_NOTICE_DIR / uid
    d.mkdir(parents=True, exist_ok=True)
    return d


def create_user_notice(uid: str, title: str, body: str,
                       author: str = "管理员", kind: str = "admin_reply",
                       ref_id: str = "") -> dict:
    item = {
        "id": uuid.uuid4().hex[:12],
        "uid": uid,
        "title": title.strip()[:200],
        "body": body.strip()[:5000],
        "author": (author or "管理员").strip()[:120],
        "kind": kind,
        "ref_id": ref_id,
        "read": False,
        "created_at": _now(),
    }
    _write_json(_user_notice_dir(uid) / f"{item['id']}.json", item)
    return item


def list_user_notices(uid: str) -> list[dict]:
    d = _user_notice_dir(uid)
    out = [it for p in d.glob("*.json")
           if (it := _read_json(p, None))]
    out.sort(key=lambda x: x.get("created_at", 0), reverse=True)
    return out


def unread_user_notices(uid: str) -> int:
    return sum(1 for n in list_user_notices(uid) if not n.get("read"))


def mark_user_notices_read(uid: str) -> None:
    for n in list_user_notices(uid):
        if not n.get("read"):
            n["read"] = True
            _write_json(_user_notice_dir(uid) / f"{n['id']}.json", n)


# --------------------------------------------------------------------------- #
# quick-reply templates (admin manages them)
# --------------------------------------------------------------------------- #
TEMPLATE_FILE = cfg.DATA_DIR / "reply_templates.json"


def list_reply_templates() -> list[dict]:
    return _read_json(TEMPLATE_FILE, []) or []


def save_reply_templates(items: list[dict]) -> None:
    cleaned = []
    for t in items:
        title = (t.get("title") or "").strip()[:100]
        body = (t.get("body") or "").strip()[:4000]
        if title or body:
            cleaned.append({
                "id": t.get("id") or uuid.uuid4().hex[:10],
                "title": title, "body": body,
                "created_at": t.get("created_at") or _now(),
            })
    _write_json(TEMPLATE_FILE, cleaned)


def add_reply_template(title: str, body: str) -> dict:
    items = list_reply_templates()
    item = {"id": uuid.uuid4().hex[:10], "title": title.strip()[:100],
            "body": body.strip()[:4000], "created_at": _now()}
    items.append(item)
    save_reply_templates(items)
    return item


def delete_reply_template(tid: str) -> bool:
    items = list_reply_templates()
    nxt = [t for t in items if t.get("id") != tid]
    if len(nxt) == len(items):
        return False
    save_reply_templates(nxt)
    return True


# --------------------------------------------------------------------------- #
# login security state — server-side timing only (survives client refresh)
# --------------------------------------------------------------------------- #
AUTH_STATE_DIR = cfg.DATA_DIR / "auth_state"


def _auth_state_path(email: str) -> Path:
    AUTH_STATE_DIR.mkdir(parents=True, exist_ok=True)
    import hashlib
    key = hashlib.sha256(email.lower().encode("utf-8")).hexdigest()[:24]
    return AUTH_STATE_DIR / f"{key}.json"


def get_auth_state(email: str) -> dict:
    return _read_json(_auth_state_path(email), {}) or {}


def set_auth_state(email: str, state: dict) -> None:
    _write_json(_auth_state_path(email), state)


def reset_auth_state(email: str) -> None:
    p = _auth_state_path(email)
    if p.exists():
        p.unlink()


# --------------------------------------------------------------------------- #
# account unfreeze requests with auto-scored usage-trace questionnaire
# --------------------------------------------------------------------------- #
UNFREEZE_DIR = cfg.DATA_DIR / "unfreeze"


def _unfreeze_path(rid: str) -> Path:
    return UNFREEZE_DIR / f"{rid}.json"


def supersede_open_unfreeze(email: str) -> None:
    """Mark every still-open request of this account as superseded.

    Called when a NEW freeze episode starts, so a request from a previous
    freeze can never be reused or counted as the one allowed submission of the
    current freeze.
    """
    for q in list_unfreeze():
        if q.get("email", "").lower() == email.lower() and q.get("status") == "open":
            q["status"] = "superseded"
            _write_json(_unfreeze_path(q["id"]), q)


def create_unfreeze(email: str, uid: str, reason: str, answers: dict,
                    score: float, matched: list, missed: list,
                    freeze_id: str = "", auto_denied: bool = False) -> dict:
    UNFREEZE_DIR.mkdir(parents=True, exist_ok=True)
    item = {
        "id": uuid.uuid4().hex[:12],
        "email": email,
        "uid": uid,
        "freeze_id": freeze_id,
        "reason": reason.strip()[:1000],
        "answers": {k: str(v)[:300] for k, v in (answers or {}).items()},
        "score": round(score, 1),
        "matched": matched,
        "missed": missed,
        "auto_denied": bool(auto_denied),
        "status": "open",            # open | approved | denied | pin_unlocked | superseded
        "pin": "",
        "pin_sent_at": None,
        "created_at": _now(),
        "decided_at": None,
        "decided_by": "",
    }
    _write_json(_unfreeze_path(item["id"]), item)
    return item


def get_unfreeze(rid: str) -> dict | None:
    return _read_json(_unfreeze_path(rid), None)


def list_unfreeze() -> list[dict]:
    if not UNFREEZE_DIR.exists():
        return []
    out = [it for p in UNFREEZE_DIR.glob("*.json")
           if (it := _read_json(p, None))]
    out.sort(key=lambda x: (x.get("status") != "open", -x.get("created_at", 0)))
    return out


def unfreeze_pending() -> int:
    return sum(1 for q in list_unfreeze() if q.get("status") == "open")


def save_unfreeze(item: dict) -> None:
    _write_json(_unfreeze_path(item["id"]), item)


def open_unfreeze_for_email(email: str) -> dict | None:
    for q in list_unfreeze():
        if q.get("email", "").lower() == email.lower() and q.get("status") == "open":
            return q
    return None
