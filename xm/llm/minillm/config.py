"""模型配置定义。

对齐主流开源精简 LLM（Llama 系）的字段命名，便于对照理解。
"""
from __future__ import annotations

import json
from dataclasses import asdict, dataclass


@dataclass
class MiniLLMConfig:
    # 词表大小（分词器决定）
    vocab_size: int = 32000
    # 隐藏维度 d_model
    hidden_size: int = 2048
    # 解码器层数
    num_hidden_layers: int = 21
    # 查询头数量
    num_attention_heads: int = 16
    # 键/值头数量（GQA：小于查询头数量即为分组查询注意力）
    num_key_value_heads: int = 4
    # 前馈网络中间维度，约为 hidden_size 的 2.7 倍（SwiGLU）
    intermediate_size: int = 5504
    # 最大上下文长度
    max_position_embeddings: int = 4096
    # RoPE 旋转位置编码的 base
    rope_theta: float = 10000.0
    # RMSNorm 的 eps
    rms_norm_eps: float = 1e-5
    # 是否让输出头与词嵌入共享权重
    tie_word_embeddings: bool = True
    # 权重初始化标准差
    initializer_range: float = 0.02
    # 名称（仅用于展示）
    name: str = "minillm"

    @property
    def head_dim(self) -> int:
        assert self.hidden_size % self.num_attention_heads == 0
        return self.hidden_size // self.num_attention_heads

    @property
    def num_key_value_groups(self) -> int:
        """每个 KV 头被多少个查询头共享。"""
        assert self.num_attention_heads % self.num_key_value_heads == 0
        return self.num_attention_heads // self.num_key_value_heads

    @classmethod
    def from_json(cls, path: str) -> "MiniLLMConfig":
        with open(path, "r", encoding="utf-8") as f:
            return cls(**json.load(f))

    def to_json(self, path: str) -> None:
        with open(path, "w", encoding="utf-8") as f:
            json.dump(asdict(self), f, ensure_ascii=False, indent=2)

    def num_parameters(self, exclude_embeddings: bool = False) -> int:
        """按结构精确统计参数量（含词嵌入与输出头）。"""
        h = self.hidden_size
        hd = self.head_dim
        kv = self.num_key_value_heads
        inter = self.intermediate_size

        embed = self.vocab_size * h
        if self.tie_word_embeddings:
            lm_head = 0
        else:
            lm_head = self.vocab_size * h
        final_norm = h

        per_layer = (
            h * (self.num_attention_heads * hd)  # q_proj
            + h * (kv * hd)                      # k_proj
            + h * (kv * hd)                      # v_proj
            + (self.num_attention_heads * hd) * h  # o_proj
            + h * inter                          # gate_proj
            + h * inter                          # up_proj
            + inter * h                          # down_proj
            + 2 * h                              # 两个 RMSNorm
        )
        total = self.num_hidden_layers * per_layer + final_norm + lm_head
        if not exclude_embeddings:
            total += embed
        return total