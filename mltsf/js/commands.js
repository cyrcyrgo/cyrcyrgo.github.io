// 显示帮助信息
function showHelp() {
    terminal.println('', 'info-line');
    terminal.println('╔══════════════════════════════════════════════════════════╗', 'info-line');
    terminal.println('║           MLTSF 命令帮助 v3.0 - 可扩展终端               ║', 'info-line');
    terminal.println('╚══════════════════════════════════════════════════════════╝', 'info-line');
    terminal.println('', 'info-line');

    terminal.println('系统命令:', 'info-line');
    terminal.println('  /help         - 显示此帮助信息', 'info-line');
    terminal.println('  /hj 环境      - 切换到指定环境 (python/c++/cmd)', 'info-line');
    terminal.println('  /color 字母   - 更改终端字体颜色 (单字母首字母大写)', 'info-line');
    terminal.println('                  R=红 G=绿 B=蓝 C=青 Y=黄 M=品红', 'info-line');
    terminal.println('                  W=白 A=灰 O=橙 P=紫 I=粉 N=棕', 'info-line');
    terminal.println('                  (也支持全名: Red/Green/Blue/等)', 'info-line');
    terminal.println('  /jr 项目名    - 打开项目进行编程', 'info-line');
    terminal.println('  /ex 项目名    - 退出当前项目', 'info-line');
    terminal.println('  /op 项目或文件 - 打开本地项目或文件', 'info-line');
    terminal.println('  /y            - 切换官方源和镜像源 (全局生效)', 'info-line');
    terminal.println('  /bq           - 查看免责声明', 'info-line');
    terminal.println('  /run 文件名   - 按当前环境运行文件并输出结果', 'info-line');
    terminal.println('  /wr 文件名    - 写入/修改文件内容（Ctrl+Enter 保存，Esc 取消）', 'info-line');
    terminal.println('  /dc 项目名    - 导出项目', 'info-line');
    terminal.println('  /xj 名称      - 创建新项目或文件（交互式选择类型）', 'info-line');
    terminal.println('  /d 包名       - 安装Python包', 'info-line');
    terminal.println('  /b type 名称  - 删除项目或文件', 'info-line');
    terminal.println('  /cq           - 清空并刷新页面', 'info-line');
    terminal.println('  /qk           - 清空终端输出', 'info-line');
    terminal.println('', 'info-line');

    terminal.println('项目管理:', 'info-line');
    terminal.println('  当前项目: ' + (terminal.currentProject || '未选择'), 'info-line');
    terminal.println('  当前环境: ' + (terminal.currentEnv || '未选择'), 'info-line');
    terminal.println('', 'info-line');

    // 扩展包相关命令
    terminal.println('扩展包命令 (Extension SDK v3.0):', 'info-line');
    terminal.println('  /lxe          - 列出已加载的扩展包及其注册命令', 'info-line');
    terminal.println('  /查看扩展包   - 从 GitHub 发现可用扩展包', 'info-line');
    terminal.println('  /ap 包名      - 安装扩展包', 'info-line');
    terminal.println('  /az URL       - 从 URL 加载扩展包', 'info-line');
    terminal.println('  /ar 仓库路径  - 从 GitHub 仓库自动发现扩展包', 'info-line');
    terminal.println('  /rm 包名      - 移除扩展包', 'info-line');
    terminal.println('  /extlist      - 列出所有扩展注册的命令', 'info-line');
    terminal.println('  /runxt 命令   - 调用扩展注册的自定义命令', 'info-line');
    terminal.println('  /extstatus    - 查看扩展系统状态', 'info-line');
    terminal.println('', 'info-line');

    terminal.println('AI 聊天助手:', 'info-line');
    terminal.println('  /ai            - 进入交互式 AI 聊天模式 (连续对话)', 'info-line');
    terminal.println('  /ai 问题       - 直接向 AI 提问', 'info-line');
    terminal.println('  /ai code       - 配置 AI 参数 (API Key、URL、模型)', 'info-line');
    terminal.println('  /ai clear      - 清除当前对话历史', 'info-line');
    terminal.println('  /ai history    - 查看当前对话历史', 'info-line');
    terminal.println('  /aic           - 清除 AI 配置和所有对话数据', 'info-line');
    terminal.println('', 'info-line');

    // 显示已加载扩展包注册的自定义命令
    if (window.extensionManager && window.extensionManager.registeredCommands) {
        const extCmds = Object.keys(window.extensionManager.registeredCommands);
        if (extCmds.length > 0) {
            terminal.println('已加载扩展注册的命令:', 'info-line');
            extCmds.forEach(cmd => {
                const info = window.extensionManager.registeredCommands[cmd];
                terminal.println(`  ${cmd.padEnd(12)} - ${info.description || '自定义扩展命令'} (来自: ${info.extension || '未知'})`, 'info-line');
            });
            terminal.println('', 'info-line');
        }
    }

    terminal.println('注: 命令参数无需输入 < > 尖括号符号，直接写参数即可', 'info-line');
    terminal.println('扩展包开发者: 使用 Extension SDK v3.0 开发丰富的图形化扩展（支持 CSS/JS/HTML UI）', 'info-line');
    terminal.println('', 'info-line');
}

async function switchEnvironment(args) {
    if (args.length === 0) {
        terminal.println('可用环境: python, c++, cmd', 'info-line');
        terminal.println('使用方法: /hj <环境名> 或 /hj 环境名', 'info-line');
        return;
    }

    // 移除参数中的尖括号并转为小写
    let env = args[0].toLowerCase().replace(/[<>]/g, '');
    
    if (!['python', 'c++', 'cmd'].includes(env)) {
        terminal.println(`错误: 不支持的环境 '${env}'`, 'error-line');
        terminal.println('可用环境: python, c++, cmd', 'info-line');
        return;
    }

    terminal.isProcessing = true;
    terminal.printHtml('<span class="loading"></span>正在加载环境...', 'info-line');

    try {
        if (env === 'python') {
            await initPythonEnv();
            terminal.currentEnv = 'python';
            terminal.setPrompt('user@mltsf:python$ ');
        } else if (env === 'c++') {
            await initCppEnv();
            terminal.currentEnv = 'c++';
            terminal.setPrompt('user@mltsf:c++$ ');
        } else if (env === 'cmd') {
            initCmdEnv();
            terminal.currentEnv = 'cmd';
            terminal.setPrompt('C:\\Users\\user> ');
        }

        // 移除加载行
        terminal.output.lastChild.remove();
        terminal.println(`成功加载 ${env.toUpperCase()} 环境`, 'success-line');
        terminal.println('提示: 现在可以直接输入代码执行，或使用 /run 文件名 运行文件', 'info-line');
        terminal.updateEnvDisplay(env.toUpperCase());
    } catch (error) {
        terminal.output.lastChild.remove();
        terminal.println(`加载 ${env} 环境失败: ${error.message}`, 'error-line');
        terminal.println('请检查网络连接后重试，或使用 /cq 命令刷新页面', 'info-line');
    } finally {
        terminal.isProcessing = false;
    }
}

// 打开项目进行编程
async function openProject(args) {
    if (args.length === 0) {
        terminal.println('用法: /jr <项目名>', 'info-line');
        terminal.println('示例: /jr myproject', 'info-line');
        return;
    }

    const projectName = args[0].replace(/[<>]/g, '').trim();
    const project = projects[projectName];

    if (!project) {
        terminal.println(`错误: 项目 '${projectName}' 不存在`, 'error-line');
        return;
    }

    terminal.currentProject = projectName;
    terminal.println(`成功打开项目 '${projectName}'`, 'success-line');
    terminal.println(`项目文件: ${Object.keys(project.files).join(', ') || '（空）'}`, 'info-line');
}

// 退出当前项目
async function exitProject(args) {
    if (terminal.currentProject) {
        terminal.println(`已退出项目 '${terminal.currentProject}'`, 'success-line');
        terminal.currentProject = null;
    } else {
        terminal.println('提示: 当前未打开任何项目', 'info-line');
    }
}

