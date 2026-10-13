/**
 * 蟒蛇 Python在线编译器 - 主应用
 */

class PythonIDE {
    constructor() {
        this.version = '1.0.0';
        this.isReady = false;
        this.isRunning = false;
    }
    
    /**
     * 初始化应用
     */
    async init() {
        console.log('🐍 蟒蛇 Python在线编译器启动中...');
        
        try {
            // 先初始化Pyodide（最重要的）
            await this._initPyodide();
            
            // 防御性再次应用 i18n，避免缓存导致显示 raw key
            window.i18n._updateUI();
            
            // 先初始化文件管理器（作为文件内容的唯一数据源）
            window.fileManager.init();
            
            // 初始化编辑器，直接以当前文件内容作为初始值，避免重复设置导致 modified 标记
            const initialContent = window.fileManager.getCurrentFile()?.content || '';
            await window.editorManager.init('monaco-editor', initialContent);
            
            // Monaco 就绪后才隐藏加载遮罩
            const overlay = document.getElementById('loading-overlay');
            if (overlay) {
                setTimeout(() => overlay.classList.add('hidden'), 300);
            }
            
            this._updateStatus(window.t('status.ready'));
            
            // 初始化控制台
            window.consoleManager.init('console-output', 'console-input');
            
            // 绑定事件
            this._bindEvents();
            
            // 绑定问题面板模式切换
            this._bindProblemsMode();
            
            // 绑定菜单
            this._bindMenuActions();
            
            // 加载示例代码片段
            this._loadSnippets();
            
            // 渲染初始编辑器标签页
            this._renderEditorTabs();
            
            // 更新大纲面板
            this._updateOutline();
            
            // 初始化输出/问题面板为空状态
            this._updateOutputPanel('');
            this._showLogiXLoading();
            this._runStaticAnalysis();
            
            // 启动内存使用轮询
            this._updateMemoryUsage();
            setInterval(() => this._updateMemoryUsage(), 5000);
            
            console.log('✅ 蟒蛇 Python编译器初始化完成');
            
        } catch (error) {
            console.error('Init failed:', error);
            this._showToast(window.t('toast.initFailed', { msg: error.message }), 'error');
        }
    }
    
    /**
     * 初始化Pyodide
     */
    async _initPyodide() {
        const updateProgress = (status, progress) => {
            const statusEl = document.getElementById('loading-status');
            const progressEl = document.getElementById('progress-bar');
            if (statusEl) statusEl.textContent = status;
            if (progressEl) progressEl.style.width = progress + '%';
        };
        
        try {
            updateProgress(window.t('loading.loadingRuntime'), 10);
            
            await window.pyodideManager.init(updateProgress);
            
            // 设置Python版本
            const version = await window.pyodideManager.getVersion();
            window.consoleManager.setPythonVersion(version);
            
            // 更新状态
            const statusEl = document.getElementById('python-status');
            if (statusEl) {
                statusEl.innerHTML = '<i class="fas fa-circle" style="color: #28A745;"></i> Python';
            }
            
            this.isReady = true;
            this._updateStatus(window.t('status.initMessage'));
            
            this._showToast(window.t('loading.loadingComplete'), 'success');
            
        } catch (error) {
            console.error('Pyodide init failed:', error);
            const statusEl = document.getElementById('loading-status');
            if (statusEl) statusEl.textContent = window.t('toast.loadingFailedText', { msg: error.message });
            this._showToast(window.t('loading.loadFailed'), 'error');
        }
    }
    
    /**
     * 绑定事件
     */
    _bindEvents() {
        // 运行按钮
        document.getElementById('btn-run')?.addEventListener('click', () => this.runCode());
        document.getElementById('btn-stop')?.addEventListener('click', () => this.stopCode());
        
        // 清空控制台
        document.getElementById('btn-clear-console')?.addEventListener('click', () => {
            window.consoleManager.clear();
        });
        
        // 导出控制台
        document.getElementById('btn-export-console')?.addEventListener('click', () => {
            const content = window.consoleManager.export();
            const blob = new Blob([content], { type: 'text/plain' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'console_output.txt';
            a.click();
            URL.revokeObjectURL(url);
        });
        
        // 控制台过滤器
        document.querySelectorAll('.filter-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                window.consoleManager.setFilter(btn.dataset.filter);
            });
        });
        
        // 语言选择
        document.getElementById('language-select')?.addEventListener('change', (e) => {
            window.i18n.setLanguage(e.target.value);
            this._showToast(window.t('toast.languageChanged'), 'success');
        });
        
        // 顶部下拉菜单支持点击展开（兼容无鼠标/触屏环境）
        document.querySelectorAll('.menu-item.dropdown > .menu-label').forEach(label => {
            label.addEventListener('click', (e) => {
                e.stopPropagation();
                const item = label.parentElement;
                const isOpen = item.classList.contains('open');
                document.querySelectorAll('.menu-item.dropdown').forEach(el => el.classList.remove('open'));
                if (!isOpen) item.classList.add('open');
            });
        });
        
