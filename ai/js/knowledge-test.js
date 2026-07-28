/* ============================================================
   KOBG AI - knowledge-test.js - 知识在线测试模块
   支持两种模式：本地模糊匹配 和 真实模型编译执行
   ============================================================ */

const KOBGKnowledgeTest = (() => {
    let knowledgeBase = [];
    let chatHistory = [];
    let testMode = 'local';

    /**
     * 从 C++ 代码中提取知识库条目
     */
    function parseKnowledgeBase(code) {
        if (!code) return [];

        const entries = [];

        // 模式1: knowledge_base["key"] = "value";
        const pattern1 = /knowledge_base\s*\[\s*"((?:[^"\\]|\\.)*)"\s*\]\s*=\s*"((?:[^"\\]|\\.)*)"/g;
        let match;
        const seen = new Set();
        while ((match = pattern1.exec(code)) !== null) {
            const q = match[1].replace(/\\"/g, '"').replace(/\\n/g, '\n').trim();
            const a = match[2].replace(/\\"/g, '"').replace(/\\n/g, '\n').trim();
            const key = q.toLowerCase();
            if (q && a && !seen.has(key)) {
                seen.add(key);
                entries.push({ question: q, answer: a });
            }
        }

        // 模式2: 宽松匹配
        if (entries.length === 0) {
            const pattern2 = /knowledge_base\s*\[\s*"([^"]+)"\s*\]\s*=\s*"([^"]+)"/g;
            while ((match = pattern2.exec(code)) !== null) {
                const q = match[1].trim();
                const a = match[2].trim();
                const key = q.toLowerCase();
                if (q && a && !seen.has(key)) {
                    seen.add(key);
                    entries.push({ question: q, answer: a });
                }
            }
        }

        return entries;
    }

    /**
     * 计算两个字符串的相似度
     */
    function calculateSimilarity(query, target) {
        const q = query.toLowerCase();
        const t = target.toLowerCase();

        if (q === t) return 1.0;
        if (t.includes(q) || q.includes(t)) return 0.85;

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

    function getScoreLabel(score) {
        if (score >= 0.7) return { text: '高匹配', cls: 'high' };
        if (score >= 0.35) return { text: '中匹配', cls: 'medium' };
        return { text: '低匹配', cls: 'low' };
    }

    function loadKnowledgeBase(code) {
        knowledgeBase = parseKnowledgeBase(code);
        updateKBInfo();
    }

    function updateKBInfo() {
        const el = document.getElementById('test-kb-info');
        if (el) el.textContent = '知识库: ' + knowledgeBase.length + ' 条';
    }

    function addChatMessage(type, text, meta = '') {
        const chatEl = document.getElementById('test-chat');
        if (!chatEl) return;

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
     * 本地模式回答
     */
    function askLocal(question) {
        // 重新从代码中加载知识库
        const code = window.KOBGTraining?.getGeneratedCode?.();
        if (code) knowledgeBase = parseKnowledgeBase(code);
        updateKBInfo();

        addChatMessage('user', question, new Date().toLocaleTimeString());

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
     * 真实模型模式回答
     */
    async function askReal(question) {
        const code = window.KOBGTraining?.getGeneratedCode?.();
        if (!code) {
            addChatMessage('user', question, new Date().toLocaleTimeString());
            addChatMessage('ai', '没有训练好的模型代码，请先完成训练。', new Date().toLocaleTimeString());
            return;
        }

        addChatMessage('user', question, new Date().toLocaleTimeString() + ' | 真实编译模式');
        
        // 显示加载状态
        const loadingId = 'loading_' + Date.now();
        const chatEl = document.getElementById('test-chat');
        if (chatEl) {
            const loadingDiv = document.createElement('div');
            loadingDiv.className = 'test-msg ai';
            loadingDiv.id = loadingId;
            loadingDiv.innerHTML = '<div class="test-msg-bubble" style="color:var(--text-muted);">⏳ 编译模型并运行中...</div>';
            chatEl.appendChild(loadingDiv);
            chatEl.scrollTop = chatEl.scrollHeight;
        }

        try {
            const response = await fetch('/api/test', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ code, question })
            });

            // 移除加载状态
            const loadingEl = document.getElementById(loadingId);
            if (loadingEl) loadingEl.remove();

            const data = await response.json();
            
            if (data.success) {
                let meta = new Date().toLocaleTimeString() + ' | <span class="test-match high">真实模型</span>';
                addChatMessage('ai', data.answer || '（无回答）', meta);
            } else {
                const errorMsg = (data.errors && data.errors.length > 0) 
                    ? data.errors.join('; ') 
                    : '未知错误';
                addChatMessage('ai', '❌ 模型编译/执行失败: ' + errorMsg, new Date().toLocaleTimeString());
            }
        } catch (err) {
            const loadingEl = document.getElementById(loadingId);
            if (loadingEl) loadingEl.remove();
            addChatMessage('ai', '❌ 无法连接到编译服务: ' + err.message, new Date().toLocaleTimeString());
        }
    }

    /**
     * 发送问题 - 根据模式选择
     */
    async function askQuestion(question) {
        if (!question.trim()) return;

        if (testMode === 'real') {
            await askReal(question);
        } else {
            askLocal(question);
        }
    }

    /**
     * 切换测试模式
     */
    function setMode(mode) {
        testMode = mode;
    }

    function getMode() {
        return testMode;
    }

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

    function getKnowledgeBase() {
        return [...knowledgeBase];
    }

    return {
        parseKnowledgeBase,
        search,
        loadKnowledgeBase,
        askQuestion,
        askLocal,
        askReal,
        setMode,
        getMode,
        clearChat,
        getKnowledgeBase,
        getScoreLabel,
        updateKBInfo
    };
})();