// 打开本地项目或文件
async function openLocalItem(args) {
    if (args.length === 0) {
        terminal.println('用法: /op <项目名或文件路径>', 'info-line');
        terminal.println('示例: /op myproject', 'info-line');
        terminal.println('      /op C:\\Users\\user\\file.py', 'info-line');
        return;
    }

    const itemName = args[0].replace(/[<>]/g, '').trim();
    const project = projects[itemName];

    if (project) {
        // 打开项目
        terminal.currentProject = itemName;
        terminal.println(`成功打开项目 '${itemName}'`, 'success-line');
        terminal.println(`项目文件: ${Object.keys(project.files).join(', ') || '（空）'}`, 'info-line');
    } else if (terminal.currentProject && projects[terminal.currentProject]?.files[itemName]) {
        // 打开项目中的文件
        const fileContent = projects[terminal.currentProject].files[itemName];
        terminal.println(`文件内容 (${itemName}):`, 'info-line');
        terminal.println(fileContent || '(空)');
    } else {
        terminal.println(`错误: 找不到项目或文件 '${itemName}'`, 'error-line');
    }
}

// 颜色字母映射表 (单字母 → 完整颜色名)
// 注意: Black 已被移除，因为在黑色背景下使用黑色字体会导致终端完全不可见
const colorLetterMap = {
    'R': 'Red', 'G': 'Green', 'B': 'Blue',
    'C': 'Cyan', 'Y': 'Yellow', 'M': 'Magenta',
    'W': 'White', 'A': 'Gray',
    'O': 'Orange', 'P': 'Purple', 'I': 'Pink', 'N': 'Brown'
};

// 支持的完整颜色名列表（Black 已被禁用）
const supportedColors = [
    'Red', 'Green', 'Blue', 'Cyan', 'Yellow', 'Magenta',
    'White', 'Gray', 'Orange', 'Purple', 'Pink', 'Brown'
];

// 更改终端字体颜色
function changeColor(args) {
    if (!args[0]) {
        terminal.println('用法: /color <字母>', 'info-line');
        terminal.println('可用颜色代码 (单字母首字母):', 'info-line');
        terminal.println('  R=红  G=绿  B=蓝  C=青  Y=黄  M=品红', 'info-line');
        terminal.println('  W=白  A=灰  O=橙  P=紫  I=粉  N=棕', 'info-line');
        terminal.println('（注: 黑色已禁用，因黑字与黑背景融合后无法查看）', 'warning-line');
        terminal.println('也支持全名: /color Red, /color Green ...', 'info-line');
        terminal.println('示例: /color R 或 /color Red', 'info-line');
        return;
    }

    // 移除可能的尖括号
    const raw = args[0].replace(/[<>]/g, '');
    
    // 判断是单字母还是完整颜色名
    let colorName;
    
    // 拦截 Black（无论何种输入方式）
    const rawUpper = raw.toUpperCase();
    const rawCapitalized = raw.charAt(0).toUpperCase() + raw.slice(1).toLowerCase();
    if (rawUpper === 'BLACK' || rawCapitalized === 'Black' || rawUpper === 'K') {
        terminal.println('错误：黑色字体在黑色背景下无法显示，该颜色已禁用', 'error-line');
        terminal.println('可用颜色: Red, Green, Blue, Cyan, Yellow, Magenta, White, Gray, Orange, Purple, Pink, Brown', 'info-line');
        terminal.println('单字母: R G B C Y M W A O P I N', 'info-line');
        return;
    }

    if (raw.length === 1) {
        // 单字母模式
        const letter = rawUpper;
        if (colorLetterMap[letter]) {
            colorName = colorLetterMap[letter];
        } else {
            terminal.println(`错误: 不支持的颜色字母 '${letter}'`, 'error-line');
            terminal.println('可用颜色: R G B C Y M W A O P I N', 'info-line');
            return;
        }
    } else {
        // 完整颜色名模式
        if (supportedColors.includes(rawCapitalized)) {
            colorName = rawCapitalized;
        } else {
            terminal.println(`错误: 不支持的颜色 '${rawCapitalized}'`, 'error-line');
            terminal.println('可用颜色: Red, Green, Blue, Cyan, Yellow, Magenta, White, Gray, Orange, Purple, Pink, Brown', 'info-line');
            terminal.println('单字母: R G B C Y M W A O P I N', 'info-line');
            return;
        }
    }

    // 移除所有颜色类，添加新颜色类 (应用到 body 以确保全局生效)
    const targetEl = document.body;
    supportedColors.forEach(c => {
        targetEl.classList.remove(`color-${c}`);
        document.getElementById('terminal').classList.remove(`color-${c}`);
    });
    targetEl.classList.add(`color-${colorName}`);
    document.getElementById('terminal').classList.add(`color-${colorName}`);

    // 保存颜色设置
    localStorage.setItem('mltsf-color', colorName);

    terminal.println(`终端颜色已更改为 ${colorName}`, 'success-line');
}

// 运行代码
async function runCode(args) {
    if (!terminal.currentProject) {
        terminal.println('错误: 请先使用 /jr 打开一个项目', 'error-line');
        return;
    }

    const project = projects[terminal.currentProject];
    const fileName = args[0] ? args[0].replace(/[<>]/g, '') : null;

    if (!fileName) {
        // 列出项目中的所有文件
        const files = Object.keys(project.files);
        if (files.length === 0) {
            terminal.println('当前项目为空，请先创建文件', 'info-line');
        } else {
            terminal.println('项目文件列表:', 'info-line');
            files.forEach(f => terminal.println(`- ${f}`, 'info-line'));
            terminal.println('使用 /run <文件名> 运行指定文件', 'info-line');
        }
        return;
    }

    const fileContent = project.files[fileName];
    if (!fileContent) {
        terminal.println(`错误: 文件 '${fileName}' 不存在`, 'error-line');
        return;
    }

    if (!terminal.currentEnv) {
        terminal.println('错误: 请先使用 /hj 选择环境 (python/c++/cmd)', 'error-line');
        return;
    }

    // 打印执行头部
    terminal.println('', 'info-line');
    terminal.println(`═══════════════════════════════════════════`, 'info-line');
    terminal.println(`  运行: ${fileName}`, 'info-line');
    terminal.println(`  环境: ${terminal.currentEnv.toUpperCase()}`, 'info-line');
    terminal.println(`  项目: ${terminal.currentProject}`, 'info-line');
    terminal.println(`═══════════════════════════════════════════`, 'info-line');
    terminal.println('', 'info-line');

    const startTime = Date.now();

    terminal.isProcessing = true;
    try {
        if (terminal.currentEnv === 'python') {
            await runPythonCode(fileContent, true);
        } else if (terminal.currentEnv === 'c++') {
            await runCppCode(fileContent);
        } else if (terminal.currentEnv === 'cmd') {
            const lines = fileContent.split('\n');
            for (const line of lines) {
                if (line.trim()) {
                    runCmdCommand(line.trim());
                }
            }
        }

        // 执行完成
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
        terminal.println('', 'info-line');
        terminal.println(`═══════════════════════════════════════════`, 'info-line');
        terminal.println(`  ✅ 执行完成 | 耗时: ${elapsed}s`, 'success-line');
        terminal.println(`═══════════════════════════════════════════`, 'info-line');
        terminal.println('', 'info-line');
    } catch (error) {
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
        terminal.println('', 'error-line');
        terminal.println(`═══════════════════════════════════════════`, 'error-line');
        terminal.println(`  ❌ 执行失败 | 耗时: ${elapsed}s`, 'error-line');
        terminal.println(`  错误: ${error.message}`, 'error-line');
        terminal.println(`═══════════════════════════════════════════`, 'error-line');
        terminal.println('', 'error-line');
    } finally {
        terminal.isProcessing = false;
    }
}

