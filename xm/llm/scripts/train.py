"""精简 LLM 训练脚本（纯 PyTorch，CPU 可跑）。

损失函数：交叉熵（next-token prediction）
优化器：AdamW + 余弦学习率 + 线性 warmup + 梯度裁剪 + 梯度累积
支持断点续训、验证、指标记录、checkpoint 保存。

用法：
    python scripts/train.py --config configs/mini_zh.json \
        --data-dir data/processed --out-dir checkpoints/mini_zh \
        --batch-size 24 --block-size 192 --max-steps 3000
"""
import argparse
import json
import math
import os
import sys
import time

import numpy as np
import torch

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from minillm import MiniLLM, MiniLLMConfig  # noqa: E402


def get_batch(data: np.memmap, block_size: int, batch_size: int, device: str):
    ix = np.random.randint(0, len(data) - block_size - 1, size=batch_size)
    x = np.stack([data[i:i + block_size].astype(np.int64) for i in ix])
    y = np.stack([data[i + 1:i + 1 + block_size].astype(np.int64) for i in ix])
    return torch.from_numpy(x).to(device), torch.from_numpy(y).to(device)


@torch.no_grad()
def evaluate(model, data, block_size, batch_size, device, iters=20):
    model.eval()
    losses = []
    for _ in range(iters):
        x, y = get_batch(data, block_size, batch_size, device)
        _, loss = model_forward(model, x, y)
        losses.append(loss.item())
    model.train()
    return float(np.mean(losses))


def model_forward(model, x, y):
    logits, _ = model(x)
    loss = torch.nn.functional.cross_entropy(
        logits.view(-1, logits.size(-1)), y.view(-1)
    )
    return logits, loss


