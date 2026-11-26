/**
 * CppForge - 命令执行窗口逻辑
 * 读取 IDE 传入的运行数据，调用真实编译器并渲染终端输出
 */
(function () {
    'use strict';

    var RUN_PAYLOAD_KEY = 'cppforge.run.v1';

    var ANSI_COLORS = {
        30: '#4a5878', 31: '#ff6b6b', 32: '#3ddc97', 33: '#ffd479',
        34: '#4f8cff', 35: '#c792ea', 36: '#56d4dd', 37: '#dbe4f3',
        90: '#6b7a99', 91: '#ff8787', 92: '#69e6b0', 93: '#ffe08a',
        94: '#7aa2ff', 95: '#d8b4fe', 96: '#7ee3ea', 97: '#ffffff'
    };

    var state = {
        payload: null,
        running: false,
        controller: null,
        screen: null,
        lines: null
    };

    var $ = function (id) { return document.getElementById(id); };

    /* ------------------------------------------------------------------ */
    /*  工具：转义与 ANSI 渲染                                             */
    /* ------------------------------------------------------------------ */

    function escapeHtml(str) {
        return String(str == null ? '' : str).replace(/[&<>"']/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
    }

    function ansiToHtml(input) {
        if (!input) return '';
        input = String(input).replace(/\r\n/g, '\n').replace(/\r/g, '\n');
        var out = '';
        var idx = 0;
        var st = { fg: null, bold: false, dim: false, underline: false };
        var re = /\x1b\[([0-9;]*)m/g;
        var m;

        function styleStr() {
            var s = [];
            if (st.fg) s.push('color:' + st.fg);
            if (st.bold) s.push('font-weight:700');
            if (st.dim) s.push('opacity:.62');
            if (st.underline) s.push('text-decoration:underline');
            return s.join(';');
        }
        function emit(text) {
            if (!text) return;
            var esc = escapeHtml(text);
            var style = styleStr();
            out += style ? '<span style="' + style + '">' + esc + '</span>' : esc;
        }

        while ((m = re.exec(input))) {
            emit(input.slice(idx, m.index));
            idx = re.lastIndex;
            var codes = m[1] === '' ? ['0'] : m[1].split(';');
            codes.forEach(function (c) {
                var n = parseInt(c, 10);
                if (isNaN(n)) return;
                if (n === 0) { st.fg = null; st.bold = false; st.dim = false; st.underline = false; }
                else if (n === 1) st.bold = true;
                else if (n === 2) st.dim = true;
                else if (n === 4) st.underline = true;
                else if (n === 22) { st.bold = false; st.dim = false; }
                else if (n === 24) st.underline = false;
                else if (n === 39) st.fg = null;
                else if ((n >= 30 && n <= 37) || (n >= 90 && n <= 97)) st.fg = ANSI_COLORS[n] || null;
            });
        }
        emit(input.slice(idx));
        return out;
    }

    function stripAnsi(text) {
        return String(text || '').replace(/\x1b\[[0-9;]*m/g, '');
    }

    /* ------------------------------------------------------------------ */
    /*  终端渲染                                                           */
    /* ------------------------------------------------------------------ */

    function append(html, cls) {
        var line = document.createElement('div');
        line.className = 'term-line' + (cls ? ' ' + cls : '');
        line.innerHTML = html;
        state.lines.appendChild(line);
        return line;
    }

    function appendBlock(html, cls) {
        var line = document.createElement('div');
        line.className = 'term-line block ' + (cls || '');
        line.innerHTML = html;
        state.lines.appendChild(line);
        return line;
    }

    function gap(height) {
        var line = document.createElement('div');
        line.className = 'line-gap';
        line.style.height = (height || 10) + 'px';
        state.lines.appendChild(line);
    }

    function promptHtml(cmd) {
        return '<span class="prompt-user">cyrcyrgo@cppforge</span>' +
            '<span class="prompt-sep">:</span>' +
            '<span class="prompt-path">~/project</span>' +
            '<span class="prompt-sym">$</span> ' +
            '<span class="cmd-text">' + escapeHtml(cmd) + '</span>';
    }

    function promptCursor() {
        return '<span class="prompt-user">cyrcyrgo@cppforge</span>' +
            '<span class="prompt-sep">:</span>' +
            '<span class="prompt-path">~/project</span>' +
            '<span class="prompt-sym">$</span><span class="cursor-block"></span>';
    }

    function printBanner() {
        var c = CppCompiler.getCompiler(state.payload ? state.payload.compiler : 'gcc-13.2.0');
        var s = CppCompiler.getStandard(state.payload ? state.payload.standard : 'c++17');
        append('<span class="banner-title"><span class="t-accent">CppForge</span> · C++ 命令执行窗口</span>' +
            '<span class="banner-tag">ONLINE</span>', 'banner-line');
        append('<span class="banner-sub">编译器 ' + escapeHtml(c.label) + ' · 标准 ' + escapeHtml(s.label) +
            ' · 平台 Linux x86_64 · 后端 Wandbox</span>', 'banner-line');
        append('<span class="banner-sep">' + '─'.repeat(72) + '</span>', 'banner-line');
        gap(8);
    }

    function clearScreen() {
        state.lines.innerHTML = '';
    }

    function scrollBottom() {
        state.screen.scrollTop = state.screen.scrollHeight;
    }

    /* ------------------------------------------------------------------ */
    /*  状态 UI                                                            */
    /* ------------------------------------------------------------------ */

    function setChip(stateName, text) {
        var chip = $('chip-status');
        chip.className = 'chip chip-status state-' + stateName;
        var icon = stateName === 'running' ? 'fa-circle' : (stateName === 'ok' ? 'fa-circle-check' : 'fa-circle-xmark');
        chip.innerHTML = '<i class="fas ' + icon + '"></i> ' + escapeHtml(text);
    }

    function setFootExit(text) {
        $('foot-exit').textContent = text;
    }

    function setRunningUI(running) {
        $('btn-rerun').disabled = running;
        $('btn-stop').disabled = !running;
        document.body.classList.toggle('is-running', running);
    }

    function updateChips() {
        if (!state.payload) return;
        var c = CppCompiler.getCompiler(state.payload.compiler);
        var s = CppCompiler.getStandard(state.payload.standard);
        $('chip-compiler').textContent = c.label;
        $('chip-std').textContent = s.label;
        $('term-file').textContent = state.payload.filename || 'main.cpp';
        document.title = '运行 ' + (state.payload.filename || 'main.cpp') + ' · CppForge';
    }

    function updateStdinUI() {
        var stdin = state.payload ? (state.payload.stdin || '') : '';
        $('term-stdin').value = stdin;
        var preview = $('stdin-preview');
        if (!stdin) {
            preview.textContent = '未提供';
        } else {
            var oneLine = stdin.replace(/\s+/g, ' ').trim();
            preview.textContent = oneLine.length > 40 ? oneLine.slice(0, 40) + '…' : oneLine;
        }
    }

    /* ------------------------------------------------------------------ */
    /*  运行流程                                                           */
    /* ------------------------------------------------------------------ */

    async function run() {
        if (!state.payload) return;
        if (state.running) return;

        state.running = true;
        setRunningUI(true);
        setChip('running', '编译中');
        setFootExit('退出码 —');

        // 同步最新标准输入
        state.payload.stdin = $('term-stdin').value;

        clearScreen();
        printBanner();

        var cmd = CppCompiler.buildCommandLine(state.payload);
        append(promptHtml(cmd));
        var loading = append('<span class="spinner"></span><span>正在连接编译服务并编译…</span>', 'loading-line');
        scrollBottom();

        state.controller = new AbortController();

        try {
            var res = await CppCompiler.compileAndRun({
                code: state.payload.code,
                filename: state.payload.filename,
                stdin: state.payload.stdin,
                compiler: state.payload.compiler,
                standard: state.payload.standard,
                warnings: state.payload.warnings,
                optimize: state.payload.optimize,
                signal: state.controller.signal,
                timeout: 60000
            });

            loading.remove();
            renderResult(res);

        } catch (err) {
            loading.remove();
            if (err && err.code === 'ABORTED') {
                setChip('err', '已停止');
                setFootExit('已中止');
                append('<span class="t-warn">^C</span> <span class="t-muted">执行已被用户中止</span>');
                append(promptCursor());
            } else {
                setChip('err', '失败');
                setFootExit('连接失败');
                renderError(err);
            }
        } finally {
            state.running = false;
            state.controller = null;
            setRunningUI(false);
            scrollBottom();
        }
    }

    function renderResult(res) {
        var elapsedSec = (res.elapsed / 1000).toFixed(2);

        if (res.compilerOutput && res.compilerOutput.trim()) {
            appendBlock(ansiToHtml(res.compilerOutput), 'block-compile');
        }

        if (!res.compileOk) {
            setChip('err', '编译失败');
            setFootExit('退出码 ' + res.exitCode);
            gap(4);
            append('<span class="mark mark-err">✗ 编译失败</span> <span class="t-muted">· 退出码 ' + res.exitCode + ' · 用时 ' + elapsedSec + 's</span>');
            append('<span class="t-muted">请根据上方诊断信息修正代码，然后点击「重新运行」或按 F5。</span>');
            gap(8);
            append(promptCursor());
            return;
        }

        // 统计警告数
        var warnMatches = stripAnsi(res.compilerOutput).match(/warning:/gi);
        var warnText = warnMatches ? warnMatches.length + ' 条警告 · ' : '';

        setChip('ok', '编译成功');
        append('<span class="mark mark-ok">✓ 编译成功</span> <span class="t-muted">· ' + warnText + '总耗时 ' + elapsedSec + 's</span>');
        gap(6);

        // 运行命令
        var runCmd = './main' + (state.payload.stdin ? ' < stdin' : '');
        append(promptHtml(runCmd));

        if (res.programOutput && res.programOutput.trim()) {
            appendBlock(ansiToHtml(res.programOutput), 'block-out');
        } else {
            append('<span class="t-muted">(程序没有输出)</span>');
        }

        if (res.programError && res.programError.trim()) {
            appendBlock(ansiToHtml(res.programError), 'block-err');
        }

        // 退出信息
        var okExit = res.exitCode === 0;
        var desc = CppCompiler.describeExit(res.exitCode, res.signal);
        var exitCls = okExit ? 't-ok' : 't-err';
        var exitMark = okExit ? '✓' : '✗';
        var exitLine = '<span class="' + exitCls + '">' + exitMark + ' 进程结束 · 退出码 ' + res.exitCode + '</span>';
        if (desc) exitLine += ' <span class="t-warn">(' + escapeHtml(desc) + ')</span>';
        exitLine += ' <span class="t-muted">· 用时 ' + elapsedSec + 's</span>';
        gap(4);
        append(exitLine);

        if (!okExit) {
            setChip('err', '退出码 ' + res.exitCode);
            setFootExit('退出码 ' + res.exitCode);
        } else {
            setChip('ok', '运行完成');
            setFootExit('退出码 0');
        }

        gap(8);
        append(promptCursor());
    }

    function renderError(err) {
        gap(4);
        append('<span class="mark mark-err">✗ ' + escapeHtml(err.message || '执行失败') + '</span>');
        if (err.detail) {
            appendBlock(escapeHtml(err.detail), 'block-err');
        }

        var hint = '';
        if (err.code === 'NETWORK') {
            hint = '编译服务 wandbox.org 无法访问。请检查网络连接或代理设置后重试。';
        } else if (err.code === 'TIMEOUT') {
            hint = '程序可能陷入死循环，或编译服务响应缓慢。请检查代码后重试。';
        } else if (err.code === 'HTTP') {
            hint = '编译服务暂时不可用，请稍后重试。';
        }
        if (hint) append('<span class="t-muted">' + escapeHtml(hint) + '</span>');
        append('<span class="t-muted">点击「重新运行」或按 F5 可重试。</span>');
        gap(8);
        append(promptCursor());
    }

    /* ------------------------------------------------------------------ */
    /*  空状态                                                             */
    /* ------------------------------------------------------------------ */

    function showEmpty() {
        clearScreen();
        printBanner();
        append('<span class="empty-state">' +
            '没有待运行的代码。<br>' +
            '请返回编辑器编写代码，然后点击「运行」按钮打开命令窗口。<br><br>' +
            '<a href="index.html"><i class="fas fa-arrow-left"></i> 返回 C++ 编辑器</a>' +
            '</span>');
        setChip('err', '无任务');
        setFootExit('—');
        $('btn-rerun').disabled = true;
    }

    /* ------------------------------------------------------------------ */
    /*  初始化与事件绑定                                                    */
    /* ------------------------------------------------------------------ */

    function loadPayload() {
        try {
            var raw = localStorage.getItem(RUN_PAYLOAD_KEY);
            if (!raw) return null;
            var p = JSON.parse(raw);
            if (!p || typeof p.code !== 'string') return null;
            return {
                filename: p.filename || 'main.cpp',
                code: p.code,
                compiler: p.compiler || 'gcc-13.2.0',
                standard: p.standard || 'c++17',
                warnings: p.warnings !== false,
                optimize: !!p.optimize,
                stdin: p.stdin || ''
            };
        } catch (e) {
            return null;
        }
    }

    function savePayload() {
        try {
            localStorage.setItem(RUN_PAYLOAD_KEY, JSON.stringify(Object.assign({}, state.payload, { ts: Date.now() })));
        } catch (e) { /* ignore */ }
    }

    function bindEvents() {
        $('btn-rerun').addEventListener('click', run);

        $('btn-stop').addEventListener('click', function () {
            if (state.controller) {
                state.controller.abort();
            }
        });

        $('btn-clear').addEventListener('click', function () {
            clearScreen();
            append(promptCursor());
        });

        $('btn-copy').addEventListener('click', function () {
            copyText(state.lines.innerText || '');
        });

        $('btn-download').addEventListener('click', function () {
            if (!state.payload) return;
            var blob = new Blob([state.payload.code], { type: 'text/x-c++src;charset=utf-8' });
            var a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = state.payload.filename || 'main.cpp';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
        });

        $('btn-back').addEventListener('click', function () {
            if (window.opener && !window.opener.closed) {
                window.opener.focus();
                window.close();
            } else {
                location.href = 'index.html';
            }
        });

        $('btn-toggle-stdin').addEventListener('click', function () {
            document.querySelector('.stdin-drawer').classList.toggle('open');
        });

        $('term-stdin').addEventListener('input', function (e) {
            if (state.payload) {
                state.payload.stdin = e.target.value;
                savePayload();
                updateStdinUI();
            }
        });

        $('btn-apply-stdin').addEventListener('click', function () {
            if (!state.payload) return;
            state.payload.stdin = $('term-stdin').value;
            savePayload();
            updateStdinUI();
            run();
        });

        document.addEventListener('keydown', function (e) {
            if (e.key === 'F5') {
                e.preventDefault();
                run();
            } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'l') {
                e.preventDefault();
                clearScreen();
                append(promptCursor());
            }
        });

        // 点击屏幕任意位置聚焦（便于键盘操作）
        state.screen.addEventListener('click', function () {
            window.focus();
        });
    }

    function copyText(text) {
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text).then(function () {
                flashCopySuccess();
            }).catch(function () { fallbackCopy(text); });
        } else {
            fallbackCopy(text);
        }
    }

    function fallbackCopy(text) {
        var ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        try { document.execCommand('copy'); flashCopySuccess(); } catch (e) { /* ignore */ }
        document.body.removeChild(ta);
    }

    function flashCopySuccess() {
        var btn = $('btn-copy');
        var original = btn.innerHTML;
        btn.innerHTML = '<i class="fas fa-check"></i><span>已复制</span>';
        setTimeout(function () { btn.innerHTML = original; }, 1400);
    }

    function init() {
        state.screen = $('term-screen');
        state.lines = $('term-lines');
        bindEvents();

        state.payload = loadPayload();
        if (!state.payload) {
            showEmpty();
            return;
        }

        updateChips();
        updateStdinUI();
        run();
    }

    document.addEventListener('DOMContentLoaded', init);

})();