// 创建项目或文件
function createItem(args) {
    const raw0 = args[0] ? args[0].replace(/[<>]/g, '') : '';
    const raw1 = args[1] ? args[1].replace(/[<>]/g, '') : '';

    // 完整参数模式: /xj project 名称 或 /xj file 名称
    if (raw0 && raw1) {
        const type = raw0.toLowerCase();
        const name = raw1;

        if (type === 'project' || type === 'p') {
            createProject(name);
        } else if (type === 'file' || type === 'f') {
            if (!terminal.currentProject) {
                terminal.println('错误: 请先使用 /jr 打开一个项目，或在项目内创建文件', 'error-line');
                return;
            }
            createFile(name);
        } else {
            terminal.println(`错误: 不支持的类型 '${type}'`, 'error-line');
            terminal.println('支持的类型: project (项目), file (文件)', 'info-line');
        }
        return;
    }

    // 单个参数模式: /xj 名称 → 交互式选择
    const name = raw0;
    if (!name) {
        terminal.println('用法:', 'info-line');
        terminal.println('  /xj 名称         - 交互式选择创建项目或文件', 'info-line');
        terminal.println('  /xj project 名称  - 直接创建新项目', 'info-line');
        terminal.println('  /xj file 名称     - 在当前项目中创建新文件', 'info-line');
        terminal.println('示例:', 'info-line');
        terminal.println('  /xj myapp        - 然后选择 project 或 file', 'info-line');
        terminal.println('  /xj project myapp - 直接创建项目', 'info-line');
        return;
    }

    // 交互式选择类型
    terminal.println(`请输入要创建的 "${name}" 类型:`);
    terminal.println('  1: project (项目)', 'info-line');
    terminal.println('  2: file (文件)', 'info-line');

    // 创建临时输入
    const inputContainer = document.createElement('div');
    inputContainer.style.cssText = 'display:flex;align-items:center;margin-top:5px;';
    inputContainer.innerHTML = `
        <span style="color:var(--terminal-prompt);">选择类型 (1/2)&gt; </span>
        <input type="text" id="xj-type-input"
               style="background:#000;color:var(--terminal-color);border:none;outline:none;font-family:inherit;font-size:14px;flex:1;"
               autocomplete="off">
    `;

    terminal.input.disabled = true;
    terminal.input.style.opacity = '0.3';

    terminal.output.appendChild(inputContainer);
    terminal.scrollToBottom();

    const typeInput = document.getElementById('xj-type-input');
    if (typeInput) {
        typeInput.focus();
        typeInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                const choice = typeInput.value.trim();
                inputContainer.remove();
                terminal.input.disabled = false;
                terminal.input.style.opacity = '1';
                terminal.input.focus();

                if (choice === '1' || choice.toLowerCase() === 'p' || choice.toLowerCase() === 'project') {
                    createProject(name);
                } else if (choice === '2' || choice.toLowerCase() === 'f' || choice.toLowerCase() === 'file') {
                    if (!terminal.currentProject) {
                        terminal.println('错误: 当前未打开任何项目，无法创建文件', 'error-line');
                        terminal.println('提示: 请先用 /xj project 项目名 创建项目，或用 /jr 打开已有项目', 'info-line');
                        return;
                    }
                    createFile(name);
                } else {
                    terminal.println(`已取消创建 '${name}'`, 'info-line');
                }
            }
        });
    }
}

// 安装Python包
async function installPackage(args) {
    if (!args[0]) {
        terminal.println('用法: /d <包名>', 'info-line');
        terminal.println('示例: /d numpy', 'info-line');
        return;
    }

    if (terminal.currentEnv !== 'python') {
        terminal.println('错误: 请先使用 /hj python 切换到Python环境', 'error-line');
        return;
    }

    const packageName = args[0].replace(/[<>]/g, '');
    terminal.println(`正在安装包 '${packageName}'...`, 'info-line');

    try {
        await installPythonPackage(packageName);
        terminal.println(`成功安装 '${packageName}'`, 'success-line');
    } catch (error) {
        terminal.println(`安装 '${packageName}' 失败: ${error.message}`, 'error-line');
    }
}

// 删除项目或文件
function deleteItem(args) {
    if (!args[0]) {
        terminal.println('用法:', 'info-line');
        terminal.println('  /b project 项目名  - 删除项目', 'info-line');
        terminal.println('  /b file 文件名     - 在当前项目中删除文件', 'info-line');
        return;
    }

    const type = args[0].replace(/[<>]/g, '');
    const itemName = args[1] ? args[1].replace(/[<>]/g, '') : '';

    if (!itemName) {
        // 如果只有一个参数，检查是否是项目名
        if (projects[type]) {
            deleteProject(type);
        } else {
            terminal.println(`错误: 未找到项目或文件 '${type}'`, 'error-line');
        }
        return;
    }

    if (type === 'project') {
        deleteProject(itemName);
    } else if (type === 'file') {
        if (!terminal.currentProject) {
            terminal.println('错误: 请先使用 /jr 打开一个项目', 'error-line');
            return;
        }
        deleteFile(itemName);
    } else {
        terminal.println(`错误: 不支持的类型 '${type}'`, 'error-line');
    }
}

// CMD环境初始化
function initCmdEnv() {
    terminal.println('CMD环境已就绪', 'success-line');
    terminal.println('提示: 输入CMD命令直接执行', 'info-line');
}

// 运行CMD命令
function runCmdCommand(cmd) {
    terminal.println(`执行: ${cmd}`, 'info-line');
    // 由于浏览器限制，CMD命令只能在服务器端执行
    // 这里模拟输出
    terminal.println('注意: CMD命令在浏览器中无法直接执行', 'warning-line');
    terminal.println('建议切换到其他环境或使用本地终端', 'info-line');
}

// 源 (Source) 管理 - localStorage key
const SOURCE_STORAGE_KEY = 'mltsf-source';

// 可用源列表
const sourceList = [
    { id: 'official', name: '官方源 (Official)', url: '默认官方源' },
    { id: 'mirror', name: '镜像源 (Mirror - 清华)', url: 'https://pypi.tuna.tsinghua.edu.cn/simple' }
];

// 切换源 - 带交互提示
function toggleSource(args) {
    const currentSource = localStorage.getItem(SOURCE_STORAGE_KEY) || 'official';
    const currentName = sourceList.find(s => s.id === currentSource)?.name || '未知';

    terminal.println('╔══════════════════════════════════════════╗', 'info-line');
    terminal.println('║              源 (Source) 切换             ║', 'info-line');
    terminal.println('╚══════════════════════════════════════════╝', 'info-line');
    terminal.println(`当前源: ${currentName}`, 'info-line');
    terminal.println('');
    terminal.println('请选择要切换到的源 (输入编号或字母后按 Enter):', 'info-line');
    terminal.println('  1: 官方源 (Official)', 'info-line');
    terminal.println('  2: 镜像源 (Mirror - 清华)', 'info-line');
    terminal.println('  其他: 取消', 'info-line');

    // 创建临时输入界面
    const inputContainer = document.createElement('div');
    inputContainer.style.cssText = 'display:flex;align-items:center;margin-top:5px;';
    inputContainer.innerHTML = `
        <span style="color:var(--terminal-prompt);">选择&gt; </span>
        <input type="text" id="source-input"
               style="background:#000;color:var(--terminal-color);border:none;outline:none;font-family:inherit;font-size:14px;flex:1;"
               autocomplete="off">
    `;

    // 禁用主输入框
    terminal.input.disabled = true;
    terminal.input.style.opacity = '0.3';

    const output = terminal.output;
    output.appendChild(inputContainer);

    const sourceInput = document.getElementById('source-input');
    if (sourceInput) {
        sourceInput.focus();

        const handleInput = (e) => {
            if (e.key === 'Enter') {
                const choice = sourceInput.value.trim();
                inputContainer.remove();

                // 恢复主输入框
                terminal.input.disabled = false;
                terminal.input.style.opacity = '1';
                terminal.input.focus();

                let selectedSource = null;
                if (choice === '1' || choice.toLowerCase() === 'o' || choice.toLowerCase() === 'official') {
                    selectedSource = 'official';
                } else if (choice === '2' || choice.toLowerCase() === 'm' || choice.toLowerCase() === 'mirror') {
                    selectedSource = 'mirror';
                }

                if (selectedSource) {
                    if (selectedSource === currentSource) {
                        terminal.println(`当前已是 ${sourceList.find(s => s.id === selectedSource)?.name}，无需切换`, 'info-line');
                    } else {
                        localStorage.setItem(SOURCE_STORAGE_KEY, selectedSource);
                        const newName = sourceList.find(s => s.id === selectedSource)?.name || '未知';
                        terminal.println(`源已切换到: ${newName}`, 'success-line');
                        terminal.println('提示: 切换源后部分功能需要刷新页面才能生效 (/cq)', 'info-line');
                    }
                } else {
                    terminal.println('已取消切换', 'info-line');
                }
            }
        };

        sourceInput.addEventListener('keydown', handleInput);
    }
}

