/**
 * 蟒蛇 Python在线编译器 - Pyodide管理器
 * 支持多镜像源切换和本地化加载
 */

class PyodideManager {
    constructor() {
        this.pyodide = null;
        this.isReady = false;
        this.isInitializing = false;
        this.installedPackages = new Set();
        this.outputBuffer = [];
        this.errorBuffer = [];
        
        // 执行中断支持
        this.interruptBuffer = new Uint8Array(1);
        
        // 交互式 input() 支持
        this._inputWaiting = false;
        this._inputValue = null;
        this._inputPrompt = '';
        
        // 镜像源列表（优先级从高到低）
        this.mirrorUrls = [
            'https://cdn.jsdmirror.com/pyodide/v0.26.0/full/',  // JSDMirror国内镜像
            'https://fastly.jsdelivr.net/pyodide/v0.26.0/full/', // Fastly镜像
            'https://cdn.jsdelivr.net/pyodide/v0.26.0/full/',    // jsDelivr官方
            'https://pyodide-cdn2.iodide.io/v0.26.0/full/'      // 官方CDN
        ];
        
        // 本地路径（如果用户下载了Pyodide）
        this.localUrl = './pyodide/';
        this.useLocal = false;
    }
    
    /**
     * 初始化Pyodide
     */
    async init(progressCallback) {
        if (this.isReady || this.isInitializing) {
            return this.isReady;
        }
        
        this.isInitializing = true;
        
        try {
            progressCallback?.('正在检查加速镜像...', 5);
            
            // 尝试加载Pyodide
            let loaded = false;
            let lastError = null;
            
            // 首先尝试本地版本
            if (this.useLocal) {
                progressCallback?.('尝试加载本地Python运行时...', 10);
                try {
                    loaded = await this._loadFromUrl(this.localUrl, progressCallback);
                } catch (e) {
                    console.warn('本地加载失败:', e);
                }
            }
            
            // 如果本地失败，尝试镜像源
            if (!loaded) {
                for (let i = 0; i < this.mirrorUrls.length; i++) {
                    const url = this.mirrorUrls[i];
                    const mirrorName = this._getMirrorName(url);
                    
                    progressCallback?.(`正在从${mirrorName}加载...`, 10 + (i + 1) * 15);
                    
                    try {
                        loaded = await this._loadFromUrl(url, progressCallback);
                        if (loaded) {
                            console.log(`✅ 成功从${mirrorName}加载Pyodide`);
                            break;
                        }
                    } catch (e) {
                        console.warn(`${mirrorName}加载失败:`, e.message);
                        lastError = e;
                    }
                }
            }
            
            if (!loaded) {
                throw new Error('所有镜像源加载失败: ' + (lastError?.message || '未知错误'));
            }
            
            // 设置输出重定向
            this._setupOutputCapture();
            
            // 设置中断缓冲区，使停止按钮可中断纯 Python 循环
            try {
                this.pyodide.setInterruptBuffer(this.interruptBuffer);
            } catch (e) {
                console.warn('当前 Pyodide 版本不支持 setInterruptBuffer，停止按钮将无法中断无限循环', e);
            }
            
            progressCallback?.('初始化完成', 100);
            
            this.isReady = true;
            this.isInitializing = false;
            
            console.log('🐍 Pyodide初始化完成');
            console.log('Python版本:', this.pyodide.runPython('import sys; sys.version'));
            
            return true;
            
        } catch (error) {
            console.error('Pyodide初始化失败:', error);
            this.isInitializing = false;
            throw error;
        }
    }
    
    /**
     * 从指定URL加载Pyodide
     */
    async _loadFromUrl(indexUrl, progressCallback) {
        return new Promise((resolve, reject) => {
            // 动态加载pyodide.js
            const script = document.createElement('script');
            script.src = indexUrl + 'pyodide.js';
            script.async = true;
            
            script.onload = async () => {
                try {
                    progressCallback?.('正在初始化Python环境...', 50);
                    
                    this.pyodide = await loadPyodide({
                        indexURL: indexUrl
                    });
                    
                    resolve(true);
                } catch (e) {
                    reject(e);
                }
            };
            
            script.onerror = () => {
                reject(new Error('脚本加载失败'));
            };
            
            // 设置超时
            const timeout = setTimeout(() => {
                script.remove();
                reject(new Error('加载超时'));
            }, 60000); // 60秒超时
            
            document.head.appendChild(script);
        });
    }
    
    /**
     * 获取镜像名称
     */
    _getMirrorName(url) {
        if (url.includes('jsdmirror')) return 'JSDMirror国内镜像';
        if (url.includes('fastly')) return 'Fastly镜像';
        if (url.includes('jsdelivr')) return 'jsDelivr';
        if (url.includes('iodide')) return '官方CDN';
        if (url.includes('./')) return '本地';
        return 'CDN';
    }
    
