"""统计并校验模型参数量。

用法：
    python scripts/count_params.py configs/base_1b.json
    python scripts/count_params.py configs/base_1b.json --build   # 额外构建模型核对真实参数量
"""
import argparse
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from minillm import MiniLLM, MiniLLMConfig  # noqa: E402


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("config")
    ap.add_argument("--build", action="store_true", help="实际构建模型并统计 parameters()")
    args = ap.parse_args()

    cfg = MiniLLMConfig.from_json(args.config)
    n = cfg.num_parameters()
    print(f"配置: {args.config}")
    print(f"  层数={cfg.num_hidden_layers} 隐藏维度={cfg.hidden_size} "
          f"头数={cfg.num_attention_heads} KV头={cfg.num_key_value_heads} "
          f"中间维度={cfg.intermediate_size} 词表={cfg.vocab_size}")
    print(f"  理论参数量: {n:,}  ({n/1e9:.3f}B)")
    print(f"  其中词嵌入: {cfg.vocab_size * cfg.hidden_size:,} "
          f"({cfg.vocab_size * cfg.hidden_size / n * 100:.1f}%)")
    print(f"  中间维度/隐藏维度 = {cfg.intermediate_size / cfg.hidden_size:.2f}x")
    if cfg.tie_word_embeddings:
        print("  输出头与词嵌入共享权重 (tie_word_embeddings=true)")

    if args.build:
        model = MiniLLM(cfg)
        real = model.num_parameters()
        print(f"  实测参数量: {real:,}  ({real/1e9:.3f}B)")
        assert real == n, "理论值与实测值不一致！"


if __name__ == "__main__":
    main()