// 写入/修改文件内容 (/wr 命令)
function writeFile(args) {
    const fileName = args[0] ? args[0].replace(/[<>]/g, '').trim() : '';

    if (!fileName) {
        terminal.println('用法: /wr <文件名>', 'info-line');
        terminal.println('示例: /wr main.py', 'info-line');
        terminal.println('      /wr index.html', 'info-line');
        return;
    }

    if (!terminal.currentProject) {
        terminal.println('错误: 请先使用 /jr 打开一个项目', 'error-line');
        return;
    }

    const project = projects[terminal.currentProject];
    const existingContent = project.files[fileName] || '';

    terminal.println(`正在编辑文件 '${fileName}'...`, 'info-line');
    terminal.println('--- 在下方编辑区输入内容，按 Ctrl+Enter 保存 ---', 'info-line');

    // 创建编辑区域
    const editorContainer = document.createElement('div');
    editorContainer.style.cssText = 'margin:5px 0;width:100%;';

    const textarea = document.createElement('textarea');
    textarea.value = existingContent;
    textarea.style.cssText = `
        width:100%;
        min-height:200px;
        background:var(--terminal-bg, #000000);
        color:var(--terminal-color, #00ff00);
        border:1px solid var(--terminal-color, #00ff00);
        border-radius:4px;
        padding:8px;
        font-family:'Consolas','Courier New',monospace;
        font-size:13px;
        resize:vertical;
        outline:none;
        box-sizing:border-box;
    `;
    textarea.spellcheck = false;
    textarea.autocomplete = 'off';
    textarea.placeholder = '在此输入文件内容...';

    const buttonBar = document.createElement('div');
    buttonBar.style.cssText = 'display:flex;gap:8px;margin-top:6px;align-items:center;';

    const saveBtn = document.createElement('button');
    saveBtn.textContent = '💾 保存 (Ctrl+Enter)';
    saveBtn.style.cssText = `
        padding:5px 14px;
        background:var(--terminal-color, #00ff00);
        color:#1a1a2e;
        border:none;
        border-radius:3px;
        cursor:pointer;
        font-family:inherit;
        font-size:13px;
        font-weight:bold;
    `;

    const cancelBtn = document.createElement('button');
    cancelBtn.textContent = '取消 (Esc)';
    cancelBtn.style.cssText = `
        padding:5px 14px;
        background:#555;
        color:#fff;
        border:none;
        border-radius:3px;
        cursor:pointer;
        font-family:inherit;
        font-size:13px;
    `;

    const statusMsg = document.createElement('span');
    statusMsg.style.cssText = 'font-size:12px;color:#888;margin-left:8px;';
    statusMsg.textContent = existingContent ? `已加载 ${fileName}` : '新文件';

    buttonBar.appendChild(saveBtn);
    buttonBar.appendChild(cancelBtn);
    buttonBar.appendChild(statusMsg);
    editorContainer.appendChild(textarea);
    editorContainer.appendChild(buttonBar);

    // 禁用主输入框
    terminal.input.disabled = true;
    terminal.input.style.opacity = '0.3';

    terminal.output.appendChild(editorContainer);
    terminal.scrollToBottom();
    textarea.focus();

    // 修复：编辑器失去焦点时自动恢复，防止点击外部导致焦点丢失（高优3）
    textarea.addEventListener('blur', () => {
        setTimeout(() => {
            // 只有编辑器还在DOM中才恢复焦点
            if (document.body.contains(editorContainer)) {
                textarea.focus();
            }
        }, 10);
    });

    // 保存函数
    function doSave() {
        const content = textarea.value;

        if (terminal.currentProject && projects[terminal.currentProject]) {
            project.files[fileName] = content;
            saveProjects();
            statusMsg.textContent = '✅ 已保存!';
            statusMsg.style.color = '#00ff00';
            terminal.println(`文件 '${fileName}' 已保存 (${content.length} 字符)`, 'success-line');
        } else {
            terminal.println('错误: 项目已丢失，请重新选择项目', 'error-line');
        }

        editorContainer.remove();
        terminal.input.disabled = false;
        terminal.input.style.opacity = '1';
        terminal.input.focus();
    }

    // 取消函数
    function doCancel() {
        if (textarea.value !== existingContent) {
            if (!confirm('文件内容已更改，确定放弃修改吗？')) {
                return;
            }
        }
        terminal.println('已取消编辑', 'info-line');
        editorContainer.remove();
        terminal.input.disabled = false;
        terminal.input.style.opacity = '1';
        terminal.input.focus();
    }

    // 事件绑定
    textarea.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            doSave();
        } else if (e.key === 'Escape') {
            e.preventDefault();
            doCancel();
        }
    });

    saveBtn.addEventListener('click', doSave);
    cancelBtn.addEventListener('click', doCancel);
}

// 显示免责声明
function showDisclaimer() {
    terminal.println('');
    terminal.println('╔══════════════════════════════════════════════════════════╗', 'info-line');
    terminal.println('║                    免 责 声 明                          ║', 'info-line');
    terminal.println('╚══════════════════════════════════════════════════════════╝', 'info-line');
    terminal.println('');
    terminal.println('1. MLTSF (多语言终端模拟器) 是一个开源学习工具，', 'info-line');
    terminal.println('   仅用于教育和学习目的。', 'info-line');
    terminal.println('');
    terminal.println('2. 本工具不对用户通过 Python/C++/CMD 环境执行的', 'info-line');
    terminal.println('   代码所产生的任何后果负责。', 'info-line');
    terminal.println('');
    terminal.println('3. 扩展包由第三方开发者提供，MLTSF 不对其内容、', 'info-line');
    terminal.println('   安全性或功能作任何保证。', 'info-line');
    terminal.println('');
    terminal.println('4. 用户应自行承担使用本工具及其扩展包的所有风险。', 'info-line');
    terminal.println('');
    terminal.println('5. 本工具完全在浏览器端运行，不会收集或上传', 'info-line');
    terminal.println('   任何用户数据。', 'info-line');
    terminal.println('');
    terminal.println('╔══════════════════════════════════════════════════════════╗', 'info-line');
    terminal.println('║  使用本工具即表示您同意以上条款                          ║', 'info-line');
    terminal.println('╚══════════════════════════════════════════════════════════╝', 'info-line');
    terminal.println('');
}

// ==========================================
// 扩展自动化指令 (Extension SDK v3.0)
// ==========================================

// 列出所有扩展注册的命令
function listExtensionCommands() {
    const extCmds = window.extensionManager && window.extensionManager.registeredCommands;
    if (!extCmds || Object.keys(extCmds).length === 0) {
        terminal.println('当前没有扩展注册任何命令', 'info-line');
        terminal.println('使用 /lxe 查看已加载的扩展包', 'info-line');
        return;
    }

    terminal.println('╔══════════════════════════════════════════╗', 'info-line');
    terminal.println('║         扩展注册命令列表                  ║', 'info-line');
    terminal.println('╚══════════════════════════════════════════╝', 'info-line');
    terminal.println('');

    Object.keys(extCmds).forEach((cmd, idx) => {
        const info = extCmds[cmd];
        terminal.println(`  ${idx + 1}. ${cmd}`, 'success-line');
        terminal.println(`     描述: ${info.description || '无描述'}`, 'info-line');
        terminal.println(`     扩展: ${info.extension || '未知'}`, 'info-line');
        terminal.println(`     用法: /runxt ${cmd} [参数...]`, 'info-line');
        terminal.println('');
    });

    terminal.println(`共 ${Object.keys(extCmds).length} 个扩展命令`, 'info-line');
    terminal.println('使用 /runxt <命令名> [参数] 调用扩展命令', 'info-line');
}

