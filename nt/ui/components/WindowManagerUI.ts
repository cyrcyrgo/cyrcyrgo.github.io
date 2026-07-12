/**
 * WindowManagerUI.ts — Window manager UI logic for the WebNT-HTML5 Web OS Kernel.
 * Singleton controller that manages <nt-window> custom elements.
 *
 * 【对接内核】Window creation/destruction via kernel WindowManager.createWindow() / destroyWindow()
 * 【对接内核】Focus management via WindowManager.setFocus() / bringToFront()
 * 【对接内核】Window state/position/size changes notify kernel WindowManager
 */

import WindowManager, { WindowState, WindowInfo } from '../../subsystem/window-manager/WindowManager.Core.js';

export interface WindowCreateOptions {
  windowId?: string;
  title: string;
  width: number;
  height: number;
  x?: number;
  y?: number;
  icon?: string;
  content?: string;
  resizable?: boolean;
  minimizable?: boolean;
  maximizable?: boolean;
  closable?: boolean;
  appId?: string;
  sandboxId?: string;
}

type EventCallback = (...args: any[]) => void;

let _instance: WindowManagerUI | null = null;

export class WindowManagerUI {
  private windowElements: Map<string, HTMLElement> = new Map();
  private zIndexCounter: number = 100;
  private eventHandlers: Map<string, Set<EventCallback>> = new Map();
  private initialized: boolean = false;

  private boundOnWindowCreated: ((data: any) => void) | null = null;
  private boundOnWindowDestroyed: ((data: any) => void) | null = null;
  private boundOnWindowFocused: ((data: any) => void) | null = null;
  private boundOnWindowStateChanged: ((data: any) => void) | null = null;

  static get instance(): WindowManagerUI {
    if (!_instance) {
      _instance = new WindowManagerUI();
    }
    return _instance;
  }

  private constructor() {}

  /**
   * Initialize the UI window manager.
   * Connects to the kernel WindowManager and listens for window events.
   * 【对接内核】Binds to WindowManager events.
   */
  init(): void {
    if (this.initialized) return;
    this.initialized = true;

    this._bindKernelEvents();
    this._syncExistingWindows();
  }

  /**
   * Destroy the UI window manager, removing all windows and listeners.
   */
  destroy(): void {
    this._unbindKernelEvents();

    // Remove all window elements
    for (const [id, el] of this.windowElements) {
      el.remove();
    }
    this.windowElements.clear();
    this.initialized = false;
  }

  /* ── Kernel Event Binding ── */

  private _bindKernelEvents(): void {
    const wm = WindowManager.instance;

    this.boundOnWindowCreated = (data: any) => {
      if (data?.window) {
        this._onKernelWindowCreated(data.window);
      }
    };
    this.boundOnWindowDestroyed = (data: any) => {
      if (data?.windowId) {
        this._onKernelWindowDestroyed(data.windowId);
      }
    };
    this.boundOnWindowFocused = (data: any) => {
      if (data?.windowId) {
        this._onKernelWindowFocused(data.windowId);
      }
    };
    this.boundOnWindowStateChanged = (data: any) => {
      if (data?.windowId && data?.newState) {
        this._onKernelWindowStateChanged(data.windowId, data.newState);
      }
    };

    wm.on('window-created', this.boundOnWindowCreated);
    wm.on('window-destroyed', this.boundOnWindowDestroyed);
    wm.on('window-focused', this.boundOnWindowFocused);
    wm.on('window-state-changed', this.boundOnWindowStateChanged);
  }

  private _unbindKernelEvents(): void {
    const wm = WindowManager.instance;
    if (this.boundOnWindowCreated) wm.off('window-created', this.boundOnWindowCreated);
    if (this.boundOnWindowDestroyed) wm.off('window-destroyed', this.boundOnWindowDestroyed);
    if (this.boundOnWindowFocused) wm.off('window-focused', this.boundOnWindowFocused);
    if (this.boundOnWindowStateChanged) wm.off('window-state-changed', this.boundOnWindowStateChanged);
  }

  private _syncExistingWindows(): void {
    const wm = WindowManager.instance;
    const windows = wm.getWindowList();
    for (const win of windows) {
      this._onKernelWindowCreated(win);
    }
  }

  private _onKernelWindowCreated(windowInfo: WindowInfo): void {
    if (this.windowElements.has(windowInfo.id)) return;

    this.createWindow({
      windowId: windowInfo.id,
      title: windowInfo.title,
      width: windowInfo.width,
      height: windowInfo.height,
      x: windowInfo.x,
      y: windowInfo.y,
      icon: windowInfo.icon,
      resizable: windowInfo.resizable,
      minimizable: windowInfo.minimizable,
      maximizable: windowInfo.maximizable,
      closable: windowInfo.closable,
      appId: windowInfo.appId,
      sandboxId: windowInfo.sandboxId,
    });
  }

