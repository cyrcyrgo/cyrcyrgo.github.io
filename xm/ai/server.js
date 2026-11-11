const express = require('express');
const cors = require('cors');
const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const https = require('https');
const http = require('http');
const { URL } = require('url');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;
const TMP_DIR = path.join(os.tmpdir(), 'forge-ai-compiler');

/* ---------------------------------------------------------------------------
   安全加固（原实现把「编译并执行任意 C++ 代码」无鉴权暴露在 0.0.0.0 上，
   等同于给全网开放了一个远程代码执行接口）：
   1) 默认只监听 127.0.0.1，不对外暴露；
   2) 访问 /api/* 需要令牌（FORGE_API_TOKEN），未设置令牌时只允许本机回环访问；
   3) 静态目录不再整目录暴露（原来 server.js / node_modules 都能被下载）；
   4) 上游 LLM 地址走白名单，阻止 SSRF 打内网与云元数据。
   --------------------------------------------------------------------------- */

// 1) 监听地址：默认回环
const HOST = process.env.HOST || '127.0.0.1';

// 2) API 令牌：设置后所有 /api/* 必须携带
const API_TOKEN = process.env.FORGE_API_TOKEN || '';

// 3) 允许对外提供的静态文件后缀
const STATIC_EXT = new Set([
    '.html', '.htm', '.js', '.mjs', '.css', '.json', '.svg', '.png', '.jpg',
    '.jpeg', '.gif', '.ico', '.woff', '.woff2', '.ttf', '.map', '.txt', '.md',
]);
// 永远不通过静态目录暴露的路径前缀
const STATIC_DENY = /(^|\/)(node_modules|server\.js|package(-lock)?\.json|\.git|\.env)(\/|$)/i;

// 4) 允许的 LLM 上游域名（可经 FORGE_ALLOWED_HOSTS 逗号分隔扩展）
const DEFAULT_ALLOWED_HOSTS = [
    'api.openai.com',
    'api.deepseek.com',
    'dashscope.aliyuncs.com',
    'ark.cn-beijing.volces.com',
    'open.bigmodel.cn',
    'api.moonshot.cn',
    'api.siliconflow.cn',
    'api.zhipuai.cn',
    'generativelanguage.googleapis.com',
    'api.anthropic.com',
    'localhost',
    '127.0.0.1',
];
const ALLOWED_HOSTS = new Set(
    (process.env.FORGE_ALLOWED_HOSTS || '')
        .split(',')
        .map(s => s.trim().toLowerCase())
        .filter(Boolean)
        .concat(DEFAULT_ALLOWED_HOSTS)
);

function isPrivateHost(hostname) {
    const h = hostname.toLowerCase();
    if (h === 'localhost' || h === '::1') return true;
    const m = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
    if (!m) return false;
    const [a, b] = [Number(m[1]), Number(m[2])];
    if (a === 10 || a === 127 || a === 0) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 169 && b === 254) return true;   // 云元数据 169.254.169.254
    if (a === 100 && b >= 64 && b <= 127) return true;
    return false;
}

/** 校验上游 URL：必须是 http(s)，host 在白名单内，且不是内网地址 */
function assertUpstreamAllowed(rawUrl) {
    let u;
    try {
        u = new URL(rawUrl);
    } catch (_) {
        return '上游地址不是合法的 URL';
    }
    if (u.protocol !== 'https:' && u.protocol !== 'http:') {
        return '仅允许 http/https 上游地址';
    }
    const host = u.hostname.toLowerCase();
    if (isPrivateHost(host)) {
        return `拒绝访问内网地址 ${host}（SSRF 防护）`;
    }
    if (!ALLOWED_HOSTS.has(host)) {
        return `上游域名 ${host} 不在允许列表中，请通过 FORGE_ALLOWED_HOSTS 添加`;
    }
    return null;
}

// 只允许本机访问，或持有正确令牌的访问
function apiGuard(req, res, next) {
    const ip = (req.ip || req.socket?.remoteAddress || '').replace('::ffff:', '');
    const isLoopback = ip === '127.0.0.1' || ip === '::1' || ip === '';
    // CORS 不是 CSRF 防护：浏览器仍会把跨站 POST 发到 localhost。
    // 拒绝未知 Origin，避免恶意网页借用户浏览器调用本机编译执行接口。
    const origin = req.get('origin');
    const allowedOrigin = process.env.FORGE_ALLOWED_ORIGIN || `http://${HOST}:${PORT}`;
    if (origin && origin !== allowedOrigin && origin !== `http://localhost:${PORT}` &&
        origin !== `http://127.0.0.1:${PORT}`) {
        return res.status(403).json({ error: '请求来源未被允许' });
    }
    if (API_TOKEN) {
        const sent = (req.get('authorization') || '').replace(/^Bearer\s+/i, '')
            || req.get('x-api-key') || '';
        if (!sent || sent.length !== API_TOKEN.length ||
            !crypto.timingSafeEqual(Buffer.from(sent), Buffer.from(API_TOKEN))) {
            return res.status(401).json({ error: '未提供有效访问令牌' });
        }
        return next();
    }
    if (!isLoopback) {
        return res.status(403).json({
            error: '未设置 FORGE_API_TOKEN，服务仅允许本机访问。'
        });
    }
    next();
}

