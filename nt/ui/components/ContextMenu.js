// ===================================================================
// ContextMenu.js — 右键菜单
// ===================================================================

export function showContextMenu(x, y, items) {
  const contextMenu = document.getElementById('context-menu');
  if (!contextMenu) return;
  contextMenu.innerHTML = '';
  items.forEach(item => {
    if (item.separator) {
      const s = document.createElement('div');
      s.className = 'cm-separator';
      contextMenu.appendChild(s);
      return;
    }
    const el = document.createElement('div');
    el.className = 'cm-item';
    el.innerHTML = `<span>${item.label}</span>${item.shortcut ? `<span class="cm-shortcut">${item.shortcut}</span>` : ''}`;
    el.addEventListener('click', () => { if (item.action) item.action(); hideContextMenu(); });
    contextMenu.appendChild(el);
  });
  contextMenu.style.display = 'block';
  requestAnimationFrame(() => {
    const menuHeight = contextMenu.offsetHeight || 200;
    contextMenu.style.left = Math.max(0, Math.min(x, window.innerWidth - 220)) + 'px';
    contextMenu.style.top = Math.max(0, Math.min(y, window.innerHeight - menuHeight - 10)) + 'px';
  });
}

export function hideContextMenu() {
  const contextMenu = document.getElementById('context-menu');
  if (contextMenu) contextMenu.style.display = 'none';
}

export function initContextMenu() {
  // 暴露到全局
  window.showContextMenu = showContextMenu;
  window.hideContextMenu = hideContextMenu;

  // 点击其他地方关闭开始菜单 / 电源菜单 / 右键菜单
  document.addEventListener('click', e => {
    const startMenu = document.getElementById('start-menu');
    const powerMenu = document.getElementById('power-menu');
    const contextMenu = document.getElementById('context-menu');

    if (startMenu && startMenu.classList.contains('show') &&
        !startMenu.contains(e.target) &&
        e.target.id !== 'tb-start-btn' &&
        !document.getElementById('tb-start-btn')?.contains(e.target)) {
      startMenu.classList.remove('show');
    }
    if (powerMenu && powerMenu.style.display === 'block' &&
        !powerMenu.contains(e.target) &&
        e.target.id !== 'tb-power-btn' &&
        !document.getElementById('tb-power-btn')?.contains(e.target)) {
      powerMenu.style.display = 'none';
    }
    if (contextMenu && contextMenu.style.display === 'block' &&
        !contextMenu.contains(e.target)) {
      hideContextMenu();
    }
  });
}