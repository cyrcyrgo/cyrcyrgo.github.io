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
    const KnowledgeTest = KOBGKnowledgeTest;

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

        // 导出模型
        const exportBtn = UI.$('#btn-export');
        if (exportBtn) {
            exportBtn.addEventListener('click', handleExport);
        }

        // 保存训练数据
        const saveDataBtn = UI.$('#btn-save-data');
        if (saveDataBtn) {
            saveDataBtn.addEventListener('click', handleOpenSaveModal);
        }

        // 打开训练数据
        const loadDataBtn = UI.$('#btn-load-data');
        if (loadDataBtn) {
            loadDataBtn.addEventListener('click', handleOpenLoadModal);
        }

        // 确认保存
        const confirmSaveBtn = UI.$('#btn-confirm-save-data');
        if (confirmSaveBtn) {
            confirmSaveBtn.addEventListener('click', handleConfirmSaveData);
        }

        // 清空全部训练数据
        const clearAllDataBtn = UI.$('#btn-clear-all-data');
        if (clearAllDataBtn) {
            clearAllDataBtn.addEventListener('click', handleClearAllData);
        }

        // 模态框关闭按钮
        document.querySelectorAll('[data-modal-close]').forEach(btn => {
            btn.addEventListener('click', () => UI.closeModal(btn.dataset.modalClose));
        });
        document.querySelectorAll('[data-modal] .modal-close').forEach(btn => {
            btn.addEventListener('click', () => UI.closeModal(btn.dataset.modal));
        });

        // 点击遮罩关闭模态框
        document.querySelectorAll('.modal-overlay').forEach(overlay => {
            overlay.addEventListener('click', (e) => {
                if (e.target === overlay) overlay.style.display = 'none';
            });
        });

        // 移动端侧边栏切换
        const mobileToggle = UI.$('#mobile-sidebar-toggle');
        if (mobileToggle) {
            mobileToggle.addEventListener('click', () => {
                const sidebar = UI.$('.sidebar');
                if (sidebar) {
                    sidebar.classList.toggle('collapsed-mobile');
                    mobileToggle.textContent = sidebar.classList.contains('collapsed-mobile') ? '☰' : '✕';
                }
            });
        }

        // 训练模式切换
        const modeRadios = document.querySelectorAll('input[name="training-mode"]');
        modeRadios.forEach(radio => {
            radio.addEventListener('change', (e) => {
                UI.switchTrainingMode(e.target.value);
            });
        });

        // 训练时长滑块
        const durationSlider = UI.$('#duration-slider');
        if (durationSlider) {
            durationSlider.addEventListener('input', () => {
                UI.updateDurationSlider();
                UI.updateEstimatedRounds();
            });
        }

        // 自定义轮数输入
        const customRoundsInput = UI.$('#custom-rounds');
        if (customRoundsInput) {
            customRoundsInput.addEventListener('input', () => {
                let val = parseInt(customRoundsInput.value);
                if (isNaN(val) || val < 1) val = 1;
                if (val > 100) val = 100;
                customRoundsInput.value = val;
                const roundsInfo = UI.$('#rounds-info');
                if (roundsInfo) {
                    roundsInfo.textContent = `共 ${val} 轮，LLM输出完成后自动进入下一轮`;
                }
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

        // 知识测试 - 发送按钮
        const testSendBtn = UI.$('#btn-test-send');
        if (testSendBtn) {
            testSendBtn.addEventListener('click', handleTestSend);
        }
        const testInput = UI.$('#test-input');
        if (testInput) {
            testInput.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') handleTestSend();
            });
        }
        const testClearBtn = UI.$('#btn-test-clear');
        if (testClearBtn) {
            testClearBtn.addEventListener('click', () => {
                KnowledgeTest.clearChat();
                UI.showToast('对话已清空', 'success');
            });
        }

        // 测试模式切换
        const testModeRadios = document.querySelectorAll('input[name="test-mode"]');
        testModeRadios.forEach(radio => {
            radio.addEventListener('change', (e) => {
                KnowledgeTest.setMode(e.target.value);
            });
        });
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
        if (!API.isConfigured()) {
            UI.showToast('请先配置 API 接口信息', 'error');
            UI.switchTab('code');
            return;
        }

        if (Training.isRunning()) {
            UI.showToast('训练已在运行中', 'warning');
            return;
        }

        const trainingMode = UI.getTrainingMode();
        const durationSeconds = UI.getTrainingDuration();
        const customInstruction = UI.$('#custom-instruction')?.value?.trim() || '';
        const customRounds = trainingMode === 'rounds' ? UI.getCustomRounds() : null;
        const qaPerRound = UI.getQaPerRound();
        
        const totalRounds = trainingMode === 'rounds' ? customRounds : Math.max(1, Math.ceil(durationSeconds / 30));
        const totalMinutes = trainingMode === 'rounds' ? Math.ceil(totalRounds * 30 / 60) : Math.ceil(durationSeconds / 60);
        
        UI.updateStatus('training');
        UI.clearOutput();
        UI.clearLog();
        UI.updateProgress(0);
        UI.streamReset();
        updateDetailStatus('训练中');
        updateDetailRound(0, totalRounds);
        updateDetailCompile('-');
        
        const startBtn = UI.$('#btn-start-training');
        const pauseBtn = UI.$('#btn-pause-training');
        const stopBtn = UI.$('#btn-stop-training');
        
        if (startBtn) startBtn.disabled = true;
        if (pauseBtn) pauseBtn.disabled = false;
        if (stopBtn) stopBtn.disabled = false;

        if (trainingMode === 'rounds') {
            UI.addLogEntry('info', `训练开始，共 ${totalRounds} 轮，每轮 ${qaPerRound} 个问答对`);
        } else {
            UI.addLogEntry('info', `训练开始，总时长: ${totalMinutes} 分钟，每轮 ${qaPerRound} 个问答对`);
        }
        if (customInstruction) {
            UI.addLogEntry('info', `自定义指令: ${customInstruction.substring(0, 50)}${customInstruction.length > 50 ? '...' : ''}`);
        }

        try {
            await Training.startTraining(
                durationSeconds,
                (progress, round, total) => {
                    UI.updateProgress(progress);
                    UI.addLogEntry('info', `第 ${round}/${total} 轮训练中...`);
                    updateDetailRound(round, total);
                    UI.streamReset();
                    UI.streamStart();
                },
                () => {
                    UI.updateProgress(1);
                    UI.updateStatus('connected');
                    UI.showToast('训练完成！', 'success');
                    UI.addLogEntry('success', '训练已完成');
                    updateDetailStatus('完成');
                    updateDetailCompile('成功');
                    UI.streamEnd();
                    
                    const code = Training.getGeneratedCode();
                    if (code) {
                        UI.displayCode(code);
                        KnowledgeTest.loadKnowledgeBase(code);
                    }
                    
                    const results = Training.getCompileResults();
                    if (results.length > 0) {
                        const last = results[results.length - 1];
                        UI.displayOutput(last.output);
                        UI.switchTab('output');
                    }
                    
                    UI.updateTokenDisplay();
                    resetButtons();
                },
                (error) => {
                    UI.updateStatus('error');
                    UI.showToast('训练出错: ' + error.message, 'error');
                    UI.addLogEntry('error', '训练出错: ' + error.message);
                    updateDetailStatus('错误');
                    updateDetailCompile('失败');
                    UI.streamError(error.message);
                    resetButtons();
                },
                (elapsed) => {
                    UI.updateTimer(elapsed);
                },
                (chunk) => {
                    UI.streamAppend(chunk);
                },
                customInstruction,
                customRounds,
                qaPerRound
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
                UI.streamReset();
                KnowledgeTest.clearChat();
                KnowledgeTest.loadKnowledgeBase('');
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

    async function handleExport() {
        const code = Training.getGeneratedCode();
        if (!code) {
            UI.showToast('暂无代码可导出，请先进行训练生成代码', 'warning');
            return;
        }

        const exportBtn = UI.$('#btn-export');
        if (exportBtn) {
            exportBtn.disabled = true;
            exportBtn.textContent = '⏳ 编译中...';
        }

        UI.showToast('正在编译并导出模型...', 'info');

        try {
            const response = await fetch('/api/export', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ code })
            });

            if (!response.ok) {
                const errData = await response.json().catch(() => null);
                const errMsg = errData?.errors?.join('; ') || `编译失败 (${response.status})`;
                throw new Error(errMsg);
            }

            const blob = await response.blob();
            const disposition = response.headers.get('Content-Disposition') || '';
            const filenameMatch = disposition.match(/filename="?([^"\s;]+)"?/);
            const filename = filenameMatch ? filenameMatch[1] : 'kobg-ai-model.exe';

            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);

            const sizeMB = (blob.size / 1024 / 1024).toFixed(2);
            UI.showToast(`模型导出成功: ${filename} (${sizeMB} MB)`, 'success');
        } catch (error) {
            UI.showToast('导出失败: ' + error.message, 'error');
        } finally {
            if (exportBtn) {
                exportBtn.disabled = false;
                exportBtn.textContent = '📦 导出模型 (.exe)';
            }
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

        const customInstruction = UI.$('#custom-instruction')?.value?.trim() || '';
        UI.streamReset();
        UI.streamStart();

        try {
            const code = await API.generateCppCodeStream((chunk) => {
                UI.streamAppend(chunk);
            }, customInstruction);

            UI.streamEnd();

            if (code) {
                UI.displayCode(code);
                UI.switchTab('code');
                Training.setGeneratedCode(code);
                KnowledgeTest.loadKnowledgeBase(code);
                
                const result = await Compiler.compile(code);
                UI.clearOutput();
                UI.displayOutput(result.output);
                
                UI.showToast('代码生成成功', 'success');
                UI.addLogEntry('success', '单次生成完成');
                UI.updateTokenDisplay();
            }
        } catch (error) {
            UI.streamError(error.message);
            UI.showToast('生成失败: ' + error.message, 'error');
            UI.addLogEntry('error', '生成失败: ' + error.message);
        } finally {
            UI.setButtonLoading(btn, false);
        }
    }

    async function handleTestSend() {
        const input = UI.$('#test-input');
        if (!input) return;
        const question = input.value.trim();
        if (!question) return;

        try {
            await KnowledgeTest.askQuestion(question);
        } catch (err) {
            UI.showToast('测试失败: ' + err.message, 'error');
        }
        input.value = '';
    }

    // ========== 训练数据保存/加载 ==========

    function handleOpenSaveModal() {
        const code = Training.getGeneratedCode();
        if (!code) {
            UI.showToast('暂无训练数据可保存，请先训练', 'warning');
            return;
        }

        const state = Training.getState();
        const info = UI.$('#save-data-info');
        if (info) {
            const now = new Date().toLocaleString();
            info.innerHTML = `已训练轮次: ${state.currentRound}/${state.totalRounds}<br>` +
                             `编译次数: ${state.compileResults.length}<br>` +
                             `代码长度: ${code.length} 字符<br>` +
                             `保存时间: ${now}`;
        }

        const nameInput = UI.$('#save-data-name');
        if (nameInput) {
            nameInput.value = `训练_${new Date().toLocaleDateString()} ${state.currentRound}轮`;
        }

        UI.openModal('modal-save-data');
    }

    function handleConfirmSaveData() {
        const nameInput = UI.$('#save-data-name');
        const name = nameInput ? nameInput.value.trim() : '';
        if (!name) {
            UI.showToast('请输入训练名称', 'warning');
            return;
        }

        const state = Training.exportState();
        const record = Storage.saveTrainingData(name, state);
        UI.showToast(`训练数据 "${name}" 已保存`, 'success');
        UI.closeModal('modal-save-data');
    }

    function handleOpenLoadModal() {
        renderDataList();
        UI.openModal('modal-load-data');
    }

    function renderDataList() {
        const list = Storage.getTrainingDataList();
        const listEl = UI.$('#data-list');
        const countEl = UI.$('#data-list-count');
        if (countEl) countEl.textContent = `共 ${list.length} 条记录`;

        if (!listEl) return;

        if (list.length === 0) {
            listEl.innerHTML = '<div class="data-empty">暂无已保存的训练数据</div>';
            return;
        }

        listEl.innerHTML = list.slice().reverse().map(item => {
            const date = new Date(item.createdAt).toLocaleString();
            const codeLen = item.code ? item.code.length : 0;
            return `
                <div class="data-item" data-id="${item.id}">
                    <div class="data-item-info">
                        <div class="data-item-name">${escapeHtml(item.name)}</div>
                        <div class="data-item-meta">${date} | ${item.currentRound}/${item.totalRounds} 轮 | ${codeLen} 字符</div>
                    </div>
                    <div class="data-item-actions">
                        <button class="btn btn-primary btn-sm" data-action="load" data-id="${item.id}">加载</button>
                        <button class="btn btn-danger btn-sm" data-action="delete" data-id="${item.id}">删除</button>
                    </div>
                </div>
            `;
        }).join('');

        // 绑定按钮事件
        listEl.querySelectorAll('[data-action="load"]').forEach(btn => {
            btn.addEventListener('click', () => handleLoadData(btn.dataset.id));
        });
        listEl.querySelectorAll('[data-action="delete"]').forEach(btn => {
            btn.addEventListener('click', () => handleDeleteData(btn.dataset.id));
        });
    }

    function handleLoadData(id) {
        const data = Storage.getTrainingData(id);
        if (!data) {
            UI.showToast('未找到该训练数据', 'error');
            return;
        }

        if (Training.isRunning()) {
            UI.showToast('请先停止当前训练', 'warning');
            return;
        }

        const success = Training.importState(data);
        if (success) {
            const code = Training.getGeneratedCode();
            if (code) {
                UI.displayCode(code);
                KnowledgeTest.loadKnowledgeBase(code);
            }
            UI.addLogEntry('success', `已加载训练数据: ${data.name}`);
            UI.showToast(`已加载: ${data.name}`, 'success');

            const exportBtn = UI.$('#btn-export');
            if (exportBtn) exportBtn.disabled = !code;

            UI.closeModal('modal-load-data');
        } else {
            UI.showToast('加载失败', 'error');
        }
    }

    function handleDeleteData(id) {
        const data = Storage.getTrainingData(id);
        if (!data) return;
        Storage.deleteTrainingData(id);
        UI.showToast(`已删除: ${data.name}`, 'success');
        renderDataList();
    }

    function handleClearAllData() {
        const list = Storage.getTrainingDataList();
        if (list.length === 0) {
            UI.showToast('暂无数据可清空', 'info');
            return;
        }
        list.forEach(item => Storage.deleteTrainingData(item.id));
        UI.showToast('已清空全部训练数据', 'success');
        renderDataList();
    }

    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
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