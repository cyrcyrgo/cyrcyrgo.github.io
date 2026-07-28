/* ============================================================
   KOBG AI - training.js - 训练管理模块
   管理训练会话、上下文、训练计时等
   ============================================================ */

const KOBGTraining = (() => {
    let trainingState = {
        isRunning: false,
        isPaused: false,
        startTime: null,
        elapsedTime: 0,
        totalDuration: 0, // 秒
        currentRound: 0,
        totalRounds: 0,
        generatedCode: null,
        compileResults: [],
        contextMessages: [], // 上下文消息
        timerInterval: null,
        onTickCallback: null
    };

    /**
     * 获取训练状态
     */
    function getState() {
        return { ...trainingState };
    }

    /**
     * 是否正在训练
     */
    function isRunning() {
        return trainingState.isRunning;
    }

    /**
     * 清除上下文
     */
    function clearContext() {
        trainingState.contextMessages = [];
        trainingState.generatedCode = null;
        trainingState.compileResults = [];
        trainingState.currentRound = 0;
        console.log('[Training] 上下文已清除');
    }

    /**
     * 完全重置训练状态
     */
    function reset() {
        stopTimer();
        trainingState = {
            isRunning: false,
            isPaused: false,
            startTime: null,
            elapsedTime: 0,
            totalDuration: 0,
            currentRound: 0,
            totalRounds: 0,
            generatedCode: null,
            compileResults: [],
            contextMessages: [],
            timerInterval: null,
            onTickCallback: null
        };
        console.log('[Training] 训练状态已完全重置');
    }

    /**
     * 启动计时器
     */
    function startTimer(onTick) {
        stopTimer();
        if (onTick) trainingState.onTickCallback = onTick;
        trainingState.startTime = Date.now() - trainingState.elapsedTime * 1000;
        trainingState.timerInterval = setInterval(() => {
            trainingState.elapsedTime = Math.floor((Date.now() - trainingState.startTime) / 1000);
            if (trainingState.onTickCallback) trainingState.onTickCallback(trainingState.elapsedTime);
        }, 1000);
    }

    /**
     * 停止计时器
     */
    function stopTimer() {
        if (trainingState.timerInterval) {
            clearInterval(trainingState.timerInterval);
            trainingState.timerInterval = null;
        }
    }

    /**
     * 开始训练
     * @param {number} durationSeconds - 训练时长（秒）
     * @param {function} onProgress - 进度回调
     * @param {function} onComplete - 完成回调
     * @param {function} onError - 错误回调
     * @param {function} onTick - 计时回调
     * @param {function} onStreamChunk - 流式输出回调
     * @param {string} customInstruction - 自定义训练指令
     * @param {number} customRounds - 自定义训练轮数（可选，覆盖基于时长的计算）
     */
    async function startTraining(durationSeconds, onProgress, onComplete, onError, onTick, onStreamChunk, customInstruction, customRounds) {
        if (trainingState.isRunning) {
            throw new Error('训练已在运行中');
        }

        trainingState.isRunning = true;
        trainingState.isPaused = false;
        trainingState.totalDuration = durationSeconds;
        trainingState.totalRounds = customRounds && customRounds >= 1 ? customRounds : Math.max(1, Math.ceil(durationSeconds / 30));
        trainingState.currentRound = 0;
        trainingState.elapsedTime = 0;

        startTimer(onTick);

        try {
            const roundInterval = customRounds && customRounds >= 1 ? 30000 : Math.min((durationSeconds * 1000) / trainingState.totalRounds, 30000);

            for (let i = 0; i < trainingState.totalRounds; i++) {
                if (!trainingState.isRunning) break;
                if (trainingState.isPaused) {
                    await waitForResume();
                }

                trainingState.currentRound = i + 1;
                const progress = trainingState.currentRound / trainingState.totalRounds;
                onProgress(progress, trainingState.currentRound, trainingState.totalRounds);

                if (onStreamChunk) {
                    await executeTrainingRoundStream(onStreamChunk, customInstruction);
                } else {
                    await executeTrainingRound();
                }

                if (i < trainingState.totalRounds - 1 && trainingState.isRunning) {
                    await sleep(roundInterval);
                }
            }

            if (trainingState.isRunning) {
                onComplete();
            }
        } catch (error) {
            onError(error);
        } finally {
            trainingState.isRunning = false;
            stopTimer();
        }
    }

    /**
     * 执行单轮训练（流式）
     * @param {function} onStreamChunk - 流式回调 (chunkText)
     * @param {string} customInstruction - 自定义训练指令
     */
    async function executeTrainingRoundStream(onStreamChunk, customInstruction = '') {
        try {
            let code;
            if (trainingState.generatedCode) {
                code = await KOBGAPI.continueTrainingStream(
                    trainingState.generatedCode,
                    onStreamChunk,
                    customInstruction || 'Add more diverse Q&A pairs and improve the knowledge base. Output the complete updated C++ code.'
                );
            } else {
                code = await KOBGAPI.generateCppCodeStream(onStreamChunk, customInstruction);
            }

            if (code) {
                trainingState.generatedCode = code;
                
                const compileResult = await KOBGCompiler.compile(code);
                trainingState.compileResults.push({
                    round: trainingState.currentRound,
                    timestamp: Date.now(),
                    success: compileResult.success,
                    output: compileResult.output,
                    errors: compileResult.errors
                });

                trainingState.contextMessages.push({
                    role: 'assistant',
                    content: code
                });
            }
        } catch (error) {
            console.error('[Training] Round failed:', error);
            throw error;
        }
    }

    /**
     * 暂停训练
     */
    function pauseTraining() {
        if (!trainingState.isRunning) return;
        trainingState.isPaused = true;
        stopTimer();
        console.log('[Training] 已暂停');
    }

    /**
     * 恢复训练
     */
    function resumeTraining() {
        if (!trainingState.isPaused) return;
        trainingState.isPaused = false;
        startTimer();
        console.log('[Training] 已恢复');
    }

    /**
     * 停止训练
     */
    function stopTraining() {
        trainingState.isRunning = false;
        trainingState.isPaused = false;
        stopTimer();
        console.log('[Training] 已停止');
    }

    /**
     * 获取当前生成的代码
     */
    function getGeneratedCode() {
        return trainingState.generatedCode;
    }

    function setGeneratedCode(code) {
        trainingState.generatedCode = code;
    }

    /**
     * 获取编译结果
     */
    function getCompileResults() {
        return [...trainingState.compileResults];
    }

    /**
     * 获取训练日志
     */
    function getTrainingLog() {
        return trainingState.compileResults.map(r => ({
            type: r.success ? 'success' : 'error',
            round: r.round,
            time: new Date(r.timestamp).toLocaleTimeString(),
            message: r.success ? `第 ${r.round} 轮编译成功` : `第 ${r.round} 轮编译失败: ${r.errors.join(', ')}`,
            errors: r.errors
        }));
    }

    // 辅助函数
    function sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    function waitForResume() {
        return new Promise(resolve => {
            const check = setInterval(() => {
                if (!trainingState.isPaused || !trainingState.isRunning) {
                    clearInterval(check);
                    resolve();
                }
            }, 200);
        });
    }

    return {
        getState,
        isRunning,
        clearContext,
        reset,
        startTraining,
        executeTrainingRound,
        executeTrainingRoundStream,
        pauseTraining,
        resumeTraining,
        stopTraining,
        getGeneratedCode,
        setGeneratedCode,
        getCompileResults,
        getTrainingLog
    };
})();