const express = require('express');
const cors = require('cors');
const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

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

app.listen(PORT, () => {
    console.log(`╔══════════════════════════════════════════╗`);
    console.log(`║   KOBG AI Compiler Server v1.0           ║`);
    console.log(`║   http://localhost:${PORT}                       ║`);
    console.log(`╚══════════════════════════════════════════╝`);
    console.log(`  编译器: g++`);
    console.log(`  临时目录: ${TMP_DIR}`);
});