/**
 * ai-v - 极简AI助手扩展包
 * =========================
 * MLTSF 扩展包 v3.0 SDK
 * 功能: 极简AI配置、流式对话、AI Agent命令执行、可打断输出
 */

(function() {
    'use strict';
    var api = window.ExtensionAPI;

    // ============================================================
    //  系统提示词 (AI Agent)
    // ============================================================
    var SYSTEM_PROMPT = [
        '你是 MLTSF 终端中的 AI 助手。',
        '你直接运行在用户的终端环境中，可以帮助编程、调试、执行命令和解答问题。',
        '',
        '## 终端命令执行',
        '当你需要执行实际操作时，将命令放在 ```bash 代码块中。',
        '系统会自动执行这些命令并将结果反馈给你。',
        '一次可以放多条命令，每条命令一行。',
        '',
        '示例:',
        '```bash',
        'ls -la',
        'python main.py',
        '```',
        '',
        '## 规则',
        '- 回答简洁直接，不要废话',
        '- 代码用代码块展示，标明语言',
        '- 需要实际操作时，用bash代码块执行命令',
        '- 操作前用一句话说明你要做什么',
        '- 你是终端的一部分，风格匹配命令行环境',
        '- 用户打断你时，立即停止当前任务，处理新指令'
    ].join('\n');

    // ============================================================
    //  聊天状态
    // ============================================================
    var chat = {
        active: false,           // 聊天是否激活
        panel: null,             // createUI 返回的面板对象
        messagesEl: null,        // 消息容器 DOM
        inputEl: null,           // 输入框 DOM
        history: [],             // 对话历史 [{ role, content }]
        abortCtrl: null,         // AbortController 用于打断
        streamingEl: null,       // 当前流式输出的消息 DOM
        streamingText: '',       // 流式累积文本
        agentMode: true,         // Agent模式: 自动执行命令并反馈
        maxAgentLoops: 5,        // Agent最大循环次数
        terminalInputDisabled: false,  // 终端输入是否被禁用
        _destroying: false       // 防止递归销毁
    };

    // ============================================================
    //  工具函数
    // ============================================================

    /** 获取完整配置 */
    function getConfig() {
        return {
            url: api.getConfig('ai_url', ''),
            model: api.getConfig('ai_model', ''),
            mode: api.getConfig('ai_mode', 'openai'),
            key: api.getConfig('ai_key', '')
        };
    }

    /** 检查是否已配置 */
    function isConfigured() {
        var cfg = getConfig();
        return !!(cfg.url && cfg.key);
    }

    /** 构建完整的 API 端点 URL */
    function buildApiUrl(baseUrl) {
        var url = baseUrl.replace(/\/+$/, '');
        if (url.endsWith('/chat/completions')) return url;
        if (url.endsWith('/v1')) return url + '/chat/completions';
        return url + '/v1/chat/completions';
    }

    /** HTML 转义 */
    function escapeHtml(str) {
        if (!str) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    /** 从AI响应中提取bash命令 */
    function extractCommands(text) {
        var commands = [];
        var regex = /```(?:bash|sh|cmd|shell|zsh)\s*\n([\s\S]*?)```/g;
        var match;
        while ((match = regex.exec(text)) !== null) {
            var cmdBlock = match[1].trim();
            var lines = cmdBlock.split('\n');
            for (var i = 0; i < lines.length; i++) {
                var line = lines[i].trim();
                if (line && !line.startsWith('#') && !line.startsWith('//')) {
                    commands.push(line);
                }
            }
        }
        return commands;
    }

    /** 简单的 Markdown 转 HTML（占位符法避免嵌套冲突） */
    function renderMarkdown(text) {
        if (!text) return '';
        var html = escapeHtml(text);
        var codeBlocks = [];

        // Step 1: 提取围栏代码块，用占位符替换
        html = html.replace(/```(\w*)\n([\s\S]*?)```/g, function(m, lang, code) {
            var idx = codeBlocks.length;
            codeBlocks.push('<pre class="aiv-code-block"><code>' + code.trim() + '</code></pre>');
            return '%%CB' + idx + '%%';
        });

        // Step 2: 行内格式
        html = html.replace(/`([^`]+)`/g, '<code class="aiv-inline-code">$1</code>');
        html = html.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
        html = html.replace(/\*([^*]+)\*/g, '<i>$1</i>');
        html = html.replace(/\n/g, '<br>');

        // Step 3: 还原代码块
        html = html.replace(/%%CB(\d+)%%/g, function(m, idx) {
            return codeBlocks[parseInt(idx, 10)] || '';
        });

        return html;
    }

    /** 禁用终端输入 */
    function disableTerminalInput() {
        var terminal = api.getTerminal();
        if (terminal && terminal.input && !chat.terminalInputDisabled) {
            terminal.input.disabled = true;
            terminal.input.style.opacity = '0.3';
            terminal.input.placeholder = 'AI对话中...';
            chat.terminalInputDisabled = true;
        }
    }

    /** 恢复终端输入 */
    function enableTerminalInput() {
        var terminal = api.getTerminal();
        if (terminal && terminal.input && chat.terminalInputDisabled) {
            terminal.input.disabled = false;
            terminal.input.style.opacity = '1';
            terminal.input.placeholder = '';
            terminal.input.focus();
            chat.terminalInputDisabled = false;
        }
    }

    // ============================================================
    //  命令: /aip - 配置AI参数
    // ============================================================
    api.registerCommand('aip', {
        description: '配置AI参数 (极简: URL, 模型, 模式, API Key)',
        handler: function(args, terminal) {
            // 快速配置: /aip <url> <model> <key>
            if (args.length >= 3) {
                api.saveConfig('ai_url', args[0]);
                api.saveConfig('ai_model', args[1]);
                api.saveConfig('ai_mode', 'openai');
                api.saveConfig('ai_key', args[2]);
                terminal.println('AI配置已保存', 'success-line');
                terminal.println('  URL: ' + args[0], 'info-line');
                terminal.println('  模型: ' + args[1], 'info-line');
                terminal.println('使用 /ait 开始对话', 'info-line');
                return;
            }

            // 交互式配置面板
            var cfg = getConfig();
            var panelHtml =
                '<div class="aiv-config">' +
                '  <div class="aiv-config-row">' +
                '    <label>API URL</label>' +
                '    <input id="aiv-cfg-url" type="text" placeholder="https://api.openai.com/v1" value="' + escapeHtml(cfg.url) + '" autocomplete="off">' +
                '    <span class="aiv-config-hint">支持 OpenAI 兼容接口</span>' +
                '  </div>' +
                '  <div class="aiv-config-row">' +
                '    <label>模型名称</label>' +
                '    <input id="aiv-cfg-model" type="text" placeholder="gpt-4o" value="' + escapeHtml(cfg.model) + '" autocomplete="off">' +
                '  </div>' +
                '  <div class="aiv-config-row">' +
                '    <label>接口模式</label>' +
                '    <input id="aiv-cfg-mode" type="text" placeholder="openai" value="' + escapeHtml(cfg.mode || 'openai') + '" autocomplete="off">' +
                '    <span class="aiv-config-hint">默认 openai，支持兼容协议</span>' +
                '  </div>' +
                '  <div class="aiv-config-row">' +
                '    <label>API Key</label>' +
                '    <input id="aiv-cfg-key" type="password" placeholder="sk-..." value="' + escapeHtml(cfg.key) + '" autocomplete="off">' +
                '  </div>' +
                '  <div class="aiv-config-actions">' +
                '    <button id="aiv-cfg-save" class="ext-btn">保存配置</button>' +
                '    <button id="aiv-cfg-clear" class="ext-btn danger">清除配置</button>' +
                '  </div>' +
                '</div>';

            var panel = api.createUI(panelHtml, {
                title: 'AI 配置',
                width: 90,
                closable: true
            });

            if (!panel) return;

            // 绑定保存按钮
            var saveBtn = panel.content.querySelector('#aiv-cfg-save');
            var clearBtn = panel.content.querySelector('#aiv-cfg-clear');
            var urlInput = panel.content.querySelector('#aiv-cfg-url');
            var modelInput = panel.content.querySelector('#aiv-cfg-model');
            var modeInput = panel.content.querySelector('#aiv-cfg-mode');
            var keyInput = panel.content.querySelector('#aiv-cfg-key');

            if (saveBtn) {
                saveBtn.addEventListener('click', function() {
                    var url = (urlInput && urlInput.value || '').trim();
                    var model = (modelInput && modelInput.value || '').trim();
                    var mode = (modeInput && modeInput.value || 'openai').trim();
                    var key = (keyInput && keyInput.value || '').trim();

                    if (!url || !key) {
                        api.print('错误: API URL 和 Key 为必填项', 'error-line');
                        return;
                    }

                    api.saveConfig('ai_url', url);
                    api.saveConfig('ai_model', model);
                    api.saveConfig('ai_mode', mode);
                    api.saveConfig('ai_key', key);

                    api.print('配置已保存', 'success-line');
                    api.print('  URL: ' + url, 'info-line');
                    api.print('  模型: ' + (model || '未指定'), 'info-line');
                    api.print('  模式: ' + mode, 'info-line');
                    api.print('使用 /ait 开始对话', 'info-line');

                    panel.close();
                });
            }

            if (clearBtn) {
                clearBtn.addEventListener('click', function() {
                    api.clearAllConfig();
                    if (urlInput) urlInput.value = '';
                    if (modelInput) modelInput.value = '';
                    if (modeInput) modeInput.value = 'openai';
                    if (keyInput) keyInput.value = '';
                    api.print('配置已清除', 'warning-line');
                    panel.close();
                });
            }

            // 回车保存
            if (keyInput) {
                keyInput.addEventListener('keydown', function(e) {
                    if (e.key === 'Enter' && saveBtn) saveBtn.click();
                });
            }

            // 聚焦第一个输入框
            setTimeout(function() {
                if (urlInput && !urlInput.value) urlInput.focus();
                else if (modelInput) modelInput.focus();
            }, 200);
        }
    });

    // ============================================================
    //  命令: /ait - 进入AI持续对话
    // ============================================================
    api.registerCommand('ait', {
        description: '进入AI持续对话模式 (Agent可执行命令, 可打断AI输出)',
        handler: function(args, terminal) {
            // 检查是否已配置
            if (!isConfigured()) {
                terminal.println('尚未配置AI参数', 'warning-line');
                terminal.println('请先使用 /aip 配置 API URL 和 Key', 'info-line');
                terminal.println('快速配置: /aip <url> <模型> <key>', 'info-line');
                return;
            }

            // 如果已有聊天面板，聚焦输入框
            if (chat.active && chat.inputEl) {
                chat.inputEl.focus();
                terminal.println('AI对话已激活，直接输入消息', 'info-line');
                return;
            }

            // 创建聊天面板
            createChatPanel();

            // 如果有初始消息（/ait 后面的文本），直接发送
            if (args.length > 0) {
                var initMsg = args.join(' ');
                if (chat.inputEl) chat.inputEl.value = initMsg;
                // 触发发送
                setTimeout(function() {
                    handleSendMessage();
                }, 300);
            }
        }
    });

    // ============================================================
    //  聊天面板创建
    // ============================================================
    function createChatPanel() {
        // 先销毁已有面板
        if (chat.panel) {
            destroyChat();
        }

        var cfg = getConfig();
        var modelInfo = cfg.model || '未指定';

        // 聊天面板HTML
        var chatHtml =
            '<div class="aiv-chat">' +
            '  <div class="aiv-chat-info">' +
            '    <span>模型: ' + escapeHtml(modelInfo) + '</span>' +
            '    <span class="aiv-chat-mode">' + (chat.agentMode ? 'Agent ON' : 'Agent OFF') + '</span>' +
            '  </div>' +
            '  <div class="aiv-chat-messages" id="aiv-messages"></div>' +
            '  <div class="aiv-chat-input-area">' +
            '    <input id="aiv-input" type="text" placeholder="输入消息 (Enter发送, /exit退出, /agent切换Agent)" autocomplete="off" autofocus>' +
            '  </div>' +
            '  <div class="aiv-chat-hints">' +
            '    <span>Enter=发送</span>' +
            '    <span>Shift+Enter=换行</span>' +
            '    <span>输出中发送=打断</span>' +
            '    <span>/exit=退出</span>' +
            '    <span>/agent=切换Agent</span>' +
            '    <span>/clear=清屏</span>' +
            '  </div>' +
            '</div>';

        var panel = api.createUI(chatHtml, {
            title: 'AI Chat',
            width: 100,
            closable: true
        });

        if (!panel) return;

        chat.panel = panel;
        chat.active = true;
        chat.messagesEl = panel.content.querySelector('#aiv-messages');
        chat.inputEl = panel.content.querySelector('#aiv-input');

        // 禁用终端输入
        disableTerminalInput();

        // 绑定输入事件
        if (chat.inputEl) {
            chat.inputEl.addEventListener('keydown', function(e) {
                if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleSendMessage();
                }
            });
            // 聚焦
            setTimeout(function() {
                chat.inputEl.focus();
            }, 200);
        }

        // 面板关闭时清理
        var origClose = panel.close;
        panel.close = function() {
            destroyChat();
            origClose.call(panel);
        };

        // 显示欢迎消息
        appendSystemMessage('输入消息开始对话。AI可以执行bash命令。');

        // 恢复历史消息显示
        if (chat.history.length > 0) {
            for (var i = 0; i < chat.history.length; i++) {
                var msg = chat.history[i];
                if (msg.role === 'user') {
                    appendUserMessage(msg.content);
                } else if (msg.role === 'assistant') {
                    appendAssistantMessage(msg.content);
                }
            }
        }
    }

    /** 销毁聊天面板 */
    function destroyChat() {
        // 防止递归（panel.close() 会回调此函数）
        if (chat._destroying) return;
        chat._destroying = true;

        // 打断正在进行的请求
        if (chat.abortCtrl) {
            chat.abortCtrl.abort();
            chat.abortCtrl = null;
        }

        chat.active = false;
        chat.streamingEl = null;
        chat.streamingText = '';

        enableTerminalInput();

        if (chat.panel) {
            try { chat.panel.close(); } catch(e) {}
            chat.panel = null;
        }
        chat.messagesEl = null;
        chat.inputEl = null;

        chat._destroying = false;
    }

    // ============================================================
    //  消息发送与AI交互
    // ============================================================
    function handleSendMessage() {
        if (!chat.inputEl) return;

        var text = chat.inputEl.value.trim();

        // 空消息不处理
        if (!text) return;

        // 清空输入框
        chat.inputEl.value = '';

        // 处理特殊命令
        if (text === '/exit' || text === '/quit' || text === '/q') {
            appendSystemMessage('对话已结束');
            setTimeout(function() { destroyChat(); }, 100);
            return;
        }

        if (text === '/agent') {
            chat.agentMode = !chat.agentMode;
            appendSystemMessage('Agent模式: ' + (chat.agentMode ? 'ON (自动执行命令)' : 'OFF'));
            // 更新面板标题栏
            var modeEl = chat.panel && chat.panel.content ?
                chat.panel.content.querySelector('.aiv-chat-mode') : null;
            if (modeEl) {
                modeEl.textContent = chat.agentMode ? 'Agent ON' : 'Agent OFF';
            }
            return;
        }

        if (text === '/clear') {
            chat.history = [];
            if (chat.messagesEl) {
                chat.messagesEl.innerHTML = '';
            }
            appendSystemMessage('对话已清空');
            return;
        }

        // 如果 AI 正在输出，打断它
        if (chat.abortCtrl) {
            chat.abortCtrl.abort();
            chat.abortCtrl = null;
            // 完成当前的流式消息
            if (chat.streamingEl) {
                chat.streamingEl.classList.remove('aiv-streaming');
                chat.streamingEl = null;
            }
            appendSystemMessage('-- 已打断 --');
        }

        // 添加用户消息到界面和历史
        appendUserMessage(text);
        chat.history.push({ role: 'user', content: text });

        // 发送到AI
        sendToAI();
    }

    /** 发送消息到AI */
    async function sendToAI() {
        if (chat.history.length === 0) return;

        var cfg = getConfig();
        var apiUrl = buildApiUrl(cfg.url);
        var model = cfg.model || 'gpt-4o';

        // 构建消息列表
        var messages = [{ role: 'system', content: SYSTEM_PROMPT }];
        // 限制上下文长度：最近30条消息
        var recentHistory = chat.history.slice(-30);
        for (var i = 0; i < recentHistory.length; i++) {
            messages.push(recentHistory[i]);
        }

        // 创建 AbortController
        chat.abortCtrl = new AbortController();

        // 创建流式消息占位
        chat.streamingText = '';
        chat.streamingEl = createStreamingElement();

        try {
            var response = await fetch(apiUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': 'Bearer ' + cfg.key
                },
                body: JSON.stringify({
                    model: model,
                    messages: messages,
                    stream: true,
                    temperature: 0.7
                }),
                signal: chat.abortCtrl.signal
            });

            if (!response.ok) {
                var errText = '';
                try { errText = await response.text(); } catch(e) {}
                throw new Error('HTTP ' + response.status + (errText ? ': ' + errText.slice(0, 200) : ''));
            }

            // 流式读取
            var reader = response.body.getReader();
            var decoder = new TextDecoder();
            var buffer = '';

            while (true) {
                var result;
                try {
                    result = await reader.read();
                } catch (e) {
                    // 被中断
                    break;
                }

                if (result.done) break;

                buffer += decoder.decode(result.value, { stream: true });
                var lines = buffer.split('\n');
                buffer = lines.pop() || '';

                for (var i = 0; i < lines.length; i++) {
                    var line = lines[i].trim();
                    if (!line || !line.startsWith('data: ')) continue;

                    var data = line.slice(6).trim();
                    if (data === '[DONE]') {
                        // 流结束
                        break;
                    }

                    try {
                        var parsed = JSON.parse(data);
                        var delta = parsed.choices && parsed.choices[0] && parsed.choices[0].delta;
                        if (delta && delta.content) {
                            chat.streamingText += delta.content;
                            updateStreamingElement(chat.streamingText);
                        }
                    } catch(e) {
                        // 解析失败，跳过
                    }
                }
            }

            // 流式输出完成
            finalizeStreaming();

        } catch (err) {
            if (err.name === 'AbortError') {
                // 被打断，保存已输出的内容
                if (chat.streamingText) {
                    finalizeStreaming();
                } else {
                    removeStreamingElement();
                }
            } else {
                // 错误处理
                removeStreamingElement();
                appendErrorMessage('请求失败: ' + (err.message || '未知错误'));
                api.print('AI请求失败: ' + err.message, 'error-line');
            }
        } finally {
            chat.abortCtrl = null;
        }
    }

    /** 创建流式消息元素 */
    function createStreamingElement() {
        if (!chat.messagesEl) return null;

        var el = document.createElement('div');
        el.className = 'aiv-msg aiv-msg-assistant aiv-streaming';
        el.innerHTML = '<span class="aiv-cursor">▌</span>';
        chat.messagesEl.appendChild(el);
        scrollToBottom();
        return el;
    }

    /** 更新流式消息 */
    function updateStreamingElement(text) {
        if (!chat.streamingEl) return;
        chat.streamingEl.innerHTML = renderMarkdown(text) + '<span class="aiv-cursor">▌</span>';
        scrollToBottom();
    }

    /** 完成流式输出 */
    function finalizeStreaming() {
        if (!chat.streamingEl) return;

        var text = chat.streamingText;
        chat.streamingEl.classList.remove('aiv-streaming');
        chat.streamingEl.innerHTML = renderMarkdown(text);
        chat.streamingEl = null;
        chat.streamingText = '';

        // 添加到历史
        if (text) {
            chat.history.push({ role: 'assistant', content: text });
        }

        scrollToBottom();

        // Agent模式: 提取并执行命令
        if (chat.agentMode && text) {
            var commands = extractCommands(text);
            if (commands.length > 0 && chat.history.length < chat.maxAgentLoops * 2 + 2) {
                executeAgentCommands(commands);
            }
        }
    }

    /** 移除流式消息 */
    function removeStreamingElement() {
        if (chat.streamingEl && chat.streamingEl.parentNode) {
            chat.streamingEl.parentNode.removeChild(chat.streamingEl);
        }
        chat.streamingEl = null;
        chat.streamingText = '';
    }

    // ============================================================
    //  Agent命令执行
    // ============================================================
    async function executeAgentCommands(commands) {
        if (commands.length === 0) return;

        appendSystemMessage('执行命令 (' + commands.length + '条)...');

        for (var i = 0; i < commands.length; i++) {
            var cmd = commands[i];
            appendCommandMessage(cmd);

            try {
                await api.executeCommand(cmd);
                appendCommandResult(cmd, true);
            } catch (e) {
                appendCommandResult(cmd, false, e.message);
            }

            // 命令间短暂延迟
            await api.sleep(200);
        }

        // 将命令执行结果反馈给AI继续对话
        var resultMsg = '[系统] 以上命令已执行完毕。';
        var successCount = commands.length;
        resultMsg += ' 共执行 ' + successCount + ' 条命令。请根据结果继续分析或给出下一步建议。';

        appendSystemMessage('命令执行完毕，反馈给AI...');
        chat.history.push({ role: 'user', content: resultMsg });

        // 继续AI对话
        sendToAI();
    }

    // ============================================================
    //  消息显示
    // ============================================================
    function appendUserMessage(text) {
        if (!chat.messagesEl) return;
        var el = document.createElement('div');
        el.className = 'aiv-msg aiv-msg-user';
        el.textContent = text;
        chat.messagesEl.appendChild(el);
        scrollToBottom();
    }

    function appendAssistantMessage(text) {
        if (!chat.messagesEl) return;
        var el = document.createElement('div');
        el.className = 'aiv-msg aiv-msg-assistant';
        el.innerHTML = renderMarkdown(text);
        chat.messagesEl.appendChild(el);
        scrollToBottom();
    }

    function appendSystemMessage(text) {
        if (!chat.messagesEl) return;
        var el = document.createElement('div');
        el.className = 'aiv-msg aiv-msg-system';
        el.textContent = text;
        chat.messagesEl.appendChild(el);
        scrollToBottom();
    }

    function appendErrorMessage(text) {
        if (!chat.messagesEl) return;
        var el = document.createElement('div');
        el.className = 'aiv-msg aiv-msg-error';
        el.textContent = text;
        chat.messagesEl.appendChild(el);
        scrollToBottom();
    }

    function appendCommandMessage(cmd) {
        if (!chat.messagesEl) return;
        var el = document.createElement('div');
        el.className = 'aiv-msg aiv-msg-command';
        el.textContent = '$ ' + cmd;
        chat.messagesEl.appendChild(el);
        scrollToBottom();
    }

    function appendCommandResult(cmd, success, errorMsg) {
        if (!chat.messagesEl) return;
        var el = document.createElement('div');
        el.className = 'aiv-msg aiv-msg-cmd-result ' + (success ? 'aiv-success' : 'aiv-error');
        el.textContent = success ? 'OK: ' + cmd : 'FAIL: ' + cmd + (errorMsg ? ' (' + errorMsg + ')' : '');
        chat.messagesEl.appendChild(el);
        scrollToBottom();
    }

    /** 滚动到底部 */
    function scrollToBottom() {
        if (!chat.messagesEl) return;
        setTimeout(function() {
            chat.messagesEl.scrollTop = chat.messagesEl.scrollHeight;
        }, 50);
    }

    // ============================================================
    //  初始化
    // ============================================================
    api.on('ready', function() {
        api.print('[ai-v] 极简AI助手已就绪', 'success-line');
        api.print('  配置: /aip  |  对话: /ait', 'info-line');
        api.print('  快速配置: /aip <URL> <模型> <Key>', 'info-line');
    });

    // 扩展卸载时清理
    api.on('unload', function() {
        destroyChat();
    });

    console.log('[ai-v] 扩展包已加载');
})();