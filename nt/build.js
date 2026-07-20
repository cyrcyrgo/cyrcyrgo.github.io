#!/usr/bin/env node
// ===================================================================
// WebNT Build Script — 将所有 CSS/JS 模块合并为单个 index.html
// 解决 GitHub Pages 上 CSS MIME 类型问题，兼容 Via 等移动端浏览器
// ===================================================================

const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const OUT = path.join(ROOT, 'index.html');

function read(p) { return fs.readFileSync(path.join(ROOT, p), 'utf-8'); }

// ===================================================================
// 1. 收集所有 CSS
// ===================================================================
const cssFiles = [
  'ui/styles/Global.System.css',
  'ui/styles/Base.css',
  'ui/styles/BootScreen.css',
  'ui/styles/LockScreen.css',
  'ui/styles/Desktop.css',
  'ui/styles/Taskbar.css',
  'ui/styles/StartMenu.css',
  'ui/styles/ContextMenu.css',
  'ui/styles/PowerMenu.css',
  'ui/styles/Wallpaper.css',
  'ui/styles/Terminal.css',
  'ui/styles/AppWindow.css',
  'ui/styles/Responsive.css',
];

let allCSS = '';
cssFiles.forEach(f => { allCSS += read(f) + '\n\n'; });

// ===================================================================
// 2. 处理 JS 模块
// ===================================================================

// --- Core ---
let kernelJS = read('core/Kernel.js');
kernelJS = kernelJS
  .replace(/export const WEB_VERSION/g, 'var WEB_VERSION')
  .replace(/export const WEB_BUILD/g, 'var WEB_BUILD')
  .replace(/export \{ EventBus, GlobalDisplayAPI, WindowManager, SysCallBridge \};/g, '');

let terminalJS = read('core/Terminal.js');
terminalJS = terminalJS
  .replace(/import \{ WEB_VERSION \} from '\.\/Kernel\.js';\n?/g, '')
  .replace(/export \{ TerminalCommandRegistry, TerminalExecutor \};/g, '');

// --- System ---
let bootJS = read('system/BootSequence.js');
bootJS = bootJS.replace(/export \{ bootLogLine, bootProgress, runBootSequence \};/g, '');

let sysmonJS = read('system/SystemMonitor.js');
sysmonJS = sysmonJS.replace(/export default SystemMonitor;/g, '');

// --- UI Components ---
function processComponent(filepath) {
  let code = read(filepath);
  code = code.replace(/import \{[^}]*\} from '[^']*';\n?/g, '');
  code = code.replace(/export function /g, 'function ');
  code = code.replace(/export const /g, 'var ');
  code = code.replace(/export let /g, 'var ');
  code = code.replace(/export default /g, '');
  return code;
}

const appWindowJS = processComponent('ui/components/AppWindow.js');
const desktopJS = processComponent('ui/components/DesktopIcons.js');
const taskbarJS = processComponent('ui/components/Taskbar.js');
const startMenuJS = processComponent('ui/components/StartMenu.js');
const powerMenuJS = processComponent('ui/components/PowerMenu.js');
const contextMenuJS = processComponent('ui/components/ContextMenu.js');
const lockScreenJS = processComponent('ui/components/LockScreen.js');
const wallpaperJS = processComponent('ui/components/Wallpaper.js');

// --- App Modules ---
const appModuleNames = [
  'FileManager', 'Settings', 'Notepad', 'Browser',
  'Calculator', 'Calendar', 'TaskManager', 'SystemMonitorApp',
  'Paint', 'Weather', 'Clock', 'Minesweeper',
  'WordPad', 'Player', 'AppStore'
];

let allAppModulesJS = '';
appModuleNames.forEach(modName => {
  let code = read('apps/' + modName + '.js');
  code = code.replace(/import \{[^}]*\} from '[^']*';\n?/g, '');
  code = code.replace(/export \{[^}]*\};\n?/g, '');
  allAppModulesJS += `(function(){\n${code}\nwindow.__app_${modName.toLowerCase()} = { id: id, name: name, icon: icon, launch: launch };\n})();\n\n`;
});