// 静态资源：先拒绝敏感路径，再按后缀放行（原来是整目录 express.static）
app.use((req, res, next) => {
    // API 路由由后面的 apiGuard 处理；不能按静态文件后缀拦掉 /api/compile 等接口。
    if (req.path === '/api' || req.path.startsWith('/api/')) return next();
    let rel;
    try {
        rel = decodeURIComponent(req.path.replace(/^\/+/, ''));
    } catch (_) {
        return res.status(400).end('Bad request');
    }
    if (!rel || rel.endsWith('/')) return next();
    if (STATIC_DENY.test(rel)) return res.status(403).end('Forbidden');
    if (!STATIC_EXT.has(path.extname(rel).toLowerCase())) {
        return res.status(403).end('Forbidden');
    }
    return next();
});

app.use(cors({ origin: API_TOKEN ? true : 'http://localhost:' + PORT }));
app.use(express.json({ limit: '10mb' }));
app.use(express.static(__dirname, { index: 'index.html', dotfiles: 'deny' }));
app.use('/api', apiGuard);

if (!fs.existsSync(TMP_DIR)) {
    fs.mkdirSync(TMP_DIR, { recursive: true });
}

function genId() {
    return crypto.randomUUID();
}

app.get('/api/health', (req, res) => {
    res.json({
        status: 'ok',
        uptime: process.uptime(),
        platform: process.platform,
        node: process.version,
        compiler: 'g++'
    });
});

app.post('/api/compile', async (req, res) => {
    const { code, stdin = '' } = req.body;

    if (!code || typeof code !== 'string') {
        return res.status(400).json({ error: '缺少 code 参数' });
    }

    const id = genId();
    const srcFile = path.join(TMP_DIR, `${id}.cpp`);
    const outFile = path.join(TMP_DIR, `${id}`);

    try {
        fs.writeFileSync(srcFile, code, 'utf-8');

        await new Promise((resolve, reject) => {
            execFile('g++', ['-std=c++17', '-O2', '-Wall', '-o', outFile, srcFile], {
                timeout: 15000,
                maxBuffer: 10 * 1024 * 1024
            }, (error, stdout, stderr) => {
                if (error) {
                    reject({ error, stdout, stderr });
                } else {
                    resolve({ stdout, stderr });
                }
            });
        });

        let output = '';
        if (fs.existsSync(outFile)) {
            output = await new Promise((resolve) => {
                execFile(outFile, [], {
                    timeout: 10000,
                    maxBuffer: 10 * 1024 * 1024
                }, (error, stdout, stderr) => {
                    resolve((error ? `[运行错误] ${error.message}\n` : '') + stdout + (stderr ? `\n[stderr]\n${stderr}` : ''));
                });
            });
        }

        res.json({
            success: true,
            compileId: id,
            output: output
        });
    } catch (result) {
        const stderr = result.stderr || result.error?.message || '';
        res.json({
            success: false,
            compileId: id,
            errors: stderr.split('\n').filter(l => l.trim()),
            output: result.stdout || ''
        });
    } finally {
        try { fs.unlinkSync(srcFile); } catch (_) {}
        try { fs.unlinkSync(outFile); } catch (_) {}
    }
});

app.post('/api/analyze', async (req, res) => {
    const { code } = req.body;

    if (!code) {
        return res.status(400).json({ error: '缺少 code 参数' });
    }

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

    res.json(analysis);
});

