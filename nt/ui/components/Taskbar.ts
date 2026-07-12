/**
 * Taskbar.ts — Taskbar Controller for the WebNT-HTML5 Web OS Kernel.
 * Singleton controller that manages the <nt-taskbar> custom element.
 *
 * 【对接内核】Listens to WindowManager events to sync window buttons.
 * 【对接内核】Queries ProcessManager and SysCallBridge for system tray info.
 */

import WindowManager, { WindowState, WindowInfo } from '../../subsystem/window-manager/WindowManager.Core.js';
import SysCallBridge from '../../kernel/syscall/SysCall.Bridge.js';
import ProcessManager from '../../kernel/executor/ProcessManager.js';

let _instance: TaskbarController | null = null;

export class TaskbarController {
  private taskbarElement: HTMLElement | null = null;
  private clockInterval: ReturnType<typeof setInterval> | null = null;
  private initialized: boolean = false;

  private boundOnWindowCreated: ((data: any) => void) | null = null;
  private boundOnWindowDestroyed: ((data: any) => void) | null = null;
  private boundOnWindowFocused: ((data: any) => void) | null = null;
  private boundOnWindowStateChanged: ((data: any) => void) | null = null;
  private boundOnWindowMoved: ((data: any) => void) | null = null;

  static get instance(): TaskbarController {
    if (!_instance) {
      _instance = new TaskbarController();
    }
    return _instance;
  }

  private constructor() {}

  /**
   * Initialize the taskbar controller.
   * Finds or creates the <nt-taskbar> element and binds to DOM and kernel events.
   */
  init(): void {
    if (this.initialized) return;

    // Find existing taskbar element or create one
    this.taskbarElement = document.querySelector('nt-taskbar');
    if (!this.taskbarElement) {
      this.taskbarElement = document.createElement('nt-taskbar');
      document.body.appendChild(this.taskbarElement);
    }

    this._bindWindowManagerEvents();
    this._syncInitialWindowList();
    this.startClock();
    this.initialized = true;
  }

  /**
   * Destroy the taskbar controller, removing all listeners.
   */
  destroy(): void {
    this.stopClock();
    this._unbindWindowManagerEvents();
    if (this.taskbarElement) {
      this.taskbarElement.remove();
      this.taskbarElement = null;
    }
    this.initialized = false;
  }

  /* ── Window Manager Event Binding ── */

  private _bindWindowManagerEvents(): void {
    const wm = WindowManager.instance;

    this.boundOnWindowCreated = (data: any) => {
      if (data?.window) {
        this.addWindowButton(data.window);
      }
    };

    this.boundOnWindowDestroyed = (data: any) => {
      if (data?.windowId) {
        this.removeWindowButton(data.windowId);
      }
    };

    this.boundOnWindowFocused = (data: any) => {
      if (data?.window) {
        this.updateWindowButton(data.windowId, data.window);
      }
    };

    this.boundOnWindowStateChanged = (data: any) => {
      if (data?.window) {
        this.updateWindowButton(data.windowId, data.window);
      }
    };

    this.boundOnWindowMoved = (data: any) => {
      // Window position change — no taskbar button update needed
    };

    wm.on('window-created', this.boundOnWindowCreated);
    wm.on('window-destroyed', this.boundOnWindowDestroyed);
    wm.on('window-focused', this.boundOnWindowFocused);
    wm.on('window-state-changed', this.boundOnWindowStateChanged);
    wm.on('window-moved', this.boundOnWindowMoved);
  }

  private _unbindWindowManagerEvents(): void {
    const wm = WindowManager.instance;
    if (this.boundOnWindowCreated) wm.off('window-created', this.boundOnWindowCreated);
    if (this.boundOnWindowDestroyed) wm.off('window-destroyed', this.boundOnWindowDestroyed);
    if (this.boundOnWindowFocused) wm.off('window-focused', this.boundOnWindowFocused);
    if (this.boundOnWindowStateChanged) wm.off('window-state-changed', this.boundOnWindowStateChanged);
    if (this.boundOnWindowMoved) wm.off('window-moved', this.boundOnWindowMoved);
  }

  private _syncInitialWindowList(): void {
    const wm = WindowManager.instance;
    const windows = wm.getWindowList();
    for (const win of windows) {
      this.addWindowButton(win);
    }
  }

  /* ── Window Button Management ── */

