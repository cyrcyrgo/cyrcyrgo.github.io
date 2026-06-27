let projects = {};
window.projects = projects;

function loadProjects() {
    try {
        const saved = localStorage.getItem('mltsf-projects');
        if (saved) {
            projects = JSON.parse(saved);
            window.projects = projects;
        }
    } catch (e) {
        console.warn('加载项目数据失败，已重置:', e);
        projects = {};
        window.projects = projects;
        try { localStorage.removeItem('mltsf-projects'); } catch (e2) {}
    }
}

function saveProjects() {
    try {
        localStorage.setItem('mltsf-projects', JSON.stringify(projects));
    } catch (e) {
        console.warn('保存项目数据失败 (localStorage 可能已满):', e);
        terminal.println('警告: 项目数据保存失败，请检查存储空间', 'warning-line');
    }
}

function createProject(name) {
    if (projects[name]) {
        terminal.println(`错误: 项目 '${name}' 已存在`, 'error-line');
        return;
    }

    projects[name] = {
        name: name,
        files: {},
        createdAt: new Date().toISOString()
    };

    saveProjects();
    terminal.currentProject = name;
    terminal.println(`成功创建项目 '${name}'`, 'success-line');
    terminal.println(`已自动切换到项目 '${name}'`, 'info-line');
}

function deleteProject(name) {
    if (!projects[name]) {
        terminal.println(`错误: 项目 '${name}' 不存在`, 'error-line');
        return;
    }

    delete projects[name];
    saveProjects();

    if (terminal.currentProject === name) {
        terminal.currentProject = null;
        terminal.println(`已删除当前项目`, 'info-line');
    }

    terminal.println(`成功删除项目 '${name}'`, 'success-line');
}

function deleteAllProjects() {
    projects = {};
    window.projects = projects;
    saveProjects();
    terminal.currentProject = null;
    terminal.println('已删除所有项目', 'success-line');
}

function createFile(name) {
    const project = projects[terminal.currentProject];
    
    if (project.files[name]) {
        terminal.println(`错误: 文件 '${name}' 已存在`, 'error-line');
        return;
    }

    project.files[name] = '';
    saveProjects();
    terminal.println(`成功创建文件 '${name}'`, 'success-line');
    terminal.println('提示: 使用 /run ' + name + ' 运行此文件', 'info-line');
}

function deleteFile(name) {
    const project = projects[terminal.currentProject];
    
    if (!project.files[name]) {
        terminal.println(`错误: 文件 '${name}' 不存在`, 'error-line');
        return;
    }

    delete project.files[name];
    saveProjects();
    terminal.println(`成功删除文件 '${name}'`, 'success-line');
}

function deleteAllFiles() {
    const project = projects[terminal.currentProject];
    project.files = {};
    saveProjects();
    terminal.println('已删除当前项目中的所有文件', 'success-line');
}

function exportProject(args) {
    let format = 'txt';
    let projectName = args[0];

    // 检查是否指定了导出格式
    if (args.length >= 2 && args[1] === 'json') {
        format = 'json';
    }
    if (args.length >= 1 && args[0] === 'json') {
        format = 'json';
        projectName = args[1];
    }

    if (!projectName && !terminal.currentProject) {
        terminal.println('错误: 请指定要导出的项目名', 'error-line');
        terminal.println('用法: /dc [项目名] [格式]', 'info-line');
        terminal.println('格式: txt (默认) 或 json', 'info-line');
        return;
    }

    if (!projectName) {
        projectName = terminal.currentProject;
    }

    if (!projects[projectName]) {
        terminal.println(`错误: 项目 '${projectName}' 不存在`, 'error-line');
        return;
    }

    const project = projects[projectName];

    if (format === 'json') {
        // JSON 格式导出
        const jsonContent = JSON.stringify({
            mltsf_project: projectName,
            exportedAt: new Date().toISOString(),
            version: 'v2.23',
            files: project.files
        }, null, 2);

        const blob = new Blob([jsonContent], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${projectName}.mltsf.json`;
        a.click();
        URL.revokeObjectURL(url);

        terminal.println(`成功导出项目 '${projectName}' (JSON格式)`, 'success-line');
    } else {
        // TXT 格式导出（原有逻辑）
        let content = `# MLTSF 项目导出: ${projectName}\n`;
        content += `# 创建时间: ${project.createdAt}\n\n`;

        for (const [fileName, fileContent] of Object.entries(project.files)) {
            content += `══════════════════════════════════════════════════════════\n`;
            content += `# 文件: ${fileName}\n`;
            content += `══════════════════════════════════════════════════════════\n`;
            content += fileContent + '\n\n';
        }

        const blob = new Blob([content], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${projectName}.txt`;
        a.click();
        URL.revokeObjectURL(url);

        terminal.println(`成功导出项目 '${projectName}' (TXT格式)`, 'success-line');
    }
}

// 初始化时加载保存的项目
window.addEventListener('load', loadProjects);
