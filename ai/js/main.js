/* ============================================================
   KOBG AI - main.js - 应用初始化和编排
   负责事件绑定、流程控制和模块协调
   ============================================================ */

(function () {
    'use strict';

    const UI = KOBGUI;
    const API = KOBGAPI;
    const Compiler = KOBGCompiler;
    const Training = KOBGTraining;
    const Storage = KOBGStorage;

    // ========== 初始化 ==========
    function init() {
        console.log('[KOBG AI] 初始化...');
        
        // 加载 API 配置
        UI.populateApiForm();
        
        // 更新 Token 显示
        UI.updateTokenDisplay();
        
        // 更新时长滑块
        UI.updateDurationSlider();
        
        // 加载框架模板
        loadDefaultTemplate();
        
        // 绑定事件
        bindEvents();
        
        // 检查 API 状态
        checkApiStatus();
        
        console.log('[KOBG AI] 初始化完成');
    }

    /**
     * 加载默认框架模板
     */
    async function loadDefaultTemplate() {
        const template = await UI.loadFrameworkTemplate();
        if (template) {
            UI.displayCode(template);
        } else {
            UI.showDefaultTemplate();
        }
    }

    /**
     * 检查 API 配置状态
     */
    function checkApiStatus() {
        if (API.isConfigured()) {
            UI.updateStatus('connected');
        } else {
            UI.updateStatus('disconnected');
        }
    }

    // ========== 事件绑定 ==========
    function bindEvents() {
        // 保存 API 配置
        const saveConfigBtn = UI.$('#btn-save-config');
        if (saveConfigBtn) {
            saveConfigBtn.addEventListener('click', handleSaveConfig);
        }

        // 测试连接
        const testConnectionBtn = UI.$('#btn-test-connection');
        if (testConnectionBtn) {
            testConnectionBtn.addEventListener('click', handleTestConnection);
        }

        // 开始训练
        const startTrainingBtn = UI.$('#btn-start-training');
        if (startTrainingBtn) {
            startTrainingBtn.addEventListener('click', handleStartTraining);
        }

        // 暂停训练
        const pauseTrainingBtn = UI.$('#btn-pause-training');
        if (pauseTrainingBtn) {
            pauseTrainingBtn.addEventListener('click', handlePauseTraining);
        }

        // 停止训练
        const stopTrainingBtn = UI.$('#btn-stop-training');
        if (stopTrainingBtn) {
            stopTrainingBtn.addEventListener('click', handleStopTraining);
        }

        // 清除上下文
        const clearContextBtn = UI.$('#btn-clear-context');
        if (clearContextBtn) {
            clearContextBtn.addEventListener('click', handleClearContext);
        }

        // 重置 Token
        const resetTokenBtn = UI.$('#btn-reset-token');
        if (resetTokenBtn) {
            resetTokenBtn.addEventListener('click', handleResetToken);
        }

        // 手动编译
        const compileBtn = UI.$('#btn-compile');
        if (compileBtn) {
            compileBtn.addEventListener('click', handleManualCompile);
        }

        // 训练时长滑块
        const durationSlider = UI.$('#duration-slider');
        if (durationSlider) {
            durationSlider.addEventListener('input', () => {
                UI.updateDurationSlider();
                const minutes = parseInt(durationSlider.value);
                const rounds = Math.max(1, Math.ceil((minutes * 60) / 30));
                const roundsEl = UI.$('#estimated-rounds');
                if (roundsEl) roundsEl.textContent = rounds;
            });
        }

        // 面板折叠
        UI.$$('.panel-header').forEach(header => {
            header.addEventListener('click', () => {
                const panel = header.closest('.panel');
                if (panel) panel.classList.toggle('collapsed');
            });
        });

        // 标签切换
        UI.$$('.content-tab').forEach(tab => {
            tab.addEventListener('click', () => {
                UI.switchTab(tab.dataset.tab);
            });
        });

        // 单次生成按钮
        const singleGenBtn = UI.$('#btn-single-generate');
        if (singleGenBtn) {
            singleGenBtn.addEventListener('click', handleSingleGenerate);
        }
    }

    // ========== 事件处理 ==========

    async function handleSaveConfig() {
        const validation = UI.validateApiForm();
        if (!validation.valid) {
            UI.showToast(validation.errors[0], 'error');
            return;
        }

        const config = UI.getApiFormData();
        Storage.saveApiConfig(config);
        UI.showToast('API 配置已保存', 'success');
        checkApiStatus();
    }

    async function handleTestConnection() {
        const btn = UI.$('#btn-test-connection');
        UI.setButtonLoading(btn, true);

        try {
            const result = await API.testConnection();
            UI.showToast('连接成功: ' + result, 'success');
            UI.updateStatus('connected');
        } catch (error) {
            UI.showToast('连接失败: ' + error.message, 'error');
            UI.updateStatus('error');
        } finally {
            UI.setButtonLoading(btn, false);
        }
    }

    async function handleStartTraining() {
        // 验证 API 配置
        if (!API.isConfigured()) {
            UI.showToast('请先配置 API 接口信息', 'error');
            UI.switchTab('code');
            return;
        }

        if (Training.isRunning()) {
            UI.showToast('训练已在运行中', 'warning');
            return;
        }

        const durationSeconds = UI.getTrainingDuration();
        
        // 更新 UI 状态
        UI.updateStatus('training');
        UI.clearOutput();
        UI.clearLog();
        UI.updateProgress(0);
        updateDetailStatus('训练中');
        updateDetailRound(0, Math.ceil(durationSeconds / 30));
        updateDetailCompile('-');
        
        const startBtn = UI.$('#btn-start-training');
        const pauseBtn = UI.$('#btn-pause-training');
        const stopBtn = UI.$('#btn-stop-training');
        
        if (startBtn) startBtn.disabled = true;
        if (pauseBtn) pauseBtn.disabled = false;
        if (stopBtn) stopBtn.disabled = false;

        UI.addLogEntry('info', `训练开始，总时长: ${Math.ceil(durationSeconds / 60)} 分钟`);

        try {
            await Training.startTraining(
                durationSeconds,
                // onProgress
                (progress, round, total) => {
                    UI.updateProgress(progress);
                    UI.addLogEntry('info', `第 ${round}/${total} 轮训练中...`);
                    updateDetailRound(round, total);
                },
                // onComplete
                () => {
                    UI.updateProgress(1);
                    UI.updateStatus('connected');
                    UI.showToast('训练完成！', 'success');
                    UI.addLogEntry('success', '训练已完成');
                    updateDetailStatus('完成');
                    updateDetailCompile('成功');
                    
                    // 显示生成的代码
                    const code = Training.getGeneratedCode();
                    if (code) {
                        UI.displayCode(code);
                    }
                    
                    // 显示最新的编译结果
                    const results = Training.getCompileResults();
                    if (results.length > 0) {
                        const last = results[results.length - 1];
                        UI.displayOutput(last.output);
                        UI.switchTab('output');
                    }
                    
                    // 更新 Token 显示
                    UI.updateTokenDisplay();
                    
                    resetButtons();
                },
                // onError
                (error) => {
                    UI.updateStatus('error');
                    UI.showToast('训练出错: ' + error.message, 'error');
                    UI.addLogEntry('error', '训练出错: ' + error.message);
                    updateDetailStatus('错误');
                    updateDetailCompile('失败');
                    resetButtons();
                },
                // onTick
                (elapsed) => {
                    UI.updateTimer(elapsed);
                }
            );
        } catch (error) {
            UI.showToast('启动训练失败: ' + error.message, 'error');
            resetButtons();
        }
    }

    function handlePauseTraining() {
        const btn = UI.$('#btn-pause-training');
        if (Training.isRunning() && !Training.getState().isPaused) {
            Training.pauseTraining();
            UI.updateStatus('paused');
            btn.textContent = '▶ 继续训练';
            UI.addLogEntry('warning', '训练已暂停');
        } else {
            Training.resumeTraining();
            UI.updateStatus('training');
            btn.textContent = '⏸ 暂停训练';
            UI.addLogEntry('info', '训练已恢复');
        }
    }

    function handleStopTraining() {
        if (Training.isRunning()) {
            Training.stopTraining();
            UI.updateStatus('connected');
            UI.showToast('训练已停止', 'warning');
            UI.addLogEntry('warning', '训练已手动停止');
            resetButtons();
        }
    }

    function handleClearContext() {
        UI.confirm('确定要清除所有上下文数据吗？这将重置训练进度但保留 API 配置。').then(confirmed => {
            if (confirmed) {
                Training.clearContext();
                Storage.resetTokenUsage();
                UI.updateTokenDisplay();
                UI.clearOutput();
                UI.clearLog();
                loadDefaultTemplate();
                UI.showToast('上下文已清除', 'success');
                UI.addLogEntry('info', '上下文已清除');
            }
        });
    }

    function handleResetToken() {
        UI.confirm('确定要重置 Token 统计吗？').then(confirmed => {
            if (confirmed) {
                Storage.resetTokenUsage();
                UI.updateTokenDisplay();
                UI.showToast('Token 统计已重置', 'success');
            }
        });
    }

    async function handleManualCompile() {
        const code = Training.getGeneratedCode();
        if (!code) {
            UI.showToast('暂无代码可编译，请先进行训练', 'warning');
            return;
        }

        UI.clearOutput();
        UI.appendOutput('正在编译...\n', 'info-line');
        
        try {
            const result = await Compiler.compile(code);
            if (result.success) {
                UI.appendOutput('编译成功!\n\n', 'success-line');
                UI.displayOutput(result.output);
                UI.showToast('编译成功', 'success');
            } else {
                UI.appendOutput('编译失败:\n', 'error-line');
                for (const err of result.errors) {
                    UI.appendOutput('  - ' + err + '\n', 'error-line');
                }
                UI.showToast('编译失败', 'error');
            }
            UI.switchTab('output');
        } catch (error) {
            UI.appendOutput('编译异常: ' + error.message + '\n', 'error-line');
            UI.showToast('编译异常', 'error');
        }
    }

    async function handleSingleGenerate() {
        if (!API.isConfigured()) {
            UI.showToast('请先配置 API 接口信息', 'error');
            return;
        }

        const btn = UI.$('#btn-single-generate');
        UI.setButtonLoading(btn, true);
        UI.addLogEntry('info', '单次生成中...');

        try {
            const code = await API.generateCppCode();
            if (code) {
                UI.displayCode(code);
                UI.switchTab('code');
                
                // 也保存到训练状态
                const state = Training.getState();
                // 直接编译
                const result = await Compiler.compile(code);
                UI.clearOutput();
                UI.displayOutput(result.output);
                
                UI.showToast('代码生成成功', 'success');
                UI.addLogEntry('success', '单次生成完成');
                UI.updateTokenDisplay();
            }
        } catch (error) {
            UI.showToast('生成失败: ' + error.message, 'error');
            UI.addLogEntry('error', '生成失败: ' + error.message);
        } finally {
            UI.setButtonLoading(btn, false);
        }
    }

    // ========== 辅助函数 ==========

    function updateDetailStatus(status) {
        const el = UI.$('#detail-status');
        if (el) el.textContent = status;
    }

    function updateDetailRound(round, total) {
        const el = UI.$('#detail-round');
        if (el) el.textContent = round + ' / ' + total;
    }

    function updateDetailCompile(result) {
        const el = UI.$('#detail-compile');
        if (el) {
            el.textContent = result;
            el.style.color = result === '成功' ? 'var(--success)' : result === '失败' ? 'var(--error)' : 'var(--accent)';
        }
    }

    function resetButtons() {
        const startBtn = UI.$('#btn-start-training');
        const pauseBtn = UI.$('#btn-pause-training');
        const stopBtn = UI.$('#btn-stop-training');

        if (startBtn) startBtn.disabled = false;
        if (pauseBtn) {
            pauseBtn.disabled = true;
            pauseBtn.textContent = '⏸ 暂停训练';
        }
        if (stopBtn) stopBtn.disabled = true;
    }

    // ========== 启动应用 ==========
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();