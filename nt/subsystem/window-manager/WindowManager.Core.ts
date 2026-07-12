/**
 * WindowManager - Window management core for the WebNT-HTML5 Web OS Kernel.
 */

export enum WindowState {
  NORMAL = 'NORMAL',
  MINIMIZED = 'MINIMIZED',
  MAXIMIZED = 'MAXIMIZED',
  FULLSCREEN = 'FULLSCREEN',
  HIDDEN = 'HIDDEN',
}

export interface WindowOptions {
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

export interface WindowInfo {
  id: string;
  title: string;
  width: number;
  height: number;
  x: number;
  y: number;
  icon: string;
  state: WindowState;
  zIndex: number;
  resizable: boolean;
  minimizable: boolean;
  maximizable: boolean;
  closable: boolean;
  appId: string;
  sandboxId: string;
  focused: boolean;
  createdAt: number;
  layerId: string | null;
}

type EventCallback = (...args: any[]) => void;

interface InternalWindow extends WindowInfo {
  previousState: WindowState | null;
  previousBounds: { x: number; y: number; width: number; height: number } | null;
}

let _instance: WindowManager | null = null;

export class WindowManager {
  private windows: Map<string, InternalWindow> = new Map();
  private windowOrder: string[] = [];
  private focusedWindowId: string | null = null;
  private idCounter: number = 0;
  private eventHandlers: Map<string, Set<EventCallback>> = new Map();
  private zIndexCounter: number = 100;

  static get instance(): WindowManager {
    if (!_instance) {
      _instance = new WindowManager();
    }
    return _instance;
  }

  private constructor() {}

  private generateId(): string {
    this.idCounter++;
    return `win_${Date.now()}_${this.idCounter}`;
  }

  createWindow(options: WindowOptions): string {
    const id = this.generateId();
    const x = options.x ?? 100 + (this.windows.size * 30) % 600;
    const y = options.y ?? 80 + (this.windows.size * 30) % 400;

    const window: InternalWindow = {
      id,
      title: options.title,
      width: options.width,
      height: options.height,
      x,
      y,
      icon: options.icon ?? '',
      state: WindowState.NORMAL,
      zIndex: this.zIndexCounter++,
      resizable: options.resizable ?? true,
      minimizable: options.minimizable ?? true,
      maximizable: options.maximizable ?? true,
      closable: options.closable ?? true,
      appId: options.appId ?? '',
      sandboxId: options.sandboxId ?? '',
      focused: false,
      createdAt: Date.now(),
      layerId: null,
      previousState: null,
      previousBounds: null,
    };

    this.windows.set(id, window);
    this.windowOrder.push(id);
    this.setFocus(id);
    this.emit('window-created', { windowId: id, window: this.getWindowInfo(id) });
    return id;
  }

  destroyWindow(windowId: string): void {
    const window = this.windows.get(windowId);
    if (!window) {
      console.warn(`WindowManager: Window ${windowId} not found`);
      return;
    }
    if (this.focusedWindowId === windowId) {
      this.focusedWindowId = null;
    }
    this.windows.delete(windowId);
    this.windowOrder = this.windowOrder.filter((id) => id !== windowId);

    if (this.focusedWindowId === null && this.windowOrder.length > 0) {
      this.setFocus(this.windowOrder[this.windowOrder.length - 1]);
    }

    this.emit('window-destroyed', { windowId });
  }

  setWindowState(windowId: string, state: WindowState): void {
    const window = this.windows.get(windowId);
    if (!window) {
      console.warn(`WindowManager: Window ${windowId} not found`);
      return;
    }
    const previousState = window.state;

    switch (state) {
      case WindowState.MINIMIZED:
        if (previousState !== WindowState.MINIMIZED) {
          window.previousState = previousState;
          window.previousBounds = {
            x: window.x,
            y: window.y,
            width: window.width,
            height: window.height,
          };
        }
        break;
      case WindowState.MAXIMIZED:
        if (previousState !== WindowState.MAXIMIZED && previousState !== WindowState.FULLSCREEN) {
          window.previousBounds = {
            x: window.x,
            y: window.y,
            width: window.width,
            height: window.height,
          };
        }
        break;
      case WindowState.FULLSCREEN:
        if (previousState !== WindowState.FULLSCREEN) {
          window.previousBounds = {
            x: window.x,
            y: window.y,
            width: window.width,
            height: window.height,
          };
        }
        break;
      case WindowState.NORMAL:
        if (window.previousBounds) {
          window.x = window.previousBounds.x;
          window.y = window.previousBounds.y;
          window.width = window.previousBounds.width;
          window.height = window.previousBounds.height;
          window.previousBounds = null;
        }
        break;
      case WindowState.HIDDEN:
        break;
    }

    window.state = state;
    this.emit('window-state-changed', {
      windowId,
      previousState,
      newState: state,
      window: this.getWindowInfo(windowId),
    });
  }

