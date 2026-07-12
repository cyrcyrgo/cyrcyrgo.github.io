/**
 * AppContainer.ts — Sandbox application container for the WebNT-HTML5 Web OS Kernel.
 * Singleton that manages .wntapp application loading, lifecycle, and sandboxing.
 *
 * 【对接内核】Sandbox creation via SandboxIframeBridge.createSandbox()
 * 【对接内核】Sandbox policy via SandboxPolicy.getPolicy()
 * 【对接内核】Window creation via WindowManager
 * 【对接内核】All communication through SandboxIframeBridge
 */

import SandboxIframeBridge, { AppManifest, SandboxMessage, MessageType } from '../../subsystem/app-sandbox/SandboxIframe.Bridge.js';
import SandboxPolicy, { PolicyLevel } from '../../subsystem/app-sandbox/SandboxPolicy.js';
import WindowManager from '../../subsystem/window-manager/WindowManager.Core.js';

export enum AppLifecycleState {
  LOADING = 'loading',
  RUNNING = 'running',
  PAUSED = 'paused',
  STOPPED = 'stopped',
  ERROR = 'error',
}

export interface AppInfo {
  appId: string;
  manifest: AppManifest;
  sandboxId: string | null;
  state: AppLifecycleState;
  container: HTMLElement | null;
  windowId: string | null;
  loadedAt: number;
  error: string | null;
}

type AppMessageCallback = (message: SandboxMessage) => void;

let _instance: AppContainer | null = null;

export class AppContainer {
  private apps: Map<string, AppInfo> = new Map();
  private messageCallbacks: Map<string, Set<AppMessageCallback>> = new Map();
  private initialized: boolean = false;

  static get instance(): AppContainer {
    if (!_instance) {
      _instance = new AppContainer();
    }
    return _instance;
  }

  private constructor() {}

  /**
   * Initialize the app container.
   */
  init(): void {
    if (this.initialized) return;
    this.initialized = true;
  }

  /**
   * Load a .wntapp application.
   * 【对接内核】Creates sandbox via SandboxIframeBridge.createSandbox().
   * 【对接内核】Applies sandbox policy via SandboxPolicy.getPolicy().
   * @param appId - The application ID
   * @param manifest - The app manifest (reads manifest.json from the app package)
   * @param container - The DOM container for the app
   * @returns The app info
   */
  async loadApp(appId: string, manifest: AppManifest, container: HTMLElement): Promise<AppInfo> {
    // Check if already loaded
    if (this.apps.has(appId)) {
      const existing = this.apps.get(appId)!;
      if (existing.state === AppLifecycleState.RUNNING) {
        return existing;
      }
      // Clean up previous instance
      this.unloadApp(appId);
    }

    const appInfo: AppInfo = {
      appId,
      manifest,
      sandboxId: null,
      state: AppLifecycleState.LOADING,
      container,
      windowId: null,
      loadedAt: Date.now(),
      error: null,
    };

    this.apps.set(appId, appInfo);

    try {
      // 【对接内核】Get sandbox policy
      const policy = SandboxPolicy.instance;
      let policyLevel = PolicyLevel.STANDARD;

      // Determine policy level based on manifest permissions
      if (manifest.permissions) {
        if (manifest.permissions.includes('nt.process.spawn') || manifest.permissions.includes('nt.registry.write')) {
          policyLevel = PolicyLevel.TRUSTED;
        } else if (manifest.permissions.includes('nt.fs.delete') || manifest.permissions.includes('nt.clipboard.read')) {
          policyLevel = PolicyLevel.ELEVATED;
        }
      }

      const policyDef = policy.getPolicy(policyLevel);

      // 【对接内核】Create sandbox via SandboxIframeBridge
      const bridge = SandboxIframeBridge.instance;
      const { sandboxId } = bridge.createSandbox(appId, manifest, container);

      appInfo.sandboxId = sandboxId;

      // Listen for sandbox messages
      this._listenToSandbox(appId, sandboxId);

      // Create a window for the app
      const windowId = WindowManager.instance.createWindow({
        title: manifest.name,
        width: manifest.width ?? 800,
        height: manifest.height ?? 600,
        icon: manifest.icon ?? 'default',
        appId,
        sandboxId,
        resizable: true,
      });

      appInfo.windowId = windowId;
      appInfo.state = AppLifecycleState.RUNNING;

      // Send app initialization message
      this.sendToApp(appId, {
        type: MessageType.EVENT,
        method: 'nt.init',
        payload: {
          policy: {
            level: policyLevel,
            allowedAPIs: policyDef.allowedAPIs,
            cpuLimit: policyDef.cpuLimit,
            memoryLimit: policyDef.memoryLimit,
            networkAccess: policyDef.networkAccess,
            fileAccess: policyDef.fileAccess,
          },
          windowId,
          sandboxId,
        },
      });

      return appInfo;
    } catch (err: any) {
      appInfo.state = AppLifecycleState.ERROR;
      appInfo.error = err.message || 'Unknown error loading app';
      this._handleAppCrash(appId);
      throw err;
    }
  }

  /**
   * Unload and clean up an app.
   * @param appId - The application ID
   */
  unloadApp(appId: string): void {
    const appInfo = this.apps.get(appId);
    if (!appInfo) return;

    // Destroy sandbox
    if (appInfo.sandboxId) {
      SandboxIframeBridge.instance.destroySandbox(appInfo.sandboxId);
    }

    // Destroy window
    if (appInfo.windowId) {
      WindowManager.instance.destroyWindow(appInfo.windowId);
    }

    // Clean up message callbacks
    this.messageCallbacks.delete(appId);

    appInfo.state = AppLifecycleState.STOPPED;
    this.apps.delete(appId);
  }

