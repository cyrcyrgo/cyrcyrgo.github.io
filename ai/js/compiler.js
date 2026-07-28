/* ============================================================
   KOBG AI - compiler.js - C++ 编译器/解释器
   在浏览器中模拟 C++ 代码的编译和执行
   使用 Web Worker 实现不阻塞主线程
   ============================================================ */

const KOBGCompiler = (() => {
    let worker = null;
    let compileCallbacks = new Map();
    let callbackId = 0;

    /**
     * 初始化 Web Worker
     */
    function initWorker() {
        if (worker) return;

        // 创建内联 Worker
        const workerCode = `
            // C++ 代码解释器 (Worker)
            self.onmessage = function(e) {
                const { id, code } = e.data;
                try {
                    const result = interpretCpp(code);
                    self.postMessage({ id, success: true, output: result.output, errors: result.errors });
                } catch (err) {
                    self.postMessage({ id, success: false, output: '', errors: [err.message || String(err)] });
                }
            };

            function interpretCpp(code) {
                let output = '';
                let errors = [];
                const lines = code.split('\\n');

                // 检查基本语法
                let braceCount = 0;
                let parenCount = 0;
                let inString = false;
                let inComment = false;
                let inLineComment = false;

                for (let i = 0; i < lines.length; i++) {
                    const line = lines[i];
                    for (let j = 0; j < line.length; j++) {
                        const ch = line[j];
                        const next = line[j + 1] || '';

                        if (inLineComment) continue;
                        if (inComment) {
                            if (ch === '*' && next === '/') { inComment = false; j++; }
                            continue;
                        }
                        if (ch === '/' && next === '/') { inLineComment = true; j++; continue; }
                        if (ch === '/' && next === '*') { inComment = true; j++; continue; }
                        if (ch === '"' && (j === 0 || line[j-1] !== '\\\\')) { inString = !inString; }
                        if (inString) continue;

                        if (ch === '{') braceCount++;
                        if (ch === '}') braceCount--;
                        if (ch === '(') parenCount++;
                        if (ch === ')') parenCount--;
                    }
                    inLineComment = false;
                }

                if (braceCount !== 0) {
                    errors.push('Syntax error: Unmatched braces (' + braceCount + ' extra ' + (braceCount > 0 ? '{' : '}') + ')');
                }
                if (parenCount !== 0) {
                    errors.push('Syntax error: Unmatched parentheses');
                }

                // 模拟执行输出
                output += '\\n';
                output += '  ╔══════════════════════════════════════╗\\n';
                output += '  ║     KOBG AI 强化式训练系统 v1.0      ║\\n';
                output += '  ║   C++ Native AI Training Framework   ║\\n';
                output += '  ╚══════════════════════════════════════╝\\n';
                output += '\\n';

                // 提取知识库内容
                const kbPattern = /knowledge_base\\[\\s*"([^"]+)"\\s*\\]\\s*=\\s*"([^"]+)"/g;
                let match;
                let kbEntries = [];
                while ((match = kbPattern.exec(code)) !== null) {
                    kbEntries.push({ q: match[1], a: match[2] });
                }

                // 也支持多行字符串
                const kbMultiPattern = /knowledge_base\\[\\s*"([^"]+)"\\s*\\]\\s*=\\s*\\n?\\s*"([\\s\\S]*?)";/g;
                while ((match = kbMultiPattern.exec(code)) !== null) {
                    kbEntries.push({ q: match[1], a: match[2].replace(/\\n/g, ' ').replace(/\\s+/g, ' ').trim() });
                }

                // 提取测试问题
                const testPattern = /test_questions[^}]*\\{([^}]*)\\}/g;
                let testMatch;
                let testQuestions = [];
                while ((testMatch = testPattern.exec(code)) !== null) {
                    const qPattern = /"([^"]+)"/g;
                    let qMatch;
                    while ((qMatch = qPattern.exec(testMatch[1])) !== null) {
                        testQuestions.push(qMatch[1]);
                    }
                }

                if (kbEntries.length === 0) {
                    output += '[编译器] 警告：未检测到知识库条目\\n';
                }

                if (testQuestions.length === 0) {
                    output += '[编译器] 警告：未检测到测试问题\\n';
                }

                output += '========================================\\n';
                output += '   KOBG AI 对话系统启动\\n';
                output += '========================================\\n';
                output += '\\n';

                // 模拟对话
                for (const question of testQuestions) {
                    output += '用户: ' + question + '\\n';
                    
                    let answer = null;
                    // 精确匹配
                    for (const entry of kbEntries) {
                        if (entry.q === question) {
                            answer = entry.a;
                            break;
                        }
                    }
                    // 模糊匹配
                    if (!answer) {
                        for (const entry of kbEntries) {
                            const qLower = question.toLowerCase();
                            const eLower = entry.q.toLowerCase();
                            const qWords = qLower.split(/\\s+/);
                            const eWords = eLower.split(/\\s+/);
                            let matches = 0;
                            for (const w of qWords) {
                                if (eWords.includes(w)) matches++;
                            }
                            const score = matches / Math.max(qWords.length, eWords.length);
                            if (score > 0.3) {
                                answer = '[模糊匹配 置信度: ' + score.toFixed(2) + '] ' + entry.a;
                                break;
                            }
                        }
                    }

                    if (answer) {
                        const shortAnswer = answer.length > 100 ? answer.substring(0, 100) + '...' : answer;
                        output += 'AI: ' + shortAnswer + '\\n';
                    } else {
                        output += 'AI: 我还没有学习到这个问题的答案，请继续训练我。\\n';
                    }
                    output += '----------------------------------------\\n';
                }

                output += '\\n';
                output += '========================================\\n';
                output += '   训练统计\\n';
                output += '========================================\\n';
                output += '  总对话轮次: ' + testQuestions.length + '\\n';
                output += '  训练轮次: ' + kbEntries.length + '\\n';
                output += '  知识库大小: ' + kbEntries.length + '\\n';
                output += '========================================\\n';
                output += '\\n';
                output += '  [KOBG AI] 训练完成！\\n';
                output += '\\n';

                return { output, errors };
            }
        `;

        const blob = new Blob([workerCode], { type: 'application/javascript' });
        worker = new Worker(URL.createObjectURL(blob));
        
        worker.onmessage = function(e) {
            const { id, success, output, errors } = e.data;
            const cb = compileCallbacks.get(id);
            if (cb) {
                compileCallbacks.delete(id);
                cb(success, output, errors);
            }
        };

        worker.onerror = function(e) {
            console.error('[Compiler Worker] Error:', e);
        };
    }

    /**
     * 编译 C++ 代码（优先使用后端真实编译，失败时回退到浏览器解释器）
     * @param {string} code - C++ 源代码
     * @returns {Promise<{success: boolean, output: string, errors: string[]}>}
     */
    async function compile(code) {
        try {
            const result = await compileViaBackend(code);
            return result;
        } catch (backendError) {
            console.warn('[Compiler] 后端编译失败，回退到浏览器解释器:', backendError.message);
            return compileViaWorker(code);
        }
    }

    /**
     * 通过后端 API 进行真实 C++ 编译
     */
    async function compileViaBackend(code) {
        const response = await fetch('/api/compile', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ code })
        });

        if (!response.ok) {
            throw new Error(`后端编译服务错误 (${response.status})`);
        }

        const data = await response.json();

        if (data.success) {
            return {
                success: true,
                output: data.output,
                errors: []
            };
        } else {
            return {
                success: false,
                output: data.output || '',
                errors: data.errors || ['编译失败']
            };
        }
    }

    /**
     * 检测后端编译服务是否可用
     */
    async function isBackendAvailable() {
        try {
            const response = await fetch('/api/health');
            return response.ok;
        } catch {
            return false;
        }
    }

    /**
     * 通过 Web Worker 浏览器解释器编译（回退方案）
     */
    function compileViaWorker(code) {
        return new Promise((resolve) => {
            initWorker();
            const id = ++callbackId;
            compileCallbacks.set(id, (success, output, errors) => {
                resolve({ success, output, errors });
            });
            worker.postMessage({ id, code });
        });
    }

    /**
     * 同步编译（用于简单场景）
     */
    function compileSync(code) {
        let output = '';
        let errors = [];

        // 基本语法检查
        let braceCount = 0;
        let parenCount = 0;
        let inString = false;

        for (const ch of code) {
            if (ch === '"') inString = !inString;
            if (inString) continue;
            if (ch === '{') braceCount++;
            if (ch === '}') braceCount--;
            if (ch === '(') parenCount++;
            if (ch === ')') parenCount--;
        }

        if (braceCount !== 0) {
            errors.push(`Syntax error: Unmatched braces (${braceCount > 0 ? '+' + braceCount : braceCount})`);
        }
        if (parenCount !== 0) {
            errors.push('Syntax error: Unmatched parentheses');
        }

        return { success: errors.length === 0, output, errors };
    }

    /**
     * 分析代码质量
     */
    function analyzeCode(code) {
        const analysis = {
            lines: code.split('\n').length,
            chars: code.length,
            hasMain: /int\s+main\s*\(/.test(code),
            hasClass: /class\s+\w+/.test(code),
            hasIncludes: /#include/.test(code),
            kbEntries: (code.match(/knowledge_base\s*\[/g) || []).length,
            testQuestions: (code.match(/test_questions/g) || []).length,
            estimatedTokens: Math.ceil(code.length / 4)
        };
        return analysis;
    }

    /**
     * 销毁 Worker
     */
    function destroy() {
        if (worker) {
            worker.terminate();
            worker = null;
        }
    }

    return {
        compile,
        compileViaBackend,
        compileViaWorker,
        isBackendAvailable,
        compileSync,
        analyzeCode,
        destroy
    };
})();