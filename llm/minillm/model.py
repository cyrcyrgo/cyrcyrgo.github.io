"""精简 LLM 主体实现（从零手写，不含任何高层封装）。

结构：分词 -> 嵌入(+RoPE) -> N x 解码器块(GQA + SwiGLU + RMSNorm + 残差) -> 输出头 -> 采样生成

与主流开源实现保持一致的组件选择：
  * 归一化：RMSNorm，放在注意力 / FFN 之前（Pre-Norm）
  * 位置编码：RoPE 旋转位置编码
  * 注意力：分组查询注意力 GQA（KV 头数 < 查询头数）
  * 前馈：SwiGLU，中间维度约为隐藏维度 2.7 倍
  * 输出头：与词嵌入权重共享（tie_word_embeddings）
"""
from __future__ import annotations

import math
from typing import List, Optional, Tuple

import torch
import torch.nn as nn
import torch.nn.functional as F

from .config import MiniLLMConfig


# --------------------------------------------------------------------------
# RoPE 旋转位置编码
# --------------------------------------------------------------------------
def precompute_rope(head_dim: int, max_len: int, theta: float = 10000.0):
    """预计算 cos/sin 表，形状 [max_len, head_dim]。"""
    inv_freq = 1.0 / (theta ** (torch.arange(0, head_dim, 2).float() / head_dim))
    t = torch.arange(max_len, dtype=torch.float32)
    freqs = torch.outer(t, inv_freq)                       # [max_len, head_dim/2]
    emb = torch.cat([freqs, freqs], dim=-1)                # [max_len, head_dim]
    return emb.cos(), emb.sin()


