# MiniLLM · 从零实现并训练的精简大语言模型

一个**从零开始**（无任何高层封装）实现、训练并部署到浏览器运行的精简 LLM 项目。

- 在线演示：<https://cyrcyrgo.github.io/llm/web/>
- 架构完整复刻主流开源大模型：BPE 分词 → 嵌入层 + RoPE 位置编码 → N 层 Transformer 解码器（GQA 分组查询注意力 / SwiGLU 前馈 / RMSNorm / 残差连接）→ 权重共享输出头 → 采样生成（温度 / top-k / top-p / KV Cache）。
- 训练在本地用纯 PyTorch 从随机初始化开始，权重导出后**在浏览器内实时推理**，无需任何后端服务。

```
分词 → 嵌入(+RoPE) → N×解码器块(GQA+SwiGLU+RMSNorm+残差) → 输出头(共享权重) → 采样(KV Cache)
```

## 模型清单（浏览器内可切换）

网页端提供 **7 个**独立训练的精简模型，覆盖 7 种内容域：

| key | 内容域 | 类型 | 参数量 | 权重(fp16) |
| --- | --- | --- | --- | --- |
| `dialog` | 基础对话（中文） | 文本 | 8.35M | 33 MB (fp32) |
| `greet` | 基础问候闲聊 | 文本 | 34.56M | ~66 MB |
| `qa` | 中文知识问答 | 文本 | 35.69M | ~68 MB |
| `enqa` | English Q&A（英文问答） | 文本 | 34.51M | ~66 MB |
| `math` | 数学计算 / 应用题 | 文本 | 34.39M | ~66 MB |
| `html` | HTML 组件 / 小游戏 | 代码 | 8.35M | 33 MB (fp32) |
| `web` | 网页创作（HTML+CSS+JS） | 代码 | 34.91M | ~67 MB |

> 文本域模型统一为 **12 层 / 隐藏维度 512 / 8 查询头 / 2 KV 头 / SwiGLU 中间维度 1408**，
> 词表即各自语料实际训练出的 BPE 词表（不做 32k 词表的冗余填充，参数利用更充分），约 **35M 参数**。

## 目录结构

```
llm/
├── configs/              模型配置
│   ├── base_1b.json      1B 参数规模（995,973,120 参数）
│   ├── base_1_5b.json    1.5B 参数规模（1,489,423,104 参数）
│   ├── base_2b.json      2B 参数规模（2,027,174,400 参数）
│   ├── base_2_5b.json    2.5B 参数规模（2,494,149,120 参数）
│   ├── mini_zh.json      本地可训练的中文演示模型
│   └── mini_{greet,qa,enqa,math,web,html}.json  各内容域模型
├── minillm/              核心库（纯 PyTorch 手写）
│   ├── config.py         配置定义 + 参数量统计
│   ├── model.py          RMSNorm / RoPE / GQA 注意力 / SwiGLU MLP / 解码器 / MiniLLM
│   ├── generation.py     采样策略（贪心、温度、top-k、top-p）
│   └── __init__.py
├── scripts/              训练与导出脚本
│   ├── download_corpus.py      下载中文语料（公有领域古典文本）
│   ├── gen_*_synthetic.py      生成各内容域合成语料
│   ├── prepare_data.py         训练 BPE 分词器 + 编码语料
│   ├── train.py                训练脚本（AdamW + 余弦调度 + warmup + 梯度裁剪 + 断点续训）
│   ├── train_all.py            一键串行训练全部内容域模型
│   ├── export_web.py           导出为浏览器格式（支持 fp16）
│   ├── chat.py                 命令行对话/续写测试
│   └── count_params.py         校验配置参数量
├── tokenizer*/           BPE 分词器（vocab.json + merges.txt）
├── data/                 语料（raw 原文 / processed 编码后的 token 二进制，不入库）
├── checkpoints/          训练产物（不入库）
└── web/                  网页端
    ├── index.html        对话页面
    ├── app.js            初始化流程 + 对话 UI 逻辑（含 fp16 权重解码、代码框一键运行）
    ├── tokenizer.js      浏览器端 BPE 分词器（与 Python 端逐字节一致）
    ├── llm.js            浏览器端推理引擎（GQA / RoPE / SwiGLU / KV Cache）
    └── model/            导出的模型权重（manifest.json + weights.bin + 指标）
```

## 架构说明