// 调用扩展注册的命令
async function runExtensionCommand(args) {
    if (!args || args.length === 0) {
        terminal.println('用法: /runxt <命令名> [参数...]', 'info-line');
        terminal.println('示例: /runxt mycommand arg1 arg2', 'info-line');
        terminal.println('提示: 使用 /extlist 查看所有可用的扩展命令', 'info-line');
        return;
    }

    const cmdName = args[0];
    const cmdArgs = args.slice(1);

    const extCmds = window.extensionManager && window.extensionManager.registeredCommands;
    if (!extCmds || !extCmds[cmdName]) {
        terminal.println(`错误: 未找到扩展命令 '${cmdName}'`, 'error-line');
        terminal.println('使用 /extlist 查看所有可用的扩展命令', 'info-line');
        return;
    }

    const extCmd = extCmds[cmdName];
    terminal.println(`[扩展命令] 正在调用 '${cmdName}' (来自: ${extCmd.extension || '未知'})...`, 'info-line');

    try {
        terminal.isProcessing = true;
        await extCmd.handler(cmdArgs, terminal);
        terminal.println(`[扩展命令] '${cmdName}' 执行完成`, 'success-line');
    } catch (e) {
        terminal.println(`[扩展命令] '${cmdName}' 执行错误: ${e.message}`, 'error-line');
    } finally {
        terminal.isProcessing = false;
    }
}

// 查看扩展系统状态
function showExtensionStatus() {
    const mgr = window.extensionManager;
    if (!mgr) {
        terminal.println('错误: 扩展管理器未加载', 'error-line');
        return;
    }

    terminal.println('╔══════════════════════════════════════════╗', 'info-line');
    terminal.println('║         扩展系统状态 (v3.0)               ║', 'info-line');
    terminal.println('╚══════════════════════════════════════════╝', 'info-line');
    terminal.println('');

    // SDK 状态
    const sdk = window.ExtensionAPI;
    terminal.println('SDK 状态:', 'info-line');
    terminal.println('  SDK 版本: v3.0', sdk ? 'success-line' : 'error-line');
    terminal.println(`  SDK 已初始化: ${sdk ? '✅ 是' : '❌ 否'}`, sdk ? 'success-line' : 'error-line');
    terminal.println('');

    // 已加载扩展
    const loadedCount = mgr.loadedExtensions ? mgr.loadedExtensions.length : 0;
    terminal.println(`已加载扩展包: ${loadedCount} 个`, loadedCount > 0 ? 'success-line' : 'info-line');

    if (loadedCount > 0) {
        mgr.loadedExtensions.forEach(name => {
            const ext = mgr.extensions[name];
            terminal.println(`  📦 ${name}`, 'info-line');
            if (ext && ext.config) {
                terminal.println(`     版本: ${ext.config.version || '未知'}`, 'info-line');
                terminal.println(`     描述: ${ext.config.description || '无描述'}`, 'info-line');
                terminal.println(`     命令: ${ext.registeredCommands ? ext.registeredCommands.join(', ') : '无'}`, 'info-line');
                terminal.println(`     资源: ${(ext.loadedCSS ? ext.loadedCSS.length : 0) + ' CSS'}, ${(ext.loadedScripts ? ext.loadedScripts.length : 0) + ' 脚本'}`, 'info-line');
            } else {
                terminal.println(`     元数据不可用`, 'warning-line');
            }
            terminal.println('');
        });
    }

    // 注册命令
    const cmdCount = Object.keys(mgr.registeredCommands || {}).length;
    terminal.println(`注册的自定义命令: ${cmdCount} 个`, 'info-line');
    terminal.println('');
    terminal.println('使用 /lxe 查看详细扩展列表', 'info-line');
    terminal.println('使用 /extlist 查看所有扩展命令', 'info-line');
}

// ==========================================
// AI 命令支持 (v2.1 根治版)
// ==========================================

var AI_CONFIG_KEY = 'mltsf-ai-config';
var AI_HISTORY_KEY = 'mltsf-ai-history';

// ---- 配置读写 ----

function aiLoadConfig() {
    try {
        var raw = localStorage.getItem(AI_CONFIG_KEY);
        if (!raw) { return null; }
        var cfg = JSON.parse(raw);

        // ---- 读出清洗（防御零宽字符 T0 bug）----
        // 不管是怎么存进来的，在读取时统一清洗零宽/控制字符
        function _scrub(s) {
            if (!s) { return ''; }
            return String(s)
                .replace(/[\u200B-\u200F\uFEFF\u00AD\u2060-\u2063]/g, '')
                .replace(/[\x00-\x1F\x7F]/g, '')
                .trim();
        }
        return {
            apiKey: _scrub(cfg.apiKey),
            url: _scrub(cfg.url),
            model: _scrub(cfg.model)
        };
    } catch (e) {
        return null;
    }
}

function aiSaveConfig(cfg) {
    try {
        localStorage.setItem(AI_CONFIG_KEY, JSON.stringify(cfg));
        return true;
    } catch (e) {
        return false;
    }
}

// ---- 历史读写 ----

function aiLoadHistory() {
    try {
        var raw = localStorage.getItem(AI_HISTORY_KEY);
        if (!raw) { return []; }
        var arr = JSON.parse(raw);
        return Array.isArray(arr) ? arr : [];
    } catch (e) {
        return [];
    }
}

function aiSaveHistory(msgs) {
    try {
        // 保留最近 20 条 + 估算 token 不超过 8000
        var trimmed = msgs.slice(-20);
        var totalEst = 0;
        for (var i = trimmed.length - 1; i >= 0; i--) {
            // 粗略估算：中文每个字 ~1 token，英文 ~0.3 token/字
            var content = trimmed[i].content || '';
            totalEst += Math.ceil(content.length * 0.5) + 4;
            if (totalEst > 8000 && i > 0) {
                trimmed = trimmed.slice(i + 1);
                break;
            }
        }
        localStorage.setItem(AI_HISTORY_KEY, JSON.stringify(trimmed));
    } catch (e) {}
}

// ---- URL 构造（根治版） ----

/**
 * 将用户输入的 URL 构造为完整的 chat/completions 端点。
 * 规则（按优先级）：
 *   0. 去除所有不可见/零宽字符（根治 T0 双协议 bug）
 *   1. 去首尾空格和尾部斜杠，补全协议（缺则加 https://）
 *   2. 含 /chat/completions（允许末尾有 query string）→ 检测版本路径，缺则补上
 *   3. 以 /v\d+ 结尾（如 /v1, /v4）→ 补 /chat/completions
 *   4. 已知主机缺版本路径 → 补 /v1/chat/completions
 *   5. 其他 → 补 /chat/completions
 * 幂等：重复调用已构建的 URL 返回相同结果
 */
