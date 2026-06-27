/**
 * MLTSF 扩展包管理器 v3.0
 * ========================
 * 支持从静态CDN（通常部署在GitHub上）加载扩展包，
 * 扩展包可以注册新命令、提供新功能、加载CSS/JS资源文件。
 * 支持命令冲突检测和用户交互解决。
 * 支持扩展包依赖管理和自动加载。
 *
 * 注意: ExtensionAPI 现在由 extension-sdk.js 提供 v3.0 版本，
 * 包含丰富的资源加载、UI渲染、命令自动化、配置持久化等功能。
 */

// 扩展包管理器
let extensionManager = {
    /** 扩展包元数据存储 { 包名: { config, status } } */
    extensions: {},

    /** 扩展包注册的定时器 { 包名: [{ id, type }] } */
    _extTimers: {},

    /** 已加载的扩展包名列表 */
    loadedExtensions: [],

    /** 已注册的扩展命令 { '/命令名': { handler, description, source } } */
    registeredCommands: {},

    /** 内置命令列表（用于冲突检测） */
    builtInCommands: [
        '/help', '/hj', '/cq', '/qk', '/color',
        '/jr', '/ex', '/op', '/y', '/bq',
        '/run', '/dc', '/xj', '/d', '/b',
        '/wr', '/lxe', '/查看扩展包', '/ap', '/rm', '/az', '/ar',
        '/ai', '/aic', '/extlist', '/runxt', '/extstatus'
    ],

    /** 扩展包注册表 { 包名: { user, repo, path } } */
    registry: {},

    /** 是否正在等待冲突解决 */
    _awaitingConflictResolution: false,
    _conflictResolveQueue: [],

    /**
     * 初始化
     */
    init() {
        // 关联ExtensionAPI (v3.0 SDK)
        if (window.ExtensionAPI && window.ExtensionAPI._init) {
            window.ExtensionAPI._init(this);
        }

        // 加载保存的已加载扩展包列表
        this._loadState();

        // 加载注册表
        this._loadRegistry();

        terminal.println(`扩展包管理器已就绪`, 'success-line');

        // 自动加载标记为 autoLoad 的扩展包
        setTimeout(() => {
            this._autoLoadExtensions();
        }, 300);
    },

    /**
     * 自动加载标记为 autoLoad 或之前已加载的扩展包
     */
    _autoLoadExtensions() {
        const autoLoadList = this.getAutoLoadList();
        if (autoLoadList.length === 0) return;

        terminal.println('');
        terminal.println('检测到需要自动加载的扩展包...', 'info-line');

        for (const extName of autoLoadList) {
            // 避免重复加载
            if (this.loadedExtensions.includes(extName)) continue;

            // 异步逐个加载
            setTimeout(() => {
                this.loadExtension(extName).catch(err => {
                    console.warn(`自动加载 '${extName}' 失败:`, err);
                });
            }, 100 * (autoLoadList.indexOf(extName) + 1));
        }
    },

    /**
     * 获取需要自动加载的扩展包列表
     * @returns {string[]} 扩展包名列表
     */
    getAutoLoadList() {
        // 优先级: 1. 之前已经加载过的  2. 配置了 autoLoad: true 的
        const autoLoadSet = new Set();

        // 从保存的状态中获取已加载列表
        if (this.loadedExtensions && this.loadedExtensions.length > 0) {
            // 只自动加载那些元数据完整的
            for (const name of this.loadedExtensions) {
                const ext = this.extensions[name];
                if (ext && ext.config) {
                    // 如果显式设置了 autoLoad: false 则不加载
                    if (ext.config.autoLoad !== false) {
                        autoLoadSet.add(name);
                    }
                }
            }
        }

        return Array.from(autoLoadSet);
    },

    // ========================
    // 用户命令接口
    // ========================

    /**
     * 加载一个扩展包
     * 用法: /ap <扩展包名>
     *       /ap <扩展包名> <github用户名> <仓库名>
     *       /ap <扩展包名> <自定义CDN基URL>
     * @param {string[]} args - 命令参数
     */
    async loadExtension(extName, ...extraArgs) {
        // 如果第一个参数是数组（来自terminal.js的args拆分），取元素0
        if (Array.isArray(extName)) {
            extraArgs = extName.slice(1);
            extName = extName[0];
        }

        if (!extName) {
            terminal.println('用法:', 'info-line');
            terminal.println('  /ap <扩展包名>                           - 从注册表中加载扩展包', 'info-line');
            terminal.println('  /ap <扩展包名> <github用户> <仓库名>     - 从GitHub加载扩展包并注册', 'info-line');
            terminal.println('  /ap <扩展包名> <自定义CDN基URL>          - 从自定义CDN加载扩展包并注册', 'info-line');
            terminal.println('示例:', 'info-line');
            terminal.println('  /ap my-extension', 'info-line');
            terminal.println('  /ap my-extension someuser somerepo', 'info-line');
            return;
        }

        // 检查是否已加载
        if (this.loadedExtensions.includes(extName)) {
            terminal.println(`扩展包 '${extName}' 已加载`, 'info-line');
            terminal.println('如需重新加载请先使用 /rm 卸载', 'info-line');
            return;
        }

        let cdnBaseUrl;

        if (extraArgs.length >= 2 && extraArgs[0] && extraArgs[1]) {
            // 格式: /ap <包名> <github用户> <仓库名>
            const githubUser = extraArgs[0];
            const repoName = extraArgs[1];
            cdnBaseUrl = `https://raw.githubusercontent.com/${githubUser}/${repoName}/main/extensions/${extName}/`;
            // 添加到注册表
            this._addToRegistry(extName, githubUser, repoName);
            terminal.println(`已将 '${extName}' 注册到GitHub: ${githubUser}/${repoName}`, 'info-line');
        } else if (extraArgs.length >= 1 && extraArgs[0]) {
            // 自定义CDN URL
            let customUrl = extraArgs[0];
            if (!customUrl.endsWith('/')) customUrl += '/';
            cdnBaseUrl = customUrl;
        } else if (this.registry[extName]) {
            // 从注册表获取
            const reg = this.registry[extName];
            cdnBaseUrl = `https://raw.githubusercontent.com/${reg.user}/${reg.repo}/main/extensions/${extName}/`;
        } else {
            terminal.println(`错误: 扩展包 '${extName}' 未在注册表中找到`, 'error-line');
            terminal.println('请使用以下格式注册:', 'info-line');
            terminal.println('  /ap <扩展包名> <github用户> <仓库名>', 'info-line');
            return;
        }

        terminal.println(`正在从CDN加载扩展包 '${extName}'...`, 'info-line');
        terminal.println(`CDN地址: ${cdnBaseUrl}`, 'info-line');

        // 发射 beforeLoad 事件（含生命周期钩子）
        if (window.ExtensionAPI && window.ExtensionAPI._emit) {
            window.ExtensionAPI._emit('beforeLoad', { name: extName, cdnBaseUrl: cdnBaseUrl });
        }

        try {
            // 1. 获取扩展包配置
            const config = await this._fetchConfig(cdnBaseUrl, extName);

            // 2. 检查依赖是否满足（含版本约束）
            const dependencies = this._extractDependencies(config.dependencies);
            if (dependencies.length > 0) {
                var depNames = dependencies.map(function(d) { return d.constraint ? d.name + '@' + d.constraint : d.name; });
                terminal.println(`检测到依赖: ${depNames.join(', ')}`, 'info-line');
                var missingDeps = [];
                for (var di = 0; di < dependencies.length; di++) {
                    var dep = dependencies[di];
                    if (!this.loadedExtensions.includes(dep.name)) {
                        missingDeps.push(dep.name);
                        continue;
                    }
                    // 版本约束检查
                    if (dep.constraint) {
                        var depExt = this.extensions[dep.name];
                        var depVersion = (depExt && depExt.config && depExt.config.version) || '0.0.0';
                        if (!this._satisfiesVersion(depVersion, dep.constraint)) {
                            missingDeps.push(dep.name + ' (需要' + dep.constraint + ', 当前' + depVersion + ')');
                        }
                    }
                }
                if (missingDeps.length > 0) {
                    terminal.println(`错误: 缺少依赖扩展包: ${missingDeps.join(', ')}`, 'error-line');
                    terminal.println('请先安装依赖扩展包再重试', 'info-line');
                    return;
                }
                terminal.println('所有依赖已满足', 'success-line');
            }

            // 3. 检测命令冲突
            const commandsToRegister = config.commands || [];
            const hasConflict = this._checkConflicts(extName, commandsToRegister);

            if (hasConflict) {
                // 进入冲突解决流程
                terminal.println('检测到命令冲突，正在处理...', 'warning-line');
                const shouldContinue = await this._resolveConflicts(extName, commandsToRegister);
                if (!shouldContinue) {
                    terminal.println(`已取消加载扩展包 '${extName}'`, 'info-line');
                    return;
                }
            }

            // 4. 加载扩展包CSS样式文件 (在main.js之前加载，确保样式先就绪)
            const styles = config.styles || [];
            if (styles.length > 0) {
                terminal.println(`正在加载样式文件 (${styles.length} 个)...`, 'info-line');
                for (const styleFile of styles) {
                    const styleUrl = styleFile.startsWith('http') ? styleFile : cdnBaseUrl + styleFile;
                    await this._loadExtensionCSS(styleUrl, extName);
                }
            }

            // 5. 预加载辅助脚本
            const preScripts = config.scripts || [];
            if (preScripts.length > 0) {
                terminal.println(`正在预加载辅助脚本 (${preScripts.length} 个)...`, 'info-line');
                for (const scriptFile of preScripts) {
                    const scriptUrl = scriptFile.startsWith('http') ? scriptFile : cdnBaseUrl + scriptFile;
                    await this._loadScript(scriptUrl);
                }
            }

            // 6. 设置SDK上下文 (让SDK知道当前扩展包的名称、配置和CDN基URL)
            if (window.ExtensionAPI && window.ExtensionAPI._setContext) {
                window.ExtensionAPI._setContext(this, extName, config, cdnBaseUrl);
            }

            // 7. 加载main.js (执行扩展包主逻辑)
            const mainFile = config.main || 'main.js';
            await this._loadScript(cdnBaseUrl + mainFile);

            // 8. 保存扩展包元数据
            this.extensions[extName] = {
                config: config,
                cdnBaseUrl: cdnBaseUrl,
                status: 'loaded',
                loadedAt: new Date().toISOString(),
                registeredCommands: commandsToRegister.map(c =>
                    c.name.startsWith('/') ? c.name : '/' + c.name
                ),
                loadedCSS: styles,
                loadedScripts: preScripts
            };

            if (!this.loadedExtensions.includes(extName)) {
                this.loadedExtensions.push(extName);
            }

            // 9. 保存状态
            this._saveState();

            terminal.println(`╔══════════════════════════════════════════╗`, 'success-line');
            terminal.println(`║  扩展包 '${extName}' 加载成功!`, 'success-line');
            terminal.println(`║  版本: ${config.version || '未知'}`, 'success-line');
            terminal.println(`║  已注册 ${commandsToRegister.length} 个命令`, 'success-line');
            if (styles.length > 0) {
                terminal.println(`║  已加载样式: ${styles.length} 个`, 'success-line');
            }
            if (preScripts.length > 0) {
                terminal.println(`║  已加载脚本: ${preScripts.length} 个`, 'success-line');
            }
            terminal.println(`╚══════════════════════════════════════════╝`, 'success-line');

            // 10. 发送扩展加载完成事件
            if (window.ExtensionAPI && window.ExtensionAPI._emit) {
                window.ExtensionAPI._emit('ready', { name: extName, config: config });
            }

        } catch (error) {
            // 发射 error 事件
            if (window.ExtensionAPI && window.ExtensionAPI._emit) {
                window.ExtensionAPI._emit('error', { name: extName, error: error, phase: 'load' });
            }
            terminal.println(`加载扩展包 '${extName}' 失败: ${error.message}`, 'error-line');
            if (error.message.includes('404') || error.message.includes('Not Found')) {
                terminal.println('提示: 请检查扩展包名、GitHub用户名和仓库名是否正确', 'info-line');
            }
        }
    },

    /**
     * 从 GitHub raw URL 直接加载扩展包
     * 用法: /az <GitHub-raw-URL>
     * @param {string} url - GitHub raw 文件 URL
     */
    async loadExtensionFromUrl(url) {
        // 如果传入的是数组（来自terminal.js的args拆分）
        if (Array.isArray(url)) {
            url = url[0];
        }

        if (!url) {
            terminal.println('用法: /az <GitHub文件直链>', 'info-line');
            terminal.println('示例:', 'info-line');
            terminal.println('  /az https://raw.githubusercontent.com/user/repo/main/extension.js', 'info-line');
            terminal.println('  /az https://raw.githubusercontent.com/user/repo/branch/path/ext.js', 'info-line');
            return;
        }

        // 安全校验: 只允许白名单域名
        const allowedDomains = [
            'https://raw.githubusercontent.com/',
            'https://github.com/'
        ];
        const isAllowed = allowedDomains.some(d => url.startsWith(d));
        if (!isAllowed) {
            terminal.println('错误: 不允许从此域名加载扩展包', 'error-line');
            terminal.println('仅允许从 github.com 和 raw.githubusercontent.com 加载', 'info-line');
            terminal.println(`当前 URL: ${url}`, 'warning-line');
            return;
        }

        // 从 URL 中提取文件名作为扩展包名
        let extName = '';
        const urlParts = url.split('/');
        const fileName = urlParts[urlParts.length - 1] || '';
        extName = fileName.replace(/\.\w+$/, '') || 'extension-' + Date.now();

        // 如果已经是 github.com 而非 raw.githubusercontent.com，尝试转换
        let finalUrl = url;
        if (url.startsWith('https://github.com/')) {
            // 尝试将 github.com 链接转为 raw 链接
            // https://github.com/user/repo/blob/branch/path/file.js
            // → https://raw.githubusercontent.com/user/repo/branch/path/file.js
            finalUrl = url
                .replace('https://github.com/', 'https://raw.githubusercontent.com/')
                .replace('/blob/', '/');
            terminal.println('已转换为 raw 链接', 'info-line');
        }

        // 检查是否已加载
        if (this.loadedExtensions.includes(extName)) {
            terminal.println(`扩展包 '${extName}' 已加载`, 'info-line');
            terminal.println('如需重新加载请先使用 /rm 卸载', 'info-line');
            return;
        }

        terminal.println(`正在从 URL 加载扩展包...`, 'info-line');
        terminal.println(`URL: ${finalUrl}`, 'info-line');
        terminal.println(`包名: ${extName}`, 'info-line');

        try {
            // 1. 获取脚本内容
            terminal.println(`正在下载...`, 'info-line');

            const response = await fetch(finalUrl);
            if (!response.ok) {
                throw new Error(`下载失败 (HTTP ${response.status}): ${finalUrl}`);
            }

            const scriptContent = await response.text();

            if (!scriptContent || scriptContent.trim().length === 0) {
                throw new Error('下载的内容为空');
            }

            terminal.println(`下载成功 (${(scriptContent.length / 1024).toFixed(1)} KB)`, 'success-line');

            // 2. 检查脚本中是否使用了 ExtensionAPI
            const usesExtensionAPI = scriptContent.includes('ExtensionAPI');
            if (!usesExtensionAPI) {
                terminal.println('警告: 该脚本未检测到 ExtensionAPI 调用，可能不是有效的扩展包', 'warning-line');
            }

            // 3. 检测脚本中注册的命令
            const cmdMatches = scriptContent.match(/registerCommand\s*\(\s*['"]([^'"]+)['"]/g);
            const detectedCommands = [];
            if (cmdMatches) {
                for (const match of cmdMatches) {
                    const cmdName = match.match(/registerCommand\s*\(\s*['"]([^'"]+)['"]/);
                    if (cmdName) {
                        detectedCommands.push(cmdName[1].startsWith('/') ? cmdName[1] : '/' + cmdName[1]);
                    }
                }
            }

            // 4. 命令冲突检测
            if (detectedCommands.length > 0) {
                const conflictCmds = detectedCommands.filter(c =>
                    this.builtInCommands.includes(c) || this.registeredCommands[c]
                );

                if (conflictCmds.length > 0) {
                    terminal.println(`检测到命令冲突: ${conflictCmds.join(', ')}`, 'warning-line');
                    terminal.println('如需覆盖请先卸载冲突的扩展包或修改脚本', 'info-line');
                    terminal.println(`已取消加载 '${extName}'`, 'info-line');
                    return;
                }

                terminal.println(`检测到 ${detectedCommands.length} 个命令: ${detectedCommands.join(', ')}`, 'info-line');
            }

            // 5. 设置SDK上下文 (若SDK已加载)
            if (window.ExtensionAPI && window.ExtensionAPI._setContext) {
                const config = {
                    name: extName,
                    description: `从 URL 加载: ${finalUrl}`,
                    version: '1.0.0',
                    source: 'url',
                    commands: detectedCommands.map(c => ({ name: c }))
                };
                window.ExtensionAPI._setContext(this, extName, config, finalUrl);
            }

            // 6. 通过创建 script 标签加载（确保安全执行）
            await new Promise((resolve, reject) => {
                const blob = new Blob([scriptContent], { type: 'application/javascript' });
                const blobUrl = URL.createObjectURL(blob);
                const script = document.createElement('script');
                script.src = blobUrl;
                script.onload = () => {
                    URL.revokeObjectURL(blobUrl);
                    resolve();
                };
                script.onerror = () => {
                    URL.revokeObjectURL(blobUrl);
                    reject(new Error('脚本加载失败'));
                };
                document.body.appendChild(script);
            });

            // 7. 保存扩展包元数据
            this.extensions[extName] = {
                config: {
                    name: extName,
                    description: `从 URL 加载: ${finalUrl}`,
                    version: '1.0.0',
                    source: 'url',
                    commands: detectedCommands.map(c => ({ name: c }))
                },
                cdnBaseUrl: finalUrl,
                status: 'loaded',
                loadedAt: new Date().toISOString(),
                registeredCommands: detectedCommands
            };

            if (!this.loadedExtensions.includes(extName)) {
                this.loadedExtensions.push(extName);
            }

            // 尝试从 GitHub raw URL 解析 user/repo 并保存到注册表
            if (url.startsWith('https://raw.githubusercontent.com/')) {
                const parts = url.split('/');
                // raw.githubusercontent.com/user/repo/...
                if (parts.length >= 5) {
                    const ghUser = parts[3];
                    const ghRepo = parts[4];
                    this._addToRegistry(extName, ghUser, ghRepo);
                }
            } else if (url.startsWith('https://github.com/')) {
                const parts = url.split('/');
                // github.com/user/repo/...
                if (parts.length >= 5) {
                    const ghUser = parts[3];
                    const ghRepo = parts[4];
                    this._addToRegistry(extName, ghUser, ghRepo);
                }
            }

            this._saveState();

            // 发送ready事件
            if (window.ExtensionAPI && window.ExtensionAPI._emit) {
                window.ExtensionAPI._emit('ready', { name: extName, config: this.extensions[extName]?.config });
            }

            terminal.println(`╔══════════════════════════════════════════╗`, 'success-line');
            terminal.println(`║  扩展包 '${extName}' 加载成功!`, 'success-line');
            terminal.println(`║  来源: URL 直链`, 'success-line');
            terminal.println(`║  已注册 ${detectedCommands.length} 个命令`, 'success-line');
            terminal.println(`╚══════════════════════════════════════════╝`, 'success-line');

        } catch (error) {
            // 发射 error 事件
            if (window.ExtensionAPI && window.ExtensionAPI._emit) {
                window.ExtensionAPI._emit('error', { name: extName, error: error, phase: 'url-load' });
            }
            terminal.println(`加载扩展包失败: ${error.message}`, 'error-line');
            if (error.message.includes('Failed to fetch') || error.message.includes('NetworkError')) {
                terminal.println('提示: 请检查网络连接和 URL 是否正确', 'info-line');
                terminal.println('提示: GitHub raw 链接格式应为:', 'info-line');
                terminal.println('  https://raw.githubusercontent.com/用户名/仓库名/分支名/路径/文件.js', 'info-line');
            }
        }
    },

    /**
     * 从 GitHub 仓库自动识别并下载扩展包
     * 用法: /ar <GitHub-用户/仓库名> 或 /ar https://github.com/用户/仓库
     * 自动扫描仓库 extensions/ 目录，列出可用扩展包供用户选择安装
     * 支持三层发现: GitHub API → jsDelivr CDN → 手动输入
     * 内置重试机制提升网络容错性
     * @param {string} repoPath - GitHub 仓库路径
     */
    async autoRecognizeExtension(repoPath) {
        // 如果传入的是数组（来自terminal.js的args拆分）
        if (Array.isArray(repoPath)) {
            repoPath = repoPath[0];
        }

        if (!repoPath) {
            terminal.println('用法: /ar <GitHub-用户/仓库名>', 'info-line');
            terminal.println('示例:', 'info-line');
            terminal.println('  /ar user/repo', 'info-line');
            terminal.println('  /ar https://github.com/user/repo', 'info-line');
            return;
        }

        // 支持从完整 URL 中提取 user/repo
        if (repoPath.startsWith('https://github.com/')) {
            repoPath = repoPath.replace('https://github.com/', '').replace(/\/$/, '');
            const parts = repoPath.split('/');
            if (parts.length >= 2) {
                repoPath = parts[0] + '/' + parts[1];
            }
        }

        // 移除末尾的 .git
        repoPath = repoPath.replace(/\.git$/, '');

        terminal.println(`╔══════════════════════════════════════════╗`, 'info-line');
        terminal.println(`║    正在扫描 GitHub 仓库扩展包...        ║`, 'info-line');
        terminal.println(`╚══════════════════════════════════════════╝`, 'info-line');
        terminal.println(`仓库: ${repoPath}`, 'info-line');

        // 策略1: 通过三层发现机制(API → CDN → 手动)获取扩展包目录
        const extDirs = await this._discoverExtensions(repoPath);

        if (!extDirs || extDirs.length === 0) {
            // 策略2: 手动输入兜底
            terminal.println('自动发现扩展包失败，请手动输入扩展包名称。', 'warning-line');
            terminal.println('提示: 扩展包通常位于仓库的 extensions/ 目录下', 'info-line');
            const manualNames = await this._promptManualInput('请输入要安装的扩展包名称 (多个用逗号分隔，留空取消):');
            if (!manualNames || manualNames.length === 0) {
                terminal.println('已取消安装', 'info-line');
                return;
            }
            const manualExts = manualNames.map(n => ({
                name: n.trim(),
                description: '(手动输入)',
                version: '?',
                author: '?',
                commands: 0,
                loaded: this.loadedExtensions.includes(n.trim()),
                _branch: 'main'
            }));
            await this._installExtensions(repoPath, manualExts);
            return;
        }

        // 检测每个扩展包的有效性
        terminal.println(`发现 ${extDirs.length} 个候选扩展包，正在检测有效性...`, 'info-line');
        const validExtensions = await this._validateExtensions(repoPath, extDirs);

        if (validExtensions.length === 0) {
            terminal.println('未找到有效的扩展包', 'warning-line');
            terminal.println('提示: 请确认仓库中存在 extensions/ 目录且包含有效的 extension.json 文件', 'info-line');
            return;
        }

        // 显示扩展包列表
        terminal.println('');
        terminal.println('╔══════════════════════════════════════════╗', 'success-line');
        terminal.println('║       可安装的扩展包列表               ║', 'success-line');
        terminal.println('╚══════════════════════════════════════════╝', 'success-line');

        for (let i = 0; i < validExtensions.length; i++) {
            const ext = validExtensions[i];
            const statusStr = ext.loaded ? ' [已加载]' : '';
            terminal.println(`  [${i + 1}] ${ext.name}${statusStr}`, ext.loaded ? 'warning-line' : 'info-line');
            terminal.println(`       描述: ${ext.description}`, 'info-line');
            terminal.println(`       版本: ${ext.version}  命令数: ${ext.commands}`, 'info-line');
        }

        terminal.println('');
        terminal.println(`  输入序号选择要安装的扩展包`, 'info-line');
        terminal.println(`  (例: "1" 安装第一个, "1,2,3" 安装多个, "all" 全部安装)`, 'info-line');

        const selected = await this._promptSelection(validExtensions);
        if (!selected || selected.length === 0) {
            terminal.println('未选择任何扩展包', 'info-line');
            return;
        }

        await this._installExtensions(repoPath, selected);
    },

    /**
     * 交互式选择扩展包
     * @param {Array} extensions - 有效扩展包列表
     * @returns {Promise<Array>} 用户选择的扩展包列表
     */
    _promptSelection(extensions) {
        return new Promise((resolve) => {
            const inputContainer = document.createElement('div');
            inputContainer.style.cssText = 'display:flex;align-items:center;margin-top:5px;';
            inputContainer.innerHTML = `
                <span style="color:#00ff00;">选择扩展包&gt; </span>
                <input type="text" id="select-ext-input"
                       style="background:#000;color:#fff;border:none;outline:none;font-family:inherit;font-size:14px;flex:1;"
                       autocomplete="off">
            `;

            terminal.input.disabled = true;
            terminal.input.style.opacity = '0.3';

            const output = terminal.output;
            output.appendChild(inputContainer);

            const selectInput = document.getElementById('select-ext-input');
            if (selectInput) {
                selectInput.focus();

                const handleInput = (e) => {
                    if (e.key === 'Enter') {
                        const choice = selectInput.value.trim().toLowerCase();
                        inputContainer.remove();

                        terminal.input.disabled = false;
                        terminal.input.style.opacity = '1';
                        terminal.input.focus();

                        if (choice === '' || choice === '0') {
                            resolve([]);
                            return;
                        }

                        if (choice === 'all' || choice === 'a') {
                            resolve(extensions);
                            return;
                        }

                        // 解析逗号分隔的序号
                        const indices = choice.split(',').map(s => parseInt(s.trim(), 10));
                        const selected = [];
                        for (const idx of indices) {
                            if (idx >= 1 && idx <= extensions.length) {
                                selected.push(extensions[idx - 1]);
                            } else {
                                terminal.println(`无效序号: ${idx} (有效范围 1-${extensions.length})`, 'warning-line');
                            }
                        }

                        resolve(selected);
                    }
                };

                selectInput.addEventListener('keydown', handleInput);
            }
        });
    },

    // ============ 扩展发现与安装辅助方法 ============

    /**
     * 带重试机制的 fetch，自动重试网络错误，支持 404 快速返回
     * @param {string} url - 请求 URL
     * @param {number} maxRetries - 最大重试次数(默认2次)
     * @param {number} delayMs - 重试间隔毫秒(默认1000ms)
     * @returns {Promise<Response>}
     */
    async _fetchWithRetry(url, maxRetries = 2, delayMs = 1000) {
        for (let i = 0; i <= maxRetries; i++) {
            try {
                const response = await fetch(url);
                if (response.ok) return response;
                if (response.status === 404) return response; // 404 没必要重试
                if (response.status === 403) {
                    // 速率限制，等久一点再重试
                    if (i < maxRetries) {
                        await new Promise(r => setTimeout(r, delayMs * 3));
                        continue;
                    }
                    return response;
                }
                if (i < maxRetries) {
                    await new Promise(r => setTimeout(r, delayMs * (i + 1)));
                }
            } catch (err) {
                // 网络错误（DNS/连接超时等），重试
                if (i < maxRetries) {
                    await new Promise(r => setTimeout(r, delayMs * (i + 1)));
                } else {
                    throw err;
                }
            }
        }
        throw new Error(`请求失败 (重试 ${maxRetries} 次): ${url}`);
    },

    /**
     * 三层方式发现扩展包目录(按优先级)
     * Layer 1: GitHub API (快速但有速率限制 60 req/h)
     * Layer 2: jsDelivr CDN Data API (无速率限制，中国大陆可访问)
     * Layer 3: 返回空，由上层处理手动输入兜底
     * @param {string} repoPath - GitHub user/repo
     * @returns {Promise<string[]|null>} 扩展包目录名列表或 null
     */
    async _discoverExtensions(repoPath) {
        // Layer 1: 通过 GitHub API 发现
        try {
            terminal.println('正在通过 GitHub API 扫描扩展包...', 'info-line');
            const dirs = await this._discoverViaGithubApi(repoPath);
            if (dirs && dirs.length > 0) {
                terminal.println(`通过 GitHub API 发现 ${dirs.length} 个扩展包`, 'success-line');
                return dirs;
            }
        } catch (err) {
            terminal.println(`GitHub API 扫描失败: ${err.message}`, 'warning-line');
        }

        // Layer 2: 通过 jsDelivr CDN 发现(无速率限制，国内友好)
        try {
            terminal.println('正在通过 jsDelivr CDN 扫描扩展包...', 'info-line');
            const dirs = await this._discoverViaJsdelivr(repoPath);
            if (dirs && dirs.length > 0) {
                terminal.println(`通过 jsDelivr CDN 发现 ${dirs.length} 个扩展包`, 'success-line');
                return dirs;
            }
        } catch (err) {
            terminal.println(`jsDelivr CDN 扫描失败: ${err.message}`, 'warning-line');
        }

        // Layer 3: 返回空，由上层处理手动输入兜底
        return null;
    },

    /**
     * 通过 GitHub API 发现扩展包目录
     * 跳过 repo info 查询，直接尝试 main 和 master 两个分支
     * 内置重试机制
     * @param {string} repoPath - GitHub user/repo
     * @returns {Promise<string[]|null>} 扩展包名列表
     */
    async _discoverViaGithubApi(repoPath) {
        const branches = ['main', 'master'];
        let lastError = null;

        for (const branch of branches) {
            try {
                const apiUrl = `https://api.github.com/repos/${repoPath}/contents/extensions?ref=${branch}`;
                const resp = await this._fetchWithRetry(apiUrl, 1, 500);

                if (!resp.ok) {
                    if (resp.status === 404) continue;
                    if (resp.status === 403) {
                        lastError = new Error('GitHub API 速率限制(60次/小时)，已切换到备用通道');
                        break;
                    }
                    continue;
                }

                const contents = await resp.json();
                const dirs = contents
                    .filter(item => item.type === 'dir')
                    .map(item => item.name);

                if (dirs.length > 0) {
                    this._lastApiBranch = branch;
                    return dirs;
                }
            } catch (err) {
                lastError = err;
            }
        }

        if (lastError) throw lastError;
        return null;
    },

    /**
     * 通过 jsDelivr CDN Data API 发现扩展包目录
     * jsDelivr 无速率限制，在中国大陆有较好的访问速度
     * 支持 main 和 master 分支自动切换
     * @param {string} repoPath - GitHub user/repo
     * @returns {Promise<string[]|null>} 扩展包名列表
     */
    async _discoverViaJsdelivr(repoPath) {
        const branches = ['main', 'master'];
        for (const branch of branches) {
            try {
                // 使用 jsDelivr Data API 的目录列表 endpoint
                const dirUrl = `https://data.jsdelivr.com/v1/packages/gh/${repoPath}@${branch}/extensions`;
                const dirResp = await this._fetchWithRetry(dirUrl, 1, 500);

                if (dirResp.ok) {
                    const dirData = await dirResp.json();
                    // 返回格式: { files: [{ name: "...", type: "directory" }, ...] }
                    const dirs = (dirData.files || [])
                        .filter(f => f.type === 'directory')
                        .map(f => f.name);
                    if (dirs.length > 0) {
                        this._lastApiBranch = branch;
                        return dirs;
                    }
                }
            } catch {
                continue;
            }
        }
        return null;
    },

    /**
     * 验证扩展包有效性(检查 extension.json)，带分支自动切换
     * @param {string} repoPath - GitHub user/repo
     * @param {string[]} extNames - 扩展包名列表
     * @returns {Promise<Array>} 有效的扩展包信息列表
     */
    async _validateExtensions(repoPath, extNames) {
        const branchesToTry = this._lastApiBranch
            ? [this._lastApiBranch]
            : ['main', 'master'];

        const validExtensions = [];
        for (const extName of extNames) {
            let validated = false;
            for (const branch of branchesToTry) {
                const configUrl = `https://raw.githubusercontent.com/${repoPath}/${branch}/extensions/${extName}/extension.json`;
                try {
                    const cfgResp = await this._fetchWithRetry(configUrl, 1, 500);
                    if (cfgResp.ok) {
                        const configData = await cfgResp.json();
                        const isLoaded = this.loadedExtensions.includes(extName);
                        validExtensions.push({
                            name: extName,
                            description: configData.description || '无描述',
                            version: configData.version || '未知',
                            author: configData.author || '未知',
                            commands: (configData.commands || []).length,
                            loaded: isLoaded,
                            _branch: branch
                        });
                        validated = true;
                        break;
                    }
                } catch {
                    continue;
                }
            }
            if (!validated) {
                validExtensions.push({
                    name: extName,
                    description: '(无配置)',
                    version: '?',
                    author: '?',
                    commands: 0,
                    loaded: this.loadedExtensions.includes(extName),
                    _branch: 'main'
                });
            }
        }
        return validExtensions;
    },

    /**
     * 批量安装扩展包，含命令冲突检测和注册表持久化
     * @param {string} repoPath - GitHub user/repo
     * @param {Array} extList - 扩展包列表
     */
    async _installExtensions(repoPath, extList) {
        let successCount = 0;
        let failCount = 0;

        // 解析 user/repo 用于注册表
        const parts = repoPath.split('/');
        const user = parts[0];
        const repo = parts[1];

        for (const ext of extList) {
            terminal.println('');
            terminal.println(`--- 安装 '${ext.name}' ---`, 'info-line');

            if (ext.loaded) {
                terminal.println(`扩展包 '${ext.name}' 已加载，跳过`, 'warning-line');
                continue;
            }

            try {
                const branch = ext._branch || 'main';
                const cdnBaseUrl = `https://raw.githubusercontent.com/${repoPath}/${branch}/extensions/${ext.name}/`;
                const config = await this._fetchConfig(cdnBaseUrl, ext.name);

                // 检查依赖（含版本约束）
                const dependencies = this._extractDependencies(config.dependencies);
                if (dependencies.length > 0) {
                    var missingDeps = [];
                    for (var di = 0; di < dependencies.length; di++) {
                        var dep = dependencies[di];
                        if (!this.loadedExtensions.includes(dep.name)) {
                            missingDeps.push(dep.name);
                            continue;
                        }
                        if (dep.constraint) {
                            var depExt = this.extensions[dep.name];
                            var depVersion = (depExt && depExt.config && depExt.config.version) || '0.0.0';
                            if (!this._satisfiesVersion(depVersion, dep.constraint)) {
                                missingDeps.push(dep.name + ' (需要' + dep.constraint + ', 当前' + depVersion + ')');
                            }
                        }
                    }
                    if (missingDeps.length > 0) {
                        terminal.println(`⚠ 缺少依赖: ${missingDeps.join(', ')}，跳过`, 'warning-line');
                        failCount++;
                        continue;
                    }
                }

                const commandsToRegister = config.commands || [];
                const hasConflict = this._checkConflicts(ext.name, commandsToRegister);
                if (hasConflict) {
                    terminal.println('检测到命令冲突，正在处理...', 'warning-line');
                    const shouldContinue = await this._resolveConflicts(ext.name, commandsToRegister);
                    if (!shouldContinue) {
                        terminal.println(`已跳过 '${ext.name}'`, 'info-line');
                        continue;
                    }
                }

                // 加载CSS样式
                const styles = config.styles || [];
                for (const styleFile of styles) {
                    const styleUrl = styleFile.startsWith('http') ? styleFile : cdnBaseUrl + styleFile;
                    await this._loadExtensionCSS(styleUrl, ext.name);
                }

                // 预加载脚本
                const preScripts = config.scripts || [];
                for (const scriptFile of preScripts) {
                    const scriptUrl = scriptFile.startsWith('http') ? scriptFile : cdnBaseUrl + scriptFile;
                    await this._loadScript(scriptUrl);
                }

                // 设置SDK上下文
                if (window.ExtensionAPI && window.ExtensionAPI._setContext) {
                    window.ExtensionAPI._setContext(this, ext.name, config, cdnBaseUrl);
                }

                const mainFile = config.main || 'main.js';
                await this._loadScript(cdnBaseUrl + mainFile);

                this.extensions[ext.name] = {
                    config: config,
                    cdnBaseUrl: cdnBaseUrl,
                    status: 'loaded',
                    loadedAt: new Date().toISOString(),
                    registeredCommands: commandsToRegister.map(c =>
                        c.name.startsWith('/') ? c.name : '/' + c.name
                    ),
                    loadedCSS: styles,
                    loadedScripts: preScripts
                };

                if (!this.loadedExtensions.includes(ext.name)) {
                    this.loadedExtensions.push(ext.name);
                }

                // 保存到注册表以便通过 /ap 恢复
                this._addToRegistry(ext.name, user, repo);

                // 发送ready事件
                if (window.ExtensionAPI && window.ExtensionAPI._emit) {
                    window.ExtensionAPI._emit('ready', { name: ext.name, config: config });
                }

                this._saveState();
                terminal.println(`✅ '${ext.name}' 安装成功 (${commandsToRegister.length} 个命令${styles.length > 0 ? ', ' + styles.length + ' 个样式文件' : ''})`, 'success-line');
                successCount++;
            } catch (err) {
                terminal.println(`❌ '${ext.name}' 安装失败: ${err.message}`, 'error-line');
                failCount++;
            }
        }

        // 汇总
        terminal.println('');
        terminal.println('╔══════════════════════════════════════════╗', 'success-line');
        terminal.println(`║  安装完成: ${successCount} 成功, ${failCount} 失败`, successCount > 0 ? 'success-line' : 'error-line');
        terminal.println('╚══════════════════════════════════════════╝', 'success-line');
    },

    /**
     * 手动输入扩展包名称(交互式输入，回车确认)
     * @param {string} promptText - 提示文本
     * @returns {Promise<string[]|null>} 输入的扩展包名数组，取消返回 null
     */
    _promptManualInput(promptText) {
        return new Promise((resolve) => {
            const inputContainer = document.createElement('div');
            inputContainer.style.cssText = 'display:flex;align-items:center;margin-top:5px;';
            inputContainer.innerHTML = `
                <span style="color:#00ff00;">${promptText}</span>
                <input type="text" id="manual-ext-input"
                       style="background:#000;color:#fff;border:none;outline:none;font-family:inherit;font-size:14px;flex:1;"
                       autocomplete="off">
            `;

            const terminalEl = document.getElementById('output');
            terminalEl.appendChild(inputContainer);

            const input = document.getElementById('manual-ext-input');
            input.focus();

            // 禁用终端键盘监听
            if (terminal && terminal.input) {
                terminal.input.disabled = true;
                terminal.input.style.opacity = '0.3';
            }

            const handleKeydown = (e) => {
                if (e.key === 'Enter') {
                    const value = input.value.trim();
                    inputContainer.remove();

                    if (terminal && terminal.input) {
                        terminal.input.disabled = false;
                        terminal.input.style.opacity = '1';
                        terminal.input.focus();
                    }
                    document.removeEventListener('keydown', handleKeydown);

                    if (!value) {
                        resolve(null);
                        return;
                    }

                    // 支持逗号分隔多个名称
                    const names = value.split(',').map(n => n.trim()).filter(n => n);
                    resolve(names.length > 0 ? names : null);
                }
            };

            document.addEventListener('keydown', handleKeydown);
        });
    },

    /**
     * 卸载一个扩展包
     * @param {string} extName - 扩展包名
     */
    async unloadExtension(extName) {
        // 如果传入的是数组（来自terminal.js）
        if (Array.isArray(extName)) extName = extName[0];

        if (!extName) {
            terminal.println('用法: /rm <扩展包名>', 'info-line');
            return;
        }

        if (!this.loadedExtensions.includes(extName)) {
            terminal.println(`错误: 扩展包 '${extName}' 未加载`, 'error-line');
            return;
        }

        const ext = this.extensions[extName];
        if (!ext) {
            terminal.println(`错误: 扩展包 '${extName}' 元数据丢失`, 'error-line');
            // 从列表移除
            this.loadedExtensions = this.loadedExtensions.filter(e => e !== extName);
            this._saveState();
            return;
        }

        // 发送 beforeUnload 事件（允许扩展做清理）
        if (window.ExtensionAPI && window.ExtensionAPI._emit) {
            window.ExtensionAPI._emit('beforeUnload', { name: extName });
        }

        // 移除所有该扩展包注册的命令
        const removedCommands = [];
        for (const cmdName of Object.keys(this.registeredCommands)) {
            if (this.registeredCommands[cmdName].source === extName) {
                delete this.registeredCommands[cmdName];
                removedCommands.push(cmdName);
            }
        }

        // 移除该扩展包加载的CSS样式
        let removedCSS = 0;
        const loadedCSSIds = [];
        if (ext && ext.loadedCSS) {
            for (const cssFile of ext.loadedCSS) {
                const cssId = `ext-css-${extName}-${cssFile.replace(/[^a-zA-Z0-9]/g, '-')}`;
                const linkEl = document.getElementById(cssId);
                if (linkEl) {
                    linkEl.remove();
                    removedCSS++;
                }
            }
        }

        // 额外清理内联 style 标签（带 data-ext-name 属性）
        const styleNodes = document.querySelectorAll(`style[data-ext-name="${extName}"]`);
        styleNodes.forEach(el => el.remove());

        // 清理扩展创建的 DOM 元素：面板、通知等
        let removedDOM = 0;
        const panelNodes = document.querySelectorAll(`.ext-panel[data-ext-name="${extName}"], .ext-toast[data-ext-name="${extName}"]`);
        panelNodes.forEach(el => { el.remove(); removedDOM++; });

        // 清理带 data-extension 属性的元素（旧版SDK创建的）
        const legacyNodes = document.querySelectorAll(`[data-extension="${extName}"]`);
        legacyNodes.forEach(el => { el.remove(); removedDOM++; });

        // 清理扩展注册的定时器（通过 ExtensionAPI 暴露的 setInterval/setTimeout 追踪）
        if (this._extTimers && this._extTimers[extName]) {
            const timers = this._extTimers[extName];
            timers.forEach(t => {
                if (t.type === 'interval') clearInterval(t.id);
                else clearTimeout(t.id);
            });
            delete this._extTimers[extName];
        }

        // 清理扩展注册的 AI Tools（v4.0）
        if (window._mltsf_ai_tools) {
            var removedTools = 0;
            var toolNames = Object.keys(window._mltsf_ai_tools);
            for (var ti = 0; ti < toolNames.length; ti++) {
                if (window._mltsf_ai_tools[toolNames[ti]]._source === extName) {
                    delete window._mltsf_ai_tools[toolNames[ti]];
                    removedTools++;
                }
            }
            if (removedTools > 0) {
                terminal.println(`║  移除了 ${removedTools} 个 AI Tool`, 'success-line');
            }
        }

        // 清理扩展注入的 AI 上下文（v4.0）
        if (window._mltsf_ai_context) {
            window._mltsf_ai_context = window._mltsf_ai_context.filter(function(ctx) {
                return ctx._source !== extName;
            });
        }

        // 发送unload事件
        if (window.ExtensionAPI && window.ExtensionAPI._emit) {
            window.ExtensionAPI._emit('unload', { name: extName });
        }

        // 清理
        delete this.extensions[extName];
        this.loadedExtensions = this.loadedExtensions.filter(e => e !== extName);
        this._saveState();

        terminal.println(`╔══════════════════════════════════════════╗`, 'success-line');
        terminal.println(`║  扩展包 '${extName}' 已卸载`, 'success-line');
        terminal.println(`║  移除了 ${removedCommands.length} 个命令`, 'success-line');
        if (removedCSS > 0) {
            terminal.println(`║  移除了 ${removedCSS} 个样式文件`, 'success-line');
        }
        if (removedDOM > 0) {
            terminal.println(`║  移除了 ${removedDOM} 个 DOM 元素`, 'success-line');
        }
        terminal.println(`╚══════════════════════════════════════════╝`, 'success-line');
    },

    /**
     * 列出已加载的扩展包
     */
    listExtensions() {
        if (this.loadedExtensions.length === 0) {
            terminal.println('当前未加载任何扩展包', 'info-line');
            terminal.println('使用 /ap <扩展包名> 加载扩展包', 'info-line');
            return;
        }

        terminal.println('╔══════════════════════════════════════════╗', 'success-line');
        terminal.println('║          已加载的扩展包列表              ║', 'success-line');
        terminal.println('╚══════════════════════════════════════════╝', 'success-line');

        for (const extName of this.loadedExtensions) {
            const ext = this.extensions[extName];
            terminal.println('');
            terminal.println(` [${extName}]`, 'info-line');
            if (ext && ext.config) {
                terminal.println(`   描述: ${ext.config.description || '无'}`, 'info-line');
                terminal.println(`   版本: ${ext.config.version || '未知'}`, 'info-line');
                terminal.println(`   作者: ${ext.config.author || '未知'}`, 'info-line');
                terminal.println(`   命令数: ${(ext.config.commands || []).length}`, 'info-line');
            } else {
                terminal.println(`   状态: 元数据不可用`, 'warning-line');
            }
        }

        // 列出所有已注册的扩展命令
        const extCommands = Object.entries(this.registeredCommands);
        if (extCommands.length > 0) {
            terminal.println('');
            terminal.println('已注册的扩展命令:', 'info-line');
            for (const [cmd, info] of extCommands) {
                terminal.println(`  ${cmd} - ${info.description} (来自: ${info.source})`, 'info-line');
            }
        }
    },

    /**
     * 获取可用扩展包列表（从注册表）
     */
    async getAvailableExtensions() {
        const registryKeys = Object.keys(this.registry);

        if (registryKeys.length === 0) {
            terminal.println('注册表中暂无扩展包', 'info-line');
            terminal.println('使用以下命令注册扩展包:', 'info-line');
            terminal.println('  /ap <扩展包名> <github用户> <仓库名>', 'info-line');
            return;
        }

        terminal.println('╔══════════════════════════════════════════╗', 'info-line');
        terminal.println('║         可用扩展包 (注册表)              ║', 'info-line');
        terminal.println('╚══════════════════════════════════════════╝', 'info-line');

        for (const [name, info] of Object.entries(this.registry)) {
            const isLoaded = this.loadedExtensions.includes(name);
            const statusStr = isLoaded ? '[已加载]' : '[未加载]';
            terminal.println(` ${statusStr} ${name}`, isLoaded ? 'success-line' : 'info-line');
            terminal.println(`   来源: github.com/${info.user}/${info.repo}`, 'info-line');
        }

        terminal.println('');
        terminal.println('使用 /ap <扩展包名> 加载扩展包', 'info-line');
    },

    // ========================
    // 内部方法
    // ========================

    /**
     * 解析 semver 版本号为 { major, minor, patch }
     * @param {string} v - 版本号字符串，如 "1.2.3"
     * @returns {object}
     */
    _parseVersion(v) {
        var parts = String(v || '0.0.0').split('.');
        return {
            major: parseInt(parts[0]) || 0,
            minor: parseInt(parts[1]) || 0,
            patch: parseInt(parts[2]) || 0
        };
    },

    /**
     * 检查版本是否满足约束
     * @param {string} version - 实际版本号，如 "1.2.3"
     * @param {string} constraint - 约束表达式，如 ">=1.0.0" 或 ">=1.0.0 <2.0.0"
     * @returns {boolean}
     */
    _satisfiesVersion(version, constraint) {
        if (!constraint) return true;
        var ver = this._parseVersion(version);
        var parts = constraint.trim().split(/\s+/);
        for (var i = 0; i < parts.length; i++) {
            var c = parts[i];
            var match = c.match(/^([<>=!]+)(\d+\.\d+\.\d+.*)$/);
            if (!match) continue;
            var op = match[1];
            var targetVer = this._parseVersion(match[2]);
            var cmp = (ver.major - targetVer.major) || (ver.minor - targetVer.minor) || (ver.patch - targetVer.patch);
            if (op === '>=' && cmp < 0) return false;
            if (op === '>'  && cmp <= 0) return false;
            if (op === '<=' && cmp > 0) return false;
            if (op === '<'  && cmp >= 0) return false;
            if (op === '==' && cmp !== 0) return false;
            if (op === '!=' && cmp === 0) return false;
        }
        return true;
    },

    /**
     * 从依赖声明中提取 { name, constraint } 列表
     * 兼容旧格式: ["ext-a", "ext-b"]
     * 新格式: ["ext-a", {"ext-b": ">=1.0.0"}] 或 {"ext-a": ">=1.0.0"}
     * @param {Array|Object} dependencies - 依赖声明
     * @returns {Array<{name: string, constraint: string|null}>}
     */
    _extractDependencies(dependencies) {
        if (!dependencies) return [];
        var result = [];
        if (Array.isArray(dependencies)) {
            for (var i = 0; i < dependencies.length; i++) {
                var item = dependencies[i];
                if (typeof item === 'string') {
                    result.push({ name: item, constraint: null });
                } else if (typeof item === 'object' && item !== null) {
                    var keys = Object.keys(item);
                    for (var j = 0; j < keys.length; j++) {
                        result.push({ name: keys[j], constraint: String(item[keys[j]]) });
                    }
                }
            }
        } else if (typeof dependencies === 'object' && dependencies !== null) {
            var objKeys = Object.keys(dependencies);
            for (var k = 0; k < objKeys.length; k++) {
                result.push({ name: objKeys[k], constraint: String(dependencies[objKeys[k]]) });
            }
        }
        return result;
    },

    /**
     * 从扩展包注册命令（由ExtensionAPI调用）
     */
    _registerCommandFromExtension(cmdName, definition) {
        // 检查命令名是否有效
        if (!cmdName.startsWith('/')) {
            cmdName = '/' + cmdName;
        }

        // 检查是否已有同名命令注册
        if (this.registeredCommands[cmdName]) {
            // 已经在冲突检测中处理过了，这里覆盖
            terminal.println(`  命令 ${cmdName} 已注册 (来自扩展包)`, 'info-line');
        }

        // 确定来源
        let source = 'unknown';
        // 检测是哪个扩展包注册的
        for (const extName of this.loadedExtensions) {
            const ext = this.extensions[extName];
            if (ext && ext.registeredCommands) {
                // 会在后续关联
            }
        }

        this.registeredCommands[cmdName] = {
            handler: definition.handler,
            description: definition.description || '扩展命令',
            source: definition._source || 'extension',
            extension: definition._source || 'extension'
        };

        terminal.println(`  注册命令: ${cmdName}`, 'success-line');
    },

    /**
     * 获取扩展包配置文件 (extension.json)
     */
    async _fetchConfig(cdnBaseUrl, extName) {
        const configUrl = cdnBaseUrl + 'extension.json';

        const response = await this._fetchWithRetry(configUrl);
        if (!response.ok) {
            if (response.status === 404) {
                throw new Error(`扩展包配置文件未找到 (404): ${configUrl}`);
            }
            throw new Error(`获取配置失败 (HTTP ${response.status}): ${configUrl}`);
        }

        const config = await response.json();

        // 验证配置
        if (!config.name) {
            config.name = extName;
        }

        return config;
    },

    /**
     * 加载扩展包的main.js脚本
     * 使用 fetch + 重试 → Blob URL 注入，避免 raw.githubusercontent.com 的 MIME 拦截问题
     */
    async _loadScript(url) {
        // 用 fetch 下载脚本内容（带重试机制，支持网络容错）
        const resp = await this._fetchWithRetry(url);
        if (!resp.ok) {
            throw new Error(`加载脚本失败: ${url} (HTTP ${resp.status})`);
        }
        const code = await resp.text();

        // 用 Blob URL 创建正确 MIME 类型的可执行脚本
        const blob = new Blob([code], { type: 'application/javascript' });
        const blobUrl = URL.createObjectURL(blob);

        return new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = blobUrl;
            script.onload = () => {
                URL.revokeObjectURL(blobUrl);
                resolve();
            };
            script.onerror = () => {
                URL.revokeObjectURL(blobUrl);
                reject(new Error(`加载脚本失败: ${url}`));
            };
            document.body.appendChild(script);
        });
    },

    /**
     * 加载扩展包的CSS样式文件
     * 通过 <link> 标签注入，自动去重，确保扩展包样式独立加载
     * @param {string} url - CSS文件的URL
     * @param {string} extName - 扩展包名称(用于去重标识)
     */
    async _loadExtensionCSS(url, extName) {
        // 生成唯一ID用于去重
        const cssId = `ext-css-${extName}-${url.replace(/[^a-zA-Z0-9]/g, '-')}`;

        // 检查是否已经加载
        if (document.getElementById(cssId)) {
            return; // 已加载，跳过
        }

        // 用 fetch + Blob URL 加载CSS，确保跨域兼容
        const resp = await this._fetchWithRetry(url);
        if (!resp.ok) {
            throw new Error(`加载CSS失败: ${url} (HTTP ${resp.status})`);
        }
        const cssText = await resp.text();

        return new Promise((resolve) => {
            const style = document.createElement('style');
            style.id = cssId;
            style.setAttribute('data-ext-name', extName);
            style.textContent = cssText;
            document.head.appendChild(style);
            resolve();
        });
    },

    /**
     * 检测命令冲突
     * @returns {boolean} 是否有冲突
     */
    _checkConflicts(extName, commands) {
        if (!commands || commands.length === 0) return false;

        let hasConflict = false;

        for (const cmd of commands) {
            const cmdName = cmd.name.startsWith('/') ? cmd.name : '/' + cmd.name;

            // 检查与内置命令冲突
            if (this.builtInCommands.includes(cmdName)) {
                terminal.println(`  冲突: 命令 ${cmdName} 与内置命令冲突`, 'warning-line');
                cmd._conflict = true;
                cmd._conflictType = 'builtin';
                hasConflict = true;
            }

            // 检查与已加载的扩展命令冲突
            if (this.registeredCommands[cmdName]) {
                const existingSource = this.registeredCommands[cmdName].source;
                terminal.println(`  冲突: 命令 ${cmdName} 与 ${existingSource} 冲突`, 'warning-line');
                cmd._conflict = true;
                cmd._conflictType = 'extension';
                cmd._existingSource = existingSource;
                hasConflict = true;
            }
        }

        return hasConflict;
    },

    /**
     * 解决命令冲突 - 询问用户
     * @returns {Promise<boolean>} 是否继续加载
     */
    _resolveConflicts(extName, commands) {
        return new Promise((resolve) => {
            terminal.println('');
            terminal.println(`扩展包 '${extName}' 检测到以下命令冲突:`, 'warning-line');
            terminal.println('');

            const conflictCmds = commands.filter(c => c._conflict);

            for (const cmd of conflictCmds) {
                const cmdName = cmd.name.startsWith('/') ? cmd.name : '/' + cmd.name;
                if (cmd._conflictType === 'builtin') {
                    terminal.println(`  ${cmdName} (与内置命令冲突)`, 'warning-line');
                } else {
                    terminal.println(`  ${cmdName} (与 ${cmd._existingSource} 冲突)`, 'warning-line');
                }
                terminal.println(`    描述: ${cmd.description || '无'}`, 'info-line');
            }

            terminal.println('');
            terminal.println('请选择处理方式 (输入选项):', 'info-line');
            terminal.println('  1. 保留旧的（跳过冲突命令，加载其余部分）', 'info-line');
            terminal.println('  2. 覆盖旧的（使用扩展包的新命令）', 'info-line');
            terminal.println('  3. 取消加载该扩展包', 'info-line');

            // 创建一个临时的冲突解决输入界面
            const inputContainer = document.createElement('div');
            inputContainer.style.cssText = 'display:flex;align-items:center;margin-top:5px;';
            inputContainer.innerHTML = `
                <span style="color:#ffff00;">冲突解决&gt; </span>
                <input type="text" id="conflict-input"
                       style="background:#000;color:#fff;border:none;outline:none;font-family:inherit;font-size:14px;flex:1;"
                       autocomplete="off">
            `;

            // 禁用主输入框
            terminal.input.disabled = true;
            terminal.input.style.opacity = '0.3';

            // 添加冲突解决输入
            const output = terminal.output;
            output.appendChild(inputContainer);

            const conflictInput = document.getElementById('conflict-input');
            if (conflictInput) {
                conflictInput.focus();

                const handleInput = (e) => {
                    if (e.key === 'Enter') {
                        const choice = conflictInput.value.trim();
                        inputContainer.remove();

                        // 恢复主输入框
                        terminal.input.disabled = false;
                        terminal.input.style.opacity = '1';
                        terminal.input.focus();

                        if (choice === '1') {
                            // 跳过冲突命令
                            for (const cmd of conflictCmds) {
                                cmd._skip = true;
                                terminal.println(`已跳过命令 ${cmd.name}`, 'warning-line');
                            }
                            resolve(true);
                        } else if (choice === '2') {
                            // 覆盖旧命令 - 在注册时覆盖
                            for (const cmd of conflictCmds) {
                                if (cmd._conflictType === 'builtin') {
                                    terminal.println(`警告: 覆盖内置命令 ${cmd.name}，请谨慎使用`, 'warning-line');
                                }
                                cmd._overwrite = true;
                            }
                            resolve(true);
                        } else if (choice === '3') {
                            terminal.println(`已取消加载扩展包 '${extName}'`, 'info-line');
                            resolve(false);
                        } else {
                            terminal.println('无效选项，请输入 1、2 或 3', 'error-line');
                            // 重新显示输入
                            output.appendChild(inputContainer);
                            conflictInput.value = '';
                            conflictInput.focus();
                        }
                    }
                };

                conflictInput.addEventListener('keydown', handleInput);
            }
        });
    },

    /**
     * 添加到注册表
     */
    _addToRegistry(extName, githubUser, repoName) {
        this.registry[extName] = {
            user: githubUser,
            repo: repoName,
            addedAt: new Date().toISOString()
        };
        this._saveRegistry();
    },

    /**
     * 保存状态到localStorage
     */
    _saveState() {
        try {
            localStorage.setItem('mltsf-extension-manager', JSON.stringify({
                extensions: this.extensions,
                loadedExtensions: this.loadedExtensions
            }));
        } catch (e) {
            console.warn('保存扩展包状态失败:', e);
        }
    },

    /**
     * 从localStorage加载状态
     */
    _loadState() {
        try {
            const saved = localStorage.getItem('mltsf-extension-manager');
            if (saved) {
                const data = JSON.parse(saved);
                if (data.extensions && typeof data.extensions === 'object') this.extensions = data.extensions;
                if (data.loadedExtensions && Array.isArray(data.loadedExtensions)) this.loadedExtensions = data.loadedExtensions;
            }
        } catch (e) {
            console.warn('加载扩展包状态失败:', e);
        }
    },

    /**
     * 保存注册表
     */
    _saveRegistry() {
        try {
            localStorage.setItem('mltsf-ext-registry', JSON.stringify(this.registry));
        } catch (e) {
            console.warn('保存注册表失败:', e);
        }
    },

    /**
     * 加载注册表
     */
    _loadRegistry() {
        try {
            const saved = localStorage.getItem('mltsf-ext-registry');
            if (saved) {
                const data = JSON.parse(saved);
                if (data && typeof data === 'object' && !Array.isArray(data)) {
                    this.registry = data;
                }
            }
        } catch (e) {
            console.warn('加载注册表失败:', e);
        }
    }
};

// 挂载到全局，供 terminal.js/commands.js 访问
window.extensionManager = extensionManager;

// 初始化
window.addEventListener('load', () => {
    // 稍后初始化，等待terminal就绪
    setTimeout(() => {
        extensionManager.init();
        // 将扩展管理器暴露到全局，供 terminal.js / commands.js 使用
        window.extensionManager = extensionManager;
    }, 100);
});