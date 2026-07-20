// ===================================================================
// WebNT.API.js — 第三方开发 SDK 接口
// ===================================================================
// 提供给第三方开发者的标准接口，用于开发 WebNT 应用

import { WindowManager, SysCallBridge, EventBus } from '../core/Kernel.js';

const WebNT = {
  version: '2.01',
  
  // 窗口管理接口
  window: {
    create(options) { return WindowManager.instance.createWindow(options); },
    destroy(id) { WindowManager.instance.destroyWindow(id); },
    focus(id) { WindowManager.instance.setFocus(id); },
    bringToFront(id) { WindowManager.instance.bringToFront(id); },
    getList() { return WindowManager.instance.getWindowList(); },
    on(event, callback) { WindowManager.instance.on(event, callback); },
  },
  
  // 系统调用接口
  syscall: {
    async call(name, ...args) { return SysCallBridge.instance.call(name, ...args); },
    getSystemInfo() { return SysCallBridge.instance.call('NtGetSystemInfo'); },
    shutdown() { return SysCallBridge.instance.call('NtShutdown'); },
    reboot() { return SysCallBridge.instance.call('NtReboot'); },
  },
  
  // 事件总线
  events: {
    on(event, callback) { EventBus.on(event, callback); },
    off(event, callback) { EventBus.off(event, callback); },
    emit(event, data) { EventBus.emit(event, data); },
  },
  
  // 存储接口
  storage: {
    get(key) { try { return JSON.parse(localStorage.getItem('webnt_' + key)); } catch(e) { return null; } },
    set(key, value) { try { localStorage.setItem('webnt_' + key, JSON.stringify(value)); } catch(e) {} },
    remove(key) { try { localStorage.removeItem('webnt_' + key); } catch(e) {} },
  },
  
  // 桌面接口
  desktop: {
    addIcon(id, name, icon, color, appId) {
      // 动态添加桌面图标
      if (window.__WebNT_addDesktopIcon) {
        window.__WebNT_addDesktopIcon(id, name, icon, color, appId);
      }
    },
    setWallpaper(url) {
      localStorage.setItem('webnt_wallpaper', url);
      if (window.__WebNT_applyWallpaper) {
        window.__WebNT_applyWallpaper(url);
      }
    },
  },
  
  // 通知接口
  notify(title, body) {
    if (window.__WebNT_showNotification) {
      window.__WebNT_showNotification(title, body);
    }
  },
  
  // 注册应用
  registerApp(app) {
    if (!window.__WebNT_registeredApps) window.__WebNT_registeredApps = [];
    window.__WebNT_registeredApps.push(app);
  },
};

// 挂载到全局
window.WebNT = WebNT;
window.__WebNT_API = WebNT;

export default WebNT;