    /**
     * 设置输出捕获和交互式输入处理
     */
    _setupOutputCapture() {
        // 使用Pyodide的setStdout和setStderr
        this.pyodide.setStdout({
            batched: (text) => {
                this.outputBuffer.push(text);
            }
        });
        
        this.pyodide.setStderr({
            batched: (text) => {
                this.errorBuffer.push(text);
            }
        });
        
        // 暴露 JS 桥接函数给 Python 调用
        // _py_input_requested: Python 调用 input() 时通知 JS
        window._py_input_requested = (prompt) => {
            this._inputWaiting = true;
            this._inputValue = null;
            this._inputPrompt = prompt || '';
            
            // 立即刷新 stdout 缓冲区到控制台，让 prompt 提示可见
            this._flushStdout();
            
            // 通知 app 更新控制台状态为等待输入
            if (window.app && window.app._setConsoleState) {
                window.app._setConsoleState('awaiting-input');
            }
            
            // 自动聚焦控制台输入框
            const inputEl = document.getElementById('console-input');
            if (inputEl) {
                inputEl.focus();
                inputEl.placeholder = prompt || window.t?.('console.inputPlaceholder') || '请输入...';
            }
        };
        
        // _py_try_get_input: Python 轮询是否有输入可用
        window._py_try_get_input = () => {
            if (this._inputValue !== null) {
                const val = this._inputValue;
                this._inputValue = null;
                this._inputWaiting = false;
                return val;
            }
            return null;
        };
        
        // 覆盖 Python 的 input 函数，使用 time.sleep 轮询
        // time.sleep 在 Pyodide 中使用 emscripten_sleep (Asyncify)，
        // 会释放控制权给 JS 事件循环，使浏览器能处理用户输入
        this.pyodide.runPython(`
import sys
import builtins
import time

class _InputFunction:
    """交互式 input 函数，使用 time.sleep 轮询 JS 侧输入。
    time.sleep 在 Pyodide 中通过 emscripten_sleep (Asyncify)
    实现，每次 sleep 都会释放控制权给 JS 事件循环。"""
    
    def __call__(self, prompt=""):
        import js
        
        if prompt:
            sys.stdout.write(prompt)
            sys.stdout.flush()
        
        # 通知 JS 侧等待输入
        js._py_input_requested(prompt)
        
        # 轮询等待输入，每次 sleep 释放控制权
        while True:
            val = js._py_try_get_input()
            if val is not None:
                return str(val)
            time.sleep(0.1)

# 替换内置 input
_input_func = _InputFunction()
builtins.input = _input_func
        `);
    }
    
    /**
     * 检查是否正在等待交互式输入
     */
    isWaitingInput() {
        return this._inputWaiting;
    }
    
    /**
     * 获取当前 input 提示信息
     */
    getInputPrompt() {
        return this._inputPrompt;
    }
    
    /**
     * 用户输入值，用于恢复 Python 的 input() 等待
     * @param {string} value 用户输入的值
     */
    resolveUserInput(value) {
        if (this._inputWaiting) {
            this._inputValue = String(value);
        }
    }
    
    /**
     * 取消交互式输入等待（ESC 键触发），返回空字符串
     */
    cancelInput() {
        if (this._inputWaiting) {
            this._inputValue = '';
            this._inputWaiting = false;
            if (window.app && window.app._setConsoleState) {
                window.app._setConsoleState('idle');
            }
        }
    }
    
    /**
     * 重置输入状态
     */
    resetInput() {
        this._inputWaiting = false;
        this._inputValue = null;
        this._inputPrompt = '';
        
        // 恢复控制台输入框 placeholder
        const inputEl = document.getElementById('console-input');
        if (inputEl) {
            inputEl.placeholder = window.t?.('console.inputPlaceholder') || '输入 Python 表达式...';
        }
    }
    
    /**
     * 刷新 stdout 缓冲区到控制台（用于交互式 input 时即时显示 prompt）
     */
    _flushStdout() {
        if (this.outputBuffer.length > 0) {
            const text = this.outputBuffer.join('');
            this.outputBuffer = [];
            if (window.consoleManager) {
                window.consoleManager.write(text, 'output');
            }
        }
    }
    
    /**
     * 运行Python代码
     * @param {string} code Python代码
     */
    async runCode(code) {
        if (!this.isReady) {
            throw new Error('Python运行时未初始化');
        }
        
        // 清空缓冲区
        this.outputBuffer = [];
        this.errorBuffer = [];
        
        // 重置输入状态
        this.resetInput();
        
        // 重置中断缓冲区
        this.interruptBuffer[0] = 0;
        
        let result = null;
        let error = null;
        
        try {
            result = await this.pyodide.runPythonAsync(code);
        } catch (e) {
            error = e;
        }
        
        // 获取输出：为每个 batched chunk 补换行，防止多个 print 被粘成一行
        const stdout = this.outputBuffer.map(chunk => chunk.endsWith('\n') ? chunk : chunk + '\n').join('');
        const stderr = this.errorBuffer.map(chunk => chunk.endsWith('\n') ? chunk : chunk + '\n').join('');
        
        return {
            success: !error,
            result: result,
            stdout: stdout,
            stderr: stderr,
            error: error ? this._formatError(error) : null,
            rawError: error || null
        };
    }
    