// --- App Launcher ---
let appLauncherJS = read('apps/AppLauncher.js');
appLauncherJS = appLauncherJS
  .replace(/import \* as \w+ from '[^']*';\n/g, '')
  .replace(/const appRegistry = \{[\s\S]*?\};/, `var appRegistry = {
  explorer: window.__app_filemanager,
  settings: window.__app_settings,
  notepad: window.__app_notepad,
  webview: window.__app_browser,
  calculator: window.__app_calculator,
  calendar: window.__app_calendar,
  taskmgr: window.__app_taskmanager,
  sysmon: window.__app_systemmonitorapp,
  paint: window.__app_paint,
  weather: window.__app_weather,
  clock: window.__app_clock,
  minesweeper: window.__app_minesweeper,
  wordpad: window.__app_wordpad,
  player: window.__app_player,
  appstore: window.__app_appstore,
};`)
  .replace(/export \{[^}]*\};/g, '');

// --- SDK ---
let sdkJS = read('sdk/WebNT.API.js');
sdkJS = sdkJS
  .replace(/import \{ WindowManager, SysCallBridge, EventBus \} from '\.\.\/core\/Kernel\.js';\n?/g, '')
  .replace(/export default WebNT;/g, '');

// ===================================================================
// 3. HTML 结构（从源码重建）
// ===================================================================

