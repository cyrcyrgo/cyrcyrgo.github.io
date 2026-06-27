/**
 * MLTSF 扩展包 SDK v3.0
 * =======================
 * 供第三方开发者创建 MLTSF 扩展包时使用。
 * 支持图形化资源加载、命令自动化、富UI渲染、配置持久化、生命周期管理。
 *
 * 版本: 3.0
 * 日期: 2026-06-13
 */

/* ============================================================
 *  1. 扩展包目录结构（增强版）
 * ============================================================
 *
 * 一个完整的 MLTSF 扩展包目录结构如下：
 *
 *   my-extension/
 *   ├── extension.json        # 扩展包配置文件 (必需)
 *   ├── main.js               # 扩展包主逻辑 (必需)
 *   ├── style.css             # 扩展包样式文件 (可选)
 *   ├── template.html         # 扩展包HTML模板 (可选)
 *   ├── helper.js             # 扩展包辅助脚本 (可选，通过 loadScript 加载)
 *   ├── assets/               # 静态资源目录 (可选)
 *   │   ├── logo.png
 *   │   ├── icon.svg
 *   │   └── data.json
 *   ├── README.md             # 扩展包说明文档 (推荐)
 *   └── ...
 *
 * 托管方式:
 *   - GitHub 仓库: https://raw.githubusercontent.com/{用户}/{仓库}/main/extensions/{包名}/
 *   - 自定义 CDN: 任意静态文件服务器
 */

/* ============================================================
 *  2. extension.json 配置说明（增强版）
 * ============================================================
 *
 * {
 *     "name": "my-extension",            // 扩展包名 (必填)
 *     "version": "1.0.0",                // 版本号 (必填)
 *     "description": "我的第一个扩展包",   // 描述 (推荐)
 *     "author": "开发者名",               // 作者 (推荐)
 *     "icon": "assets/icon.svg",         // 扩展包图标 (可选)
 *     "main": "main.js",                // 入口文件 (可选，默认 main.js)
 *     "styles": ["style.css"],          // 需要加载的CSS文件列表 (可选)
 *     "scripts": ["helper.js"],         // 需要预加载的JS文件列表 (可选)
 *     "dependencies": ["ext-a", "ext-b"], // 依赖的其他扩展包 (可选)
 *     "autoLoad": false,                // 是否随终端启动自动加载 (可选)
 *     "permissions": [                  // 权限声明 (可选)
 *         "network",                    //  允许网络请求
 *         "storage",                    //  允许本地存储
 *         "ui"                          //  允许创建UI元素
 *     ],
 *     "commands": [                     // 注册的命令列表 (必填)
 *         {
 *             "name": "hello",
 *             "description": "打招呼"
 *         },
 *         {
 *             "name": "weather",
 *             "description": "查询天气"
 *         }
 *     ]
 * }
 */

/* ============================================================
 *  3. main.js 编程接口 (ExtensionAPI v3.0)
 * ============================================================
 *
 * 扩展包的 main.js 可以通过 window.ExtensionAPI 调用以下方法：
 */

