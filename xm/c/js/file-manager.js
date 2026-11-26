/**
 * CppForge - 文件管理器
 * 负责多文件的管理与本地持久化
 */
(function (global) {
    'use strict';

    var STORAGE_KEY = 'cppide.files.v1';

    var DEFAULT_CODE = [
        '// ============================================',
        '//  CppForge · C++ 在线编译器',
        '//  写好代码后点击右上角「运行」，将打开独立的命令窗口',
        '// ============================================',
        '',
        '#include <iostream>',
        '#include <vector>',
        '#include <string>',
        '#include <algorithm>',
        '',
        'int main() {',
        '    std::cout << "Hello, C++!" << std::endl;',
        '',
        '    std::vector<int> nums{5, 2, 9, 1, 7, 3};',
        '    std::sort(nums.begin(), nums.end());',
        '',
        '    std::cout << "排序后: ";',
        '    for (int n : nums) {',
        '        std::cout << n << \' \';',
        '    }',
        '    std::cout << std::endl;',
        '',
        '    int sum = 0;',
        '    for (int n : nums) sum += n;',
        '    std::cout << "总和: " << sum << std::endl;',
        '',
        '    return 0;',
        '}',
        ''
    ].join('\n');

    function FileManager() {
        this.files = [];
        this.active = 'main.cpp';
        this.onChange = null;
        this._loaded = false;
    }

    FileManager.prototype.init = function () {
        try {
            var raw = localStorage.getItem(STORAGE_KEY);
            if (raw) {
                var parsed = JSON.parse(raw);
                if (parsed && Array.isArray(parsed.files) && parsed.files.length) {
                    this.files = parsed.files.map(function (f) {
                        return { name: String(f.name), content: String(f.content == null ? '' : f.content) };
                    });
                    this.active = this.files.some(function (f) { return f.name === parsed.active; })
                        ? parsed.active
                        : this.files[0].name;
                    this._loaded = true;
                }
            }
        } catch (e) {
            console.warn('读取本地文件失败:', e);
        }

        if (!this._loaded) {
            this.files = [{ name: 'main.cpp', content: DEFAULT_CODE }];
            this.active = 'main.cpp';
            this.persist();
        }
        return this;
    };

    FileManager.prototype.persist = function () {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify({
                files: this.files,
                active: this.active
            }));
        } catch (e) {
            console.warn('保存本地文件失败:', e);
        }
    };

    FileManager.prototype._notify = function (type) {
        if (typeof this.onChange === 'function') this.onChange(type || 'change');
    };

    FileManager.prototype.list = function () {
        return this.files;
    };

    FileManager.prototype.getActive = function () {
        var name = this.active;
        return this.files.find(function (f) { return f.name === name; }) || null;
    };

    FileManager.prototype.getActiveContent = function () {
        var f = this.getActive();
        return f ? f.content : '';
    };

    FileManager.prototype.setActive = function (name) {
        if (!this.files.some(function (f) { return f.name === name; })) return false;
        this.active = name;
        this.persist();
        this._notify('active');
        return true;
    };

    FileManager.prototype.uniqueName = function (base) {
        var name = base;
        var i = 1;
        var dot = base.lastIndexOf('.');
        var stem = dot > 0 ? base.slice(0, dot) : base;
        var ext = dot > 0 ? base.slice(dot) : '';
        while (this.files.some(function (f) { return f.name === name; })) {
            name = stem + '_' + i + ext;
            i++;
        }
        return name;
    };

    FileManager.prototype.create = function (name, content) {
        var finalName = this.uniqueName(name || 'untitled.cpp');
        this.files.push({ name: finalName, content: content || '' });
        this.active = finalName;
        this.persist();
        this._notify('create');
        return finalName;
    };

    FileManager.prototype.rename = function (oldName, newName) {
        newName = String(newName || '').trim();
        if (!newName || newName === oldName) return oldName;
        var f = this.files.find(function (x) { return x.name === oldName; });
        if (!f) return oldName;
        if (this.files.some(function (x) { return x.name === newName; })) return oldName;
        f.name = newName;
        if (this.active === oldName) this.active = newName;
        this.persist();
        this._notify('rename');
        return newName;
    };

    FileManager.prototype.remove = function (name) {
        if (this.files.length <= 1) return false;
        var idx = this.files.findIndex(function (f) { return f.name === name; });
        if (idx < 0) return false;
        this.files.splice(idx, 1);
        if (this.active === name) {
            this.active = this.files[Math.min(idx, this.files.length - 1)].name;
        }
        this.persist();
        this._notify('remove');
        return true;
    };

    FileManager.prototype.update = function (name, content) {
        var f = this.files.find(function (x) { return x.name === name; });
        if (!f) return;
        f.content = content;
        this.persist();
    };

    FileManager.prototype.setAll = function (files, active) {
        this.files = files;
        this.active = active;
        this.persist();
    };

    FileManager.prototype.defaultCode = function () {
        return DEFAULT_CODE;
    };

    global.FileManager = FileManager;

})(window);