const htmlStructure = `
<!-- 启动画面 -->
<div id="boot-screen">
  <div class="bs-container">
    <div class="bs-logo">WebNT</div>
    <div class="bs-version">Kernel v2.01</div>
    <div class="bs-progress-wrap">
      <div id="boot-progress-bar" class="bs-progress-bar"></div>
    </div>
    <div id="boot-status" class="bs-status">正在启动...</div>
    <div id="boot-log" class="bs-log"></div>
  </div>
</div>

<!-- 应用根容器 -->
<div id="app-root" style="display:none">

  <!-- 锁屏 -->
  <div id="lock-screen">
    <div class="ls-bg"></div>
    <div class="ls-content">
      <div class="ls-time" id="ls-time">00:00</div>
      <div class="ls-date" id="ls-date">加载中...</div>
      <div class="ls-user">
        <div class="ls-avatar">管</div>
        <div class="ls-username">管理员</div>
      </div>
      <div class="ls-user-switch" style="position:relative;z-index:1;display:flex;gap:12px;margin-bottom:10px;">
        <div class="ls-role-btn active" data-role="admin" style="padding:8px 20px;border-radius:20px;border:1px solid rgba(255,255,255,0.2);cursor:pointer;font-size:13px;color:#fff;background:rgba(99,102,241,0.3);transition:all 0.2s;" onclick="window.__switchRole('admin')">管理员</div>
        <div class="ls-role-btn" data-role="guest" style="padding:8px 20px;border-radius:20px;border:1px solid rgba(255,255,255,0.2);cursor:pointer;font-size:13px;color:#999;background:rgba(255,255,255,0.05);transition:all 0.2s;" onclick="window.__switchRole('guest')">访客</div>
      </div>
      <div class="ls-slider" id="ls-slider">
        <div class="ls-slider-knob" id="ls-knob">&#x276F;&#x276F;</div>
        <div class="ls-slider-text">滑动解锁</div>
      </div>
      <div class="ls-hint">或按任意键解锁</div>
      <div class="ls-notifications">
        <div class="ls-notif">
          <div class="ls-notif-title">WebNT 内核</div>
          系统 v<span id="ls-version-text">2.01</span> — 所有服务运行正常
        </div>
      </div>
    </div>
  </div>

  <!-- 桌面背景 -->
  <div id="desktop-bg"></div>

  <!-- 桌面图标 -->
  <div id="desktop-icons"></div>

  <!-- 终端窗口 -->
  <div id="terminal-window" style="display:none;width:700px;height:420px;left:150px;top:80px">
    <div class="tw-titlebar" id="tw-titlebar">
      <span class="tw-title">WebNT 终端</span>
      <div class="tw-ctrl">
        <button class="tw-ctrl-btn" id="tw-minimize">&#x2014;</button>
        <button class="tw-ctrl-btn" id="tw-maximize">&#x25a1;</button>
        <button class="tw-ctrl-btn close" id="tw-close">&#x2715;</button>
      </div>
    </div>
    <div class="tw-output" id="tw-output"></div>
    <div class="tw-input-line">
      <span class="tw-prompt" id="tw-prompt">webnt@kernel:~$</span>
      <input class="tw-input" id="tw-input" type="text" placeholder="输入 help 查看命令..." autocomplete="off" spellcheck="false">
    </div>
  </div>

  <!-- 任务栏 -->
  <div id="taskbar">
    <div class="tb-left">
      <div class="tb-start-btn" id="tb-start-btn">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>
      </div>
      <div class="tb-pinned" id="tb-pinned"></div>
    </div>
    <div class="tb-center" id="tb-center"></div>
    <div class="tb-right">
      <div class="tb-tray-btn" id="tb-terminal-btn" title="终端 (Ctrl+\`)">&#x2328;</div>
      <div class="tb-tray-btn" id="tb-tray-btn" title="系统托盘">&#x1f514;</div>
      <div class="tb-power-btn" id="tb-power-btn" title="电源">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18.36 6.64a9 9 0 1 1-12.73 0"/><line x1="12" y1="2" x2="12" y2="12"/></svg>
      </div>
      <div class="tb-clock" id="tb-clock">
        <span class="tb-clock-time">00:00</span>
        <span class="tb-clock-date">1/1</span>
      </div>
    </div>
  </div>

  <!-- 开始菜单 -->
  <div id="start-menu">
    <div class="sm-search">
      <input type="text" id="sm-search-input" placeholder="搜索应用...">
    </div>
    <div class="sm-apps" id="sm-app-list"></div>
    <div class="sm-footer">
      <div class="sm-user">
        <div class="sm-avatar">管</div>
        <span class="sm-username">管理员</span>
      </div>
      <div class="sm-power-btn" id="sm-shutdown" title="关机">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18.36 6.64a9 9 0 1 1-12.73 0"/><line x1="12" y1="2" x2="12" y2="12"/></svg>
      </div>
    </div>
  </div>

  <!-- 电源菜单 -->
  <div id="power-menu">
    <div class="pm-item" id="pm-sleep">
      <span class="pm-icon"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg></span>
      <span>睡眠</span>
    </div>
    <div class="pm-item" id="pm-reboot">
      <span class="pm-icon"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg></span>
      <span>重启</span>
    </div>
    <div class="pm-item" id="pm-shutdown">
      <span class="pm-icon"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18.36 6.64a9 9 0 1 1-12.73 0"/><line x1="12" y1="2" x2="12" y2="12"/></svg></span>
      <span>关机</span>
    </div>
  </div>

  <!-- 右键菜单 -->
  <div id="context-menu"></div>

  <!-- 壁纸设置弹窗 -->
  <div id="wallpaper-dialog">
    <div class="wp-box">
      <div class="wp-title">更换桌面壁纸</div>
      <label class="wp-label">图片地址</label>
      <input class="wp-input" type="text" id="wp-url-input" placeholder="https://example.com/wallpaper.jpg">
      <label class="wp-label">或上传本地图片</label>
      <input class="wp-file" type="file" id="wp-file-input" accept="image/*">
      <div class="wp-btns">
        <button class="wp-cancel" id="wp-cancel">取消</button>
        <button class="wp-ok" id="wp-ok">应用</button>
      </div>
    </div>
  </div>

</div>`;

// ===================================================================
// 4. 生成合并后的 HTML
// ===================================================================

