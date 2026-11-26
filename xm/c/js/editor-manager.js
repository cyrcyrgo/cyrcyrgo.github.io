/**
 * CppForge - 编辑器管理器
 * 负责 Monaco 编辑器的初始化、C++ 主题与代码片段
 */
(function (global) {
    'use strict';

    function EditorManager() {
        this.editor = null;
        this.monaco = null;
        this.onCursor = null;
        this.onSave = null;
        this.onRun = null;
        this._snippetsRegistered = false;
    }

    EditorManager.prototype.init = async function (containerId, initialValue) {
        await this._loadMonaco();
        this._defineTheme();

        var container = document.getElementById(containerId);
        this.editor = this.monaco.editor.create(container, {
            value: initialValue == null ? '' : initialValue,
            language: 'cpp',
            theme: 'cpp-forge',
            fontSize: 14,
            fontFamily: "'JetBrains Mono', 'Fira Code', Consolas, monospace",
            fontLigatures: true,
            lineHeight: 22,
            tabSize: 4,
            insertSpaces: true,
            minimap: { enabled: true, scale: 1, renderCharacters: false },
            scrollBeyondLastLine: false,
            automaticLayout: true,
            wordWrap: 'on',
            renderWhitespace: 'selection',
            renderLineHighlight: 'all',
            cursorBlinking: 'smooth',
            cursorSmoothCaretAnimation: 'on',
            smoothScrolling: true,
            padding: { top: 12, bottom: 12 },
            folding: true,
            foldingHighlight: true,
            bracketPairColorization: { enabled: true },
            guides: { bracketPairs: true, indentation: true },
            suggest: { showKeywords: true, showSnippets: true },
            quickSuggestions: { other: true, comments: false, strings: false },
            parameterHints: { enabled: true },
            formatOnPaste: true,
            formatOnType: true
        });

        this._bindEvents();
        this._registerSnippets();
        return this;
    };

    EditorManager.prototype._loadMonaco = function () {
        var self = this;
        return new Promise(function (resolve, reject) {
            var hosts = [
                'https://cdn.jsdmirror.com/npm/monaco-editor@0.45.0/min/vs',
                'https://fastly.jsdelivr.net/npm/monaco-editor@0.45.0/min/vs',
                'https://cdn.jsdelivr.net/npm/monaco-editor@0.45.0/min/vs'
            ];

            function tryLoad(index) {
                if (index >= hosts.length) {
                    reject(new Error('Monaco Editor 加载失败，请检查网络'));
                    return;
                }
                require.config({ paths: { vs: hosts[index] } });
                require(['vs/editor/editor.main'], function (monaco) {
                    self.monaco = monaco;
                    resolve();
                }, function () {
                    tryLoad(index + 1);
                });
            }
            tryLoad(0);
        });
    };

    EditorManager.prototype._defineTheme = function () {
        this.monaco.editor.defineTheme('cpp-forge', {
            base: 'vs-dark',
            inherit: true,
            rules: [
                { token: 'comment', foreground: '5C6A85', fontStyle: 'italic' },
                { token: 'keyword', foreground: '7AA2FF', fontStyle: 'bold' },
                { token: 'keyword.control', foreground: 'C792EA' },
                { token: 'string', foreground: '8CE99A' },
                { token: 'number', foreground: 'FFB86C' },
                { token: 'type', foreground: '56D4DD' },
                { token: 'type.identifier', foreground: '56D4DD' },
                { token: 'identifier', foreground: 'E6ECF7' },
                { token: 'delimiter', foreground: '8492AB' },
                { token: 'operator', foreground: 'C792EA' },
                { token: 'predefined', foreground: 'FFD479' },
                { token: 'annotation', foreground: 'FFD479' }
            ],
            colors: {
                'editor.background': '#0F1523',
                'editor.foreground': '#E6ECF7',
                'editorLineNumber.foreground': '#4A5878',
                'editorLineNumber.activeForeground': '#9FB3D9',
                'editor.selectionBackground': '#264F78',
                'editor.lineHighlightBackground': '#151C2C',
                'editorCursor.foreground': '#4F8CFF',
                'editorWhitespace.foreground': '#263148',
                'editorIndentGuide.background': '#1F2A40',
                'editorIndentGuide.activeBackground': '#33405E',
                'editorWidget.background': '#111725',
                'editorSuggestWidget.background': '#111725',
                'editorSuggestWidget.selectedBackground': '#1D2537'
            }
        });
    };

    EditorManager.prototype._bindEvents = function () {
        var self = this;
        this.editor.onDidChangeCursorPosition(function (e) {
            if (typeof self.onCursor === 'function') {
                self.onCursor(e.position.lineNumber, e.position.column);
            }
        });

        var KM = this.monaco.KeyMod;
        var KC = this.monaco.KeyCode;

        this.editor.addCommand(KM.CtrlCmd | KC.KeyS, function () {
            if (typeof self.onSave === 'function') self.onSave();
        });
        this.editor.addCommand(KC.F5, function () {
            if (typeof self.onRun === 'function') self.onRun();
        });
        this.editor.addCommand(KM.Shift | KM.Alt | KC.KeyF, function () {
            self.format();
        });
        this.editor.addCommand(KM.CtrlCmd | KC.Slash, function () {
            self.toggleComment();
        });
    };

    /**
     * 注册常用 C++ 代码片段
     */
    EditorManager.prototype._registerSnippets = function () {
        if (this._snippetsRegistered) return;
        this._snippetsRegistered = true;
        var self = this;

        var snippets = [
            {
                label: 'main', detail: 'int main()',
                insertText: 'int main() {\n\t${1}\n\treturn 0;\n}'
            },
            {
                label: 'fori', detail: 'for 循环',
                insertText: 'for (int ${1:i} = 0; ${1:i} < ${2:n}; ++${1:i}) {\n\t${3}\n}'
            },
            {
                label: 'forr', detail: '范围 for 循环',
                insertText: 'for (const auto& ${1:item} : ${2:container}) {\n\t${3}\n}'
            },
            {
                label: 'cout', detail: 'std::cout',
                insertText: 'std::cout << ${1} << std::endl;'
            },
            {
                label: 'cin', detail: 'std::cin',
                insertText: 'std::cin >> ${1};'
            },
            {
                label: 'vec', detail: 'std::vector',
                insertText: 'std::vector<${1:int}> ${2:v} = {${3}};'
            },
            {
                label: 'sort', detail: 'std::sort',
                insertText: 'std::sort(${1:v}.begin(), ${1:v}.end()${2:, std::greater<${3:int}>()});'
            },
            {
                label: 'struct', detail: '结构体/类',
                insertText: 'struct ${1:Node} {\n\t${2}\n};'
            },
            {
                label: 'func', detail: '函数定义',
                insertText: '${1:int} ${2:func}(${3}) {\n\t${4}\n\treturn ${5:0};\n}'
            },
            {
                label: 'ios', detail: '快速 IO',
                insertText: 'std::ios::sync_with_stdio(false);\nstd::cin.tie(nullptr);'
            }
        ];

        this.monaco.languages.registerCompletionItemProvider('cpp', {
            provideCompletionItems: function (model, position) {
                var word = model.getWordUntilPosition(position);
                var range = {
                    startLineNumber: position.lineNumber,
                    endLineNumber: position.lineNumber,
                    startColumn: word.startColumn,
                    endColumn: word.endColumn
                };
                var suggestions = snippets.map(function (s, i) {
                    return {
                        label: s.label,
                        detail: s.detail,
                        insertText: s.insertText,
                        insertTextRules: self.monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
                        kind: self.monaco.languages.CompletionItemKind.Snippet,
                        range: range,
                        sortText: '0' + i
                    };
                });
                return { suggestions: suggestions };
            }
        });
    };

    EditorManager.prototype.getValue = function () {
        return this.editor ? this.editor.getValue() : '';
    };

    EditorManager.prototype.setValue = function (value) {
        if (this.editor) this.editor.setValue(value);
    };

    EditorManager.prototype.getSelection = function () {
        if (!this.editor) return '';
        var sel = this.editor.getSelection();
        if (!sel || sel.isEmpty()) return '';
        return this.editor.getModel().getValueInRange(sel);
    };

    EditorManager.prototype.focus = function () {
        if (this.editor) this.editor.focus();
    };

    EditorManager.prototype.undo = function () { this.editor && this.editor.trigger('keyboard', 'undo', null); };
    EditorManager.prototype.redo = function () { this.editor && this.editor.trigger('keyboard', 'redo', null); };
    EditorManager.prototype.format = function () {
        if (!this.editor) return;
        var action = this.editor.getAction('editor.action.formatDocument');
        if (action) action.run();
    };
    EditorManager.prototype.toggleComment = function () {
        if (!this.editor) return;
        var action = this.editor.getAction('editor.action.commentLine');
        if (action) action.run();
    };
    EditorManager.prototype.find = function () {
        if (!this.editor) return;
        this.editor.focus();
        this.editor.getAction('actions.find').run();
    };
    EditorManager.prototype.replace = function () {
        if (!this.editor) return;
        this.editor.focus();
        this.editor.getAction('editor.action.startFindReplaceAction').run();
    };
    EditorManager.prototype.cut = function () {
        if (!this.editor) return;
        this.editor.focus();
        this.editor.trigger('keyboard', 'editor.action.clipboardCutAction', null);
    };
    EditorManager.prototype.copy = function () {
        if (!this.editor) return;
        this.editor.focus();
        this.editor.trigger('keyboard', 'editor.action.clipboardCopyAction', null);
    };
    EditorManager.prototype.paste = function () {
        if (!this.editor) return;
        this.editor.focus();
        this.editor.trigger('keyboard', 'editor.action.clipboardPasteAction', null);
    };

    EditorManager.prototype.insertText = function (text) {
        if (!this.editor) return;
        var pos = this.editor.getPosition();
        this.editor.executeEdits('', [{
            range: new this.monaco.Range(pos.lineNumber, pos.column, pos.lineNumber, pos.column),
            text: text
        }]);
        this.editor.focus();
    };

    /**
     * 简单的大纲解析
     */
    EditorManager.prototype.getOutline = function () {
        var code = this.getValue();
        var outline = [];
        var lines = code.split('\n');
        var classRe = /^\s*(class|struct|enum)\s+(\w+)/;
        var funcRe = /^\s*(?:[\w:<>,\[\]\*&\s]+?)\s+(\w+)\s*\([^;]*\)\s*(?:const)?\s*\{?\s*$/;
        var includeRe = /^\s*#include\s*[<"]([^>"]+)[>"]/;

        lines.forEach(function (line, i) {
            var m;
            if ((m = line.match(classRe))) {
                outline.push({ type: m[1], name: m[2], line: i + 1 });
            } else if ((m = line.match(includeRe))) {
                if (outline.length < 1) outline.push({ type: 'include', name: m[1], line: i + 1 });
            } else if ((m = line.match(funcRe))) {
                var name = m[1];
                if (['if', 'for', 'while', 'switch', 'return', 'catch'].indexOf(name) === -1) {
                    outline.push({ type: 'function', name: name, line: i + 1 });
                }
            }
        });
        return outline;
    };

    EditorManager.prototype.goToLine = function (line) {
        if (!this.editor) return;
        this.editor.revealLineInCenter(line);
        this.editor.setPosition({ lineNumber: line, column: 1 });
        this.editor.focus();
    };

    EditorManager.prototype.dispose = function () {
        if (this.editor) {
            this.editor.dispose();
            this.editor = null;
        }
    };

    global.EditorManager = EditorManager;

})(window);
