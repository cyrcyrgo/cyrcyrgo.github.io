"""cpolar tunnel lifecycle + live-URL watcher.

Spawns ``cpolar http <port>`` (authtoken taken from config / its own yml),
reads its stdout and extracts the public HTTPS URL from lines like::

    Tunnel established at https://36fb8229.r9.cpolar.cn

Whenever a URL is seen (free tier rotates it on every start), it is pushed
to GitHub so the Pages frontend can reconnect.

Note: cpolar 3.3.x serves a web UI on 127.0.0.1:4040 but its
``/api/tunnels`` returns an empty body, so we parse stdout instead.
"""
from __future__ import annotations

import asyncio
import os
import re
import shutil
import subprocess

from . import config as cfg
from . import github_sync

# e.g. https://36fb8229.r9.cpolar.cn / https://ab-cd.r2.cpolar.com
_URL_RE = re.compile(r"https://[0-9a-z][0-9a-z.-]*\.cpolar\.[a-z.]+")
_PUSH_ATTEMPTS = 5


class Tunnel:
    def __init__(self) -> None:
        self.url: str | None = None
        self.pushed: bool = False
        self.proc: subprocess.Popen | None = None
        self._task: asyncio.Task | None = None
        self._heartbeat: asyncio.Task | None = None

    # ------------------------------------------------------------------ #
    def binary(self) -> str | None:
        exe = cfg.BIN_DIR / "cpolar" / ("cpolar.exe" if os.name == "nt" else "cpolar")
        if exe.exists():
            return str(exe)
        return shutil.which("cpolar")

    def available(self) -> bool:
        return bool(self.binary())

    # ------------------------------------------------------------------ #
    def start(self, port: int) -> None:
        exe = self.binary()
        if not exe:
            print("[tunnel] 未找到 cpolar，跳过内网穿透。")
            return
        token = (cfg.CONFIG.get("cpolar") or {}).get("authtoken", "")
        if token:
            try:
                subprocess.run([exe, "authtoken", token],
                               capture_output=True, timeout=30)
            except Exception as exc:  # noqa: BLE001
                print(f"[tunnel] authtoken 配置失败: {exc}")

        creationflags = subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0
        self.proc = subprocess.Popen(
            [exe, "http", str(port), "-log", "stdout", "-log-level", "INFO"],
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            encoding="utf-8",
            errors="replace",
            bufsize=1,
            creationflags=creationflags,
        )
        print(f"[tunnel] cpolar started for port {port}")
        self._task = asyncio.create_task(self._watch())
        self._heartbeat = asyncio.create_task(self._heartbeat_loop())

    async def _heartbeat_loop(self) -> None:
        """Re-push the known URL every 10 min.

        The URL only changes on restart, but the boot-time push can be lost
        to a transient network/GitHub failure; without this the Pages
        frontend would keep a dead tunnel address until the next reboot.
        """
        while True:
            await asyncio.sleep(600)
            if self.url:
                try:
                    await github_sync.push_runtime_config(self.url)
                except Exception as exc:  # noqa: BLE001
                    print(f"[tunnel] heartbeat push failed: {exc}")

    async def _watch(self) -> None:
        if not self.proc or not self.proc.stdout:
            return
        loop = asyncio.get_running_loop()
        last: str | None = None
        while True:
            # blocking readline -> executor thread
            line = await loop.run_in_executor(None, self.proc.stdout.readline)
            if not line:
                if self.proc.poll() is not None:
                    print("[tunnel] cpolar 进程已退出。")
                    return
                await asyncio.sleep(2)
                continue
            m = _URL_RE.search(line)
            if not m:
                continue
            url = m.group(0)
            if url == last:
                continue
            last = url
            self.url = url
            print(f"[tunnel] public url: {url}")
            await self._push(url)

    async def _push(self, url: str) -> None:
        """Publish the tunnel URL to GitHub, retrying transient failures."""
        self.pushed = False
        for attempt in range(1, _PUSH_ATTEMPTS + 1):
            try:
                if await github_sync.push_runtime_config(url):
                    self.pushed = True
                    print(f"[tunnel] 域名已推送至 GitHub: {url}")
                    return
            except Exception as exc:  # noqa: BLE001
                print(f"[tunnel] config push failed ({attempt}/{_PUSH_ATTEMPTS}): {exc}")
            await asyncio.sleep(min(30, 5 * attempt))
        print("[tunnel] config push gave up; will retry when the url changes")

    def stop(self) -> None:
        if self._task:
            self._task.cancel()
        if self._heartbeat:
            self._heartbeat.cancel()
        if self.proc:
            self.proc.terminate()


TUNNEL = Tunnel()