  private _onKernelWindowDestroyed(windowId: string): void {
    const el = this.windowElements.get(windowId);
    if (el) {
      el.remove();
      this.windowElements.delete(windowId);
    }
  }

  private _onKernelWindowFocused(windowId: string): void {
    this.focusWindow(windowId);
  }

  private _onKernelWindowStateChanged(windowId: string, state: string): void {
    const el = this.windowElements.get(windowId);
    if (!el) return;

    switch (state) {
      case 'MINIMIZED':
        if (typeof (el as any).minimize === 'function') {
          (el as any).minimize();
        } else {
          el.classList.add('minimized');
        }
        break;
      case 'MAXIMIZED':
      case 'FULLSCREEN':
        if (typeof (el as any).maximize === 'function') {
          (el as any).maximize();
        } else {
          el.classList.add('maximized');
        }
        break;
      case 'NORMAL':
        if (typeof (el as any).restore === 'function') {
          (el as any).restore();
        } else {
          el.classList.remove('maximized', 'minimized');
        }
        break;
      case 'HIDDEN':
        el.style.display = 'none';
        break;
    }
  }

  /* ── Window Creation ── */

  /**
   * Create a new window element.
   * 【对接内核】Registers with kernel WindowManager.createWindow() if no windowId is provided.
   * @param options - Window creation options
   * @returns The window ID
   */
  createWindow(options: WindowCreateOptions): string {
    let windowId = options.windowId;

    if (!windowId) {
      // 【对接内核】Register with kernel WindowManager
      windowId = WindowManager.instance.createWindow({
        title: options.title,
        width: options.width,
        height: options.height,
        x: options.x,
        y: options.y,
        icon: options.icon,
        content: options.content,
        resizable: options.resizable,
        minimizable: options.minimizable,
        maximizable: options.maximizable,
        closable: options.closable,
        appId: options.appId,
        sandboxId: options.sandboxId,
      });
    }

    // Create the <nt-window> element
    const windowEl = document.createElement('nt-window') as HTMLElement;
    windowEl.setAttribute('data-window-id', windowId);

    // Set properties
    if (typeof (windowEl as any).windowId !== 'undefined') {
      (windowEl as any).windowId = windowId;
    }

    // Position and size
    const x = options.x ?? 100 + (this.windowElements.size * 30) % 600;
    const y = options.y ?? 80 + (this.windowElements.size * 30) % 400;

    windowEl.style.left = `${x}px`;
    windowEl.style.top = `${y}px`;
    windowEl.style.width = `${options.width}px`;
    windowEl.style.height = `${options.height}px`;
    windowEl.style.zIndex = String(this.zIndexCounter++);

    // Set title and icon
    if (typeof (windowEl as any).setTitle === 'function') {
      (windowEl as any).setTitle(options.title);
    }
    if (options.icon && typeof (windowEl as any).setIcon === 'function') {
      (windowEl as any).setIcon(options.icon);
    }

    // Set window control visibility
    if (typeof (windowEl as any).setResizable === 'function') {
      (windowEl as any).setResizable(options.resizable ?? true);
    }
    if (typeof (windowEl as any).setMinimizable === 'function') {
      (windowEl as any).setMinimizable(options.minimizable ?? true);
    }
    if (typeof (windowEl as any).setMaximizable === 'function') {
      (windowEl as any).setMaximizable(options.maximizable ?? true);
    }
    if (typeof (windowEl as any).setClosable === 'function') {
      (windowEl as any).setClosable(options.closable ?? true);
    }

    // Add content if provided
    if (options.content) {
      const contentEl = typeof options.content === 'string'
        ? (() => { const div = document.createElement('div'); div.innerHTML = options.content; return div; })()
        : options.content;
      windowEl.appendChild(contentEl as Node);
    }

    // Listen for window close event
    windowEl.addEventListener('window-close', (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.windowId) {
        this.destroyWindow(detail.windowId);
      }
    });

    // Append to body
    document.body.appendChild(windowEl);

    this.windowElements.set(windowId, windowEl);

    // Focus the new window
    this.focusWindow(windowId);

