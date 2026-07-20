// ===================================================================
// WebNT 应用注册表 - 桌面图标、开始菜单、应用商店
// ===================================================================

const desktopApps = [
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

const startMenuApps = [
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

const storeRegistry = [
  {
    id: 'snake', name: '贪吃蛇', icon: '\ud83d\udc0d', color: '#81c995',
    version: '2.1.0', author: 'WebNT Labs', category: '游戏',
    url: 'https://cdn.jsdelivr.net/gh/topics/snake-game/snake.js',
    description: '经典贪吃蛇游戏，WebNT 官方移植版。使用方向键控制蛇的移动，吃到食物得分，撞墙或撞到自己则游戏结束。',
    features: ['经典街机玩法','5 档难度选择','本地排行榜','键盘/触摸双模式','暗色主题适配'],
    permissions: ['storage: 存储排行榜数据'],
    images: ['data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="300" height="150" viewBox="0 0 300 150"><rect width="300" height="150" fill="#1a1a2e"/><rect x="30" y="30" width="20" height="20" fill="#81c995" rx="2"/><rect x="50" y="30" width="20" height="20" fill="#81c995" rx="2"/><rect x="70" y="30" width="20" height="20" fill="#81c995" rx="2"/><rect x="70" y="10" width="20" height="20" fill="#81c995" rx="2"/><rect x="90" y="10" width="20" height="20" fill="#81c995" rx="2"/><circle cx="180" cy="60" r="8" fill="#f28b82"/><text x="30" y="120" fill="#888" font-size="11">Snake Game v2.1.0</text></svg>')],
  },
  {
    id: '2048', name: '2048', icon: '\ud83d\udd32', color: '#fdd663',
    version: '1.3.0', author: 'WebNT Labs', category: '游戏',
    url: 'https://cdn.jsdelivr.net/gh/gabrielecirulli/2048/index.html',
    description: '风靡全球的数字合并游戏。通过滑动合并相同数字，目标是合成 2048 方块。',
    features: ['4x4 经典棋盘','滑动合并操作','撤销功能','分数统计','动画效果'],
    permissions: ['storage: 存储游戏进度'],
    images: ['data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="300" height="150" viewBox="0 0 300 150"><rect width="300" height="150" fill="#1a1a2e"/><rect x="30" y="20" width="50" height="50" fill="#fdd663" rx="4"/><text x="55" y="52" text-anchor="middle" fill="#1a1a2e" font-size="20" font-weight="bold">2</text><rect x="90" y="20" width="50" height="50" fill="#ff9800" rx="4"/><text x="115" y="52" text-anchor="middle" fill="#1a1a2e" font-size="20" font-weight="bold">4</text><rect x="150" y="20" width="50" height="50" fill="#e0e0e0" rx="4"/><text x="175" y="52" text-anchor="middle" fill="#1a1a2e" font-size="14">8</text><rect x="210" y="20" width="50" height="50" fill="#e0e0e0" rx="4"/><text x="235" y="52" text-anchor="middle" fill="#1a1a2e" font-size="14">16</text><text x="30" y="120" fill="#888" font-size="11">2048 Game v1.3.0</text></svg>')],
  },
  {
    id: 'tetris', name: '俄罗斯方块', icon: '\ud83e\udde9', color: '#ce93d8',
    version: '1.0.0', author: 'WebNT Labs', category: '游戏',
    url: 'https://cdn.jsdelivr.net/gh/chvin/react-tetris/index.html',
    description: '经典俄罗斯方块，7 种方块类型，消除整行得分。',
    features: ['7 种标准方块','旋转/加速下落','分数系统','等级递增','预览下一个方块'],
    permissions: ['storage: 存储高分记录'],
    images: ['data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="300" height="150" viewBox="0 0 300 150"><rect width="300" height="150" fill="#1a1a2e"/><rect x="110" y="10" width="20" height="20" fill="#ce93d8" rx="2"/><rect x="130" y="10" width="20" height="20" fill="#ce93d8" rx="2"/><rect x="150" y="10" width="20" height="20" fill="#ce93d8" rx="2"/><rect x="170" y="10" width="20" height="20" fill="#ce93d8" rx="2"/><rect x="110" y="50" width="20" height="20" fill="#81c995" rx="2"/><rect x="130" y="50" width="20" height="20" fill="#81c995" rx="2"/><rect x="110" y="70" width="20" height="20" fill="#81c995" rx="2"/><rect x="90" y="100" width="20" height="20" fill="#fdd663" rx="2"/><rect x="110" y="100" width="20" height="20" fill="#fdd663" rx="2"/><text x="30" y="120" fill="#888" font-size="11">Tetris v1.0.0</text></svg>')],
  },
  {
    id: 'mdeditor', name: 'Markdown 编辑器', icon: '\ud83d\udcdd', color: '#8ab4f8',
    version: '1.2.0', author: 'WebNT Labs', category: '工具',
    url: 'https://cdn.jsdelivr.net/gh/nicehash/md-editor/index.html',
    description: '轻量级 Markdown 编辑器，支持实时预览和语法高亮。',
    features: ['实时预览','语法高亮','导出 HTML','暗色主题','自动保存'],
    permissions: ['storage: 存储文档','clipboard: 复制导出内容'],
    images: ['data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="300" height="150" viewBox="0 0 300 150"><rect width="300" height="150" fill="#1a1a2e"/><rect x="20" y="15" width="125" height="120" fill="rgba(255,255,255,0.04)" rx="4"/><text x="30" y="35" fill="#8ab4f8" font-size="10"># Hello World</text><text x="30" y="52" fill="#ccc" font-size="9">This is **bold** text</text><text x="30" y="68" fill="#81c995" font-size="9">- List item 1</text><text x="30" y="84" fill="#81c995" font-size="9">- List item 2</text><text x="30" y="100" fill="#888" font-size="9">\`\`\`js</text><text x="30" y="116" fill="#888" font-size="9">console.log()</text><rect x="155" y="15" width="125" height="120" fill="rgba(255,255,255,0.04)" rx="4"/><text x="165" y="35" fill="#fff" font-size="14" font-weight="bold">Hello World</text><text x="165" y="55" fill="#ccc" font-size="11">This is <b>bold</b> text</text><text x="165" y="75" fill="#ccc" font-size="10">\u2022 List item 1</text><text x="165" y="92" fill="#ccc" font-size="10">\u2022 List item 2</text></svg>')],
  },
  {
    id: 'notepadpro', name: '记事本 Pro', icon: '\ud83d\udcdd', color: '#64b5f6',
    version: '1.0.0', author: 'WebNT Labs', category: '工具',
    url: 'https://cdn.jsdelivr.net/gh/example/notepad-pro/index.html',
    description: '增强版记事本，支持多标签页、语法高亮和代码片段管理。',
    features: ['多标签页编辑','语法高亮','代码片段','搜索替换','自动保存'],
    permissions: ['storage: 存储文档','tabs: 多标签管理'],
    images: ['data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="300" height="150" viewBox="0 0 300 150"><rect width="300" height="150" fill="#1a1a2e"/><rect x="20" y="10" width="260" height="130" fill="rgba(255,255,255,0.04)" rx="6"/><rect x="20" y="10" width="80" height="24" fill="#64b5f6" rx="4"/><text x="60" y="27" text-anchor="middle" fill="#fff" font-size="10">script.js</text><rect x="102" y="10" width="70" height="24" fill="rgba(255,255,255,0.06)" rx="4"/><text x="137" y="27" text-anchor="middle" fill="#888" font-size="10">style.css</text><text x="32" y="52" fill="#8ab4f8" font-size="10">function</text><text x="75" y="52" fill="#fdd663" font-size="10">hello</text><text x="101" y="52" fill="#ccc" font-size="10">() {</text><text x="40" y="68" fill="#81c995" font-size="10">console</text><text x="85" y="68" fill="#ccc" font-size="10">.log(</text><text x="110" y="68" fill="#f28b82" font-size="10">"Hello"</text><text x="150" y="68" fill="#ccc" font-size="10">);</text><text x="32" y="84" fill="#ccc" font-size="10">}</text></svg>')],
  },
  {
    id: 'weatherwidget', name: '天气 Widget', icon: '\u2600\ufe0f', color: '#ffcc02',
    version: '1.0.0', author: 'WebNT Labs', category: '生活',
    url: 'https://cdn.jsdelivr.net/gh/example/weather-widget/index.html',
    description: '桌面天气小部件，支持多城市切换和实时天气数据。',
    features: ['实时天气数据','多城市支持','5 日预报','空气质量指数','桌面 Widget'],
    permissions: ['network: 获取天气 API 数据','location: 自动定位城市'],
    images: ['data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="300" height="150" viewBox="0 0 300 150"><rect width="300" height="150" fill="#1a1a2e"/><circle cx="60" cy="50" r="30" fill="#ffcc02"/><line x1="60" y1="85" x2="60" y2="95" stroke="#ffcc02" stroke-width="2"/><line x1="40" y1="85" x2="35" y2="95" stroke="#ffcc02" stroke-width="2"/><line x1="80" y1="85" x2="85" y2="95" stroke="#ffcc02" stroke-width="2"/><text x="120" y="45" fill="#fff" font-size="28" font-weight="200">28\u00b0</text><text x="120" y="65" fill="#ccc" font-size="12">晴</text><text x="120" y="85" fill="#888" font-size="11">湿度 45%</text><text x="220" y="45" fill="#888" font-size="11">周一 30\u00b0 / 20\u00b0</text><text x="220" y="65" fill="#888" font-size="11">周二 27\u00b0 / 18\u00b0</text><text x="220" y="85" fill="#888" font-size="11">周三 24\u00b0 / 16\u00b0</text></svg>')],
  },
];

function addDesktopIcon(id, name, icon, color, appId) {
  if(!desktopApps.find(d => d.id === id)) {
    desktopApps.push({ id, name, icon, color, appId });
  }
}

export { desktopApps, startMenuApps, storeRegistry, addDesktopIcon };