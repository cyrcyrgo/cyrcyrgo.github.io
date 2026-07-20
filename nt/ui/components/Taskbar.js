// ===================================================================
// Taskbar.js — 任务栏固定应用管理
// ===================================================================

import { WindowManager } from '../../core/Kernel.js';

let pinnedApps = [];

export function loadPinnedApps() {
  try { pinnedApps = JSON.parse(localStorage.getItem('webnt_taskbar_pins') || '[]'); }
  catch(e) { pinnedApps = []; }
}

export function savePinnedApps() {
  localStorage.setItem('webnt_taskbar_pins', JSON.stringify(pinnedApps));
}

export function isPinned(appId) {
  return pinnedApps.some(p => p.appId === appId);
}

export function pinToTaskbar(app) {
  if (!app || isPinned(app.appId)) return;
  pinnedApps.push({ id: app.id, name: app.name, icon: app.icon, color: app.color, appId: app.appId });
  savePinnedApps();
  renderPinnedTaskbar();
}

export function unpinFromTaskbar(appId) {
  pinnedApps = pinnedApps.filter(p => p.appId !== appId);
  savePinnedApps();
  renderPinnedTaskbar();
}

export function renderPinnedTaskbar() {
  const container = document.getElementById('tb-pinned');
  if (!container) return;
  container.innerHTML = '';
  const runningIds = new Set(
    (WindowManager.instance.getWindowList() || []).map(w => w.appId).filter(Boolean)
  );
  pinnedApps.forEach(app => {
    const btn = document.createElement('div');
    btn.className = 'tb-pin-btn' + (runningIds.has(app.appId) ? ' running' : '');
    btn.title = app.name;
    btn.innerHTML = `<span style="color:${app.color}">${app.icon}</span>`;
    btn.addEventListener('click', () => {
      const launchApp = window.launchApp;
      if (launchApp) launchApp(app.appId);
    });
    btn.addEventListener('contextmenu', e => {
      e.preventDefault(); e.stopPropagation();
      const showContextMenu = window.showContextMenu;
      if (showContextMenu) {
        showContextMenu(e.clientX, e.clientY, [
          {label:'取消固定', action:() => unpinFromTaskbar(app.appId)},
        ]);
      }
    });
    container.appendChild(btn);
  });
}

export function updateTaskbarWindowButtons() {
  const list = document.getElementById('tb-window-list');
  if (!list) return;
  const wins = WindowManager.instance.getWindowList();
  list.innerHTML = '';
  wins.forEach(w => {
    const btn = document.createElement('div');
    btn.className = 'tb-win-btn' + (WindowManager.instance.focus === w.id ? ' active' : '');
    btn.innerHTML = `<span class="tb-win-icon">${w.icon || '\ud83d\uddd1\ufe0f'}</span><span>${w.title}</span>`;
    btn.addEventListener('click', () => {
      WindowManager.instance.bringToFront(w.id);
      if (w.appId === 'terminal') {
        const tw = document.getElementById('terminal-window');
        if (tw) { tw.style.display = 'flex'; tw.style.zIndex = 100; }
      } else {
        const el = document.getElementById(w.appId);
        if (el) {
          el.style.display = 'flex';
          document.querySelectorAll('.app-window').forEach(ew => ew.style.zIndex = Math.min(50, ew.style.zIndex || 50));
          el.style.zIndex = 100;
        }
      }
      updateTaskbarWindowButtons();
    });
    list.appendChild(btn);
  });
  renderPinnedTaskbar();
}

export function initTaskbar() {
  loadPinnedApps();
  renderPinnedTaskbar();

  // 暴露到全局
  window.isPinned = isPinned;
  window.pinToTaskbar = pinToTaskbar;
  window.unpinFromTaskbar = unpinFromTaskbar;
  window.renderPinnedTaskbar = renderPinnedTaskbar;
  window.updateTaskbarWindowButtons = updateTaskbarWindowButtons;
}