    this.emit('window-created', { windowId, options });
    return windowId;
  }

  /**
   * Remove a window.
   * 【对接内核】Calls WindowManager.destroyWindow().
   * @param windowId - The window ID to destroy
   */
  destroyWindow(windowId: string): void {
    const el = this.windowElements.get(windowId);
    if (el) {
      el.remove();
      this.windowElements.delete(windowId);
    }

    // 【对接内核】Notify kernel
    WindowManager.instance.destroyWindow(windowId);

    this.emit('window-destroyed', { windowId });
  }

  /**
   * Focus a window and bring it to front.
   * 【对接内核】Calls WindowManager.setFocus() and WindowManager.bringToFront().
   * @param windowId - The window ID to focus
   */
  focusWindow(windowId: string): void {
    const el = this.windowElements.get(windowId);
    if (!el) return;

    // Blur all other windows
    for (const [id, otherEl] of this.windowElements) {
      if (id !== windowId) {
        if (typeof (otherEl as any).blur === 'function') {
          (otherEl as any).blur();
        } else {
          otherEl.classList.remove('focused');
        }
      }
    }

    // Bring to front
    el.style.zIndex = String(this.zIndexCounter++);

    // Focus
    if (typeof (el as any).blur === 'function') {
      // Toggle to ensure focus class is set
    }
    el.classList.add('focused');

    // 【对接内核】Notify kernel
    const wm = WindowManager.instance;
    wm.bringToFront(windowId);
    wm.setFocus(windowId);

    this.emit('window-focused', { windowId });
  }

  /**
   * Minimize a window.
   * @param windowId - The window ID
   */
  minimizeWindow(windowId: string): void {
    const el = this.windowElements.get(windowId);
    if (!el) return;

    if (typeof (el as any).minimize === 'function') {
      (el as any).minimize();
    } else {
      el.classList.add('minimized');
    }

    WindowManager.instance.setWindowState(windowId, WindowState.MINIMIZED);
    this.emit('window-minimized', { windowId });
  }

  /**
   * Maximize or restore a window.
   * @param windowId - The window ID
   */
  maximizeWindow(windowId: string): void {
    const el = this.windowElements.get(windowId);
    if (!el) return;

    if (typeof (el as any).toggleMaximize === 'function') {
      (el as any).toggleMaximize();
    } else {
      if (el.classList.contains('maximized')) {
        el.classList.remove('maximized');
        WindowManager.instance.setWindowState(windowId, WindowState.NORMAL);
      } else {
        el.classList.add('maximized');
        WindowManager.instance.setWindowState(windowId, WindowState.MAXIMIZED);
      }
    }

    this.emit('window-maximized', { windowId });
  }

  /**
   * Close a window.
   * @param windowId - The window ID
   */
  closeWindow(windowId: string): void {
    const el = this.windowElements.get(windowId);
    if (!el) return;

    if (typeof (el as any).close === 'function') {
      (el as any).close();
    } else {
      this.destroyWindow(windowId);
    }

    this.emit('window-closed', { windowId });
  }

  /**
   * Get the DOM element for a window.
   * @param windowId - The window ID
   * @returns The window element or null
   */
  getWindowElement(windowId: string): HTMLElement | null {
    return this.windowElements.get(windowId) ?? null;
  }

  /**
   * Get all window IDs.
   * @returns Array of window IDs
   */
  getAllWindows(): string[] {
    return [...this.windowElements.keys()];
  }

  /**
   * Arrange all windows in a cascade.
   */
  cascadeWindows(): void {
    const windows = [...this.windowElements.entries()];
    let offsetX = 0;
    let offsetY = 0;

    for (const [id, el] of windows) {
      el.style.left = `${30 + offsetX}px`;
      el.style.top = `${30 + offsetY}px`;
      el.style.zIndex = String(this.zIndexCounter++);
      offsetX += 30;
      offsetY += 30;

      if (offsetX > 600) {
        offsetX = 0;
        offsetY = 30;
      }
    }

    this.emit('windows-cascaded', { count: windows.length });
  }

  /**
   * Tile all windows side by side.
   */
  tileWindows(): void {
    const windows = [...this.windowElements.entries()];
    if (windows.length === 0) return;

    const cols = Math.ceil(Math.sqrt(windows.length));
    const rows = Math.ceil(windows.length / cols);
    const slotWidth = Math.floor(window.innerWidth / cols);
    const slotHeight = Math.floor((window.innerHeight - 48) / rows);

    for (let i = 0; i < windows.length; i++) {
      const [id, el] = windows[i];
      const col = i % cols;
      const row = Math.floor(i / cols);

      el.style.left = `${col * slotWidth}px`;
      el.style.top = `${row * slotHeight}px`;
      el.style.width = `${slotWidth - 4}px`;
      el.style.height = `${slotHeight - 4}px`;
      el.style.zIndex = String(this.zIndexCounter++);
    }

    this.emit('windows-tiled', { count: windows.length });
  }

  /* ── Event System ── */

  /**
   * Register an event listener.
   * @param event - Event name
   * @param callback - Callback function
   */
  on(event: string, callback: EventCallback): void {
    if (!this.eventHandlers.has(event)) {
      this.eventHandlers.set(event, new Set());
    }
    this.eventHandlers.get(event)!.add(callback);
  }

  /**
   * Remove an event listener.
   * @param event - Event name
   * @param callback - Callback function
   */
  off(event: string, callback: EventCallback): void {
    const handlers = this.eventHandlers.get(event);
    if (handlers) {
      handlers.delete(callback);
    }
  }

  private emit(event: string, data: any): void {
    const handlers = this.eventHandlers.get(event);
    if (handlers) {
      for (const handler of handlers) {
        try {
          handler(data);
        } catch (err) {
          console.error(`WindowManagerUI: Error in event handler for "${event}":`, err);
        }
      }
    }
  }
}

export default WindowManagerUI;