  /**
   * Sync the entire window button list with the current WindowManager state.
   */
  updateWindowList(): void {
    if (!this.taskbarElement) return;

    const wm = WindowManager.instance;
    const windows = wm.getWindowList();

    // Get current button IDs
    const currentIds = new Set<string>();
    if ((this.taskbarElement as any)._windowButtons) {
      for (const id of (this.taskbarElement as any)._windowButtons.keys()) {
        currentIds.add(id);
      }
    }

    // Add missing windows
    const activeIds = new Set<string>();
    for (const win of windows) {
      activeIds.add(win.id);
      if (!currentIds.has(win.id)) {
        this.addWindowButton(win);
      } else {
        this.updateWindowButton(win.id, win);
      }
    }

    // Remove buttons for windows that no longer exist
    for (const id of currentIds) {
      if (!activeIds.has(id)) {
        this.removeWindowButton(id);
      }
    }
  }

  /**
   * Add a taskbar button for a window.
   */
  addWindowButton(windowInfo: WindowInfo): void {
    if (!this.taskbarElement) return;
    if (typeof (this.taskbarElement as any).addWindowButton === 'function') {
      (this.taskbarElement as any).addWindowButton(windowInfo);
    }
  }

  /**
   * Remove a taskbar button by window ID.
   */
  removeWindowButton(windowId: string): void {
    if (!this.taskbarElement) return;
    if (typeof (this.taskbarElement as any).removeWindowButton === 'function') {
      (this.taskbarElement as any).removeWindowButton(windowId);
    }
  }

  /**
   * Update the state of a taskbar button.
   */
  updateWindowButton(windowId: string, info: WindowInfo): void {
    if (!this.taskbarElement) return;
    if (typeof (this.taskbarElement as any).updateWindowButton === 'function') {
      (this.taskbarElement as any).updateWindowButton(windowId, info);
    }
  }

  /* ── Start Menu ── */

  /**
   * Toggle the start menu visibility.
   */
  toggleStartMenu(): void {
    if (!this.taskbarElement) return;
    if (typeof (this.taskbarElement as any).toggleStartMenu === 'function') {
      (this.taskbarElement as any).toggleStartMenu();
    }
  }

  /* ── Clock ── */

  /**
   * Start the clock update interval (1-second tick).
   */
  startClock(): void {
    if (this.clockInterval) return;
    this.clockInterval = setInterval(() => {
      this._tick();
    }, 1000);
    this._tick();
  }

  /**
   * Stop the clock update interval.
   */
  stopClock(): void {
    if (this.clockInterval) {
      clearInterval(this.clockInterval);
      this.clockInterval = null;
    }
  }

  private _tick(): void {
    // The clock update is handled internally by the <nt-taskbar> custom element.
    // This method is a hook for any controller-level clock processing.
  }

  /**
   * Format a Date as HH:MM string.
   */
  formatTime(date: Date): string {
    const h = String(date.getHours()).padStart(2, '0');
    const m = String(date.getMinutes()).padStart(2, '0');
    return `${h}:${m}`;
  }

  /**
   * Format a Date as "Weekday, Month Day, Year" string.
   */
  formatDate(date: Date): string {
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const months = [
      'January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December',
    ];
    return `${days[date.getDay()]}, ${months[date.getMonth()]} ${date.getDate()}, ${date.getFullYear()}`;
  }

  /* ── 【对接内核】System Tray Status Queries ── */

  /**
   * Query ProcessManager for system tray status information.
   */
  async getSystemTrayStatus(): Promise<{
    processCount: number;
    runningCount: number;
    networkConnected: boolean;
    systemUptime: number;
  }> {
    const pm = ProcessManager.instance;
    const processes = pm.getProcessList();
    const runningCount = processes.filter((p) => p.state === 'RUNNING').length;

    let networkConnected = true;
    let systemUptime = 0;

    try {
      const sysInfo = await SysCallBridge.instance.call('NtGetSystemInfo');
      networkConnected = true;
      systemUptime = sysInfo?.uptime || 0;
    } catch {
      // Fallback: assume connected
    }

    return {
      processCount: processes.length,
      runningCount,
      networkConnected,
      systemUptime,
    };
  }

  /**
   * Get the taskbar DOM element.
   */
  getElement(): HTMLElement | null {
    return this.taskbarElement;
  }
}

export default TaskbarController;