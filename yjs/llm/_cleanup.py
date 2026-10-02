import asyncio
import sys

sys.path.insert(0, r"D:\yjs")

from server import github_sync  # noqa: E402


async def main() -> None:
    paths = await github_sync.list_repo_paths("yjs/llm")
    junk = [p for p in paths if "__pycache__" in p or p.endswith(".pyc")]
    print("repo files under yjs/llm:", len(paths))
    print("junk found:", junk)
    n = await github_sync.delete_prefix("server/__pycache__")
    print("deleted:", n)
    left = await github_sync.list_repo_paths("yjs/llm")
    print("remaining:", len(left))
    for p in left:
        print("  -", p)


asyncio.run(main())