        // 点击页面其他地方关闭下拉菜单
        document.addEventListener('click', () => {
            document.querySelectorAll('.menu-item.dropdown').forEach(el => el.classList.remove('open'));
        });
        
        // 侧边栏标签
        document.querySelectorAll('.sidebar-tab').forEach(tab => {
            tab.addEventListener('click', () => {
                document.querySelectorAll('.sidebar-tab').forEach(t => t.classList.remove('active'));
                document.querySelectorAll('.sidebar-panel').forEach(p => p.classList.remove('active'));
                
                tab.classList.add('active');
                document.getElementById('panel-' + tab.dataset.tab)?.classList.add('active');
            });
        });
        
        // 输出面板标签
        document.querySelectorAll('.output-tab').forEach(tab => {
            tab.addEventListener('click', () => {
                document.querySelectorAll('.output-tab').forEach(t => t.classList.remove('active'));
                document.querySelectorAll('.output-view').forEach(v => v.classList.remove('active'));
                
                tab.classList.add('active');
                document.getElementById('view-' + tab.dataset.tab)?.classList.add('active');
            });
        });
        
        // 新建文件按钮
        document.getElementById('btn-new-file')?.addEventListener('click', () => {
            this._createNewFile();
        });
        
        // 顶部文件名输入框重命名
        document.getElementById('file-name-input')?.addEventListener('change', (e) => {
            const newName = e.target.value.trim();
            const currentFile = window.fileManager?.getCurrentFile();
            if (newName && currentFile) {
                currentFile.name = newName;
                window.fileManager.updateFileTree();
                this._renderEditorTabs();
            }
        });
        
        // 面板拖拽调整大小
        this._initPanelResizer();
        
        // 侧边栏切换按钮（窄视口）
        this._initSidebarToggle();
        
        // 快捷键
        document.addEventListener('keydown', (e) => {
            if (e.ctrlKey || e.metaKey) {
                switch (e.key.toLowerCase()) {
                    case 's':
                        e.preventDefault();
                        this.saveFile();
                        break;
                    case 'o':
                        e.preventDefault();
                        window.fileManager.openFile();
                        break;
                    case 'n':
                        e.preventDefault();
                        document.getElementById('btn-new-file')?.click();
                        break;
                }
            }
            
            if (e.key === 'F5') {
                e.preventDefault();
                if (e.shiftKey) {
                    this.runSelection();
                } else {
                    this.runCode();
                }
            }
        });
        
