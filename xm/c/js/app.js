/**
 * CppForge - 主应用逻辑
 */
(function () {
    'use strict';

    var SETTINGS_KEY = 'cppide.settings.v1';
    var RUN_PAYLOAD_KEY = 'cppforge.run.v1';

    var EXAMPLES = {
        hello: {
            name: 'hello.cpp',
            code: [
                '#include <iostream>',
                '',
                'int main() {',
                '    std::cout << "Hello, World!" << std::endl;',
                '    return 0;',
                '}',
                ''
            ].join('\n')
        },
        aplusb: {
            name: 'aplusb.cpp',
            stdin: '3 4',
            code: [
                '#include <iostream>',
                '',
                'int main() {',
                '    int a, b;',
                '    std::cin >> a >> b;',
                '    std::cout << a + b << std::endl;',
                '    return 0;',
                '}',
                ''
            ].join('\n')
        },
        fibonacci: {
            name: 'fibonacci.cpp',
            code: [
                '#include <iostream>',
                '',
                'long long fib(int n) {',
                '    return n < 2 ? n : fib(n - 1) + fib(n - 2);',
                '}',
                '',
                'int main() {',
                '    for (int i = 0; i < 20; ++i) {',
                '        std::cout << fib(i) << \' \';',
                '    }',
                '    std::cout << std::endl;',
                '    return 0;',
                '}',
                ''
            ].join('\n')
        },
        sort: {
            name: 'sort.cpp',
            code: [
                '#include <iostream>',
                '#include <vector>',
                '#include <algorithm>',
                '',
                'int main() {',
                '    std::vector<int> v{42, 7, 19, 3, 88, 15, 60};',
                '',
                '    std::sort(v.begin(), v.end());',
                '    std::cout << "升序: ";',
                '    for (int x : v) std::cout << x << \' \';',
                '    std::cout << std::endl;',
                '',
                '    std::sort(v.begin(), v.end(), [](int a, int b) {',
                '        return a > b;',
                '    });',
                '    std::cout << "降序: ";',
                '    for (int x : v) std::cout << x << \' \';',
                '    std::cout << std::endl;',
                '',
                '    return 0;',
                '}',
                ''
            ].join('\n')
        },
        class: {
            name: 'class.cpp',
            code: [
                '#include <iostream>',
                '#include <string>',
                '',
                'class Shape {',
                'public:',
                '    virtual ~Shape() = default;',
                '    virtual double area() const = 0;',
                '    virtual std::string name() const = 0;',
                '};',
                '',
                'class Rectangle : public Shape {',
                'public:',
                '    Rectangle(double w, double h) : w_(w), h_(h) {}',
                '    double area() const override { return w_ * h_; }',
                '    std::string name() const override { return "矩形"; }',
                'private:',
                '    double w_, h_;',
                '};',
                '',
                'class Circle : public Shape {',
                'public:',
                '    explicit Circle(double r) : r_(r) {}',
                '    double area() const override { return 3.14159 * r_ * r_; }',
                '    std::string name() const override { return "圆形"; }',
                'private:',
                '    double r_;',
                '};',
                '',
                'int main() {',
                '    Rectangle rect(4, 5);',
                '    Circle circle(3);',
                '    Shape* shapes[] = {&rect, &circle};',
                '    for (Shape* s : shapes) {',
                '        std::cout << s->name() << " 面积 = " << s->area() << std::endl;',
                '    }',
                '    return 0;',
                '}',
                ''
            ].join('\n')
        },
        stl: {
            name: 'stl.cpp',
            code: [
                '#include <iostream>',
                '#include <vector>',
                '#include <map>',
                '#include <set>',
                '#include <string>',
                '',
                'int main() {',
                '    std::map<std::string, int> scores{',
                '        {"Alice", 92}, {"Bob", 85}, {"Cindy", 99}',
                '    };',
                '    for (const auto& [name, score] : scores) {',
                '        std::cout << name << ": " << score << std::endl;',
                '    }',
                '',
                '    std::set<int> uniq{5, 1, 5, 3, 1, 3};',
                '    std::cout << "去重后: ";',
                '    for (int x : uniq) std::cout << x << \' \';',
                '    std::cout << std::endl;',
                '    return 0;',
                '}',
                ''
            ].join('\n')
        },
        pointer: {
            name: 'pointer.cpp',
            code: [
                '#include <iostream>',
                '',
                'void swapByRef(int& a, int& b) {',
                '    int t = a;',
                '    a = b;',
                '    b = t;',
                '}',
                '',
                'int main() {',
                '    int x = 10, y = 20;',
                '    swapByRef(x, y);',
                '    std::cout << "交换后: x=" << x << ", y=" << y << std::endl;',
                '',
                '    int* p = new int(42);',
                '    std::cout << "指针值: " << *p << std::endl;',
                '    delete p;',
                '    p = nullptr;',
                '',
                '    int arr[5] = {1, 2, 3, 4, 5};',
                '    int* q = arr;',
                '    std::cout << "首元素: " << *q << "，下一个: " << *(q + 1) << std::endl;',
                '    return 0;',
                '}',
                ''
            ].join('\n')
        },
        modern: {
            name: 'modern.cpp',
            code: [
                '#include <iostream>',
                '#include <vector>',
                '#include <string>',
                '#include <tuple>',
                '#include <type_traits>',
                '',
                'template <typename T>',
                'auto describe(const T& value) {',
                '    if constexpr (std::is_integral_v<T>) {',
                '        return std::string("整数: ") + std::to_string(value);',
                '    } else {',
                '        return std::string("其他类型");',
                '    }',
                '}',
                '',
                'int main() {',
                '    auto nums = std::vector{1, 2, 3, 4, 5};',
                '    int sum = 0;',
                '    for (auto n : nums) sum += n;',
                '    std::cout << describe(sum) << std::endl;',
                '',
                '    std::tuple<std::string, int, double> info{"C++", 17, 3.14};',
                '    auto& [lang, ver, pi] = info;',
                '    std::cout << lang << " " << ver << " pi=" << pi << std::endl;',
                '    return 0;',
                '}',
                ''
            ].join('\n')
        }
    };

    var SNIPPETS = [
        { icon: 'fa-terminal', label: '标准输入输出', code: '#include <iostream>\n\nint main() {\n    \n    return 0;\n}\n' },
        { icon: 'fa-arrow-right-arrow-left', label: 'A + B 模板', code: '#include <iostream>\n\nint main() {\n    int a, b;\n    std::cin >> a >> b;\n    std::cout << a + b << std::endl;\n    return 0;\n}\n' },
        { icon: 'fa-rotate', label: 'for 循环', code: 'for (int i = 0; i < n; ++i) {\n    \n}\n' },
        { icon: 'fa-layer-group', label: 'vector 容器', code: 'std::vector<int> v;\nfor (int x : v) {\n    std::cout << x << \' \';\n}\n' },
        { icon: 'fa-arrow-down-a-z', label: '排序', code: 'std::sort(v.begin(), v.end());\n' },
        { icon: 'fa-cube', label: '结构体', code: 'struct Node {\n    int value;\n    Node* next;\n};\n' },
        { icon: 'fa-bolt', label: '快速 IO', code: 'std::ios::sync_with_stdio(false);\nstd::cin.tie(nullptr);\n' }
    ];

    var App = {
        fm: null,
        em: null,
        settings: {
            compiler: 'gcc-13.2.0',
            standard: 'c++17',
            warnings: true,
            optimize: false,
            stdin: ''
        }
    };

    /* ------------------------------------------------------------------ */
    /*  初始化                                                             */
    /* ------------------------------------------------------------------ */

    App.init = async function () {
        this.loadSettings();

        this.fm = new FileManager();
        this.fm.init();

        this.em = new EditorManager();
        await this.em.init('monaco-editor', this.fm.getActiveContent());

        this.em.onCursor = function (line, col) {
            document.getElementById('status-cursor').textContent = '行 ' + line + ', 列 ' + col;
        };
        this.em.onSave = function () { App.saveFile(); };
        this.em.onRun = function () { App.run(); };

        // 内容变化时同步到文件管理器
        this.em.editor.onDidChangeModelContent(function () {
            var active = App.fm.getActive();
            if (active) {
                App.fm.update(active.name, App.em.getValue());
            }
            App.renderOutline();
        });

        this.fm.onChange = function (type) {
            if (type !== 'change') App.syncEditor();
            App.renderFileList();
            App.renderTabs();
            App.renderOutline();
        };

        this.applySettingsToUI();
        this.renderFileList();
        this.renderTabs();
        this.renderSnippets();
        this.renderOutline();
        this.bindEvents();

        var overlay = document.getElementById('boot-overlay');
        overlay.classList.add('hidden');
        setTimeout(function () { overlay.style.display = 'none'; }, 400);
        this.setStatus('就绪');
    };

    App.loadSettings = function () {
        try {
            var raw = localStorage.getItem(SETTINGS_KEY);
            if (raw) {
                var s = JSON.parse(raw);
                Object.assign(this.settings, s);
            }
        } catch (e) { /* ignore */ }
    };

    App.saveSettings = function () {
        try {
            localStorage.setItem(SETTINGS_KEY, JSON.stringify(this.settings));
        } catch (e) { /* ignore */ }
    };

    App.applySettingsToUI = function () {
        document.getElementById('compiler-select').value = this.settings.compiler;
        document.getElementById('standard-select').value = this.settings.standard;
        document.getElementById('opt-warnings').checked = this.settings.warnings;
        document.getElementById('opt-optimize').checked = this.settings.optimize;
        document.getElementById('stdin-input').value = this.settings.stdin || '';
        this.updateStatusBar();
    };

    App.updateStatusBar = function () {
        var c = CppCompiler.getCompiler(this.settings.compiler);
        var s = CppCompiler.getStandard(this.settings.standard);
        document.getElementById('status-std').textContent = s.label;
        document.getElementById('status-compiler').textContent = c.label;
        document.getElementById('status-language').textContent = s.label;
    };

    /* ------------------------------------------------------------------ */
    /*  事件绑定                                                           */
    /* ------------------------------------------------------------------ */

    App.bindEvents = function () {
        var self = this;

        // 菜单
        document.querySelectorAll('.menu-trigger').forEach(function (btn) {
            btn.addEventListener('click', function (e) {
                e.stopPropagation();
                var item = btn.parentElement;
                var open = item.classList.contains('open');
                document.querySelectorAll('.menu-item.open').forEach(function (m) { m.classList.remove('open'); });
                if (!open) item.classList.add('open');
            });
        });
        document.addEventListener('click', function () {
            document.querySelectorAll('.menu-item.open').forEach(function (m) { m.classList.remove('open'); });
        });
        document.querySelectorAll('.dropdown-menu').forEach(function (menu) {
            menu.addEventListener('click', function (e) { e.stopPropagation(); });
        });

        // 菜单项动作
        document.querySelectorAll('[data-action]').forEach(function (el) {
            el.addEventListener('click', function (e) {
                e.stopPropagation();
                App.handleAction(el.getAttribute('data-action'));
                document.querySelectorAll('.menu-item.open').forEach(function (m) { m.classList.remove('open'); });
            });
        });

        // 示例
        document.querySelectorAll('[data-example]').forEach(function (el) {
            el.addEventListener('click', function (e) {
                e.stopPropagation();
                App.loadExample(el.getAttribute('data-example'));
                document.querySelectorAll('.menu-item.open').forEach(function (m) { m.classList.remove('open'); });
            });
        });

        // 运行按钮
        document.getElementById('btn-run').addEventListener('click', function () { self.run(); });

        // 编译器 / 标准设置
        document.getElementById('compiler-select').addEventListener('change', function (e) {
            self.settings.compiler = e.target.value;
            self.saveSettings();
            self.updateStatusBar();
        });
        document.getElementById('standard-select').addEventListener('change', function (e) {
            self.settings.standard = e.target.value;
            self.saveSettings();
            self.updateStatusBar();
        });
        document.getElementById('opt-warnings').addEventListener('change', function (e) {
            self.settings.warnings = e.target.checked;
            self.saveSettings();
        });
        document.getElementById('opt-optimize').addEventListener('change', function (e) {
            self.settings.optimize = e.target.checked;
            self.saveSettings();
        });

        // stdin
        var stdin = document.getElementById('stdin-input');
        stdin.addEventListener('input', function () {
            self.settings.stdin = stdin.value;
            self.saveSettings();
        });
        document.getElementById('btn-clear-stdin').addEventListener('click', function () {
            stdin.value = '';
            self.settings.stdin = '';
            self.saveSettings();
        });

        // 侧边栏标签
        document.querySelectorAll('.sidebar-tab').forEach(function (tab) {
            tab.addEventListener('click', function () {
                document.querySelectorAll('.sidebar-tab').forEach(function (t) { t.classList.remove('active'); });
                document.querySelectorAll('.sidebar-panel').forEach(function (p) { p.classList.remove('active'); });
                tab.classList.add('active');
                document.getElementById('panel-' + tab.getAttribute('data-tab')).classList.add('active');
                if (tab.getAttribute('data-tab') === 'outline') App.renderOutline();
            });
        });

        // 新建文件
        document.getElementById('btn-new-file').addEventListener('click', function () { App.newFile(); });
        document.getElementById('btn-refresh-outline').addEventListener('click', function () { App.renderOutline(); });

        // 导入文件
        document.getElementById('file-input').addEventListener('change', function (e) {
            var file = e.target.files && e.target.files[0];
            if (!file) return;
            var reader = new FileReader();
            reader.onload = function () {
                var name = file.name || 'imported.cpp';
                App.fm.create(name, String(reader.result || ''));
                App.toast('已导入 ' + name, 'success');
            };
            reader.readAsText(file);
            e.target.value = '';
        });

        // 全局快捷键
        document.addEventListener('keydown', function (e) {
            var ctrl = e.ctrlKey || e.metaKey;
            if (e.key === 'F5') {
                e.preventDefault();
                self.run();
            } else if (ctrl && e.key.toLowerCase() === 's') {
                e.preventDefault();
                self.saveFile();
            } else if (ctrl && e.altKey && e.key.toLowerCase() === 'n') {
                e.preventDefault();
                self.newFile();
            } else if (ctrl && e.key.toLowerCase() === 'o') {
                e.preventDefault();
                document.getElementById('file-input').click();
            } else if (e.key === 'Escape') {
                document.querySelectorAll('.menu-item.open').forEach(function (m) { m.classList.remove('open'); });
                App.closeModal();
            }
        });
    };

    /* ------------------------------------------------------------------ */
    /*  动作处理                                                           */
    /* ------------------------------------------------------------------ */

    App.handleAction = function (action) {
        var em = this.em;
        switch (action) {
            case 'new-file': this.newFile(); break;
            case 'open-file': document.getElementById('file-input').click(); break;
            case 'save-file': this.saveFile(); break;
            case 'rename-file': this.renameFile(); break;
            case 'download-cpp': this.downloadCpp(); break;
            case 'download-exe-note':
                this.modal('关于产物说明',
                    '<p>编译在云端服务器完成，生成的 <code>main</code> 可执行文件运行于 Linux 服务器，不会下载到本地。</p>' +
                    '<p>如需可执行文件，请在本地使用 <code>g++</code> 编译：</p>' +
                    '<pre>g++ main.cpp -std=c++17 -O2 -o main</pre>');
                break;
            case 'undo': em.undo(); break;
            case 'redo': em.redo(); break;
            case 'cut': em.cut(); break;
            case 'copy': em.copy(); break;
            case 'paste': em.paste(); break;
            case 'find': em.find(); break;
            case 'replace': em.replace(); break;
            case 'format': em.format(); break;
            case 'comment': em.toggleComment(); break;
            case 'run': this.run(); break;
            case 'run-warn':
                this.settings.warnings = true;
                document.getElementById('opt-warnings').checked = true;
                this.saveSettings();
                this.run();
                break;
            case 'reset-editor':
                this.fm.update(this.fm.active, this.fm.defaultCode());
                this.syncEditor();
                this.toast('已恢复示例代码', 'success');
                break;
            case 'shortcuts': this.showShortcuts(); break;
            case 'about': this.showAbout(); break;
            case 'disclaimer': this.showDisclaimer(); break;
        }
    };

    App.newFile = function () {
        var name = prompt('新建文件名', 'untitled.cpp');
        if (name === null) return;
        name = name.trim();
        if (!name) return;
        this.fm.create(name, '');
        this.toast('已创建 ' + name, 'success');
    };

    App.renameFile = function () {
        var active = this.fm.getActive();
        if (!active) return;
        var name = prompt('重命名文件', active.name);
        if (name === null) return;
        var finalName = this.fm.rename(active.name, name.trim());
        if (finalName !== active.name) this.toast('已重命名为 ' + finalName, 'success');
    };

    App.saveFile = function () {
        this.fm.persist();
        this.setStatus('已保存到浏览器本地');
        this.toast('已保存', 'success');
    };

    App.syncEditor = function () {
        if (this.em && this.fm.getActive()) {
            this.em.setValue(this.fm.getActive().content);
        }
    };

    App.loadExample = function (key) {
        var ex = EXAMPLES[key];
        if (!ex) return;
        this.fm.create(ex.name, ex.code);
        if (typeof ex.stdin === 'string') {
            this.settings.stdin = ex.stdin;
            document.getElementById('stdin-input').value = ex.stdin;
            this.saveSettings();
        }
        this.toast('已载入示例：' + ex.name, 'success');
    };

    App.downloadCpp = function () {
        var active = this.fm.getActive();
        if (!active) return;
        var blob = new Blob([active.content], { type: 'text/x-c++src;charset=utf-8' });
        var a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = active.name.endsWith('.cpp') ? active.name : active.name + '.cpp';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
        this.toast('已下载 ' + a.download, 'success');
    };

    /* ------------------------------------------------------------------ */
    /*  运行：跳转到独立的命令执行窗口                                        */
    /* ------------------------------------------------------------------ */

    App.run = function () {
        var active = this.fm.getActive();
        if (!active) return;
        this.fm.update(active.name, this.em.getValue());
        this.fm.persist();
        this.settings.stdin = document.getElementById('stdin-input').value;
        this.saveSettings();

        var payload = {
            filename: active.name,
            code: this.em.getValue(),
            compiler: this.settings.compiler,
            standard: this.settings.standard,
            warnings: this.settings.warnings,
            optimize: this.settings.optimize,
            stdin: this.settings.stdin,
            ts: Date.now()
        };

        try {
            localStorage.setItem(RUN_PAYLOAD_KEY, JSON.stringify(payload));
        } catch (e) {
            this.toast('无法保存运行数据：' + e.message, 'error');
            return;
        }

        this.setStatus('正在打开命令窗口…');
        var win = window.open('terminal.html', '_blank');
        if (!win) {
            // 弹窗被拦截时，在当前页跳转
            location.href = 'terminal.html';
        }
    };

    /* ------------------------------------------------------------------ */
    /*  渲染                                                               */
    /* ------------------------------------------------------------------ */

    App.renderTabs = function () {
        var self = this;
        var tabs = document.getElementById('editor-tabs');
        tabs.innerHTML = '';
        this.fm.list().forEach(function (f) {
            var tab = document.createElement('div');
            tab.className = 'editor-tab' + (f.name === self.fm.active ? ' active' : '');
            tab.innerHTML = '<i class="fas fa-file-code"></i><span>' + self.escape(f.name) + '</span>' +
                (self.fm.list().length > 1 ? '<button class="tab-close" title="关闭"><i class="fas fa-xmark"></i></button>' : '');
            tab.addEventListener('click', function (e) {
                if (e.target.closest('.tab-close')) {
                    App.fm.remove(f.name);
                    return;
                }
                App.fm.setActive(f.name);
            });
            tab.addEventListener('dblclick', function (e) {
                if (e.target.closest('.tab-close')) return;
                App.fm.setActive(f.name);
                App.renameFile();
            });
            tabs.appendChild(tab);
        });
    };

    App.renderFileList = function () {
        var self = this;
        var list = document.getElementById('file-list');
        list.innerHTML = '';
        this.fm.list().forEach(function (f) {
            var row = document.createElement('div');
            row.className = 'file-row' + (f.name === self.fm.active ? ' active' : '');
            row.innerHTML = '<i class="fas fa-file-code"></i><span class="file-name">' + self.escape(f.name) + '</span>' +
                (self.fm.list().length > 1 ? '<button class="file-del" title="删除"><i class="fas fa-trash-can"></i></button>' : '');
            row.addEventListener('click', function (e) {
                if (e.target.closest('.file-del')) {
                    App.fm.remove(f.name);
                    return;
                }
                App.fm.setActive(f.name);
            });
            list.appendChild(row);
        });
    };

    App.renderSnippets = function () {
        var self = this;
        var list = document.getElementById('snippet-list');
        list.innerHTML = '';
        SNIPPETS.forEach(function (s) {
            var item = document.createElement('div');
            item.className = 'snippet-row';
            item.innerHTML = '<i class="fas ' + s.icon + '"></i><span>' + self.escape(s.label) + '</span>';
            item.addEventListener('click', function () {
                self.em.insertText(s.code);
                self.toast('已插入：' + s.label, 'success');
            });
            list.appendChild(item);
        });
    };

    App.renderOutline = function () {
        if (!this.em) return;
        var list = document.getElementById('outline-list');
        var items = this.em.getOutline();
        list.innerHTML = '';
        if (!items.length) {
            list.innerHTML = '<div class="empty-tip">暂无大纲，尝试定义函数或结构体</div>';
            return;
        }
        var icons = {
            class: 'fa-cube', struct: 'fa-cubes', enum: 'fa-list-ol',
            function: 'fa-function', include: 'fa-hashtag'
        };
        var self = this;
        items.forEach(function (it) {
            var row = document.createElement('div');
            row.className = 'outline-row outline-' + it.type;
            row.innerHTML = '<i class="fas ' + (icons[it.type] || 'fa-code') + '"></i>' +
                '<span class="outline-name">' + self.escape(it.name) + '</span>' +
                '<span class="outline-line">' + it.line + '</span>';
            row.addEventListener('click', function () { self.em.goToLine(it.line); });
            list.appendChild(row);
        });
    };

    /* ------------------------------------------------------------------ */
    /*  通用 UI                                                            */
    /* ------------------------------------------------------------------ */

    App.setStatus = function (msg) {
        var el = document.getElementById('status-message');
        if (el) el.textContent = msg || '';
    };

    App.toast = function (message, type) {
        var container = document.getElementById('toast-container');
        var el = document.createElement('div');
        el.className = 'toast toast-' + (type || 'info');
        var icon = type === 'error' ? 'fa-circle-exclamation' : (type === 'success' ? 'fa circle-check' : 'fa-circle-info');
        if (type === 'success') icon = 'fa-circle-check';
        el.innerHTML = '<i class="fas ' + icon + '"></i><span>' + this.escape(message) + '</span>';
        container.appendChild(el);
        setTimeout(function () {
            el.classList.add('show');
        }, 10);
        setTimeout(function () {
            el.classList.remove('show');
            setTimeout(function () { el.remove(); }, 300);
        }, 2600);
    };

    App.modal = function (title, html) {
        var container = document.getElementById('modal-container');
        container.innerHTML =
            '<div class="modal-mask">' +
            '<div class="modal-card">' +
            '<div class="modal-head"><h3>' + this.escape(title) + '</h3>' +
            '<button class="modal-close"><i class="fas fa-xmark"></i></button></div>' +
            '<div class="modal-body">' + html + '</div>' +
            '</div></div>';
        container.classList.add('show');
        var self = this;
        container.querySelector('.modal-close').addEventListener('click', function () { self.closeModal(); });
        container.querySelector('.modal-mask').addEventListener('click', function (e) {
            if (e.target === container.querySelector('.modal-mask')) self.closeModal();
        });
    };

    App.closeModal = function () {
        var container = document.getElementById('modal-container');
        container.classList.remove('show');
        container.innerHTML = '';
    };

    App.showShortcuts = function () {
        this.modal('快捷键', [
            '<table class="shortcut-table">',
            '<tr><td>运行代码</td><td><kbd>F5</kbd></td></tr>',
            '<tr><td>保存</td><td><kbd>Ctrl</kbd> + <kbd>S</kbd></td></tr>',
            '<tr><td>新建文件</td><td><kbd>Ctrl</kbd> + <kbd>Alt</kbd> + <kbd>N</kbd></td></tr>',
            '<tr><td>导入文件</td><td><kbd>Ctrl</kbd> + <kbd>O</kbd></td></tr>',
            '<tr><td>查找 / 替换</td><td><kbd>Ctrl</kbd> + <kbd>F</kbd> / <kbd>Ctrl</kbd> + <kbd>H</kbd></td></tr>',
            '<tr><td>注释</td><td><kbd>Ctrl</kbd> + <kbd>/</kbd></td></tr>',
            '<tr><td>格式化</td><td><kbd>Shift</kbd> + <kbd>Alt</kbd> + <kbd>F</kbd></td></tr>',
            '</table>'
        ].join(''));
    };

    App.showAbout = function () {
        this.modal('关于 CppForge', [
            '<p><strong>CppForge v2.0</strong> 是一个运行在浏览器中的 C++ 在线编译器。</p>',
            '<ul>',
            '<li>编辑器：Monaco Editor（C++ 语法高亮与补全）</li>',
            '<li>编译后端：Wandbox，使用真实的 GCC / Clang 进行编译</li>',
            '<li>运行环境：编译后的程序在 Linux 服务器沙箱中执行</li>',
            '<li>每次运行都会打开独立的命令执行窗口，展示完整的编译日志与运行结果</li>',
            '</ul>',
            '<p>支持 C++11 / 14 / 17 / 20 / 23 标准，支持标准输入（stdin）。</p>'
        ].join(''));
    };

    App.showDisclaimer = function () {
        this.modal('免责声明', [
            '<p>本工具依赖第三方公共服务（Wandbox）进行代码编译与执行，仅用于学习与教学演示。</p>',
            '<p>请勿提交任何敏感信息、恶意代码或违反法律法规的内容。因使用本工具产生的任何后果由使用者自行承担。</p>',
            '<p>编译服务不可用时，请稍后重试或更换网络环境。</p>'
        ].join(''));
    };

    App.escape = function (str) {
        return String(str).replace(/[&<>"']/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
    };

    document.addEventListener('DOMContentLoaded', function () {
        App.init().catch(function (err) {
            console.error(err);
            document.getElementById('boot-status').textContent = '加载失败：' + err.message;
            document.getElementById('boot-status').classList.add('error');
        });
    });

    window.app = App;

})();
