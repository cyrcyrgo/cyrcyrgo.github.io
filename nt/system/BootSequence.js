// ===================================================================
// WebNT 启动序列
// ===================================================================

function bootLogLine(msg, type='') {
  const bootLog = document.getElementById('boot-log');
  if(!bootLog) return;
  const l=document.createElement('div'); l.className=`log-line ${type}`;
  l.textContent=`[${new Date().toISOString().slice(11,23)}] ${msg}`;
  bootLog.appendChild(l); bootLog.scrollTop=bootLog.scrollHeight;
}

function bootProgress(p, s) {
  const bootProgressBar = document.getElementById('boot-progress-bar');
  const bootStatus = document.getElementById('boot-status');
  if(bootProgressBar) bootProgressBar.style.width=p+'%';
  if(bootStatus) bootStatus.textContent=s;
}

async function runBootSequence() {
  const bootScreen = document.getElementById('boot-screen');
  const appRoot = document.getElementById('app-root');
  const lockScreen = document.getElementById('lock-screen');
  
  if(!bootScreen || !appRoot) {
    console.error('Boot: 缺少必要的 DOM 元素');
    return;
  }
  try {
  bootLogLine('WebNT 内核 v1.0.0 正在启动...', 'info');
  bootLogLine('Copyright (c) 2026 WebNT 项目', '');
  bootLogLine('', '');

  // Phase 0: 硬件检测
  bootProgress(10, '阶段 0: 硬件检测');
  bootLogLine('阶段 0: 硬件检测', 'info');
  bootLogLine(`  CPU: ${navigator.hardwareConcurrency||'?'} 核`, '');
  bootLogLine(`  内存: ${navigator.deviceMemory||'?'} GB`, '');
  let gpuOk = false;
  try { gpuOk = !!navigator.gpu; } catch(e) { gpuOk = false; }
  bootLogLine(`  WebGPU: ${gpuOk?'可用':'不可用'}`, gpuOk?'ok':'warn');
  bootLogLine('', '');
  await new Promise(r=>setTimeout(r,300));

  // Phase 1: 初始化内核
  bootProgress(35, '阶段 1: 内核初始化');
  bootLogLine('阶段 1: 内核初始化', 'info');
  bootLogLine('  [正常] 对象管理器已初始化', 'ok');
  bootLogLine('  [正常] 句柄表就绪', 'ok');
  bootLogLine('  [正常] SMP调度器已启动', 'ok');
  bootLogLine('  [正常] 中断控制器在线', 'ok');
  bootLogLine('', '');
  await new Promise(r=>setTimeout(r,200));

  // Phase 2: 加载驱动
  bootProgress(55, '阶段 2: 加载驱动');
  bootLogLine('阶段 2: 加载驱动', 'info');
  bootLogLine('  [正常] 显示驱动.WebGPU', 'ok');
  bootLogLine('  [正常] 文件驱动.FS', 'ok');
  bootLogLine('  [正常] 网络驱动.Stream', 'ok');
  bootLogLine('  [正常] 终端驱动.Cmd', 'ok');
  bootLogLine('  [正常] 音频驱动.WA', 'ok');
  bootLogLine('', '');
  await new Promise(r=>setTimeout(r,200));

  // Phase 3: 启动用户态
  bootProgress(75, '阶段 3: 启动用户会话');
  bootLogLine('阶段 3: 启动用户会话', 'info');
  bootLogLine('  [正常] 会话管理器已启动', 'ok');
  bootLogLine('  [正常] 桌面子系统已加载', 'ok');
  bootLogLine('  [正常] WinHTML 显示管线就绪', 'ok');
  bootLogLine('', '');
  await new Promise(r=>setTimeout(r,200));

  // Phase 4: 完成
  bootProgress(100, '系统就绪');
  bootLogLine('', '');
  bootLogLine('========================================', '');
  bootLogLine('  WebNT 内核 v1.0.0 就绪', 'ok');
  bootLogLine('  所有系统运行正常', 'ok');
  bootLogLine('========================================', '');

  await new Promise(r=>setTimeout(r,400));

  // 隐藏 BIOS 启动画面，显示锁屏
  bootScreen.classList.add('hidden');
  appRoot.style.display='block';
  if(window.loadWallpaper) window.loadWallpaper();
  if(window.updateAllClocks) window.updateAllClocks();

  setTimeout(() => { if(bootScreen && bootScreen.parentNode) bootScreen.remove(); }, 600);

  console.log('%c WebNT 内核 v1.0.0 就绪 %c| %c滑动解锁',
    'color:#00ff88;font-size:16px;', '', 'color:#aaa;');
  } catch(err) {
    bootLogLine(`启动错误: ${err.message}`, 'err');
    console.error('Boot error:', err);
    if(bootScreen) bootScreen.classList.add('hidden');
    if(appRoot) appRoot.style.display = 'block';
    if(lockScreen && lockScreen.style.display !== 'none' && window.unlockDesktop) window.unlockDesktop();
  }
}

export { bootLogLine, bootProgress, runBootSequence };