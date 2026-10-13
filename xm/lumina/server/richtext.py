"""Tiny safe-HTML helper for admin-authored rich text.

Only the formatting the admin editor can actually produce is allowed:
``<b>/<strong>`` and inline ``color`` styles. Everything else (scripts,
event handlers, URLs, iframes, …) is stripped. Used both for SMTP HTML mails
and for in-app service notifications.
"""
from __future__ import annotations

import re
from html.parser import HTMLParser

_ALLOWED_TAGS = {"b", "strong", "br", "div", "p", "span"}
_SAFE_COLOR = re.compile(r"^#[0-9a-fA-F]{3,8}$|^[a-zA-Z]{3,20}$")


class _Sanitizer(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.out: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag not in _ALLOWED_TAGS:
            return
        clean: dict[str, str] = {}
        for k, v in attrs:
            if k == "style" and v:
                m = re.search(r"(?:^|;)\s*color\s*:\s*([^;]+)", v)
                if m and _SAFE_COLOR.match(m.group(1).strip()):
                    clean["style"] = f"color:{m.group(1).strip()}"
        attr = (" " + " ".join(f'{k}="{v}"' for k, v in clean.items())) if clean else ""
        self.out.append(f"<{tag}{attr}>")

    def handle_endtag(self, tag: str) -> None:
        if tag in _ALLOWED_TAGS:
            self.out.append(f"</{tag}>")

    def handle_data(self, data: str) -> None:
        self.out.append(_escape_text(data))

    def handle_entityref(self, name: str) -> None:
        self.out.append(f"&{name};")

    def handle_charref(self, name: str) -> None:
        self.out.append(f"&#{name};")


def _escape_text(s: str) -> str:
    return (s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;"))


def sanitize_html(raw: str) -> str:
    """Return only bold/colored inline HTML; drop all other markup."""
    if not raw:
        return ""
    p = _Sanitizer()
    try:
        p.feed(str(raw))
    except Exception:  # noqa: BLE001
        return _escape_text(str(raw))
    html = "".join(p.out)
    # Collapse empty wrapper leftovers and keep output compact.
    html = re.sub(r"<br\s*>", "<br>", html)
    return html.strip()


def to_plain_text(safe_html: str) -> str:
    """Plain-text alternative for multipart mail (bold tags dropped, <br> -> \\n)."""
    t = re.sub(r"(?i)<br\s*/?>", "\n", safe_html)
    t = re.sub(r"(?i)</(p|div)>", "\n", t)
    t = re.sub(r"<[^>]+>", "", t)
    return t.strip()
