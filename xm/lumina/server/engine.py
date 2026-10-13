"""Local inference engine: manage ``llama-server`` (llama.cpp) instances.

llama.cpp is a one-model-per-process server: each instance loads a single GGUF
at startup and binds its own port (OpenAI-compatible ``/v1``). We start
instances lazily on first use, keep them warm for a while, and evict the
least-recently-used instance when the resident cap is exceeded — a single
consumer GPU cannot hold every model resident at once.
"""
from __future__ import annotations

import atexit
import asyncio
import os
import subprocess
import time
from pathlib import Path

import httpx

from . import config as cfg

EXE_DIR = cfg.BIN_DIR / "llama"
EXE = EXE_DIR / ("llama-server.exe" if os.name == "nt" else "llama-server")
LOG_DIR = cfg.RUNTIME_DIR / "engine"


def _gpu_backend() -> tuple[str, str]:
    """Locate the shipped GPU backend DLL and its directory.

    The Windows llama.cpp build ships GPU backends in versioned subfolders
    (Ollama layout) rather than next to the executable, so they are not
    auto-discovered. Prefer CUDA 12, then CUDA 13, then Vulkan. Returns
    ``("","")`` when no GPU backend is bundled (pure CPU fallback).
    """
    for rel in ("cuda_v12/ggml-cuda.dll", "cuda_v13/ggml-cuda.dll",
                "vulkan/ggml-vulkan.dll", "ggml-cuda.dll", "ggml-vulkan.dll"):
        p = EXE_DIR / rel
        if p.exists():
            return str(p), str(p.parent)
    return "", ""


GPU_BACKEND, GPU_BACKEND_DIR = _gpu_backend()

DEFAULT_LOAD_TIMEOUT = 240     # seconds to wait for a cold model load
DEFAULT_IDLE_TIMEOUT = 1800    # seconds a warm instance survives untouched
DEFAULT_MAX_RESIDENT = 1       # how many instances may sit in VRAM at once


class _Instance:
    __slots__ = ("name", "port", "path", "ctx", "proc", "ready", "last_used", "started_at")

    def __init__(self, name: str, port: int, path: Path, ctx: int):
        self.name = name
        self.port = port
        self.path = path
        self.ctx = ctx
        self.proc: subprocess.Popen | None = None
        self.ready = False
        self.last_used = 0.0
        self.started_at = 0.0

    @property
    def alive(self) -> bool:
        return self.proc is not None and self.proc.poll() is None

    @property
    def base_url(self) -> str:
        return f"http://127.0.0.1:{self.port}/v1"


_INSTANCES: dict[str, _Instance] = {}
_LOCK = asyncio.Lock()
_REAPER: asyncio.Task | None = None


def _engine_conf() -> dict:
    conf = cfg.CONFIG.get("engine")
    return conf if isinstance(conf, dict) else {}


def _entry(name: str) -> dict:
    for m in cfg.CONFIG.get("models", []):
        if m.get("name") == name:
            return m
    return {}


def _local_names() -> list[str]:
    return [m["name"] for m in cfg.CONFIG.get("models", [])
            if not (m.get("base_url") or "").strip()]


def model_path(name: str) -> Path | None:
    """Absolute GGUF path for a configured local model, or ``None``."""
    rel = (_entry(name).get("file") or "").strip()
    if not rel:
        return None
    p = Path(rel)
    if not p.is_absolute():
        p = cfg.ROOT / p
    return p if p.exists() else None


def installed() -> list[str]:
    """Configured local models whose GGUF file is present on disk."""
    return [n for n in _local_names() if model_path(n)]


def _port_for(name: str) -> int:
    base = int(_engine_conf().get("base_port") or 18081)
    for i, m in enumerate(cfg.CONFIG.get("models", [])):
        if m.get("name") == name:
            return base + i
    raise KeyError(name)


async def _http_ready(port: int, timeout: float = 2.0) -> bool:
    """True once the instance's HTTP API answers ``/health`` with 200."""
    try:
        async with httpx.AsyncClient(timeout=timeout) as c:
            r = await c.get(f"http://127.0.0.1:{port}/health")
            if r.status_code == 200:
                try:
                    status = (r.json() or {}).get("status")
                except Exception:  # noqa: BLE001
                    return True
                return status in (None, "ok", "no slot available")
    except Exception:  # noqa: BLE001
        return False
    return False


