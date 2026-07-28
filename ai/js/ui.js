/* ============================================================
   KOBG AI - ui.js - UI 操作模块
   负责 DOM 操作、界面更新、Toast 通知等
   ============================================================ */

const KOBGUI = (() => {
    /**
     * 获取 DOM 元素
     */
    function $(selector) {
        return document.querySelector(selector);
    }

    function $$(selector) {
        return document.querySelectorAll(selector);
    }

    /**
     * Toast 通知
     */
    function showToast(message, type = 'info', duration = 3000) {
        const container = $('#toast-container') || createToastContainer();
        
        const icons = { success: '✓', error: '✗', warning: '⚠', info: 'ℹ' };
        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        toast.innerHTML = `<span class="toast-icon">${icons[type] || icons.info}</span> ${message}`;
        container.appendChild(toast);

        setTimeout(() => {
            toast.style.opacity = '0';
            toast.style.transform = 'translateX(100%)';
            toast.style.transition = '0.3s ease';
            setTimeout(() => toast.remove(), 300);
        }, duration);
    }

    function createToastContainer() {
        const container = document.createElement('div');
        container.id = 'toast-container';
        container.className = 'toast-container';
        document.body.appendChild(container);
        return container;
    }

    /**
     * 更新状态指示器
     */
    function updateStatus(status) {
        const dot = $('#status-dot');
        const text = $('#status-text');
        if (!dot || !text) return;

        dot.className = 'status-dot';
        switch (status) {
            case 'connected':
                dot.classList.add('connected');
                text.textContent = '已连接';
                break;
            case 'training':
                dot.classList.add('training');
                text.textContent = '训练中';
                break;
            case 'error':
                dot.classList.add('error');
                text.textContent = '错误';
                break;
            case 'paused':
                dot.classList.add('warning');
                text.textContent = '已暂停';
                break;
            default:
                text.textContent = '未连接';
        }
    }

    /**
     * 更新 Token 显示
     */
    function updateTokenDisplay() {
        const usage = KOBGStorage.getTokenUsage();
        const totalEl = $('#token-total');
        const inputEl = $('#token-input');
        const outputEl = $('#token-output');
        const callsEl = $('#token-calls');

        if (totalEl) totalEl.textContent = formatNumber(usage.totalTokens);
        if (inputEl) inputEl.textContent = formatNumber(usage.totalInputTokens);
        if (outputEl) outputEl.textContent = formatNumber(usage.totalOutputTokens);
        if (callsEl) callsEl.textContent = usage.callCount;
    }

    function formatNumber(num) {
        if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
        if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
        return num.toString();
    }

    /**
     * 更新训练进度
     */
    function updateProgress(progress) {
        const bar = $('#progress-bar');
        const text = $('#progress-text');
        if (bar) bar.style.width = (progress * 100) + '%';
        if (text) text.textContent = Math.round(progress * 100) + '%';
    }

    /**
     * 更新训练计时器
     */
    function updateTimer(elapsedSeconds) {
        const el = $('#training-time');
        if (el) {
            el.textContent = formatTime(elapsedSeconds);
        }
    }

    function formatTime(seconds) {
        const h = Math.floor(seconds / 3600);
        const m = Math.floor((seconds % 3600) / 60);
        const s = seconds % 60;
        if (h > 0) return `${h}:${pad(m)}:${pad(s)}`;
        return `${pad(m)}:${pad(s)}`;
    }

    function pad(n) {
        return n.toString().padStart(2, '0');
    }

    /**
     * 更新训练时长滑块
     */
    function updateDurationSlider() {
        const slider = $('#duration-slider');
        const display = $('#duration-display');
        if (slider && display) {
            display.textContent = slider.value + ' 分钟';
        }
    }

    /**
     * 获取选择的训练时长（秒）
     */
    function getTrainingDuration() {
        const slider = $('#duration-slider');
        return slider ? parseInt(slider.value) * 60 : 300;
    }

    /**
     * 获取训练模式 ('time' | 'rounds')
     */
    function getTrainingMode() {
        const selected = $('input[name="training-mode"]:checked');
        return selected ? selected.value : 'time';
    }

    /**
     * 获取自定义训练轮数
     */
    function getCustomRounds() {
        const input = $('#custom-rounds');
        if (!input) return 10;
        const val = parseInt(input.value);
        return (val >= 1 && val <= 100) ? val : 10;
    }

    /**
     * 切换训练模式显示
     */
    function switchTrainingMode(mode) {
        const timeMode = $('#time-mode');
        const roundsMode = $('#rounds-mode');
        const roundsByTime = $('#rounds-by-time');

        if (mode === 'rounds') {
            if (timeMode) timeMode.style.display = 'none';
            if (roundsMode) roundsMode.style.display = 'block';
            if (roundsByTime) roundsByTime.style.display = 'none';
        } else {
            if (timeMode) timeMode.style.display = 'block';
            if (roundsMode) roundsMode.style.display = 'none';
            if (roundsByTime) roundsByTime.style.display = 'block';
        }
    }

    /**
     * 更新预计训练轮数显示
     */
    function updateEstimatedRounds() {
        const slider = $('#duration-slider');
        const roundsEl = $('#estimated-rounds');
        if (slider && roundsEl) {
            const minutes = parseInt(slider.value);
            const rounds = Math.max(1, Math.ceil((minutes * 60) / 30));
            roundsEl.textContent = rounds;
        }
    }

    /**
     * 显示代码
     */
    function displayCode(code) {
        const codeEl = $('#code-content');
        if (!codeEl) return;

        if (code) {
            // 使用 highlight.js 进行语法高亮
            if (typeof hljs !== 'undefined') {
                codeEl.innerHTML = hljs.highlight(code, { language: 'cpp' }).value;
            } else {
                codeEl.textContent = code;
            }
            // 启用导出按钮
            const exportBtn = $('#btn-export');
            if (exportBtn) exportBtn.disabled = false;
        } else {
            // 显示默认框架模板
            showDefaultTemplate();
        }
    }

    /**
     * 显示默认框架模板
     */
    function showDefaultTemplate() {
        const codeEl = $('#code-content');
        if (!codeEl) return;
        codeEl.textContent = '// 请在左侧配置 API 并开始训练，AI 将生成 C++ 代码...';
        codeEl.style.color = 'var(--text-muted)';
    }

    /**
     * 显示编译输出
     */
    function displayOutput(output) {
        const outputEl = $('#output-body');
        if (!outputEl) return;
        outputEl.textContent = output || '暂无输出';
    }

    /**
     * 追加编译输出
     */
    function appendOutput(text, type = '') {
        const outputEl = $('#output-body');
        if (!outputEl) return;
        const span = document.createElement('span');
        span.textContent = text;
        if (type) span.className = type + '-line';
        outputEl.appendChild(span);
        outputEl.scrollTop = outputEl.scrollHeight;
    }

    /**
     * 清除输出
     */
    function clearOutput() {
        const outputEl = $('#output-body');
        if (outputEl) outputEl.textContent = '';
    }

    /**
     * 添加训练日志
     */
    function addLogEntry(type, message) {
        const logContainer = $('#training-log');
        if (!logContainer) return;

        const icons = { success: '✓', error: '✗', info: 'ℹ', warning: '⚠' };
        const entry = document.createElement('div');
        entry.className = `log-entry ${type}`;
        entry.innerHTML = `
            <span class="log-icon">${icons[type] || icons.info}</span>
            <div class="log-content">
                <div class="log-time">${new Date().toLocaleTimeString()}</div>
                <div class="log-msg">${message}</div>
            </div>
        `;
        logContainer.appendChild(entry);
        logContainer.scrollTop = logContainer.scrollHeight;
    }

    /**
     * 清除训练日志
     */
    function clearLog() {
        const logContainer = $('#training-log');
        if (logContainer) logContainer.innerHTML = '';
    }

    /**
     * 流式输出面板 - 开始流式显示
     */
    function streamStart() {
        const content = $('#stream-content');
        const dot = $('#stream-dot');
        const label = $('#stream-label');
        const chars = $('#stream-chars');
        const lines = $('#stream-lines');

        if (content) content.innerHTML = '';
        if (dot) { dot.className = 'stream-dot streaming'; }
        if (label) label.textContent = 'AI 正在生成...';
        if (chars) chars.textContent = '0';
        if (lines) lines.textContent = '0';
    }

    /**
     * 流式输出面板 - 追加文本块
     */
    function streamAppend(text) {
        const content = $('#stream-content');
        const chars = $('#stream-chars');
        const lines = $('#stream-lines');

        if (content) {
            content.append(text);
            content.scrollTop = content.scrollHeight;
        }
        if (chars) {
            const current = parseInt(chars.textContent) || 0;
            chars.textContent = current + text.length;
        }
        if (lines) {
            const lineCount = (text.match(/\n/g) || []).length;
            const current = parseInt(lines.textContent) || 0;
            lines.textContent = current + lineCount;
        }
    }

    /**
     * 流式输出面板 - 结束
     */
    function streamEnd() {
        const dot = $('#stream-dot');
        const label = $('#stream-label');

        if (dot) { dot.className = 'stream-dot'; }
        if (label) label.textContent = '生成完成';
    }

    /**
     * 流式输出面板 - 错误
     */
    function streamError(message) {
        const dot = $('#stream-dot');
        const label = $('#stream-label');

        if (dot) { dot.className = 'stream-dot error'; }
        if (label) label.textContent = '错误: ' + message;
    }

    /**
     * 流式输出面板 - 重置
     */
    function streamReset() {
        const content = $('#stream-content');
        const dot = $('#stream-dot');
        const label = $('#stream-label');
        const chars = $('#stream-chars');
        const lines = $('#stream-lines');

        if (content) content.innerHTML = '<span class="stream-placeholder">AI 生成内容将在此逐字显示...</span>';
        if (dot) { dot.className = 'stream-dot'; }
        if (label) label.textContent = '等待训练';
        if (chars) chars.textContent = '0';
        if (lines) lines.textContent = '0';
    }

    /**
     * 切换标签页
     */
    function switchTab(tabName) {
        $$('.content-tab').forEach(tab => tab.classList.remove('active'));
        $$('.content-tab-panel').forEach(panel => panel.classList.remove('active'));

        const tab = $(`.content-tab[data-tab="${tabName}"]`);
        const panel = $(`#tab-${tabName}`);

        if (tab) tab.classList.add('active');
        if (panel) panel.classList.add('active');
    }

    /**
     * 设置按钮加载状态
     */
    function setButtonLoading(btn, loading) {
        if (!btn) return;
        if (loading) {
            btn.disabled = true;
            btn.dataset.originalText = btn.textContent;
            btn.textContent = '处理中...';
        } else {
            btn.disabled = false;
            btn.textContent = btn.dataset.originalText || btn.textContent;
        }
    }

    /**
     * 切换面板折叠
     */
    function togglePanel(panelId) {
        const panel = $(`#${panelId}`);
        if (panel) panel.classList.toggle('collapsed');
    }

    /**
     * 填充 API 配置表单
     */
    function populateApiForm() {
        const config = KOBGStorage.getApiConfig();
        const urlEl = $('#api-url');
        const keyEl = $('#api-key');
        const modelEl = $('#api-model');

        if (urlEl) urlEl.value = config.url || '';
        if (keyEl) keyEl.value = config.apiKey || '';
        if (modelEl) modelEl.value = config.model || '';
    }

    /**
     * 获取 API 配置表单数据
     */
    function getApiFormData() {
        return {
            url: $('#api-url')?.value?.trim() || '',
            apiKey: $('#api-key')?.value?.trim() || '',
            model: $('#api-model')?.value?.trim() || ''
        };
    }

    /**
     * 验证 API 配置表单
     */
    function validateApiForm() {
        const data = getApiFormData();
        const errors = [];

        if (!data.url) {
            errors.push('API URL 不能为空');
            $('#api-url')?.classList.add('is-invalid');
        } else {
            $('#api-url')?.classList.remove('is-invalid');
        }

        if (!data.apiKey) {
            errors.push('API Key 不能为空');
            $('#api-key')?.classList.add('is-invalid');
        } else {
            $('#api-key')?.classList.remove('is-invalid');
        }

        if (!data.model) {
            errors.push('模型名称不能为空');
            $('#api-model')?.classList.add('is-invalid');
        } else {
            $('#api-model')?.classList.remove('is-invalid');
        }

        return { valid: errors.length === 0, errors };
    }

    /**
     * 填充框架模板代码
     */
    async function loadFrameworkTemplate() {
        try {
            const response = await fetch('templates/framework.cpp');
            if (response.ok) {
                const code = await response.text();
                return code;
            }
        } catch (e) {
            console.warn('[UI] Failed to load framework template:', e);
        }
        return null;
    }

    /**
     * 确认对话框
     */
    function confirm(message) {
        return new Promise(resolve => {
            if (window.confirm(message)) {
                resolve(true);
            } else {
                resolve(false);
            }
        });
    }

    return {
        $,
        $$,
        showToast,
        updateStatus,
        updateTokenDisplay,
        updateProgress,
        updateTimer,
        updateDurationSlider,
        getTrainingDuration,
        getTrainingMode,
        getCustomRounds,
        switchTrainingMode,
        updateEstimatedRounds,
        displayCode,
        displayOutput,
        appendOutput,
        clearOutput,
        addLogEntry,
        clearLog,
        streamStart,
        streamAppend,
        streamEnd,
        streamError,
        streamReset,
        switchTab,
        setButtonLoading,
        togglePanel,
        populateApiForm,
        getApiFormData,
        validateApiForm,
        loadFrameworkTemplate,
        confirm
    };
})();