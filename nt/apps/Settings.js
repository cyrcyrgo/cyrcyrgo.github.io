// ===================================================================
// WebNT 设置
// ===================================================================

const id = 'settings';
const name = '设置';
const icon = '\u2699\ufe0f';

function launch() {
  window.showAppWindow('设置', '\u2699\ufe0f', `
    <style>
      .settings-wrap { display:flex;height:100%; }
      .settings-sidebar { width:180px;border-right:1px solid rgba(255,255,255,0.08);padding:12px 0;overflow-y:auto;flex-shrink:0; }
      .settings-sidebar .ss-item { display:flex;align-items:center;gap:10px;padding:10px 14px;border-radius:8px;cursor:pointer;font-size:14px;color:#ccc;transition:background 0.15s; }
      .settings-sidebar .ss-item:hover { background:rgba(255,255,255,0.06); }
      .settings-sidebar .ss-item.active { background:rgba(102,126,234,0.25);color:#8ab4f8; }
      .settings-sidebar .ss-icon { width:24px;height:24px;display:flex;align-items:center;justify-content:center;font-size:16px; }
      .settings-content { flex:1;overflow-y:auto;padding:20px; }
      .settings-content .sc-section { margin-bottom:24px; }
      .settings-content .sc-section h3 { font-size:16px;color:#8ab4f8;margin-bottom:16px; }
      .settings-content .sc-item { display:flex;align-items:center;justify-content:space-between;padding:12px 0;border-bottom:1px solid rgba(255,255,255,0.04); }
      .settings-content .sc-item:last-child { border-bottom:none; }
      .settings-content .sc-item .sc-label { font-size:14px;color:#e0e0e0; }
      .settings-content .sc-item .sc-desc { font-size:12px;color:#777;margin-top:2px; }
      .settings-content .sc-item .sc-value { font-size:13px;color:#888; }
      .toggle-switch { width:44px;height:24px;border-radius:12px;background:rgba(255,255,255,0.15);position:relative;cursor:pointer;transition:background 0.2s; }
      .toggle-switch.active { background:#667eea; }
      .toggle-switch::after { content:'';position:absolute;top:2px;left:2px;width:20px;height:20px;border-radius:50%;background:#fff;transition:left 0.2s;box-shadow:0 2px 4px rgba(0,0,0,0.2); }
      .toggle-switch.active::after { left:22px; }
      .theme-card { display:flex;gap:12px;margin-top:8px; }
      .theme-option { flex:1;padding:16px;border-radius:10px;border:2px solid rgba(255,255,255,0.1);cursor:pointer;transition:0.15s;text-align:center; }
      .theme-option:hover { border-color:rgba(102,126,234,0.4); }
      .theme-option.active { border-color:#667eea; }
      .theme-option .theme-preview { width:100%;height:40px;border-radius:6px;margin-bottom:8px; }
      .theme-option .theme-name { font-size:13px;color:#e0e0e0; }
      .font-size-row { display:flex;align-items:center;gap:12px;margin-top:8px; }
      .font-size-btn { padding:8px 16px;border-radius:8px;border:1px solid rgba(255,255,255,0.1);background:rgba(255,255,255,0.04);color:#ccc;font-size:13px;cursor:pointer;transition:0.15s; }
      .font-size-btn:hover { background:rgba(255,255,255,0.1); }
      .font-size-btn.active { background:rgba(102,126,234,0.3);border-color:#667eea;color:#8ab4f8; }
      .slider-wrap { display:flex;align-items:center;gap:12px;margin-top:8px;width:100%; }
      .slider-wrap input[type=range] { flex:1;height:4px;border-radius:2px;background:rgba(255,255,255,0.1);outline:none;-webkit-appearance:none; }
      .slider-wrap input[type=range]::-webkit-slider-thumb { -webkit-appearance:none;width:16px;height:16px;border-radius:50%;background:#667eea;cursor:pointer; }
      .slider-wrap .slider-value { width:40px;text-align:right;font-size:13px;color:#888; }
      .settings-btn { padding:10px 20px;border-radius:8px;border:none;cursor:pointer;font-size:13px;transition:0.15s; }
      .settings-btn.primary { background:#667eea;color:#fff; }
      .settings-btn.primary:hover { background:#5a6fd6; }
      .settings-btn.secondary { background:rgba(255,255,255,0.08);color:#ccc; }
      .settings-btn.secondary:hover { background:rgba(255,255,255,0.12); }
      .info-box { padding:12px;background:rgba(56,189,248,0.08);border-radius:8px;border:1px solid rgba(56,189,248,0.2);font-size:12px;color:#8ab4f8;margin-top:8px; }
    </style>
    <div class="settings-wrap">
      <div class="settings-sidebar" id="settings-sidebar">
        <div class="ss-item active" data-panel="system">
          <span class="ss-icon">\u2699\ufe0f</span>
          <span>系统</span>
        </div>
        <div class="ss-item" data-panel="display">
          <span class="ss-icon">\ud83d\udcbb</span>
          <span>显示</span>
        </div>
        <div class="ss-item" data-panel="personalization">
          <span class="ss-icon">\ud83c\udfa8</span>
          <span>个性化</span>
        </div>
        <div class="ss-item" data-panel="sound">
          <span class="ss-icon">\ud83d\udd0a</span>
          <span>声音</span>
        </div>
        <div class="ss-item" data-panel="apps">
          <span class="ss-icon">\ud83d\udce6</span>
          <span>应用</span>
        </div>
        <div class="ss-item" data-panel="about">
          <span class="ss-icon">\u2139\ufe0f</span>
          <span>关于</span>
        </div>
      </div>
      <div class="settings-content" id="settings-content">
        <div id="panel-system"></div>
        <div id="panel-display" style="display:none"></div>
        <div id="panel-personalization" style="display:none"></div>
        <div id="panel-sound" style="display:none"></div>
        <div id="panel-apps" style="display:none"></div>
        <div id="panel-about" style="display:none"></div>
      </div>
    </div>
  `);
  
  requestAnimationFrame(() => {
    const sidebar = document.getElementById('settings-sidebar');
    const content = document.getElementById('settings-content');
    
    function renderSystem() {
      const uptime = Math.floor(performance.now() / 1000);
      const hours = Math.floor(uptime / 3600);
      const mins = Math.floor((uptime % 3600) / 60);
      const secs = uptime % 60;
      return `
        <div class="sc-section">
          <h3>系统信息</h3>
          <div class="sc-item">
            <div>
              <div class="sc-label">内核版本</div>
              <div class="sc-desc">WebNT 内核版本号</div>
            </div>
            <div class="sc-value">v1.0.0</div>
          </div>
          <div class="sc-item">
            <div>
              <div class="sc-label">CPU</div>
              <div class="sc-desc">处理器核心数</div>
            </div>
            <div class="sc-value">${navigator.hardwareConcurrency || '未知'} 核</div>
          </div>
          <div class="sc-item">
            <div>
              <div class="sc-label">内存</div>
              <div class="sc-desc">系统内存容量</div>
            </div>
            <div class="sc-value">${navigator.deviceMemory || '未知'} GB</div>
          </div>
          <div class="sc-item">
            <div>
              <div class="sc-label">平台</div>
              <div class="sc-desc">操作系统平台</div>
            </div>
            <div class="sc-value">${navigator.platform}</div>
          </div>
          <div class="sc-item">
            <div>
              <div class="sc-label">GPU</div>
              <div class="sc-desc">图形处理单元</div>
            </div>
            <div class="sc-value">${navigator.gpu ? 'WebGPU' : 'Canvas2D'}</div>
          </div>
          <div class="sc-item">
            <div>
              <div class="sc-label">运行时间</div>
              <div class="sc-desc">系统已运行时长</div>
            </div>
            <div class="sc-value">${String(hours).padStart(2,'0')}:${String(mins).padStart(2,'0')}:${String(secs).padStart(2,'0')}</div>
          </div>
        </div>
        <div class="sc-section">
          <h3>快速操作</h3>
          <div style="display:flex;gap:8px;">
            <button class="settings-btn secondary" onclick="window.showWallpaperDialog()">更换壁纸</button>
            <button class="settings-btn secondary" onclick="location.reload()">重启系统</button>
          </div>
        </div>
      `;
    }
    
    function renderDisplay() {
      const fontSize = localStorage.getItem('webnt_font_size') || 'normal';
      const animations = localStorage.getItem('webnt_animations') !== 'false';
      const resolution = localStorage.getItem('webnt_resolution') || 'auto';
      const zoom = localStorage.getItem('webnt_zoom') || '100';
      const resolutions = [
        { label: '自动', value: 'auto' },
        { label: '1920×1080', value: '1920x1080' },
        { label: '1366×768', value: '1366x768' },
        { label: '1280×720', value: '1280x720' },
        { label: '1024×768', value: '1024x768' },
        { label: '800×600', value: '800x600' }
      ];
      const zoomLevels = ['75', '80', '90', '100', '110', '125', '150', '175', '200'];
      return `
        <div class="sc-section">
          <h3>显示分辨率</h3>
          <div class="sc-item">
            <div>
              <div class="sc-label">当前分辨率</div>
              <div class="sc-desc">实际显示分辨率</div>
            </div>
            <div class="sc-value">${window.innerWidth} × ${window.innerHeight}</div>
          </div>
          <div class="sc-item">
            <div>
              <div class="sc-label">设置分辨率</div>
              <div class="sc-desc">选择显示分辨率（需要刷新）</div>
            </div>
            <select onchange="window.__setResolution(this.value)" style="padding:6px 12px;border-radius:6px;border:1px solid rgba(255,255,255,0.1);background:rgba(255,255,255,0.04);color:#ccc;font-size:13px;cursor:pointer;">
              ${resolutions.map(r => `<option value="${r.value}" ${resolution === r.value ? 'selected' : ''}>${r.label}</option>`).join('')}
            </select>
          </div>
        </div>
        <div class="sc-section">
          <h3>缩放比例</h3>
          <div class="sc-item">
            <div>
              <div class="sc-label">当前缩放</div>
              <div class="sc-desc">设备像素比</div>
            </div>
            <div class="sc-value">${window.devicePixelRatio}x</div>
          </div>
          <div class="sc-item">
            <div>
              <div class="sc-label">设置缩放</div>
              <div class="sc-desc">调整界面缩放比例（需要刷新）</div>
            </div>
            <select onchange="window.__setZoom(this.value)" style="padding:6px 12px;border-radius:6px;border:1px solid rgba(255,255,255,0.1);background:rgba(255,255,255,0.04);color:#ccc;font-size:13px;cursor:pointer;">
              ${zoomLevels.map(z => `<option value="${z}" ${zoom === z ? 'selected' : ''}>${z}%</option>`).join('')}
            </select>
          </div>
        </div>
        <div class="sc-section">
          <h3>字体大小</h3>
          <div class="font-size-row">
            <button class="font-size-btn ${fontSize === 'small' ? 'active' : ''}" onclick="window.__setFontSize('small')">小</button>
            <button class="font-size-btn ${fontSize === 'normal' ? 'active' : ''}" onclick="window.__setFontSize('normal')">标准</button>
            <button class="font-size-btn ${fontSize === 'large' ? 'active' : ''}" onclick="window.__setFontSize('large')">大</button>
            <button class="font-size-btn ${fontSize === 'xlarge' ? 'active' : ''}" onclick="window.__setFontSize('xlarge')">特大</button>
          </div>
          <div class="info-box">修改字体大小后需要刷新页面生效</div>
        </div>
        <div class="sc-section">
          <h3>动画效果</h3>
          <div class="sc-item">
            <div>
              <div class="sc-label">启用动画</div>
              <div class="sc-desc">窗口、菜单和其他元素的动画效果</div>
            </div>
            <div class="toggle-switch ${animations ? 'active' : ''}" onclick="window.__toggleAnimations()"></div>
          </div>
        </div>
      `;
    }
    
    function renderPersonalization() {
      const theme = localStorage.getItem('webnt_theme') || 'dark';
      return `
        <div class="sc-section">
          <h3>主题</h3>
          <div class="theme-card">
            <div class="theme-option ${theme === 'dark' ? 'active' : ''}" onclick="window.__setTheme('dark')">
              <div class="theme-preview" style="background:linear-gradient(135deg,#0a0a0a,#1a1a2e)"></div>
              <div class="theme-name">深色</div>
            </div>
            <div class="theme-option ${theme === 'light' ? 'active' : ''}" onclick="window.__setTheme('light')">
              <div class="theme-preview" style="background:linear-gradient(135deg,#f5f5f5,#e8e8e8)"></div>
              <div class="theme-name">浅色</div>
            </div>
            <div class="theme-option ${theme === 'system' ? 'active' : ''}" onclick="window.__setTheme('system')">
              <div class="theme-preview" style="background:linear-gradient(135deg,#1a1a2e,#f5f5f5)"></div>
              <div class="theme-name">跟随系统</div>
            </div>
          </div>
          <div class="info-box">主题修改后需要刷新页面生效</div>
        </div>
        <div class="sc-section">
          <h3>壁纸</h3>
          <div class="sc-item">
            <div>
              <div class="sc-label">当前壁纸</div>
              <div class="sc-desc">桌面背景图片</div>
            </div>
            <button class="settings-btn primary" onclick="window.showWallpaperDialog()">更换壁纸</button>
          </div>
        </div>
      `;
    }
    
    function renderSound() {
      const volume = localStorage.getItem('webnt_volume') ? parseInt(localStorage.getItem('webnt_volume')) : 80;
      const soundEnabled = localStorage.getItem('webnt_sound_enabled') !== 'false';
      return `
        <div class="sc-section">
          <h3>音量控制</h3>
          <div class="sc-item">
            <div>
              <div class="sc-label">系统音量</div>
              <div class="sc-desc">调节系统音量大小</div>
            </div>
            <div class="toggle-switch ${soundEnabled ? 'active' : ''}" onclick="window.__toggleSoundEnabled()"></div>
          </div>
          <div class="slider-wrap">
            <input type="range" min="0" max="100" value="${volume}" oninput="window.__setVolume(this.value)">
            <div class="slider-value">${volume}%</div>
          </div>
        </div>
        <div class="sc-section">
          <h3>音效</h3>
          <div class="info-box">WebNT 目前支持基本音量控制。更多音效功能将在后续版本中添加。</div>
        </div>
      `;
    }
    
    function renderApps() {
      const installedApps = JSON.parse(localStorage.getItem('webnt_installed_apps') || '[]');
      const defaultApps = [
        { id: 'files', name: '文件管理器', icon: '\ud83d\udcc1', version: '1.0.0', builtIn: true },
        { id: 'settings', name: '设置', icon: '\u2699\ufe0f', version: '2.0.0', builtIn: true },
        { id: 'terminal', name: '终端', icon: '\u2328\ufe0f', version: '1.0.0', builtIn: true },
        { id: 'notepad', name: '记事本', icon: '\ud83d\udcc4', version: '1.0.0', builtIn: true },
        { id: 'calculator', name: '计算器', icon: '\ud83d\uddd2\ufe0f', version: '1.0.0', builtIn: true },
        { id: 'paint', name: '画图', icon: '\ud83c\udfa8', version: '1.0.0', builtIn: true },
        { id: 'player', name: '播放器', icon: '\ud83c\udfa5', version: '1.0.0', builtIn: true },
        { id: 'browser', name: '浏览器', icon: '\ud83c\udf10', version: '1.0.0', builtIn: true },
        { id: 'weather', name: '天气', icon: '\u2600\ufe0f', version: '1.0.0', builtIn: true },
        { id: 'taskmgr', name: '任务管理', icon: '\ud83d\udcca', version: '1.0.0', builtIn: true },
        { id: 'sysmon', name: '系统监控', icon: '\ud83d\udcbb', version: '1.0.0', builtIn: true },
        { id: 'appstore', name: '应用商店', icon: '\ud83d\uded2', version: '1.0.0', builtIn: true },
        { id: 'recycle', name: '回收站', icon: '\ud83d\uddd1\ufe0f', version: '1.0.0', builtIn: true },
        { id: 'computer', name: '此电脑', icon: '\ud83d\udda5\ufe0f', version: '1.0.0', builtIn: true }
      ];
      const allApps = [...defaultApps, ...installedApps.map(a => ({ ...a, builtIn: false }))];
      return `
        <div class="sc-section">
          <h3>已安装应用 (${allApps.length})</h3>
          <div style="display:flex;flex-direction:column;gap:8px;">
            ${allApps.map(app => `
              <div class="sc-item" style="padding:12px;background:rgba(255,255,255,0.02);border-radius:8px;">
                <div style="display:flex;align-items:center;gap:12px;flex:1;">
                  <span style="font-size:24px;">${app.icon}</span>
                  <div style="flex:1;">
                    <div style="font-size:14px;color:#e0e0e0;">${app.name}</div>
                    <div style="font-size:12px;color:#888;">v${app.version} ${app.builtIn ? '(系统应用)' : '(用户安装)'}</div>
                  </div>
                </div>
                ${!app.builtIn ? `<button class="settings-btn secondary" onclick="window.__uninstallApp('${app.id}')" style="padding:6px 12px;font-size:12px;">卸载</button>` : ''}
              </div>
            `).join('')}
          </div>
        </div>
      `;
    }
    
    function renderAbout() {
      return `
        <div class="sc-section">
          <h3>关于 WebNT</h3>
          <div style="padding:16px;background:rgba(255,255,255,0.04);border-radius:10px;">
            <div style="font-size:20px;font-weight:600;color:#fff;margin-bottom:8px">WebNT 内核</div>
            <div style="font-size:13px;color:#ccc;margin-bottom:16px">HTML5 混合微内核操作系统</div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;font-size:12px;">
              <div style="color:#888">版本:</div><div style="color:#e0e0e0">v2.01</div>
              <div style="color:#888">构建:</div><div style="color:#e0e0e0">20260718</div>
              <div style="color:#888">架构:</div><div style="color:#e0e0e0">HTML5 / JavaScript</div>
              <div style="color:#888">许可证:</div><div style="color:#e0e0e0">MIT</div>
            </div>
          </div>
        </div>
        <div class="sc-section">
          <h3>系统更新</h3>
          <div id="update-check-result" style="padding:12px;background:rgba(255,255,255,0.04);border-radius:8px;margin-bottom:12px;font-size:13px;color:#888;">点击下方按钮检查更新</div>
          <button class="settings-btn" onclick="window.__checkUpdate()" style="width:100%;padding:10px;">检查更新</button>
        </div>
        <div class="sc-section">
          <h3>系统信息</h3>
          <div class="sc-item">
            <div>
              <div class="sc-label">浏览器</div>
              <div class="sc-desc">运行 WebNT 的浏览器</div>
            </div>
            <div class="sc-value" style="max-width:200px;overflow:hidden;text-overflow:ellipsis;">${navigator.userAgent.substring(0,50)}...</div>
          </div>
          <div class="sc-item">
            <div>
              <div class="sc-label">语言</div>
              <div class="sc-desc">系统语言设置</div>
            </div>
            <div class="sc-value">${navigator.language}</div>
          </div>
          <div class="sc-item">
            <div>
              <div class="sc-label">在线状态</div>
              <div class="sc-desc">网络连接状态</div>
            </div>
            <div class="sc-value" style="${navigator.onLine ? 'color:#81c995' : 'color:#f28b82'}">${navigator.onLine ? '在线' : '离线'}</div>
          </div>
        </div>
      `;
    }
    
    function switchPanel(panelId) {
      document.querySelectorAll('.ss-item').forEach(item => item.classList.remove('active'));
      document.querySelectorAll('[data-panel="' + panelId + '"]').forEach(item => item.classList.add('active'));
      document.querySelectorAll('[id^="panel-"]').forEach(panel => panel.style.display = 'none');
      document.getElementById('panel-' + panelId).style.display = 'block';
    }
    
    document.getElementById('panel-system').innerHTML = renderSystem();
    document.getElementById('panel-display').innerHTML = renderDisplay();
    document.getElementById('panel-personalization').innerHTML = renderPersonalization();
    document.getElementById('panel-sound').innerHTML = renderSound();
    document.getElementById('panel-apps').innerHTML = renderApps();
    document.getElementById('panel-about').innerHTML = renderAbout();
    
    sidebar.querySelectorAll('.ss-item').forEach(item => {
      item.addEventListener('click', () => {
        switchPanel(item.dataset.panel);
      });
    });
    
    window.__setTheme = function(theme) {
      localStorage.setItem('webnt_theme', theme);
      document.getElementById('panel-personalization').innerHTML = renderPersonalization();
    };
    
    window.__setFontSize = function(size) {
      localStorage.setItem('webnt_font_size', size);
      document.getElementById('panel-display').innerHTML = renderDisplay();
    };
    
    window.__toggleAnimations = function() {
      const current = localStorage.getItem('webnt_animations') !== 'false';
      localStorage.setItem('webnt_animations', !current);
      document.getElementById('panel-display').innerHTML = renderDisplay();
    };
    
    window.__toggleSoundEnabled = function() {
      const current = localStorage.getItem('webnt_sound_enabled') !== 'false';
      localStorage.setItem('webnt_sound_enabled', !current);
      document.getElementById('panel-sound').innerHTML = renderSound();
    };
    
    window.__setVolume = function(val) {
      localStorage.setItem('webnt_volume', val);
    };
    
    window.__setResolution = function(res) {
      localStorage.setItem('webnt_resolution', res);
      document.getElementById('panel-display').innerHTML = renderDisplay();
    };
    
    window.__setZoom = function(zoom) {
      localStorage.setItem('webnt_zoom', zoom);
      document.getElementById('panel-display').innerHTML = renderDisplay();
    };
    
    window.__uninstallApp = function(appId) {
      const installed = JSON.parse(localStorage.getItem('webnt_installed_apps') || '[]');
      const filtered = installed.filter(a => a.id !== appId);
      localStorage.setItem('webnt_installed_apps', JSON.stringify(filtered));
      document.getElementById('panel-apps').innerHTML = renderApps();
    };
    
    window.__checkUpdate = function() {
      const resultEl = document.getElementById('update-check-result');
      if(!resultEl) return;
      resultEl.textContent = '正在检查更新...';
      resultEl.style.color = '#8ab4f8';
      setTimeout(() => {
        const latestVersion = '2.01';
        const currentVersion = '2.01';
        if(latestVersion === currentVersion) {
          resultEl.textContent = '✓ 当前已是最新版本 (v' + currentVersion + ')';
          resultEl.style.color = '#81c995';
        } else {
          resultEl.textContent = '发现新版本: v' + latestVersion + '\n点击下方按钮下载更新';
          resultEl.style.color = '#ff9800';
          resultEl.innerHTML = '发现新版本: v' + latestVersion + '<br><button onclick="location.reload()" style="margin-top:8px;padding:6px 12px;background:#667eea;border:none;border-radius:6px;color:#fff;font-size:12px;cursor:pointer;">立即更新</button>';
        }
      }, 1500);
    };
  });
}

export { id, name, icon, launch };