// ===================================================================
// AppWindow.js — 通用应用窗口管理
// ===================================================================

import { WindowManager } from '../../core/Kernel.js';

let appWinCounter = 0;

export function showAppWindow(title, icon, bodyHTML) {
  const appRoot = document.getElementById('app-root');
  if (!appRoot) return;

  const id = 'appwin_' + (++appWinCounter);
  const win = document.createElement('div');
  win.className = 'app-window';
  win.id = id;
  win.style.display = 'flex';
  win.style.width = '500px';
  win.style.height = '400px';
  win.style.left = (200 + appWinCounter * 30) + 'px';
  win.style.top = (60 + appWinCounter * 30) + 'px';
  win.style.zIndex = 50 + appWinCounter;

  const winId = WindowManager.instance.createWindow({title, appId: id, icon});
  win.dataset.winId = winId;
  win.dataset.normalStyle = `width:500px;height:400px;left:${200 + appWinCounter * 30}px;top:${60 + appWinCounter * 30}px`;

  win.innerHTML = `
    <div class="aw-titlebar" data-winid="${id}">
      <span style="margin-right:8px">${icon}</span>
      <span class="aw-title">${title}</span>
      <div class="aw-ctrl">
        <button class="aw-ctrl-btn" onclick="(function(){const w=this.closest('.app-window');w.style.display='none';if(window.updateTaskbarWindowButtons)window.updateTaskbarWindowButtons();}).call(this)">&#x2014;</button>
        <button class="aw-ctrl-btn" onclick="const w=this.closest('.app-window');const ns=w.dataset.normalStyle;if(w.style.width==='100vw'){w.style.cssText=ns;this.textContent='\\u25a1'}else{w.dataset.normalStyle='width:'+w.style.width+';height:'+w.style.height+';left:'+w.style.left+';top:'+w.style.top;w.style.width='100vw';w.style.height='calc(100vh - 48px)';w.style.left='0';w.style.top='0';this.textContent='\\u25a2'}">&#x25a1;</button>
        <button class="aw-ctrl-btn close" onclick="(function(){const w=this.closest('.app-window');const wid=w.dataset.winId;if(wid&&window.WindowManager&&window.WindowManager.instance)window.WindowManager.instance.destroyWindow(wid);w.remove();if(window.updateTaskbarWindowButtons)window.updateTaskbarWindowButtons();}).call(this)">&#x2715;</button>
      </div>
    </div>
    <div class="aw-body">${bodyHTML}</div>
  `;

  // 拖拽
  let dragging = false, sx = 0, sy = 0, ox = 0, oy = 0;
  const titlebar = win.querySelector('.aw-titlebar');
  if (titlebar) {
    titlebar.addEventListener('pointerdown', e => {
      // 置顶窗口
      document.querySelectorAll('.app-window').forEach(w => w.style.zIndex = Math.min(50, w.style.zIndex || 50));
      const tw = document.getElementById('terminal-window');
      if (tw) tw.style.zIndex = 50;
      win.style.zIndex = 100;

      dragging = true;
      sx = e.clientX;
      sy = e.clientY;
      ox = win.offsetLeft;
      oy = win.offsetTop;
      win.setPointerCapture(e.pointerId);
    });
  }

  win.addEventListener('pointermove', e => {
    if (!dragging) return;
    win.style.left = (ox + e.clientX - sx) + 'px';
    win.style.top = (oy + e.clientY - sy) + 'px';
  });

  win.addEventListener('pointerup', (e) => {
    dragging = false;
    if (win.hasPointerCapture(e.pointerId)) win.releasePointerCapture(e.pointerId);
  });

  win.addEventListener('pointercancel', (e) => {
    dragging = false;
    if (win.hasPointerCapture(e.pointerId)) win.releasePointerCapture(e.pointerId);
  });

  // 聚焦 - 点击窗口任意位置提升层级
  win.addEventListener('pointerdown', (e) => {
    // 将所有窗口 z-index 降低
    document.querySelectorAll('.app-window').forEach(w => {
      w.style.zIndex = Math.min(50, parseInt(w.style.zIndex) || 50);
    });
    // 终端窗口也降低
    const tw = document.getElementById('terminal-window');
    if (tw) tw.style.zIndex = 50;
    // 当前窗口置顶
    win.style.zIndex = 100;

    // 聚焦窗口管理器
    if (win.dataset.winId && window.WindowManager && window.WindowManager.instance) {
      window.WindowManager.instance.bringToFront(win.dataset.winId);
    }
  });

  appRoot.appendChild(win);

  const updateTaskbar = window.updateTaskbarWindowButtons;
  if (updateTaskbar) updateTaskbar();

  return win;
}

export function getAppWinCounter() {
  return appWinCounter;
}

export function initAppWindow() {
  // 暴露到全局
  window.showAppWindow = showAppWindow;
  window.appWinCounter = appWinCounter;
  window.__WebNT_appWinCounter = appWinCounter;
}