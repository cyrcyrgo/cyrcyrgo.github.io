# MiniLLM · 从零实现并训练的精简大语言模型

一个**从零开始**（无任何高层封装）实现、训练并部署到浏览器运行的精简 LLM 项目。

- 在线演示：<https://cyrcyrgo.github.io/llm/>
- 架构完整复刻主流开源大模型：BPE 分词 → 嵌入层 + RoPE 位置编码 → N 层 Transformer 解码器（GQA 分组查询注意力 / SwiGLU 前馈 / RMSNorm / 残差连接）→ 权重共享输出头 → 采样生成（温度 / top-k / top-p / KV Cache）。
- 训练在本地用纯 PyTorch 从随机初始化开始，权重导出后**在浏览器内实时推理**，无需任何后端服务。

```
分词 → 嵌入(+RoPE) → N×解码器块(GQA+SwiGLU+RMSNorm+残差) → 输出头(共享权重) → 采样(KV Cache)
```

## 目录结构

```
llm/
├── configs/              模型配置（1B 与演示小模型）
│   ├── base_1b.json      1B 参数规模配置（995,973,120 参数，已校验）
│   └── mini_zh.json      本地可实际训练的中文演示模型（约 6.25M 参数）
├── minillm/              核心库（纯 PyTorch 手写）
│   ├── config.py         配置定义 + 参数量统计
│   ├── model.py          RMSNorm / RoPE / GQA 注意力 / SwiGLU MLP / 解码器 / MiniLLM
│   ├── generation.py     采样策略（贪心、温度、top-k、top-p）
│   └── __init__.py
├── scripts/              训练与导出脚本
│   ├── download_corpus.py   下载中文语料（公有领域古典文本）
│   ├── prepare_data.py      训练 BPE 分词器 + 编码语料
│   ├── train.py             训练脚本（AdamW + 余弦调度 + warmup + 梯度裁剪 + 断点续训）
│   ├── export_web.py        把权重导出为浏览器可加载的 manifest.json + weights.bin
│   ├── chat.py              命令行对话/续写测试
│   └── count_params.py      校验 1B 配置参数量
├── tokenizer/            BPE 分词器（vocab.json + merges.txt）
├── data/                 语料（raw 原文 / processed 编码后的 token 二进制，不入库）
├── checkpoints/          训练产物（不入库）
└── web/                  网页端
    ├── index.html        对话页面
    ├── app.js            初始化流程 + 对话 UI 逻辑
    ├── tokenizer.js      浏览器端 BPE 分词器（与 Python 端逐字节一致）
    ├── llm.js            浏览器端推理引擎（GQA / RoPE / SwiGLU / KV Cache）
    └── model/            导出的模型权重（manifest.json + weights.bin + 指标）
```

## 架构说明

| 组件 | 实现 | 说明 |
| --- | --- | --- |
| 分词器 | byte-level BPE | 词表 8192，特殊 token `<\|endoftext\|>`；Python（tokenizers）与浏览器（tokenizer.js）编码结果逐字节一致 |
| 嵌入层 | `nn.Embedding` | token → 向量 |
| 位置编码 | RoPE | 旋转位置编码，`theta=10000`，最大上下文 512 |
| 注意力 | GQA | 8 个查询头共享 2 个 KV 头（KV 头数 < 查询头数），推理时缓存 KV |
| 前馈网络 | SwiGLU | 中间维度 = 隐藏维度的 2.69 倍 |
| 归一化 | RMSNorm | Pre-Norm，置于注意力 / FFN 之前，`eps=1e-5` |
| 残差连接 | `x = x + attn(norm(x))` | 每个子层之后 |
| 输出头 | `Linear(h, vocab)` | 与词嵌入权重共享（tie_word_embeddings） |
| 生成 | 温度 / top-k / top-p | 贪心（温度=0）亦可；推理使用增量解码 + KV Cache |

## 1B 参数配置

`configs/base_1b.json`（结构完全同源，规模对齐真实精简 LLM 的中间档）：

| 配置项 | 值 |
| --- | --- |
| 词表 | 32,000 |
| 隐藏维度 | 2,048 |
| 层数 | 21 |
| 注意力头 / KV 头 | 16 / 4（GQA，4 组共享） |
| 前馈中间维度 | 5,504（隐藏维度 2.69×） |
| 最大上下文 | 4,096 |
| **参数量** | **995,973,120（≈1B，已校验）** |

> 该规模完整训练需要 GPU（权重即约 4 GB fp32）。本仓库同时提供**可在 2 核 CPU / 4GB 内存环境实际训练完成**的中文演示模型（`mini_zh.json`），并跑通「训练 → 导出 → 浏览器推理」全链路；把 `mini_zh.json` 的规模按 1B 配置替换后即为真实的 1B 训练。

## 快速开始

```bash
pip install torch numpy tokenizers

# 1. 下载语料（公有领域中文古典文本，约 20 MB）
python scripts/download_corpus.py --out data/raw

# 2. 训练 BPE 分词器并编码语料
python scripts/prepare_data.py --corpus-dir data/raw --tokenizer-dir tokenizer --vocab-size 8192 --out-dir data/processed

# 3. 训练模型（CPU 上约 2.5 小时完成 8000 步；按需调整 max-steps / batch-size）
python scripts/train.py --config configs/mini_zh.json --data-dir data/processed \
    --out-dir checkpoints/mini_zh --max-steps 8000

# 4. 命令行对话测试
python scripts/chat.py --ckpt checkpoints/mini_zh --tokenizer tokenizer --prompt "话说天下大势"

# 5. 导出为浏览器格式
python scripts/export_web.py --ckpt checkpoints/mini_zh --tokenizer tokenizer --out web/model

# 6. 本地预览网页
cd web && python3 -m http.server 8080   # 打开 http://localhost:8080
```

## 网页使用

打开 `web/index.html`：

1. 点击 **「开始使用」**，页面弹出初始化面板：加载分词器 → 下载权重（约 24 MB，首次）→ 构建模型。
2. 初始化完成后出现对话窗口，输入任意中文开头，模型会基于学到的语言分布**续写**。
3. 可调参数：温度（temperature）、top-k、top-p、生成长度；右上角实时显示生成速度（tok/s）。
4. 底部「训练曲线」展示交叉熵损失随步数下降的过程。

> 说明：该演示模型是**预训练阶段的中文基础语言模型**（续写式），并非指令微调的对齐对话模型；它的能力是「预测下一个 token」，因此表现为顺着输入继续写作。这正是完整 LLM 训练的第一阶段。

## 复现与训练环境

- 本次演示模型训练环境：2 核 CPU、4 GB 内存、PyTorch CPU 版；约 3730 tok/s，8000 步总步数。
- 语料：12 部公有领域中文古典文本，约 700 万字符（`data/raw/`），编码后约 565 万 token（训练集）+ 50 万（验证集）。
- 训练超参：batch 16 × block 256 = 4096 token/步，lr 2e-3 → 2e-4 余弦退火，warmup 200 步，权重衰减 0.1，梯度裁剪 1.0，AdamW(0.9, 0.95)。
- 一键复现脚本见 `scripts/`，训练指标记录在 `web/model/metrics.json`。

## 一致性验证

- 浏览器端推理引擎与 PyTorch 输出**完全一致**（同一权重、同一输入下逐 token 相同）。
- 浏览器端 BPE 分词器与 Python 端在中文、英文、数字、标点、emoji、空白等输入上逐字节一致。
