"""Playwright-backed browser automation (persistent page per user)."""
from __future__ import annotations

import asyncio
import time
from pathlib import Path

from . import store

_SESSIONS: dict[str, dict] = {}
_LOCK = asyncio.Lock()


async def _session(uid: str) -> dict:
    async with _LOCK:
        sess = _SESSIONS.get(uid)
        if sess and sess.get("page") and not sess["page"].is_closed():
            return sess
        from playwright.async_api import async_playwright

        pw = await async_playwright().start()
        browser = None
        last_err: Exception | None = None
        # prefer an already-installed system browser (no 130MB download needed)
        for kwargs in ({"channel": "msedge"}, {"channel": "chrome"}, {}):
            try:
                browser = await pw.chromium.launch(
                    headless=True, args=["--no-sandbox"], **kwargs
                )
                break
            except Exception as exc:  # noqa: BLE001
                last_err = exc
        if browser is None:
            await pw.stop()
            raise last_err or RuntimeError("无法启动浏览器")
        page = await browser.new_page(viewport={"width": 1440, "height": 900})
        sess = {"pw": pw, "browser": browser, "page": page}
        _SESSIONS[uid] = sess
        return sess


async def close_session(uid: str) -> None:
    sess = _SESSIONS.pop(uid, None)
    if not sess:
        return
    try:
        await sess["browser"].close()
        await sess["pw"].stop()
    except Exception:
        pass


async def run_action(ctx, action: str, url: str = "", selector: str = "",
                     text: str = "", wait_ms: int = 800,
                     script: str = "", timeout_ms: int = 15000) -> dict:
    try:
        sess = await _session(ctx.uid)
    except Exception as exc:
        return {
            "ok": False,
            "error": f"浏览器不可用（可能未安装 Chromium）：{exc}",
        }
    page = sess["page"]
    action = (action or "").lower().strip()

    try:
        if action == "goto":
            if not url:
                return {"ok": False, "error": "goto 需要 url"}
            resp = await page.goto(url, wait_until="domcontentloaded", timeout=45000)
            await page.wait_for_timeout(wait_ms)
            return {
                "ok": True,
                "status": resp.status if resp else None,
                "title": await page.title(),
                "url": page.url,
                "text": (await page.inner_text("body"))[:4000],
            }
        if action == "current":
            return {"ok": True, "url": page.url, "title": await page.title()}
        if action == "click":
            if not selector:
                return {"ok": False, "error": "click 需要 selector"}
            await page.click(selector, timeout=20000)
            await page.wait_for_timeout(wait_ms)
            return {"ok": True, "url": page.url, "title": await page.title()}
        if action == "type":
            if not selector:
                return {"ok": False, "error": "type 需要 selector"}
            await page.fill(selector, text, timeout=20000)
            return {"ok": True, "filled": selector}
        if action == "press":
            await page.keyboard.press(text or "Enter")
            await page.wait_for_timeout(wait_ms)
            return {"ok": True}
        if action == "get_text":
            target = selector or "body"
            return {"ok": True, "text": (await page.inner_text(target, timeout=15000))[:8000]}
        if action == "get_attr":
            if not selector or not text:
                return {"ok": False, "error": "get_attr 需要 selector 与 attr 名(text 参数)"}
            val = await page.get_attribute(selector, text, timeout=15000)
            return {"ok": True, "attr": text, "value": val}
        if action == "query_all":
            target = selector or "body"
            els = await page.query_selector_all(target)
            out = []
            for el in els[:50]:
                try:
                    out.append((await el.inner_text()).strip()[:500])
                except Exception:  # noqa: BLE001
                    continue
            return {"ok": True, "count": len(els), "items": out}
        if action == "get_html":
            return {"ok": True, "html": (await page.content())[:12000]}
        if action == "evaluate":
            if not script:
                return {"ok": False, "error": "evaluate 需要 script（在页面内执行的 JS）"}
            val = await page.evaluate(script)
            return {"ok": True, "result": str(val)[:8000]}
        if action == "wait_for":
            if selector:
                await page.wait_for_selector(selector, timeout=int(timeout_ms))
            else:
                await page.wait_for_timeout(wait_ms)
            return {"ok": True}
        if action == "screenshot":
            out = store.workspace(ctx.uid) / "screenshots"
            out.mkdir(exist_ok=True)
            path = out / f"shot_{int(time.time())}.png"
            await page.screenshot(path=str(path), full_page=True)
            return {"ok": True, "path": str(path), "name": path.name}
        if action == "wait":
            await page.wait_for_timeout(wait_ms)
            return {"ok": True}
        if action == "back":
            await page.go_back()
            await page.wait_for_timeout(wait_ms)
            return {"ok": True, "url": page.url}
        if action == "close":
            await close_session(ctx.uid)
            return {"ok": True, "closed": True}
        return {"ok": False, "error": f"未知 action: {action}"}
    except Exception as exc:  # noqa: BLE001 - surface selector / nav errors to model
        return {"ok": False, "error": f"{type(exc).__name__}: {str(exc)[:300]}"}