        // 取消 input 等待按钮（移动端软入口）
        document.getElementById('btn-cancel-input')?.addEventListener('click', () => {
            const inputEl = document.getElementById('console-input');
            if (inputEl) {
                inputEl.value = '';
                inputEl.placeholder = window.t('console.inputPlaceholder');
            }
            window.pyodideManager?.cancelInput();
            this._setConsoleState('idle');
        });
    }
    
    /**
     * 绑定问题面板模式切换和静态分析
     */
    _bindProblemsMode() {
        // 模式切换
        document.getElementById('mode-simple')?.addEventListener('click', () => {
            this._setAnalysisMode('simple');
        });
        document.getElementById('mode-advanced')?.addEventListener('click', () => {
            this._setAnalysisMode('advanced');
        });
        
        // 手动分析按钮
        document.getElementById('btn-analyze')?.addEventListener('click', () => {
            this._showLogiXLoading();
            setTimeout(() => this._runStaticAnalysis(), 200);
        });
        
        // 编辑器内容变化时自动分析（防抖 500ms）
        if (window.editorManager?.editor) {
            window.editorManager.editor.onDidChangeModelContent(() => {
                clearTimeout(this._analysisDebounce);
                this._analysisDebounce = setTimeout(() => {
                    this._runStaticAnalysis();
                }, 500);
            });
        }
    }
    
    /**
     * 设置分析模式
     */
    _setAnalysisMode(mode) {
        window.logiX.setMode(mode);
        
        // 更新按钮状态
        document.getElementById('mode-simple')?.classList.toggle('active', mode === 'simple');
        document.getElementById('mode-advanced')?.classList.toggle('active', mode === 'advanced');
        
        // 显示加载指示器
        this._showLogiXLoading();
        
        // 延迟重新分析（让加载提示可见）
        setTimeout(() => this._runStaticAnalysis(), 200);
    }
    
    /**
     * 显示 LogiX 分析引擎加载中
     */
    _showLogiXLoading() {
        const container = document.getElementById('problems-list');
        if (container) {
            container.innerHTML = `<div class="logix-loading">
                <span class="logix-loading__icon"><i class="fas fa-microchip"></i></span>
                <span class="logix-loading__text">
                    <span class="logix-loading__title">${window.t('console.problems.logixLoading')}</span>
                    <span class="logix-loading__sub">scanning</span>
                </span>
            </div>`;
        }
        // 同步状态徽章
        const stats = document.getElementById('logix-stats');
        if (stats) {
            stats.classList.remove('logix-stats--error');
            stats.classList.add('logix-stats--loading');
            const label = stats.querySelector('.logix-stats__label');
            if (label) label.textContent = window.t('console.problems.logixLoading');
        }
    }

    /**
     * 运行静态代码分析
     */
    _runStaticAnalysis() {
        const code = window.editorManager?.getValue();
        if (!code || !code.trim()) {
            this._updateProblemsPanel(null);
            return;
        }

        const problems = window.logiX.analyze(code);
        this._updateProblemsPanel(null, problems);

        // 还原状态徽章
        const stats = document.getElementById('logix-stats');
        if (stats) {
            stats.classList.remove('logix-stats--loading', 'logix-stats--error');
            const label = stats.querySelector('.logix-stats__label');
            if (label) {
                const s = window.logiX.getStats();
                label.textContent = `v${s.version} · ${s.count} 次分析`;
            }
        }
    }
    
    /**
     * 绑定菜单动作
     */
    _bindMenuActions() {
        // 文件菜单
        this._bindAction('new-file', () => document.getElementById('btn-new-file')?.click());
        this._bindAction('open-file', () => window.fileManager.openFile());
        this._bindAction('save-file', () => this.saveFile());
        this._bindAction('download-py', () => window.fileManager.downloadPy());
        this._bindAction('download-html', () => window.fileManager.downloadHtml());
        
        // 编辑菜单
        this._bindAction('undo', () => window.editorManager.undo());
        this._bindAction('redo', () => window.editorManager.redo());
        this._bindAction('cut', () => window.editorManager.cut());
        this._bindAction('copy', () => window.editorManager.copy());
        this._bindAction('paste', () => window.editorManager.paste());
        this._bindAction('find', () => window.editorManager.showFind());
        this._bindAction('replace', () => window.editorManager.showReplace());
        this._bindAction('format-code', () => window.editorManager.formatCode());
        this._bindAction('comment-toggle', () => window.editorManager.toggleComment());
        
        // 运行菜单
        this._bindAction('run-code', () => this.runCode());
        this._bindAction('run-selection', () => this.runSelection());
        this._bindAction('stop', () => this.stopCode());
        this._bindAction('clear-console', () => window.consoleManager.clear());
        
        // 包菜单
        this._bindAction('install-package', () => this._showPackageDialog());
        this._bindAction('list-packages', () => this._showInstalledPackages());
        this._bindAction('install-numpy', () => this._installPackage('numpy'));
        this._bindAction('install-pandas', () => this._installPackage('pandas'));
        this._bindAction('install-matplotlib', () => this._installPackage('matplotlib'));
        
        // 示例菜单
        this._bindAction('example-hello', () => this._loadExample('hello'));
        this._bindAction('example-calculator', () => this._loadExample('calculator'));
        this._bindAction('example-loop', () => this._loadExample('loop'));
        this._bindAction('example-function', () => this._loadExample('function'));
        this._bindAction('example-class', () => this._loadExample('class'));
        this._bindAction('example-numpy', () => this._loadExample('numpy'));
        this._bindAction('example-matplotlib', () => this._loadExample('matplotlib'));
        
        // 帮助菜单
        this._bindAction('documentation', () => window.open('https://docs.python.org/zh-cn/3/', '_blank'));
        this._bindAction('shortcuts', () => this._showShortcuts());
        this._bindAction('about', () => this._showAbout());
        this._bindAction('disclaimer', () => window.open('免责声明1.html', '_blank'));
    }
    
    /**
     * 绑定动作
     */
    _bindAction(action, callback) {
        document.querySelector(`[data-action="${action}"]`)?.addEventListener('click', callback);
    }
    
    /**
     * 创建新文件并切换到该文件
     */
    _createNewFile() {
        const name = prompt('文件名:', 'untitled.py');
        if (!name) return;
        
        // 检查同名文件
        const existing = window.fileManager?.getAllFiles().find(f => f.name === name);
        if (existing) {
            this._showToast(window.t('toast.fileExists', { name: name }), 'warning');
            return;
        }
        
        // 保存当前文件内容
        const currentFile = window.fileManager?.getCurrentFile();
        if (currentFile && window.editorManager) {
            currentFile.content = window.editorManager.getValue();
            currentFile.modified = true;
        }
        
        const id = window.fileManager.createFile(name, '');
        window.fileManager.setCurrentFile(id);
        window.editorManager?.setValue('', true);
        this._updateFileNameInput(name);
        window.fileManager.updateFileTree();
        this._renderEditorTabs();
    }
    
    /**
     * 同步编辑器显示当前文件内容
     */
    _syncEditorWithCurrentFile(suppressChange = true) {
        const currentFile = window.fileManager?.getCurrentFile();
        if (currentFile && window.editorManager) {
            window.editorManager.setValue(currentFile.content, suppressChange);
            this._updateFileNameInput(currentFile.name);
        }
    }
    
    /**
     * 渲染编辑器标签页
     */
    _renderEditorTabs() {
        const container = document.getElementById('editor-tabs');
        if (!container) return;
        
        container.innerHTML = '';
        
        window.fileManager?.getAllFiles().forEach(file => {
            const tab = document.createElement('div');
            const isActive = file.id === window.fileManager.currentFile;
            tab.className = 'editor-tab' + (isActive ? ' active' : '');
            tab.dataset.fileId = file.id;
            
            const modifiedMark = file.modified ? ' •' : '';
            tab.innerHTML = `
                <i class="fab fa-python"></i>
                <span>${this._escapeHtml(file.name)}${modifiedMark}</span>
                <button class="close-tab" title="关闭"><i class="fas fa-times"></i></button>
            `;
            
            tab.addEventListener('click', (e) => {
                if (e.target.closest('.close-tab')) {
                    this._closeFile(file.id);
                } else {
                    this._switchFile(file.id);
                }
            });
            
            container.appendChild(tab);
        });
    }
    
    /**
     * 切换到指定文件
     */
    _switchFile(id) {
        if (id === window.fileManager.currentFile) return;
        
        // 保存当前文件内容到文件管理器
        const currentFile = window.fileManager.getCurrentFile();
        if (currentFile && window.editorManager) {
            currentFile.content = window.editorManager.getValue();
        }
        
        window.fileManager.setCurrentFile(id);
        this._syncEditorWithCurrentFile();
        window.fileManager.updateFileTree();
        this._renderEditorTabs();
        this._updateOutline();
    }
    
    /**
     * 关闭指定文件
     */
    _closeFile(id) {
        if (window.fileManager.files.size <= 1) {
            this._showToast(window.t('toast.keepOneFile'), 'warning');
            return;
        }
        
        const wasCurrent = id === window.fileManager.currentFile;
        window.fileManager.deleteFile(id);
        
        if (wasCurrent) {
            // 切换到第一个剩余文件
            const firstFile = window.fileManager.getAllFiles()[0];
            if (firstFile) {
                window.fileManager.setCurrentFile(firstFile.id);
            }
        }
        
        this._syncEditorWithCurrentFile();
        window.fileManager.updateFileTree();
        this._renderEditorTabs();
        this._updateOutline();
    }
    
    /**
     * 更新顶部文件名输入框
     */
    _updateFileNameInput(name) {
        const input = document.getElementById('file-name-input');
        if (input) input.value = name;
    }
    
    /**
     * 初始化面板拖拽调整大小
     */
    _initPanelResizer() {
        const resizer = document.getElementById('panel-resizer');
        const panel = document.getElementById('output-panel');
        if (!resizer || !panel) return;
        
        let startX = 0;
        let startWidth = 0;
        
        const onMouseDown = (e) => {
            startX = e.clientX;
            startWidth = panel.offsetWidth;
            document.addEventListener('mousemove', onMouseMove);
            document.addEventListener('mouseup', onMouseUp);
            resizer.classList.add('resizing');
            e.preventDefault();
        };
        
        const onMouseMove = (e) => {
            const dx = startX - e.clientX;
            const newWidth = Math.max(200, Math.min(600, startWidth + dx));
            panel.style.width = newWidth + 'px';
        };
        
        const onMouseUp = () => {
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);
            resizer.classList.remove('resizing');
        };
        
        resizer.addEventListener('mousedown', onMouseDown);
    }
    
    /**
     * 初始化侧边栏切换（窄视口）
     */
    _initSidebarToggle() {
        // 在菜单栏右侧添加侧边栏切换按钮
        const menuRight = document.querySelector('.menu-right');
        if (!menuRight) return;
        
        const toggleBtn = document.createElement('button');
        toggleBtn.id = 'btn-sidebar-toggle';
        toggleBtn.className = 'btn btn-icon btn-sm';
        toggleBtn.title = '切换侧边栏';
        toggleBtn.innerHTML = '<i class="fas fa-bars"></i>';
        toggleBtn.style.cssText = 'display: none;';
        
        toggleBtn.addEventListener('click', () => {
            const sidebar = document.getElementById('sidebar');
            if (sidebar) {
                sidebar.classList.toggle('visible');
            }
        });
        
        // 插入到语言选择器之前
        const langSelector = document.querySelector('.language-selector');
        if (langSelector) {
            menuRight.insertBefore(toggleBtn, langSelector);
        } else {
            menuRight.appendChild(toggleBtn);
        }
        
        // 响应式显示/隐藏按钮
        const updateToggleBtn = () => {
            toggleBtn.style.display = window.innerWidth <= 992 ? 'inline-flex' : 'none';
        };
        updateToggleBtn();
        window.addEventListener('resize', updateToggleBtn);
    }
    
    /**
     * 更新内存使用指示器
     */
    _updateMemoryUsage() {
        const el = document.getElementById('memory-usage');
        if (!el) return;
        
        const usage = window.pyodideManager?.getMemoryUsage();
        if (usage) {
            const mb = (usage.used / 1024 / 1024).toFixed(1);
            el.innerHTML = `<i class="fas fa-memory"></i> ${mb} MB`;
        } else {
            el.innerHTML = '<i class="fas fa-memory"></i> --';
        }
    }
    
    /**
     * 更新大纲面板
     */
    _updateOutline() {
        const container = document.getElementById('outline-list');
        if (!container) return;
        
        const outline = window.editorManager?.getOutline() || [];
        
        container.innerHTML = '';
        
        if (outline.length === 0) {
            container.innerHTML = '<div style="color: #6E6E6E; padding: 10px;">' + window.t('status.noOutline') + '</div>';
            return;
        }
        
        const icons = {
            'class': 'fa-cube',
            'function': 'fa-code',
            'import': 'fa-arrow-right'
        };
        
        outline.forEach(item => {
            const entry = document.createElement('div');
            entry.className = 'outline-item';
            entry.style.cssText = 'padding: 4px 10px; cursor: pointer; font-size: 12px; display: flex; align-items: center; gap: 6px;';
            entry.innerHTML = `
                <i class="fas ${icons[item.type] || 'fa-circle'}" style="font-size: 10px; color: #FFD43B;"></i>
                <span>${this._escapeHtml(item.name)}</span>
                <span style="color: #6E6E6E; margin-left: auto;">${window.t('status.line')} ${item.line}</span>
            `;
            entry.addEventListener('click', () => {
                window.editorManager?.goToLine(item.line);
            });
            entry.addEventListener('mouseenter', () => {
                entry.style.background = '#3C3C3C';
            });
            entry.addEventListener('mouseleave', () => {
                entry.style.background = '';
            });
            container.appendChild(entry);
        });
    }
    
    /**
     * 更新输出面板（纯净 stdout，不带控制台装饰）
     */
    _updateOutputPanel(stdout) {
        const container = document.getElementById('output-content');
        if (!container) return;
        
        if (!stdout) {
            container.innerHTML = '<div style="color: #6E6E6E; padding: 10px;">' + window.t('status.emptyOutput') + '</div>';
            return;
        }
        
        // 保留换行，使用 <pre> 显示纯净输出
        const pre = document.createElement('pre');
        pre.style.cssText = 'margin: 0; padding: 10px; font-family: var(--font-mono); font-size: 12px; color: var(--console-output); white-space: pre-wrap; word-wrap: break-word;';
        pre.textContent = stdout;
        
        container.innerHTML = '';
        container.appendChild(pre);
    }
    
    /**
     * 更新问题面板
     * @param {Error|null} rawError 运行时错误对象
     * @param {Array|null} staticProblems 静态分析问题列表
     */
    _updateProblemsPanel(rawError, staticProblems = null) {
        const container = document.getElementById('problems-list');
        const badge = document.getElementById('problems-count');
        if (!container) return;
        
        // 确定问题来源：运行时错误 或 静态分析
        let problems = [];
        let isStatic = false;
        
        if (staticProblems !== null) {
            problems = staticProblems;
            isStatic = true;
        } else if (rawError) {
            problems = window.pyodideManager.parseProblems(rawError);
        }
        
        // 更新 badge
        if (badge) {
            badge.textContent = problems.length;
            badge.style.display = problems.length > 0 ? '' : 'none';
        }
        
        container.innerHTML = '';
        
        if (problems.length === 0) {
            container.innerHTML = '<div style="color: #6E6E6E; padding: 10px;">' + window.t('status.noProblems') + '</div>';
            return;
        }
        
        const isAdvanced = window.logiX?.mode === 'advanced';
        
        problems.forEach(p => {
            const item = document.createElement('div');
            item.className = 'problem-item';
            item.style.cssText = 'display: flex; align-items: flex-start; gap: 8px; padding: 8px 10px; border-bottom: 1px solid var(--border-color); cursor: pointer; font-size: 12px;';
            
            // 根因 vs 并发症 分色
            const isRootCause = p._isRootCause === true;
            const isDownstream = p._causedBy !== undefined;
            
            const iconMap = {
                'error': 'fa-exclamation-circle',
                'warning': 'fa-exclamation-triangle',
                'info': 'fa-info-circle'
            };
            const colorMap = {
                'error': 'var(--danger)',
                'warning': '#CCA700',
                'info': 'var(--python-blue)'
            };
            const icon = iconMap[p.severity] || 'fa-exclamation-circle';
            const color = colorMap[p.severity] || 'var(--danger)';
            
            // 根因：红色左边框 + 浅红背景
            if (isRootCause) {
                item.style.borderLeft = '3px solid var(--danger)';
                item.style.background = 'rgba(220, 50, 50, 0.08)';
                item.style.paddingLeft = '7px';
            }
            // 下游并发症：橙色左边框
            if (isDownstream) {
                item.style.borderLeft = '3px solid #e67e22';
                item.style.background = 'rgba(230, 126, 34, 0.06)';
                item.style.paddingLeft = '7px';
            }
            
            let badgeHtml = '';
            if (isRootCause) {
                badgeHtml = '<span class="problem-badge problem-badge--root">根因</span>';
            } else if (isDownstream) {
                badgeHtml = '<span class="problem-badge problem-badge--downstream">并发症</span>';
            }
            
            let fixHtml = '';
            if (isAdvanced && p.fix) {
                fixHtml = `<div class="fix-suggestion"><span class="fix-label">${window.t('console.problems.fixSuggestion')}:</span> ${this._escapeHtml(p.fix)}</div>`;
            }
            
            let causeHtml = '';
            if (p._causeMsg) {
                causeHtml = `<div class="cause-chain"><i class="fas fa-level-up-alt fa-rotate-90"></i> 根因: <strong>${this._escapeHtml(p._causeMsg)}</strong></div>`;
            }
            
            item.innerHTML = `
                <i class="fas ${icon}" style="color: ${color}; margin-top: 2px; flex-shrink: 0;"></i>
                <div style="flex: 1; min-width: 0;">
                    <div style="display: flex; align-items: center; gap: 6px; flex-wrap: wrap;">
                        <span style="color: var(--text-primary); word-break: break-word;">${this._escapeHtml(p.message)}</span>
                        ${badgeHtml}
                    </div>
                    <div style="color: var(--text-tertiary); margin-top: 2px; font-size: 10px;">${this._escapeHtml(p.type)} - ${window.t('status.line')} ${p.line}${p.column ? ':' + p.column : ''}</div>
                    ${causeHtml}
                    ${fixHtml}
                </div>
            `;
            
            item.addEventListener('click', () => {
                window.editorManager?.goToLine(p.line);
            });
            item.addEventListener('mouseenter', () => {
                item.style.background = 'var(--bg-hover)';
            });
            item.addEventListener('mouseleave', () => {
                item.style.background = '';
            });
            container.appendChild(item);
        });

        // 更新 LogiX 引擎统计信息
        const stats = window.logiX?.getStats();
        const footer = document.getElementById('logix-footer');
        if (footer && stats) {
            const label = footer.querySelector('.logix-stats__label');
            if (label) label.textContent = `v${stats.version} · ${stats.count} 次分析`;
        }
    }
    
    /**
     * HTML 转义
     */
    _escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = String(text);
        return div.innerHTML;
    }
    
    /**
     * 运行代码
     */
    async runCode() {
        if (!this.isReady) {
            this._showToast(window.t('toast.pyodideNotReady'), 'warning');
            return;
        }
        
        if (this.isRunning) {
            this._showToast(window.t('toast.pyodideNotReady'), 'warning');
            return;
        }
        
        const code = window.editorManager.getValue();
        
        if (!code.trim()) {
            this._showToast(window.t('toast.codeEmpty'), 'warning');
            return;
        }
        
        // 直接执行代码，input() 由交互式控制台输入处理
        await this._executeCode(code);
    }
    
    /**
     * 执行代码
     * @param {string} code 代码
     */
    async _executeCode(code) {
        this.isRunning = true;
        this._setConsoleState('compiling');
        this._updateStatus(window.t('status.running'));
        
        const startTime = performance.now();
        
        try {
            const result = await window.pyodideManager.runCode(code);
            
            this._setConsoleState('outputting');
            
            const endTime = performance.now();
            
            // 显示输出到控制台
            if (result.stdout) {
                window.consoleManager.write(result.stdout, 'output');
            }
            
            // 显示错误到控制台
            if (result.stderr) {
                window.consoleManager.write(result.stderr, 'error');
            }
            
            // 显示返回值
            if (result.success && result.result !== undefined && result.result !== null) {
                // 不要重复显示print的输出
                if (!result.stdout && String(result.result) !== 'None') {
                    window.consoleManager.write(String(result.result), 'output');
                }
            }
            
            // 显示错误信息
            if (!result.success && result.error) {
                window.consoleManager.write(result.error, 'error');
            }
            
            // 显示执行时间
            window.consoleManager.write(`[${window.t('status.executionTime')}: ${(endTime - startTime).toFixed(2)}${window.t('status.msSuffix')}]`, 'info');
            
            // 更新输出面板（纯净输出）
            this._updateOutputPanel(result.stdout || '');
            
            // 更新问题面板
            this._updateProblemsPanel(result.rawError);
            
            // 更新变量视图
            this._updateVariablesView();
            
        } catch (error) {
            window.consoleManager.write(window.t('toast.execError') + ': ' + error.message, 'error');
            this._updateProblemsPanel(error);
            // 清理输入等待状态，防止控制台永久错乱
            window.pyodideManager.resetInput();
        }
        
        this.isRunning = false;
        this._updateStatus(window.t('status.ready'));
        this._setConsoleState('idle');
    }
    
    /**
     * 运行选中代码
     */
    async runSelection() {
        const selection = window.editorManager.getSelection();
        
        if (!selection) {
            this._showToast(window.t('toast.noSelection'), 'warning');
            return;
        }
        
        if (!this.isReady) {
            this._showToast(window.t('toast.pyodideNotReadyShort'), 'warning');
            return;
        }

        if (this.isRunning) {
            this._showToast(window.t('toast.alreadyRunning'), 'warning');
            return;
        }
        
        this.isRunning = true;
        this._setConsoleState('compiling');

        try {
            const result = await window.pyodideManager.runCode(selection);
            
            this._setConsoleState('outputting');
            
            if (result.stdout) {
                window.consoleManager.write(result.stdout, 'output');
            }
            
            if (result.stderr) {
                window.consoleManager.write(result.stderr, 'error');
            }
            
            if (result.success && result.result !== undefined && result.result !== null) {
                if (!result.stdout) {
                    window.consoleManager.write(String(result.result), 'output');
                }
            }
            
            if (!result.success && result.error) {
                window.consoleManager.write(result.error, 'error');
            }
            
            // 同步输出/问题面板
            this._updateOutputPanel(result.stdout || '');
            this._updateProblemsPanel(result.rawError);
        } catch (error) {
            window.consoleManager.write(window.t('toast.execError') + ': ' + error.message, 'error');
            this._updateProblemsPanel(error);
            window.pyodideManager.resetInput();
        }
        
        this.isRunning = false;
        this._setConsoleState('idle');
    }
    
    /**
     * 停止代码
     */
    stopCode() {
        window.pyodideManager.interrupt();
        this.isRunning = false;
        window.pyodideManager.resetInput();
        this._updateStatus(window.t('status.stopped'));
        this._setConsoleState('idle');
        this._showToast(window.t('toast.stopped'), 'info');
    }
    
    /**
     * 保存文件
     */
    saveFile() {
        window.fileManager.saveFile();
    }
    
    /**
     * 更新光标位置
     */
    updateCursorPosition(line, column) {
        const posEl = document.getElementById('status-position');
        const lineEl = document.getElementById('line-indicator');
        
        if (posEl) posEl.textContent = window.t('status.lineColumn', { line, col: column });
        if (lineEl) lineEl.querySelector('span').textContent = window.t('status.lineColumn', { line, col: column });
    }
    
    /**
     * 更新状态
     */
    _updateStatus(message) {
        const el = document.getElementById('status-message');
        if (el) el.textContent = message;
    }
    
    /**
     * 设置控制台状态圆点指示器
     * @param {string} state - 'idle' | 'compiling' | 'outputting' | 'awaiting-input'
     */
    _setConsoleState(state) {
        const dot = document.getElementById('status-dot');
        const text = document.getElementById('status-dot-text');
        const cancelBtn = document.getElementById('btn-cancel-input');
        if (!dot || !text) return;
        
        // 移除所有状态类
        dot.classList.remove('idle', 'compiling', 'outputting', 'awaiting-input');
        dot.classList.add(state);
        text.textContent = window.t('console.state.' + (
            state === 'awaiting-input' ? 'awaitingInput' : state
        ));
        
        // 显示/隐藏取消输入按钮
        if (cancelBtn) {
            cancelBtn.style.display = state === 'awaiting-input' ? 'inline-flex' : 'none';
        }
    }
    
    /**
     * 更新变量视图
     */
    _updateVariablesView() {
        const container = document.getElementById('variables-list');
        if (!container) return;
        
        const variables = window.pyodideManager.getVariables();
        
        container.innerHTML = '';
        
        if (variables.length === 0) {
            container.innerHTML = '<div style="color: #6E6E6E; padding: 10px;">' + window.t('status.noVariables') + '</div>';
            return;
        }
        
        variables.forEach(v => {
            const item = document.createElement('div');
            item.className = 'variable-item';
            item.style.cssText = 'display: flex; justify-content: space-between; padding: 4px 8px; font-size: 12px;';
            item.innerHTML = `
                <span style="color: #FFD43B;">${this._escapeHtml(v.name)}</span>
                <span style="color: #6E6E6E;">${this._escapeHtml(v.type)}</span>
                <span style="color: #CCCCCC;">${this._escapeHtml(String(v.value))}</span>
            `;
            container.appendChild(item);
        });
    }
    
    /**
     * 显示包安装对话框
     */
    async _showPackageDialog() {
        const packageName = prompt('输入要安装的包名:');
        if (packageName) {
            await this._installPackage(packageName);
        }
    }
    
    /**
     * 安装包
     */
    async _installPackage(packageName) {
        this._showToast(window.t('toast.installing', { package: packageName }), 'info');
        
        const result = await window.pyodideManager.installPackage(packageName);
        
        if (result.success) {
            this._showToast(result.message, 'success');
        } else {
            this._showToast(window.t('toast.installFailed', { error: result.error }), 'error');
        }
    }
    
    /**
     * 显示已安装包
     */
    async _showInstalledPackages() {
        const packages = await window.pyodideManager.getInstalledPackages();
        alert('已安装的包:\n\n' + packages.join('\n'));
    }
    
    /**
     * 加载示例
     */
    _loadExample(name) {
        const examples = {
            hello: `# Hello World
print("Hello, World!")
print("你好，世界！ 🐍")`,
            calculator: `# 简单计算器
a = 10
b = 5

print(f"a = {a}")
print(f"b = {b}")
print(f"a + b = {a + b}")
print(f"a - b = {a - b}")
print(f"a * b = {a * b}")
print(f"a / b = {a / b}")`,
            loop: `# 循环示例
print("for 循环:")
for i in range(5):
    print(f"  i = {i}")

print()
print("while 循环:")
count = 0
while count < 5:
    print(f"  count = {count}")
    count += 1`,
            function: `# 函数示例
def greet(name):
    return f"你好, {name}!"

def factorial(n):
    if n <= 1:
        return 1
    return n * factorial(n - 1)

print(greet("Python"))
print(f"5! = {factorial(5)}")`,
            class: `# 类示例
class Animal:
    def __init__(self, name):
        self.name = name
    
    def speak(self):
        return "..."

class Dog(Animal):
    def speak(self):
        return "汪汪!"

class Cat(Animal):
    def speak(self):
        return "喵喵!"

dog = Dog("小黑")
cat = Cat("小白")

print(f"{dog.name}: {dog.speak()}")
print(f"{cat.name}: {cat.speak()}")`,
            numpy: `# NumPy 示例
# 先安装numpy: 点击 包 -> 安装 NumPy

import numpy as np

arr = np.array([1, 2, 3, 4, 5])
print("数组:", arr)
print("平均值:", np.mean(arr))
print("总和:", np.sum(arr))`,
            matplotlib: `# Matplotlib 示例
# 需要先安装matplotlib

print("Matplotlib可以创建图表")
print("在浏览器环境中，图表会显示为图片")

# 简单示例
x = [1, 2, 3, 4, 5]
y = [1, 4, 9, 16, 25]

print("x:", x)
print("y:", y)
print("y = x^2")`
        };
        
        const code = examples[name];
        if (code) {
            window.editorManager.setValue(code);
            this._updateOutline();
            this._showToast(window.t('toast.exampleLoaded', { name: name }), 'success');
        }
    }
    
    /**
     * 加载代码片段
     */
    _loadSnippets() {
        const container = document.getElementById('snippets-list');
        if (!container) return;
        
        const snippets = [
            { name: 'print', code: 'print("Hello")' },
            { name: 'for循环', code: 'for i in range(10):\n    print(i)' },
            { name: 'if判断', code: 'if True:\n    pass' },
            { name: '函数定义', code: 'def func():\n    pass' },
            { name: '类定义', code: 'class MyClass:\n    pass' }
        ];
        
        container.innerHTML = '';
        
        snippets.forEach(s => {
            const item = document.createElement('div');
            item.className = 'snippet-item';
            item.textContent = s.name;
            item.style.cssText = 'padding: 6px 10px; cursor: pointer; font-size: 12px;';
            item.addEventListener('click', () => {
                window.editorManager.insertText(s.code);
            });
            item.addEventListener('mouseenter', () => {
                item.style.background = '#3C3C3C';
            });
            item.addEventListener('mouseleave', () => {
                item.style.background = '';
            });
            container.appendChild(item);
        });
    }
    
    /**
     * 显示快捷键
     */
    _showShortcuts() {
        alert(`快捷键列表:

F5 - 运行代码
Shift+F5 - 运行选中代码
Ctrl+S - 保存文件
Ctrl+O - 打开文件
Ctrl+N - 新建文件`);
    }
    
    /**
     * 显示关于
     */
    _showAbout() {
        alert(`蟒蛇 Python在线编译器

版本: ${this.version}

基于Pyodide的浏览器Python编程环境。`);
    }
    
    /**
     * 显示Toast通知
     */
    _showToast(message, type = 'info') {
        const container = document.getElementById('toast-container');
        if (!container) return;
        
        const toast = document.createElement('div');
        toast.className = `toast toast-${type}`;
        
        const icons = {
            success: 'check-circle',
            error: 'times-circle',
            warning: 'exclamation-triangle',
            info: 'info-circle'
        };
        
        toast.innerHTML = `
            <i class="fas fa-${icons[type]}"></i>
            <span>${message}</span>
        `;
        
        container.appendChild(toast);
        
        setTimeout(() => {
            toast.style.opacity = '0';
            setTimeout(() => toast.remove(), 300);
        }, 3000);
    }
}

// 创建全局实例并初始化
document.addEventListener('DOMContentLoaded', () => {
    window.app = new PythonIDE();
    window.app.init();
});

console.log('🚀 主应用加载完成');