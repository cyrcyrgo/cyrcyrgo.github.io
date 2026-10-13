"""准备训练数据：训练 BPE 分词器并把语料编码为 token id 二进制文件。

流程（对应"分词器"部分）：
  1. 读取原始中文语料 txt
  2. 训练 byte-level BPE 分词器（词表大小可配，精简模型通常 3w~5w）
  3. 用分词器把语料编码为 uint16 token id 序列，保存为 train.bin / val.bin

用法：
    python scripts/prepare_data.py \
        --corpus-dir data/raw --tokenizer-dir tokenizer --vocab-size 8192 \
        --out-dir data/processed
"""
import argparse
import glob
import json
import os
import sys

import numpy as np
from tokenizers import ByteLevelBPETokenizer

SPECIAL_TOKENS = ["<|endoftext|>"]


def read_corpus(corpus_dir: str):
    files = sorted(glob.glob(os.path.join(corpus_dir, "*.txt")))
    if not files:
        raise SystemExit(f"未在 {corpus_dir} 找到任何 .txt 语料")
    docs = []
    for fp in files:
        with open(fp, "r", encoding="utf-8", errors="ignore") as f:
            text = f.read()
        # 简单清洗：压缩多余空行
        lines = [ln.strip() for ln in text.splitlines()]
        text = "\n".join(ln for ln in lines if ln)
        docs.append(text)
        print(f"  读取 {os.path.basename(fp)}: {len(text):,} 字符")
    return docs


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--corpus-dir", default="data/raw")
    ap.add_argument("--tokenizer-dir", default="tokenizer")
    ap.add_argument("--vocab-size", type=int, default=8192)
    ap.add_argument("--out-dir", default="data/processed")
    ap.add_argument("--val-ratio", type=float, default=0.005)
    ap.add_argument("--min-frequency", type=int, default=2)
    args = ap.parse_args()

    print("[1/3] 读取语料")
    docs = read_corpus(args.corpus_dir)
    total_chars = sum(len(d) for d in docs)
    print(f"  合计 {total_chars:,} 字符")

    print(f"[2/3] 训练 BPE 分词器 (vocab_size={args.vocab_size})")
    os.makedirs(args.tokenizer_dir, exist_ok=True)
    tok = ByteLevelBPETokenizer(trim_offsets=False)
    tok.train_from_iterator(
        docs,
        vocab_size=args.vocab_size,
        min_frequency=args.min_frequency,
        special_tokens=SPECIAL_TOKENS,
    )
    # 保存 BPE 模型（vocab.json + merges.txt），浏览器端 JS 分词器直接读取这两个文件
    tok.model.save(args.tokenizer_dir)
    print(f"  已保存到 {args.tokenizer_dir}/vocab.json, merges.txt")

    print("[3/3] 编码语料")
    os.makedirs(args.out_dir, exist_ok=True)
    eos_id = tok.token_to_id("<|endoftext|>")

    def encode_all(texts):
        ids = []
        for t in texts:
            ids.extend(tok.encode(t).ids)
            ids.append(eos_id)
        return np.asarray(ids, dtype=np.uint16)

    # 至少保留 80% 做训练；当只有单文件时直接按比例切
    if len(docs) >= 2:
        val_doc = docs[-1]
        train_docs = docs[:-1]
    else:
        val_ratio = args.val_ratio
        n = len(docs[0])
        train_docs = [docs[0][: int(n * (1 - val_ratio))]]
        val_doc = docs[0][int(n * (1 - val_ratio)):]
    train_ids = encode_all(train_docs)
    val_ids = encode_all([val_doc])

    train_ids.tofile(os.path.join(args.out_dir, "train.bin"))
    val_ids.tofile(os.path.join(args.out_dir, "val.bin"))

    meta = {
        "vocab_size": args.vocab_size,
        "eos_token_id": eos_id,
        "train_tokens": int(len(train_ids)),
        "val_tokens": int(len(val_ids)),
        "total_chars": total_chars,
        "compression": round(total_chars / max(len(train_ids) + len(val_ids), 1), 3),
    }
    with open(os.path.join(args.out_dir, "meta.json"), "w", encoding="utf-8") as f:
        json.dump(meta, f, ensure_ascii=False, indent=2)
    print(f"  训练 tokens: {len(train_ids):,}  验证 tokens: {len(val_ids):,}")
    print(f"  平均每 token {meta['compression']} 个字符")
    print("完成。")


if __name__ == "__main__":
    main()