def rotate_half(x: torch.Tensor) -> torch.Tensor:
    x1 = x[..., : x.shape[-1] // 2]
    x2 = x[..., x.shape[-1] // 2:]
    return torch.cat([-x2, x1], dim=-1)


def apply_rope(x: torch.Tensor, cos: torch.Tensor, sin: torch.Tensor) -> torch.Tensor:
    """x: [B, T, H, D]，cos/sin: [T, D]。"""
    cos = cos[None, :, None, :].to(x.dtype)
    sin = sin[None, :, None, :].to(x.dtype)
    return x * cos + rotate_half(x) * sin


# --------------------------------------------------------------------------
# RMSNorm
# --------------------------------------------------------------------------
class RMSNorm(nn.Module):
    def __init__(self, hidden_size: int, eps: float = 1e-5):
        super().__init__()
        self.weight = nn.Parameter(torch.ones(hidden_size))
        self.eps = eps

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        var = x.pow(2).mean(-1, keepdim=True)
        x = x * torch.rsqrt(var + self.eps)
        return self.weight * x


# --------------------------------------------------------------------------
# 分组查询注意力 GQA
# --------------------------------------------------------------------------
class Attention(nn.Module):
    def __init__(self, cfg: MiniLLMConfig):
        super().__init__()
        self.n_heads = cfg.num_attention_heads
        self.n_kv_heads = cfg.num_key_value_heads
        self.n_groups = cfg.num_key_value_groups
        self.head_dim = cfg.head_dim

        self.q_proj = nn.Linear(cfg.hidden_size, self.n_heads * self.head_dim, bias=False)
        self.k_proj = nn.Linear(cfg.hidden_size, self.n_kv_heads * self.head_dim, bias=False)
        self.v_proj = nn.Linear(cfg.hidden_size, self.n_kv_heads * self.head_dim, bias=False)
        self.o_proj = nn.Linear(self.n_heads * self.head_dim, cfg.hidden_size, bias=False)

    def forward(
        self,
        x: torch.Tensor,
        cos: torch.Tensor,
        sin: torch.Tensor,
        attn_mask: Optional[torch.Tensor] = None,
        past_kv: Optional[Tuple[torch.Tensor, torch.Tensor]] = None,
        use_cache: bool = False,
    ):
        B, T, _ = x.shape
        q = self.q_proj(x).view(B, T, self.n_heads, self.head_dim)
        k = self.k_proj(x).view(B, T, self.n_kv_heads, self.head_dim)
        v = self.v_proj(x).view(B, T, self.n_kv_heads, self.head_dim)

        q = apply_rope(q, cos, sin)
        k = apply_rope(k, cos, sin)

        # KV Cache：把历史 K/V 拼到当前步前面
        if past_kv is not None:
            k = torch.cat([past_kv[0], k], dim=1)
            v = torch.cat([past_kv[1], v], dim=1)
        new_kv = (k, v) if use_cache else None

        # GQA：把 KV 头复制到与查询头一一对应
        k = k.repeat_interleave(self.n_groups, dim=2)
        v = v.repeat_interleave(self.n_groups, dim=2)

        q = q.transpose(1, 2)  # [B, H, T, D]
        k = k.transpose(1, 2)
        v = v.transpose(1, 2)

        scores = (q @ k.transpose(-2, -1)) / math.sqrt(self.head_dim)
        if attn_mask is not None:
            scores = scores + attn_mask
        probs = F.softmax(scores, dim=-1)
        out = probs @ v                      # [B, H, T, D]
        out = out.transpose(1, 2).reshape(B, T, -1)
        return self.o_proj(out), new_kv


# --------------------------------------------------------------------------
# SwiGLU 前馈网络
# --------------------------------------------------------------------------
class MLP(nn.Module):
    def __init__(self, cfg: MiniLLMConfig):
        super().__init__()
        self.gate_proj = nn.Linear(cfg.hidden_size, cfg.intermediate_size, bias=False)
        self.up_proj = nn.Linear(cfg.hidden_size, cfg.intermediate_size, bias=False)
        self.down_proj = nn.Linear(cfg.intermediate_size, cfg.hidden_size, bias=False)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return self.down_proj(F.silu(self.gate_proj(x)) * self.up_proj(x))


# --------------------------------------------------------------------------
# 解码器块
# --------------------------------------------------------------------------
class DecoderLayer(nn.Module):
    def __init__(self, cfg: MiniLLMConfig):
        super().__init__()
        self.input_layernorm = RMSNorm(cfg.hidden_size, cfg.rms_norm_eps)
        self.self_attn = Attention(cfg)
        self.post_attention_layernorm = RMSNorm(cfg.hidden_size, cfg.rms_norm_eps)
        self.mlp = MLP(cfg)

    def forward(self, x, cos, sin, attn_mask=None, past_kv=None, use_cache=False):
        h, new_kv = self.self_attn(
            self.input_layernorm(x), cos, sin, attn_mask, past_kv, use_cache
        )
        x = x + h                                    # 残差
        x = x + self.mlp(self.post_attention_layernorm(x))  # 残差
        return x, new_kv


# --------------------------------------------------------------------------
# 完整模型
# --------------------------------------------------------------------------
class MiniLLM(nn.Module):
    def __init__(self, cfg: MiniLLMConfig):
        super().__init__()
        self.cfg = cfg
        self.embed_tokens = nn.Embedding(cfg.vocab_size, cfg.hidden_size)
        self.layers = nn.ModuleList([DecoderLayer(cfg) for _ in range(cfg.num_hidden_layers)])
        self.norm = RMSNorm(cfg.hidden_size, cfg.rms_norm_eps)
        self.lm_head = nn.Linear(cfg.hidden_size, cfg.vocab_size, bias=False)
        if cfg.tie_word_embeddings:
            self.lm_head.weight = self.embed_tokens.weight

        cos, sin = precompute_rope(cfg.head_dim, cfg.max_position_embeddings, cfg.rope_theta)
        self.register_buffer("rope_cos", cos, persistent=False)
        self.register_buffer("rope_sin", sin, persistent=False)

        self.apply(self._init_weights)

    def _init_weights(self, module):
        if isinstance(module, nn.Linear):
            nn.init.normal_(module.weight, mean=0.0, std=self.cfg.initializer_range)
        elif isinstance(module, nn.Embedding):
            nn.init.normal_(module.weight, mean=0.0, std=self.cfg.initializer_range)

    def forward(
        self,
        input_ids: torch.LongTensor,              # [B, T]
        past_kv: Optional[List[Tuple[torch.Tensor, torch.Tensor]]] = None,
        use_cache: bool = False,
    ):
        B, T = input_ids.shape
        start = past_kv[0][0].shape[1] if past_kv is not None else 0

        x = self.embed_tokens(input_ids)
        cos = self.rope_cos[start:start + T]
        sin = self.rope_sin[start:start + T]

        # 因果掩码：查询位置 i 只能看到 <= i 的 key
        total = start + T
        if T > 1:
            mask = torch.full((T, total), float("-inf"), device=x.device)
            mask = torch.triu(mask, diagonal=1 + start)
        else:
            mask = None

        new_caches = [] if use_cache else None
        for i, layer in enumerate(self.layers):
            layer_past = past_kv[i] if past_kv is not None else None
            x, kv = layer(x, cos, sin, mask, layer_past, use_cache)
            if use_cache:
                new_caches.append(kv)

        x = self.norm(x)
        logits = self.lm_head(x)                   # [B, T, vocab]
        return logits, new_caches

    # -- 便捷方法 -----------------------------------------------------------
    def num_parameters(self, exclude_embeddings: bool = False) -> int:
        n = sum(p.numel() for p in self.parameters())
        if exclude_embeddings:
            n -= self.embed_tokens.weight.numel()
        return n

    @torch.no_grad()
    def generate(self, input_ids, max_new_tokens=128, temperature=1.0,
                 top_k=0, top_p=1.0, eos_token_id=None, use_cache=True):
        from .generation import sample_next_token
        self.eval()
        device = next(self.parameters()).device
        ids = input_ids.to(device)
        past_kv = None
        out_tokens: List[int] = []

        for _ in range(max_new_tokens):
            inp = ids if past_kv is None else ids[:, -1:]
            logits, past_kv = self.forward(inp, past_kv=past_kv, use_cache=use_cache)
            logits = logits[:, -1, :]
            nxt = sample_next_token(logits, temperature, top_k, top_p)
            ids = torch.cat([ids, nxt], dim=1)
            out_tokens.append(int(nxt.item()))
            if eos_token_id is not None and int(nxt.item()) == eos_token_id:
                break
        return ids, out_tokens