function aiBuildUrl(input) {
    if (!input) { return ''; }
    var raw = String(input);

    // ---- 根治 T0 bug: 第一步就移除所有不可见字符 ----
    // 零宽空格 ZWSP (U+200B)、零宽非断空格 ZWNBSP (U+FEFF)、
    // 零宽连字 ZWJ (U+200D)、零宽非连字 ZWNJ (U+200C)、
    // 左至右标记 LRM (U+200E)、右至左标记 RLM (U+200F)、
    // 软连字符 (U+00AD)、字符合并符、BOM
    raw = raw.replace(/[\u200B-\u200F\uFEFF\u00AD\u2060\u2061\u2062\u2063]/g, '')
             .replace(/[\x00-\x1F\x7F]/g, '')    // 其他 ASCII 控制字符
             .trim()
             .replace(/\/+$/, '');

    if (!raw) { return ''; }

    // 防双协议：如用户已有 https:// 中间混入了零宽字符，清洗后可能出现
    // 如 https://https://api... 这种；只保留最后一个协议
    // 策略：找到最后一个 http:// 或 https:// 的位置，以它为起点
    var protocolRegex = /(https?:\/\/)/gi;
    var matches = [];
    var m;
    while ((m = protocolRegex.exec(raw)) !== null) {
        matches.push(m.index);
    }
    if (matches.length > 1) {
        raw = raw.substring(matches[matches.length - 1]);
    } else if (matches.length === 0) {
        // 完全没协议 → 补 https://
        raw = 'https://' + raw;
    }

    // 分离 query string + fragment
    var hashIdx = raw.indexOf('#');
    var beforeHash = hashIdx === -1 ? raw : raw.substring(0, hashIdx);
    var fragment = hashIdx === -1 ? '' : raw.substring(hashIdx);
    var qsIdx = beforeHash.indexOf('?');
    var url = qsIdx === -1 ? beforeHash : beforeHash.substring(0, qsIdx);
    var qs = qsIdx === -1 ? '' : beforeHash.substring(qsIdx);

    // 双 /chat/completions 去重
    if (/\/chat\/completions\/chat\/completions(\/|$)/.test(url)) {
        url = url.replace(/\/chat\/completions\/chat\/completions/g, '/chat/completions');
    }

    var lowerUrl = url.toLowerCase();
    var knownHosts = ['api.openai.com', 'api.deepseek.com', 'api.moonshot.cn',
        'api.siliconflow.cn', 'open.bigmodel.cn', 'dashscope.aliyuncs.com'];

    // 已含完整端点 /chat/completions
    if (/\/chat\/completions$/.test(url)) {
        for (var i = 0; i < knownHosts.length; i++) {
            var h = knownHosts[i];
            if (lowerUrl.indexOf(h) !== -1 && !/\/v\d+\//.test(lowerUrl)) {
                if (h === 'dashscope.aliyuncs.com') {
                    return url.replace(/\/chat\/completions$/, '/compatible-mode/v1/chat/completions') + qs + fragment;
                }
                return url.replace(/\/chat\/completions$/, '/v1/chat/completions') + qs + fragment;
            }
        }
        return url + qs + fragment;
    }

    // 已有版本路径（如 /v1, /v4）→ 补 /chat/completions
    if (/\/v\d+$/.test(url)) { return url + '/chat/completions' + qs + fragment; }

    // 已知主机缺版本路径
    for (var j = 0; j < knownHosts.length; j++) {
        var h2 = knownHosts[j];
        if (lowerUrl.indexOf(h2) !== -1 && !/\/v\d+/.test(lowerUrl)) {
            if (h2 === 'dashscope.aliyuncs.com') {
                return url + '/compatible-mode/v1/chat/completions' + qs + fragment;
            }
            return url + '/v1/chat/completions' + qs + fragment;
        }
    }

    // 默认
    var finalUrl = url + '/chat/completions' + qs + fragment;

    // ---- 最终 URL 验证：用浏览器原生 URL 构造器检查 ----
    try {
        new URL(finalUrl);  // 浏览器内置；Node 10+ 也有
    } catch (e) {
        // 无法解析时，返回一个带提示的空字符串，方便上层提示用户
        return '';
    }
    return finalUrl;
}

// ---- 交互式输入框 ----

function aiPrompt(label, defaultVal, isPassword) {
    return new Promise(function (resolve) {
        var row = document.createElement('div');
        row.style.cssText = 'display:flex;align-items:center;margin-top:5px;';

        var span = document.createElement('span');
        span.style.cssText = 'color:var(--terminal-color,#00ff00);white-space:nowrap;';
        span.textContent = label;
        row.appendChild(span);

        var inp = document.createElement('input');
        inp.type = isPassword ? 'password' : 'text';
        // 修复: defaultVal 可以是空字符串、0 等 falsy 值
        inp.value = (defaultVal != null) ? String(defaultVal) : '';
        inp.style.cssText = 'background:var(--terminal-bg,#000);color:var(--terminal-color,#00ff00);border:1px solid var(--terminal-color,#00ff00);border-radius:2px;outline:none;font-family:inherit;font-size:14px;flex:1;margin-left:4px;padding:2px 4px;';
        // 修复: 仅密码输入框设置 autocomplete
        inp.autocomplete = isPassword ? 'new-password' : 'off';
        row.appendChild(inp);

        var out = document.getElementById('output');
        if (!out) { resolve(null); return; }
        out.appendChild(row);
        out.scrollTop = out.scrollHeight;
        inp.focus();

        // 禁用主输入
        if (terminal && terminal.input) {
            terminal.input.disabled = true;
            terminal.input.style.opacity = '0.3';
        }

        var done = function (val) {
            row.remove();
            if (terminal && terminal.input) {
                terminal.input.disabled = false;
                terminal.input.style.opacity = '1';
                terminal.input.focus();
            }
            inp.removeEventListener('keydown', onKey);
            resolve(val);
        };

        var onKey = function (e) {
            if (e.key === 'Enter') {
                e.preventDefault();
                done(inp.value.trim());
            } else if (e.key === 'Escape') {
                e.preventDefault();
                done(null);
            }
        };
        inp.addEventListener('keydown', onKey);
    });
}

// ---- 配置向导 ----

// 掩码标记：用于区分"用户未修改 key"和"用户输入了新的 key"
var AI_KEY_MASK_PREFIX = '##MASK##';

function aiConfigure() {
    return _aiConfigure().catch(function (e) {
        terminal.println('配置过程出错: ' + (e && e.message || String(e)), 'error-line');
    });
}

async function _aiConfigure() {
    var old = aiLoadConfig() || {};

    terminal.println('', 'info-line');
    terminal.println('=== AI 配置 (ESC 取消, 留空保留原值) ===', 'info-line');
    terminal.println('', 'info-line');

    // ---- 通用输入清洗（根治零宽字符 T0 bug）----
    function _sanitize(s) {
        if (s == null) { return s; }
        return String(s)
            // 零宽/控制字符
            .replace(/[\u200B-\u200F\uFEFF\u00AD\u2060-\u2063]/g, '')
            // ASCII 控制字符
            .replace(/[\x00-\x1F\x7F]/g, '')
            .trim();
    }

    // API Key
    var keyDefault = '';
    if (old.apiKey) {
        keyDefault = AI_KEY_MASK_PREFIX + old.apiKey.slice(-4);
    }
    var apiKey = await aiPrompt('API Key: ', keyDefault, true);
    if (apiKey === null) { terminal.println('已取消', 'warning-line'); return; }
    var finalKey;
    if (String(apiKey).indexOf(AI_KEY_MASK_PREFIX) === 0 && old.apiKey) {
        finalKey = old.apiKey;
    } else {
        finalKey = _sanitize(apiKey);  // 清洗 API Key 中的不可见字符
    }

    // URL
    terminal.println('常见: https://api.deepseek.com  https://api.openai.com/v1', 'info-line');
    var url = await aiPrompt('API URL: ', old.url || 'https://api.deepseek.com', false);
    if (url === null) { terminal.println('已取消', 'warning-line'); return; }
    var finalUrl = _sanitize(url) || _sanitize(old.url);  // 清洗 URL 中的不可见字符

    // Model
    terminal.println('DeepSeek: deepseek-chat / deepseek-reasoner | OpenAI: gpt-4o', 'info-line');
    var model = await aiPrompt('模型: ', old.model || 'deepseek-chat', false);
    if (model === null) { terminal.println('已取消', 'warning-line'); return; }
    var finalModel = _sanitize(model) || _sanitize(old.model) || 'deepseek-chat';

    // ---- 验证最终 URL ----
    var builtUrl = aiBuildUrl(finalUrl);
    if (!builtUrl) {
        terminal.println('', 'error-line');
        terminal.println('错误: URL 无效，无法保存', 'error-line');
        terminal.println('  输入: ' + finalUrl, 'info-line');
        terminal.println('  请输入合法的 URL（如 https://api.deepseek.com）', 'info-line');
        return;
    }

    // 保存构建后的 URL，显示/存储/请求三者一致
    var cfg = { apiKey: finalKey, url: builtUrl, model: finalModel };
    if (!aiSaveConfig(cfg)) {
        terminal.println('错误: 配置保存失败', 'error-line');
        return;
    }

    terminal.println('', 'success-line');
    terminal.println('配置已保存:', 'success-line');
    terminal.println('  URL:   ' + builtUrl, 'info-line');
    terminal.println('  模型:  ' + finalModel, 'info-line');
    terminal.println('  Key:   ' + (finalKey ? '****' + finalKey.slice(-4) : '(空)'), 'info-line');
    terminal.println('', 'info-line');
    terminal.println('用法: /ai 你的问题', 'info-line');
}

