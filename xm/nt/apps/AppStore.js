// ===================================================================
// WebNT 应用商店
// ===================================================================

import { storeRegistry } from './AppRegistry.js';

const id = 'appstore';
const name = '应用商店';
const icon = '\ud83d\uded2';

function launch() {
  window.showAppWindow('应用商店', '\ud83d\uded2', `
    <style>
      .store-wrap { height:100%;display:flex;flex-direction:column; }
      .store-main { flex:1;overflow-y:auto;padding:12px; }
      .store-tabs { display:flex;gap:0;border-top:1px solid rgba(255,255,255,0.08); }
      .store-tab { flex:1;padding:12px;text-align:center;background:rgba(255,255,255,0.02);border:none;color:#888;cursor:pointer;font-size:13px;transition:0.2s; }
      .store-tab.active { background:rgba(255,112,67,0.15);color:#ff7043;border-top:2px solid #ff7043; }
      .store-panel { display:none; }
      .store-panel.active { display:block; }
      /* 应用卡片 */
      .st-card { display:flex;align-items:center;gap:14px;padding:14px;background:rgba(255,255,255,0.04);border-radius:12px;margin-bottom:10px;cursor:pointer;transition:0.15s; }
      .st-card:hover { background:rgba(255,255,255,0.08); }
      .st-card .st-icon { width:52px;height:52px;border-radius:12px;display:flex;align-items:center;justify-content:center;font-size:26px;flex-shrink:0; }
      .st-card .st-info { flex:1;min-width:0; }
      .st-card .st-name { font-size:15px;color:#e0e0e0;font-weight:500; }
      .st-card .st-desc { font-size:12px;color:#777;margin-top:3px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap; }
      .st-card .st-meta { font-size:11px;color:#666;margin-top:2px; }
      .st-card .st-arrow { color:#555;font-size:16px; }
      .st-card.installed { border-left:3px solid #81c995; }
      /* 详情页 */
      .st-detail { padding:4px; }
      .st-detail .st-back { background:none;border:none;color:#8ab4f8;cursor:pointer;font-size:13px;padding:4px 0;margin-bottom:12px;display:flex;align-items:center;gap:4px; }
      .st-detail .st-hero { width:100%;height:160px;border-radius:12px;object-fit:cover;margin-bottom:16px;background:rgba(255,255,255,0.04); }
      .st-detail .st-d-header { display:flex;align-items:center;gap:14px;margin-bottom:16px; }
      .st-detail .st-d-icon { width:64px;height:64px;border-radius:14px;display:flex;align-items:center;justify-content:center;font-size:32px;flex-shrink:0; }
      .st-detail .st-d-name { font-size:20px;font-weight:600;color:#fff; }
      .st-detail .st-d-author { font-size:12px;color:#888; }
      .st-detail .st-d-version { font-size:11px;color:#666;margin-top:2px; }
      .st-detail .st-section { margin-bottom:16px; }
      .st-detail .st-section h4 { font-size:12px;color:#888;margin-bottom:6px;text-transform:uppercase;letter-spacing:1px; }
      .st-detail .st-section p { font-size:13px;color:#ccc;line-height:1.6; }
      .st-detail .st-features { display:flex;flex-wrap:wrap;gap:6px; }
      .st-detail .st-feature { padding:4px 10px;background:rgba(255,255,255,0.06);border-radius:20px;font-size:12px;color:#ccc; }
      .st-detail .st-perm { display:flex;align-items:center;gap:8px;padding:6px 10px;background:rgba(255,152,0,0.08);border-radius:6px;margin-bottom:4px;font-size:12px;color:#ff9800; }
      .st-detail .st-actions { display:flex;gap:8px;margin-top:16px; }
      .st-detail .st-actions button { flex:1;padding:12px;border:none;border-radius:10px;cursor:pointer;font-size:14px;font-weight:500;transition:0.15s; }
      .st-detail .st-btn-install { background:#ff7043;color:#fff; }
      .st-detail .st-btn-install:hover { background:#f4511e; }
      .st-detail .st-btn-update { background:rgba(102,126,234,0.5);color:#fff; }
      .st-detail .st-btn-update:hover { background:rgba(102,126,234,0.7); }
      .st-detail .st-btn-delete { background:rgba(244,67,54,0.2);color:#f28b82; }
      .st-detail .st-btn-delete:hover { background:rgba(244,67,54,0.4); }
      .st-detail .st-btn-launch { background:rgba(129,201,149,0.3);color:#81c995; }
      .st-detail .st-btn-launch:hover { background:rgba(129,201,149,0.5); }
      /* 链接扫描 */
      .st-scan-box { background:rgba(255,255,255,0.04);border-radius:12px;padding:16px;margin-bottom:16px; }
      .st-scan-box label { display:block;font-size:13px;color:#888;margin-bottom:8px; }
      .st-scan-row { display:flex;gap:8px; }
      .st-scan-row input { flex:1;padding:10px 14px;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.1);border-radius:8px;color:#fff;font-size:13px;outline:none; }
      .st-scan-row input:focus { border-color:rgba(255,112,67,0.5); }
      .st-scan-row button { padding:10px 18px;background:rgba(255,112,67,0.4);border:none;color:#fff;border-radius:8px;cursor:pointer;font-size:13px; }
      .st-scan-row button:hover { background:rgba(255,112,67,0.6); }
      .st-scan-result { margin-top:12px; }
      .st-empty { text-align:center;color:#666;padding:40px 0;font-size:13px; }
      .st-msg { font-size:12px;margin-top:8px;min-height:18px; }
      .st-msg.success { color:#81c995; }
      .st-msg.error { color:#f28b82; }
    </style>
    <div class="store-wrap">
      <div class="store-main" id="store-main"><div class="st-empty">加载中...</div></div>
      <div class="store-tabs">
        <button class="store-tab active" data-tab="official">官方应用</button>
        <button class="store-tab" data-tab="scan">链接扫描</button>
      </div>
    </div>
  `);

  requestAnimationFrame(() => {
    const storeMain = document.getElementById('store-main');
    if(!storeMain) return;

    // ============================================================
    // 数据层
    // ============================================================
    function loadInstalled() { try { return JSON.parse(localStorage.getItem('webnt_installed_apps') || '[]'); } catch(e) { return []; } }
    function saveInstalled(apps) { localStorage.setItem('webnt_installed_apps', JSON.stringify(apps)); }
    function isInstalled(storeId) { return loadInstalled().some(a => a.storeId === storeId); }
    function getInstalled(storeId) { return loadInstalled().find(a => a.storeId === storeId); }

    // ============================================================
    // 全局函数
    // ============================================================
    window.__launchInstalledApp = function(appId) {
      const app = loadInstalled().find(a => a.id === appId);
      if(!app) return;
      window.showAppWindow(app.name, app.icon, '<div style="width:100%;height:100%;display:flex;flex-direction:column"><div style="font-size:32px;text-align:center;padding:20px">'+app.icon+'</div><div style="text-align:center;color:#888;font-size:13px">第三方应用</div><div style="text-align:center;color:#666;font-size:11px;margin-top:4px;word-break:break-all">'+app.url+'</div><iframe style="flex:1;width:100%;border:none;margin-top:12px;border-radius:8px;background:#fff" sandbox="allow-scripts allow-same-origin" src="'+app.url+'"></iframe></div>');
    };
    window.__uninstallApp = function(appId) {
      if(!confirm('确定要卸载此应用吗？')) return;
      let apps = loadInstalled();
      apps = apps.filter(a => a.id !== appId);
      saveInstalled(apps);
      const existing = document.querySelector('.desktop-icon[data-app-id="'+appId+'"]');
      if(existing) existing.remove();
      if(storeMain) renderOfficial();
    };

    // ============================================================
    // 官方应用列表
    // ============================================================
    function renderOfficial() {
      const installed = loadInstalled();
      storeMain.innerHTML = storeRegistry.map(app => {
        const inst = installed.find(a => a.storeId === app.id);
        return '<div class="st-card'+(inst?' installed':'')+'" onclick="window.__showDetail(\''+app.id+'\')">'
          + '<div class="st-icon" style="background:'+app.color+'22;color:'+app.color+'">'+app.icon+'</div>'
          + '<div class="st-info"><div class="st-name">'+app.name+'</div><div class="st-desc">'+app.description+'</div><div class="st-meta">'+app.author+' \u00b7 v'+app.version+' '+(inst?'\u00b7 <span style="color:#81c995">已安装</span>':'')+'</div></div>'
          + '<div class="st-arrow">\u276f</div></div>';
      }).join('') || '<div class="st-empty">暂无官方应用</div>';
    }

    // ============================================================
    // 应用详情页
    // ============================================================
    window.__showDetail = function(storeId) {
      const app = storeRegistry.find(a => a.id === storeId);
      if(!app) return;
      const inst = getInstalled(storeId);
      const hasUpdate = inst && inst.version !== app.version;
      storeMain.innerHTML = '<div class="st-detail">'
        + '<button class="st-back" onclick="window.__storeGoBack()">\u2190 返回应用列表</button>'
        + (app.images.length? '<img class="st-hero" src="'+app.images[0]+'" alt="'+app.name+'">' : '')
        + '<div class="st-d-header"><div class="st-d-icon" style="background:'+app.color+'22;color:'+app.color+'">'+app.icon+'</div><div><div class="st-d-name">'+app.name+'</div><div class="st-d-author">'+app.author+'</div><div class="st-d-version">版本 '+app.version+' \u00b7 '+app.category+'</div></div></div>'
        + '<div class="st-section"><h4>简介</h4><p>'+app.description+'</p></div>'
        + '<div class="st-section"><h4>功能特性</h4><div class="st-features">'+app.features.map(f=>'<span class="st-feature">'+f+'</span>').join('')+'</div></div>'
        + '<div class="st-section"><h4>所需权限</h4>'+app.permissions.map(p=>'<div class="st-perm">\u26a0 '+p+'</div>').join('')+'</div>'
        + '<div class="st-actions">'
        + (inst
          ? (hasUpdate
            ? '<button class="st-btn-update" onclick="window.__updateApp(\''+storeId+'\')">更新至 v'+app.version+'</button>'
            : '<button class="st-btn-launch" onclick="window.__launchInstalledApp(\''+inst.id+'\')">启动</button>')
            + '<button class="st-btn-delete" onclick="window.__deleteApp(\''+storeId+'\');window.__showDetail(\''+storeId+'\')">删除</button>'
          : '<button class="st-btn-install" onclick="window.__installFromStore(\''+storeId+'\')">安装</button>')
        + '</div></div>';
    };
    window.__storeGoBack = function() { renderOfficial(); };

    window.__installFromStore = function(storeId) {
      const app = storeRegistry.find(a => a.id === storeId);
      if(!app) return;
      if(isInstalled(storeId)) return;
      const appId = 'ext_' + storeId + '_' + Date.now();
      const newApp = { id: appId, storeId: app.id, name: app.name, url: app.url, icon: app.icon, color: app.color, version: app.version };
      const apps = loadInstalled();
      apps.push(newApp);
      saveInstalled(apps);
      window.addDesktopIcon(appId, app.name, app.icon, app.color, appId);
      window.renderDesktopIcons();
      window.__showDetail(storeId);
    };

    window.__updateApp = function(storeId) {
      const app = storeRegistry.find(a => a.id === storeId);
      if(!app) return;
      let apps = loadInstalled();
      const idx = apps.findIndex(a => a.storeId === storeId);
      if(idx === -1) return;
      apps[idx].version = app.version;
      apps[idx].url = app.url;
      saveInstalled(apps);
      window.__showDetail(storeId);
    };

    window.__deleteApp = function(storeId) {
      if(!confirm('确定要删除此应用吗？')) return;
      let apps = loadInstalled();
      const app = apps.find(a => a.storeId === storeId);
      if(!app) return;
      apps = apps.filter(a => a.storeId !== storeId);
      saveInstalled(apps);
      const existing = document.querySelector('.desktop-icon[data-app-id="'+app.id+'"]');
      if(existing) existing.remove();
    };

    // ============================================================
    // 链接扫描
    // ============================================================
    function renderScan() {
      storeMain.innerHTML = ''
        + '<div class="st-scan-box">'
        + '<label>输入链接，自动扫描 SDK 特征码匹配应用</label>'
        + '<div class="st-scan-row"><input type="text" id="scan-url-input" placeholder="https://example.com/app 或粘贴 SDK 特征码"><button id="scan-btn">扫描</button></div>'
        + '<div class="st-msg" id="scan-msg"></div>'
        + '</div>'
        + '<div id="scan-result"></div>'
        + '<div style="font-size:11px;color:#555;margin-top:12px;padding:12px;background:rgba(255,255,255,0.02);border-radius:8px;line-height:1.6">'
        + '<strong>SDK 特征码说明：</strong><br>'
        + '特征码格式: <code style="color:#8ab4f8">webnt-app:&lt;app-id&gt;:&lt;version&gt;</code><br>'
        + '开发者可在应用页面 HTML 的 meta 标签中声明特征码：<br>'
        + '<code style="color:#81c995">&lt;meta name="webnt-app" content="snake:2.1.0"&gt;</code><br>'
        + '应用商店将自动识别并匹配已注册应用。'
        + '</div>';

      const scanInput = document.getElementById('scan-url-input');
      const scanBtn = document.getElementById('scan-btn');
      const scanMsg = document.getElementById('scan-msg');
      const scanResult = document.getElementById('scan-result');

      scanBtn.addEventListener('click', () => {
        const input = scanInput.value.trim();
        if(!input) { scanMsg.textContent = '请输入链接或特征码'; scanMsg.className = 'st-msg error'; return; }
        scanResult.innerHTML = '';

        // 扫描特征码
        let matched = null;
        // 尝试直接匹配特征码格式: webnt-app:<id>:<version>
        const codeMatch = input.match(/webnt-app:([a-zA-Z0-9_-]+):?([\d.]+)?/);
        if(codeMatch) {
          const appId = codeMatch[1];
          const version = codeMatch[2];
          matched = storeRegistry.find(a => a.id === appId);
          if(matched) {
            scanMsg.textContent = '找到匹配应用！';
            scanMsg.className = 'st-msg success';
          }
        }
        // 尝试从 URL 中提取特征码（模拟扫描页面 meta）
        if(!matched) {
          const urlMatch = input.match(/([a-zA-Z0-9_-]+)\.html?$/);
          if(urlMatch) {
            const name = urlMatch[1].toLowerCase();
            matched = storeRegistry.find(a => a.id === name || a.name.toLowerCase().includes(name));
            if(matched) { scanMsg.textContent = '根据链接名称匹配到应用'; scanMsg.className = 'st-msg success'; }
          }
        }
        if(!matched) {
          scanMsg.textContent = '未找到匹配的应用，请检查链接或特征码';
          scanMsg.className = 'st-msg error';
          return;
        }
        const inst = getInstalled(matched.id);
        const hasUpdate = inst && inst.version !== matched.version;
        scanResult.innerHTML = '<div class="st-card" onclick="window.__showDetail(\''+matched.id+'\')">'
          + '<div class="st-icon" style="background:'+matched.color+'22;color:'+matched.color+'">'+matched.icon+'</div>'
          + '<div class="st-info"><div class="st-name">'+matched.name+'</div><div class="st-desc">'+matched.description+'</div><div class="st-meta">'+matched.author+' \u00b7 v'+matched.version+' '+(inst?(hasUpdate?'<span style="color:#ff9800">可更新</span>':'<span style="color:#81c995">已安装</span>'):'<span style="color:#ff7043">未安装</span>')+'</div></div>'
          + '<div class="st-arrow">\u276f</div></div>';
      });
    }

    // ============================================================
    // 标签切换
    // ============================================================
    let currentTab = 'official';
    document.querySelectorAll('.store-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.store-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        currentTab = tab.dataset.tab;
        if(currentTab === 'official') renderOfficial();
        else renderScan();
      });
    });

    renderOfficial();
  });
}

export { id, name, icon, launch };