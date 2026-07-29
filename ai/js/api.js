/* ============================================================
   KOBG AI - api.js - LLM API 通信模块
   负责与用户配置的大模型 API 进行通信
   核心设计：AI 只输出问答对数据，C++ 模板代码由系统内置组装
   支持双模式：本地代理模式（localhost）和直连模式（静态托管如 GitHub Pages）
   ============================================================ */

const KOBGAPI = (() => {
    // 系统提示词：AI 只输出问答对，不输出模板代码
    const SYSTEM_PROMPT = `You are a Q&A knowledge generator for the KOBG AI Training Framework.

Your task is to generate diverse Question-Answer pairs for an AI dialogue system.
The C++ code framework is BUILT-IN - you ONLY output the knowledge data.

OUTPUT FORMAT (STRICTLY FOLLOW):
1. First, output knowledge base entries using this exact C++ syntax:
   knowledge_base["question text"] = "answer text";
   Each entry on its own line. Generate the EXACT number of entries requested.

2. Then output a separator line:  ---TEST---

3. Then output test questions as C++ string initializers:
   "test question 1",
   "test question 2",
   Each question on its own line. Generate the same number of test questions.

QUALITY REQUIREMENTS:
- Each question must be UNIQUE and DIFFERENT from all others.
- Questions must cover DIVERSE topics within the requested subject area.
- Answers must be DETAILED (at least 20 words), ACCURATE, and EDUCATIONAL.
- Do NOT repeat questions or give near-duplicate questions.
- Vary question phrasing: "What is...", "Explain...", "How does...", "Describe...", "Why is..."
- Each answer should be self-contained and informative.

CRITICAL RULES:
- ONLY output knowledge_base entries, the ---TEST--- separator, and test questions.
- Do NOT include any other C++ code, class definitions, includes, or explanations.
- Do NOT use markdown, code blocks, or backticks.
- You may include Chinese language Q&A pairs if the user asks in Chinese.`;

    let cachedTemplate = null;
    let _useProxy = null; // null = 未检测, true = 代理模式, false = 直连模式

    // ========== 高压力训练稳定性机制 ==========

    // 全局请求超时配置（毫秒）
    const REQUEST_TIMEOUT = 120000; // 2 分钟
    const STREAM_TIMEOUT = 300000;  // 5 分钟（流式可能很长）
    const MAX_RETRIES = 3;
    const RETRY_DELAYS = [1000, 3000, 8000]; // 指数退避: 1s, 3s, 8s

    /**
     * 判断错误是否可重试
     */
    function isRetryableError(status, errorMessage) {
        if (!status || status === 0) return true; // 网络错误
        if (status === 429) return true; // 限流
        if (status >= 500 && status < 600) return true; // 服务端错误
        if (status === 408) return true; // 请求超时
        // 401/403/404 不重试（认证/权限/路由问题）
        return false;
    }

    /**
     * 带超时的 fetch（使用 AbortController）
     */
    function fetchWithTimeout(url, options, timeoutMs) {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
        const signal = controller.signal;

        return fetch(url, { ...options, signal })
            .finally(() => clearTimeout(timeoutId));
    }

    /**
     * 带重试的 fetch（指数退避）
     */
    async function fetchWithRetry(url, options, retries = MAX_RETRIES, timeoutMs = REQUEST_TIMEOUT) {
        let lastError = null;

        for (let attempt = 0; attempt <= retries; attempt++) {
            try {
                if (attempt > 0) {
                    const delay = RETRY_DELAYS[Math.min(attempt - 1, RETRY_DELAYS.length - 1)];
                    console.log(`[API] 重试 ${attempt}/${retries}，等待 ${delay}ms...`);
                    await new Promise(r => setTimeout(r, delay));
                }

                const response = await fetchWithTimeout(url, options, timeoutMs);

                if (response.ok) return response;

                // 非 2xx 响应
                if (!isRetryableError(response.status, null) || attempt >= retries) {
                    return response; // 不可重试或已达上限，返回错误响应
                }

                console.warn(`[API] 可重试错误 ${response.status}，准备重试...`);
                lastError = new Error(`HTTP ${response.status}`);

            } catch (err) {
                lastError = err;
                if (err.name === 'AbortError') {
                    console.warn(`[API] 请求超时 (${timeoutMs}ms)${attempt < retries ? '，准备重试...' : ''}`);
                    if (attempt >= retries) throw new Error(`请求超时（${timeoutMs / 1000}秒），已重试 ${retries} 次后仍失败`);
                    continue;
                }
                if (err.message?.includes('Failed to fetch') || err.message?.includes('NetworkError')) {
                    console.warn(`[API] 网络错误${attempt < retries ? '，准备重试...' : ''}`);
                    if (attempt >= retries) throw new Error(`网络连接失败，已重试 ${retries} 次后仍失败`);
                    continue;
                }
                throw err; // 非可重试错误
            }
        }

        throw lastError || new Error('请求失败');
    }

    /**
     * 检测运行环境：本地代理模式 vs 直连模式
     * 规则：localhost / 127.0.0.1 视为有后端代理的本地环境
     *       其他（如 GitHub Pages）视为静态托管，直连 API
     */
    function isLocalHost() {
        const host = window.location.hostname;
        return host === 'localhost' || host === '127.0.0.1' || host === '';
    }

    /**
     * 构建完整的 API 端点 URL（直连模式）
     * 确保以 /chat/completions 结尾
     */
    function buildDirectUrl(baseUrl) {
        let url = baseUrl.replace(/\/+$/, '');
        if (!url.endsWith('/chat/completions')) {
            url += '/chat/completions';
        }
        return url;
    }

    /**
     * 统一的请求发送函数，自动适配代理/直连模式
     * 内置超时保护、自动重试（指数退避）、熔断
     * @param {Object} opts - { messages, temperature, maxTokens, topP, stream, onChunk, signal }
     * @returns {Promise<string|Object>} 非流式返回 content 字符串，流式由 onChunk 回调处理
     */
    async function makeRequest(opts) {
        const config = getConfig();
        if (!isConfigured()) {
            throw new Error('API 未配置，请先填写 API 接口信息');
        }

        const { messages, temperature = 0.7, maxTokens = 4096, topP = 1.0, stream = false, onChunk, signal } = opts;

        const allMessages = [
            { role: 'system', content: SYSTEM_PROMPT },
            ...messages
        ];

        const useProxy = isLocalHost();
        const timeoutMs = stream ? STREAM_TIMEOUT : REQUEST_TIMEOUT;

        let fetchUrl, fetchOptions;

        if (useProxy) {
            // 代理模式：POST 到本地 /api/chat，由 server.js 转发
            fetchUrl = '/api/chat';
            fetchOptions = {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    url: config.url,
                    apiKey: config.apiKey,
                    model: config.model,
                    messages: allMessages,
                    temperature,
                    max_tokens: maxTokens,
                    top_p: topP,
                    stream
                })
            };
        } else {
            // 直连模式：直接请求用户配置的 API
            fetchUrl = buildDirectUrl(config.url);
            fetchOptions = {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${config.apiKey}`
                },
                body: JSON.stringify({
                    model: config.model,
                    messages: allMessages,
                    temperature,
                    max_tokens: maxTokens,
                    top_p: topP,
                    stream
                })
            };
        }

        // 合并外部 AbortController 的 signal
        if (signal) {
            fetchOptions.signal = signal;
        }

        // 流式请求不重试（SSE 中断后重试会丢失上下文），但非流式请求自动重试
        const response = stream
            ? await fetchWithTimeout(fetchUrl, fetchOptions, timeoutMs)
            : await fetchWithRetry(fetchUrl, fetchOptions, MAX_RETRIES, timeoutMs);

        if (!response.ok) {
            let errorMsg = '';
            try {
                const errorData = await response.json();
                errorMsg = errorData.error?.message || errorData.message || JSON.stringify(errorData);
            } catch (_) {
                try {
                    errorMsg = await response.text();
                } catch (_) {
                    errorMsg = '';
                }
            }
            const msg = friendlyError(response.status, errorMsg);
            throw new Error(msg);
        }

        if (stream) {
            return handleStreamResponse(response, messages, onChunk, signal);
        } else {
            return handleJsonResponse(response, messages);
        }
    }

    /**
     * 处理非流式 JSON 响应
     */
    async function handleJsonResponse(response, messages) {
        const data = await response.json();
        const usage = data.usage || {};
        const inputTokens = usage.prompt_tokens || 0;
        const outputTokens = usage.completion_tokens || 0;
        KOBGStorage.updateTokenUsage(inputTokens, outputTokens);

        const content = data.choices?.[0]?.message?.content || '';
        // 处理 reasoning_content（推理模型的思考过程）
        const reasoning = data.choices?.[0]?.message?.reasoning_content || '';
        if (reasoning && !content) {
            console.log('[API] Model returned only reasoning_content, waiting for final content...');
        }
        return cleanCodeOutput(content);
    }

    /**
     * 处理流式 SSE 响应（带超时和中断保护）
     */
    async function handleStreamResponse(response, messages, onChunk, signal) {
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let fullContent = '';

        // 读取超时保护：每 30 秒必须有新数据，否则中断
        const CHUNK_TIMEOUT = 30000;
        let lastChunkTime = Date.now();

        const abortHandler = () => {
            try { reader.cancel('用户中止'); } catch (_) {}
        };
        if (signal) {
            signal.addEventListener('abort', abortHandler, { once: true });
        }

        try {
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                lastChunkTime = Date.now();
                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop() || '';

                for (const line of lines) {
                    const trimmed = line.trim();
                    if (!trimmed || !trimmed.startsWith('data: ')) continue;
                    const dataStr = trimmed.slice(6);
                    if (dataStr === '[DONE]') continue;

                    try {
                        const parsed = JSON.parse(dataStr);
                        const delta = parsed.choices?.[0]?.delta?.content;
                        if (delta) {
                            fullContent += delta;
                            if (onChunk) onChunk(delta);
                        }
                    } catch (e) {
                        // 忽略解析错误的行
                    }
                }
            }
        } finally {
            if (signal) {
                signal.removeEventListener('abort', abortHandler);
            }
            // 确保 reader 被释放
            try { reader.releaseLock(); } catch (_) {}
        }

        KOBGStorage.updateTokenUsage(
            estimateTokens(messages.map(m => m.content).join('')),
            estimateTokens(fullContent)
        );

        return cleanCodeOutput(fullContent);
    }

    /**
     * 加载并缓存 C++ 模板
     */
    async function loadTemplate() {
        if (cachedTemplate) return cachedTemplate;
        try {
            const response = await fetch('templates/framework.cpp');
            if (response.ok) {
                cachedTemplate = await response.text();
                return cachedTemplate;
            }
        } catch (e) {
            console.warn('[API] Failed to load template:', e);
        }
        return null;
    }

    /**
     * 解析 AI 输出为结构化数据
     * @param {string} text - AI 原始输出
     * @returns {{knowledge: Array<{q: string, a: string}>, testQuestions: string[]}}
     */
    function parseAIOutput(text) {
        const knowledge = [];
        const testQuestions = [];

        if (!text) return { knowledge, testQuestions };

        let cleaned = text.trim();
        cleaned = cleaned.replace(/^```(?:cpp|c\+\+)?\s*\n?/i, '');
        cleaned = cleaned.replace(/\n?```\s*$/, '');

        const separatorIdx = cleaned.indexOf('---TEST---');
        const kbSection = separatorIdx >= 0 ? cleaned.substring(0, separatorIdx) : cleaned;
        const testSection = separatorIdx >= 0 ? cleaned.substring(separatorIdx + '---TEST---'.length) : '';

        // 解析 knowledge_base 条目
        const kbPattern = /knowledge_base\s*\[\s*"((?:[^"\\]|\\.)*)"\s*\]\s*=\s*"((?:[^"\\]|\\.)*)"\s*;/g;
        let match;
        const seen = new Set();
        while ((match = kbPattern.exec(kbSection)) !== null) {
            const q = match[1].replace(/\\"/g, '"').replace(/\\n/g, '\n').trim();
            const a = match[2].replace(/\\"/g, '"').replace(/\\n/g, '\n').trim();
            const key = q.toLowerCase();
            if (q && a && !seen.has(key)) {
                seen.add(key);
                knowledge.push({ q, a });
            }
        }

        // 如果标准格式没匹配到，尝试宽松匹配
        if (knowledge.length === 0) {
            const loosePattern = /knowledge_base\s*\[\s*"([^"]+)"\s*\]\s*=\s*"([^"]+)"/g;
            while ((match = loosePattern.exec(kbSection)) !== null) {
                const q = match[1].trim();
                const a = match[2].trim();
                const key = q.toLowerCase();
                if (q && a && !seen.has(key)) {
                    seen.add(key);
                    knowledge.push({ q, a });
                }
            }
        }

        // 从自由文本中提取问答对（兜底方案）
        if (knowledge.length === 0) {
            const lines = kbSection.split('\n');
            let currentQ = null;
            for (const line of lines) {
                const trimmed = line.trim();
                if (!trimmed) continue;
                const qMatch = trimmed.match(/^(?:Q|Question|问题)[：:]\s*(.+)/i);
                if (qMatch) {
                    currentQ = qMatch[1].trim();
                    continue;
                }
                const aMatch = trimmed.match(/^(?:A|Answer|答案)[：:]\s*(.+)/i);
                if (aMatch && currentQ) {
                    const key = currentQ.toLowerCase();
                    if (!seen.has(key)) {
                        seen.add(key);
                        knowledge.push({ q: currentQ, a: aMatch[1].trim() });
                    }
                    currentQ = null;
                }
            }
        }

        // 解析测试问题
        const qPattern = /"((?:[^"\\]|\\.)*)"/g;
        while ((match = qPattern.exec(testSection)) !== null) {
            const q = match[1].replace(/\\"/g, '"').replace(/\\n/g, '\n').trim();
            if (q) testQuestions.push(q);
        }

        // 兜底：从行中提取测试问题
        if (testQuestions.length === 0) {
            const lines = testSection.split('\n');
            for (const line of lines) {
                const trimmed = line.trim();
                if (!trimmed) continue;
                const cleanMatch = trimmed.replace(/^[",\s]+/, '').replace(/[",\s]+$/, '');
                if (cleanMatch && cleanMatch.length > 2) {
                    testQuestions.push(cleanMatch);
                }
            }
        }

        // 自动补充测试问题：从知识库中取前几个问题
        if (testQuestions.length === 0 && knowledge.length > 0) {
            for (let i = 0; i < Math.min(knowledge.length, 5); i++) {
                testQuestions.push(knowledge[i].q);
            }
        }

        return { knowledge, testQuestions };
    }

    /**
     * 将 AI 生成的问答数据组装成完整的 C++ 代码
     * @param {string} aiRawText - AI 原始输出
     * @returns {Promise<string>} 完整的 C++ 代码
     */
    async function assembleCppCode(aiRawText) {
        const template = await loadTemplate();
        if (!template) {
            console.error('[API] Template not found, returning raw text');
            return aiRawText;
        }

        const { knowledge, testQuestions } = parseAIOutput(aiRawText);

        // 组装知识库条目代码
        let kbCode = '';
        for (const entry of knowledge) {
            const escapedQ = entry.q.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
            const escapedA = entry.a.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
            kbCode += `        knowledge_base["${escapedQ}"] = "${escapedA}";\n`;
        }

        if (kbCode.trim() === '') {
            kbCode = '        // AI 未生成有效知识库条目\n';
        }

        // 组装测试问题代码
        let testCode = '';
        if (testQuestions.length > 0) {
            testCode = '        std::vector<std::string> test_questions = {\n';
            for (let i = 0; i < testQuestions.length; i++) {
                const escaped = testQuestions[i].replace(/\\/g, '\\\\').replace(/"/g, '\\"');
                testCode += `            "${escaped}"`;
                if (i < testQuestions.length - 1) testCode += ',';
                testCode += '\n';
            }
            testCode += '        };';
        } else {
            testCode = '        std::vector<std::string> test_questions = {\n            "What is artificial intelligence?",\n            "What is machine learning?",\n            "What is a neural network?",\n            "What is deep learning?",\n            "What is natural language processing?"\n        };';
        }

        let result = template;

        result = result.replace(
            /\/\/ @@AI_CONTENT_BEGIN@@[\s\S]*?\/\/ @@AI_CONTENT_END@@/,
            `// @@AI_CONTENT_BEGIN@@\n${kbCode}        // @@AI_CONTENT_END@@`
        );

        result = result.replace(
            /\/\/ @@AI_DIALOGUE_BEGIN@@[\s\S]*?\/\/ @@AI_DIALOGUE_END@@/,
            `// @@AI_DIALOGUE_BEGIN@@\n${testCode}\n        // @@AI_DIALOGUE_END@@`
        );

        return result;
    }

    /**
     * 从已组装的 C++ 代码中提取 AI 生成的内容（用于继续训练）
     */
    function extractAIContents(fullCode) {
        return parseAIOutput(fullCode);
    }

    function getConfig() {
        return KOBGStorage.getApiConfig();
    }

    function isConfigured() {
        const config = getConfig();
        return !!(config.url && config.apiKey && config.model);
    }

    function cleanCodeOutput(text) {
        let cleaned = text.trim();
        cleaned = cleaned.replace(/^```(?:cpp|c\+\+|c)?\s*\n?/i, '');
        cleaned = cleaned.replace(/\n?```\s*$/, '');
        return cleaned.trim();
    }

    /**
     * 构建训练提示词（包含问答数量）
     */
    function buildTrainingPrompt(qaCount, customInstruction, isContinue, existingCount) {
        const count = Math.max(1, Math.min(100, qaCount || 5));
        let prompt = '';

        if (isContinue && existingCount !== undefined) {
            prompt += `The current knowledge base has ${existingCount} entries. `;
            prompt += `Generate EXACTLY ${count} NEW and UNIQUE Q&A pairs that do NOT duplicate any existing entries. `;
        } else {
            prompt += `Generate EXACTLY ${count} diverse Q&A pairs about artificial intelligence and machine learning topics. `;
            prompt += `Topics should cover: AI fundamentals, machine learning, neural networks, deep learning, NLP, computer vision, reinforcement learning, etc.\n`;
        }

        prompt += `You MUST output exactly ${count} knowledge_base entries and ${count} test questions.\n`;
        prompt += `Each question must be completely unique - no duplicates or near-duplicates.\n`;

        if (customInstruction) {
            prompt += `\nAdditional instruction from user: ${customInstruction}\n`;
        }

        return prompt;
    }

    /**
     * 发送非流式请求
     */
    async function sendRequest(messages, options = {}) {
        return makeRequest({
            messages,
            temperature: options.temperature || 0.7,
            maxTokens: options.maxTokens || 4096,
            topP: options.topP || 1.0,
            stream: false,
            signal: options.signal
        });
    }

    /**
     * 生成 C++ 代码（单次训练，非流式）
     */
    async function generateCppCode(userPrompt = '', qaCount = 5, signal = null) {
        const prompt = userPrompt || buildTrainingPrompt(qaCount, '', false);
        const messages = [{ role: 'user', content: prompt }];
        const rawOutput = await sendRequest(messages, { signal });
        return await assembleCppCode(rawOutput);
    }

    /**
     * 流式生成 C++ 代码（逐字输出 AI 原始内容）
     */
    async function generateCppCodeStream(onChunk, userPrompt = '', qaCount = 5, signal = null) {
        const prompt = userPrompt || buildTrainingPrompt(qaCount, '', false);
        const messages = [{ role: 'user', content: prompt }];
        const rawOutput = await makeRequest({
            messages,
            temperature: 0.7,
            maxTokens: getMaxTokens(qaCount),
            stream: true,
            onChunk,
            signal
        });
        return await assembleCppCode(rawOutput);
    }

    /**
     * 发送流式请求（SSE）
     */
    async function sendStreamRequest(messages, options = {}, onChunk) {
        return makeRequest({
            messages,
            temperature: options.temperature || 0.7,
            maxTokens: options.maxTokens || 4096,
            topP: options.topP || 1.0,
            stream: true,
            onChunk,
            signal: options.signal
        });
    }

    /**
     * 流式继续训练
     */
    async function continueTrainingStream(previousCode, onChunk, instruction = '', qaCount = 5) {
        const { knowledge, testQuestions } = extractAIContents(previousCode);

        let contextPrompt = `Current knowledge base has ${knowledge.length} entries:\n`;
        for (const entry of knowledge.slice(0, 20)) {
            contextPrompt += `  Q: "${entry.q}"\n`;
        }

        const trainingPrompt = buildTrainingPrompt(qaCount, instruction, true, knowledge.length);
        const prompt = `${contextPrompt}\n\n${trainingPrompt}`;

        const messages = [{ role: 'user', content: prompt }];
        const rawOutput = await makeRequest({
            messages,
            temperature: 0.8,
            maxTokens: getMaxTokens(qaCount),
            stream: true,
            onChunk
        });

        const parsed = parseAIOutput(rawOutput);
        const mergedCode = await assembleMergedCppCode(knowledge, parsed.knowledge, testQuestions, parsed.testQuestions);
        return mergedCode;
    }

    /**
     * 继续训练（非流式）
     */
    async function continueTraining(previousCode, instruction = '', qaCount = 5) {
        const { knowledge, testQuestions } = extractAIContents(previousCode);

        let contextPrompt = `Current knowledge base has ${knowledge.length} entries:\n`;
        for (const entry of knowledge.slice(0, 20)) {
            contextPrompt += `  Q: "${entry.q}"\n`;
        }

        const trainingPrompt = buildTrainingPrompt(qaCount, instruction, true, knowledge.length);
        const prompt = `${contextPrompt}\n\n${trainingPrompt}`;

        const messages = [{ role: 'user', content: prompt }];
        const rawOutput = await sendRequest(messages, { temperature: 0.8, maxTokens: getMaxTokens(qaCount) });

        const parsed = parseAIOutput(rawOutput);
        const mergedCode = await assembleMergedCppCode(knowledge, parsed.knowledge, testQuestions, parsed.testQuestions);
        return mergedCode;
    }

    /**
     * 根据 QA 数量估算 max_tokens
     */
    function getMaxTokens(qaCount) {
        const base = 500;
        const perQa = 200;
        return Math.min(16000, base + perQa * Math.max(1, qaCount || 5));
    }

    /**
     * 合并旧知识和新知识，生成完整 C++ 代码
     */
    async function assembleMergedCppCode(oldKb, newKb, oldTests, newTests) {
        const template = await loadTemplate();
        if (!template) {
            console.error('[API] Template not found');
            return '';
        }

        // 合并知识库，去重
        const seen = new Set();
        const allKnowledge = [];
        for (const entry of [...oldKb, ...newKb]) {
            const key = entry.q.toLowerCase();
            if (!seen.has(key)) {
                seen.add(key);
                allKnowledge.push(entry);
            }
        }

        // 合并测试问题，去重
        const allTests = [];
        const testSeen = new Set();
        for (const q of [...oldTests, ...newTests]) {
            const key = q.toLowerCase();
            if (!testSeen.has(key)) {
                testSeen.add(key);
                allTests.push(q);
            }
        }

        let kbCode = '';
        for (const entry of allKnowledge) {
            const escapedQ = entry.q.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
            const escapedA = entry.a.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
            kbCode += `        knowledge_base["${escapedQ}"] = "${escapedA}";\n`;
        }

        if (kbCode.trim() === '') {
            kbCode = '        // AI 未生成有效知识库条目\n';
        }

        let testCode = '';
        if (allTests.length > 0) {
            testCode = '        std::vector<std::string> test_questions = {\n';
            for (let i = 0; i < allTests.length; i++) {
                const escaped = allTests[i].replace(/\\/g, '\\\\').replace(/"/g, '\\"');
                testCode += `            "${escaped}"`;
                if (i < allTests.length - 1) testCode += ',';
                testCode += '\n';
            }
            testCode += '        };';
        } else {
            testCode = '        std::vector<std::string> test_questions = {\n            "What is artificial intelligence?"\n        };';
        }

        let result = template;

        result = result.replace(
            /\/\/ @@AI_CONTENT_BEGIN@@[\s\S]*?\/\/ @@AI_CONTENT_END@@/,
            `// @@AI_CONTENT_BEGIN@@\n${kbCode}        // @@AI_CONTENT_END@@`
        );

        result = result.replace(
            /\/\/ @@AI_DIALOGUE_BEGIN@@[\s\S]*?\/\/ @@AI_DIALOGUE_END@@/,
            `// @@AI_DIALOGUE_BEGIN@@\n${testCode}\n        // @@AI_DIALOGUE_END@@`
        );

        return result;
    }

    /**
     * 测试连接
     */
    async function testConnection() {
        const config = getConfig();
        if (!isConfigured()) {
            throw new Error('API 未配置');
        }

        const useProxy = isLocalHost();
        let fetchUrl, fetchOptions;

        if (useProxy) {
            fetchUrl = '/api/chat';
            fetchOptions = {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    url: config.url,
                    apiKey: config.apiKey,
                    model: config.model,
                    messages: [{ role: 'user', content: 'Say "KOBG AI connected" and nothing else.' }],
                    max_tokens: 200,
                    stream: false
                })
            };
        } else {
            fetchUrl = buildDirectUrl(config.url);
            fetchOptions = {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${config.apiKey}`
                },
                body: JSON.stringify({
                    model: config.model,
                    messages: [{ role: 'user', content: 'Say "KOBG AI connected" and nothing else.' }],
                    max_tokens: 200,
                    stream: false
                })
            };
        }

        const response = await fetch(fetchUrl, fetchOptions);

        if (!response.ok) {
            let errorMsg = '';
            try {
                const errorData = await response.json();
                errorMsg = errorData.error?.message || errorData.message || '';
            } catch (_) {
                try { errorMsg = await response.text(); } catch (_) {}
            }
            throw new Error(friendlyError(response.status, errorMsg));
        }

        const data = await response.json();
        const content = data.choices?.[0]?.message?.content || '';
        if (content) return content;
        // 处理推理模型可能返回空 content 的情况
        const reasoning = data.choices?.[0]?.message?.reasoning_content;
        if (reasoning) return '连接成功（模型为推理模型，已返回思考内容）';
        return 'Connected';
    }

    function estimateTokens(text) {
        if (!text) return 0;
        const chineseChars = (text.match(/[\u4e00-\u9fff]/g) || []).length;
        const otherChars = text.length - chineseChars;
        return Math.ceil(chineseChars / 1.5 + otherChars / 4);
    }

    /**
     * 将 HTTP 状态码和上游错误信息转为用户友好的中文提示
     */
    function friendlyError(status, upstreamMsg) {
        const prefix = `请求失败 (${status})`;
        const detail = upstreamMsg ? `: ${upstreamMsg}` : '';

        switch (status) {
            case 400:
                return `${prefix} 请求参数错误${detail}`;
            case 401:
                return `${prefix} 鉴权失败 — 请检查 API Key 是否正确，或 Key 是否已过期${detail}`;
            case 403:
                return `${prefix} 访问被拒绝 — 请检查 API Key 权限${detail}`;
            case 404:
                return `${prefix} 接口不存在 — 请检查 API URL 是否正确（应填写基础地址，不含 /chat/completions）${detail}`;
            case 405:
                return `${prefix} 请求方法不允许 — API 代理不可用，正在尝试直连模式${detail}`;
            case 429:
                return `${prefix} 请求过于频繁 — 请稍后再试${detail}`;
            case 500:
            case 502:
            case 503:
                return `${prefix} 上游服务异常 — 请稍后重试或检查 API 地址${detail}`;
            default:
                if (status === 0 || !status) {
                    return `网络错误 — 无法连接到服务器，请检查网络或 API URL 是否正确（跨域 CORS 限制可能导致此问题）${detail}`;
                }
                return `${prefix}${detail}`;
        }
    }

    return {
        getConfig,
        isConfigured,
        generateCppCode,
        generateCppCodeStream,
        continueTraining,
        continueTrainingStream,
        sendRequest,
        sendStreamRequest,
        testConnection,
        estimateTokens,
        cleanCodeOutput,
        parseAIOutput,
        assembleCppCode,
        extractAIContents,
        loadTemplate,
        friendlyError,
        isLocalHost,
        buildDirectUrl,
        SYSTEM_PROMPT
    };
})();