// ---- 清除配置 ----

function aiClearAll() {
    try {
        localStorage.removeItem(AI_CONFIG_KEY);
        localStorage.removeItem(AI_HISTORY_KEY);
    } catch (e) {
        terminal.println('清除失败: ' + (e && e.message || String(e)), 'error-line');
        return;
    }
    terminal.println('AI 配置和对话历史已清除', 'success-line');
}

// ---- 清除历史 ----

function aiClearHistory() {
    try {
        localStorage.removeItem(AI_HISTORY_KEY);
    } catch (e) {
        terminal.println('清除失败: ' + (e && e.message || String(e)), 'error-line');
        return;
    }
    terminal.println('对话历史已清除', 'success-line');
}

// ---- 查看历史 ----

function aiShowHistory() {
    var msgs = aiLoadHistory();
    if (msgs.length === 0) {
        terminal.println('暂无对话历史', 'info-line');
        return;
    }
    terminal.println('', 'info-line');
    terminal.println('=== 对话历史 (最近 ' + msgs.length + ' 条) ===', 'info-line');
    for (var i = 0; i < msgs.length; i++) {
        var m = msgs[i];
        var role = m.role === 'user' ? '[我]' : '[AI]';
        // 修复: emoji 安全截断，使用 Array.from 处理多字节字符
        var content = m.content || '';
        var chars = [];
        try { chars = Array.from(content); } catch (e) { chars = content.split(''); }
        var text = chars.length > 100 ? chars.slice(0, 100).join('') + '...' : content;
        terminal.println(role + ' ' + text, m.role === 'user' ? 'info-line' : 'success-line');
    }
    terminal.println('', 'info-line');
}

// ---- 发送请求 ----

/**
 * 判断是否为网络/浏览器端连接错误（跨浏览器兼容）
 */
function _isNetworkError(e) {
    if (!e) { return false; }
    // Chrome
    if (e.message === 'Failed to fetch') { return true; }
    // Firefox
    if (e.message && e.message.indexOf('NetworkError') !== -1) { return true; }
    // Safari
    if (e.message && e.message.indexOf('Load failed') !== -1) { return true; }
    // 通用: TypeError 且 message 包含 fetch/network 关键词
    if (e instanceof TypeError) {
        var msg = (e.message || '').toLowerCase();
        if (msg.indexOf('fetch') !== -1 || msg.indexOf('network') !== -1) { return true; }
    }
    return false;
}

function aiSend(question) {
    return _aiSend(question).catch(function (e) {
        // 最外层安全网：任何未捕获的异常都会到这里
        terminal.println('', 'error-line');
        terminal.println('AI 模块发生未预期错误', 'error-line');
        terminal.println('类型: ' + (e && e.name || 'Unknown'), 'error-line');
        terminal.println('信息: ' + (e && e.message || String(e)), 'error-line');
        terminal.println('请刷新页面后重试', 'info-line');
    });
}