  /**
   * Send a message to an app.
   * 【对接内核】All communication through SandboxIframeBridge.
   * @param appId - The application ID
   * @param message - The message to send (partial SandboxMessage)
   */
  sendToApp(appId: string, message: Partial<SandboxMessage>): void {
    const appInfo = this.apps.get(appId);
    if (!appInfo || !appInfo.sandboxId) {
      console.warn(`AppContainer: App ${appId} not loaded or has no sandbox`);
      return;
    }

    SandboxIframeBridge.instance.sendToSandbox(appInfo.sandboxId, message);
  }

  /**
   * Listen for messages from an app.
   * @param appId - The application ID
   * @param callback - Callback for received messages
   */
  onAppMessage(appId: string, callback: AppMessageCallback): void {
    if (!this.messageCallbacks.has(appId)) {
      this.messageCallbacks.set(appId, new Set());
    }
    this.messageCallbacks.get(appId)!.add(callback);
  }

  /**
   * Remove a message listener from an app.
   * @param appId - The application ID
   * @param callback - The callback to remove
   */
  offAppMessage(appId: string, callback: AppMessageCallback): void {
    const set = this.messageCallbacks.get(appId);
    if (set) {
      set.delete(callback);
    }
  }

  /**
   * Get all loaded apps.
   * @returns Array of app info objects
   */
  getLoadedApps(): AppInfo[] {
    return [...this.apps.values()].map((a) => ({ ...a }));
  }

  /**
   * Get info for a specific app.
   * @param appId - The application ID
   * @returns App info or null
   */
  getAppInfo(appId: string): AppInfo | null {
    const appInfo = this.apps.get(appId);
    return appInfo ? { ...appInfo } : null;
  }

  /**
   * Pause an app.
   * @param appId - The application ID
   */
  pauseApp(appId: string): void {
    const appInfo = this.apps.get(appId);
    if (!appInfo || appInfo.state !== AppLifecycleState.RUNNING) return;

    appInfo.state = AppLifecycleState.PAUSED;

    this.sendToApp(appId, {
      type: MessageType.EVENT,
      method: 'nt.lifecycle',
      payload: { state: 'paused' },
    });
  }

  /**
   * Resume a paused app.
   * @param appId - The application ID
   */
  resumeApp(appId: string): void {
    const appInfo = this.apps.get(appId);
    if (!appInfo || appInfo.state !== AppLifecycleState.PAUSED) return;

    appInfo.state = AppLifecycleState.RUNNING;

    this.sendToApp(appId, {
      type: MessageType.EVENT,
      method: 'nt.lifecycle',
      payload: { state: 'resumed' },
    });
  }

  /**
   * Stop an app gracefully.
   * @param appId - The application ID
   */
  stopApp(appId: string): void {
    const appInfo = this.apps.get(appId);
    if (!appInfo) return;

    this.sendToApp(appId, {
      type: MessageType.EVENT,
      method: 'nt.lifecycle',
      payload: { state: 'stopping' },
    });

    // Give the app a moment to clean up, then unload
    setTimeout(() => {
      this.unloadApp(appId);
    }, 500);
  }

  /* ── Private Methods ── */

  /**
   * Set up sandbox message listening for an app.
   */
  private _listenToSandbox(appId: string, sandboxId: string): void {
    const bridge = SandboxIframeBridge.instance;

    bridge.onSandboxMessage(sandboxId, (msg: SandboxMessage) => {
      // Handle error messages
      if (msg.type === MessageType.ERROR) {
        this._handleAppError(appId, msg.error || 'Unknown sandbox error');
        return;
      }

      // Forward to registered callbacks
      const callbacks = this.messageCallbacks.get(appId);
      if (callbacks) {
        for (const cb of callbacks) {
          try {
            cb(msg);
          } catch (err) {
            console.error(`AppContainer: Error in message callback for ${appId}:`, err);
          }
        }
      }
    });
  }

  /**
   * Handle an app error.
   */
  private _handleAppError(appId: string, error: string): void {
    const appInfo = this.apps.get(appId);
    if (!appInfo) return;

    console.error(`AppContainer: Error in app ${appId}:`, error);
    appInfo.error = error;

    if (appInfo.state === AppLifecycleState.LOADING) {
      appInfo.state = AppLifecycleState.ERROR;
      this._handleAppCrash(appId);
    }
  }

  /**
   * Handle app crash recovery.
   */
  private _handleAppCrash(appId: string): void {
    const appInfo = this.apps.get(appId);
    if (!appInfo) return;

    appInfo.state = AppLifecycleState.ERROR;

    // Attempt recovery: send crash notification
    this.sendToApp(appId, {
      type: MessageType.ERROR,
      error: 'App crashed. Please reload.',
    });

    // Dispatch crash event
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('app-crash', {
        detail: {
          appId,
          manifest: appInfo.manifest,
          error: appInfo.error,
        },
      }));
    }

    // Clean up after a delay
    setTimeout(() => {
      if (this.apps.has(appId) && this.apps.get(appId)!.state === AppLifecycleState.ERROR) {
        this.unloadApp(appId);
      }
    }, 5000);
  }

  /**
   * Destroy the app container, unloading all apps.
   */
  destroy(): void {
    for (const appId of this.apps.keys()) {
      this.unloadApp(appId);
    }
    this.apps.clear();
    this.messageCallbacks.clear();
    this.initialized = false;
  }
}

export default AppContainer;