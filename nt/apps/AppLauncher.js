// ===================================================================
// WebNT 应用启动器 - 统一入口，导入所有应用并按 appId 路由
// ===================================================================

import * as FileManager from './FileManager.js';
import * as Settings from './Settings.js';
import * as Notepad from './Notepad.js';
import * as Browser from './Browser.js';
import * as Calculator from './Calculator.js';
import * as Calendar from './Calendar.js';
import * as TaskManager from './TaskManager.js';
import * as SystemMonitorApp from './SystemMonitorApp.js';
import * as Paint from './Paint.js';
import * as Weather from './Weather.js';
import * as Clock from './Clock.js';
import * as Minesweeper from './Minesweeper.js';
import * as WordPad from './WordPad.js';
import * as Player from './Player.js';
import * as AppStore from './AppStore.js';

// 应用注册表：appId -> { id, name, icon, launch }
const appRegistry = {
  explorer: FileManager,
  settings: Settings,
  notepad: Notepad,
  webview: Browser,
  calculator: Calculator,
  calendar: Calendar,
  taskmgr: TaskManager,
  sysmon: SystemMonitorApp,
  paint: Paint,
  weather: Weather,
  clock: Clock,
  minesweeper: Minesweeper,
  wordpad: WordPad,
  player: Player,
  appstore: AppStore,
};

// 终端应用（特殊处理，直接操作 DOM）
function launchTerminal() {
  const tw = document.getElementById('terminal-window');
  const twInput = document.getElementById('tw-input');
  if(!tw || !twInput) return;
  tw.style.display='flex';
  tw.style.left='150px'; tw.style.top='80px';
  tw.style.zIndex=100;
  twInput.focus();
  tw.dataset.winId = window.WindowManager.instance.createWindow({title:'终端',appId:'terminal',icon:'\u2328\ufe0f'});
  tw.dataset.normalStyle = 'width:700px;height:420px;left:150px;top:80px';
}

// 计算机（特殊处理，直接显示系统信息）
function launchComputer() {
  const version = window.__WebNT_VERSION || '2.01';
  window.showAppWindow('此电脑', '\ud83d\udda5\ufe0f', `
    <div style="font-size:13px;line-height:1.8">
      <strong>WebNT 内核 v${version}</strong><br>
      CPU: ${navigator.hardwareConcurrency||'?'} 核<br>
      内存: ${navigator.deviceMemory||'?'} GB<br>
      平台: ${navigator.platform}<br>
      GPU: ${navigator.gpu?'WebGPU':'Canvas2D'}<br>
      用户代理: ${navigator.userAgent.substring(0,50)}...
    </div>
  `);
}

// 回收站（特殊处理，直接显示空状态）
function launchRecycle() {
  window.showAppWindow('回收站', '\ud83d\uddd1\ufe0f', `<div style="display:flex;align-items:center;justify-content:center;height:100%;color:#777">回收站为空</div>`);
}

// 特殊应用的注册
const specialApps = {
  terminal: launchTerminal,
  computer: launchComputer,
  recycle: launchRecycle,
};

function launchApp(appId) {
  // 访客模式限制
  if (window.__WebNT_isGuest) {
    const restrictedApps = ['terminal', 'settings', 'taskmgr'];
    if (restrictedApps.includes(appId)) {
      if (window.showAppWindow) {
        window.showAppWindow('访问受限', '\ud83d\uded1', `<div style="display:flex;align-items:center;justify-content:center;height:100%;color:#f28b82;font-size:14px;text-align:center;padding:20px;">访客模式下无法使用此功能。<br>请切换到管理员账户。</div>`);
      }
      return;
    }
  }

  // 先检查已注册的模块化应用
  const app = appRegistry[appId];
  if (app && app.launch) {
    app.launch();
    window.updateTaskbarWindowButtons();
    if (window.showToast) window.showToast('已启动: ' + (app.name || appId), 'success');
    return;
  }

  // 检查特殊应用
  const special = specialApps[appId];
  if (special) {
    special();
    window.updateTaskbarWindowButtons();
    if (window.showToast) window.showToast('已启动: ' + appId, 'success');
    return;
  }

  // 检查是否是已安装的第三方应用
  if (appId.startsWith('ext_')) {
    if (window.__launchInstalledApp) window.__launchInstalledApp(appId);
    if (window.showToast) window.showToast('已启动: ' + appId, 'success');
  } else {
    window.showAppWindow(appId, '\ud83d\udce6', `<div style="display:flex;align-items:center;justify-content:center;height:100%;color:#777">${appId} 正在运行</div>`);
    if (window.showToast) window.showToast('已启动: ' + appId, 'success');
  }

  window.updateTaskbarWindowButtons();
}

export { launchApp, appRegistry, specialApps };