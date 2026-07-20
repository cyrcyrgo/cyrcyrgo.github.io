// ===================================================================
// StartMenu.js — 开始菜单
// ===================================================================

export function renderStartMenu() {
  const smAppList = document.getElementById('sm-app-list');
  if (!smAppList) return;
  smAppList.innerHTML = '';

  const apps = [
    {name:'终端', icon:'\u2328\ufe0f', color:'#00ff88', appId:'terminal'},
    {name:'文件管理', icon:'\ud83d\udcc1', color:'#ffd700', appId:'explorer'},
    {name:'设置', icon:'\u2699\ufe0f', color:'#ccc', appId:'settings'},
    {name:'浏览器', icon:'\ud83c\udf10', color:'#4fc3f7', appId:'webview'},
    {name:'记事本', icon:'\ud83d\udcc4', color:'#8ab4f8', appId:'notepad'},
    {name:'计算器', icon:'\ud83d\uddd2\ufe0f', color:'#fdd663', appId:'calculator'},
    {name:'日历', icon:'\ud83d\udcc5', color:'#f28b82', appId:'calendar'},
    {name:'画图', icon:'\ud83c\udfa8', color:'#ce93d8', appId:'paint'},
    {name:'媒体播放器', icon:'\ud83c\udfa5', color:'#9c27b0', appId:'player'},
    {name:'天气', icon:'\u2600\ufe0f', color:'#ffcc02', appId:'weather'},
    {name:'时钟', icon:'\u23f0', color:'#80cbc4', appId:'clock'},
    {name:'扫雷', icon:'\ud83d\udca3', color:'#ef5350', appId:'minesweeper'},
    {name:'写字板', icon:'\ud83d\udcdd', color:'#64b5f6', appId:'wordpad'},
    {name:'应用商店', icon:'\ud83d\uded2', color:'#ff7043', appId:'appstore'},
    {name:'计算机', icon:'\ud83d\udda5\ufe0f', color:'#667eea', appId:'computer'},
    {name:'任务管理', icon:'\ud83d\udcca', color:'#ff9800', appId:'taskmgr'},
    {name:'系统监控', icon:'\ud83d\udcbb', color:'#81c995', appId:'sysmon'},
  ];

  apps.forEach(app => {
    const el = document.createElement('div');
    el.className = 'sm-app-item';
    el.innerHTML = `<span class="sm-app-icon" style="background:${app.color}22;color:${app.color}">${app.icon}</span>${app.name}`;
    el.addEventListener('click', () => {
      const launchApp = window.launchApp;
      if (launchApp) launchApp(app.appId);
      toggleStartMenu();
    });
    smAppList.appendChild(el);
  });
}

export function toggleStartMenu() {
  const startMenu = document.getElementById('start-menu');
  if (startMenu) startMenu.classList.toggle('show');
}

export function initStartMenu() {
  renderStartMenu();

  const startBtn = document.getElementById('tb-start-btn');
  if (startBtn) {
    startBtn.addEventListener('click', e => { e.stopPropagation(); toggleStartMenu(); });
  }

  const smShutdown = document.getElementById('sm-shutdown');
  if (smShutdown) {
    smShutdown.addEventListener('click', () => {
      if (confirm('确定要关闭 WebNT 吗？')) location.reload();
    });
  }

  // 搜索过滤
  const searchInput = document.getElementById('sm-search-input');
  const smAppList = document.getElementById('sm-app-list');
  if (searchInput && smAppList) {
    searchInput.addEventListener('input', e => {
      const q = e.target.value.toLowerCase();
      smAppList.querySelectorAll('.sm-app-item').forEach(el => {
        el.style.display = el.textContent.toLowerCase().includes(q) ? 'flex' : 'none';
      });
    });
  }
}