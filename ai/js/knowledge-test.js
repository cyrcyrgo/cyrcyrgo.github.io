/* ============================================================
   KOBG AI v1.01 - knowledge-test.js - 知识在线测试模块
   支持两种模式：本地模糊匹配 和 真实模型编译执行
   多层级模糊匹配：字符级、同音字、词袋、拼音、跳跃式
   ============================================================ */

const KOBGKnowledgeTest = (() => {
    let knowledgeBase = [];
    let chatHistory = [];
    let testMode = 'local';

    // ============================================================
    //  同音字 / 形近字 映射表（中文容错）
    // ============================================================
    const HOMOPHONE_MAP = {
        // 常见同音/近音混淆
        '的': ['得', '地'],
        '得': ['的', '地'],
        '地': ['的', '得'],
        '在': ['再'],
        '再': ['在'],
        '那': ['哪'],
        '哪': ['那'],
        '他': ['她', '它'],
        '她': ['他', '它'],
        '它': ['他', '她'],
        '做': ['作'],
        '作': ['做'],
        '有': ['又'],
        '又': ['有'],
        '要': ['有'],
        '会': ['回'],
        '回': ['会'],
        '是': ['时', '事'],
        '时': ['是', '事'],
        '事': ['是', '时'],
        '人': ['仁'],
        '仁': ['人'],
        '么': ['吗', '嘛'],
        '吗': ['么', '嘛'],
        '嘛': ['么', '吗'],
        '和': ['合'],
        '合': ['和'],
        '只': ['指'],
        '指': ['只'],
        '个': ['各', '哥'],
        '各': ['个', '哥'],
        '能': ['弄'],
        '你': ['您'],
        '您': ['你'],
        '网': ['往'],
        '往': ['网'],
        '机': ['计'],
        '计': ['机'],
        '力': ['利'],
        '利': ['力'],
        '应': ['映'],
        '映': ['应'],
        '形': ['型'],
        '型': ['形'],
        '家': ['加'],
        '加': ['家'],
        '结': ['节'],
        '节': ['结'],
        '文': ['问'],
        '问': ['文'],
        '成': ['程'],
        '程': ['成'],
        '实': ['识'],
        '识': ['实'],
        '应': ['映'],
        '用': ['佣'],
        '向': ['想'],
        '想': ['向'],
        '知': ['智'],
        '智': ['知'],
        '动': ['懂'],
        '连': ['联'],
        '联': ['连'],
        '模': ['莫'],
        '莫': ['模'],
        '数': ['树'],
        '树': ['数'],
        '码': ['马'],
        '马': ['码'],
        '算': ['蒜'],
        '信': ['芯'],
        '芯': ['信'],
        '图': ['涂'],
        '涂': ['图'],
        '器': ['气'],
        '气': ['器'],
        '层': ['曾'],
        '曾': ['层'],
        '练': ['链'],
        '链': ['练'],
        '测': ['册'],
        '册': ['测'],
        '试': ['是'],
        '调': ['条'],
        '条': ['调'],
        // 中英混用
        'ai': ['人工智能', '人工智慧'],
        'ml': ['机器学习'],
        'ai人工智能': ['人工智能', 'ai'],
        '人工智慧': ['人工智能', 'ai'],
        'c++': ['c加加', 'cpp'],
        'cpp': ['c加加', 'c++'],
        'python': ['派森', 'py'],
        'java': ['加瓦'],
        'gpu': ['显卡'],
        '显卡': ['gpu'],
        'cpu': ['处理器'],
        '处理器': ['cpu'],
        'api': ['接口'],
        '接口': ['api'],
        'nlp': ['自然语言处理', '自然语言'],
        '自然语言处理': ['nlp', '自然语言'],
        'cv': ['计算机视觉'],
        '计算机视觉': ['cv'],
    };

    /**
     * 预处理文本：去标点、去空格、转小写
     */
    function preprocess(text) {
        return text
            .toLowerCase()
            .replace(/[，。？！、；：""''（）【】《》…—\s,.!?;:'"()\[\]{}<>]/g, '')
            .trim();
    }

    /**
     * 提取文本中的有效字符（中文 + 英文 + 数字）
     */
    function extractChars(text) {
        return text.replace(/[^\u4e00-\u9fff\w]/g, '').toLowerCase();
    }

    /**
     * 分解为字符级 n-gram（1-3 字符）
     */
    function toCharGrams(text) {
        const chars = extractChars(text);
        const grams = [];
        for (let i = 0; i < chars.length; i++) {
            grams.push(chars[i]);
            if (i + 1 < chars.length) grams.push(chars.substring(i, i + 2));
            if (i + 2 < chars.length) grams.push(chars.substring(i, i + 3));
        }
        return grams;
    }

    /**
     * 获取同音扩展词列表
     */
    function getHomophoneVariants(text) {
        const variants = new Set();
        variants.add(text);
        // 对每个字符，加入其同音替代
        const chars = [...text];
        for (let i = 0; i < chars.length; i++) {
            const map = HOMOPHONE_MAP[chars[i]];
            if (map) {
                for (const alt of map) {
                    const variant = chars.slice(0, i).join('') + alt + chars.slice(i + 1).join('');
                    variants.add(variant);
                }
            }
        }
        return [...variants];
    }

    /**
     * 计算两个字符串的相似度（多层级加权）
     */
    function calculateSimilarity(query, target) {
        const q = query.toLowerCase();
        const t = target.toLowerCase();

        // 层级0: 精确匹配
        if (q === t) return 1.0;

        // 层级1: 包含关系
        if (t.includes(q)) return 0.95;
        if (q.includes(t)) return 0.90;

        // 层级2: 去标点空格后精确匹配
        const qClean = preprocess(q);
        const tClean = preprocess(t);
        if (qClean === tClean) return 0.95;
        if (tClean.includes(qClean)) return 0.92;
        if (qClean.includes(tClean)) return 0.88;

        // 层级3: 同音字扩展后的匹配
        const qVariants = getHomophoneVariants(qClean);
        const tVariants = getHomophoneVariants(tClean);
        let bestHomophone = 0;
        for (const qv of qVariants) {
            for (const tv of tVariants) {
                if (qv === tv) { bestHomophone = 0.85; break; }
                if (tv.includes(qv) && qv.length >= 2) { bestHomophone = Math.max(bestHomophone, 0.82); }
                if (qv.includes(tv) && tv.length >= 2) { bestHomophone = Math.max(bestHomophone, 0.80); }
            }
            if (bestHomophone >= 0.85) break;
        }

        // 层级4: 字符 n-gram 跳跃式匹配（最核心的模糊匹配）
        const qGrams = toCharGrams(qClean);
        const tGrams = toCharGrams(tClean);

        if (qGrams.length > 0 && tGrams.length > 0) {
            const tGramSet = new Set(tGrams);
            let matched = 0;
            let totalWeight = 0;
            for (const gram of qGrams) {
                const weight = gram.length; // 长 gram 权重更高
                totalWeight += weight;
                if (tGramSet.has(gram)) {
                    matched += weight;
                }
            }
            if (totalWeight > 0) {
                const charScore = matched / totalWeight;
                // 平滑处理：低分也给予基础分
                const smoothedCharScore = charScore * 0.8 + 0.2;
                if (charScore > 0.05) {
                    bestHomophone = Math.max(bestHomophone, smoothedCharScore * 0.85);
                }
            }
        }

        // 层级5: 词袋匹配（原始词级）
        const qWords = qClean.split(/[\s,，。？！、]+/).filter(w => w.length > 0);
        const tWords = tClean.split(/[\s,，。？！、]+/).filter(w => w.length > 0);
        if (qWords.length > 0 && tWords.length > 0) {
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
            const wordScore = matchCount / Math.max(qWords.length, tWords.length);
            bestHomophone = Math.max(bestHomophone, wordScore * 0.75);
        }

        // 层级6: 单个字符重叠（兜底，极度宽松）
        if (bestHomophone < 0.1) {
            const qChars = new Set([...qClean]);
            const tChars = new Set([...tClean]);
            let overlap = 0;
            for (const c of qChars) {
                if (tChars.has(c)) overlap++;
            }
            if (qChars.size > 0 && overlap > 0) {
                const charOverlap = overlap / qChars.size;
                bestHomophone = Math.max(bestHomophone, charOverlap * 0.55);
            }
        }

        // 层级7: 只要有任意字符匹配，就返回最低分（绝不失败）
        if (bestHomophone < 0.08) {
            const qCharsArr = [...qClean];
            const tCharsArr = [...tClean];
            for (const c of qCharsArr) {
                if (tCharsArr.includes(c)) {
                    bestHomophone = 0.08;
                    break;
                }
            }
        }

        return Math.min(bestHomophone, 1.0);
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

        // 大幅降低匹配门槛：0.05 即可匹配
        if (best.score < 0.05) {
            // 仍无匹配，返回最接近的条目（兜底：永远返回一个答案）
            if (knowledgeBase.length > 0) {
                // 再次尝试不带任何门槛的匹配
                let fallback = knowledgeBase[0];
                let fallbackScore = 0;
                for (const entry of knowledgeBase) {
                    const qClean = preprocess(query);
                    const tClean = preprocess(entry.question);
                    const qc = new Set([...qClean]);
                    const tc = new Set([...tClean]);
                    let overlap = 0;
                    for (const c of qc) {
                        if (tc.has(c)) overlap++;
                    }
                    const s = qc.size > 0 ? overlap / qc.size : 0;
                    if (s > fallbackScore) {
                        fallbackScore = s;
                        fallback = entry;
                    }
                }
                return {
                    answer: fallback.answer,
                    score: Math.max(0.01, fallbackScore),
                    matchedKey: fallback.question
                };
            }
            return {
                answer: '抱歉，我还没有学习到与这个问题相关的知识。请尝试其他问题或继续训练模型。',
                score: 0,
                matchedKey: ''
            };
        }

        return best;
    }

    function getScoreLabel(score) {
        if (score >= 0.7) return { text: '高匹配', cls: 'high' };
        if (score >= 0.35) return { text: '中匹配', cls: 'medium' };
        if (score >= 0.08) return { text: '模糊匹配', cls: 'low' };
        return { text: '兜底匹配', cls: 'low' };
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

    async function askQuestion(question) {
        if (!question.trim()) return;

        if (testMode === 'real') {
            await askReal(question);
        } else {
            askLocal(question);
        }
    }

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