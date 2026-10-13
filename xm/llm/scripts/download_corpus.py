"""下载中文语料（公有领域古典文本），用于训练演示模型。

语料来源：shjwudp/shu（GitHub 公开的中文古籍 txt 合集）。

用法：
    python scripts/download_corpus.py --out data/raw
"""
import argparse
import os
import urllib.request

BOOKS = [
    "三国演义", "水浒传", "红楼梦", "西游记",
    "封神演义", "隋唐演义", "儒林外史", "太平广记",
    "昭明文选", "曾国藩家书", "梦溪笔谈", "天工开物",
]
BASE = "https://raw.githubusercontent.com/shjwudp/shu/master/books/"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="data/raw")
    args = ap.parse_args()
    os.makedirs(args.out, exist_ok=True)
    for name in BOOKS:
        dst = os.path.join(args.out, name + ".txt")
        if os.path.exists(dst) and os.path.getsize(dst) > 0:
            print(f"  已存在，跳过 {name}")
            continue
        url = BASE + urllib.parse.quote(name) + ".txt"
        print(f"  下载 {name} ...", end="", flush=True)
        urllib.request.urlretrieve(url, dst)
        print(f" {os.path.getsize(dst):,} bytes")
    total = sum(os.path.getsize(os.path.join(args.out, f)) for f in os.listdir(args.out) if f.endswith(".txt"))
    print(f"完成，共 {total/1024/1024:.1f} MB")


if __name__ == "__main__":
    main()