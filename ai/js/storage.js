/* ============================================================
   KOBG AI - storage.js - 本地存储管理
   负责 API 配置、训练历史等数据的持久化存储
   ============================================================ */

const KOBGStorage = (() => {
    const KEYS = {
        API_CONFIG: 'kobg_api_config',
        TRAINING_HISTORY: 'kobg_training_history',
        TRAINING_DATA: 'kobg_training_data',
        TOKEN_USAGE: 'kobg_token_usage',
        SETTINGS: 'kobg_settings'
    };

    function get(key, defaultValue = null) {
        try {
            const raw = localStorage.getItem(key);
            return raw ? JSON.parse(raw) : defaultValue;
        } catch (e) {
            console.warn('[Storage] Failed to read:', key, e);
            return defaultValue;
        }
    }

    function set(key, value) {
        try {
            localStorage.setItem(key, JSON.stringify(value));
        } catch (e) {
            console.warn('[Storage] Failed to write:', key, e);
        }
    }

    function remove(key) {
        try {
            localStorage.removeItem(key);
        } catch (e) {
            console.warn('[Storage] Failed to remove:', key, e);
        }
    }

    // API 配置
    function getApiConfig() {
        return get(KEYS.API_CONFIG, {
            url: '',
            apiKey: '',
            model: ''
        });
    }

    function saveApiConfig(config) {
        set(KEYS.API_CONFIG, config);
    }

    // 训练历史
    function getTrainingHistory() {
        return get(KEYS.TRAINING_HISTORY, []);
    }

    function addTrainingRecord(record) {
        const history = getTrainingHistory();
        history.push({
            ...record,
            timestamp: Date.now()
        });
        // 最多保留 100 条记录
        if (history.length > 100) {
            history.splice(0, history.length - 100);
        }
        set(KEYS.TRAINING_HISTORY, history);
        return history;
    }

    function clearTrainingHistory() {
        set(KEYS.TRAINING_HISTORY, []);
    }

    // Token 用量
    function getTokenUsage() {
        return get(KEYS.TOKEN_USAGE, {
            totalInputTokens: 0,
            totalOutputTokens: 0,
            totalTokens: 0,
            callCount: 0
        });
    }

    function updateTokenUsage(inputTokens, outputTokens) {
        const usage = getTokenUsage();
        usage.totalInputTokens += inputTokens || 0;
        usage.totalOutputTokens += outputTokens || 0;
        usage.totalTokens += (inputTokens || 0) + (outputTokens || 0);
        usage.callCount += 1;
        set(KEYS.TOKEN_USAGE, usage);
        return usage;
    }

    function resetTokenUsage() {
        set(KEYS.TOKEN_USAGE, {
            totalInputTokens: 0,
            totalOutputTokens: 0,
            totalTokens: 0,
            callCount: 0
        });
    }

    // 设置
    function getSettings() {
        return get(KEYS.SETTINGS, {
            autoSave: true,
            theme: 'dark'
        });
    }

    function saveSettings(settings) {
        set(KEYS.SETTINGS, { ...getSettings(), ...settings });
    }

    // 清除所有数据
    function clearAll() {
        Object.values(KEYS).forEach(key => remove(key));
    }

    // ============================================================
    //  训练数据管理：保存 / 加载 / 列表 / 删除
    // ============================================================

    /**
     * 保存训练数据
     * @param {string} name - 训练数据名称
     * @param {Object} data - 训练数据 { generatedCode, compileResults, totalRounds, currentRound, ... }
     * @returns {Object} 保存的记录
     */
    function saveTrainingData(name, data) {
        const list = getTrainingDataList();
        const record = {
            id: Date.now().toString(36) + Math.random().toString(36).substring(2, 6),
            name: name || '未命名训练',
            code: data.generatedCode || '',
            totalRounds: data.totalRounds || 0,
            currentRound: data.currentRound || 0,
            compileResults: data.compileResults || [],
            knowledgeSize: data.knowledgeSize || 0,
            createdAt: Date.now(),
            updatedAt: Date.now()
        };
        list.push(record);
        set(KEYS.TRAINING_DATA, list);
        return record;
    }

    /**
     * 获取所有已保存的训练数据列表
     */
    function getTrainingDataList() {
        return get(KEYS.TRAINING_DATA, []);
    }

    /**
     * 根据 ID 获取单条训练数据
     */
    function getTrainingData(id) {
        const list = getTrainingDataList();
        return list.find(item => item.id === id) || null;
    }

    /**
     * 更新训练数据
     */
    function updateTrainingData(id, updates) {
        const list = getTrainingDataList();
        const idx = list.findIndex(item => item.id === id);
        if (idx >= 0) {
            list[idx] = { ...list[idx], ...updates, updatedAt: Date.now() };
            set(KEYS.TRAINING_DATA, list);
            return list[idx];
        }
        return null;
    }

    /**
     * 删除训练数据
     */
    function deleteTrainingData(id) {
        const list = getTrainingDataList();
        const filtered = list.filter(item => item.id !== id);
        set(KEYS.TRAINING_DATA, filtered);
    }

    return {
        getApiConfig,
        saveApiConfig,
        getTrainingHistory,
        addTrainingRecord,
        clearTrainingHistory,
        getTokenUsage,
        updateTokenUsage,
        resetTokenUsage,
        getSettings,
        saveSettings,
        clearAll,
        saveTrainingData,
        getTrainingDataList,
        getTrainingData,
        updateTrainingData,
        deleteTrainingData
    };
})();