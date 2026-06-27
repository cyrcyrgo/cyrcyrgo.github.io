/**
 * 蟒蛇 Python在线编译器 - 国际化
 * 支持中英文即时切换
 */

class I18n {
    constructor() {
        this.currentLanguage = 'zh-CN';
        this.translations = {
            'zh-CN': {
                // 应用信息
                'app.name': '蟒蛇',
                'app.title': 'Python在线编译器',
                'app.version': 'v1.0.0',
                
                // 菜单
                'menu.file': '文件',
                'menu.edit': '编辑',
                'menu.run': '运行',
                'menu.packages': '包',
                'menu.examples': '示例',
                'menu.help': '帮助',
                
                // 文件菜单
                'file.new': '新建文件',
                'file.open': '打开文件',
                'file.save': '保存文件',
                'file.downloadPy': '下载 .py 文件',
                'file.downloadHtml': '导出为 HTML',
                
                // 编辑菜单
                'edit.undo': '撤销',
                'edit.redo': '重做',
                'edit.cut': '剪切',
                'edit.copy': '复制',
                'edit.paste': '粘贴',
                'edit.find': '查找',
                'edit.replace': '替换',
                'edit.formatCode': '格式化代码',
                'edit.commentToggle': '注释/取消注释',
                
                // 运行菜单
                'run.runCode': '运行代码',
                'run.runSelection': '运行选中代码',
                'run.stop': '停止',
                'run.clearConsole': '清空控制台',
                
                // 包菜单
                'packages.install': '安装包',
                'packages.installed': '已安装包',
                'packages.installNumpy': '安装 NumPy',
                'packages.installPandas': '安装 Pandas',
                'packages.installMatplotlib': '安装 Matplotlib',
                
                // 示例菜单
                'example.hello': 'Hello World',
                'example.calculator': '计算器',
                'example.loop': '循环示例',
                'example.function': '函数示例',
                'example.class': '类示例',
                'example.numpy': 'NumPy 示例',
                'example.matplotlib': 'Matplotlib 示例',
                
                // 帮助菜单
                'help.documentation': 'Python 文档',
                'help.shortcuts': '快捷键',
                'help.about': '关于',
                'help.disclaimer': '免责声明',
                
                // 控制台
                'console.title': '控制台',
                'console.output': '输出',
                'console.problems': '问题',
                'console.variables': '变量',
                'console.inputPlaceholder': '输入 Python 表达式...',
                'console.filterAll': '全部',
                'console.filterError': '错误',
                'console.filterOutput': '输出',
                'console.filterWarning': '警告',
                'console.state.idle': '空闲中',
                'console.state.compiling': '编译中',
                'console.state.outputting': '输出中',
                'console.state.awaitingInput': '等待用户输入中',
                'console.inputPrompt': '>>> 请输入:',
                'console.inputEcho': '输入:',
                'console.problems.simple': '简易',
                'console.problems.advanced': '进阶',
                'console.problems.analyzeMode': '分析模式:',
                'console.problems.fixSuggestion': '修复建议',
                'console.problems.noProblems': '未检测到问题',
                'console.problems.analyzing': '分析中...',
                'console.problems.logixLoading': 'LogiX 分析引擎加载中...',
                'console.problems.logixPowered': '由 LogiX 分析引擎提供技术支持',
                'console.cancelInput': '取消输入',
                
                // 状态栏
                'status.ready': '就绪',
                'status.running': '运行中...',
                'status.stopped': '已停止',
                'status.saved': '已保存',
                'status.executionTime': '执行时间',
                'status.msSuffix': 'ms',
                'status.emptyOutput': '暂无输出',
                'status.noProblems': '未检测到问题',
                'status.noVariables': '无变量',
                'status.noOutline': '暂无大纲',
                'status.lineColumn': '行 {line}, 列 {col}',
                'status.initMessage': 'Python就绪，正在加载编辑器...',
                'status.runCancelled': '已取消运行',
                'status.line': '行',
                
                // 加载
                'loading.initPyodide': '正在初始化 Python 运行时...',
                'loading.loadingRuntime': '正在加载Python运行时...',
                'loading.loadingComplete': 'Python运行时加载完成',
                'loading.loadFailed': 'Python运行时加载失败',
                'loading.initComplete': '初始化完成',
                'loading.firstLoad': '首次加载需要下载约 10MB 的 Python 运行时',
                
                // 输入对话框
                'input.title': '程序需要输入',
                'input.hint': '检测到 {count} 个 input() 调用，请输入所需值：',
                'input.inputNumber': '输入 #{num}',
                'input.continue': '继续运行',
                'input.cancel': '取消',
                'input.placeholder': '请输入值...',
                
                // Toast Messages
                'toast.languageChanged': '语言已切换',
                'toast.codeEmpty': '代码为空',
                'toast.pyodideNotReady': 'Python运行时未就绪，请稍候...',
                'toast.pyodideNotReadyShort': 'Python运行时未就绪',
                'toast.runCancelled': '已取消运行',
                'toast.stopped': '已停止',
                'toast.saved': '已保存',
                'toast.noSelection': '没有选中代码',
                'toast.alreadyRunning': '代码正在运行中，请稍候...',
                'toast.execFailed': '执行失败',
                'toast.execError': '执行错误',
                'toast.fileExists': '文件 "{name}" 已存在，请使用其他名称',
                'toast.keepOneFile': '至少保留一个文件',
                'toast.fileOpened': '已打开: {name}',
                'toast.fileSaved': '已保存: {name}',
                'toast.installing': '正在安装 {package}...',
                'toast.installSuccess': '{package} 安装成功',
                'toast.installFailed': '安装失败: {error}',
                'toast.exampleLoaded': '已加载示例: {name}',
                'toast.initFailed': '初始化失败: {msg}',
                'toast.loadingFailedText': '加载失败: {msg}',
                
                // 其他
                'sidebar.files': '文件',
                'sidebar.outline': '大纲',
                'sidebar.snippets': '代码片段',
                'variables.none': '无变量',
                'fileName.main': 'main.py',
                
                // 快捷键提示
                'shortcut.run': '运行',
                'shortcut.runSelection': '运行选中代码',
                'shortcut.save': '保存文件',
                'shortcut.open': '打开文件',
                'shortcut.newFile': '新建文件',
                
                // 默认代码注释
                'defaultCode.title': '蟒蛇 Python在线编译器',
                'defaultCode.welcome': '欢迎使用蟒蛇Python在线编译器！',
                'defaultCode.instruction': '在这里编写你的Python代码，然后点击"运行"按钮执行。',
                'defaultCode.example': '示例：Hello World',
                'defaultCode.simpleCalc': '示例：简单计算',
                'defaultCode.listOps': '示例：列表操作'
            },
            
            'en': {
                // App Info
                'app.name': 'Python',
                'app.title': 'Python Online Compiler',
                'app.version': 'v1.0.0',
                
                // Menu
                'menu.file': 'File',
                'menu.edit': 'Edit',
                'menu.run': 'Run',
                'menu.packages': 'Packages',
                'menu.examples': 'Examples',
                'menu.help': 'Help',
                
                // File Menu
                'file.new': 'New File',
                'file.open': 'Open File',
                'file.save': 'Save File',
                'file.downloadPy': 'Download .py File',
                'file.downloadHtml': 'Export as HTML',
                
                // Edit Menu
                'edit.undo': 'Undo',
                'edit.redo': 'Redo',
                'edit.cut': 'Cut',
                'edit.copy': 'Copy',
                'edit.paste': 'Paste',
                'edit.find': 'Find',
                'edit.replace': 'Replace',
                'edit.formatCode': 'Format Code',
                'edit.commentToggle': 'Toggle Comment',
                
                // Run Menu
                'run.runCode': 'Run Code',
                'run.runSelection': 'Run Selection',
                'run.stop': 'Stop',
                'run.clearConsole': 'Clear Console',
                
                // Packages Menu
                'packages.install': 'Install Package',
                'packages.installed': 'Installed Packages',
                'packages.installNumpy': 'Install NumPy',
                'packages.installPandas': 'Install Pandas',
                'packages.installMatplotlib': 'Install Matplotlib',
                
                // Examples Menu
                'example.hello': 'Hello World',
                'example.calculator': 'Calculator',
                'example.loop': 'Loop Example',
                'example.function': 'Function Example',
                'example.class': 'Class Example',
                'example.numpy': 'NumPy Example',
                'example.matplotlib': 'Matplotlib Example',
                
                // Help Menu
                'help.documentation': 'Python Documentation',
                'help.shortcuts': 'Shortcuts',
                'help.about': 'About',
                'help.disclaimer': 'Disclaimer',
                
                // Console
                'console.title': 'Console',
                'console.output': 'Output',
                'console.problems': 'Problems',
                'console.variables': 'Variables',
                'console.inputPlaceholder': 'Enter Python expression...',
                'console.filterAll': 'All',
                'console.filterError': 'Error',
                'console.filterOutput': 'Output',
                'console.filterWarning': 'Warning',
                'console.state.idle': 'Idle',
                'console.state.compiling': 'Compiling',
                'console.state.outputting': 'Outputting',
                'console.state.awaitingInput': 'Waiting for input',
                'console.inputPrompt': '>>> Input:',
                'console.inputEcho': 'Input:',
                'console.problems.simple': 'Simple',
                'console.problems.advanced': 'Advanced',
                'console.problems.analyzeMode': 'Analysis Mode:',
                'console.problems.fixSuggestion': 'Fix Suggestion',
                'console.problems.noProblems': 'No problems detected',
                'console.problems.analyzing': 'Analyzing...',
                'console.problems.logixLoading': 'LogiX Engine Loading...',
                'console.problems.logixPowered': 'Powered by LogiX Analysis Engine',
                'console.cancelInput': 'Cancel Input',
                
                // Status Bar
                'status.ready': 'Ready',
                'status.running': 'Running...',
                'status.stopped': 'Stopped',
                'status.saved': 'Saved',
                'status.executionTime': 'Execution time',
                'status.msSuffix': 'ms',
                'status.emptyOutput': 'No output',
                'status.noProblems': 'No problems',
                'status.noVariables': 'No variables',
                'status.noOutline': 'No outline',
                'status.lineColumn': 'Line {line}, Col {col}',
                'status.initMessage': 'Python ready, loading editor...',
                'status.runCancelled': 'Run cancelled',
                'status.line': 'Line',
                
                // Loading
                'loading.initPyodide': 'Initializing Python runtime...',
                'loading.loadingRuntime': 'Loading Python runtime...',
                'loading.loadingComplete': 'Python runtime loaded',
                'loading.loadFailed': 'Python runtime load failed',
                'loading.initComplete': 'Initialization complete',
                'loading.firstLoad': 'First load requires ~10MB Python runtime download',
                
                // Input Dialog
                'input.title': 'Input Required',
                'input.hint': 'Detected {count} input() call(s), please enter values:',
                'input.inputNumber': 'Input #{num}',
                'input.continue': 'Continue',
                'input.cancel': 'Cancel',
                'input.placeholder': 'Enter value...',
                
                // Toast Messages
                'toast.languageChanged': 'Language changed',
                'toast.codeEmpty': 'Code is empty',
                'toast.pyodideNotReady': 'Python runtime not ready, please wait...',
                'toast.pyodideNotReadyShort': 'Python runtime not ready',
                'toast.runCancelled': 'Run cancelled',
                'toast.stopped': 'Stopped',
                'toast.saved': 'Saved',
                'toast.noSelection': 'No code selected',
                'toast.alreadyRunning': 'Code is already running, please wait...',
                'toast.execFailed': 'Execution failed',
                'toast.execError': 'Execution error',
                'toast.fileExists': 'File "{name}" already exists, please use another name',
                'toast.keepOneFile': 'At least one file must be kept',
                'toast.fileOpened': 'Opened: {name}',
                'toast.fileSaved': 'Saved: {name}',
                'toast.installing': 'Installing {package}...',
                'toast.installSuccess': '{package} installed successfully',
                'toast.installFailed': 'Installation failed: {error}',
                'toast.exampleLoaded': 'Example loaded: {name}',
                'toast.initFailed': 'Initialization failed: {msg}',
                'toast.loadingFailedText': 'Loading failed: {msg}',
                
                // Others
                'sidebar.files': 'Files',
                'sidebar.outline': 'Outline',
                'sidebar.snippets': 'Snippets',
                'variables.none': 'No variables',
                'fileName.main': 'main.py',
                
                // Shortcuts
                'shortcut.run': 'Run',
                'shortcut.runSelection': 'Run Selection',
                'shortcut.save': 'Save File',
                'shortcut.open': 'Open File',
                'shortcut.newFile': 'New File',
                
                // Default Code Comments
                'defaultCode.title': 'Python Online Compiler',
                'defaultCode.welcome': 'Welcome to Python Online Compiler!',
                'defaultCode.instruction': 'Write your Python code here and click "Run" to execute.',
                'defaultCode.example': 'Example: Hello World',
                'defaultCode.simpleCalc': 'Example: Simple Calculation',
                'defaultCode.listOps': 'Example: List Operations'
            }
        };
        
        // 页面加载时立即应用当前语言，避免显示 raw key
        this._updateUI();
    }
    
