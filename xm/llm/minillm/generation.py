"""采样策略：温度 / top-k / top-p（核采样）。"""
from __future__ import annotations

import torch


def sample_next_token(
    logits: torch.Tensor,
    temperature: float = 1.0,
    top_k: int = 0,
    top_p: float = 1.0,
) -> torch.Tensor:
    """logits: [B, vocab] -> 采样的下一个 token id: [B, 1]。"""
    if temperature <= 0:  # 贪心
        return logits.argmax(dim=-1, keepdim=True)

    logits = logits / temperature

    if top_k and top_k > 0:
        k = min(top_k, logits.size(-1))
        kth = torch.topk(logits, k, dim=-1).values[:, -1:]
        logits = torch.where(logits < kth, torch.full_like(logits, float("-inf")), logits)

    if top_p and top_p < 1.0:
        sorted_logits, sorted_idx = torch.sort(logits, descending=True, dim=-1)
        probs = torch.softmax(sorted_logits, dim=-1)
        cum = torch.cumsum(probs, dim=-1)
        # 保留累计概率刚超过 top_p 的最小集合
        remove = cum - probs > top_p
        sorted_logits = sorted_logits.masked_fill(remove, float("-inf"))
        logits = torch.full_like(logits, float("-inf")).scatter(-1, sorted_idx, sorted_logits)

    probs = torch.softmax(logits, dim=-1)
    return torch.multinomial(probs, num_samples=1)