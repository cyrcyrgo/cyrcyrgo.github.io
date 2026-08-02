/**
 * Py Pro - 控制台管理器
 * 支持内联输入（模拟原生 Python 终端 input() 体验）
 */

class ConsoleManager {
    constructor() {
        this.outputElement = null;
        this.inputElement = null;
        this.history = [];
        this.historyIndex = -1;
        this.maxHistory = 100;
        this.filter = 'all';
        
        // 内联输入（模拟原生 Python input() 体验）
        this._inlineInput = null;
        this._isInlineActive = false;
    }
    
    /**
     * 初始化控制台
     */
    init(outputId, inputId) {
        this.outputElement = document.getElementById(outputId);
        this.inputElement = document.getElementById(inputId);
        
        if (this.inputElement) {
            this._bindInputEvents();
        }
        
        if (this.outputElement) {
            this._bindOutputClick();
        }
        
        console.log('控制台初始化完成');
    }
    
    /* ============================================
       内联输入 — 模拟原生 Python input() 体验
       ============================================ */
    
    /**
     * 激活内联输入模式
     * 在输出区域底部创建一个可编辑的输入行，用户点击输出区域即可输入
     */
    activateInlineInput() {
        if (this._isInlineActive) return;
        
        this._isInlineActive = true;
        
        // 创建内联输入行
        const line = document.createElement('div');
        line.className = 'console-inline-input';
        line.id = 'console-inline-input';
        
        // 闪烁光标
        const cursor = document.createElement('span');
        cursor.className = 'inline-cursor';
        cursor.textContent = '|';
        line.appendChild(cursor);
        
        // 隐藏的 input 用于捕获键盘输入（移动端兼容）
        const hiddenInput = document.createElement('input');
        hiddenInput.type = 'text';
        hiddenInput.className = 'inline-hidden-input';
        hiddenInput.id = 'console-inline-hidden';
        hiddenInput.autocomplete = 'off';
        hiddenInput.autocapitalize = 'off';
        hiddenInput.spellcheck = false;
        line.appendChild(hiddenInput);
        
        this.outputElement.appendChild(line);
        this._scrollToBottom();
        
        this._inlineInput = hiddenInput;
        
        // 绑定事件
        this._bindInlineInputEvents();
        
        // 立即聚焦（移动端会弹出键盘）
        requestAnimationFrame(() => {
            hiddenInput.focus();
        });
    }
    
