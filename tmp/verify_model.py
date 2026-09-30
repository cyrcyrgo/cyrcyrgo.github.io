"""校验 web/model/ 下导出的模型权重能否正常推理。"""
import json
import os
import sys

import numpy as np
import torch
from tokenizers import ByteLevelBPETokenizer

sys.path.insert(0, "/workspace/repo/llm")
from minillm import MiniLLM, MiniLLMConfig  # noqa


def load(model_dir):
    with open(os.path.join(model_dir, "manifest.json"), encoding="utf-8") as f:
        manifest = json.load(f)
    cfg = MiniLLMConfig(**manifest["config"])
    print(f"  配置: layers={cfg.num_hidden_layers} hidden={cfg.hidden_size} "
          f"heads={cfg.num_attention_heads}/{cfg.num_key_value_heads} vocab={cfg.vocab_size} "
          f"maxpos={cfg.max_position_embeddings}")
    n = cfg.num_parameters()
    print(f"  理论参数量: {n:,} | manifest: {manifest['num_parameters']:,} | 一致: {n == manifest['num_parameters']}")

    raw = np.fromfile(os.path.join(model_dir, "weights.bin"), dtype="<f4")
    print(f"  weights.bin floats: {len(raw):,} (期望 {manifest['total_floats']:,}) 一致: {len(raw) == manifest['total_floats']}")

    model = MiniLLM(cfg)
    sd = model.state_dict()
    loaded = {}
    for t in manifest["tensors"]:
        arr = raw[t["offset"]: t["offset"] + t["count"]].reshape(t["shape"])
        loaded[t["name"]] = torch.from_numpy(arr.copy())
    if cfg.tie_word_embeddings:
        loaded["lm_head.weight"] = loaded["embed_tokens.weight"]
    missing = [k for k in sd if k not in loaded]
    unexpected = [k for k in loaded if k not in sd]
    print(f"  缺失张量: {missing} | 多余张量: {unexpected}")
    model.load_state_dict(loaded)
    model.eval()
    return model, cfg


def gen(model, cfg, tok, prompt, n=60, temp=0.85, top_k=40, top_p=0.92):
    eos = tok.token_to_id("<|endoftext|>")
    ids = tok.encode(prompt).ids
    ids = ids[-(cfg.max_position_embeddings - n - 2):]
    x = torch.tensor([ids], dtype=torch.long)
    with torch.no_grad():
        out, new = model.generate(x, max_new_tokens=n, temperature=temp, top_k=top_k,
                                  top_p=top_p, eos_token_id=eos)
    text = tok.decode(out[0].tolist())
    return text


def main():
    root = "/workspace/repo/llm/web/model"
    for key, prompt in [("dialog", "你好，介绍一下你自己"), ("html", "写一个会让按钮悬停发光的网页")]:
        d = os.path.join(root, key)
        print(f"=== {key} ===")
        model, cfg = load(d)
        tok = ByteLevelBPETokenizer(os.path.join(d, "vocab.json"), os.path.join(d, "merges.txt"))
        out = gen(model, cfg, tok, prompt)
        print(f"  输入: {prompt}")
        print(f"  输出: {out[:300]!r}")
        print()


if __name__ == "__main__":
    main()