"""Publish WebGPU model weights as GitHub Release assets (files up to 2 GB).

The offline client downloads these through GitHub accelerator mirrors, so the
local API server never has to relay weights. Asset names are FLAT — the
client maps each model file (config/tokenizer/onnx weights) to the asset.

Usage:
    python scripts/publish_weights.py qwen25-05b
"""
from __future__ import annotations

import asyncio
import sys
from pathlib import Path

import httpx

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from server import config as cfg  # noqa: E402
from server import github_sync  # noqa: E402

API = "https://api.github.com"
UPLOAD = "https://uploads.github.com"

RELEASES = {
    "qwen25-05b": {
        "tag": "weights-qwen2.5-0.5b-v1",
        "stage": ROOT / "data" / "gh_weights" / "qwen25-05b",
        "assets": [
            "config.json",
            "generation_config.json",
            "tokenizer.json",
            "tokenizer_config.json",
            "special_tokens_map.json",
            "vocab.json",
            "merges.txt",
            "model_q4f16.onnx",
            "model_q4.onnx",
        ],
    },
}


def _headers() -> dict:
    return github_sync._headers()


async def _ensure_release(client: httpx.AsyncClient, repo: str, tag: str) -> int:
    r = await client.get(f"{API}/repos/{repo}/releases/tags/{tag}", headers=_headers())
    if r.status_code == 200:
        return r.json()["id"]
    if r.status_code != 404:
        raise RuntimeError(f"release 查询失败 {r.status_code}: {r.text[:200]}")
    r = await client.post(
        f"{API}/repos/{repo}/releases",
        headers=_headers(),
        json={
            "tag_name": tag,
            "name": f"WebGPU weights {tag}",
            "body": "transformers.js (Qwen2.5) 离线模型权重，供浏览器端经加速镜像下载。",
            "draft": False,
            "prerelease": False,
        },
    )
    if r.status_code >= 400:
        raise RuntimeError(f"release 创建失败 {r.status_code}: {r.text[:300]}")
    return r.json()["id"]


async def _delete_existing(client: httpx.AsyncClient, repo: str,
                           release_id: int, name: str) -> None:
    r = await client.get(f"{API}/repos/{repo}/releases/{release_id}/assets",
                         headers=_headers(),
                         params={"per_page": 100})
    for a in r.json():
        if a["name"] == name:
            d = await client.delete(f"{API}/repos/{repo}/releases/assets/{a['id']}",
                                    headers=_headers())
            print(f"  deleted old asset {name} ({d.status_code})")


async def _file_aiter(path: Path, chunk: int = 2 * 1024 * 1024):
    with path.open("rb") as fh:
        while True:
            data = await asyncio.to_thread(fh.read, chunk)
            if not data:
                break
            yield data


async def _upload(client: httpx.AsyncClient, repo: str, release_id: int,
                  path: Path, name: str) -> None:
    await _delete_existing(client, repo, release_id, name)
    total = path.stat().st_size
    size_mb = total / 1048576
    print(f"uploading {name} ({size_mb:.1f} MB) …", flush=True)
    headers = _headers()
    headers["Content-Type"] = "application/octet-stream"
    headers["Content-Length"] = str(total)
    r = await client.post(
        f"{UPLOAD}/repos/{repo}/releases/{release_id}/assets",
        headers=headers,
        params={"name": name},
        content=_file_aiter(path),
        timeout=httpx.Timeout(3600.0, connect=60.0),
    )
    if r.status_code >= 400:
        raise RuntimeError(f"{name} 上传失败 {r.status_code}: {r.text[:300]}")
    print(f"  ok -> {r.json()['browser_download_url']}", flush=True)


async def main() -> None:
    key = sys.argv[1] if len(sys.argv) > 1 else "qwen25-05b"
    spec = RELEASES[key]
    g = cfg.load()["github"]
    repo = g["repo"]
    async with httpx.AsyncClient(follow_redirects=True) as client:
        release_id = await _ensure_release(client, repo, spec["tag"])
        for name in spec["assets"]:
            # weights live under onnx/ in the staging tree; release assets
            # are flat so the file is mapped by the client explicitly.
            p = spec["stage"] / name
            if not p.exists():
                p = spec["stage"] / "onnx" / name
            if not p.exists():
                print(f"[skip] missing {name}")
                continue
            await _upload(client, repo, release_id, p, name)
    print("done:", spec["tag"])


if __name__ == "__main__":
    asyncio.run(main())