async function _aiSend(question) {
    var cfg = aiLoadConfig();
    if (!cfg || !cfg.apiKey) {
        terminal.println('错误: 请先 /ai code 配置', 'error-line');
        return;
    }
    if (!cfg.url) {
        terminal.println('错误: API URL 未配置', 'error-line');
        return;
    }

    var endpoint = aiBuildUrl(cfg.url);
    // ---- T0 防御：URL 构造失败时明确报错并引导 ----
    if (!endpoint) {
        terminal.println('', 'error-line');
        terminal.println('错误: API URL 无效，无法发送请求', 'error-line');
        terminal.println('  当前配置 URL: ' + cfg.url, 'info-line');
        terminal.println('', 'warning-line');
        terminal.println('请执行 /ai code 重新配置，输入合法的 URL（如 https://api.deepseek.com）', 'warning-line');
        terminal.println('', 'info-line');
        return;
    }
    var model = cfg.model || 'deepseek-chat';

    terminal.println('', 'info-line');
    terminal.println('正在请求 AI...', 'info-line');
    terminal.println('  端点: ' + endpoint, 'info-line');
    terminal.println('  模型: ' + model, 'info-line');
    terminal.println('', 'info-line');

    // 构造消息列表
    var history = aiLoadHistory();
    var messages = [
        { role: 'system', content: '你是 MLTSF 终端的 AI 助手，用中文简洁回答。如需执行终端命令，在回复中单独一行写 /开头 的命令。' }
    ];

    // 注入扩展提供的上下文（v4.0 AI 趋势）
    var extContext = window._mltsf_ai_context;
    if (extContext && extContext.length > 0) {
        for (var ci = 0; ci < extContext.length; ci++) {
            messages.push({ role: extContext[ci].role, content: '[扩展上下文] ' + extContext[ci].content });
        }
    }

    for (var i = 0; i < history.length; i++) {
        messages.push(history[i]);
    }
    messages.push({ role: 'user', content: question });

    var requestBody = {
        model: model,
        messages: messages,
        stream: false,
        temperature: 0.7,
        max_tokens: 4096
    };

    // 注册的 Tools（v4.0 AI 趋势 — Function Calling）
    var extTools = window._mltsf_ai_tools;
    if (extTools && Object.keys(extTools).length > 0) {
        var tools = [];
        var toolNames = Object.keys(extTools);
        for (var ti = 0; ti < toolNames.length; ti++) {
            var t = extTools[toolNames[ti]];
            tools.push({
                type: 'function',
                function: {
                    name: t.name,
                    description: t.description,
                    parameters: t.parameters
                }
            });
        }
        requestBody.tools = tools;
        requestBody.tool_choice = 'auto';
    }

    // 请求（带超时清理）
    var response;
    var timer;
    try {
        var ctrl = new AbortController();
        timer = setTimeout(function () { ctrl.abort(); }, 120000);
        response = await fetch(endpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + cfg.apiKey
            },
            body: JSON.stringify(requestBody),
            signal: ctrl.signal
        });
        clearTimeout(timer);
    } catch (e) {
        // 修复: 清除超时定时器
        if (timer) { clearTimeout(timer); }
        aiPrintError(e, endpoint, cfg);
        return;
    }

    // 解析响应
    if (!response.ok) {
        var detail = '';
        try {
            var txt = await response.text();
            try {
                var j = JSON.parse(txt);
                detail = j.error && j.error.message ? j.error.message
                    : (j.error || j.message || txt.substring(0, 200));
            } catch (e2) {
                detail = txt.substring(0, 200);
            }
        } catch (e3) {}
        var code = response.status;
        terminal.println('', 'error-line');
        terminal.println('AI 请求失败 (HTTP ' + code + ')', 'error-line');
        if (detail) { terminal.println('  服务端返回: ' + detail, 'error-line'); }
        terminal.println('', 'info-line');
        if (code === 400) {
            terminal.println('诊断: 请求参数有误', 'warning-line');
            terminal.println('  - 模型名 "' + model + '" 可能不存在', 'warning-line');
            terminal.println('  - DeepSeek 有效模型: deepseek-chat, deepseek-reasoner', 'info-line');
            terminal.println('  - 用 /ai code 修改模型名', 'info-line');
        } else if (code === 401) {
            terminal.println('诊断: API Key 无效', 'warning-line');
            terminal.println('  - 用 /ai code 重新输入 Key', 'info-line');
        } else if (code === 402) {
            terminal.println('诊断: 账户余额不足', 'warning-line');
        } else if (code === 404) {
            terminal.println('诊断: 地址或模型不存在', 'warning-line');
            terminal.println('  - 实际请求: ' + endpoint, 'info-line');
            terminal.println('  - 验证: curl ' + endpoint, 'info-line');
            terminal.println('  - 用 /ai code 修改', 'info-line');
        } else if (code === 405) {
            terminal.println('诊断: 请求方法不允许 (Method Not Allowed)', 'warning-line');
            terminal.println('  - 实际请求: ' + endpoint, 'info-line');
            terminal.println('  - 可能原因: URL 地址不正确或缺少协议 https://', 'warning-line');
            terminal.println('  - 解决: 用 /ai code 重新配置 URL，确保包含 https://', 'info-line');
            terminal.println('  - 参考: https://api.deepseek.com', 'info-line');
        } else if (code === 429) {
            terminal.println('诊断: 请求过快或额度用尽', 'warning-line');
            terminal.println('  - 请稍后重试', 'info-line');
        } else if (code >= 500) {
            terminal.println('诊断: 服务端异常, 稍后重试', 'warning-line');
        } else {
            terminal.println('诊断: 未知 HTTP 错误', 'warning-line');
        }
        terminal.println('', 'info-line');
        terminal.println('当前配置: URL=' + cfg.url + ' 模型=' + model, 'info-line');
        return;
    }

    // 成功 — 解析响应体
    var rawText;
    try {
        rawText = await response.text();
    } catch (e) {
        terminal.println('错误: 无法读取响应体', 'error-line');
        return;
    }

    var data;
    try {
        data = JSON.parse(rawText);
    } catch (e) {
        terminal.println('错误: API 返回非 JSON 数据', 'error-line');
        // 输出前 200 字符帮助诊断
        if (rawText) {
            terminal.println('原始响应: ' + rawText.substring(0, 200), 'info-line');
        }
        return;
    }

    // 安全访问 choices
    if (!data || !data.choices || !Array.isArray(data.choices) || data.choices.length === 0) {
        terminal.println('错误: API 返回了空的 choices', 'error-line');
        return;
    }

    var choice = data.choices[0];

    // 处理 tool_calls（v4.0 AI 趋势 — Function Calling）
    if (choice.message && choice.message.tool_calls && Array.isArray(choice.message.tool_calls) && choice.message.tool_calls.length > 0) {
        terminal.println('', 'info-line');
        terminal.println('AI 请求调用工具...', 'info-line');
        var toolResults = [];
        for (var tc = 0; tc < choice.message.tool_calls.length; tc++) {
            var tcItem = choice.message.tool_calls[tc];
            var funcName = (tcItem.function && tcItem.function.name) || '';
            var funcArgs = {};
            try {
                funcArgs = JSON.parse((tcItem.function && tcItem.function.arguments) || '{}');
            } catch (ea) { funcArgs = {}; }
            terminal.println('  调用: ' + funcName + '(' + JSON.stringify(funcArgs) + ')', 'warning-line');

            var toolResult = '';
            var tool = extTools && extTools[funcName];
            if (tool && typeof tool.handler === 'function') {
                try {
                    var handlerResult = tool.handler(funcArgs);
                    if (handlerResult && typeof handlerResult.then === 'function') {
                        toolResult = JSON.stringify(await handlerResult);
                    } else {
                        toolResult = JSON.stringify(handlerResult);
                    }
                } catch (et) {
                    toolResult = JSON.stringify({ error: et.message });
                }
            } else {
                toolResult = JSON.stringify({ error: '工具未注册: ' + funcName });
            }
            terminal.println('  结果: ' + toolResult.substring(0, 200), 'info-line');
            toolResults.push({
                role: 'tool',
                tool_call_id: tcItem.id || ('call_' + tc),
                content: toolResult
            });
        }

        // 将 tool 结果发送回 AI 获取最终回复
        terminal.println('', 'info-line');
        terminal.println('正在获取 AI 最终回复...', 'info-line');
        var followUpMessages = messages.concat([choice.message]);
        for (var tr = 0; tr < toolResults.length; tr++) {
            followUpMessages.push(toolResults[tr]);
        }
        var followUpBody = {
            model: model,
            messages: followUpMessages,
            stream: false,
            temperature: 0.7,
            max_tokens: 4096
        };
        try {
            var followUpResp = await fetch(endpoint, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': 'Bearer ' + cfg.apiKey
                },
                body: JSON.stringify(followUpBody)
            });
            if (followUpResp.ok) {
                var followUpData = await followUpResp.json();
                var followUpChoice = followUpData.choices && followUpData.choices[0];
                if (followUpChoice && followUpChoice.message && followUpChoice.message.content) {
                    choice = followUpChoice;
                    data = followUpData;
                }
            }
        } catch (ef) {
            terminal.println('获取最终回复失败: ' + ef.message, 'error-line');
        }
    }

    if (!choice || !choice.message || typeof choice.message.content !== 'string') {
        terminal.println('错误: API 返回格式异常（缺少 message.content）', 'error-line');
        return;
    }

    var reply = choice.message.content;

    // 保存历史
    history.push({ role: 'user', content: question });
    history.push({ role: 'assistant', content: reply });
    aiSaveHistory(history);

    // 显示回复
    terminal.println('', 'success-line');
    terminal.println('=== AI 回复 ===', 'success-line');
    terminal.println('', 'info-line');

    var cmds = [];
    var lines = reply.split('\n');
    for (var k = 0; k < lines.length; k++) {
        var line = lines[k];
        var t = line.trim();
        if (t.length > 1 && t.charAt(0) === '/') {
            cmds.push(t);
            terminal.println(t, 'warning-line');
        } else {
            terminal.println(line, 'code-line');
        }
    }

    // 执行命令
    if (cmds.length > 0) {
        terminal.println('', 'info-line');
        terminal.println('执行 AI 指定的命令:', 'info-line');
        for (var m = 0; m < cmds.length; m++) {
            var c = cmds[m];
            terminal.println('> ' + c, 'warning-line');
            try {
                if (terminal && terminal.processSystemCommand) {
                    await terminal.processSystemCommand(c);
                }
            } catch (e) {
                terminal.println('命令失败: ' + (e && e.message || String(e)), 'error-line');
            }
        }
    }

    terminal.println('', 'info-line');
    var tokens = (data.usage && data.usage.total_tokens != null) ? data.usage.total_tokens : '?';
    terminal.println('--- 完成 (Token: ' + tokens + ') ---', 'info-line');
}

// ---- 网络错误诊断 ----

function aiPrintError(e, endpoint, cfg) {
    var msg = (e && e.message) || String(e || '');
    terminal.println('', 'error-line');
    terminal.println('AI 请求失败: ' + msg, 'error-line');
    terminal.println('', 'info-line');
    if (e && e.name === 'AbortError') {
        terminal.println('诊断: 请求超时 (120秒)', 'warning-line');
        terminal.println('  - AI 模型响应过慢, 请稍后重试', 'info-line');
    } else if (_isNetworkError(e)) {
        terminal.println('诊断: 网络请求失败 (可能 CORS 或连接问题)', 'warning-line');
        terminal.println('  - 请通过 http://localhost:3000 访问 (运行 start.bat)', 'info-line');
        terminal.println('  - 不要直接双击 HTML 打开（file:// 协议无法跨域）', 'info-line');
        terminal.println('  - 端点: ' + endpoint, 'info-line');
    } else {
        terminal.println('诊断: ' + msg, 'warning-line');
    }
    terminal.println('', 'info-line');
    if (cfg) {
        terminal.println('配置: URL=' + (cfg.url || '') + ' 模型=' + (cfg.model || 'deepseek-chat'), 'info-line');
    }
}

// ---- AI 命令入口 ----

var AI_SUB_COMMANDS = ['code', 'config', 'clear', 'history'];

function aiCommand(args) {
    return _aiCommand(args).catch(function (e) {
        terminal.println('AI 命令执行出错: ' + (e && e.message || String(e)), 'error-line');
    });
}

async function _aiCommand(args) {
    if (!args || args.length === 0) {
        terminal.println('用法:', 'info-line');
        terminal.println('  /ai 你的问题     - 向 AI 提问', 'info-line');
        terminal.println('  /ai code         - 配置 API', 'info-line');
        terminal.println('  /ai clear        - 清除对话历史', 'info-line');
        terminal.println('  /ai history      - 查看对话历史', 'info-line');
        return;
    }

    var sub = args[0].toLowerCase();

    // 修复: 子命令二义性 — 仅当用户输入恰好是单个子命令时才走子命令分支
    if (args.length === 1) {
        if (sub === 'code' || sub === 'config') {
            await aiConfigure();
            return;
        }
        if (sub === 'clear') {
            aiClearHistory();
            return;
        }
        if (sub === 'history') {
            aiShowHistory();
            return;
        }
    }

    // 其他 → 作为问题发送
    await aiSend(args.join(' '));
}