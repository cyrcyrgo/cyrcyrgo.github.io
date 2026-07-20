// ===================================================================
// DesktopIcons.js — 桌面图标管理
// ===================================================================

export const desktopApps = [
  { id:'computer', name:'计算机', icon:'\ud83d\udda5\ufe0f', color:'#667eea', appId:'computer' },
  { id:'terminal', name:'终端', icon:'\u2328\ufe0f', color:'#00ff88', appId:'terminal' },
  { id:'explorer', name:'文件管理', icon:'\ud83d\udcc1', color:'#ffd700', appId:'explorer' },
  { id:'settings', name:'设置', icon:'\u2699\ufe0f', color:'#ccc', appId:'settings' },
  { id:'notepad', name:'记事本', icon:'\ud83d\udcc4', color:'#8ab4f8', appId:'notepad' },
  { id:'webview', name:'浏览器', icon:'\ud83c\udf10', color:'#4fc3f7', appId:'webview' },
  { id:'calculator', name:'计算器', icon:'\ud83d\uddd2\ufe0f', color:'#fdd663', appId:'calculator' },
  { id:'calendar', name:'日历', icon:'\ud83d\udcc5', color:'#f28b82', appId:'calendar' },
  { id:'paint', name:'画图', icon:'\ud83c\udfa8', color:'#ce93d8', appId:'paint' },
  { id:'player', name:'媒体播放器', icon:'\ud83c\udfa5', color:'#9c27b0', appId:'player' },
  { id:'weather', name:'天气', icon:'\u2600\ufe0f', color:'#ffcc02', appId:'weather' },
  { id:'clock', name:'时钟', icon:'\u23f0', color:'#80cbc4', appId:'clock' },
  { id:'minesweeper', name:'扫雷', icon:'\ud83d\udca3', color:'#ef5350', appId:'minesweeper' },
  { id:'wordpad', name:'写字板', icon:'\ud83d\udcdd', color:'#64b5f6', appId:'wordpad' },
  { id:'appstore', name:'应用商店', icon:'\ud83d\uded2', color:'#ff7043', appId:'appstore' },
  { id:'taskmgr', name:'任务管理', icon:'\ud83d\udcca', color:'#ff9800', appId:'taskmgr' },
  { id:'sysmon', name:'系统监控', icon:'\ud83d\udcbb', color:'#81c995', appId:'sysmon' },
  { id:'recycle', name:'回收站', icon:'\ud83d\uddd1\ufe0f', color:'#aaa', appId:'recycle' },
];

let selectedIcon = null;

export function addDesktopIcon(id, name, icon, color, appId) {
  if (!desktopApps.find(d => d.id === id)) {
    desktopApps.push({ id, name, icon, color, appId });
  }
}

export function getDesktopOrder() {
  try { return JSON.parse(localStorage.getItem('webnt_desktop_order') || '[]'); } catch(e) { return []; }
}

export function saveDesktopOrder(order) {
  try { localStorage.setItem('webnt_desktop_order', JSON.stringify(order)); } catch(e) {}
}

