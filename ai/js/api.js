/* ============================================================
   KOBG AI - api.js - LLM API 通信模块
   负责与用户配置的大模型 API 进行通信
   ============================================================ */

const KOBGAPI = (() => {
    // 系统提示词：要求 AI 严格按格式输出 C++ 代码
    const SYSTEM_PROMPT = `You are a C++ code generator for the KOBG AI Training Framework. 
Your task is to generate C++ code that simulates an AI dialogue system.

CRITICAL RULES - YOU MUST FOLLOW:
1. Output ONLY valid, compilable C++ code. 
2. Do NOT include any markdown formatting, code blocks, explanations, or any text that is not C++ code.
3. Your entire response must be raw C++ code that can be directly compiled.
4. The code must follow the KOBG framework structure exactly.

FRAMEWORK STRUCTURE:
- Include standard headers (iostream, string, vector, map, cmath, algorithm, sstream)
- Define a KOBGModel class with:
  - knowledge_base (map<string,string>)
  - training_history (vector<pair<string,string>>)
  - train() method
  - predict() method with fuzzy matching
  - calculateSimilarity() method
  - showKnowledgeBase() method
- Define an AIDialogueSystem class with:
  - KOBGModel instance
  - runDialogue() method with test questions
  - showStatistics() method
- main() function that runs the dialogue system

REQUIRED CONTENT:
- Fill knowledge_base with at least 5 Q&A pairs about AI/ML topics
- Provide at least 5 test questions in runDialogue()
- The code must be complete and compilable

REMEMBER: Output ONLY the C++ code. No markdown. No explanations. No backticks. Just raw C++ source code.`;

    function getConfig() {
        return KOBGStorage.getApiConfig();
    }

    function isConfigured() {
        const config = getConfig();
        return !!(config.url && config.apiKey && config.model);
    }

    function getHeaders() {
        const config = getConfig();
        return {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${config.apiKey}`
        };
    }

    /**
     * 构建请求体（兼容 OpenAI API 格式）
     */
    function buildRequestBody(messages, options = {}) {
        const config = getConfig();
        const allMessages = [
            { role: 'system', content: SYSTEM_PROMPT },
            ...messages
        ];

        return {
            model: config.model,
            messages: allMessages,
            temperature: options.temperature || 0.7,
            max_tokens: options.maxTokens || 4096,
            top_p: options.topP || 1.0,
            stream: false
        };
    }

    /**
     * 发送 API 请求
     */
    async function sendRequest(messages, options = {}) {
        const config = getConfig();
        if (!isConfigured()) {
            throw new Error('API 未配置，请先填写 API 接口信息');
        }

        const body = buildRequestBody(messages, options);
        const url = config.url.replace(/\/+$/, '') + '/chat/completions';

        const response = await fetch(url, {
            method: 'POST',
            headers: getHeaders(),
            body: JSON.stringify(body)
        });

        if (!response.ok) {
            const errorText = await response.text();
            let errorMsg;
            try {
                const errJson = JSON.parse(errorText);
                errorMsg = errJson.error?.message || errorText;
            } catch {
                errorMsg = errorText;
            }
            throw new Error(`API 请求失败 (${response.status}): ${errorMsg}`);
        }

        const data = await response.json();
        
        // 提取 token 用量
        const usage = data.usage || {};
        const inputTokens = usage.prompt_tokens || 0;
        const outputTokens = usage.completion_tokens || 0;
        KOBGStorage.updateTokenUsage(inputTokens, outputTokens);

        const content = data.choices?.[0]?.message?.content || '';
        
        // 清理 AI 返回的内容：移除可能的 markdown 代码块标记
        return cleanCodeOutput(content);
    }

    /**
     * 清理 AI 输出中的 markdown 标记
     */
    function cleanCodeOutput(text) {
        let cleaned = text.trim();
        // 移除开头的 ```cpp 或 ``` 标记
        cleaned = cleaned.replace(/^```(?:cpp|c\+\+|c)?\s*\n?/i, '');
        // 移除结尾的 ``` 标记
        cleaned = cleaned.replace(/\n?```\s*$/, '');
        return cleaned.trim();
    }

    /**
     * 生成 C++ 代码（单次训练）
     */
    async function generateCppCode(userPrompt = '') {
        const defaultPrompt = 'Generate a complete C++ AI dialogue system following the KOBG framework. Include diverse Q&A pairs about AI and machine learning topics.';

        const messages = [
            {
                role: 'user',
                content: userPrompt || defaultPrompt
            }
        ];

        return await sendRequest(messages);
    }

    /**
     * 继续训练：在上一次代码基础上改进
     */
    async function continueTraining(previousCode, instruction = '') {
        const prompt = instruction || 'Improve the KOBG AI model by adding more diverse Q&A pairs and better test questions. Output the complete updated C++ code.';

        const messages = [
            {
                role: 'user',
                content: `Previous C++ code:\n${previousCode}\n\n${instruction}`
            }
        ];

        return await sendRequest(messages, { temperature: 0.8 });
    }

    /**
     * 测试 API 连接
     */
    async function testConnection() {
        const config = getConfig();
        if (!isConfigured()) {
            throw new Error('API 未配置');
        }

        const body = {
            model: config.model,
            messages: [{ role: 'user', content: 'Say "KOBG AI connected" and nothing else.' }],
            max_tokens: 50
        };

        const url = config.url.replace(/\/+$/, '') + '/chat/completions';

        const response = await fetch(url, {
            method: 'POST',
            headers: getHeaders(),
            body: JSON.stringify(body)
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`连接失败 (${response.status}): ${errorText}`);
        }

        const data = await response.json();
        return data.choices?.[0]?.message?.content || 'Connected';
    }

    /**
     * 估算 token 数量（简单估算：英文约 4 字符/token，中文约 1.5 字符/token）
     */
    function estimateTokens(text) {
        if (!text) return 0;
        const chineseChars = (text.match(/[\u4e00-\u9fff]/g) || []).length;
        const otherChars = text.length - chineseChars;
        return Math.ceil(chineseChars / 1.5 + otherChars / 4);
    }

    return {
        getConfig,
        isConfigured,
        generateCppCode,
        continueTraining,
        testConnection,
        estimateTokens,
        cleanCodeOutput,
        SYSTEM_PROMPT
    };
})();