  setWindowPosition(windowId: string, x: number, y: number): void {
    const window = this.windows.get(windowId);
    if (!window) {
      console.warn(`WindowManager: Window ${windowId} not found`);
      return;
    }
    const prevX = window.x;
    const prevY = window.y;
    window.x = x;
    window.y = y;
    this.emit('window-moved', { windowId, x, y, prevX, prevY });
  }

  setWindowSize(windowId: string, width: number, height: number): void {
    const window = this.windows.get(windowId);
    if (!window) {
      console.warn(`WindowManager: Window ${windowId} not found`);
      return;
    }
    const prevWidth = window.width;
    const prevHeight = window.height;
    window.width = Math.max(100, width);
    window.height = Math.max(50, height);
    this.emit('window-resized', {
      windowId,
      width: window.width,
      height: window.height,
      prevWidth,
      prevHeight,
    });
  }

  bringToFront(windowId: string): void {
    const window = this.windows.get(windowId);
    if (!window) {
      console.warn(`WindowManager: Window ${windowId} not found`);
      return;
    }
    window.zIndex = this.zIndexCounter++;
    this.setFocus(windowId);
  }

  sendToBack(windowId: string): void {
    const window = this.windows.get(windowId);
    if (!window) {
      console.warn(`WindowManager: Window ${windowId} not found`);
      return;
    }
    let minZ = Infinity;
    for (const w of this.windows.values()) {
      if (w.zIndex < minZ) minZ = w.zIndex;
    }
    window.zIndex = isFinite(minZ) ? minZ - 1 : 0;
  }

  setFocus(windowId: string): void {
    const window = this.windows.get(windowId);
    if (!window) {
      console.warn(`WindowManager: Window ${windowId} not found`);
      return;
    }

    if (this.focusedWindowId && this.focusedWindowId !== windowId) {
      const prevFocused = this.windows.get(this.focusedWindowId);
      if (prevFocused) {
        prevFocused.focused = false;
      }
    }

    this.focusedWindowId = windowId;
    window.focused = true;
    this.emit('window-focused', { windowId, window: this.getWindowInfo(windowId) });
  }

  getFocusedWindow(): string | null {
    return this.focusedWindowId;
  }

  getWindowList(): WindowInfo[] {
    return [...this.windows.values()].map((w) => this.getWindowInfo(w.id));
  }

  getWindowInfo(windowId: string): WindowInfo | null {
    const window = this.windows.get(windowId);
    if (!window) return null;
    return {
      id: window.id,
      title: window.title,
      width: window.width,
      height: window.height,
      x: window.x,
      y: window.y,
      icon: window.icon,
      state: window.state,
      zIndex: window.zIndex,
      resizable: window.resizable,
      minimizable: window.minimizable,
      maximizable: window.maximizable,
      closable: window.closable,
      appId: window.appId,
      sandboxId: window.sandboxId,
      focused: window.focused,
      createdAt: window.createdAt,
      layerId: window.layerId,
    };
  }

  minimizeAll(): void {
    for (const [id, window] of this.windows) {
      if (window.state === WindowState.NORMAL || window.state === WindowState.MAXIMIZED) {
        this.setWindowState(id, WindowState.MINIMIZED);
      }
    }
  }

  restoreAll(): void {
    for (const [id, window] of this.windows) {
      if (window.state === WindowState.MINIMIZED) {
        const restoreState = window.previousState ?? WindowState.NORMAL;
        this.setWindowState(id, restoreState);
      }
    }
  }

  setWindowLayerId(windowId: string, layerId: string): void {
    const window = this.windows.get(windowId);
    if (window) {
      window.layerId = layerId;
    }
  }

  on(event: string, callback: EventCallback): void {
    if (!this.eventHandlers.has(event)) {
      this.eventHandlers.set(event, new Set());
    }
    this.eventHandlers.get(event)!.add(callback);
  }

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
          console.error(`WindowManager: Error in event handler for "${event}":`, err);
        }
      }
    }
  }
}

export default WindowManager;