| 组件 | 实现 | 说明 |
| --- | --- | --- |
| 分词器 | byte-level BPE | 词表按语料实际大小；特殊 token `<\|endoftext\|>`；Python（tokenizers）与浏览器（tokenizer.js）编码结果逐字节一致 |
| 嵌入层 | `nn.Embedding` | token → 向量 |
| 位置编码 | RoPE | 旋转位置编码，`theta=10000` |
| 注意力 | GQA | 查询头共享 KV 头（KV 头数 < 查询头数），推理时缓存 KV |
| 前馈网络 | SwiGLU | 中间维度 ≈ 隐藏维度的 2.75 倍 |
| 归一化 | RMSNorm | Pre-Norm，置于注意力 / FFN 之前，`eps=1e-5` |
| 残差连接 | `x = x + attn(norm(x))` | 每个子层之后 |
| 输出头 | `Linear(h, vocab)` | 与词嵌入权重共享（tie_word_embeddings） |
| 生成 | 温度 / top-k / top-p | 贪心（温度=0）亦可；推理使用增量解码 + KV Cache |

## 1B–2.5B 参数规模配置（已校验）

`configs/base_*.json`，结构与主线模型完全同源，仅规模不同，用于对照真实精简 LLM 的中间档：

| 配置 | 隐藏维度 | 层数 | 注意力头 / KV 头 | 中间维度 | 词表 | 参数量 |
| --- | --- | --- | --- | --- | --- | --- |
| `base_1b.json` | 2,048 | 21 | 16 / 4 | 5,504 | 32,000 | **995,973,120**（≈1B） |
| `base_1_5b.json` | 2,304 | 25 | 18 / 6 | 6,144 | 32,000 | **1,489,423,104**（≈1.5B） |
| `base_2b.json` | 2,560 | 28 | 20 / 8 | 6,912 | 32,000 | **2,027,174,400**（≈2B） |
| `base_2_5b.json` | 2,560 | 34 | 32 / 8 | 7,104 | 32,000 | **2,494,149,120**（≈2.5B） |

> 上述规模完整训练需要 GPU（2.5B 仅 fp32 权重即约 10 GB，训练显存更高）。本仓库同时提供
> **可在 2 核 CPU / 4GB 内存环境实际训练完成**的演示模型（`mini_*.json`，约 35M 参数），
> 并跑通「训练 → 导出 → 浏览器推理」全链路；把 `mini_*.json` 替换为任一 `base_*.json` 即为对应规模的真实训练。

## 快速开始

```bash
pip install torch numpy tokenizers

# 1. 生成/下载语料（data/*_raw/）
python scripts/download_corpus.py --out data/raw
python scripts/gen_domain_synthetic.py

# 2. 为每个内容域训练 BPE 分词器并编码语料
python scripts/prepare_data.py --corpus-dir data/greet_raw --tokenizer-dir tokenizer_greet \
    --vocab-size 8192 --out-dir data/greet_processed
# ... 其余域同理（qa/enqa/math/web/html/dialog）

# 3. 一键训练全部内容域模型（串行，适配 4GB 内存）
python scripts/train_all.py            # 或指定域：python scripts/train_all.py greet qa

# 4. 命令行测试
python scripts/chat.py --ckpt checkpoints/greet --tokenizer tokenizer_greet --prompt "你好"

# 5. 导出为浏览器格式（fp16，体积减半）
python scripts/export_web.py --ckpt checkpoints/greet --tokenizer tokenizer_greet \
    --out web/model/greet --dtype float16

# 6. 本地预览网页
cd web && python3 -m http.server 8080   # 打开 http://localhost:8080
```

## 网页使用

打开 `web/index.html`：

1. 顶部下拉框选择任意模型 → 点击 **「开始使用」**。
2. 页面弹出初始化面板：加载分词器 → 下载权重（fp16，约 20–70 MB，首次）→ 构建模型。
3. 初始化完成后出现对话窗口；代码类模型（`html` / `web`）会把生成结果渲染为**可一键运行**的代码框，并提供网页预览。
4. 可调参数：温度（temperature）、top-k、top-p、生成长度；右上角实时显示生成速度（tok/s）。
5. 底部「训练曲线」展示该模型交叉熵损失随步数下降的过程。

## 复现与训练环境

- 演示模型训练环境：2 核 CPU、4 GB 内存、PyTorch CPU 版。
- 内存约束：35M 参数模型在 `batch 6 × block 256` 下训练进程 RSS 约 2.3 GB，故 `train_all.py` 采用**串行**训练（并行会触及 4 GB 上限被 OOM 杀死）。
- 优化器 / 调度：AdamW(0.9, 0.95)，lr 3e-3 → 3e-4 余弦退火，warmup，权重衰减 0.1，梯度裁剪 1.0。
- 权重导出为 **fp16**（`--dtype float16`），浏览器端按 `manifest.dtype` 解码，体积与下载时间减半。
- 一键复现脚本见 `scripts/`，各模型训练指标记录在 `web/model/<key>/metrics.json`。

## 一致性验证

- 浏览器端推理引擎与 PyTorch 输出一致（fp16 权重相对 fp32 的最大偏差为半精度舍入级别）。
- 浏览器端 BPE 分词器与 Python 端在中文、英文、数字、标点、emoji、空白等输入上逐字节一致。