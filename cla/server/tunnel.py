"""ngrok tunnel lifecycle + live-URL watcher.

Starts ``ngrok http <port>`` with the configured authtoken and polls its local
admin API (127.0.0.1:4040). Whenever the public URL changes (free tier rotates
it), the new URL is pushed to GitHub so the Pages frontend reconnects.
"""
from __future__ import annotations

import asyncio
import json
import os
import shutil
import subprocess
from pathlib import Path

import httpx

from . import config as cfg
from . import github_sync


class Tunnel:
    def __init__(self) -> None:
        self.url: str | None = None
        self.proc: subprocess.Popen | None = None
        self._task: asyncio.Task | None = None

    # ------------------------------------------------------------------ #
    def binary(self) -> str | None:
        exe = cfg.BIN_DIR / ("ngrok.exe" if os.name == "nt" else "ngrok")
        if exe.exists():
            return str(exe)
        return shutil.which("ngrok")

    def available(self) -> bool:
        return bool(self.binary() and cfg.CONFIG["ngrok"].get("token"))

    # ------------------------------------------------------------------ #
    def start(self, port: int) -> None:
        if not self.available():
            print("[tunnel] ngrok 不可用或未配置 token，跳过。")
            return
        exe = self.binary()
        token = cfg.CONFIG["ngrok"]["token"]
        try:
            subprocess.run([exe, "config", "add-authtoken", token],
                           capture_output=True, timeout=30)
        except Exception as exc:  # noqa: BLE001
            print(f"[tunnel] authtoken 配置失败: {exc}")

        cmd = [exe, "http", str(port), "--log", "stdout"]
        domain = cfg.CONFIG["ngrok"].get("domain")
        if domain:
            cmd += ["--domain", domain]
        creationflags = subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0
        self.proc = subprocess.Popen(
            cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
            creationflags=creationflags,
        )
        print(f"[tunnel] ngrok started for port {port}")
        self._task = asyncio.create_task(self._watch())

    async def _watch(self) -> None:
        last = None
        for _ in range(240):                       # ~20 min of polling then idle
            await asyncio.sleep(5)
            url = await self._query()
            if url and url != last:
                last = url
                self.url = url
                print(f"[tunnel] public url: {url}")
                await github_sync.push_runtime_config(url)
        # keep watching slowly forever
        while True:
            await asyncio.sleep(60)
            url = await self._query()
            if url and url != last:
                last = url
                self.url = url
                print(f"[tunnel] public url changed: {url}")
                await github_sync.push_runtime_config(url)

    async def _query(self) -> str | None:
        try:
            async with httpx.AsyncClient(timeout=5) as c:
                r = await c.get("http://127.0.0.1:4040/api/tunnels")
                for t in r.json().get("tunnels", []):
                    if t.get("public_url", "").startswith("https"):
                        return t["public_url"]
        except Exception:
            return None
        return None

    def stop(self) -> None:
        if self._task:
            self._task.cancel()
        if self.proc:
            self.proc.terminate()


TUNNEL = Tunnel()