const allJS = `
// === 全局版本常量 ===
var WEB_VERSION = '2.01';
var WEB_BUILD = '20260718';
window.__WebNT_VERSION = WEB_VERSION;
window.__WebNT_BUILD = WEB_BUILD;

// === Core: Kernel ===
${kernelJS}

// === Core: Terminal ===
${terminalJS}

// === System: Boot ===
${bootJS}

// === System: Monitor ===
${sysmonJS}

// === UI: AppWindow ===
${appWindowJS}

// === UI: Desktop ===
${desktopJS}

// === UI: Taskbar ===
${taskbarJS}

// === UI: StartMenu ===
${startMenuJS}

// === UI: PowerMenu ===
${powerMenuJS}

// === UI: ContextMenu ===
${contextMenuJS}

// === UI: LockScreen ===
${lockScreenJS}

// === UI: Wallpaper ===
${wallpaperJS}

// === App Modules ===
${allAppModulesJS}

// === App Launcher ===
${appLauncherJS}

// === SDK ===
${sdkJS}
`;

const finalHTML = `<!DOCTYPE html>
<html lang="en" data-theme="dark">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover">
<title>WebNT Kernel v2.01</title>
<style>
${allCSS}
</style>
</head>
<body>
${htmlStructure}

<!-- 计算器全局辅助函数 -->
<script>
(function() {
  // 计算器辅助函数
  window.__calcEval = function(expr) {
    try {
      expr = expr.replace(/[^0-9+\-*/.() ]/g, '');
      return Function('"use strict"; return (' + expr + ')')();
    } catch(e) { return null; }
  };
})();
</script>

<!-- 系统脚本 -->
<script>
(function() {
'use strict';

${allJS}

// ===================================================================
// 全局初始化
// ===================================================================
window.WindowManager = WindowManager;
window.TerminalCommandRegistry = TerminalCommandRegistry;
window.TerminalExecutor = TerminalExecutor;
window.SystemMonitor = SystemMonitor;
window.bootLogLine = bootLogLine;
window.bootProgress = bootProgress;
window.runBootSequence = runBootSequence;
window.showAppWindow = showAppWindow;
window.initAppWindow = initAppWindow;
window.initDesktop = initDesktop;
window.initTaskbar = initTaskbar;
window.loadPinnedApps = loadPinnedApps;
window.savePinnedApps = savePinnedApps;
window.isPinned = isPinned;
window.pinToTaskbar = pinToTaskbar;
window.unpinFromTaskbar = unpinFromTaskbar;
window.renderPinnedTaskbar = renderPinnedTaskbar;
window.updateTaskbarWindowButtons = updateTaskbarWindowButtons;
window.initStartMenu = initStartMenu;
window.renderStartMenu = renderStartMenu;
window.toggleStartMenu = toggleStartMenu;
window.initPowerMenu = initPowerMenu;
window.togglePowerMenu = togglePowerMenu;
window.initContextMenu = initContextMenu;
window.showContextMenu = showContextMenu;
window.hideContextMenu = hideContextMenu;
window.initLockScreen = initLockScreen;
window.resetKnob = resetKnob;
window.unlockDesktop = unlockDesktop;
window.initWallpaper = initWallpaper;
window.applyWallpaper = applyWallpaper;
window.loadWallpaper = loadWallpaper;
window.showWallpaperDialog = showWallpaperDialog;
window.hideWallpaperDialog = hideWallpaperDialog;
window.launchApp = launchApp;
window.WebNT = WebNT;

// ===================================================================
// DOM Refs
// ===================================================================
var bootScreen = document.getElementById('boot-screen');
var appRoot = document.getElementById('app-root');
var lockScreen = document.getElementById('lock-screen');
var tw = document.getElementById('terminal-window');
var twOutput = document.getElementById('tw-output');
var twInput = document.getElementById('tw-input');

// ===================================================================
// 时间更新
// ===================================================================
function updateAllClocks() {
  var now = new Date();
  var h = String(now.getHours()).padStart(2,'0'), m = String(now.getMinutes()).padStart(2,'0');
  var lsTime = document.getElementById('ls-time'), lsDate = document.getElementById('ls-date');
  if (lsTime) lsTime.textContent = h + ':' + m;
  if (lsDate) lsDate.textContent = now.toLocaleDateString('zh-CN',{weekday:'long',year:'numeric',month:'long',day:'numeric'});
  var tbc = document.querySelector('#taskbar .tb-clock-time'), tbcd = document.querySelector('#taskbar .tb-clock-date');
  if (tbc) tbc.textContent = h + ':' + m;
  if (tbcd) tbcd.textContent = (now.getMonth()+1) + '/' + now.getDate();
}
updateAllClocks();
setInterval(updateAllClocks, 1000);

// 点击任务栏时钟显示同步时间弹窗
document.getElementById('tb-clock').addEventListener('click', function() {
  var popup = document.getElementById('clock-sync-popup');
  if (popup) { popup.remove(); return; }
  var server = localStorage.getItem('webnt_time_server') || 'time.windows.com';
  popup = document.createElement('div');
  popup.id = 'clock-sync-popup';
  popup.style.cssText = 'position:fixed;bottom:48px;right:8px;background:rgba(15,23,42,0.95);backdrop-filter:blur(20px);border:1px solid rgba(255,255,255,0.1);border-radius:12px;padding:16px;z-index:2500;width:280px;box-shadow:0 8px 32px rgba(0,0,0,0.5);';
  popup.innerHTML = '<div style="font-size:14px;color:#fff;margin-bottom:12px;font-weight:500;">时间同步</div><div style="font-size:12px;color:#888;margin-bottom:8px;">当前时间服务器</div><input type="text" id="clock-server-input" value="'+server+'" style="width:100%;padding:8px 12px;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.1);border-radius:6px;color:#e0e0e0;font-size:13px;outline:none;margin-bottom:12px;box-sizing:border-box;"><button id="clock-sync-btn" style="width:100%;padding:10px;background:#667eea;border:none;border-radius:6px;color:#fff;font-size:13px;cursor:pointer;">立即同步时间</button><div id="clock-sync-status" style="margin-top:8px;font-size:12px;color:#888;text-align:center;"></div>';
  document.body.appendChild(popup);
  document.getElementById('clock-sync-btn').addEventListener('click', function() {
    var newServer = document.getElementById('clock-server-input').value.trim();
    if (newServer) localStorage.setItem('webnt_time_server', newServer);
    var status = document.getElementById('clock-sync-status');
    status.textContent = '正在同步...';
    status.style.color = '#8ab4f8';
    setTimeout(function() {
      status.textContent = '\\u2713 时间已同步 (' + newServer + ')';
      status.style.color = '#81c995';
      updateAllClocks();
    }, 800);
  });
  var closePopup = function(e) {
    if (!popup.contains(e.target) && e.target.id !== 'tb-clock') {
      popup.remove();
      document.removeEventListener('click', closePopup);
    }
  };
  setTimeout(function() { document.addEventListener('click', closePopup); }, 0);
});

// ===================================================================
// 终端
// ===================================================================
var twHistory = [];
var twHistoryIdx = -1;

function writeTerminal(text, cls) {
  cls = cls || '';
  if (!twOutput) return;
  var lines = text.split('\\n');
  lines.forEach(function(line) {
    var l = document.createElement('div');
    l.className = 'tw-line' + (cls ? ' ' + cls : '');
    l.textContent = line || ' ';
    twOutput.appendChild(l);
  });
  twOutput.scrollTop = twOutput.scrollHeight;
}

function writeWelcome() {
  if (!twOutput) return;
  twOutput.innerHTML = '';
  var version = window.__WebNT_VERSION || '2.01';
  writeTerminal('WebNT 内核 v' + version + ' [HTML5 混合微内核]', 'info');
  writeTerminal('输入 "help" 查看可用命令。');
  writeTerminal('');
}

writeWelcome();
window.writeTerminal = writeTerminal;

if (twInput) {
  twInput.addEventListener('keydown', function(e) {
    if (e.key === 'Enter') {
      var cmd = twInput.value.trim();
      if (!cmd) return;
      var restrictedCmds = ['shutdown', 'reboot', 'rm', 'sudo', 'format', 'kill'];
      var cmdBase = cmd.split(/\\s+/)[0];
      if (window.__WebNT_isGuest && restrictedCmds.indexOf(cmdBase) !== -1) {
        if (window.showToast) window.showToast('访客模式下此操作受限', 'warning');
        var cwd2 = TerminalCommandRegistry.instance.getCwd ? TerminalCommandRegistry.instance.getCwd() : '/home/webnt';
        var promptPath2 = cwd2 === '/' ? '/' : (cwd2.indexOf('/home/webnt') === 0 ? '~' + cwd2.replace('/home/webnt', '') : cwd2);
        writeTerminal('webnt@kernel:' + promptPath2 + '$ ' + cmd, '');
        writeTerminal('权限不足: 访客模式下无法执行此命令', 'error');
        twInput.value = '';
        return;
      }
      var cwd = TerminalCommandRegistry.instance.getCwd ? TerminalCommandRegistry.instance.getCwd() : '/home/webnt';
      var promptPath = cwd === '/' ? '/' : (cwd.indexOf('/home/webnt') === 0 ? '~' + cwd.replace('/home/webnt', '') : cwd);
      writeTerminal('webnt@kernel:' + promptPath + '$ ' + cmd, '');
      twInput.value = '';
      if (cmd !== 'clear') twHistory.push(cmd);
      twHistoryIdx = twHistory.length;
      TerminalExecutor.instance.execute(cmd).then(function(result) {
        if (result.clear) { twOutput.innerHTML = ''; return; }
        writeTerminal(result.output, result.exitCode !== 0 ? 'error' : '');
      });
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (twHistoryIdx > 0) { twHistoryIdx--; twInput.value = twHistory[twHistoryIdx] || ''; }
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (twHistoryIdx < twHistory.length - 1) { twHistoryIdx++; twInput.value = twHistory[twHistoryIdx] || ''; }
      else { twHistoryIdx = twHistory.length; twInput.value = ''; }
    } else if (e.key === 'Tab') {
      e.preventDefault();
      var input = twInput.value.trim().split(/\\s+/)[0];
      var cmds = TerminalCommandRegistry.instance.getAllCommands();
      var matches = cmds.filter(function(c) { return c.indexOf(input) === 0; });
      if (matches.length === 1) twInput.value = matches[0] + ' ';
      else if (matches.length > 1) writeTerminal(matches.join('  '), '');
    }
  });
}

// 终端按钮
document.getElementById('tb-terminal-btn').addEventListener('click', function() {
  if (window.launchApp) window.launchApp('terminal');
});
document.getElementById('tw-close').addEventListener('click', function() {
  if (!tw) return;
  tw.style.display = 'none';
  var wid = tw.dataset.winId;
  if (wid && window.WindowManager) window.WindowManager.instance.destroyWindow(wid);
  if (window.updateTaskbarWindowButtons) window.updateTaskbarWindowButtons();
});
document.getElementById('tw-minimize').addEventListener('click', function() {
  if (!tw) return;
  tw.style.display = 'none';
  if (window.updateTaskbarWindowButtons) window.updateTaskbarWindowButtons();
});
document.getElementById('tw-maximize').addEventListener('click', function() {
  if (!tw) return;
  if (tw.style.width === '100vw') {
    tw.style.cssText = tw.dataset.normalStyle || 'width:700px;height:420px;left:150px;top:80px';
    tw.style.display = 'flex';
    this.textContent = '\\u25a1';
  } else {
    tw.dataset.normalStyle = 'width:' + tw.style.width + ';height:' + tw.style.height + ';left:' + tw.style.left + ';top:' + tw.style.top;
    tw.style.width = '100vw'; tw.style.height = 'calc(100vh - 48px)'; tw.style.left = '0'; tw.style.top = '0';
    this.textContent = '\\u25a2';
  }
});

// 终端拖拽
var twDragging = false, twSx = 0, twSy = 0, twOx = 0, twOy = 0;
document.getElementById('tw-titlebar').addEventListener('pointerdown', function(e) {
  if (!tw) return;
  twDragging = true; twSx = e.clientX; twSy = e.clientY;
  twOx = tw.offsetLeft; twOy = tw.offsetTop;
  tw.setPointerCapture(e.pointerId);
});
if (tw) {
  tw.addEventListener('pointermove', function(e) {
    if (!twDragging) return;
    tw.style.left = (twOx + e.clientX - twSx) + 'px';
    tw.style.top = (twOy + e.clientY - twSy) + 'px';
  });
  tw.addEventListener('pointerup', function(e) { twDragging = false; if (tw.hasPointerCapture(e.pointerId)) tw.releasePointerCapture(e.pointerId); });
  tw.addEventListener('pointercancel', function(e) { twDragging = false; if (tw.hasPointerCapture(e.pointerId)) tw.releasePointerCapture(e.pointerId); });
}

// ===================================================================
// 键盘快捷键
// ===================================================================
document.addEventListener('keydown', function(e) {
  if (e.ctrlKey && e.key === '\`') {
    e.preventDefault();
    if (window.launchApp) window.launchApp('terminal');
    return;
  }
  if (e.key === 'Escape') {
    var startMenu = document.getElementById('start-menu');
    var powerMenu = document.getElementById('power-menu');
    if (startMenu && startMenu.classList.contains('show')) startMenu.classList.remove('show');
    if (powerMenu && powerMenu.style.display === 'block') powerMenu.style.display = 'none';
    if (window.hideContextMenu) window.hideContextMenu();
    return;
  }
});

// ===================================================================
// Toast 通知系统
// ===================================================================
function showToast(message, type) {
  type = type || 'info';
  var toast = document.createElement('div');
  var colors = { info: '#667eea', success: '#81c995', error: '#f28b82', warning: '#fdd663' };
  toast.style.cssText = 'position:fixed;bottom:60px;right:20px;z-index:10000;padding:12px 20px;border-radius:10px;font-size:13px;background:rgba(15,23,42,0.95);color:' + (colors[type] || '#ccc') + ';border:1px solid rgba(255,255,255,0.1);backdrop-filter:blur(20px);box-shadow:0 8px 24px rgba(0,0,0,0.4);max-width:320px;animation:toastSlideIn 0.3s ease;pointer-events:none;';
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(function() {
    toast.style.opacity = '0';
    toast.style.transition = 'opacity 0.3s';
    setTimeout(function() { toast.remove(); }, 300);
  }, 2500);
}
window.showToast = showToast;

var toastStyleEl = document.createElement('style');
toastStyleEl.textContent = '@keyframes toastSlideIn { from { transform: translateX(100px); opacity: 0; } to { transform: translateX(0); opacity: 1; } }';
document.head.appendChild(toastStyleEl);

// ===================================================================
// UI 初始化
// ===================================================================
function initUI() {
  initDesktop();
  initTaskbar();
  initStartMenu();
  initPowerMenu();
  initContextMenu();
  initLockScreen();
  initWallpaper();
  initAppWindow();
  if (window.SystemMonitor) window.SystemMonitor.start();
}

// ===================================================================
// 启动流程
// ===================================================================
async function boot() {
  if (!bootScreen || !appRoot) {
    console.error('Boot: 缺少必要的 DOM 元素');
    return;
  }
  var version = window.__WebNT_VERSION || '2.01';
  try {
    bootLogLine('WebNT 内核 v' + version + ' 正在启动...', 'info');
    bootLogLine('Copyright (c) 2026 WebNT 项目', '');
    bootLogLine('', '');

    bootProgress(10, '阶段 0: 硬件检测');
    bootLogLine('阶段 0: 硬件检测', 'info');
    bootLogLine('  CPU: ' + (navigator.hardwareConcurrency || '?') + ' 核', '');
    bootLogLine('  内存: ' + (navigator.deviceMemory || '?') + ' GB', '');
    var gpuOk = false;
    try { gpuOk = !!navigator.gpu; } catch(e) { gpuOk = false; }
    bootLogLine('  WebGPU: ' + (gpuOk ? '可用' : '不可用'), gpuOk ? 'ok' : 'warn');
    bootLogLine('', '');
    await new Promise(function(r) { setTimeout(r, 300); });

    bootProgress(35, '阶段 1: 内核初始化');
    bootLogLine('阶段 1: 内核初始化', 'info');
    bootLogLine('  [正常] 对象管理器已初始化', 'ok');
    bootLogLine('  [正常] 句柄表就绪', 'ok');
    bootLogLine('  [正常] SMP调度器已启动', 'ok');
    bootLogLine('  [正常] 中断控制器在线', 'ok');
    bootLogLine('', '');
    await new Promise(function(r) { setTimeout(r, 200); });

    bootProgress(55, '阶段 2: 加载驱动');
    bootLogLine('阶段 2: 加载驱动', 'info');
    bootLogLine('  [正常] 显示驱动.WebGPU', 'ok');
    bootLogLine('  [正常] 文件驱动.FS', 'ok');
    bootLogLine('  [正常] 网络驱动.Stream', 'ok');
    bootLogLine('  [正常] 终端驱动.Cmd', 'ok');
    bootLogLine('  [正常] 音频驱动.WA', 'ok');
    bootLogLine('', '');
    await new Promise(function(r) { setTimeout(r, 200); });

    bootProgress(75, '阶段 3: 启动用户会话');
    bootLogLine('阶段 3: 启动用户会话', 'info');
    bootLogLine('  [正常] 会话管理器已启动', 'ok');
    bootLogLine('  [正常] 桌面子系统已加载', 'ok');
    bootLogLine('  [正常] WinHTML 显示管线就绪', 'ok');
    bootLogLine('', '');
    await new Promise(function(r) { setTimeout(r, 200); });

    bootProgress(100, '系统就绪');
    bootLogLine('', '');
    bootLogLine('========================================', '');
    bootLogLine('  WebNT 内核 v' + version + ' 就绪', 'ok');
    bootLogLine('  所有系统运行正常', 'ok');
    bootLogLine('========================================', '');

    await new Promise(function(r) { setTimeout(r, 400); });

    if (bootScreen) bootScreen.classList.add('hidden');
    if (appRoot) appRoot.style.display = 'block';

    var lsVersionEl = document.getElementById('ls-version-text');
    if (lsVersionEl) lsVersionEl.textContent = 'v' + version;

    initUI();

    if (window.loadWallpaper) window.loadWallpaper();
    updateAllClocks();

    setTimeout(function() { if (bootScreen && bootScreen.parentNode) bootScreen.remove(); }, 600);

    console.log('%c WebNT 内核 v' + version + ' 就绪 %c| %c滑动解锁',
      'color:#00ff88;font-size:16px;', '', 'color:#aaa;');
  } catch(err) {
    if (bootLogLine) bootLogLine('启动错误: ' + err.message, 'err');
    console.error('Boot error:', err);
    if (bootScreen) bootScreen.classList.add('hidden');
    if (appRoot) appRoot.style.display = 'block';
    if (lockScreen && lockScreen.style.display !== 'none' && window.unlockDesktop) window.unlockDesktop();
  }
}

boot().catch(function(err) {
  if (bootLogLine) bootLogLine('严重错误: ' + err.message, 'err');
  console.error(err);
  if (bootScreen) bootScreen.classList.add('hidden');
  if (appRoot) appRoot.style.display = 'block';
  if (window.unlockDesktop) window.unlockDesktop();
});

})();
</script>

</body>
</html>`;

fs.writeFileSync(OUT, finalHTML, 'utf-8');

var stats = fs.statSync(OUT);
console.log('Build complete: ' + OUT);
console.log('Size: ' + (stats.size / 1024).toFixed(1) + ' KB');
console.log('CSS files merged: ' + cssFiles.length);
console.log('App modules merged: ' + appModuleNames.length);
