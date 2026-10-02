# YJS LLM Agent

一个运行在本机的自主 AI 智能体：用邮箱验证码登录，创建对话并下发任务，
本地模型（Ollama + `qwen3.5:9b`）驱动 Agent 直接操作这台电脑 —— 读写/删除文件、
执行 Python / Node.js / PowerShell、发送 HTTP 请求、控制浏览器、调用 MCP 服务器，
最后把产出文件与汇报返回给用户。

## 架构

```
浏览器 (GitHub Pages 前端)  ──HTTPS──▶  ngrok 隧道  ──▶  本机 FastAPI 后端
                                                          ├─ Ollama qwen3.5:9b
                                                          ├─ Agent 工具集
                                                          └─ D:\yjs\data\users\<用户>  (1GB 配额)
```

- **前端**：静态页面，托管在 `https://cyrcyrgo.github.io/yjs/llm/`
- **后端**：本机 `http://127.0.0.1:8787`，经 ngrok 暴露为公网地址
- **URL 自动同步**：ngrok 免费版地址会变化，后端检测到变化后自动把新地址
  写入仓库 `config.json`，前端据此自动重连。

## 目录

```
D:\yjs
├─ index.html / assets/        前端
├─ server/                     后端
├─ config.local.json           密钥（不提交）
├─ config.json                 前端运行时配置（自动更新 api_url）
├─ data/users/<uid>/           每用户：conversations/ workspace/ files/
└─ bin/                        ngrok.exe 等
```

## 启动

```powershell
# 1) 安装 Ollama 并拉取模型
ollama pull qwen3.5:9b

# 2) 启动服务
.\start.ps1
```

## 工具能力

| 工具 | 说明 |
| --- | --- |
| `list_files` / `read_file` / `write_file` / `make_dir` / `delete_path` / `move_path` | 文件读写删除 |
| `run_python` / `run_node` / `run_shell` | 代码与命令执行 |
| `http_request` | 发送 HTTP 请求 |
| `browser` | 无头浏览器（导航/点击/输入/截图） |
| `mcp_list_servers` / `mcp_list_tools` / `mcp_call` | 调用 MCP 服务器 |
| `report_file` / `finish` | 登记产出文件 / 提交汇报 |

## 安全提示

- 后端默认只监听 `127.0.0.1`，仅通过 ngrok 隧道对外；请勿改为 `0.0.0.0`。
- `config.local.json` 含 GitHub token、ngrok token、邮箱授权码，**永远不要提交**。
- 该 Agent 可执行任意代码，请仅在可信环境使用，并在泄露后及时轮换所有密钥。