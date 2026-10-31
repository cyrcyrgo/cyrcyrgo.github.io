# cyrcyrgo.github.io · 作品归档

本仓库已精简为 **6 个核心项目**，作为全新官网（[newcyr.github.io](https://newcyr.github.io/)）的在线作品库与历史归档。

- 访问仓库首页会自动静默跳转到新官网：<https://newcyr.github.io/>
- 历史主页已迁移至 [`old/`](./old/index.html)：<https://cyrcyrgo.github.io/old/>

## 目录结构

```
cyrcyrgo.github.io/
├─ index.html      # 静默跳转至新官网
├─ 404.html        # 404 同样静默跳转到新官网
├─ old/            # 原版主页（历史归档）
└─ xm/             # 6 个核心项目
   ├─ llm/         # MiniLLM 精简大模型（含浏览器端模型权重）
   ├─ nt/          # WebNT 桌面系统
   ├─ polyterm/    # PolyTerm 多语言终端
   ├─ py/          # 蟒蛇 Python IDE
   ├─ lumina/      # Lumina Cloud Agent
   └─ gomoku/      # Gomoku 星阵五子棋
```

## 核心项目

| 项目 | 说明 | 入口 |
| --- | --- | --- |
| MiniLLM 精简大模型 | 从零实现并训练的精简 LLM，浏览器内实时推理 | `xm/llm/web/index.html` |
| WebNT 桌面系统 | 浏览器里的网页操作系统，窗口管理、任务栏与文件管理器 | `xm/nt/index.html` |
| PolyTerm 多语言终端 | 集成 Python / CMD 的浏览器终端，支持扩展包 | `xm/polyterm/index.html` |
| 蟒蛇 Python IDE | 在线运行 Python，集成文件管理与控制台 | `xm/py/index.html` |
| Lumina Cloud Agent | 运行在本机的自主 AI 智能体（含本机后端） | `xm/lumina/index.html` |
| Gomoku 星阵五子棋 | P2P 联机五子棋，支持内网直连与外网中继 | `xm/gomoku/index.html` |

## 说明

- 除 Lumina 需按 `xm/lumina/README.md` 启动本机后端外，其余项目均为纯前端，可直接在浏览器打开。
- 旧版主页的样式与交互保持不变，仅将项目链接修正为 `../xm/` 相对路径。
- 本项目集为个人学习与实践作品，仅供交流参考。
