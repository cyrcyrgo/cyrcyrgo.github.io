// ===================================================================
// WebNT 文件管理器
// ===================================================================

const id = 'explorer';
const name = '文件管理';
const icon = '\ud83d\udcc1';

function launch() {
  window.showAppWindow('文件管理', '\ud83d\udcc1', `
    <style>
      .fm-wrap { display:flex;height:100%; }
      .fm-sidebar { width:180px;border-right:1px solid rgba(255,255,255,0.08);padding:8px;overflow-y:auto;flex-shrink:0; }
      .fm-sidebar .fm-tree-item { display:flex;align-items:center;gap:6px;padding:6px 8px;border-radius:6px;cursor:pointer;font-size:13px;color:#ccc; }
      .fm-sidebar .fm-tree-item:hover { background:rgba(255,255,255,0.06); }
      .fm-sidebar .fm-tree-item.active { background:rgba(102,126,234,0.25);color:#fff; }
      .fm-main { flex:1;display:flex;flex-direction:column;min-width:0; }
      .fm-toolbar { display:flex;align-items:center;gap:8px;padding:8px;border-bottom:1px solid rgba(255,255,255,0.08); }
      .fm-toolbar button { background:rgba(255,255,255,0.06);border:none;color:#ccc;padding:4px 10px;border-radius:4px;cursor:pointer;font-size:13px; }
      .fm-toolbar button:hover { background:rgba(255,255,255,0.12); }
      .fm-path { flex:1;padding:4px 10px;background:rgba(255,255,255,0.04);border-radius:4px;font-size:12px;color:#888;overflow:hidden;text-overflow:ellipsis;white-space:nowrap; }
      .fm-files { flex:1;overflow-y:auto;padding:8px;display:flex;flex-wrap:wrap;align-content:flex-start;gap:4px;position:relative; }
      .fm-file { display:flex;flex-direction:column;align-items:center;width:80px;padding:8px 4px;border-radius:8px;cursor:pointer;text-align:center;position:relative; }
      .fm-file:hover { background:rgba(255,255,255,0.05); }
      .fm-file.selected { background:rgba(102,126,234,0.2); }
      .fm-file .fm-file-icon { font-size:32px; }
      .fm-file .fm-file-name { font-size:11px;color:#ccc;margin-top:4px;word-break:break-all; }
      .fm-context-menu { position:fixed;background:rgba(30,30,40,0.98);border:1px solid rgba(255,255,255,0.1);border-radius:8px;padding:4px 0;min-width:160px;z-index:3000;box-shadow:0 4px 20px rgba(0,0,0,0.5); }
      .fm-context-menu-item { padding:8px 16px;font-size:13px;color:#ccc;cursor:pointer; }
      .fm-context-menu-item:hover { background:rgba(102,126,234,0.3); }
      .fm-context-menu-separator { height:1px;background:rgba(255,255,255,0.08);margin:4px 0; }
    </style>
    <div class="fm-wrap">
      <div class="fm-sidebar" id="fm-sidebar">
        <div class="fm-tree-item active" data-path="/" onclick="window.__fmNavigate('/')">\ud83d\udcc1 根目录</div>
        <div class="fm-tree-item" data-path="/下载" onclick="window.__fmNavigate('/下载')">\ud83d\udce5 下载</div>
        <div class="fm-tree-item" data-path="/文档" onclick="window.__fmNavigate('/文档')">\ud83d\udcc4 文档</div>
        <div class="fm-tree-item" data-path="/桌面" onclick="window.__fmNavigate('/桌面')">\ud83d\udda5\ufe0f 桌面</div>
        <div class="fm-tree-item" data-path="/系统" onclick="window.__fmNavigate('/系统')">\u2699\ufe0f 系统</div>
        <div class="fm-tree-item" data-path="/临时" onclick="window.__fmNavigate('/临时')">\ud83d\udcc1 临时</div>
      </div>
      <div class="fm-main">
        <div class="fm-toolbar">
          <button onclick="window.__fmBack()" title="返回">\u2190</button>
          <button onclick="window.__fmForward()" title="前进">\u2192</button>
          <button onclick="window.__fmUp()" title="上级">\u2191</button>
          <button onclick="window.__fmNewFolder()" title="新建文件夹">\ud83d\udcc1+</button>
          <button onclick="window.__fmNewFile()" title="新建文件">\ud83d\udcc4+</button>
          <div class="fm-path" id="fm-path">/</div>
        </div>
        <div class="fm-files" id="fm-files"></div>
      </div>
    </div>
  `);
  // Initialize FM
  if(!window.__fmInit) {
    window.__fmInit = true;
    window.__fmHistory = [];
    window.__fmHistoryIdx = -1;
    window.__fmCurrentPath = '/';
    window.__fmSelectedFile = null;
    window.__fmClipboard = null;
    const fmFS = {
      '/': {type:'dir',children:['下载','文档','桌面','系统','临时']},
      '/下载': {type:'dir',children:[]},
      '/文档': {type:'dir',children:['readme.txt','笔记.txt','项目计划.txt']},
      '/桌面': {type:'dir',children:['快捷方式.lnk']},
      '/系统': {type:'dir',children:['kernel.config','drivers.json','boot.log']},
      '/临时': {type:'dir',children:['cache.dat','日志.log']},
      '/文档/readme.txt': {type:'file',size:'1.2 KB',content:'欢迎使用 WebNT 文件管理系统！',modified:'2024-01-15 10:30'},
      '/文档/笔记.txt': {type:'file',size:'3.5 KB',content:'今天的笔记...',modified:'2024-01-16 14:20'},
      '/文档/项目计划.txt': {type:'file',size:'8.1 KB',content:'Q3 项目计划\n1. 完成 UI 组件\n2. 集成测试\n3. 发布',modified:'2024-01-14 09:15'},
      '/桌面/快捷方式.lnk': {type:'file',size:'0.5 KB',content:'[快捷方式]',modified:'2024-01-10 16:45'},
      '/系统/kernel.config': {type:'file',size:'2.3 KB',content:'kernel_version=2.01\nbuild=20260718\nscheduler=smp\nmax_threads=256\nupdate_server=https://cyrcyrgo.github.io',modified:'2026-07-18 12:00'},
      '/系统/drivers.json': {type:'file',size:'4.7 KB',content:'{"display":"webgpu","fs":"internal","net":"stream"}',modified:'2024-01-01 00:00'},
      '/系统/boot.log': {type:'file',size:'12.1 KB',content:'[正常] 内核初始化完成\n[正常] 驱动加载完成\n[正常] 用户会话已启动',modified:'2024-01-01 00:00'},
      '/临时/cache.dat': {type:'file',size:'0.8 KB',content:'[二进制数据]',modified:'2024-01-17 08:30'},
      '/临时/日志.log': {type:'file',size:'2.1 KB',content:'[日志数据]',modified:'2024-01-17 09:00'},
    };
    window.__fmNavigate = function(path) {
      if(!fmFS[path] || fmFS[path].type !== 'dir') return;
      window.__fmCurrentPath = path;
      window.__fmSelectedFile = null;
      window.__fmHistory = window.__fmHistory.slice(0, window.__fmHistoryIdx + 1);
      window.__fmHistory.push(path);
      window.__fmHistoryIdx = window.__fmHistory.length - 1;
      window.__fmRender();
    };
    window.__fmBack = function() {
      if(window.__fmHistoryIdx > 0) {
        window.__fmHistoryIdx--;
        window.__fmCurrentPath = window.__fmHistory[window.__fmHistoryIdx];
        window.__fmSelectedFile = null;
        window.__fmRender();
      }
    };
    window.__fmForward = function() {
      if(window.__fmHistoryIdx < window.__fmHistory.length - 1) {
        window.__fmHistoryIdx++;
        window.__fmCurrentPath = window.__fmHistory[window.__fmHistoryIdx];
        window.__fmSelectedFile = null;
        window.__fmRender();
      }
    };
    window.__fmUp = function() {
      const p = window.__fmCurrentPath;
      const idx = p.lastIndexOf('/');
      if(idx > 0) window.__fmNavigate(p.substring(0, idx));
      else if(window.__fmCurrentPath !== '/') window.__fmNavigate('/');
    };
    window.__fmNewFolder = function() {
      const name = prompt('输入文件夹名称:', '新建文件夹');
      if(!name) return;
      const path = window.__fmCurrentPath === '/' ? '/' + name : window.__fmCurrentPath + '/' + name;
      if(fmFS[path]) { alert('文件或文件夹已存在'); return; }
      fmFS[path] = {type:'dir',children:[]};
      const dir = fmFS[window.__fmCurrentPath];
      if(!dir.children.includes(name)) dir.children.push(name);
      window.__fmRender();
    };
    window.__fmNewFile = function() {
      const name = prompt('输入文件名称:', '新建文件.txt');
      if(!name) return;
      const path = window.__fmCurrentPath === '/' ? '/' + name : window.__fmCurrentPath + '/' + name;
      if(fmFS[path]) { alert('文件或文件夹已存在'); return; }
      fmFS[path] = {type:'file',size:'0 KB',content:'',modified:new Date().toLocaleString('zh-CN')};
      const dir = fmFS[window.__fmCurrentPath];
      if(!dir.children.includes(name)) dir.children.push(name);
      window.__fmRender();
    };
    window.__fmDelete = function(path) {
      if(!confirm('确定要删除此项目吗？')) return;
      const name = path.split('/').pop();
      const parentPath = path.substring(0, path.lastIndexOf('/')) || '/';
      const parent = fmFS[parentPath];
      if(parent) parent.children = parent.children.filter(c => c !== name);
      delete fmFS[path];
      window.__fmSelectedFile = null;
      window.__fmRender();
    };
    window.__fmRename = function(path) {
      const oldName = path.split('/').pop();
      const newName = prompt('输入新名称:', oldName);
      if(!newName || newName === oldName) return;
      const parentPath = path.substring(0, path.lastIndexOf('/')) || '/';
      const newPath = parentPath === '/' ? '/' + newName : parentPath + '/' + newName;
      if(fmFS[newPath]) { alert('文件或文件夹已存在'); return; }
      fmFS[newPath] = fmFS[path];
      delete fmFS[path];
      const parent = fmFS[parentPath];
      if(parent) {
        parent.children = parent.children.map(c => c === oldName ? newName : c);
      }
      window.__fmSelectedFile = null;
      window.__fmRender();
    };
    window.__fmCopy = function(path) {
      window.__fmClipboard = {action:'copy',path:path};
    };
    window.__fmCut = function(path) {
      window.__fmClipboard = {action:'cut',path:path};
    };
    window.__fmPaste = function() {
      if(!window.__fmClipboard) return;
      const srcPath = window.__fmClipboard.path;
      const name = srcPath.split('/').pop();
      const destPath = window.__fmCurrentPath === '/' ? '/' + name : window.__fmCurrentPath + '/' + name;
      if(fmFS[destPath]) { alert('目标位置已存在同名文件'); return; }
      fmFS[destPath] = {...fmFS[srcPath]};
      const dir = fmFS[window.__fmCurrentPath];
      if(!dir.children.includes(name)) dir.children.push(name);
      if(window.__fmClipboard.action === 'cut') {
        const srcParentPath = srcPath.substring(0, srcPath.lastIndexOf('/')) || '/';
        const srcParent = fmFS[srcParentPath];
        if(srcParent) srcParent.children = srcParent.children.filter(c => c !== name);
        delete fmFS[srcPath];
        window.__fmClipboard = null;
      }
      window.__fmRender();
    };
    window.__fmProperties = function(path) {
      const entry = fmFS[path];
      if(!entry) return;
      const name = path.split('/').pop();
      const type = entry.type === 'dir' ? '文件夹' : '文件';
      const size = entry.size || '-';
      const modified = entry.modified || '-';
      alert(`名称: ${name}\n类型: ${type}\n大小: ${size}\n修改时间: ${modified}\n路径: ${path}`);
    };
    window.__fmRender = function() {
      const path = window.__fmCurrentPath;
      const pathEl = document.getElementById('fm-path');
      const filesEl = document.getElementById('fm-files');
      const sidebarEl = document.getElementById('fm-sidebar');
      if(pathEl) pathEl.textContent = path;
      if(sidebarEl) {
        sidebarEl.querySelectorAll('.fm-tree-item').forEach(item => {
          item.classList.toggle('active', item.dataset.path === path);
        });
      }
      if(!filesEl) return;
      const dir = fmFS[path];
      if(!dir || dir.type !== 'dir') { filesEl.innerHTML = '<div style="color:#666;padding:20px">目录不存在</div>'; return; }
      if(dir.children.length === 0) {
        filesEl.innerHTML = '<div style="color:#666;padding:20px;text-align:center;width:100%">此文件夹为空</div>';
        return;
      }
      filesEl.innerHTML = dir.children.map(name => {
        const fullPath = (path === '/' ? '/' + name : path + '/' + name);
        const entry = fmFS[fullPath];
        const isDir = entry && entry.type === 'dir';
        const icon = isDir ? '\ud83d\udcc1' : (name.endsWith('.txt')||name.endsWith('.log')?'\ud83d\udcc4':name.endsWith('.json')||name.endsWith('.config')?'\u2699\ufe0f':name.endsWith('.lnk')?'\ud83d\udd17':'\ud83d\udce6');
        const size = entry && entry.size ? entry.size : '';
        const selected = window.__fmSelectedFile === fullPath ? ' selected' : '';
        return '<div class="fm-file'+selected+'" onclick="window.__fmSelect(\''+fullPath+'\')" ondblclick="'+(isDir ? "window.__fmNavigate('"+fullPath+"')" : "window.__fmOpenFile('"+fullPath+"')")+'" oncontextmenu="window.__fmContextMenu(event,\''+fullPath+'\')"><div class="fm-file-icon">'+icon+'</div><div class="fm-file-name">'+name+'</div>'+ (size ? '<div style="font-size:10px;color:#666">'+size+'</div>' : '') +'</div>';
      }).join('');
    };
    window.__fmSelect = function(path) {
      window.__fmSelectedFile = path;
      window.__fmRender();
    };
    window.__fmContextMenu = function(e, path) {
      e.preventDefault();
      e.stopPropagation();
      window.__fmSelect(path);
      const menu = document.createElement('div');
      menu.className = 'fm-context-menu';
      menu.innerHTML = `
        <div class="fm-context-menu-item" onclick="window.__fmOpenFile('${path}');this.parentElement.remove()">打开</div>
        <div class="fm-context-menu-separator"></div>
        <div class="fm-context-menu-item" onclick="window.__fmCopy('${path}');this.parentElement.remove()">复制</div>
        <div class="fm-context-menu-item" onclick="window.__fmCut('${path}');this.parentElement.remove()">剪切</div>
        <div class="fm-context-menu-item" onclick="window.__fmRename('${path}');this.parentElement.remove()">重命名</div>
        <div class="fm-context-menu-item" onclick="window.__fmDelete('${path}');this.parentElement.remove()">删除</div>
        <div class="fm-context-menu-separator"></div>
        <div class="fm-context-menu-item" onclick="window.__fmProperties('${path}');this.parentElement.remove()">属性</div>
      `;
      menu.style.left = e.clientX + 'px';
      menu.style.top = e.clientY + 'px';
      document.body.appendChild(menu);
      const closeMenu = () => { menu.remove(); document.removeEventListener('click', closeMenu); };
      setTimeout(() => document.addEventListener('click', closeMenu), 0);
    };
    window.__fmOpenFile = function(path) {
      const entry = fmFS[path];
      if(!entry) return;
      window.showAppWindow(path.split('/').pop(), '\ud83d\udcc4', '<div style="padding:8px;white-space:pre-wrap;font-family:monospace;font-size:13px;color:#e0e0e0;height:100%;overflow:auto">'+ (entry.content || '[无法预览]') +'</div>');
    };
    document.addEventListener('keydown', e => {
      if(e.ctrlKey && e.key === 'v' && window.__fmClipboard) {
        window.__fmPaste();
      }
    });
    window.__fmNavigate('/');
  } else {
    setTimeout(() => window.__fmRender(), 50);
  }
}

export { id, name, icon, launch };