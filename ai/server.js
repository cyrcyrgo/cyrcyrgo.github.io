const express = require('express');
const cors = require('cors');
const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const https = require('https');
const http = require('http');
const { URL } = require('url');

const app = express();
const PORT = process.env.PORT || 3000;
const TMP_DIR = path.join(os.tmpdir(), 'kobg-ai-compiler');

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(__dirname));

if (!fs.existsSync(TMP_DIR)) {
    fs.mkdirSync(TMP_DIR, { recursive: true });
}

function genId() {
    return Date.now().toString(36) + Math.random().toString(36).substring(2, 8);
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
    
    KOBGModel model("Test-Model");
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
    
    // 移除 AIDialogueSystem 类（只保留 KOBGModel）
    // 先尝试提取 KOBGModel 类
    const classMatch = result.match(/class\s+KOBGModel\s*\{[\s\S]*?\n\s*\};/);
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
        const filename = `kobg-ai-model-${id}.exe`;

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

app.listen(PORT, () => {
    console.log(`╔══════════════════════════════════════════╗`);
    console.log(`║   KOBG AI Compiler Server v1.0           ║`);
    console.log(`║   http://localhost:${PORT}                       ║`);
    console.log(`╚══════════════════════════════════════════╝`);
    console.log(`  编译器: g++`);
    console.log(`  临时目录: ${TMP_DIR}`);
});