    /**
     * 格式化错误信息
     */
    _formatError(error) {
        if (!error) return null;
        
        let message = error.message || String(error);
        const lines = message.split('\n');
        const errorLines = [];
        let foundError = false;
        
        for (const line of lines) {
            if (line.includes('Error:') || line.includes('Exception:') || line.includes('Traceback')) {
                foundError = true;
            }
            if (foundError) {
                errorLines.push(line);
            }
        }
        
        return errorLines.length > 0 ? errorLines.join('\n') : message;
    }
    
    /**
     * 解析错误，提取问题列表（行号、错误类型、消息）
     */
    parseProblems(error) {
        if (!error) return [];
        
        const message = error.message || String(error);
        const lines = message.split('\n');
        const problems = [];
        
        let currentFile = '<exec>';
        let currentLine = null;
        
        for (const line of lines) {
            // 匹配 File "xxx", line N, in ...
            const fileMatch = line.match(/File\s+"([^"]+)",\s+line\s+(\d+)/);
            if (fileMatch) {
                currentFile = fileMatch[1];
                currentLine = parseInt(fileMatch[2], 10);
                continue;
            }
            
            // 匹配错误类型: ErrorType: message
            const errMatch = line.match(/^(\w+(?:Error|Exception|Warning)):\s*(.*)/);
            if (errMatch) {
                problems.push({
                    file: currentFile,
                    line: currentLine || 1,
                    type: errMatch[1],
                    message: errMatch[2] || errMatch[0]
                });
                currentLine = null;
                continue;
            }
            
            // 匹配 KeyboardInterrupt 等无冒号的错误
            const simpleErrMatch = line.match(/^(\w+(?:Error|Exception|Interrupt))\s*$/);
            if (simpleErrMatch) {
                problems.push({
                    file: currentFile,
                    line: currentLine || 1,
                    type: simpleErrMatch[1],
                    message: simpleErrMatch[1]
                });
                currentLine = null;
            }
        }
        
        return problems;
    }
    
    /**
     * 安装包
     */
    async installPackage(packageName) {
        if (!this.isReady) {
            throw new Error('Python运行时未初始化');
        }
        
        if (this.installedPackages.has(packageName)) {
            return { success: true, message: `${packageName} 已安装` };
        }
        
        try {
            // 先尝试使用loadPackage（更快）
            await this.pyodide.loadPackage(packageName);
            this.installedPackages.add(packageName);
            return { success: true, message: `${packageName} 安装成功` };
        } catch (error) {
            // 再尝试micropip
            try {
                await this.pyodide.runPythonAsync(`
import micropip
await micropip.install('${packageName}')
                `);
                this.installedPackages.add(packageName);
                return { success: true, message: `${packageName} 安装成功` };
            } catch (e) {
                return { success: false, error: e.message };
            }
        }
    }
    
    /**
     * 获取已安装包列表
     */
    async getInstalledPackages() {
        if (!this.isReady) return [];
        return Array.from(this.installedPackages);
    }
    
    /**
     * 获取Python版本
     */
    getVersion() {
        if (!this.isReady) return null;
        try {
            return this.pyodide.runPython(`
import sys
f"{sys.version_info.major}.{sys.version_info.minor}.{sys.version_info.micro}"
            `);
        } catch {
            return 'Unknown';
        }
    }
    
    /**
     * 获取变量列表
     */
    getVariables() {
        if (!this.isReady) return [];
        try {
            const vars = this.pyodide.runPython(`
import sys
result = []
for name, value in globals().items():
    if not name.startswith('_'):
        try:
            result.append((name, type(value).__name__, str(value)[:100]))
        except:
            pass
result
            `);
            return vars.toJs().map(([name, type, value]) => ({ name, type, value }));
        } catch {
            return [];
        }
    }
    
    /**
     * 重置环境
     */
    reset() {
        if (!this.isReady) return;
        try {
            this.pyodide.runPython(`
for name in list(globals().keys()):
    if not name.startswith('_') and name not in ['sys', 'os', 'micropip']:
        del globals()[name]
            `);
        } catch (error) {
            console.error('重置环境失败:', error);
        }
    }
    
    /**
     * 中断执行
     */
    interrupt() {
        if (!this.isReady) return;
        // 向中断缓冲区写入非零值，Pyodide 会在下一次 Python 字节码边界检查并抛出 KeyboardInterrupt
        this.interruptBuffer[0] = 2;
        console.warn('中断请求已发送');
    }
    
    /**
     * 获取内存使用
     */
    getMemoryUsage() {
        if (performance.memory) {
            return {
                used: performance.memory.usedJSHeapSize,
                total: performance.memory.totalJSHeapSize
            };
        }
        return null;
    }
}

// 创建全局实例
window.pyodideManager = new PyodideManager();

console.log('Pyodide管理器加载完成');
