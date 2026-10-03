"""Publish the project to GitHub (cyrcyrgo/cyrcyrgo.github.io -> /cla).

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
    "config.local.json.bak",
    "data",
    "models",
    ".venv",
    "bin",
    "tests",
    ".pytest_cache",
    "__pycache__",
    ".git",
    "_probe.py",
    "_agenttest.py",
    "start-all.bat",
)


async def main() -> None:
    uploaded = await github_sync.publish_tree(ROOT, excludes=EXCLUDES)
    print(f"published {len(uploaded)} files:")
    for f in uploaded:
        print("  -", f)


if __name__ == "__main__":
    asyncio.run(main())