    /**
     * 绑定内联输入事件
     */
    _bindInlineInputEvents() {
        const inp = this._inlineInput;
        if (!inp) return;
        
        // 用 input 事件实时更新显示文本
        inp.addEventListener('input', () => {
            this._updateInlineDisplay();
        });
        
        // 键盘事件
        inp.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                this._submitInlineInput();
            } else if (e.key === 'Escape') {
                e.preventDefault();
                this._cancelInlineInput();
            }
        });
        
        // 防止失焦时光标消失（在移动端点击输出区域时重新聚焦）
        inp.addEventListener('blur', () => {
            if (this._isInlineActive) {
                // 延迟重新聚焦，让点击事件先处理
                setTimeout(() => {
                    if (this._isInlineActive && this._inlineInput) {
                        this._inlineInput.focus();
                    }
                }, 100);
            }
        });
    }
    
    /**
     * 更新内联显示文本（显示用户已输入的内容 + 闪烁光标）
     */
    _updateInlineDisplay() {
        const line = document.getElementById('console-inline-input');
        const inp = this._inlineInput;
        if (!line || !inp) return;
        
        const cursor = line.querySelector('.inline-cursor');
        const text = inp.value;
        
        // 移除旧文本节点（保留光标和隐藏 input）
        while (line.firstChild) {
            if (line.firstChild === cursor || line.firstChild === inp) {
                line.firstChild.remove();
            } else {
                line.removeChild(line.firstChild);
            }
        }
        
        // 插入文本
        if (text) {
            const span = document.createElement('span');
            span.className = 'inline-text';
            span.textContent = text;
            line.insertBefore(span, cursor);
        }
        
        // 重新添加光标和 input
        if (!line.contains(cursor)) line.appendChild(cursor);
        if (!line.contains(inp)) line.appendChild(inp);
    }
    
    /**
     * 提交内联输入
     */
    _submitInlineInput() {
        const inp = this._inlineInput;
        if (!inp) return;
        
        const value = inp.value;
        
        // 显示用户输入（使其成为输出的一部分）
        this._finalizeInlineDisplay(value);
        
        // 清理内联输入
        this._deactivateInlineInput();
        
        // 提交到 Pyodide
        if (window.pyodideManager && window.pyodideManager.isWaitingInput()) {
            window.pyodideManager.resolveUserInput(value);
        }
    }
    
    /**
     * 取消内联输入（ESC）
     */
    _cancelInlineInput() {
        this._deactivateInlineInput();
        
        if (window.pyodideManager && window.pyodideManager.isWaitingInput()) {
            window.pyodideManager.cancelInput();
        }
    }
    
    /**
     * 将内联输入转为最终显示文本
     */
    _finalizeInlineDisplay(value) {
        const line = document.getElementById('console-inline-input');
        if (line) {
            // 替换为普通输出行
            const displayLine = document.createElement('div');
            displayLine.className = 'console-line';
            displayLine.innerHTML = `<span class="code" style="color: #D4D4D4;">${this._escapeHtml(value)}</span>`;
            line.replaceWith(displayLine);
        }
    }
    
    /**
     * 停用内联输入模式
     */
    _deactivateInlineInput() {
        this._isInlineActive = false;
        this._inlineInput = null;
        
        // 清理剩余的内联输入元素
        const line = document.getElementById('console-inline-input');
        if (line) {
            line.remove();
        }
    }
    
    /**
     * 强制停用内联输入（外部调用，如重置/停止时）
     */
    deactivateInlineInput() {
        if (this._isInlineActive) {
            this._deactivateInlineInput();
        }
    }
    
    /* ============================================
       输出区域点击
       ============================================ */
    
    /**
     * 绑定输出区域点击 → 聚焦输入
     */
    _bindOutputClick() {
        this.outputElement.addEventListener('click', (e) => {
            // 如果内联输入激活中，聚焦隐藏 input
            if (this._isInlineActive && this._inlineInput) {
                this._inlineInput.focus();
                return;
            }
            
            // 如果 Pyodide 正在等待输入，激活内联输入
            if (window.pyodideManager && window.pyodideManager.isWaitingInput()) {
                if (this._inlineInput) {
                    this._inlineInput.focus();
                }
                return;
            }
            
            // 默认：聚焦底部输入框
            if (this.inputElement) {
                this.inputElement.focus();
            }
        });
    }
    
    /* ============================================
       底部输入框
       ============================================ */
    
    /**
     * 绑定输入事件
     */
    _bindInputEvents() {
        this.inputElement.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                this.executeInput();
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                this.navigateHistory(-1);
            } else if (e.key === 'ArrowDown') {
                e.preventDefault();
                this.navigateHistory(1);
            } else if (e.key === 'Escape') {
                if (window.pyodideManager && window.pyodideManager.isWaitingInput()) {
                    e.preventDefault();
                    this.inputElement.value = '';
                    window.pyodideManager.cancelInput();
                }
            }
        });
        
        document.getElementById('btn-console-enter')?.addEventListener('click', () => {
            this.executeInput();
        });
    }
    
    /**
     * 执行输入
     */
    async executeInput() {
        const code = this.inputElement.value.trim();
        
        if (!code) return;
        
        // 如果正在等待 input()，路由到内联输入
        if (window.pyodideManager && window.pyodideManager.isWaitingInput()) {
            // 显示用户输入
            const line = document.createElement('div');
            line.className = 'console-line';
            line.innerHTML = `<span class="code" style="color: #D4D4D4;">${this._escapeHtml(code)}</span>`;
            this.outputElement.appendChild(line);
            this._scrollToBottom();
            
            this.inputElement.value = '';
            window.pyodideManager.resolveUserInput(code);
            return;
        }
        
        // 正常执行 Python 代码
        this.addToHistory(code);
        this.writeInput(code);
        this.inputElement.value = '';
        
        if (window.pyodideManager && window.pyodideManager.isReady) {
            const result = await window.pyodideManager.runCode(code);
            
            if (result.stdout) {
                this.write(result.stdout, 'output');
            }
            
            if (result.success && result.result !== undefined && result.result !== null) {
                if (!result.stdout && String(result.result) !== 'None') {
                    this.write(String(result.result), 'output');
                }
            } else if (!result.success) {
                this.write(result.error || 'Error', 'error');
            }
        } else {
            this.write('Python runtime not initialized', 'error');
        }
    }
    
    /* ============================================
       历史记录
       ============================================ */
    
    addToHistory(code) {
        this.history.push(code);
        if (this.history.length > this.maxHistory) {
            this.history.shift();
        }
        this.historyIndex = this.history.length;
    }
    
    navigateHistory(direction) {
        this.historyIndex += direction;
        if (this.historyIndex < 0) {
            this.historyIndex = 0;
        } else if (this.historyIndex >= this.history.length) {
            this.historyIndex = this.history.length;
            this.inputElement.value = '';
            return;
        }
        this.inputElement.value = this.history[this.historyIndex];
    }
    
    /* ============================================
       输出写入
       ============================================ */
    
    writeInput(code) {
        const line = document.createElement('div');
        line.className = 'console-line';
        line.innerHTML = `
            <span class="prompt" style="color: #FFD43B;">&gt;&gt;&gt;</span>
            <span class="code" style="color: #D4D4D4;">${this._escapeHtml(code)}</span>
        `;
        this.outputElement.appendChild(line);
        this._scrollToBottom();
    }
    
    write(text, type = 'output') {
        if (!this.outputElement) return;
        if (!text) return;
        if (!this._shouldShow(type)) return;
        
        const lines = String(text).split('\n');
        
        lines.forEach(line => {
            const div = document.createElement('div');
            div.className = `console-line ${type}`;
            div.dataset.type = type;
            
            if (type === 'error') {
                div.style.color = '#F14C4C';
                div.innerHTML = `<i class="fas fa-times-circle" style="margin-right: 5px;"></i>${this._escapeHtml(line)}`;
            } else if (type === 'warning') {
                div.style.color = '#CCA700';
                div.innerHTML = `<i class="fas fa-exclamation-triangle" style="margin-right: 5px;"></i>${this._escapeHtml(line)}`;
            } else if (type === 'info') {
                div.style.color = '#3794FF';
                div.innerHTML = `<i class="fas fa-info-circle" style="margin-right: 5px;"></i>${this._escapeHtml(line)}`;
            } else {
                div.style.color = '#D4D4D4';
                div.textContent = line;
            }
            
            this.outputElement.appendChild(div);
        });
        
        this._scrollToBottom();
    }
    
    _shouldShow(type) {
        if (this.filter === 'all') return true;
        return this.filter === type;
    }
    
    setFilter(filter) {
        this.filter = filter;
        const lines = this.outputElement.querySelectorAll('.console-line');
        lines.forEach(line => {
            const lineType = line.dataset.type;
            line.style.display = (filter === 'all' || lineType === filter) ? '' : 'none';
        });
    }
    
    clear() {
        if (this.outputElement) {
            this.outputElement.innerHTML = '';
        }
    }
    
    export() {
        const lines = [];
        this.outputElement.querySelectorAll('.console-line').forEach(line => {
            lines.push(line.textContent);
        });
        return lines.join('\n');
    }
    
    setPythonVersion(version) {
        const element = document.getElementById('python-version');
        if (element) {
            element.textContent = `Python ${version}`;
        }
    }
    
    _scrollToBottom() {
        if (this.outputElement) {
            this.outputElement.scrollTop = this.outputElement.scrollHeight;
        }
    }
    
    _escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
}

// 创建全局实例
window.consoleManager = new ConsoleManager();
console.log('控制台管理器加载完成');