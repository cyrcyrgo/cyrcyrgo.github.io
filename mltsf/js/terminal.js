let terminal = {
    output: document.getElementById('output'),
    input: document.getElementById('command-input'),
    prompt: document.getElementById('prompt'),
    currentEnv: null,
    currentProject: null,
    history: [],
    historyIndex: -1,
    isProcessing: false,
    isMultiLineCollecting: false,

    init() {
        this.printWelcomeMessage();
        this.restoreSavedColor();
        this.input.focus();
        
        // 处理命令输入
        this.input.addEventListener('keydown', (e) => {
            // 多行输入模式下，Enter 由 collector 处理（python-env），跳过默认逻辑
            if (this.isMultiLineCollecting) return;

            if (e.key === 'Enter' && !this.isProcessing) {
                const command = this.input.value.trim();
                if (command) {
                    // 高优5: 同一命令快速按两次 Enter 不会重复入栈
                    if (this.history[this.history.length - 1] !== command) {
                        this.history.push(command);
                    }
                    this.historyIndex = this.history.length;
                    this.executeCommand(command);
                }
                this.input.value = '';
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                if (this.isMultiLineCollecting) return;
                if (this.historyIndex > 0) {
                    this.historyIndex--;
                    this.input.value = this.history[this.historyIndex];
                }
            } else if (e.key === 'ArrowDown') {
                e.preventDefault();
                if (this.isMultiLineCollecting) return;
                if (this.historyIndex < this.history.length - 1) {
                    this.historyIndex++;
                    this.input.value = this.history[this.historyIndex];
                } else {
                    this.historyIndex = this.history.length;
                    this.input.value = '';
                }
            }
        });

        // 点击终端自动聚焦输入框
        document.getElementById('terminal').addEventListener('click', () => {
            this.input.focus();
        });
    },

    printWelcomeMessage() {
        this.println('╔══════════════════════════════════════════════════════════╗', 'info-line');
        this.println('║              MLTSF - 多语言终端模拟器 v3.0              ║', 'info-line');
        this.println('║          集成 Python, C++, CMD 环境于一体               ║', 'info-line');
        this.println('╚══════════════════════════════════════════════════════════╝', 'info-line');
        this.println('');
        this.println('输入 /help 查看所有可用命令', 'success-line');
        this.println('');
    },

    println(text, className = '') {
        const line = document.createElement('div');
        line.textContent = text;
        if (className) line.className = className;
        this.output.appendChild(line);
        this.scrollToBottom();
    },

    printHtml(html, className = '') {
        const line = document.createElement('div');
        // 安全过滤：移除 script 标签和事件处理器属性，防止 XSS 注入
        const sanitized = html
            .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
            .replace(/\s+on\w+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')
            .replace(/javascript\s*:/gi, '');
        line.innerHTML = sanitized;
        if (className) line.className = className;
        this.output.appendChild(line);
        this.scrollToBottom();
    },

    scrollToBottom() {
        this.output.scrollTop = this.output.scrollHeight;
    },

    clear() {
        this.output.innerHTML = '';
    },

    restoreSavedColor() {
        // 启动时强制清理任何残余的 Black 类（来自旧版本配置）
        document.body.classList.remove('color-Black');
        document.getElementById('terminal').classList.remove('color-Black');

        const savedColor = localStorage.getItem('mltsf-color');
        if (savedColor) {
            // 修复: 如果保存的颜色是 Black，不应用（黑字黑底会导致整个终端包括输入框不可见）
            // 并清除这个危险设置，恢复默认绿色
            if (savedColor === 'Black') {
                localStorage.removeItem('mltsf-color');
                return;
            }
            document.body.classList.add(`color-${savedColor}`);
            document.getElementById('terminal').classList.add(`color-${savedColor}`);
        }
    },

    async executeCommand(command) {
        this.isProcessing = true;
        this.println(`${this.prompt.textContent}${command}`);

        try {
            if (command.startsWith('/')) {
                await this.processSystemCommand(command);
            } else if (this.currentEnv) {
                await this.processCodeInput(command);
            } else {
                this.println('错误: 请先使用 /hj 命令选择一个环境', 'error-line');
            }
        } catch (e) {
            this.println(`命令执行异常: ${e.message || e}`, 'error-line');
        } finally {
            this.isProcessing = false;
        }
    },

    async processSystemCommand(command) {
        const parts = command.split(/\s+/);
        const cmd = parts[0].toLowerCase();
        const args = parts.slice(1);

        switch (cmd) {
            case '/help':
                showHelp();
                break;
            case '/cq':
                location.reload();
                break;
            case '/qk':
                this.clear();
                break;
            case '/hj':
                await switchEnvironment(args);
                break;
            case '/color':
                changeColor(args);
                break;
            case '/jr':
                await openProject(args);
                break;
            case '/ex':
                await exitProject(args);
                break;
            case '/op':
                await openLocalItem(args);
                break;
            case '/y':
                toggleSource(args);
                break;
            case '/bq':
                showDisclaimer();
                break;
            case '/lxe':
                if (extensionManager && extensionManager.listExtensions) extensionManager.listExtensions();
                else this.println('扩展管理器未就绪', 'warning-line');
                break;
            case '/查看扩展包':
                if (extensionManager && extensionManager.getAvailableExtensions) await extensionManager.getAvailableExtensions();
                else this.println('扩展管理器未就绪', 'warning-line');
                break;
            case '/ap':
                if (extensionManager && extensionManager.loadExtension) await extensionManager.loadExtension(args[0], args[1]);
                else this.println('扩展管理器未就绪', 'warning-line');
                break;
            case '/rm':
                if (extensionManager && extensionManager.unloadExtension) await extensionManager.unloadExtension(args[0]);
                else this.println('扩展管理器未就绪', 'warning-line');
                break;
            case '/az':
                if (extensionManager && extensionManager.loadExtensionFromUrl) await extensionManager.loadExtensionFromUrl(args.join(' '));
                else this.println('扩展管理器未就绪', 'warning-line');
                break;
            case '/ar':
                if (extensionManager && extensionManager.autoRecognizeExtension) await extensionManager.autoRecognizeExtension(args.join(' '));
                else this.println('扩展管理器未就绪', 'warning-line');
                break;
            case '/wr':
                writeFile(args);
                break;
            case '/run':
                await runCode(args);
                break;
            case '/dc':
                exportProject(args);
                break;
            case '/xj':
                createItem(args);
                break;
            case '/d':
                await installPackage(args);
                break;
            case '/b':
                deleteItem(args);
                break;
            case '/extlist':
                listExtensionCommands();
                break;
            case '/runxt':
                await runExtensionCommand(args);
                break;
            case '/extstatus':
                showExtensionStatus();
                break;
            case '/ai':
                try { await aiCommand(args); } catch (e) {
                    this.println('AI 模块内部错误: ' + (e && e.message || String(e)), 'error-line');
                }
                break;
            case '/aic':
                try { aiClearAll(); } catch (e) {
                    this.println('清除配置失败: ' + (e && e.message || String(e)), 'error-line');
                }
                break;
            default:
                // 检查是否是扩展包注册的命令
                if (window.extensionManager && window.extensionManager.registeredCommands && window.extensionManager.registeredCommands[cmd]) {
                    const extCmd = window.extensionManager.registeredCommands[cmd];
                    try {
                        await extCmd.handler(args, terminal);
                    } catch (e) {
                        this.println(`扩展命令 '${cmd}' 执行错误: ${e.message}`, 'error-line');
                    }
                } else {
                    this.println(`错误: 未知命令 '${cmd}'，输入 /help 查看帮助`, 'error-line');
                }
        }
    },

    async processCodeInput(code) {
        if (this.currentEnv === 'python') {
            await runPythonCode(code);
        } else if (this.currentEnv === 'c++') {
            // C++需要完整文件编译，这里提示用户使用/run命令
            this.println('提示: C++环境需要使用 /run 命令运行完整文件', 'info-line');
        } else if (this.currentEnv === 'cmd') {
            runCmdCommand(code);
        }
    },

    setPrompt(text) {
        this.prompt.textContent = text;
    },

    updateEnvDisplay(envName) {
        document.getElementById('current-env').textContent = `当前环境: ${envName}`;
    }
};

// 将终端对象暴露到全局，供 ExtensionAPI 等模块使用
// （let 声明的全局变量不会自动成为 window 属性）
window.terminal = terminal;

// 初始化终端
window.addEventListener('load', () => {
    terminal.init();
});