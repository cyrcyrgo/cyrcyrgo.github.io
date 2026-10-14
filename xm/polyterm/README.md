# PolyTerm - 多语言终端模拟器

PolyTerm (Multi-Language Terminal Simulator Framework) 是一个运行在浏览器中的多语言终端模拟器，集成 Python、CMD 环境于一体，支持扩展包系统。

## 功能特性

- **多语言环境**：支持 Python (Pyodide)、CMD 环境
  （C++ 环境入口保留，但浏览器端没有内置编译器，切换后仅提示需使用本地 GCC/Clang/VS 编译，不会真的运行代码）
- **扩展包系统**：支持从 GitHub 加载第三方扩展包，动态添加新命令和功能
- **项目管理**：创建、编辑、运行、导出项目文件
- **AI 助手**：集成 OpenAI 兼容的 AI 聊天助手，可执行终端命令
- **主题切换**：支持多种终端颜色主题

## 快速开始

运行 `start.bat` 启动本地服务器，然后访问 http://localhost:3000