// ==================== 扩展API对象 ====================
window.ExtensionAPI = (function() {
    var _manager = null;
    var _extName = null;
    var _config = {};
    var _cdnBaseUrl = '';
    var _loadedCSS = [];
    var _loadedScripts = [];
    var _eventHandlers = {};
    var _storagePrefix = 'mltsf-ext-';
    var _permissions = [];

    // 内部: 设置扩展上下文
    function _setContext(manager, extName, config, cdnBaseUrl) {
        _manager = manager;
        _extName = extName;
        _config = config || {};
        _cdnBaseUrl = cdnBaseUrl || '';
        _storagePrefix = 'mltsf-ext-' + extName + '-';
        // 权限声明: 转为小写数组，未声明则默认全部允许（向后兼容）
        _permissions = (_config.permissions || []).map(function(p) { return String(p).toLowerCase(); });
    }

    // 内部: 权限校验 — 未声明权限则默认允许（向后兼容）
    function _checkPermission(perm) {
        if (_permissions.length === 0) return; // 未声明权限，默认全部允许
        if (_permissions.indexOf(perm.toLowerCase()) === -1) {
            throw new Error('[ExtensionAPI] 权限不足: 需要 "' + perm + '" 权限。' +
                '请在 extension.json 的 permissions 字段中声明。');
        }
    }

    // ==========================================================
    //  3.1 命令注册
    // ==========================================================

    /**
     * 注册一个新命令
     * @param {string} cmdName - 命令名（带/或不带/均可）
     * @param {object} definition - 命令定义
     * @param {string} definition.description - 命令描述
     * @param {function} definition.handler - 命令处理函数 (args, terminal) => {}
     */
    function registerCommand(cmdName, definition) {
        if (!_manager) {
            console.warn('[ExtensionAPI] 管理器未就绪，无法注册命令:', cmdName);
            return;
        }
        var name = cmdName.startsWith('/') ? cmdName : '/' + cmdName;
        definition._source = _extName || 'extension';
        _manager._registerCommandFromExtension(name, definition);
    }

    // ==========================================================
    //  3.2 终端输出
    // ==========================================================

    /**
     * 在终端输出文本
     * @param {string} text - 要输出的文本
     * @param {string} className - 样式类名 (可选)
     */
    function print(text, className) {
        if (window.terminal) {
            window.terminal.println(text, className);
        }
    }

    /**
     * 在终端输出HTML内容（支持富文本）
     * @param {string} html - HTML字符串
     * @param {string} className - 样式类名 (可选)
     */
    function printHtml(html, className) {
        _checkPermission('ui');
        if (window.terminal) {
            // 安全过滤：移除 script 标签和事件处理器属性（防御层-扩展API边界）
            const sanitized = String(html)
                .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
                .replace(/\s+on\w+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')
                .replace(/javascript\s*:/gi, '');
            window.terminal.printHtml(sanitized, className);
        }
    }

    // ==========================================================
    //  3.3 资源文件加载（新增）
    // ==========================================================

    /**
     * 加载CSS文件到页面（自动去重）
     * @param {string} url - CSS文件URL（相对或绝对路径）
     * @returns {Promise<void>}
     *
     * 示例:
     *   ExtensionAPI.loadCSS('style.css');
     *   ExtensionAPI.loadCSS('https://cdn.example.com/theme.css');
     */
    function loadCSS(url) {
        _checkPermission('network');
        return new Promise(function(resolve, reject) {
            // 解析相对路径
            var fullUrl = _resolveUrl(url);

            // 去重检查
            if (_loadedCSS.indexOf(fullUrl) !== -1) {
                resolve();
                return;
            }

            var link = document.createElement('link');
            link.rel = 'stylesheet';
            link.href = fullUrl;
            link.setAttribute('data-extension', _extName || 'unknown');

            link.onload = function() {
                _loadedCSS.push(fullUrl);
                print('[扩展样式已加载: ' + url + ']', 'success-line');
                resolve();
            };
            link.onerror = function() {
                reject(new Error('CSS加载失败: ' + url));
            };
            document.head.appendChild(link);
        });
    }

    /**
     * 加载JavaScript文件到页面（自动去重）
     * @param {string} url - JS文件URL（相对或绝对路径）
     * @returns {Promise<void>}
     *
     * 示例:
     *   ExtensionAPI.loadScript('helper.js');
     *   ExtensionAPI.loadScript('https://cdn.example.com/lib.js');
     *
     * 修复: 使用 fetch + Blob 方案绕过 MIME 类型检查（某些 CDN 返回错误 MIME 导致加载失败）
     */
    function loadScript(url) {
        _checkPermission('network');
        return new Promise(function(resolve, reject) {
            var fullUrl = _resolveUrl(url);

            if (_loadedScripts.indexOf(fullUrl) !== -1) {
                resolve();
                return;
            }

            // 使用 fetch 获取内容后通过 Blob 创建 script，避免 CDN 返回错误 MIME 类型的问题
            fetch(fullUrl)
                .then(function(response) {
                    if (!response.ok) {
                        throw new Error('HTTP ' + response.status);
                    }
                    return response.text();
                })
                .then(function(code) {
                    var script = document.createElement('script');
                    script.textContent = code;
                    script.setAttribute('data-extension', _extName || 'unknown');
                    // 添加 data-src 属性记录原始 URL，便于调试和清理
                    script.setAttribute('data-src', fullUrl);

                    script.onerror = function() {
                        reject(new Error('脚本执行失败: ' + url));
                    };

                    document.body.appendChild(script);
                    _loadedScripts.push(fullUrl);
                    print('[扩展脚本已加载: ' + url + ']', 'success-line');
                    resolve();
                })
                .catch(function(err) {
                    reject(new Error('脚本加载失败: ' + url + ' (' + err.message + ')'));
                });
        });
    }

    /**
     * 获取资源文件的完整URL
     * @param {string} path - 相对路径（基于扩展包CDN根目录）
     * @returns {string} 完整URL
     *
     * 示例:
     *   var url = ExtensionAPI.resolveAsset('assets/logo.png');
     *   // → "https://raw.githubusercontent.com/user/repo/main/extensions/my-ext/assets/logo.png"
     */
    function resolveAsset(path) {
        return _resolveUrl(path);
    }

    // 内部: 解析URL（相对路径转为基于CDN的绝对路径）
    function _resolveUrl(url) {
        if (!url) return '';
        if (url.startsWith('http://') || url.startsWith('https://') || url.startsWith('//')) {
            return url;
        }
        // 相对路径，拼接到CDN基URL（统一处理首尾斜杠，避免 // 重复）
        if (_cdnBaseUrl) {
            var base = _cdnBaseUrl.replace(/\/+$/, '');
            var rel = url.replace(/^\/+/, '');
            return base + '/' + rel;
        }
        return url;
    }

    // ==========================================================
    //  3.4 富UI渲染（新增）
    // ==========================================================

    /**
     * 在终端中渲染HTML内容（创建一个可交互的UI面板）
     * @param {string|HTMLElement} html - HTML字符串或DOM元素
     * @param {object} options - 配置选项
     * @param {string} options.title - 面板标题 (可选)
     * @param {number} options.width - 面板宽度百分比 (可选，默认100)
     * @param {boolean} options.closable - 是否可关闭 (可选，默认true)
     * @returns {object} 面板控制对象 { close(), update(html), element }
     *
     * 示例:
     *   var panel = ExtensionAPI.createUI(
     *       '<button onclick="alert(\'hi\')">点击我</button>',
     *       { title: '我的面板', width: 80 }
     *   );
     *   // 稍后关闭: panel.close();
     */
    function createUI(html, options) {
        _checkPermission('ui');
        options = options || {};
        var terminal = window.terminal;
        if (!terminal) return null;

        var output = terminal.output;
        if (!output) {
            console.warn('[ExtensionAPI] terminal.output 不可用，无法创建UI面板');
            return null;
        }

        // 创建UI容器
        var container = document.createElement('div');
        container.className = 'ext-panel';
        container.setAttribute('data-extension', _extName || 'unknown');
        if (options.width) {
            container.style.maxWidth = options.width + '%';
        }

        // 标题栏
        if (options.title) {
            var header = document.createElement('div');
            header.className = 'ext-panel-header';
            header.innerHTML = '<span>' + _escapeHtml(options.title) + '</span>';

            if (options.closable !== false) {
                var closeBtn = document.createElement('button');
                closeBtn.className = 'ext-panel-close';
                closeBtn.textContent = '×';
                closeBtn.onclick = function() {
                    container.remove();
                };
                header.appendChild(closeBtn);
            }

            container.appendChild(header);
        }

        // 内容区
        var content = document.createElement('div');
        content.className = 'ext-panel-content';

        if (typeof html === 'string') {
            // 安全过滤
            var sanitized = String(html)
                .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
                .replace(/\s+on\w+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')
                .replace(/javascript\s*:/gi, '');
            content.innerHTML = sanitized;
        } else if (html instanceof HTMLElement) {
            content.appendChild(html);
        }

        container.appendChild(content);
        output.appendChild(container);
        terminal.scrollToBottom();

        // 返回控制接口
        return {
            close: function() { container.remove(); },
            update: function(newHtml) {
                if (typeof newHtml === 'string') {
                    content.innerHTML = newHtml;
                } else if (newHtml instanceof HTMLElement) {
                    content.innerHTML = '';
                    content.appendChild(newHtml);
                }
            },
            element: container,
            content: content
        };
    }

    /**
     * 显示一个交互式对话框
     * @param {object} options - 对话框配置
     * @param {string} options.title - 标题
     * @param {string} options.message - 消息内容 (支持HTML)
     * @param {string} options.type - 类型: 'alert'|'confirm'|'prompt' (默认 'alert')
     * @param {string} options.inputPlaceholder - prompt模式下输入框占位符
     * @param {string} options.confirmText - 确认按钮文字 (默认 '确定')
     * @param {string} options.cancelText - 取消按钮文字 (默认 '取消')
     * @param {string} options.width - 面板宽度百分比 (可选)
     * @returns {Promise<boolean|string|null>}
     *   - alert: 点击确定返回 true
     *   - confirm: 点击确定返回 true，取消返回 false
     *   - prompt: 点击确定返回输入值，取消返回 null
     *
     * 示例:
     *   var result = await ExtensionAPI.showDialog({
     *       title: '确认',
     *       message: '是否继续?',
     *       type: 'confirm'
     *   });
     */
    function showDialog(options) {
        _checkPermission('ui');
        return new Promise(function(resolve) {
            options = options || {};
            var title = options.title || '提示';
            var message = options.message || '';
            var type = options.type || 'alert';
            var confirmText = options.confirmText || '确定';
            var cancelText = options.cancelText || '取消';
            var inputPlaceholder = options.inputPlaceholder || '';

            var html = '<div class="ext-dialog-overlay">' +
                '<div class="ext-dialog-box" style="' + (options.width ? 'max-width:' + options.width + '%' : '') + '">' +
                '<div class="ext-dialog-title">' + _escapeHtml(title) + '</div>' +
                '<div class="ext-dialog-message">' + _escapeHtml(String(message)) + '</div>';

            if (type === 'prompt') {
                html += '<br><input type="text" class="ext-dialog-input" placeholder="' +
                    _escapeHtml(inputPlaceholder) + '" autofocus>';
            }

            html += '</div>' +
                '<div class="ext-dialog-buttons">' +
                '<button class="ext-dialog-btn primary">' + _escapeHtml(confirmText) + '</button>';

            if (type !== 'alert') {
                html += '<button class="ext-dialog-btn danger">' + _escapeHtml(cancelText) + '</button>';
            }

            html += '</div></div></div>';

            // 渲染对话框
            var tempContainer = document.createElement('div');
            tempContainer.innerHTML = html;
            var overlay = tempContainer.firstElementChild;
            document.body.appendChild(overlay);

            var confirmBtn = overlay.querySelector('.ext-dialog-btn.primary');
            var cancelBtn = overlay.querySelector('.ext-dialog-btn.danger');
            var input = overlay.querySelector('.ext-dialog-input');

            if (input) setTimeout(function() { input.focus(); }, 100);

            function cleanup() {
                if (overlay && overlay.parentNode) {
                    overlay.parentNode.removeChild(overlay);
                }
            }

            confirmBtn.onclick = function() {
                cleanup();
                if (type === 'prompt') {
                    resolve(input ? input.value : '');
                } else {
                    resolve(true);
                }
            };

            if (cancelBtn) {
                cancelBtn.onclick = function() {
                    cleanup();
                    resolve(type === 'prompt' ? null : false);
                };
            }

            // 点击背景关闭
            overlay.onclick = function(e) {
                if (e.target === overlay) {
                    cleanup();
                    resolve(type === 'prompt' ? null : false);
                }
            };

            // 键盘事件
            var keyHandler = function(e) {
                if (e.key === 'Escape') {
                    cleanup();
                    document.removeEventListener('keydown', keyHandler);
                    resolve(type === 'prompt' ? null : false);
                } else if (e.key === 'Enter' && type === 'prompt') {
                    cleanup();
                    document.removeEventListener('keydown', keyHandler);
                    resolve(input ? input.value : '');
                }
            };
            document.addEventListener('keydown', keyHandler);
        });
    }

    // ==========================================================
    //  3.5 命令自动调用（新增 - 核心自动化能力）
    // ==========================================================

    /**
     * 编程方式执行任意命令（支持内置命令和其他扩展命令）
     * @param {string} command - 完整命令字符串（如 '/color Red'）
     * @returns {Promise<void>}
     *
     * 示例:
     *   // 切换颜色
     *   await ExtensionAPI.executeCommand('/color G');
     *
     *   // 切换环境
     *   await ExtensionAPI.executeCommand('/hj python');
     *
     *   // 调用其他扩展的命令
     *   await ExtensionAPI.executeCommand('/weather Beijing');
     *
     *   // 自动化脚本
     *   await ExtensionAPI.executeCommand('/count');
     *   await ExtensionAPI.executeCommand('/count');
     *   await ExtensionAPI.executeCommand('/count reset');
     */
    function executeCommand(command) {
        return new Promise(function(resolve, reject) {
            var terminal = window.terminal;
            if (!terminal) {
                reject(new Error('终端未就绪'));
                return;
            }

            if (typeof command !== 'string' || !command.trim()) {
                reject(new Error('无效命令'));
                return;
            }

            // 发布命令执行事件
            _emit('beforeCommand', { command: command });

            // 直接调用终端的执行方法
            try {
                var result = terminal.executeCommand(command.trim());
                if (result && typeof result.then === 'function') {
                    result.then(function() {
                        _emit('afterCommand', { command: command, success: true });
                        resolve();
                    }).catch(function(err) {
                        _emit('afterCommand', { command: command, success: false, error: err });
                        reject(err);
                    });
                } else {
                    _emit('afterCommand', { command: command, success: true });
                    resolve();
                }
            } catch (err) {
                _emit('afterCommand', { command: command, success: false, error: err });
                reject(err);
            }
        });
    }

    /**
     * 批量执行一系列命令（自动化脚本）
     * @param {string[]} commands - 命令字符串数组
     * @param {number} delay - 命令之间的延迟毫秒数 (可选，默认 100ms)
     * @returns {Promise<{success: number, failed: number, errors: object[]}>}
     *
     * 示例:
     *   var result = await ExtensionAPI.batchCommands([
     *       '/hj python',
     *       '/xj project myapp',
     *       '/wr main.py',
     *       '/run main.py'
     *   ], 500);
     *   console.log('成功:', result.success, '失败:', result.failed);
     */
    function batchCommands(commands, delay) {
        delay = delay || 100;
        var result = { success: 0, failed: 0, errors: [] };

        return commands.reduce(function(promise, cmd) {
            return promise.then(function() {
                return executeCommand(cmd).then(function() {
                    result.success++;
                    return _delay(delay);
                }).catch(function(err) {
                    result.failed++;
                    result.errors.push({ command: cmd, error: err.message });
                    return _delay(delay);
                });
            });
        }, Promise.resolve()).then(function() {
            return result;
        });
    }

    // ==========================================================
    //  3.6 配置持久化（新增）
    // ==========================================================

    /**
     * 保存扩展包的配置数据（自动带扩展名前缀，不会与其他扩展冲突）
     * @param {string} key - 配置键名
     * @param {*} value - 配置值（会被JSON序列化）
     */
    function saveConfig(key, value) {
        _checkPermission('storage');
        try {
            var storageKey = _storagePrefix + key;
            localStorage.setItem(storageKey, JSON.stringify(value));
        } catch (e) {
            console.warn('[ExtensionAPI] 保存配置失败:', e);
        }
    }

    /**
     * 读取扩展包的配置数据
     * @param {string} key - 配置键名
     * @param {*} defaultValue - 默认值（如果键不存在则返回）
     * @returns {*} 配置值
     */
    function getConfig(key, defaultValue) {
        _checkPermission('storage');
        try {
            var storageKey = _storagePrefix + key;
            var value = localStorage.getItem(storageKey);
            if (value === null) return defaultValue;
            return JSON.parse(value);
        } catch (e) {
            console.warn('[ExtensionAPI] 读取配置失败:', e);
            return defaultValue;
        }
    }

    /**
     * 删除扩展包的某条配置
     * @param {string} key - 配置键名
     */
    function deleteConfig(key) {
        _checkPermission('storage');
        try {
            var storageKey = _storagePrefix + key;
            localStorage.removeItem(storageKey);
        } catch (e) {
            console.warn('[ExtensionAPI] 删除配置失败:', e);
        }
    }

    /**
     * 清除扩展包的所有配置
     */
    function clearAllConfig() {
        _checkPermission('storage');
        try {
            var keysToRemove = [];
            for (var i = 0; i < localStorage.length; i++) {
                var key = localStorage.key(i);
                if (key && key.indexOf(_storagePrefix) === 0) {
                    keysToRemove.push(key);
                }
            }
            keysToRemove.forEach(function(k) { localStorage.removeItem(k); });
        } catch (e) {
            console.warn('[ExtensionAPI] 清除配置失败:', e);
        }
    }

    // ==========================================================
    //  3.7 事件系统（新增 - 扩展间通信和生命周期）
    // ==========================================================

    /**
     * 监听事件
     * @param {string} event - 事件名
     *   - 'ready'          - 扩展包加载完成
     *   - 'beforeCommand'  - 命令执行前 { command }
     *   - 'afterCommand'   - 命令执行后 { command, success, error }
     *   - 'envChange'      - 环境切换 { env }
     *   - 'projectChange'  - 项目切换 { project }
     *   - 'themeChange'    - 主题切换 { color }
     *   - 'error'          - 扩展发生异常 { error, source }
     *   - 'unload'         - 扩展被卸载
     *   - 自定义事件名      - 通过 emit 触发
     * @param {function} handler - 事件处理函数
     *
     * 示例:
     *   ExtensionAPI.on('envChange', function(data) {
     *       ExtensionAPI.print('环境变更为: ' + data.env);
     *   });
     */
    function on(event, handler) {
        if (!_eventHandlers[event]) {
            _eventHandlers[event] = [];
        }
        _eventHandlers[event].push(handler);
    }

    /**
     * 移除事件监听
     * @param {string} event - 事件名
     * @param {function} handler - 要移除的处理函数（不传则移除所有）
     */
    function off(event, handler) {
        if (!_eventHandlers[event]) return;
        if (handler) {
            _eventHandlers[event] = _eventHandlers[event].filter(function(h) {
                return h !== handler;
            });
        } else {
            _eventHandlers[event] = [];
        }
    }

    /**
     * 触发事件（发布事件通知）
     * @param {string} event - 事件名
     * @param {*} data - 事件数据
     *
     * 示例:
     *   // 在扩展包内触发自定义事件
     *   ExtensionAPI.emit('dataUpdated', { count: 42 });
     *
     *   // 其他扩展可以通过 on('dataUpdated', ...) 收到通知
     */
    function emit(event, data) {
        _emit(event, data);
    }

    // 内部: 触发事件
    function _emit(event, data) {
        // 触发本扩展的处理器
        var handlers = _eventHandlers[event];
        if (handlers) {
            for (var i = 0; i < handlers.length; i++) {
                try {
                    handlers[i](data || {});
                } catch (e) {
                    console.warn('[ExtensionAPI] 事件处理器错误:', e);
                }
            }
        }
    }

    // ==========================================================
    //  3.8 获取终端/项目/环境信息
    // ==========================================================

    /**
     * 获取终端对象
     * @returns {object} terminal 对象
     */
    function getTerminal() {
        return window.terminal;
    }

    /**
     * 获取所有项目列表
     * @returns {object} 项目对象 { projectName: { files: {...} } }
     */
    function getProjects() {
        return window.projects || {};
    }

    /**
     * 获取当前环境
     * @returns {string|null} 'python', 'c++', 'cmd' 或 null
     */
    function getCurrentEnv() {
        return window.terminal ? window.terminal.currentEnv : null;
    }

    /**
     * 获取当前项目名
     * @returns {string|null} 当前项目名或null
     */
    function getCurrentProject() {
        return window.terminal ? window.terminal.currentProject : null;
    }

    /**
     * 获取扩展包自身的信息
     * @returns {object} { name, version, description, author, cdnBaseUrl }
     */
    function getExtensionInfo() {
        return {
            name: _extName,
            version: _config.version || '未知',
            description: _config.description || '',
            author: _config.author || '',
            cdnBaseUrl: _cdnBaseUrl
        };
    }

    // ==========================================================
    //  3.9 文件系统操作（新增）
    // ==========================================================

    /**
     * 读取项目中的文件内容
     * @param {string} projectName - 项目名（缺省则使用当前项目）
     * @param {string} fileName - 文件名
     * @returns {string|null} 文件内容，不存在返回null
     */
    function readFile(fileName, projectName) {
        projectName = projectName || getCurrentProject();
        if (!projectName) {
            print('错误: 未指定项目', 'error-line');
            return null;
        }
        var projects = getProjects();
        var project = projects[projectName];
        if (!project) {
            print('错误: 项目 "' + projectName + '" 不存在', 'error-line');
            return null;
        }
        return project.files[fileName] || null;
    }

    /**
     * 写入文件到项目
     * @param {string} projectName - 项目名（缺省使用当前项目）
     * @param {string} fileName - 文件名
     * @param {string} content - 文件内容
     * @returns {boolean} 是否成功
     */
    function writeFile(fileName, content, projectName) {
        projectName = projectName || getCurrentProject();
        if (!projectName) {
            print('错误: 未指定项目', 'error-line');
            return false;
        }
        var projects = getProjects();
        var project = projects[projectName];
        if (!project) {
            print('错误: 项目 "' + projectName + '" 不存在', 'error-line');
            return false;
        }
        project.files[fileName] = content;
        // 保存到localStorage
        try {
            localStorage.setItem('mltsf-projects', JSON.stringify(projects));
        } catch (e) {
            console.warn('保存项目失败:', e);
        }
        return true;
    }

    /**
     * 列出项目中的所有文件
     * @param {string} projectName - 项目名（缺省使用当前项目）
     * @returns {string[]} 文件名列表
     */
    function listFiles(projectName) {
        projectName = projectName || getCurrentProject();
        if (!projectName) return [];
        var projects = getProjects();
        var project = projects[projectName];
        if (!project) return [];
        return Object.keys(project.files);
    }

    // ==========================================================
    //  3.10 工具函数
    // ==========================================================

    /**
     * 延迟等待
     * @param {number} ms - 毫秒数
     * @returns {Promise<void>}
     */
    function sleep(ms) {
        return _delay(ms);
    }

    /**
     * 注册定时器（由 setInterval/setTimeout 包装器调用）
     * @param {number} id - 定时器ID
     * @param {string} type - 'interval' 或 'timeout'
     */
    function _trackTimer(id, type) {
        if (!_manager || !_manager._extTimers) return;
        if (!_manager._extTimers[_extName]) {
            _manager._extTimers[_extName] = [];
        }
        _manager._extTimers[_extName].push({ id: id, type: type });
    }

    /**
     * 设置可追踪的 setInterval（扩展卸载时自动清理）
     * @param {function} fn - 回调函数
     * @param {number} ms - 间隔毫秒数
     * @returns {number} 定时器ID
     */
    function setInterval(fn, ms) {
        var id = window.setInterval(fn, ms);
        _trackTimer(id, 'interval');
        return id;
    }

    /**
     * 设置可追踪的 setTimeout（扩展卸载时自动清理）
     * @param {function} fn - 回调函数
     * @param {number} ms - 延迟毫秒数
     * @returns {number} 定时器ID
     */
    function setTimeout(fn, ms) {
        var id = window.setTimeout(fn, ms);
        _trackTimer(id, 'timeout');
        return id;
    }

    /**
     * 清除定时器
     * @param {number} id - 定时器ID
     */
    function clearTimer(id) {
        window.clearInterval(id);
        window.clearTimeout(id);
        if (_manager && _manager._extTimers && _manager._extTimers[_extName]) {
            _manager._extTimers[_extName] = _manager._extTimers[_extName].filter(function(t) {
                return t.id !== id;
            });
        }
    }

    /**
     * 发起HTTP请求（fetch封装）
     * @param {string} url - 请求URL
     * @param {object} options - fetch选项
     * @returns {Promise<object>} { ok, status, data }
     *
     * 示例:
     *   var res = await ExtensionAPI.fetch('https://api.example.com/data');
     *   if (res.ok) print(res.data);
     */
    async function fetchUrl(url, options) {
        _checkPermission('network');
        try {
            var response = await fetch(url, options || {});
            var data;
            var contentType = response.headers.get('content-type') || '';
            if (contentType.indexOf('application/json') !== -1) {
                data = await response.json();
            } else {
                data = await response.text();
            }
            return {
                ok: response.ok,
                status: response.status,
                data: data
            };
        } catch (err) {
            return {
                ok: false,
                status: 0,
                data: null,
                error: err.message
            };
        }
    }

    // 内部: 延迟辅助
    function _delay(ms) {
        return new Promise(function(resolve) {
            setTimeout(resolve, ms);
        });
    }

    // 内部: HTML转义
    function _escapeHtml(str) {
        if (!str) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    // ==========================================================
    //  3.11 AI 能力接口（新增 - AI 趋势核心）
    // ==========================================================

    /**
     * 向 AI 提问（单轮对话，使用终端已配置的 AI 后端）
     * @param {string} prompt - 提问内容
     * @param {object} options - 可选配置
     * @param {string} options.model - 覆盖默认模型
     * @param {number} options.temperature - 温度参数 (0-2)
     * @returns {Promise<{ok: boolean, content: string, error: string}>}
     *
     * 示例:
     *   var result = await ExtensionAPI.askAI('解释这段代码');
     *   if (result.ok) ExtensionAPI.print(result.content);
     */
    async function askAI(prompt, options) {
        _checkPermission('network');
        options = options || {};
        try {
            // 使用终端已配置的 AI 后端
            var cfg = typeof aiLoadConfig === 'function' ? aiLoadConfig() : null;
            if (!cfg || !cfg.apiKey) {
                return { ok: false, content: '', error: 'AI 未配置，请先执行 /ai code' };
            }
            var endpoint = typeof aiBuildUrl === 'function' ? aiBuildUrl(cfg.url) : cfg.url;
            var model = options.model || cfg.model || 'deepseek-chat';

            var response = await fetch(endpoint, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': 'Bearer ' + cfg.apiKey
                },
                body: JSON.stringify({
                    model: model,
                    messages: [{ role: 'user', content: prompt }],
                    stream: false,
                    temperature: options.temperature != null ? options.temperature : 0.7,
                    max_tokens: 4096
                })
            });

            if (!response.ok) {
                var errTxt = '';
                try { errTxt = await response.text(); } catch (e) {}
                return { ok: false, content: '', error: 'HTTP ' + response.status + ': ' + errTxt.substring(0, 200) };
            }

            var data = await response.json();
            var content = (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || '';
            return { ok: true, content: content, error: '' };
        } catch (err) {
            return { ok: false, content: '', error: err.message };
        }
    }

    /**
     * 多轮对话（使用终端已配置的 AI 后端）
     * @param {Array<{role: string, content: string}>} messages - 对话消息列表
     * @param {object} options - 可选配置（同 askAI）
     * @returns {Promise<{ok: boolean, content: string, error: string}>}
     *
     * 示例:
     *   var result = await ExtensionAPI.chat([
     *       { role: 'system', content: '你是代码审查助手' },
     *       { role: 'user', content: '审查 main.py' }
     *   ]);
     */
    async function chat(messages, options) {
        _checkPermission('network');
        options = options || {};
        if (!Array.isArray(messages) || messages.length === 0) {
            return { ok: false, content: '', error: 'messages 不能为空' };
        }
        try {
            var cfg = typeof aiLoadConfig === 'function' ? aiLoadConfig() : null;
            if (!cfg || !cfg.apiKey) {
                return { ok: false, content: '', error: 'AI 未配置，请先执行 /ai code' };
            }
            var endpoint = typeof aiBuildUrl === 'function' ? aiBuildUrl(cfg.url) : cfg.url;
            var model = options.model || cfg.model || 'deepseek-chat';

            var response = await fetch(endpoint, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': 'Bearer ' + cfg.apiKey
                },
                body: JSON.stringify({
                    model: model,
                    messages: messages,
                    stream: false,
                    temperature: options.temperature != null ? options.temperature : 0.7,
                    max_tokens: 4096
                })
            });

            if (!response.ok) {
                var errTxt = '';
                try { errTxt = await response.text(); } catch (e) {}
                return { ok: false, content: '', error: 'HTTP ' + response.status + ': ' + errTxt.substring(0, 200) };
            }

            var data = await response.json();
            var content = (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || '';
            return { ok: true, content: content, error: '' };
        } catch (err) {
            return { ok: false, content: '', error: err.message };
        }
    }

    /**
     * 注册 AI 可调用的 Tool（Function Calling）
     * 注册后，终端 AI 助手可自动发现并调用这些工具
     * @param {string} name - 工具名称（唯一标识）
     * @param {object} definition - 工具定义
     * @param {string} definition.description - 工具描述（AI 用于判断何时调用）
     * @param {object} definition.parameters - JSON Schema 格式的参数定义
     * @param {function} definition.handler - 处理函数 (params) => { result }
     *
     * 示例:
     *   ExtensionAPI.registerTool('get_weather', {
     *       description: '获取指定城市的天气',
     *       parameters: {
     *           type: 'object',
     *           properties: { city: { type: 'string', description: '城市名' } },
     *           required: ['city']
     *       },
     *       handler: async function(params) {
     *           var res = await ExtensionAPI.fetch('https://api.weather.com/' + params.city);
     *           return res.data;
     *       }
     *   });
     */
    function registerTool(name, definition) {
        if (!window._mltsf_ai_tools) { window._mltsf_ai_tools = {}; }
        window._mltsf_ai_tools[name] = {
            name: name,
            description: definition.description || '',
            parameters: definition.parameters || { type: 'object', properties: {} },
            handler: definition.handler,
            _source: _extName || 'unknown'
        };
        print('[Tool 已注册: ' + name + ']', 'success-line');
    }

    /**
     * 向 AI 对话注入上下文（AI 将感知这些信息）
     * @param {string} role - 角色: 'system' 或 'user'
     * @param {string} content - 上下文内容
     *
     * 示例:
     *   ExtensionAPI.injectContext('system', '当前项目结构: src/main.py, src/utils.py, tests/');
     *   ExtensionAPI.injectContext('user', '请重点关注 main.py 中的性能问题');
     */
    function injectContext(role, content) {
        if (!window._mltsf_ai_context) { window._mltsf_ai_context = []; }
        window._mltsf_ai_context.push({
            role: role === 'system' ? 'system' : 'user',
            content: String(content),
            _source: _extName || 'unknown'
        });
    }

    /**
     * 清除指定扩展注入的上下文
     */
    function clearContext() {
        if (!window._mltsf_ai_context) return;
        window._mltsf_ai_context = window._mltsf_ai_context.filter(function(ctx) {
            return ctx._source !== _extName;
        });
    }

    // ==========================================================
    //  返回公开API
    // ==========================================================
    return {
        // 内部方法（由管理器调用）
        _init: function(manager) { _manager = manager; },
        _setContext: _setContext,
        _emit: _emit,

        // 命令注册
        registerCommand: registerCommand,

        // 终端输出
        print: print,
        printHtml: printHtml,

        // 资源加载
        loadCSS: loadCSS,
        loadScript: loadScript,
        resolveAsset: resolveAsset,

        // 富UI渲染
        createUI: createUI,
        showDialog: showDialog,

        // 命令自动化
        executeCommand: executeCommand,
        batchCommands: batchCommands,

        // 配置持久化
        saveConfig: saveConfig,
        getConfig: getConfig,
        deleteConfig: deleteConfig,
        clearAllConfig: clearAllConfig,

        // 事件系统
        on: on,
        off: off,
        emit: emit,

        // 环境信息
        getTerminal: getTerminal,
        getProjects: getProjects,
        getCurrentEnv: getCurrentEnv,
        getCurrentProject: getCurrentProject,
        getExtensionInfo: getExtensionInfo,

        // 文件操作
        readFile: readFile,
        writeFile: writeFile,
        listFiles: listFiles,

        // 工具
        sleep: sleep,
        fetch: fetchUrl,

        // 定时器（可追踪，扩展卸载时自动清理）
        setInterval: setInterval,
        setTimeout: setTimeout,
        clearTimer: clearTimer,

        // AI 能力（v4.0 新增）
        askAI: askAI,
        chat: chat,
        registerTool: registerTool,
        injectContext: injectContext,
        clearContext: clearContext
    };
})();

console.log('MLTSF Extension SDK v3.0 loaded - 支持图形化资源、命令自动化、富UI渲染');