def cosine_lr(step, max_steps, warmup, lr, min_lr):
    if step < warmup:
        return lr * (step + 1) / warmup
    if step >= max_steps:
        return min_lr
    ratio = (step - warmup) / max(1, max_steps - warmup)
    return min_lr + 0.5 * (lr - min_lr) * (1 + math.cos(math.pi * ratio))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--config", default="configs/mini_zh.json")
    ap.add_argument("--data-dir", default="data/processed")
    ap.add_argument("--out-dir", default="checkpoints/mini_zh")
    ap.add_argument("--batch-size", type=int, default=24)
    ap.add_argument("--block-size", type=int, default=192)
    ap.add_argument("--grad-accum", type=int, default=1)
    ap.add_argument("--max-steps", type=int, default=3000)
    ap.add_argument("--lr", type=float, default=3e-3)
    ap.add_argument("--min-lr", type=float, default=3e-4)
    ap.add_argument("--warmup", type=int, default=100)
    ap.add_argument("--weight-decay", type=float, default=0.1)
    ap.add_argument("--grad-clip", type=float, default=1.0)
    ap.add_argument("--eval-interval", type=int, default=100)
    ap.add_argument("--save-interval", type=int, default=250)
    ap.add_argument("--log-interval", type=int, default=10)
    ap.add_argument("--seed", type=int, default=1337)
    ap.add_argument("--threads", type=int, default=2)
    ap.add_argument("--resume", action="store_true")
    args = ap.parse_args()

    torch.manual_seed(args.seed)
    np.random.seed(args.seed)
    torch.set_num_threads(args.threads)
    device = "cpu"

    cfg = MiniLLMConfig.from_json(args.config)
    model = MiniLLM(cfg).to(device)
    n_params = model.num_parameters()
    print(f"模型参数量: {n_params:,} ({n_params/1e6:.2f}M)")

    train_data = np.memmap(os.path.join(args.data_dir, "train.bin"), dtype=np.uint16, mode="r")
    val_data = np.memmap(os.path.join(args.data_dir, "val.bin"), dtype=np.uint16, mode="r")
    print(f"训练 tokens: {len(train_data):,} | 验证 tokens: {len(val_data):,}")
    # 验证集过小时无法切出完整 block，跳过验证而不是崩溃
    can_eval = len(val_data) > args.block_size + 1
    if not can_eval:
        print(f"  验证集仅 {len(val_data):,} tokens（<= block {args.block_size}），跳过验证")

    decay, no_decay = [], []
    for n, p in model.named_parameters():
        if not p.requires_grad:
            continue
        (decay if p.dim() >= 2 else no_decay).append(p)
    optimizer = torch.optim.AdamW(
        [{"params": decay, "weight_decay": args.weight_decay},
         {"params": no_decay, "weight_decay": 0.0}],
        lr=args.lr, betas=(0.9, 0.95), eps=1e-8,
    )

    os.makedirs(args.out_dir, exist_ok=True)
    cfg.to_json(os.path.join(args.out_dir, "config.json"))
    metrics_path = os.path.join(args.out_dir, "metrics.json")
    metrics = []
    start_step = 0

    ckpt_path = os.path.join(args.out_dir, "ckpt.pt")
    if args.resume and os.path.exists(ckpt_path):
        ckpt = torch.load(ckpt_path, map_location=device)
        model.load_state_dict(ckpt["model"])
        optimizer.load_state_dict(ckpt["optimizer"])
        start_step = ckpt["step"]
        if os.path.exists(metrics_path):
            metrics = json.load(open(metrics_path, encoding="utf-8"))
        print(f"从 step {start_step} 续训")

    model.train()
    t0 = time.time()
    running = None
    tokens_per_step = args.batch_size * args.block_size * args.grad_accum

    for step in range(start_step, args.max_steps):
        lr = cosine_lr(step, args.max_steps, args.warmup, args.lr, args.min_lr)
        for g in optimizer.param_groups:
            g["lr"] = lr

        optimizer.zero_grad(set_to_none=True)
        for _ in range(args.grad_accum):
            x, y = get_batch(train_data, args.block_size, args.batch_size, device)
            _, loss = model_forward(model, x, y)
            (loss / args.grad_accum).backward()
            running = loss.item() if running is None else 0.9 * running + 0.1 * loss.item()

        torch.nn.utils.clip_grad_norm_(model.parameters(), args.grad_clip)
        optimizer.step()

        if step % args.log_interval == 0:
            dt = time.time() - t0
            done = (step - start_step + 1) * tokens_per_step
            print(f"step {step:5d} | loss {running:.4f} | lr {lr:.2e} | "
                  f"{dt:.0f}s | {done/max(dt,1e-6):.0f} tok/s", flush=True)

        if step > 0 and step % args.eval_interval == 0:
            val_loss = evaluate(model, val_data, args.block_size, args.batch_size, device) if can_eval else None
            entry = {
                "step": step,
                "loss": round(running, 4),
                "val_loss": round(val_loss, 4) if val_loss is not None else None,
                "lr": lr,
                "elapsed_s": round(time.time() - t0, 1),
                "tokens": (step - start_step + 1) * tokens_per_step,
            }
            metrics.append(entry)
            if val_loss is not None:
                print(f"  >> eval step {step}: val_loss {val_loss:.4f} | ppl {math.exp(min(val_loss,20)):.1f}", flush=True)
            else:
                print(f"  >> eval step {step}: train_loss {running:.4f}（无验证集）", flush=True)
            json.dump(metrics, open(metrics_path, "w", encoding="utf-8"), ensure_ascii=False, indent=2)

        if step > 0 and step % args.save_interval == 0:
            torch.save({
                "model": model.state_dict(),
                "optimizer": optimizer.state_dict(),
                "step": step,
                "config": cfg.__dict__,
            }, ckpt_path)
            # 导出为浏览器推理用的纯权重（fp32 -> 后续再量化）
            torch.save(model.state_dict(), os.path.join(args.out_dir, "model.pt"))
            print(f"  >> 已保存 checkpoint (step {step})", flush=True)

    # 最终保存
    torch.save({
        "model": model.state_dict(),
        "optimizer": optimizer.state_dict(),
        "step": args.max_steps,
        "config": cfg.__dict__,
    }, ckpt_path)
    torch.save(model.state_dict(), os.path.join(args.out_dir, "model.pt"))
    cfg.to_json(os.path.join(args.out_dir, "config.json"))
    if metrics:
        json.dump(metrics, open(metrics_path, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
    print(f"训练完成，用时 {time.time()-t0:.0f}s，模型已保存到 {args.out_dir}")


if __name__ == "__main__":
    main()