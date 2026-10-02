"""GitHub REST API helpers: publish files + push the live tunnel URL."""
from __future__ import annotations

import base64
import json
import time
from pathlib import Path

import httpx

from . import config as cfg

API = "https://api.github.com"


def _gh() -> dict:
    g = cfg.CONFIG["github"]
    if not g.get("token"):
        raise RuntimeError("GitHub token 未配置")
    return g


def _headers() -> dict:
    return {
        "Authorization": f"Bearer {_gh()['token']}",
        "Accept": "application/vnd.github+json",
        "User-Agent": "yjs-llm-agent",
        "X-GitHub-Api-Version": "2022-11-28",
    }


def repo_path(rel: str) -> str:
    prefix = _gh().get("path_prefix", "").strip("/")
    rel = rel.replace("\\", "/").lstrip("/")
    return f"{prefix}/{rel}" if prefix else rel


def _excluded(rel: str, excludes: tuple[str, ...]) -> bool:
    """True if ``rel`` (posix, relative) is an excluded file or lives under an
    excluded directory -- matching at ANY depth, e.g. server/__pycache__/x.pyc."""
    segs = rel.split("/")
    for e in excludes:
        e = e.strip("/")
        if not e:
            continue
        if rel == e or rel.startswith(e + "/"):
            return True
        if e in segs:
            return True
    return False


async def get_sha(path_in_repo: str) -> str | None:
    g = _gh()
    url = f"{API}/repos/{g['repo']}/contents/{path_in_repo}?ref={g['branch']}"
    async with httpx.AsyncClient(timeout=30) as c:
        r = await c.get(url, headers=_headers())
        if r.status_code == 200:
            data = r.json()
            if isinstance(data, dict):
                return data.get("sha")
        return None


async def put_file(rel_or_repo_path: str, content: bytes, message: str,
                   already_in_repo: bool = False) -> dict:
    g = _gh()
    path_in_repo = rel_or_repo_path if already_in_repo else repo_path(rel_or_repo_path)
    sha = await get_sha(path_in_repo)
    body = {
        "message": message,
        "content": base64.b64encode(content).decode("ascii"),
        "branch": g["branch"],
    }
    if sha:
        body["sha"] = sha
    url = f"{API}/repos/{g['repo']}/contents/{path_in_repo}"
    async with httpx.AsyncClient(timeout=60) as c:
        r = await c.put(url, headers=_headers(), json=body)
        if r.status_code not in (200, 201):
            raise RuntimeError(f"GitHub 上传失败 {r.status_code}: {r.text[:300]}")
        return r.json()


async def list_repo_paths(rel_prefix: str = "") -> list[str]:
    """List blob paths in the repo, optionally under ``rel_prefix``."""
    g = _gh()
    full = repo_path(rel_prefix).rstrip("/") if rel_prefix else ""
    async with httpx.AsyncClient(timeout=60) as c:
        r = await c.get(
            f"{API}/repos/{g['repo']}/git/trees/{g['branch']}?recursive=1",
            headers=_headers(),
        )
        tree = r.json().get("tree", [])
    return [
        x["path"] for x in tree
        if x.get("type") == "blob"
        and (not full or x["path"] == full or x["path"].startswith(full + "/"))
    ]


async def delete_prefix(rel_prefix: str) -> int:
    """Delete every repo file under ``rel_prefix``. Returns the count removed."""
    removed = 0
    for p in await list_repo_paths(rel_prefix):
        sha = await get_sha(p)
        if not sha:
            continue
        async with httpx.AsyncClient(timeout=60) as c:
            r = await c.request(
                "DELETE",
                f"{API}/repos/{_gh()['repo']}/contents/{p}",
                headers=_headers(),
                json={"message": f"chore: remove {p}", "sha": sha, "branch": _gh()["branch"]},
            )
            if r.status_code in (200, 201):
                removed += 1
    return removed


async def publish_tree(root: Path, excludes: tuple[str, ...] = ()) -> list[str]:
    """Upload every non-excluded file under *root* into the repo prefix."""
    uploaded = []
    root = root.resolve()
    for p in sorted(root.rglob("*")):
        if not p.is_file():
            continue
        rel = p.relative_to(root).as_posix()
        if _excluded(rel, excludes):
            continue
        try:
            await put_file(rel, p.read_bytes(), f"publish: {rel}")
            uploaded.append(rel)
        except Exception as exc:  # noqa: BLE001
            print(f"[publish] {rel} failed: {exc}")
    return uploaded


# --------------------------------------------------------------------------- #
# runtime config (the live API URL the frontend reads)
# --------------------------------------------------------------------------- #
def write_local_config(api_url: str) -> Path:
    payload = {
        "api_url": api_url,
        "model": cfg.CONFIG["model"],
        "updated_at": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
    }
    cfg.PUBLIC_CONFIG.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    return cfg.PUBLIC_CONFIG


async def push_runtime_config(api_url: str) -> bool:
    """Write config.json locally and publish it so the Pages frontend finds the tunnel."""
    path = write_local_config(api_url)
    try:
        await put_file("config.json", path.read_bytes(),
                       f"chore: update tunnel url -> {api_url}")
        print(f"[github] config.json updated: {api_url}")
        return True
    except Exception as exc:  # noqa: BLE001
        print(f"[github] config.json push failed: {exc}")
        return False