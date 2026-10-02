"""Publish the project to GitHub (cyrcyrgo/cyrcyrgo.github.io -> /yjs/llm).

Run from the project root:  python scripts/publish.py
"""
from __future__ import annotations

import asyncio
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from server import github_sync  # noqa: E402

EXCLUDES = (
    "config.local.json",
    "data",
    ".venv",
    "bin",
    "__pycache__",
    ".git",
)


async def main() -> None:
    uploaded = await github_sync.publish_tree(ROOT, excludes=EXCLUDES)
    print(f"published {len(uploaded)} files:")
    for f in uploaded:
        print("  -", f)


if __name__ == "__main__":
    asyncio.run(main())