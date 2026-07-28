/* ============================================================
   KOBG AI - knowledge-test.js - 知识在线测试模块
   解析 C++ 代码中的知识库，提供模糊匹配问答测试
   ============================================================ */

const KOBGKnowledgeTest = (() => {
    let knowledgeBase = [];
    let chatHistory = [];

    /**
     * 从 C++ 代码中提取知识库条目
     * 支持多种格式：
     *   knowledge_base["q"] = "a";
     *   knowledge_base["q"] = R"(a)";
     *   kb["q"] = "a";
     */
    function parseKnowledgeBase(code) {
        if (!code) return [];

        const entries = [];

        // 模式1: knowledge_base["key"] = "value";
        const pattern1 = /knowledge_base\s*\[\s*"([^"]+)"\s*\]\s*=\s*"((?:[^"\\]|\\.)*)"/g;
        let match;
        while ((match = pattern1.exec(code)) !== null) {
            entries.push({
                question: match[1],
                answer: match[2].replace(/\\"/g, '"').replace(/\\n/g, '\n')
            });
        }

        // 模式2: kb["key"] = "value";
        const pattern2 = /\bkb\s*\[\s*"([^"]+)"\s*\]\s*=\s*"((?:[^"\\]|\\.)*)"/g;
        while ((match = pattern2.exec(code)) !== null) {
            entries.push({
                question: match[1],
                answer: match[2].replace(/\\"/g, '"').replace(/\\n/g, '\n')
            });
        }

        // 模式3: 原始字符串字面量 knowledge_base["key"] = R"(value)";
        const pattern3 = /knowledge_base\s*\[\s*"([^"]+)"\s*\]\s*=\s*R"\(([\s\S]*?)\)"/g;
        while ((match = pattern3.exec(code)) !== null) {
            entries.push({
                question: match[1],
                answer: match[2].trim()
            });
        }

        // 模式4: knowledge_base.insert({"key", "value"})
        const pattern4 = /knowledge_base\s*\.\s*(?:insert|emplace)\s*\(\s*\{\s*"([^"]+)"\s*,\s*"((?:[^"\\]|\\.)*)"\s*\}\s*\)/g;
        while ((match = pattern4.exec(code)) !== null) {
            entries.push({
                question: match[1],
                answer: match[2].replace(/\\"/g, '"').replace(/\\n/g, '\n')
            });
        }

        // 模式5: make_pair("key", "value")
        const pattern5 = /make_pair\s*\(\s*"([^"]+)"\s*,\s*"((?:[^"\\]|\\.)*)"\s*\)/g;
        while ((match = pattern5.exec(code)) !== null) {
            entries.push({
                question: match[1],
                answer: match[2].replace(/\\"/g, '"').replace(/\\n/g, '\n')
            });
        }

        return entries;
    }

    /**
     * 计算两个字符串的相似度 (0-1)
     * 使用词袋模型 + 子串匹配
     */
    function calculateSimilarity(query, target) {
        const q = query.toLowerCase();
        const t = target.toLowerCase();

        // 精确匹配
        if (q === t) return 1.0;

        // 包含关系
        if (t.includes(q) || q.includes(t)) {
            return 0.85;
        }

        // 词袋匹配
        const qWords = q.split(/[\s,，。？！、]+/).filter(w => w.length > 0);
        const tWords = t.split(/[\s,，。？！、]+/).filter(w => w.length > 0);

        if (qWords.length === 0 || tWords.length === 0) return 0;

        let matchCount = 0;
        for (const qw of qWords) {
            let bestSub = 0;
            for (const tw of tWords) {
                if (tw === qw) { bestSub = 1; break; }
                if (tw.includes(qw) || qw.includes(tw)) {
                    bestSub = Math.max(bestSub, 0.7);
                }
            }
            matchCount += bestSub;
        }

        return matchCount / Math.max(qWords.length, tWords.length);
    }

    /**
     * 在知识库中搜索最佳匹配
     * @returns {{ answer: string, score: number, matchedKey: string }}
     */
    function search(query) {
        if (!knowledgeBase.length) {
            return { answer: '知识库为空，请先训练模型。', score: 0, matchedKey: '' };
        }

        let best = { answer: '', score: 0, matchedKey: '' };

        for (const entry of knowledgeBase) {
            const score = calculateSimilarity(query, entry.question);
            if (score > best.score) {
                best = { answer: entry.answer, score, matchedKey: entry.question };
            }
        }

        if (best.score < 0.15) {
            return {
                answer: '抱歉，我还没有学习到与这个问题相关的知识。请尝试其他问题或继续训练模型。',
                score: best.score,
                matchedKey: ''
            };
        }

        return best;
    }

    /**
     * 获取匹配置信度标签
     */
    function getScoreLabel(score) {
        if (score >= 0.7) return { text: '高匹配', cls: 'high' };
        if (score >= 0.35) return { text: '中匹配', cls: 'medium' };
        return { text: '低匹配', cls: 'low' };
    }

    /**
     * 加载知识库
     */
    function loadKnowledgeBase(code) {
        knowledgeBase = parseKnowledgeBase(code);
        updateKBInfo();
    }

    /**
     * 更新知识库信息显示
     */
    function updateKBInfo() {
        const el = document.getElementById('test-kb-info');
        if (el) el.textContent = '知识库: ' + knowledgeBase.length + ' 条';
    }

    /**
     * 添加聊天消息
     */
    function addChatMessage(type, text, meta = '') {
        const chatEl = document.getElementById('test-chat');
        if (!chatEl) return;

        // 清除空状态
        const emptyState = chatEl.querySelector('.test-empty-state');
        if (emptyState) emptyState.remove();

        const msgDiv = document.createElement('div');
        msgDiv.className = 'test-msg ' + type;

        const bubble = document.createElement('div');
        bubble.className = 'test-msg-bubble';
        bubble.textContent = text;
        msgDiv.appendChild(bubble);

        if (meta) {
            const metaDiv = document.createElement('div');
            metaDiv.className = 'test-msg-meta';
            metaDiv.innerHTML = meta;
            msgDiv.appendChild(metaDiv);
        }

        chatEl.appendChild(msgDiv);
        chatEl.scrollTop = chatEl.scrollHeight;

        chatHistory.push({ type, text, meta, time: Date.now() });
    }

    /**
     * 发送问题并获取答案
     */
    function askQuestion(question) {
        if (!question.trim()) return;

        // 重新从代码中加载知识库
        const code = window.KOBGTraining?.getGeneratedCode?.();
        if (code) knowledgeBase = parseKnowledgeBase(code);
        updateKBInfo();

        // 用户消息
        addChatMessage('user', question, new Date().toLocaleTimeString());

        // 搜索答案
        const result = search(question);
        const label = getScoreLabel(result.score);

        let meta = new Date().toLocaleTimeString();
        if (result.matchedKey) {
            meta += ' | <span class="test-match ' + label.cls + '">' + label.text;
            meta += ' (' + Math.round(result.score * 100) + '%)</span>';
            meta += ' | 匹配: "' + result.matchedKey + '"';
        }

        addChatMessage('ai', result.answer, meta);
    }

    /**
     * 清空聊天记录
     */
    function clearChat() {
        const chatEl = document.getElementById('test-chat');
        if (!chatEl) return;

        chatEl.innerHTML = `
            <div class="test-empty-state">
                <div class="test-empty-icon">🧠</div>
                <div class="test-empty-text">在下方输入问题，测试当前训练模型的回答能力</div>
            </div>
        `;
        chatHistory = [];
    }

    /**
     * 获取知识库条目列表（用于调试）
     */
    function getKnowledgeBase() {
        return [...knowledgeBase];
    }

    return {
        parseKnowledgeBase,
        search,
        loadKnowledgeBase,
        askQuestion,
        clearChat,
        getKnowledgeBase,
        getScoreLabel,
        updateKBInfo
    };
})();