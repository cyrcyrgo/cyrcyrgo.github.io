"""把训练好的 PyTorch 权重导出为浏览器可直接加载的格式。

产物（默认输出到 web/model/）：
  manifest.json  模型配置 + 每个张量的名称/形状/偏移
  weights.bin    所有张量按 float32 小端顺序拼接
  vocab.json / merges.txt  分词器（从 tokenizer/ 复制）
  metrics.json / train_info.json  训练指标，用于页面展示

用法：
    python scripts/export_web.py --ckpt checkpoints/mini_zh --tokenizer tokenizer \
        --out web/model
"""
import argparse
import json
import os
import shutil
import sys

import numpy as np
import torch

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from minillm import MiniLLMConfig  # noqa: E402


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--ckpt", default="checkpoints/mini_zh")
    ap.add_argument("--tokenizer", default="tokenizer")
    ap.add_argument("--out", default="web/model")
    args = ap.parse_args()

    os.makedirs(args.out, exist_ok=True)
    cfg = MiniLLMConfig.from_json(os.path.join(args.ckpt, "config.json"))
    state = torch.load(os.path.join(args.ckpt, "model.pt"), map_location="cpu")

    tensors = []
    chunks = []
    offset = 0
    for name, tensor in state.items():
        # 权重共享时 lm_head 与 embed_tokens 是同一个张量，跳过避免重复存储
        if cfg.tie_word_embeddings and name == "lm_head.weight":
            continue
        arr = tensor.detach().to(torch.float32).contiguous().numpy()
        flat = arr.reshape(-1)
        tensors.append({
            "name": name,
            "shape": list(arr.shape),
            "offset": offset,
            "count": int(flat.size),
        })
        chunks.append(flat)
        offset += flat.size

    all_w = np.concatenate(chunks).astype("<f4")
    with open(os.path.join(args.out, "weights.bin"), "wb") as f:
        f.write(all_w.tobytes())

    manifest = {
        "config": cfg.__dict__,
        "num_parameters": int(sum(t["count"] for t in tensors)),
        "tensors": tensors,
        "total_floats": int(offset),
    }
    with open(os.path.join(args.out, "manifest.json"), "w", encoding="utf-8") as f:
        json.dump(manifest, f, ensure_ascii=False, indent=2)

    for fn in ("vocab.json", "merges.txt"):
        shutil.copy(os.path.join(args.tokenizer, fn), os.path.join(args.out, fn))

    for fn in ("metrics.json",):
        src = os.path.join(args.ckpt, fn)
        if os.path.exists(src):
            shutil.copy(src, os.path.join(args.out, fn))

    info = {
        "params": manifest["num_parameters"],
        "size_mb": round(all_w.nbytes / 1024 / 1024, 2),
        "tensors": len(tensors),
        "architecture": {
            "layers": cfg.num_hidden_layers,
            "hidden": cfg.hidden_size,
            "heads": cfg.num_attention_heads,
            "kv_heads": cfg.num_key_value_heads,
            "intermediate": cfg.intermediate_size,
            "vocab": cfg.vocab_size,
        },
    }
    with open(os.path.join(args.out, "train_info.json"), "w", encoding="utf-8") as f:
        json.dump(info, f, ensure_ascii=False, indent=2)

    print(f"已导出 {len(tensors)} 个张量，参数量 {manifest['num_parameters']:,} "
          f"({info['size_mb']} MB) -> {args.out}")


if __name__ == "__main__":
    main()