export function renderDesktopIcons() {
  const desktopIconsEl = document.getElementById('desktop-icons');
  if (!desktopIconsEl) return;
  desktopIconsEl.innerHTML = '';

  let installedApps = [];
  try { installedApps = JSON.parse(localStorage.getItem('webnt_installed_apps') || '[]'); } catch(e) {}

  const allApps = [...desktopApps];
  installedApps.forEach(a => {
    if (!allApps.find(d => d.id === a.id)) {
      allApps.push({ id: a.id, name: a.name, icon: a.icon, color: a.color, appId: a.id });
    }
  });

  const savedOrder = getDesktopOrder();
  if (savedOrder.length > 0) {
    const ordered = [];
    savedOrder.forEach(id => { const a = allApps.find(d => d.id === id); if (a) ordered.push(a); });
    allApps.forEach(a => { if (!ordered.find(d => d.id === a.id)) ordered.push(a); });
    allApps.length = 0;
    allApps.push(...ordered);
  }

  allApps.forEach((app) => {
    const icon = document.createElement('div');
    icon.className = 'desktop-icon';
    icon.dataset.appId = app.id;
    icon.draggable = true;
    icon.innerHTML = `<div class="dicon-svg" style="font-size:36px;color:${app.color}">${app.icon}</div><div class="dicon-label">${app.name}</div>`;

    icon.addEventListener('click', (e) => {
      e.stopPropagation();
      if (selectedIcon) selectedIcon.classList.remove('selected');
      icon.classList.add('selected');
      selectedIcon = icon;
    });

    icon.addEventListener('dblclick', (e) => {
      e.stopPropagation();
      const launchApp = window.launchApp;
      if (launchApp) launchApp(app.appId);
    });

    icon.addEventListener('contextmenu', (e) => {
      e.preventDefault(); e.stopPropagation();
      const isPinned = window.isPinned;
      const pinToTaskbar = window.pinToTaskbar;
      const unpinFromTaskbar = window.unpinFromTaskbar;
      const showContextMenu = window.showContextMenu;
      const launchApp = window.launchApp;
      const writeTerminal = window.writeTerminal;
      const pinLabel = (isPinned && isPinned(app.appId)) ? '从任务栏取消固定' : '固定到任务栏';
      if (showContextMenu) {
        showContextMenu(e.clientX, e.clientY, [
          {label:'打开', action:() => { if (launchApp) launchApp(app.appId); }},
          {label:'在终端中打开', action:() => {
            if (launchApp) launchApp('terminal');
            if (writeTerminal) writeTerminal(`正在打开 ${app.name}...\n`);
          }},
          {separator:true},
          {label:pinLabel, action:() => {
            if (isPinned && isPinned(app.appId)) {
              if (unpinFromTaskbar) unpinFromTaskbar(app.appId);
            } else {
              if (pinToTaskbar) pinToTaskbar(app);
            }
          }},
          {label:'属性', action:() => {}},
        ]);
      }
    });

    // HTML5 拖拽排序
    icon.addEventListener('dragstart', (e) => {
      icon.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', app.id);
    });

    icon.addEventListener('dragend', () => {
      icon.classList.remove('dragging');
      document.querySelectorAll('.desktop-icon.drag-over').forEach(el => el.classList.remove('drag-over'));
      const newOrder = [...document.querySelectorAll('.desktop-icon')].map(el => el.dataset.appId);
      saveDesktopOrder(newOrder);
    });

    icon.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      const dragging = document.querySelector('.desktop-icon.dragging');
      if (!dragging || dragging === icon) return;
      const rect = icon.getBoundingClientRect();
      const midY = rect.top + rect.height / 2;
      if (e.clientY < midY) {
        desktopIconsEl.insertBefore(dragging, icon);
      } else {
        desktopIconsEl.insertBefore(dragging, icon.nextSibling);
      }
      icon.classList.add('drag-over');
    });

    icon.addEventListener('dragleave', () => {
      icon.classList.remove('drag-over');
    });

    // 触控长按拖拽
    let longPressTimer = null, longPressTriggered = false, touchDragging = false;
    let touchStartX = 0, touchStartY = 0;

    icon.addEventListener('touchstart', (e) => {
      longPressTriggered = false; touchDragging = false;
      longPressTimer = setTimeout(() => {
        longPressTriggered = true;
        touchDragging = true;
        icon.classList.add('dragging');
        icon.style.position = 'relative';
        icon.style.zIndex = '10';
        const touch = e.touches[0];
        touchStartX = touch.clientX;
        touchStartY = touch.clientY;
        if (navigator.vibrate) navigator.vibrate(15);
      }, 500);
    }, {passive: false});

    icon.addEventListener('touchmove', (e) => {
      if (!touchDragging) {
        if (longPressTimer) { clearTimeout(longPressTimer); longPressTimer = null; }
        return;
      }
      e.preventDefault();
      const touch = e.touches[0];
      const dx = touch.clientX - touchStartX;
      const dy = touch.clientY - touchStartY;
      icon.style.transform = `translate(${dx}px, ${dy}px)`;
      document.querySelectorAll('.desktop-icon').forEach(el => {
        if (el === icon) return;
        el.classList.remove('drag-over');
        const rect = el.getBoundingClientRect();
        const cx = touch.clientX, cy = touch.clientY;
        if (cx >= rect.left && cx <= rect.right && cy >= rect.top && cy <= rect.bottom) {
          el.classList.add('drag-over');
        }
      });
    }, {passive: false});

    icon.addEventListener('touchend', (e) => {
      if (longPressTimer) { clearTimeout(longPressTimer); longPressTimer = null; }
      if (!touchDragging) return;
      touchDragging = false;
      icon.classList.remove('dragging');
      icon.style.position = '';
      icon.style.zIndex = '';
      icon.style.transform = '';
      const overEl = document.querySelector('.desktop-icon.drag-over');
      document.querySelectorAll('.desktop-icon.drag-over').forEach(el => el.classList.remove('drag-over'));
      if (overEl && overEl !== icon) {
        const rect = overEl.getBoundingClientRect();
        const midY = rect.top + rect.height / 2;
        const touch = e.changedTouches[0];
        if (touch.clientY < midY) {
          desktopIconsEl.insertBefore(icon, overEl);
        } else {
          desktopIconsEl.insertBefore(icon, overEl.nextSibling);
        }
      }
      const newOrder = [...document.querySelectorAll('.desktop-icon')].map(el => el.dataset.appId);
      saveDesktopOrder(newOrder);
    });

    // 触控长按弹出右键菜单
    icon.addEventListener('touchstart', (e) => {
      if (!icon.__touchMenuBound) {
        icon.__touchMenuBound = true;
        let menuTimer = null;
        icon.addEventListener('touchstart', function menuHandler(ev) {
          menuTimer = setTimeout(() => {
            if (longPressTriggered) return;
            const touch = ev.touches[0];
            const isPinned = window.isPinned;
            const pinToTaskbar = window.pinToTaskbar;
            const unpinFromTaskbar = window.unpinFromTaskbar;
            const showContextMenu = window.showContextMenu;
            const launchApp = window.launchApp;
            const writeTerminal = window.writeTerminal;
            const pinLabel = (isPinned && isPinned(app.appId)) ? '从任务栏取消固定' : '固定到任务栏';
            if (showContextMenu) {
              showContextMenu(touch.clientX, touch.clientY, [
                {label:'打开', action:() => { if (launchApp) launchApp(app.appId); }},
                {label:'在终端中打开', action:() => {
                  if (launchApp) launchApp('terminal');
                  if (writeTerminal) writeTerminal(`正在打开 ${app.name}...\n`);
                }},
                {separator:true},
                {label:pinLabel, action:() => {
                  if (isPinned && isPinned(app.appId)) {
                    if (unpinFromTaskbar) unpinFromTaskbar(app.appId);
                  } else {
                    if (pinToTaskbar) pinToTaskbar(app);
                  }
                }},
                {label:'属性', action:() => {}},
              ]);
            }
            if (navigator.vibrate) navigator.vibrate(10);
          }, 600);
          const clearTimer = () => { if (menuTimer) { clearTimeout(menuTimer); menuTimer = null; } };
          icon.addEventListener('touchend', clearTimer, {once: true});
          icon.addEventListener('touchmove', clearTimer, {once: true});
        }, {once: true});
      }
    });

    desktopIconsEl.appendChild(icon);
  });
}