    /**
     * 翻译
     * @param {string} key 翻译键
     * @param {object} params 替换参数
     */
    t(key, params = {}) {
        const lang = this.translations[this.currentLanguage];
        let text = lang ? (lang[key] || key) : key;
        
        // 替换参数
        Object.keys(params).forEach(k => {
            text = text.replace(new RegExp(`\\{${k}\\}`, 'g'), params[k]);
        });
        
        return text;
    }
    
    /**
     * 设置语言并立即更新UI
     */
    setLanguage(lang) {
        if (!this.translations[lang]) {
            return false;
        }
        
        this.currentLanguage = lang;
        
        // 立即更新所有UI元素
        this._updateUI();
        
        // 触发语言变更事件
        window.dispatchEvent(new CustomEvent('languageChanged', { 
            detail: { language: lang } 
        }));
        
        return true;
    }
    
    /**
     * 获取当前语言
     */
    getLanguage() {
        return this.currentLanguage;
    }
    
    /**
     * 更新所有带有data-i18n属性的元素
     */
    _updateUI() {
        // 更新文本内容
        document.querySelectorAll('[data-i18n]').forEach(el => {
            const key = el.getAttribute('data-i18n');
            el.textContent = this.t(key);
        });
        
        // 更新placeholder属性
        document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
            const key = el.getAttribute('data-i18n-placeholder');
            el.placeholder = this.t(key);
        });
        
        // 更新title属性
        document.querySelectorAll('[data-i18n-title]').forEach(el => {
            const key = el.getAttribute('data-i18n-title');
            el.title = this.t(key);
        });
        
        // 更新特定元素
        this._updateSpecificElements();
    }
    
    /**
     * 更新特定的动态元素
     */
    _updateSpecificElements() {
        // 更新控制台欢迎信息
        const welcomeEl = document.querySelector('.welcome-text');
        if (welcomeEl) {
            welcomeEl.textContent = this.t('app.title') + ' - ' + this.t('app.name') + ' ' + this.t('app.version');
        }
        
        // 更新运行按钮
        const runBtn = document.getElementById('btn-run');
        if (runBtn) {
            runBtn.innerHTML = `<i class="fas fa-play"></i> ${this.t('shortcut.run')}`;
        }
        
        // 更新文件名输入框
        const fileNameInput = document.getElementById('file-name-input');
        if (fileNameInput) {
            fileNameInput.title = this.t('file.new');
        }
        
        // 更新侧边栏标签
        this._updateSidebarTabs();
        
        // 更新输出面板标签
        this._updateOutputTabs();
        
        // 更新控制台输入框
        const consoleInput = document.getElementById('console-input');
        if (consoleInput) {
            consoleInput.placeholder = this.t('console.inputPlaceholder');
        }
        
        // 更新过滤器按钮
        this._updateFilterButtons();
        
        // 更新状态栏
        this._updateStatusBar();
        
        // 更新控制台状态圆点文字
        this._updateConsoleStatusDot();
        
        // 更新问题面板模式按钮
        this._updateProblemsModeButtons();
    }
    
    /**
     * 更新侧边栏标签
     */
    _updateSidebarTabs() {
        const tabs = {
            'files': 'sidebar.files',
            'outline': 'sidebar.outline',
            'snippets': 'sidebar.snippets'
        };
        
        document.querySelectorAll('.sidebar-tab').forEach(tab => {
            const key = tab.dataset.tab;
            if (tabs[key]) {
                const icon = tab.querySelector('i');
                if (icon) {
                    tab.innerHTML = icon.outerHTML + ' ' + this.t(tabs[key]);
                }
            }
        });
    }
    
    /**
     * 更新输出面板标签
     */
    _updateOutputTabs() {
        const tabs = {
            'console': 'console.title',
            'output': 'console.output',
            'problems': 'console.problems',
            'variables': 'console.variables'
        };
        
        document.querySelectorAll('.output-tab').forEach(tab => {
            const key = tab.dataset.tab;
            if (tabs[key]) {
                const icon = tab.querySelector('i');
                const badge = tab.querySelector('.badge');
                let html = icon ? icon.outerHTML + ' ' : '';
                html += this.t(tabs[key]);
                if (badge) {
                    html += ' ' + badge.outerHTML;
                }
                tab.innerHTML = html;
            }
        });
    }
    
    /**
     * 更新过滤器按钮
     */
    _updateFilterButtons() {
        const filters = {
            'all': 'console.filterAll',
            'output': 'console.filterOutput',
            'error': 'console.filterError',
            'warning': 'console.filterWarning'
        };
        
        document.querySelectorAll('.filter-btn').forEach(btn => {
            const key = btn.dataset.filter;
            if (filters[key]) {
                btn.textContent = this.t(filters[key]);
            }
        });
    }
    
    /**
     * 更新状态栏
     */
    _updateStatusBar() {
        const statusEl = document.getElementById('status-ready');
        if (statusEl) {
            statusEl.innerHTML = `<i class="fas fa-check-circle"></i> ${this.t('status.ready')}`;
        }
    }
    
    /**
     * 更新控制台状态圆点文字
     */
    _updateConsoleStatusDot() {
        const dot = document.getElementById('status-dot');
        const text = document.getElementById('status-dot-text');
        if (!dot || !text) return;
        
        // 根据当前 CSS 类名确定状态
        const stateMap = {
            'idle': 'console.state.idle',
            'compiling': 'console.state.compiling',
            'outputting': 'console.state.outputting',
            'awaiting-input': 'console.state.awaitingInput'
        };
        
        for (const [cls, key] of Object.entries(stateMap)) {
            if (dot.classList.contains(cls)) {
                text.textContent = this.t(key);
                break;
            }
        }
    }
    
    /**
     * 更新问题面板模式按钮文字
     */
    _updateProblemsModeButtons() {
        const simpleBtn = document.getElementById('mode-simple');
        const advancedBtn = document.getElementById('mode-advanced');
        const label = document.querySelector('.mode-label');
        if (simpleBtn) simpleBtn.textContent = this.t('console.problems.simple');
        if (advancedBtn) advancedBtn.textContent = this.t('console.problems.advanced');
        if (label) label.textContent = this.t('console.problems.analyzeMode');
        
        // 更新 LogiX 加载指示器
        const loadingEl = document.querySelector('.logix-loading span');
        if (loadingEl) loadingEl.textContent = this.t('console.problems.logixLoading');
        
        // 更新 LogiX 引擎标识
        const brandEl = document.querySelector('.logix-brand');
        if (brandEl) brandEl.innerHTML = `<i class="fas fa-microchip"></i> ${this.t('console.problems.logixPowered')}`;
    }
}

// 创建全局实例
window.i18n = new I18n();

// 快捷函数
window.t = (key, params) => window.i18n.t(key, params);

console.log('国际化系统加载完成');