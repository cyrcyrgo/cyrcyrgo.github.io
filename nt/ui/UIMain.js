// ===================================================================
// UIMain.js — UI 主入口，导入所有组件并初始化
// ===================================================================

import { initDesktop } from './components/DesktopIcons.js';
import { initTaskbar } from './components/Taskbar.js';
import { initStartMenu } from './components/StartMenu.js';
import { initPowerMenu } from './components/PowerMenu.js';
import { initContextMenu } from './components/ContextMenu.js';
import { initLockScreen } from './components/LockScreen.js';
import { initWallpaper } from './components/Wallpaper.js';
import { initAppWindow } from './components/AppWindow.js';

export function initUI() {
  initDesktop();
  initTaskbar();
  initStartMenu();
  initPowerMenu();
  initContextMenu();
  initLockScreen();
  initWallpaper();
  initAppWindow();
}

export default initUI;