// ============================================================
//  模型测试：编译模型并回答指定问题
// ============================================================
app.post('/api/test', async (req, res) => {
    const { code, question } = req.body;

    if (!code || !question) {
        return res.status(400).json({ error: '缺少 code 或 question 参数' });
    }

    const id = genId();
    const srcFile = path.join(TMP_DIR, `${id}_test.cpp`);
    const outFile = path.join(TMP_DIR, `${id}_test`);

    try {
        // 从模型代码中提取核心类（去掉 main 函数）
        const modelCode = extractModelCore(code);

        // 生成测试程序
        const testProgram = `#include <iostream>
#include <string>
#include <sstream>
${modelCode}

int main(int argc, char* argv[]) {
    if (argc < 2) {
        std::cout << "Error: No question provided" << std::endl;
        return 1;
    }
    std::string question = argv[1];
    // 转义命令行参数中的特殊字符
    for (char& c : question) {
        if (c == '_') c = ' ';
    }
    
    ForgeModel model("Test-Model");
    std::string answer = model.predict(question);
    std::cout << "ANSWER_START" << std::endl;
    std::cout << answer << std::endl;
    std::cout << "ANSWER_END" << std::endl;
    return 0;
}`;

        fs.writeFileSync(srcFile, testProgram, 'utf-8');

        await new Promise((resolve, reject) => {
            execFile('g++', ['-std=c++17', '-O2', '-Wall', '-o', outFile, srcFile], {
                timeout: 15000,
                maxBuffer: 10 * 1024 * 1024
            }, (error, stdout, stderr) => {
                if (error) {
                    reject({ error, stdout, stderr });
                } else {
                    resolve({ stdout, stderr });
                }
            });
        });

        // 将问题中的空格替换为下划线作为命令行参数
        const safeQuestion = question.replace(/ /g, '_').replace(/"/g, '\\"');
        
        let output = '';
        if (fs.existsSync(outFile)) {
            output = await new Promise((resolve) => {
                execFile(outFile, [safeQuestion], {
                    timeout: 10000,
                    maxBuffer: 10 * 1024 * 1024
                }, (error, stdout, stderr) => {
                    resolve((error ? `[运行错误] ${error.message}\n` : '') + stdout + (stderr ? `\n[stderr]\n${stderr}` : ''));
                });
            });
        }

        // 解析 ANSWER_START ... ANSWER_END 之间的内容
        let answer = '';
        const match = output.match(/ANSWER_START\s*\n([\s\S]*?)\nANSWER_END/);
        if (match) {
            answer = match[1].trim();
        } else {
            answer = output.trim();
        }

        res.json({
            success: true,
            answer: answer,
            rawOutput: output
        });
    } catch (result) {
        const stderr = result.stderr || result.error?.message || '';
        res.json({
            success: false,
            answer: null,
            errors: stderr.split('\n').filter(l => l.trim())
        });
    } finally {
        try { fs.unlinkSync(srcFile); } catch (_) {}
        try { fs.unlinkSync(outFile); } catch (_) {}
    }
});

/**
 * 从完整 C++ 代码中提取模型核心（去除 main 函数，保留类定义）
 */
function extractModelCore(code) {
    // 移除 main 函数
    let result = code.replace(/int\s+main\s*\([^)]*\)\s*\{[\s\S]*?\n\}/g, '');
    
    // 移除 AIDialogueSystem 类（只保留 ForgeModel）
    // 先尝试提取 ForgeModel 类
    const classMatch = result.match(/class\s+ForgeModel\s*\{[\s\S]*?\n\s*\};/);
    const includesMatch = result.match(/(?:#include\s*<[^>]+>\s*)+/);
    
    let extracted = '';
    if (includesMatch) extracted += includesMatch[0] + '\n';
    if (classMatch) extracted += '\n' + classMatch[0] + '\n';
    
    if (!extracted.trim()) {
        // 如果提取失败，返回原始代码（去掉main）
        return code.replace(/int\s+main\s*\([^)]*\)\s*\{[\s\S]*?\n\}/g, '');
    }
    
    return extracted;
}

// ============================================================
//  导出模型：编译为二进制可执行文件
// ============================================================
app.post('/api/export', async (req, res) => {
    const { code } = req.body;

    if (!code || typeof code !== 'string') {
        return res.status(400).json({ error: '缺少 code 参数' });
    }

    const id = genId();
    const srcFile = path.join(TMP_DIR, `${id}.cpp`);
    const outFile = path.join(TMP_DIR, `${id}.exe`);

    try {
        fs.writeFileSync(srcFile, code, 'utf-8');

        await new Promise((resolve, reject) => {
            execFile('g++', [
                '-std=c++17', '-O2', '-Wall', '-static-libgcc', '-static-libstdc++',
                '-o', outFile, srcFile
            ], {
                timeout: 30000,
                maxBuffer: 10 * 1024 * 1024
            }, (error, stdout, stderr) => {
                if (error) {
                    reject({ error, stderr });
                } else {
                    resolve({ stdout, stderr });
                }
            });
        });

        if (!fs.existsSync(outFile)) {
            return res.status(500).json({ error: '编译产物不存在' });
        }

        const stats = fs.statSync(outFile);
        const filename = `forge-ai-model-${id}.exe`;

        res.setHeader('Content-Type', 'application/octet-stream');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.setHeader('Content-Length', stats.size);
        res.setHeader('X-Compile-Id', id);
        res.setHeader('X-File-Size', stats.size);

        const readStream = fs.createReadStream(outFile);
        readStream.pipe(res);

        readStream.on('end', () => {
            try { fs.unlinkSync(srcFile); } catch (_) {}
            try { fs.unlinkSync(outFile); } catch (_) {}
        });

        readStream.on('error', () => {
            try { fs.unlinkSync(srcFile); } catch (_) {}
            try { fs.unlinkSync(outFile); } catch (_) {}
        });

    } catch (result) {
        try { fs.unlinkSync(srcFile); } catch (_) {}
        try { fs.unlinkSync(outFile); } catch (_) {}

        const stderr = result.stderr || result.error?.message || '';
        res.status(400).json({
            success: false,
            errors: stderr.split('\n').filter(l => l.trim())
        });
    }
});

// ============================================================
//  LLM API 代理（绕过浏览器 CORS 限制）
// ============================================================

// 处理 OPTIONS 预检请求，避免 405
app.options('/api/chat', (req, res) => {
    res.setHeader('Allow', 'POST, OPTIONS');
    res.status(204).end();
});

// GET 请求返回友好提示
app.get('/api/chat', (req, res) => {
    res.status(405).json({
        error: { message: '请使用 POST 方法请求此端点' },
        hint: '此端点仅接受 POST 请求，用于转发 LLM API 调用'
    });
});

app.post('/api/chat', async (req, res) => {
    const { url, apiKey, model, messages, temperature, max_tokens, top_p, stream } = req.body;

    if (!url || !apiKey || !model || !messages) {
        return res.status(400).json({
            error: { message: '缺少必要参数: url, apiKey, model, messages' }
        });
    }

    // SSRF 防护：该端点原本会把任意 URL 的响应原样回传，可被用来探测内网与云元数据
    const denyReason = assertUpstreamAllowed(url);
    if (denyReason) {
        return res.status(400).json({ error: { message: denyReason } });
    }

    const apiUrl = url.replace(/\/+$/, '') + '/chat/completions';

    const body = {
        model,
        messages,
        temperature: temperature || 0.7,
        max_tokens: max_tokens || 4096,
        top_p: top_p || 1.0,
        stream: stream || false
    };

    try {
        const response = await fetch(apiUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`
            },
            body: JSON.stringify(body)
        });

        if (!response.ok) {
            const errorText = await response.text();
            let userMessage = `上游 API 返回错误 (${response.status})`;

            // 尝试解析上游 JSON 错误，提取可读信息
            try {
                const errJson = JSON.parse(errorText);
                if (errJson.error?.message) {
                    userMessage = errJson.error.message;
                }
            } catch (_) {
                // 非 JSON 响应，截取前 200 字符
                if (errorText.length > 0) {
                    userMessage = errorText.substring(0, 200);
                }
            }

            console.error(`[Proxy] Upstream ${response.status}: ${userMessage}`);
            return res.status(response.status).json({
                error: { message: userMessage, code: response.status }
            });
        }

        if (stream) {
            // 流式响应：管道转发 SSE
            res.setHeader('Content-Type', 'text/event-stream');
            res.setHeader('Cache-Control', 'no-cache');
            res.setHeader('Connection', 'keep-alive');
            res.setHeader('X-Accel-Buffering', 'no');

            const reader = response.body.getReader();
            const decoder = new TextDecoder();

            const pump = async () => {
                try {
                    while (true) {
                        const { done, value } = await reader.read();
                        if (done) {
                            res.end();
                            break;
                        }
                        res.write(value);
                    }
                } catch (err) {
                    console.error('[Proxy] Stream error:', err.message);
                    res.end();
                }
            };
            pump();
        } else {
            // 非流式响应：直接返回 JSON
            const data = await response.json();
            res.json(data);
        }
    } catch (err) {
        console.error('[Proxy] Request failed:', err.message);
        res.status(502).json({
            error: { message: '代理请求失败: ' + err.message, code: 502 }
        });
    }
});

app.listen(PORT, HOST, () => {
    console.log(`╔══════════════════════════════════════════╗`);
    console.log(`║   Forge AI Compiler Server v1.02          ║`);
    console.log(`║   http://${HOST}:${PORT}${' '.repeat(Math.max(0, 22 - HOST.length - String(PORT).length))}║`);
    console.log(`╚══════════════════════════════════════════╝`);
    console.log(`  编译器: g++`);
    console.log(`  临时目录: ${TMP_DIR}`);
    console.log(`  鉴权: ${API_TOKEN ? '已启用访问令牌' : '未设置令牌，仅允许本机访问'}`);
    console.log(`  安全: 上游域名白名单已启用（SSRF 防护）`);
});