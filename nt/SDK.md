# WebNT SDK — 第三方应用开发指南

> **版本**: v1.0.0 | **最后更新**: 2026-07-12 | **适用内核**: WebNT HTML5 混合微内核

---

## 目录

- [1. 架构概览](#1-架构概览)
- [2. 快速开始](#2-快速开始)
- [3. 应用开发](#3-应用开发)
- [4. 核心 API 参考](#4-核心-api-参考)
- [5. 窗口管理](#5-窗口管理)
- [6. 文件系统](#6-文件系统)
- [7. 终端命令开发](#7-终端命令开发)
- [8. 进程管理](#8-进程管理)
- [9. 应用安装与分发](#9-应用安装与分发)
- [10. 安全与沙箱](#10-安全与沙箱)
- [11. 完整示例](#11-完整示例)
- [12. 常见问题](#12-常见问题)

---

## 1. 架构概览

### 1.1 内核架构

WebNT 采用 **混合微内核** 架构，共 7 层：

```
┌─────────────────────────────────────────┐
│  用户子系统 (User Subsystem)              │  ← 第三方应用运行层
│  ├─ 应用窗口 (App Windows)               │
│  ├─ 桌面组件 (Desktop Components)         │
│  └─ 第三方应用容器 (3rd-Party Sandbox)    │
├─────────────────────────────────────────┤
│  终端 (Terminal)                         │  ← 命令执行层
│  ├─ TerminalExecutor                     │
│  └─ TerminalCommandRegistry              │
├─────────────────────────────────────────┤
│  系统调用 (SysCall)                       │  ← 安全通信层
│  └─ SysCallBridge                        │
├─────────────────────────────────────────┤
│  驱动层 (Drivers)                        │
│  ├─ Display.WebGPU                       │
│  ├─ File.FS                              │
│  └─ Net.Stream                           │
├─────────────────────────────────────────┤
│  执行器 (Executor)                        │  ← 进程管理层
│  └─ ProcessManager / WindowManager       │
├─────────────────────────────────────────┤
│  微内核 (Microkernel)                     │  ← 核心调度
├─────────────────────────────────────────┤
│  HAL (硬件抽象层)                         │  ← 浏览器适配
└─────────────────────────────────────────┘
```

### 1.2 渲染管线

所有图形输出必须通过 `GlobalDisplay.API`，不直接操作 DOM/Canvas：

```
应用 → GlobalDisplay.API → WindowManager → SysCallBridge → 显示驱动 → 屏幕
```

### 1.3 技术栈

| 层级 | 技术 |
|------|------|
| 内核 | TypeScript → 内联 JavaScript |
| 渲染 | `<canvas>` / WebGPU |
| 组件 | Custom Elements + Shadow DOM |
| 样式 | CSS Container Queries + CSS Custom Properties |
| 通信 | postMessage / Event Bus |
| 存储 | localStorage / IndexedDB |

---

## 2. 快速开始

### 2.1 最小应用模板

创建一个独立的 HTML 文件作为第三方应用：

```html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>我的应用 - WebNT</title>
  <style>
    :root {
      --bg: #1a1a2e;
      --text: #e0e0e0;
      --accent: #667eea;
      --surface: rgba(255,255,255,0.04);
    }

    * { margin: 0; padding: 0; box-sizing: border-box; }

    body {
      font-family: 'Segoe UI', system-ui, -apple-system, sans-serif;
      background: var(--bg);
      color: var(--text);
      display: flex;
      flex-direction: column;
      height: 100vh;
      overflow: hidden;
    }

    .app-header {
      padding: 16px 20px;
      border-bottom: 1px solid rgba(255,255,255,0.08);
      display: flex;
      align-items: center;
      gap: 12px;
    }

    .app-header h1 { font-size: 16px; font-weight: 500; }

    .app-body {
      flex: 1;
      padding: 20px;
      overflow-y: auto;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 16px;
    }

    .app-body p { color: #888; font-size: 14px; }

    button {
      padding: 10px 24px;
      background: var(--accent);
      border: none;
      color: #fff;
      border-radius: 8px;
      cursor: pointer;
      font-size: 14px;
      transition: background 0.2s;
    }

    button:hover { background: #5a6fd6; }
  </style>
</head>
<body>
  <div class="app-header">
    <span style="font-size: 24px">📦</span>
    <h1>我的应用</h1>
  </div>
  <div class="app-body">
    <p>欢迎使用 WebNT 第三方应用开发框架</p>
    <button onclick="alert('Hello, WebNT!')">点击交互</button>
  </div>
</body>
</html>
```

### 2.2 通过应用商店安装

1. 将上述 HTML 部署到任意可访问的 URL（如 GitHub Pages、CDN）
2. 打开 WebNT 桌面 → 双击「应用商店」
3. 在「安装」标签页输入 URL
4. 点击「安装」按钮
5. 应用出现在桌面，双击即可启动

### 2.3 直接嵌入方式

如果需要在 WebNT 内部直接开发，可以修改 `index.html` 中的 `desktopApps` 数组：

```javascript
const desktopApps = [
  // ... 其他应用
  { id:'myapp', name:'我的应用', icon:'📦', color:'#667eea', appId:'myapp' },
];
```

然后在 `launchApp` 函数的 `switch` 中添加：

```javascript
case 'myapp':
  showAppWindow('我的应用', '📦', `
    <div style="display:flex;align-items:center;justify-content:center;height:100%;flex-direction:column;gap:16px">
      <div style="font-size:48px">📦</div>
      <div style="color:#e0e0e0;font-size:16px">我的第一个应用</div>
      <button onclick="alert('Hello!')" style="padding:10px 24px;background:#667eea;border:none;color:#fff;border-radius:8px;cursor:pointer">点击</button>
    </div>
  `);
  break;
```

---

## 3. 应用开发

### 3.1 应用类型

| 类型 | 适用场景 | 加载方式 |
|------|---------|---------|
| **内置应用** | 系统级功能（终端、设置等） | 直接编写在 `launchApp` 中 |
| **第三方应用** | 用户安装的外部应用 | 通过应用商店安装，iframe 沙箱加载 |
| **终端命令** | 命令行工具 | 注册到 `TerminalCommandRegistry` |
| **桌面组件** | 面板、Widget | 内联 HTML 或 Custom Element |

### 3.2 应用生命周期

```
安装 → 注册 → 启动 → 运行 → 关闭 → 卸载
  │      │      │      │      │       │
  │      │      │      │      │       └─ 从 localStorage 移除
  │      │      │      │      └─ 窗口销毁，进程终止
  │      │      │      └─ 窗口可见，用户交互
  │      │      └─ showAppWindow() 创建窗口
  │      └─ desktopApps 数组 / 开始菜单
  └─ localStorage 持久化
```

### 3.3 应用元数据

每个应用必须定义以下元数据：

```typescript
interface AppManifest {
  id: string;       // 唯一标识符，如 "myapp" 或 "ext_1234567890"
  name: string;     // 显示名称，如 "我的应用"
  icon: string;     // 图标（emoji 或 SVG URL）
  color: string;    // 主题色，6 位 hex，如 "#667eea"
  appId: string;    // 启动时传入 launchApp 的标识符
  url?: string;     // 第三方应用：HTML 文件的 URL
  version?: string; // 版本号
  author?: string;  // 作者
  description?: string; // 描述
}
```

---

## 4. 核心 API 参考

### 4.1 GlobalDisplay.API

全局显示 API，所有渲染操作的入口。

```javascript
// 获取显示 API 实例
const display = window.__WebNT__.GlobalDisplayAPI.instance;

// 创建画布
const canvas = display.createCanvas(width, height);

// 获取 2D 上下文
const ctx = display.getContext2D(canvas);

// 获取 WebGPU 上下文
const gpuCtx = display.getWebGPUContext(canvas);

// 渲染到屏幕
display.render(canvas, x, y, zIndex);
```

### 4.2 WindowManager

窗口生命周期管理。

```javascript
const wm = window.__WebNT__.WindowManager.instance;

// 创建窗口
const win = wm.createWindow({
  title: '我的窗口',
  appId: 'myapp',
  icon: '📦',
  width: 600,
  height: 400,
  x: 200,
  y: 100,
  minWidth: 300,
  minHeight: 200,
  resizable: true,
  onClose: () => console.log('窗口已关闭'),
});

// 获取窗口列表
const windows = wm.getWindowList();

// 聚焦窗口
wm.focusWindow(win.id);

// 关闭窗口
wm.closeWindow(win.id);

// 最小化窗口
wm.minimizeWindow(win.id);
```

### 4.3 SysCallBridge

系统调用桥接，用于跨线程安全通信。

```javascript
const bridge = window.__WebNT__.SysCallBridge.instance;

// 发送系统调用
bridge.call('sys.getInfo', { key: 'version' })
  .then(result => console.log(result));

// 注册回调
bridge.on('sys.event', (data) => {
  console.log('系统事件:', data);
});

// 常用系统调用
bridge.call('sys.getInfo', { key: 'cpu' });      // CPU 信息
bridge.call('sys.getInfo', { key: 'memory' });   // 内存信息
bridge.call('sys.getInfo', { key: 'uptime' });   // 运行时间
bridge.call('fs.readdir', { path: '/' });        // 读取目录
bridge.call('fs.readFile', { path: '/doc.txt' }); // 读取文件
```

### 4.4 TerminalCommandRegistry

注册自定义终端命令。

```javascript
const registry = window.__WebNT__.TerminalCommandRegistry.instance;

// 注册命令
registry.register({
  name: 'hello',
  description: '打招呼',
  category: '用户',
  execute: (args, options) => {
    return `你好，${args[0] || '世界'}！`;
  }
});
```

### 4.5 全局工具函数

```javascript
// 创建应用窗口（最常用）
showAppWindow(title, icon, bodyHTML);
// 参数:
//   title   - 窗口标题
//   icon    - 标题栏图标 (emoji)
//   bodyHTML - 窗口内容 HTML（支持内联 <style>）

// 终端输出
writeTerminal(text, className);
// 参数:
//   text      - 输出文本
//   className - 可选样式: 'info' | 'ok' | 'warn' | 'err'

// 启动应用
launchApp(appId);

// 显示右键菜单
showContextMenu(x, y, items);
// items: [{ label, action, separator }]

// 添加桌面图标
addDesktopIcon(id, name, icon, color, appId);

// 刷新桌面图标
renderDesktopIcons();
```

---

## 5. 窗口管理

### 5.1 创建应用窗口

```javascript
// 方式 1：使用 showAppWindow（推荐）
showAppWindow('计算器', '🧮', `
  <style>
    .my-calc { display: grid; grid-template-columns: repeat(4, 1fr); gap: 4px; }
    .my-calc button { padding: 12px; font-size: 16px; }
  </style>
  <div class="my-calc">
    <button>7</button><button>8</button><button>9</button><button>+</button>
    <button>4</button><button>5</button><button>6</button><button>-</button>
    <button>1</button><button>2</button><button>3</button><button>*</button>
    <button>0</button><button>.</button><button>=</button><button>/</button>
  </div>
`);

// 方式 2：手动创建窗口元素
const win = document.createElement('div');
win.className = 'app-window';
win.innerHTML = `
  <div class="aw-titlebar">
    <span>📦</span> <span class="aw-title">我的应用</span>
    <div class="aw-ctrl">
      <button class="aw-ctrl-btn" onclick="this.closest('.app-window').style.display='none'">—</button>
      <button class="aw-ctrl-btn" onclick="const w=this.closest('.app-window');w.style.width='100vw';w.style.height='calc(100vh - 48px)';w.style.left='0';w.style.top='0'">□</button>
      <button class="aw-ctrl-btn close" onclick="this.closest('.app-window').remove()">✕</button>
    </div>
  </div>
  <div class="aw-body">内容区域</div>
`;
document.getElementById('app-root').appendChild(win);
```

### 5.2 窗口 CSS 类

| 类名 | 用途 |
|------|------|
| `.app-window` | 应用窗口容器 |
| `.aw-titlebar` | 标题栏（可拖拽） |
| `.aw-title` | 标题文字 |
| `.aw-ctrl` | 控制按钮组 |
| `.aw-ctrl-btn` | 控制按钮（最小化/最大化/关闭） |
| `.aw-ctrl-btn.close` | 关闭按钮 |
| `.aw-body` | 内容区域 |

### 5.3 窗口交互

```javascript
// 拖拽：在 aw-titlebar 上绑定 pointerdown/pointermove/pointerup
// 调整大小：在窗口右下角添加 resize 手柄
// 聚焦：点击窗口时提升 z-index

// 窗口聚焦示例
win.addEventListener('pointerdown', () => {
  // 将所有窗口 z-index 降低
  document.querySelectorAll('.app-window').forEach(w => {
    w.style.zIndex = Math.max(50, parseInt(w.style.zIndex) - 1);
  });
  // 当前窗口提到最高
  win.style.zIndex = 200;
});
```

---

## 6. 文件系统

### 6.1 虚拟文件系统

WebNT 使用虚拟文件系统，数据存储在内存中：

```
/
├── 下载/
├── 文档/
│   ├── readme.txt
│   ├── 笔记.txt
│   └── 项目计划.txt
├── 桌面/
│   └── 快捷方式.lnk
├── 系统/
│   ├── kernel.config
│   ├── drivers.json
│   └── boot.log
└── 临时/
    ├── cache.dat
    └── 日志.log
```

### 6.2 文件系统 API

```javascript
// 通过 SysCallBridge 访问文件系统
const bridge = window.__WebNT__.SysCallBridge.instance;

// 读取目录
bridge.call('fs.readdir', { path: '/文档' })
  .then(files => console.log('文件列表:', files));

// 读取文件
bridge.call('fs.readFile', { path: '/文档/readme.txt' })
  .then(content => console.log('文件内容:', content));

// 写入文件
bridge.call('fs.writeFile', {
  path: '/文档/新建.txt',
  content: 'Hello, WebNT!'
});

// 删除文件
bridge.call('fs.delete', { path: '/临时/cache.dat' });
```

### 6.3 通过 localStorage 持久化

```javascript
// 读取
const data = JSON.parse(localStorage.getItem('myapp_data') || '{}');

// 写入
localStorage.setItem('myapp_data', JSON.stringify({
  settings: { theme: 'dark' },
  lastSaved: Date.now()
}));
```

---

## 7. 终端命令开发

### 7.1 注册自定义命令

```javascript
const registry = window.__WebNT__.TerminalCommandRegistry.instance;

// 简单命令
registry.register({
  name: 'hello',
  description: '输出问候语',
  category: '自定义',
  execute: (args) => `你好，${args[0] || '世界'}！`
});

// 带选项的命令
registry.register({
  name: 'calc',
  description: '简单计算器',
  category: '工具',
  execute: (args, options) => {
    const expr = args.join(' ');
    try {
      const result = Function('"use strict"; return (' + expr + ')')();
      return `结果: ${result}`;
    } catch(e) {
      return `错误: ${e.message}`;
    }
  }
});

// 异步命令
registry.register({
  name: 'fetch',
  description: '获取 URL 内容',
  category: '网络',
  execute: async (args) => {
    const url = args[0];
    if(!url) return '用法: fetch <url>';
    const resp = await fetch(url);
    const text = await resp.text();
    return text.substring(0, 500);
  }
});
```

### 7.2 命令规范

| 规范 | 说明 |
|------|------|
| 命名 | 小写字母，不含空格，如 `mycommand` |
| 描述 | 简短说明命令功能（中文） |
| 分类 | SYSTEM / PROCESS / FILE / UTILITY / NETWORK / DEVICE / 自定义 |
| 返回值 | 字符串（`'__CLEAR__'` 表示清屏） |
| 参数 | `args: string[]`，按空格分割 |
| 选项 | `options: object`，如 `{ '-l': true }` |

---

## 8. 进程管理

### 8.1 ProcessManager

```javascript
const pm = window.__WebNT__.ProcessManager;

// 创建进程（每个应用窗口 = 一个进程）
const pid = pm.createProcess({
  name: '我的应用',
  type: 'application',
  windowId: 'appwin_5',
  priority: 'normal',  // 'low' | 'normal' | 'high'
});

// 获取进程列表
const processes = pm.getProcessList();

// 终止进程
pm.killProcess(pid);

// 监听进程事件
pm.on('process.created', (proc) => console.log('进程创建:', proc));
pm.on('process.killed', (pid) => console.log('进程终止:', pid));
```

### 8.2 进程优先级

| 优先级 | 说明 | 适用场景 |
|--------|------|---------|
| `low` | 后台运行 | 定时任务、后台同步 |
| `normal` | 默认 | 普通应用 |
| `high` | 高优先级 | 系统服务、UI 渲染 |

---

## 9. 应用安装与分发

### 9.1 应用商店架构

应用商店分为两个标签页：

| 标签 | 说明 |
|------|------|
| **官方应用** | 已注册的第三方应用列表，按注册顺序排列，可查看详情页并安装 |
| **链接扫描** | 输入链接或 SDK 特征码，自动匹配已注册应用 |

### 9.2 应用注册规范

开发者需要将应用信息注册到 `storeRegistry` 数组：

```javascript
const storeRegistry = [
  {
    id: 'snake',                    // 唯一标识符（小写，不含空格）
    name: '贪吃蛇',                  // 显示名称
    icon: '🐍',                     // 图标（emoji）
    color: '#81c995',               // 主题色
    version: '2.1.0',               // 版本号（语义化版本）
    author: 'WebNT Labs',           // 作者/组织
    category: '游戏',               // 分类：游戏/工具/生活/教育/开发
    url: 'https://example.com/app', // 安装 URL（HTTPS）
    description: '应用简介...',      // 简短描述（30-50 字）
    features: [                     // 功能特性列表（3-5 项）
      '经典街机玩法',
      '5 档难度选择',
      '本地排行榜',
    ],
    permissions: [                  // 所需权限
      'storage: 存储排行榜数据',
      'network: 获取在线数据',
    ],
    images: [                       // 应用截图（SVG/PNG/JPG URL）
      'https://example.com/screenshot1.png',
    ],
  },
];
```

### 9.3 SDK 特征码系统

开发者必须在应用 HTML 页面的 `<head>` 中声明 SDK 特征码：

```html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <!-- SDK 特征码：webnt-app:<应用ID>:<版本号> -->
  <meta name="webnt-app" content="snake:2.1.0">
  <meta name="webnt-app-version" content="2.1.0">
  <meta name="webnt-app-id" content="snake">
  <title>贪吃蛇 - WebNT</title>
</head>
```

特征码格式：
```
webnt-app:<app-id>:<version>
```

示例：
- `webnt-app:snake:2.1.0` — 贪吃蛇 v2.1.0
- `webnt-app:tetris:1.0.0` — 俄罗斯方块 v1.0.0
- `webnt-app:mdeditor:1.2.0` — Markdown 编辑器 v1.2.0

### 9.4 链接扫描流程

```
用户输入 URL/特征码
    │
    ├─ 匹配特征码格式: /webnt-app:([a-zA-Z0-9_-]+):?([\d.]+)?/
    │   └─ 找到 → 显示匹配应用卡片
    │
    ├─ 匹配 URL 文件名: /([a-zA-Z0-9_-]+)\.html?$/
    │   └─ 找到 → 模糊匹配已注册应用
    │
    └─ 未匹配 → 提示未找到
```

### 9.5 版本检测与更新机制

```javascript
// 安装时记录版本号
const newApp = {
  id: 'ext_snake_1690000000000',
  storeId: 'snake',
  name: '贪吃蛇',
  url: 'https://example.com/snake.html',
  icon: '🐍',
  color: '#81c995',
  version: '2.0.0',  // 安装时的版本
};

// 应用商店检测版本差异
const installed = getInstalled('snake');
const registry = storeRegistry.find(a => a.id === 'snake');
const hasUpdate = installed.version !== registry.version;

// 如果有更新，详情页显示"更新至 v2.1.0"按钮
// 更新操作: 更新 URL + 版本号
```

### 9.6 localStorage 数据结构

```json
[
  {
    "id": "ext_snake_1690000000000",
    "storeId": "snake",
    "name": "贪吃蛇",
    "url": "https://example.com/snake.html",
    "icon": "🐍",
    "color": "#81c995",
    "version": "2.0.0"
  }
]
```

### 9.7 应用 URL 要求

- 必须使用 **HTTPS**（iframe 沙箱要求）
- 支持 CORS 跨域
- 建议部署到 GitHub Pages、Vercel、Netlify 等平台
- 文件大小建议 < 5MB
- 必须在 HTML 中声明 SDK 特征码 meta 标签

### 9.8 分发渠道

| 渠道 | 方式 | 特征码 |
|------|------|--------|
| 应用商店官方 | 注册到 storeRegistry，用户通过详情页安装 | 自动识别 |
| 链接扫描 | 用户输入 URL，自动匹配特征码 | `webnt-app:id:version` |
| 直接安装 | 分享应用 URL，用户手动输入 | meta 标签声明 |
| 终端安装 | `install <url>` 命令 | 计划中 |

---

## 10. 安全与沙箱

### 10.1 沙箱模型

第三方应用通过 `<iframe>` 沙箱加载，受以下限制：

```html
<iframe
  sandbox="allow-scripts allow-same-origin"
  src="https://example.com/app.html"
></iframe>
```

| 权限 | 状态 | 说明 |
|------|------|------|
| `allow-scripts` | ✅ 允许 | JavaScript 执行 |
| `allow-same-origin` | ✅ 允许 | 同源访问 |
| `allow-forms` | ❌ 禁止 | 表单提交 |
| `allow-popups` | ❌ 禁止 | 弹窗 |
| `allow-top-navigation` | ❌ 禁止 | 顶层导航 |
| `allow-modals` | ❌ 禁止 | 模态对话框 |

### 10.2 安全规则

1. **不直接访问 DOM**：第三方应用在 iframe 内运行，无法操作主页面 DOM
2. **数据隔离**：每个应用使用独立的 localStorage 命名空间
3. **网络隔离**：iframe 内的网络请求受浏览器同源策略限制
4. **代码审查**：内置应用需经过代码审查

### 10.3 与宿主通信

```javascript
// 子应用 → 宿主
window.parent.postMessage({
  type: 'webnt.app.event',
  payload: { action: 'ready', data: {} }
}, '*');

// 宿主 → 子应用
iframe.contentWindow.postMessage({
  type: 'webnt.system.event',
  payload: { event: 'themeChanged', theme: 'dark' }
}, '*');
```

---

## 11. 完整示例

### 11.1 待办事项应用

```html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>待办事项 - WebNT</title>
  <style>
    :root { --bg: #1a1a2e; --text: #e0e0e0; --accent: #667eea; }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: system-ui, sans-serif;
      background: var(--bg);
      color: var(--text);
      padding: 16px;
      height: 100vh;
      overflow-y: auto;
    }
    h1 { font-size: 18px; margin-bottom: 16px; }
    .input-row { display: flex; gap: 8px; margin-bottom: 16px; }
    .input-row input {
      flex: 1;
      padding: 10px 14px;
      background: rgba(255,255,255,0.06);
      border: 1px solid rgba(255,255,255,0.1);
      border-radius: 8px;
      color: #fff;
      font-size: 14px;
      outline: none;
    }
    .input-row input:focus { border-color: var(--accent); }
    .input-row button {
      padding: 10px 20px;
      background: var(--accent);
      border: none;
      color: #fff;
      border-radius: 8px;
      cursor: pointer;
      font-size: 14px;
    }
    .todo-item {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 10px 12px;
      background: rgba(255,255,255,0.04);
      border-radius: 8px;
      margin-bottom: 6px;
    }
    .todo-item.done span { text-decoration: line-through; color: #666; }
    .todo-item input[type=checkbox] { accent-color: var(--accent); }
    .todo-item span { flex: 1; font-size: 14px; }
    .todo-item button {
      background: none;
      border: none;
      color: #f28b82;
      cursor: pointer;
      font-size: 16px;
      padding: 2px 6px;
    }
    .empty { text-align: center; color: #666; padding: 40px; font-size: 14px; }
  </style>
</head>
<body>
  <h1>📋 待办事项</h1>
  <div class="input-row">
    <input type="text" id="todo-input" placeholder="添加新任务..." onkeydown="if(event.key==='Enter')addTodo()">
    <button onclick="addTodo()">添加</button>
  </div>
  <div id="todo-list"></div>

  <script>
    const STORAGE_KEY = 'webnt_todo_app_data';

    function loadTodos() {
      try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'); }
      catch(e) { return []; }
    }

    function saveTodos(todos) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(todos));
    }

    function render() {
      const todos = loadTodos();
      const list = document.getElementById('todo-list');
      if(todos.length === 0) {
        list.innerHTML = '<div class="empty">暂无任务，添加一个吧！</div>';
        return;
      }
      list.innerHTML = todos.map((t, i) => `
        <div class="todo-item ${t.done ? 'done' : ''}">
          <input type="checkbox" ${t.done ? 'checked' : ''} onchange="toggle(${i})">
          <span>${t.text}</span>
          <button onclick="remove(${i})" title="删除">✕</button>
        </div>
      `).join('');
    }

    function addTodo() {
      const input = document.getElementById('todo-input');
      const text = input.value.trim();
      if(!text) return;
      const todos = loadTodos();
      todos.push({ text, done: false });
      saveTodos(todos);
      input.value = '';
      render();
    }

    function toggle(index) {
      const todos = loadTodos();
      todos[index].done = !todos[index].done;
      saveTodos(todos);
      render();
    }

    function remove(index) {
      const todos = loadTodos();
      todos.splice(index, 1);
      saveTodos(todos);
      render();
    }

    render();
  </script>
</body>
</html>
```

### 11.2 终端命令示例

```javascript
// 注册一个天气命令
window.__WebNT__.TerminalCommandRegistry.instance.register({
  name: 'weather',
  description: '显示天气信息',
  category: '工具',
  execute: (args) => {
    const city = args[0] || '北京';
    return `城市: ${city}\n温度: ${20 + Math.floor(Math.random() * 15)}°C\n天气: 晴\n湿度: ${30 + Math.floor(Math.random() * 40)}%`;
  }
});
```

### 11.3 桌面小部件

```javascript
// 在桌面上添加一个时钟小部件
function createClockWidget() {
  const widget = document.createElement('div');
  widget.style.cssText = `
    position: absolute; right: 20px; top: 20px; z-index: 10;
    background: rgba(0,0,0,0.5); color: #fff; padding: 16px 20px;
    border-radius: 12px; font-size: 24px; font-family: monospace;
    backdrop-filter: blur(10px);
  `;
  widget.id = 'desktop-clock-widget';
  document.getElementById('app-root').appendChild(widget);
  setInterval(() => {
    widget.textContent = new Date().toLocaleTimeString('zh-CN', { hour12: false });
  }, 1000);
}
```

---

## 12. 常见问题

### Q1: 应用窗口无法显示？
- 检查 `showAppWindow` 的 `bodyHTML` 参数是否正确闭合
- 确认模板字符串中的 `${}` 插值是否在正确的上下文中
- 打开浏览器开发者工具查看 Console 错误

### Q2: 第三方应用 iframe 白屏？
- 确认 URL 使用 HTTPS 协议
- 检查目标服务器是否设置了正确的 CORS 头
- 确认 `sandbox` 属性包含 `allow-scripts`

### Q3: localStorage 数据丢失？
- 检查存储键名是否正确
- 确认数据大小不超过 5MB（localStorage 限制）
- 使用 try-catch 包裹 JSON.parse/stringify

### Q4: 如何调试应用？
- 内置应用：在 Chrome DevTools 中直接调试 `index.html`
- 第三方应用：右键 iframe → 在新标签页打开 → 单独调试
- 终端命令：使用 `echo` 输出调试信息

### Q5: 如何贡献内置应用？
1. Fork 主仓库
2. 在 `desktopApps` 添加应用元数据
3. 在 `launchApp` 添加应用逻辑
4. 在 `renderStartMenu` 添加菜单项
5. 提交 Pull Request

---

## 附录 A: 颜色方案

```css
/* 系统主题色变量 */
--sys-bg: #1a1a2e;           /* 背景色 */
--sys-surface: rgba(255,255,255,0.04); /* 表面色 */
--sys-border: rgba(255,255,255,0.08);  /* 边框色 */
--sys-text: #e0e0e0;         /* 主文字色 */
--sys-text-secondary: #888;  /* 次要文字色 */
--sys-accent: #667eea;       /* 强调色 */
--sys-success: #81c995;      /* 成功色 */
--sys-warning: #ff9800;      /* 警告色 */
--sys-error: #f28b82;        /* 错误色 */
```

## 附录 B: 图标参考

| 图标 | Emoji | 用途 |
|------|-------|------|
| 📁 | `\ud83d\udcc1` | 文件夹 |
| 📄 | `\ud83d\udcc4` | 文档 |
| 🖥️ | `\ud83d\udda5\ufe0f` | 计算机 |
| ⚙️ | `\u2699\ufe0f` | 设置 |
| 🌐 | `\ud83c\udf10` | 网络/浏览器 |
| 📦 | `\ud83d\udce6` | 第三方应用 |
| 🎨 | `\ud83c\udfa8` | 画图/设计 |
| 📝 | `\ud83d\udcdd` | 写字板/编辑 |
| 🧮 | `\ud83d\uddd2\ufe0f` | 计算器 |
| 📅 | `\ud83d\udcc5` | 日历 |
| 🛒 | `\ud83d\uded2` | 应用商店 |
| 📊 | `\ud83d\udcca` | 任务管理 |
| 💻 | `\ud83d\udcbb` | 系统监控 |
| 🗑️ | `\ud83d\uddd1\ufe0f` | 回收站 |

---

> **WebNT SDK v1.0.0** — 构建下一代 Web 操作系统应用
>
> 项目地址: [GitHub](https://github.com/cyrcyrgo/cyrcyrgo.github.io)