def _spawn(inst: _Instance) -> None:
    flags = subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0
    args = [
        str(EXE), "-m", str(inst.path),
        "--host", "127.0.0.1", "--port", str(inst.port),
        "-ngl", "99", "-c", str(inst.ctx), "--jinja",
    ]
    env = os.environ.copy()
    if GPU_BACKEND:
        # Tell ggml exactly which GPU backend DLL to load, and make sure its
        # sibling runtimes (cuBLAS / Vulkan loader) resolve from the same dir.
        env["GGML_BACKEND_PATH"] = GPU_BACKEND
        if GPU_BACKEND_DIR:
            env["PATH"] = GPU_BACKEND_DIR + os.pathsep + env.get("PATH", "")
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    log = open(LOG_DIR / f"engine-{inst.port}.log", "wb")
    inst.proc = subprocess.Popen(
        args, cwd=str(EXE.parent), env=env,
        stdout=log, stderr=subprocess.STDOUT,
        creationflags=flags,
    )
    inst.started_at = time.time()
    inst.ready = False


def _terminate(inst: _Instance) -> None:
    if inst.proc and inst.proc.poll() is None:
        inst.proc.terminate()
        try:
            inst.proc.wait(timeout=8)
        except Exception:  # noqa: BLE001
            inst.proc.kill()
    inst.proc = None
    inst.ready = False


async def _make_room_locked(keep: str) -> None:
    """Evict least-recently-used instances so *keep* can take a VRAM slot."""
    cap = int(_engine_conf().get("max_resident") or DEFAULT_MAX_RESIDENT)
    running = [i for i in _INSTANCES.values() if i.alive]
    running.sort(key=lambda i: i.last_used)
    while len(running) >= cap:
        victim = next((i for i in running if i.name != keep), None)
        if victim is None:
            break
        _terminate(victim)
        running.remove(victim)


async def _reaper() -> None:
    timeout = float(_engine_conf().get("idle_timeout") or DEFAULT_IDLE_TIMEOUT)
    while True:
        await asyncio.sleep(60)
        now = time.time()
        async with _LOCK:
            for inst in list(_INSTANCES.values()):
                if inst.alive and now - inst.last_used > timeout:
                    _terminate(inst)


def _ensure_reaper() -> None:
    global _REAPER
    if _REAPER is None or _REAPER.done():
        try:
            _REAPER = asyncio.create_task(_reaper())
        except RuntimeError:
            _REAPER = None


async def ensure(name: str) -> str:
    """Return a ready OpenAI-compatible base URL for *name*.

    Starts (and waits for) the instance on first use. Raises ``RuntimeError``
    when the model file is missing or the load times out.
    """
    path = model_path(name)
    if not path:
        raise RuntimeError(f"本地模型 {name} 的权重文件不存在")
    _ensure_reaper()

    async with _LOCK:
        inst = _INSTANCES.get(name)
        if inst is None:
            inst = _Instance(name, _port_for(name), path,
                             int(_entry(name).get("context_len") or 8192))
            _INSTANCES[name] = inst
        inst.path = path
        inst.last_used = time.time()
        if inst.alive and inst.ready:
            return inst.base_url
        if not inst.alive:
            await _make_room_locked(keep=name)
            _spawn(inst)
        port = inst.port

    deadline = time.time() + float(_engine_conf().get("load_timeout") or DEFAULT_LOAD_TIMEOUT)
    while time.time() < deadline:
        if await _http_ready(port):
            async with _LOCK:
                inst.ready = True
                inst.last_used = time.time()
            return inst.base_url
        async with _LOCK:
            if not inst.alive:
                raise RuntimeError(f"推理引擎启动失败：{name}（请查看本机日志）")
        await asyncio.sleep(0.5)
    raise RuntimeError(f"推理引擎加载超时：{name}")


async def preload(name: str) -> None:
    await ensure(name)


async def stop(name: str) -> bool:
    async with _LOCK:
        inst = _INSTANCES.get(name)
        if inst and inst.alive:
            _terminate(inst)
            return True
        return False


async def stop_all() -> None:
    async with _LOCK:
        for inst in _INSTANCES.values():
            _terminate(inst)


def status() -> dict:
    """Snapshot of the engine: configured binaries + live instances."""
    now = time.time()
    running = []
    for inst in _INSTANCES.values():
        if inst.alive:
            running.append({
                "name": inst.name,
                "port": inst.port,
                "ready": inst.ready,
                "uptime_seconds": round(now - inst.started_at, 1) if inst.started_at else 0,
                "idle_seconds": round(now - inst.last_used, 1) if inst.last_used else 0,
                "model": str(inst.path),
            })
    backend = "cpu"
    if GPU_BACKEND:
        backend = "cuda" if "cuda" in GPU_BACKEND.lower() else "vulkan"
    return {
        "ok": bool(running),
        "running": running,
        "installed": installed(),
        "engine_path": str(EXE) if EXE.exists() else "",
        "gpu_backend": backend,
        "gpu_backend_path": GPU_BACKEND,
    }


atexit.register(lambda: [_terminate(i) for i in list(_INSTANCES.values())])