export function initDesktop() {
  const desktopIconsEl = document.getElementById('desktop-icons');
  if (!desktopIconsEl) return;

  renderDesktopIcons();

  // 桌面右键菜单 & 长按更换壁纸
  let desktopLongPressTimer = null;
  let desktopLongPressTarget = null;

  desktopIconsEl.addEventListener('contextmenu', e => {
    if (e.target !== desktopIconsEl) return;
    e.preventDefault();
    const showContextMenu = window.showContextMenu;
    const showWallpaperDialog = window.showWallpaperDialog;
    const launchApp = window.launchApp;
    if (showContextMenu) {
      showContextMenu(e.clientX, e.clientY, [
        {label:'查看', action:() => {}},
        {label:'排序方式', action:() => {}},
        {separator:true},
        {label:'刷新', action:() => renderDesktopIcons()},
        {separator:true},
        {label:'更换壁纸', action:() => { if (showWallpaperDialog) showWallpaperDialog(); }},
        {label:'显示设置', action:() => { if (launchApp) launchApp('settings'); }},
        {label:'个性化', action:() => { if (showWallpaperDialog) showWallpaperDialog(); }},
      ]);
    }
  });

  function startDesktopLongPress(x, y) {
    desktopLongPressTimer = setTimeout(() => {
      desktopLongPressTimer = null;
      const showContextMenu = window.showContextMenu;
      const showWallpaperDialog = window.showWallpaperDialog;
      const launchApp = window.launchApp;
      if (showContextMenu) {
        showContextMenu(x, y, [
          {label:'查看', action:() => {}},
          {label:'排序方式', action:() => {}},
          {separator:true},
          {label:'新建文件夹', action:() => {}},
          {label:'新建文本文档', action:() => {}},
          {separator:true},
          {label:'刷新', action:() => renderDesktopIcons()},
          {separator:true},
          {label:'更换壁纸', action:() => { if (showWallpaperDialog) showWallpaperDialog(); }},
          {label:'显示设置', action:() => { if (launchApp) launchApp('settings'); }},
          {label:'个性化', action:() => { if (showWallpaperDialog) showWallpaperDialog(); }},
        ]);
      }
    }, 600);
  }

  function cancelDesktopLongPress() {
    if (desktopLongPressTimer) { clearTimeout(desktopLongPressTimer); desktopLongPressTimer = null; }
  }

  desktopIconsEl.addEventListener('pointerdown', e => {
    if (e.target !== desktopIconsEl) return;
    desktopLongPressTarget = e.target;
    startDesktopLongPress(e.clientX, e.clientY);
  });

  desktopIconsEl.addEventListener('pointerup', () => {
    cancelDesktopLongPress();
    desktopLongPressTarget = null;
  });

  desktopIconsEl.addEventListener('pointermove', e => {
    if (desktopLongPressTimer && e.target !== desktopLongPressTarget) cancelDesktopLongPress();
  });

  desktopIconsEl.addEventListener('pointercancel', () => {
    cancelDesktopLongPress();
    desktopLongPressTarget = null;
  });

  // 点击空白取消选择
  desktopIconsEl.addEventListener('click', e => {
    if (e.target === desktopIconsEl) {
      if (selectedIcon) selectedIcon.classList.remove('selected');
      selectedIcon = null;
    }
  });

  // 桌面右键菜单点击关闭
  desktopIconsEl.addEventListener('click', () => {
    const startMenu = document.getElementById('start-menu');
    const powerMenu = document.getElementById('power-menu');
    const hideContextMenu = window.hideContextMenu;
    if (startMenu && startMenu.classList.contains('show')) startMenu.classList.remove('show');
    if (powerMenu && powerMenu.style.display === 'block') powerMenu.style.display = 'none';
    if (hideContextMenu) hideContextMenu();
  });
}