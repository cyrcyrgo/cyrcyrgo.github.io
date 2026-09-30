"""命令行对话/续写测试（本地验证模型效果，不依赖浏览器）。

用法：
    python scripts/chat.py --ckpt checkpoints/mini_zh --tokenizer tokenizer \
        --prompt "话说天下大势" --max-new-tokens 80 --temperature 0.85 --top-k 40 --top-p 0.92
"""
import argparse
import os
import sys

import torch

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from minillm import MiniLLM, MiniLLMConfig  # noqa: E402


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--ckpt", default="checkpoints/mini_zh")
    ap.add_argument("--tokenizer", default="tokenizer")
    ap.add_argument("--prompt", default="话说天下大势")
    ap.add_argument("--max-new-tokens", type=int, default=80)
    ap.add_argument("--temperature", type=float, default=0.85)
    ap.add_argument("--top-k", type=int, default=40)
    ap.add_argument("--top-p", type=float, default=0.92)
    args = ap.parse_args()

    from tokenizers import ByteLevelBPETokenizer

    tok = ByteLevelBPETokenizer(
        os.path.join(args.tokenizer, "vocab.json"),
        os.path.join(args.tokenizer, "merges.txt"),
    )
    cfg = MiniLLMConfig.from_json(os.path.join(args.ckpt, "config.json"))
    model = MiniLLM(cfg)
    model.load_state_dict(torch.load(os.path.join(args.ckpt, "model.pt"), map_location="cpu"))
    model.eval()
    print(f"模型参数量 {model.num_parameters():,}")

    ids = tok.encode(args.prompt).ids
    out, gen = model.generate(
        torch.tensor([ids]),
        max_new_tokens=args.max_new_tokens,
        temperature=args.temperature,
        top_k=args.top_k,
        top_p=args.top_p,
    )
    text = tok.decode(out[0].tolist())
    print("输入:", args.prompt)
    print("输出:", text)


if __name__ == "__main__":
    main()