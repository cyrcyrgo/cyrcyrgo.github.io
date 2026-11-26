/**
 * CppForge - C++ 在线编译器
 * 编译后端：Wandbox API（真实 GCC / Clang）
 * 该文件同时供 IDE 与终端页面使用
 */
(function (global) {
    'use strict';

    var ENDPOINT = 'https://wandbox.org/api/compile.json';

    var COMPILERS = {
        'gcc-13.2.0': { name: 'gcc-13.2.0', label: 'GCC 13.2.0', family: 'gcc', version: '13.2.0', recommended: true },
        'gcc-12.3.0': { name: 'gcc-12.3.0', label: 'GCC 12.3.0', family: 'gcc', version: '12.3.0' },
        'gcc-11.4.0': { name: 'gcc-11.4.0', label: 'GCC 11.4.0', family: 'gcc', version: '11.4.0' },
        'gcc-head': { name: 'gcc-head', label: 'GCC HEAD (实验)', family: 'gcc', version: 'HEAD', experimental: true },
        'clang-17.0.1': { name: 'clang-17.0.1', label: 'Clang 17.0.1', family: 'clang', version: '17.0.1' },
        'clang-16.0.4': { name: 'clang-16.0.4', label: 'Clang 16.0.4', family: 'clang', version: '16.0.4' },
        'clang-head': { name: 'clang-head', label: 'Clang HEAD (实验)', family: 'clang', version: 'HEAD', experimental: true }
    };

    // Wandbox 的标准开关名称
    var STANDARDS = {
        'c++11': { value: 'c++11', label: 'C++11', macro: 201103 },
        'c++14': { value: 'c++14', label: 'C++14', macro: 201402 },
        'c++17': { value: 'c++17', label: 'C++17', macro: 201703 },
        'c++20': { value: 'c++2a', label: 'C++20', macro: 202002 },
        'c++23': { value: 'c++2b', label: 'C++23', macro: 202100 }
    };

    function getCompiler(name) {
        return COMPILERS[name] || COMPILERS['gcc-13.2.0'];
    }

    function getStandard(key) {
        return STANDARDS[key] || STANDARDS['c++17'];
    }

    /**
     * 组装 Wandbox options 字段（逗号分隔的开关名）
     */
    function buildOptions(cfg) {
        var list = [];
        if (cfg.warnings !== false) list.push('warning');
        if (cfg.optimize) list.push('optimize');
        list.push(getStandard(cfg.standard).value);
        return list.join(',');
    }

    /**
     * 组装用于展示的 g++ 命令
     */
    function buildCommandLine(cfg) {
        var c = getCompiler(cfg.compiler);
        var std = getStandard(cfg.standard).value;
        var bin = c.family === 'clang' ? 'clang++' : 'g++';
        var parts = [bin, cfg.filename || 'main.cpp'];
        if (std) parts.push('-std=' + std);
        if (cfg.warnings !== false) parts.push('-Wall');
        if (cfg.optimize) parts.push('-O2');
        parts.push('-o', 'main');
        return parts.join(' ');
    }

    /**
     * 统一的错误对象
     */
    function CompilerError(code, message, detail) {
        var err = new Error(message);
        err.code = code;
        err.detail = detail || '';
        return err;
    }

    /**
     * 调用 Wandbox 编译并运行
     * @param {Object} cfg { code, filename, stdin, compiler, standard, warnings, optimize, timeout }
     * @returns {Promise<Object>}
     */
    async function compileAndRun(cfg) {
        var timeout = cfg.timeout || 45000;
        var controller = new AbortController();
        var timer = setTimeout(function () { controller.abort(); }, timeout);

        // 支持外部中断（停止按钮）
        var external = cfg.signal;
        var onExternalAbort = function () { controller.abort(); };
        if (external) {
            if (external.aborted) controller.abort();
            else external.addEventListener('abort', onExternalAbort);
        }

        var body = {
            code: cfg.code || '',
            compiler: getCompiler(cfg.compiler).name,
            options: buildOptions(cfg),
            stdin: cfg.stdin || ''
        };

        var started = performance.now();

        try {
            var res = await fetch(ENDPOINT, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
                signal: controller.signal,
                mode: 'cors'
            });

            var text = await res.text();

            if (!res.ok) {
                var detail = text || ('HTTP ' + res.status);
                throw CompilerError('HTTP', '编译服务返回错误（HTTP ' + res.status + '）', detail);
            }

            var data;
            try {
                data = JSON.parse(text);
            } catch (e) {
                throw CompilerError('PARSE', '无法解析编译服务响应', text.slice(0, 300));
            }

            var elapsed = Math.round(performance.now() - started);
            return normalizeResult(data, elapsed);

        } catch (err) {
            if (err && err.code === 'HTTP') throw err;
            if (err && (err.name === 'AbortError' || err.code === 'ABORT_ERR')) {
                if (external && external.aborted) {
                    throw CompilerError('ABORTED', '执行已停止', '');
                }
                throw CompilerError('TIMEOUT', '编译超时（' + Math.round(timeout / 1000) + ' 秒）', '程序可能陷入死循环，或编译服务响应缓慢。');
            }
            if (err && err.code === 'PARSE') throw err;
            throw CompilerError('NETWORK', '无法连接编译服务', '请检查网络连接。编译服务位于 wandbox.org，部分网络环境需要代理访问。');
        } finally {
            clearTimeout(timer);
            if (external && onExternalAbort) {
                external.removeEventListener('abort', onExternalAbort);
            }
        }
    }

    function normalizeResult(data, elapsed) {
        var compilerOut = data.compiler_output || '';
        var compilerErr = data.compiler_error || '';
        // compiler_message 通常是 error 与 warning 的合并，避免重复展示
        var diagnostics = compilerOut;
        if (compilerErr && compilerErr !== compilerOut) {
            diagnostics += compilerErr;
        }

        var status = parseInt(data.status, 10);
        if (isNaN(status)) status = data.status === '0' ? 0 : 1;

        // 注意：status 是程序的退出码，不能用来判断编译是否成功。
        // 编译失败时编译器会输出 "error:" 诊断信息。
        var plain = diagnostics.replace(/\x1b\[[0-9;]*m/g, '');
        var compileOk = !/(^|[\s:])(fatal\s+)?error:/i.test(plain);

        return {
            compileOk: compileOk,
            exitCode: status,
            signal: data.signal || '',
            compilerOutput: diagnostics,
            programOutput: data.program_output || '',
            programError: data.program_error || '',
            elapsed: elapsed,
            url: data.url || '',
            raw: data
        };
    }

    /**
     * 退出码 / 信号 的中文说明
     */
    function describeExit(code, signal) {
        if (signal) return '被信号终止：' + signal;
        var signals = {
            134: 'SIGABRT（程序异常中止）',
            136: 'SIGFPE（算术错误，如整数除零）',
            137: 'SIGKILL（进程被强制终止，可能是超时或内存超限）',
            139: 'SIGSEGV（段错误，常见于空指针或越界访问）',
            143: 'SIGTERM（进程被终止）'
        };
        if (signals[code]) return signals[code];
        return '';
    }

    global.CppCompiler = {
        COMPILERS: COMPILERS,
        STANDARDS: STANDARDS,
        getCompiler: getCompiler,
        getStandard: getStandard,
        buildOptions: buildOptions,
        buildCommandLine: buildCommandLine,
        compileAndRun: compileAndRun,
        describeExit: describeExit
    };

})(window);
