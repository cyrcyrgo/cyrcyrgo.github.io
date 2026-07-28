/* ============================================================
   KOBG AI - storage.js - 本地存储管理
   负责 API 配置、训练历史等数据的持久化存储
   ============================================================ */

const KOBGStorage = (() => {
    const KEYS = {
        API_CONFIG: 'kobg_api_config',
        TRAINING_HISTORY: 'kobg_training_history',
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
        clearAll
    };
})();