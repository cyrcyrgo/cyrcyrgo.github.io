# MLTSF 第三方扩展插件 SDK 开发说明文档

> **版本**: v3.0  
> **适用**: MLTSF 可扩展多语言终端模拟器  
> **日期**: 2026-06-13

---

## 📑 目录

1. [概述](#1-概述)
2. [扩展包目录结构](#2-扩展包目录结构)
3. [扩展包配置文件 extension.json](#3-扩展包配置文件-extensionjson)
4. [主入口 main.js - 开发指南](#4-主入口-mainjs---开发指南)
5. [API 参考手册](#5-api-参考手册)
6. [UI 组件样式参考](#6-ui-组件样式参考)
7. [完整示例扩展包](#7-完整示例扩展包)
8. [自动化脚本示例](#8-自动化脚本示例)
9. [扩展包的安装与调试](#9-扩展包的安装与调试)
10. [最佳实践与安全建议](#10-最佳实践与安全建议)

---

## 1. 概述

MLTSF 扩展系统允许第三方开发者创建功能丰富的扩展包。**v3.0 版本**引入了以下核心能力：

| 能力 | 说明 |
|------|------|
| **🎨 图形化资源** | 扩展包可以加载 CSS 样式文件、JavaScript 脚本文件，实现丰富的 UI 渲染 |
| **📦 富UI组件** | 内置面板、对话框、按钮、进度条、表格等组件，可直接在终端中渲染 |
| **🤖 命令自动化** | 扩展包可以编程调用任何终端命令（包括其他扩展的命令），实现自动化工作流 |
| **💾 配置持久化** | 每个扩展包拥有独立的 localStorage 命名空间，安全读写配置 |
| **🔗 扩展间通信** | 事件系统支持扩展包之间相互通信，形成协同生态 |
| **📁 文件系统访问** | 扩展包可以读写 MLTSF 项目文件 |
| **⏳ 自动加载** | 扩展包可配置随终端自动加载 |

---

## 2. 扩展包目录结构

一个完整的 MLTSF 扩展包推荐以下目录结构：

```
my-extension/
├── extension.json        # 扩展包配置文件 (必需)
├── main.js               # 扩展包主逻辑入口 (必需)
│
├── style.css             # 扩展包样式文件 (可选，通过 styles 字段加载)
├── template.html         # HTML 模板 (可选，可通过 fetch 加载)
├── helper.js             # 辅助脚本 (可选，通过 scripts 字段或 loadScript 加载)
│
├── assets/               # 静态资源目录 (可选)
│   ├── logo.png          # 扩展包图标
│   ├── icon.svg          # SVG 图标
│   └── data.json         # 数据文件
│
└── README.md             # 扩展包说明文档 (推荐)
```

### 托管方式

扩展包可以托管在以下位置：

| 托管方式 | 安装命令 | 说明 |
|----------|----------|------|
| GitHub 仓库 | `/ar 用户名/仓库名` | 自动从 GitHub 发现扩展包 |
| GitHub 直链 | `/az https://...` | 从任意 URL 加载 |
| jsDelivr CDN | 自动回退 | 系统自动使用 jsDelivr 作为 CDN 后备 |

---

## 3. 扩展包配置文件 extension.json

### 完整字段说明

```json
{
    "name": "my-extension",
    "version": "1.0.0",
    "description": "我的第一个扩展包",
    "author": "开发者名",
    "icon": "assets/icon.svg",

    "main": "main.js",
    "styles": ["style.css"],
    "scripts": ["helper.js"],

    "dependencies": ["ext-a", "ext-b"],
    "autoLoad": false,

    "permissions": [
        "network",
        "storage",
        "ui"
    ],

    "commands": [
        {
            "name": "hello",
            "description": "向世界打招呼"
        },
        {
            "name": "weather",
            "description": "查询指定城市的天气"
        }
    ]
}
```

### 字段详解

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `name` | string | ✅ | 扩展包唯一标识名，只能包含小写字母、数字和连字符 |
| `version` | string | ✅ | 语义化版本号，如 `1.0.0` |
| `description` | string | 推荐 | 简短描述扩展包的功能 |
| `author` | string | 推荐 | 开发者名称或 GitHub 用户名 |
| `icon` | string | 可选 | 扩展包图标路径（相对于包根目录） |
| `main` | string | 可选 | 入口文件路径，默认 `main.js` |
| `styles` | string[] | 可选 | 需要自动加载的 CSS 文件列表 |
| `scripts` | string[] | 可选 | 需要在 main.js 之前预加载的 JS 文件列表 |
| `dependencies` | string[] | 可选 | 依赖的其他扩展包名称列表 |
| `autoLoad` | boolean | 可选 | `true` 则终端启动时自动加载（默认 `false`）|
| `permissions` | string[] | 可选 | 权限声明（`network`/`storage`/`ui`）|
| `commands` | object[] | ✅ | 本扩展注册的命令列表 |

---

## 4. 主入口 main.js - 开发指南

### 4.1 基本结构

扩展包的 `main.js` 使用 **IIFE（立即执行函数）** 模式通过 `window.ExtensionAPI` 与系统交互：

```javascript
// my-extension/main.js
(function() {
    var api = window.ExtensionAPI;

    // 1. 注册命令
    api.registerCommand('hello', {
        description: '向世界打招呼',
        handler: function(args, terminal) {
            var name = args[0] || 'World';
            api.print('Hello, ' + name + '! 👋');
            api.printHtml('<span style="color:#00ff00">欢迎使用扩展包开发！</span>');
        }
    });

    // 2. 监听事件
    api.on('ready', function() {
        api.print('[my-extension] 扩展包已就绪');
    });

    // 3. 加载资源（CSS/JS 等）
    // api.loadCSS('style.css');
    // api.loadScript('helper.js');
})();
```

### 4.2 开发模式

所有扩展包的 `main.js` 应遵循以下原则：

1. **使用 IIFE 包裹代码**，避免污染全局作用域
2. **通过 `api` 变量** 引用 `window.ExtensionAPI`，不要直接使用 `window` 操作
3. **异步操作** 推荐使用 `async/await` 风格
4. **错误处理** 关键操作使用 try/catch 包裹

---

## 5. API 参考手册

### 5.1 命令注册

#### `registerCommand(name, definition)`

注册一个可在终端中调用的自定义命令。

**参数**:
- `name` (string): 命令名，可以带 `/` 或不带
- `definition.description` (string): 命令描述
- `definition.handler` (function): `(args, terminal) => {}`，`args` 是参数数组，`terminal` 是终端对象

**示例**:
```javascript
api.registerCommand('greet', {
    description: '向指定用户打招呼',
    handler: function(args, terminal) {
        var user = args[0] || '朋友';
        terminal.println('你好, ' + user + '!');
    }
});
// 在终端输入: /greet 张三
```

---

### 5.2 终端输出

#### `print(text, className)`

在终端输出文本。

**参数**:
- `text` (string): 要输出的文本
- `className` (string, 可选): CSS 类名，可用值: `info-line`, `success-line`, `error-line`, `warning-line`

**示例**:
```javascript
api.print('普通文本');
api.print('成功信息', 'success-line');
api.print('错误信息', 'error-line');
```

#### `printHtml(html, className)`

在终端输出 HTML 内容，支持富文本。

**参数**:
- `html` (string): HTML 字符串
- `className` (string, 可选): CSS 类名

**示例**:
```javascript
api.printHtml('<b>粗体</b> <span style="color:yellow">彩色</span>');
api.printHtml('<button onclick="alert(\'hi\')">按钮</button>');
```

---

### 5.3 资源文件加载

#### `loadCSS(url)`

加载 CSS 文件（自动去重）。

**参数**:
- `url` (string): CSS 文件 URL，支持相对路径（相对于扩展包根目录）和绝对 URL

**返回**: `Promise<void>`

**示例**:
```javascript
// 加载包内样式
await api.loadCSS('style.css');

// 加载外部样式
await api.loadCSS('https://cdn.example.com/theme.css');
```

#### `loadScript(url)`

加载 JavaScript 文件（自动去重）。

**参数**:
- `url` (string): JS 文件 URL，支持相对路径和绝对 URL

**返回**: `Promise<void>`

**示例**:
```javascript
// 加载包内脚本
await api.loadScript('helper.js');

// 加载第三方库
await api.loadScript('https://cdn.jsdelivr.net/npm/lodash/lodash.min.js');

// 加载后即可使用加载的库
// _.forEach(...)
```

#### `resolveAsset(path)`

获取资源文件的完整 CDN URL。

**参数**:
- `path` (string): 资源相对路径

**返回**: `string` 完整 URL

**示例**:
```javascript
var logoUrl = api.resolveAsset('assets/logo.png');
// → "https://raw.githubusercontent.com/user/repo/main/extensions/my-ext/assets/logo.png"

// 用于 <img> 标签
api.printHtml('<img src="' + logoUrl + '" width="100">');
```

---

### 5.4 富 UI 渲染

#### `createUI(html, options)`

在终端中创建交互式 UI 面板。

**参数**:
- `html` (string|HTMLElement): 面板内容
- `options.title` (string, 可选): 面板标题
- `options.width` (number, 可选): 面板宽度百分比，默认 100
- `options.closable` (boolean, 可选): 是否可关闭，默认 true

**返回**: `object` 面板控制对象:
- `.close()` - 关闭面板
- `.update(newHtml)` - 更新面板内容
- `.element` - 面板容器 DOM 元素
- `.content` - 内容区域 DOM 元素

**示例**:
```javascript
// 创建带标题的面板
var panel = api.createUI(
    '<p>这是面板内容</p>' +
    '<button class="ext-btn" onclick="alert(\'点击\')">点击</button>',
    { title: '📊 数据面板', width: 80 }
);

// 稍后更新内容
panel.update('<p>更新后的内容</p>');

// 关闭面板
// panel.close();
```

#### `showDialog(options)`

显示模态对话框（支持 alert/confirm/prompt）。

**参数**:
- `options.title` (string): 标题
- `options.message` (string): 消息内容（支持 HTML）
- `options.type` (string): 类型 - `'alert'` | `'confirm'` | `'prompt'`
- `options.inputPlaceholder` (string): prompt 模式下输入框占位符
- `options.confirmText` (string): 确认按钮文字，默认 `'确定'`
- `options.cancelText` (string): 取消按钮文字，默认 `'取消'`
- `options.width` (number, 可选): 对话框宽度百分比

**返回**: `Promise<boolean|string|null>`
- alert: 确定 → `true`
- confirm: 确定 → `true`，取消 → `false`
- prompt: 确定 → 输入值，取消 → `null`

**示例**:
```javascript
// Alert
await api.showDialog({
    title: '提示',
    message: '操作已完成！'
});

// Confirm
var confirmed = await api.showDialog({
    title: '确认删除',
    message: '确定要删除这条记录吗？',
    type: 'confirm'
});
if (confirmed) { /* 执行删除 */ }

// Prompt
var name = await api.showDialog({
    title: '输入名称',
    message: '请输入您的名字:',
    type: 'prompt',
    inputPlaceholder: '例如: 张三'
});
api.print('你好, ' + name + '!');
```

---

### 5.5 命令自动调用

#### `executeCommand(command)`

编程方式执行任意终端命令（包括内置命令和其他扩展命令）。

**参数**:
- `command` (string): 完整命令字符串

**返回**: `Promise<void>`

**示例**:
```javascript
// 切换环境
await api.executeCommand('/hj python');

// 创建项目
await api.executeCommand('/xj project myapp');

// 创建文件
await api.executeCommand('/wr main.py');

// 运行文件
await api.executeCommand('/run main.py');

// 调用其他扩展的命令
await api.executeCommand('/weather 北京');
```

#### `batchCommands(commands, delay)`

批量顺序执行一系列命令。

**参数**:
- `commands` (string[]): 命令字符串数组
- `delay` (number, 可选): 命令间延迟毫秒数，默认 100

**返回**: `Promise<object>`:
- `.success` (number): 成功数
- `.failed` (number): 失败数
- `.errors` (object[]): 错误详情

**示例**:
```javascript
var result = await api.batchCommands([
    '/hj python',
    '/xj project automation-demo',
    '/wr hello.py',
    '/run hello.py'
], 500);

api.print('成功: ' + result.success + ', 失败: ' + result.failed);
```

---

### 5.6 配置持久化

#### `saveConfig(key, value)`

保存配置数据（自动按扩展名隔离命名空间）。

**参数**:
- `key` (string): 配置键
- `value` (any): 配置值（会被 JSON 序列化）

#### `getConfig(key, defaultValue)`

读取配置数据。

**参数**:
- `key` (string): 配置键
- `defaultValue` (any, 可选): 缺省默认值

**返回**: `any` 配置值

#### `deleteConfig(key)`

删除某条配置。

#### `clearAllConfig()`

清除本扩展的所有配置。

**示例**:
```javascript
// 保存
api.saveConfig('theme', 'dark');
api.saveConfig('count', 42);
api.saveConfig('user', { name: '张三', age: 25 });

// 读取
var theme = api.getConfig('theme', 'light');
var count = api.getConfig('count', 0);
var user = api.getConfig('user', {});

// 删除单条
api.deleteConfig('temp-data');

// 清空所有
api.clearAllConfig();
```

---

### 5.7 事件系统

#### `on(event, handler)`

监听事件。

**参数**:
- `event` (string): 事件名
  - `'ready'` - 扩展包完全加载完成
  - `'beforeCommand'` - 命令执行前 `{ command }`
  - `'afterCommand'` - 命令执行后 `{ command, success, error }`
  - `'envChange'` - 环境切换 `{ env }`
  - `'projectChange'` - 项目切换 `{ project }`
  - `'themeChange'` - 主题颜色变化 `{ color }`
  - `'unload'` - 扩展被卸载
  - *自定义事件* - 通过 `emit` 发布
- `handler` (function): 处理函数

#### `off(event, handler)`

移除事件监听。

#### `emit(event, data)`

发布自定义事件。

**示例**:
```javascript
// 监听就绪事件
api.on('ready', function() {
    api.print('扩展包已就绪 ✅', 'success-line');
});

// 监听环境切换
api.on('envChange', function(data) {
    api.print('环境已切换为: ' + data.env.toUpperCase());
});

// 监听命令执行
api.on('afterCommand', function(data) {
    if (data.success) {
        api.print('命令 [' + data.command + '] 执行成功');
    }
});

// 扩展间通信：发布自定义事件
api.emit('dataUpdated', { timestamp: Date.now() });

// 其他扩展可以通过 api.on('dataUpdated', ...) 接收
```

---

### 5.8 环境与项目信息

#### `getTerminal()`

获取终端对象。

**返回**: `object` terminal 对象

#### `getProjects()`

获取所有项目列表。

**返回**: `object` `{ projectName: { files: { fileName: content } } }`

#### `getCurrentEnv()`

获取当前环境。

**返回**: `string|null` `'python'` | `'c++'` | `'cmd'` | `null`

#### `getCurrentProject()`

获取当前项目名。

**返回**: `string|null`

#### `getExtensionInfo()`

获取本扩展包的元信息。

**返回**: `object` `{ name, version, description, author, cdnBaseUrl }`

---

### 5.9 文件系统操作

#### `readFile(fileName, projectName)`

读取项目文件内容。

**参数**:
- `fileName` (string): 文件名
- `projectName` (string, 可选): 项目名，缺省使用当前项目

**返回**: `string|null`

#### `writeFile(fileName, content, projectName)`

写入文件到项目。

**参数**:
- `fileName` (string): 文件名
- `content` (string): 文件内容
- `projectName` (string, 可选): 项目名，缺省使用当前项目

**返回**: `boolean`

#### `listFiles(projectName)`

列出项目中的文件列表。

**参数**:
- `projectName` (string, 可选): 项目名，缺省使用当前项目

**返回**: `string[]`

**示例**:
```javascript
// 读取文件
var code = api.readFile('main.py');
if (code) {
    api.print('文件内容:\n' + code);
}

// 写入文件
api.writeFile('output.txt', '扩展包生成的内容');

// 列出文件
var files = api.listFiles();
api.print('项目文件: ' + files.join(', '));
```

---

### 5.10 工具函数

#### `sleep(ms)`

异步延迟等待。

**参数**:
- `ms` (number): 毫秒数

**返回**: `Promise<void>`

**示例**:
```javascript
api.print('等待 3 秒...');
await api.sleep(3000);
api.print('继续执行');
```

#### `fetch(url, options)`

HTTP 请求封装。

**参数**:
- `url` (string): 请求地址
- `options` (object, 可选): fetch 选项

**返回**: `Promise<object>` `{ ok, status, data, error }`

**示例**:
```javascript
// GET 请求
var res = await api.fetch('https://api.github.com/repos/user/repo');
if (res.ok) {
    var stars = res.data.stargazers_count;
    api.print('⭐ Star 数: ' + stars);
}

// POST 请求
var postRes = await api.fetch('https://api.example.com/data', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key: 'value' })
});
```

---

## 6. UI 组件样式参考

扩展包开发生成 HTML 内容时，可以直接使用以下内置 CSS 组件样式：

### 组件列表

| CSS 类名 | 用途 | 说明 |
|----------|------|------|
| `.ext-panel` | 面板容器 | 带边框的终端面板 |
| `.ext-panel-header` | 面板标题栏 | 标题+关闭按钮布局 |
| `.ext-panel-close` | 关闭按钮 | 鼠标悬停变红 |
| `.ext-panel-content` | 面板内容区 | 文本内容 |
| `.ext-dialog-overlay` | 对话框遮罩 | 半透明黑色背景 + 居中 |
| `.ext-dialog-box` | 对话框主体 | 绿色边框 + 阴影 |
| `.ext-dialog-title` | 对话框标题 | 绿色加粗 |
| `.ext-dialog-message` | 对话框消息 | 白色文本 |
| `.ext-dialog-input` | 对话框输入框 | 终端风格输入框 |
| `.ext-dialog-buttons` | 对话框按钮行 | 右对齐 Flex 布局 |
| `.ext-dialog-btn` | 对话框按钮 | 绿底/透明切换 |
| `.ext-btn` | 通用按钮 | 绿边绿字，悬停反色 |
| `.ext-btn.danger` | 危险按钮 | 红边红字 |
| `.ext-progress-bar` | 进度条背景 | 深色轨道 |
| `.ext-progress-fill` | 进度条填充 | 绿色填充 + 动画过渡 |
| `.ext-table` | 数据表格 | 终端风格表格 |
| `.ext-table th` | 表头 | 绿色加粗 |
| `.ext-badge` | 标签/徽章 | 圆角标签 |
| `.ext-badge.success` | 成功标签 | 绿色 |
| `.ext-badge.warning` | 警告标签 | 黄色 |
| `.ext-badge.error` | 错误标签 | 红色 |
| `.ext-badge.info` | 信息标签 | 青色 |
| `.ext-code` | 内联代码 | 灰色背景代码块 |
| `.ext-divider` | 分割线 | 灰色横线 |
| `.ext-toast` | 浮动通知 | 右下角弹出 |

### 组件使用示例

```javascript
// 面板中使用表格
api.createUI(
    '<table class="ext-table">' +
    '  <tr><th>名称</th><th>状态</th><th>操作</th></tr>' +
    '  <tr><td>服务A</td><td><span class="ext-badge success">运行中</span></td>' +
    '    <td><button class="ext-btn" onclick="alert(\'重启\')">重启</button></td></tr>' +
    '  <tr><td>服务B</td><td><span class="ext-badge error">已停止</span></td>' +
    '    <td><button class="ext-btn" onclick="alert(\'启动\')">启动</button></td></tr>' +
    '</table>' +
    '<hr class="ext-divider">' +
    '<button class="ext-btn" onclick="alert(\'全部重启\')">全部重启</button>',
    { title: '📊 服务监控面板' }
);

// 进度条
api.printHtml(
    '下载进度:<br>' +
    '<div class="ext-progress-bar">' +
    '  <div class="ext-progress-fill" style="width:65%">65%</div>' +
    '</div>'
);

// 标签
api.printHtml('状态: <span class="ext-badge success">已完成</span>');
api.printHtml('代码: <code class="ext-code">npm install</code>');

// Toast 通知
var toast = document.createElement('div');
toast.className = 'ext-toast';
toast.textContent = '操作成功! ✅';
document.body.appendChild(toast);
setTimeout(function() { toast.remove(); }, 3000);
```

---

## 7. 完整示例扩展包

### 示例：计数器扩展包

**目录结构**:
```
counter-extension/
├── extension.json
├── main.js
└── style.css
```

**extension.json**:
```json
{
    "name": "counter",
    "version": "1.0.0",
    "description": "一个简单的计数器扩展，演示 SDK v3.0 核心功能",
    "author": "MLTSF",
    "main": "main.js",
    "styles": ["style.css"],
    "commands": [
        {
            "name": "count",
            "description": "显示/操作计数器 (子命令: reset, set N)"
        },
        {
            "name": "timer",
            "description": "倒计时器 (如: /timer 10)"
        }
    ]
}
```

**main.js**:
```javascript
(function() {
    var api = window.ExtensionAPI;
    var count = api.getConfig('count', 0);

    // 注册 /count 命令
    api.registerCommand('count', {
        description: '计数器操作 (reset/set N)',
        handler: function(args, terminal) {
            var sub = (args[0] || '').toLowerCase();

            if (sub === 'reset') {
                count = 0;
                api.saveConfig('count', 0);
                terminal.println('✅ 计数器已重置为 0', 'success-line');
            } else if (sub === 'set' && args[1]) {
                count = parseInt(args[1]) || 0;
                api.saveConfig('count', count);
                terminal.println('✅ 计数器已设置为 ' + count, 'success-line');
            } else {
                count++;
                api.saveConfig('count', count);
                terminal.println('🔢 计数: ' + count, 'info-line');

                // 当计数为10的倍数时弹出提示
                if (count % 10 === 0) {
                    api.printHtml(
                        '<div class="ext-panel" style="text-align:center">' +
                        '  <span style="font-size:24px">🎉 达到 ' + count + ' 次!</span>' +
                        '</div>'
                    );
                }
            }
        }
    });

    // 注册 /timer 命令
    api.registerCommand('timer', {
        description: '倒计时 (秒)',
        handler: function(args, terminal) {
            var seconds = parseInt(args[0]) || 5;
            terminal.println('⏱️ 倒计时 ' + seconds + ' 秒开始...', 'info-line');

            var countdown = function(remaining) {
                if (remaining <= 0) {
                    terminal.println('⏰ 时间到!', 'success-line');
                    api.showDialog({
                        title: '⏰ 倒计时结束',
                        message: '定时器已完成!',
                        type: 'alert'
                    });
                    return;
                }

                terminal.println('  剩余: ' + remaining + ' 秒');
                setTimeout(function() { countdown(remaining - 1); }, 1000);
            };

            countdown(seconds);
        }
    });

    // 加载样式
    api.loadCSS('style.css').catch(function() {
        // 样式加载失败不影响功能
    });

    // 就绪事件
    api.on('ready', function() {
        if (count > 0) {
            api.print('[counter] 计数器恢复: ' + count, 'info-line');
        }
    });
})();
```

**style.css**:
```css
/* counter-extension 扩展自定义样式 */
.counter-panel {
    background: linear-gradient(135deg, #0a0a0a, #001a00);
    border: 1px solid #00ff00;
    border-radius: 8px;
    padding: 16px;
    margin: 8px 0;
}

.counter-value {
    font-size: 48px;
    font-weight: bold;
    color: #00ff00;
    text-align: center;
    text-shadow: 0 0 10px rgba(0, 255, 0, 0.5);
}

.counter-label {
    color: #888;
    text-align: center;
    font-size: 12px;
    margin-top: 4px;
}
```

---

## 8. 自动化脚本示例

### 8.1 一键开发环境搭建

```javascript
// setup-env/main.js
(function() {
    var api = window.ExtensionAPI;

    api.registerCommand('setup', {
        description: '一键搭建 Python 开发环境',
        handler: async function(args, terminal) {
            terminal.println('🚀 开始搭建开发环境...', 'info-line');

            await api.batchCommands([
                '/hj python',
                '/xj project my-project',
                '/wr main.py',
                '/wr test.py'
            ], 300);

            terminal.println('✅ 开发环境搭建完成!', 'success-line');
            terminal.println('  项目: my-project', 'info-line');
            terminal.println('  文件: main.py, test.py', 'info-line');
            terminal.println('  使用 /run main.py 运行', 'info-line');
        }
    });
})();
```

### 8.2 定时状态检查

```javascript
// health-check/main.js
(function() {
    var api = window.ExtensionAPI;
    var timerId = null;

    api.registerCommand('monitor', {
        description: '启动定时状态检查 (interval 秒)',
        handler: function(args, terminal) {
            var interval = (parseInt(args[0]) || 30) * 1000;

            if (timerId) {
                clearInterval(timerId);
                timerId = null;
                terminal.println('已停止监控', 'info-line');
                return;
            }

            terminal.println('📡 定时监控已启动 (每 ' + (interval/1000) + ' 秒)', 'success-line');

            timerId = setInterval(async function() {
                var env = api.getCurrentEnv() || '无';
                var project = api.getCurrentProject() || '无';

                api.printHtml(
                    '<code class="ext-code">[' + new Date().toLocaleTimeString() + ']</code> ' +
                    '环境: <span class="ext-badge info">' + env + '</span> ' +
                    '项目: <span class="ext-badge">' + project + '</span>'
                );
            }, interval);
        }
    });
})();
```

---

## 9. 扩展包的安装与调试

### 安装命令

在 MLTSF 终端中执行以下命令安装扩展包：

| 命令 | 用途 | 示例 |
|------|------|------|
| `/ap <包名>` | 安装扩展包（从已发现列表） | `/ap counter` |
| `/az <URL>` | 从 GitHub 直链安装 | `/az https://raw.githubusercontent.com/user/repo/main/extensions/hello/main.js` |
| `/ar <仓库路径>` | 从 GitHub 仓库自动发现 | `/ar username/repo` |
| `/lxe` | 列出已加载的扩展包 | `/lxe` |
| `/rm <包名>` | 卸载扩展包 | `/rm counter` |
| `/extlist` | 列出所有扩展注册的命令 | `/extlist` |
| `/extstatus` | 查看扩展系统状态 | `/extstatus` |

### 调试技巧

1. **浏览器开发者工具**:
   - 按 F12 打开开发者工具
   - 在 Console 面板可以查看扩展包的 `console.log` 输出
   - 在 Network 面板可以检查扩展文件的加载状态

2. **终端输出**:
   - 扩展加载时会在终端显示加载状态
   - CSS 和 JS 文件加载成功/失败均有提示
   - 使用 `api.print()` 输出调试信息

3. **常见问题**:
   - **扩展未加载**: 检查 `extension.json` 格式是否合法（JSON 格式）
   - **CSS 未生效**: 检查 CSS 文件路径是否正确，浏览器 Console 是否有 404
   - **命令未注册**: 确保 `main.js` 中调用了 `api.registerCommand()`
   - **命令找不到**: 使用 `/extlist` 确认命令是否正确注册

---

## 10. 最佳实践与安全建议

### 开发建议

1. **命名空间隔离**:
   - 使用 IIFE 包裹代码，避免全局变量污染
   - 命令名使用有意义的名称，避免与内置命令冲突
   - CSS 类名加扩展名前缀，避免样式冲突

2. **异步处理**:
   - 资源加载（`loadCSS`/`loadScript`）使用 `await`
   - 命令处理函数中尽量使用 `async/await`
   - 合理使用 `sleep()` 控制执行节奏

3. **用户体验**:
   - 耗时操作显示进度提示
   - 提供清晰的命令帮助信息
   - 合理使用 UI 组件提升可视化效果

4. **错误处理**:
   - 关键操作使用 try/catch
   - 网络请求检查返回状态
   - 配置读写考虑异常情况

### 安全建议

1. **权限最小化**:
   - 只在 `permissions` 中声明真正需要的权限
   - 不要加载不受信任的外部脚本
   - 避免在 HTML 中使用 `eval()` 或 `innerHTML` 执行用户输入

2. **数据安全**:
   - 敏感数据不要存储在配置中
   - 不要使用 `localStorage` 直接存取（使用 `saveConfig`/`getConfig` 自动隔离命名空间）
   - 注意 HTML 注入风险，用户输入需转义

3. **性能优化**:
   - 使用 `loadScript()` 时设置 `async: true`（默认已设置）
   - 不使用的资源及时清理
   - 避免创建过多的 UI 面板

4. **兼容性**:
   - 使用 `extension.json` 中的 `version` 标明兼容的 SDK 版本
   - 避免使用浏览器特定 API

---

> 📖 **文档版本**: v3.0 | **更新日期**: 2026-06-13  
> 💡 **提示**: 使用 `/extstatus` 查看当前扩展系统状态
