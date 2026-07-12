/**
 * UIMain.ts — UI main entry point for the WebNT-HTML5 Web OS Kernel.
 * Singleton that initializes the entire UI system in a specific order.
 *
 * 【对接内核】All initializations call kernel APIs.
 * Step 1: Initialize display system (GlobalDisplayAPI.initialize())
 * Step 2: Initialize kernel bridge (SysCallBridge)
 * Step 3: Register all Custom Elements
 * Step 4: Initialize WindowManagerUI
 * Step 5: Create desktop component (nt-desktop)
 * Step 6: Create taskbar component (nt-taskbar)
 * Step 7: Initialize TaskbarController
 * Step 8: Initialize SystemTray
 * Step 9: Create start menu (hidden by default)
 * Step 10: Start the system
 */

import GlobalDisplayAPI from '../subsystem/display-pipeline/GlobalDisplay.API.js';
import SysCallBridge from '../kernel/syscall/SysCall.Bridge.js';
import WindowManager from '../subsystem/window-manager/WindowManager.Core.js';
import WindowManagerUI from './components/WindowManagerUI.js';
import TaskbarController from './components/Taskbar.js';
import SystemTray from './components/SystemTray.js';
import TerminalUI from './components/TerminalUI.js';

export interface SystemStatus {
  display: boolean;
  kernelBridge: boolean;
  customElements: boolean;
  windowManagerUI: boolean;
  desktop: boolean;
  taskbar: boolean;
  taskbarController: boolean;
  systemTray: boolean;
  startMenu: boolean;
  started: boolean;
  overall: 'initializing' | 'running' | 'error' | 'shutdown';
  errors: string[];
}

let _instance: UIMain | null = null;

export class UIMain {
  private status: SystemStatus = {
    display: false,
    kernelBridge: false,
    customElements: false,
    windowManagerUI: false,
    desktop: false,
    taskbar: false,
    taskbarController: false,
    systemTray: false,
    startMenu: false,
    started: false,
    overall: 'initializing',
    errors: [],
  };

  private desktopElement: HTMLElement | null = null;
  private taskbarElement: HTMLElement | null = null;
  private startMenuElement: HTMLElement | null = null;
  private initialized: boolean = false;

  static get instance(): UIMain {
    if (!_instance) {
      _instance = new UIMain();
    }
    return _instance;
  }

  private constructor() {
    // Register global error handler
    if (typeof window !== 'undefined') {
      window.addEventListener('error', (event) => {
        this.handleError(event.error || new Error(event.message));
      });
      window.addEventListener('unhandledrejection', (event) => {
        this.handleError(event.reason || new Error('Unhandled Promise rejection'));
      });
    }
  }

  /**
   * Initialize the entire UI system.
   * Performs a 10-step initialization sequence.
   * 【对接内核】All initializations call kernel APIs.
   */
  async init(): Promise<void> {
    if (this.initialized) return;

    this.status.overall = 'initializing';
    this.status.errors = [];

    try {
      // Step 1: Initialize display system
      await this._step1_InitDisplay();
      this.status.display = true;
      console.log('[UIMain] Step 1/10: Display system initialized');

      // Step 2: Initialize kernel bridge
      await this._step2_InitKernelBridge();
      this.status.kernelBridge = true;
      console.log('[UIMain] Step 2/10: Kernel bridge initialized');

      // Step 3: Register all Custom Elements
      await this._step3_RegisterCustomElements();
      this.status.customElements = true;
      console.log('[UIMain] Step 3/10: Custom elements registered');

      // Step 4: Initialize WindowManagerUI
      await this._step4_InitWindowManagerUI();
      this.status.windowManagerUI = true;
      console.log('[UIMain] Step 4/10: WindowManagerUI initialized');

      // Step 5: Create desktop component
      await this._step5_CreateDesktop();
      this.status.desktop = true;
      console.log('[UIMain] Step 5/10: Desktop created');

      // Step 6: Create taskbar component
      await this._step6_CreateTaskbar();
      this.status.taskbar = true;
      console.log('[UIMain] Step 6/10: Taskbar created');

      // Step 7: Initialize TaskbarController
      await this._step7_InitTaskbarController();
      this.status.taskbarController = true;
      console.log('[UIMain] Step 7/10: TaskbarController initialized');

      // Step 8: Initialize SystemTray
      await this._step8_InitSystemTray();
      this.status.systemTray = true;
      console.log('[UIMain] Step 8/10: SystemTray initialized');

      // Step 9: Create start menu
      await this._step9_CreateStartMenu();
      this.status.startMenu = true;
      console.log('[UIMain] Step 9/10: Start menu created');

      // Step 10: Start the system
      await this._step10_StartSystem();
      this.status.started = true;
      console.log('[UIMain] Step 10/10: System started');

      this.status.overall = 'running';
      this.initialized = true;

      console.log('[UIMain] WebNT-HTML5 UI system initialized successfully');
    } catch (err: any) {
      this.status.overall = 'error';
      this.status.errors.push(err.message || 'Unknown initialization error');
      console.error('[UIMain] Initialization failed:', err);
      this.handleError(err);
    }
  }

  /**
   * Step 1: Initialize display system.
   * 【对接内核】GlobalDisplayAPI.initialize()
   */
  private async _step1_InitDisplay(): Promise<void> {
    const display = GlobalDisplayAPI.instance;

    // Find or create a main canvas for the compositor
    let mainCanvas = document.getElementById('nt-main-canvas') as HTMLCanvasElement | null;
    if (!mainCanvas) {
      mainCanvas = document.createElement('canvas');
      mainCanvas.id = 'nt-main-canvas';
      mainCanvas.style.position = 'fixed';
      mainCanvas.style.top = '0';
      mainCanvas.style.left = '0';
      mainCanvas.style.width = '100%';
      mainCanvas.style.height = '100%';
      mainCanvas.style.pointerEvents = 'none';
      mainCanvas.style.zIndex = '0';
      document.body.insertBefore(mainCanvas, document.body.firstChild);
    }

    try {
      display.initialize(mainCanvas, {
        width: window.innerWidth,
        height: window.innerHeight,
        devicePixelRatio: window.devicePixelRatio || 1,
        debug: false,
      });
    } catch (err: any) {
      if (err.message && err.message.includes('Already initialized')) {
        // Already initialized, ignore
      } else {
        throw err;
      }
    }
  }

  /**
   * Step 2: Initialize kernel bridge.
   * 【对接内核】SysCallBridge
   */
  private async _step2_InitKernelBridge(): Promise<void> {
    // SysCallBridge is automatically initialized via its singleton constructor
    const bridge = SysCallBridge.instance;

    try {
      // Verify the bridge is working by making a test call
      const sysInfo = await bridge.call('NtGetSystemInfo');
      console.log('[UIMain] Kernel bridge verified. System info:', sysInfo?.os || 'WebNT-HTML5');
    } catch (err) {
      console.warn('[UIMain] Kernel bridge test call failed, but bridge is available:', err);
    }
  }

  /**
   * Step 3: Register all Custom Elements.
   * Registers: nt-desktop, nt-taskbar, nt-startmenu, nt-contextmenu, nt-terminal-window, nt-window
   */
  private async _step3_RegisterCustomElements(): Promise<void> {
    const elementsToRegister = [
      {
        name: 'nt-desktop',
        path: './components/Desktop.ce.html',
      },
      {
        name: 'nt-taskbar',
        path: './components/Taskbar.ce.html',
      },
      {
        name: 'nt-startmenu',
        path: './components/StartMenu.ce.html',
      },
      {
        name: 'nt-contextmenu',
        path: './components/ContextMenu.ce.html',
      },
      {
        name: 'nt-terminal-window',
        path: './components/TerminalWindow.ce.html',
      },
      {
        name: 'nt-window',
        path: './components/WindowElement.ce.html',
      },
    ];

    for (const el of elementsToRegister) {
      // Check if the custom element is already defined
      if (customElements.get(el.name)) {
        console.log(`[UIMain] Custom element <${el.name}> already registered`);
        continue;
      }

      try {
        // Dynamically import the HTML component file to trigger registration
        await import(el.path);
        console.log(`[UIMain] Custom element <${el.name}> registered`);
      } catch (err) {
        console.warn(`[UIMain] Failed to register <${el.name}>:`, err);
        // Continue with other registrations
      }
    }
  }

  /**
   * Step 4: Initialize WindowManagerUI.
   * 【对接内核】Connects to kernel WindowManager.
   */
  private async _step4_InitWindowManagerUI(): Promise<void> {
    WindowManagerUI.instance.init();
  }

  /**
   * Step 5: Create desktop component.
   * Creates the <nt-desktop> element and appends it to the body.
   */
  private async _step5_CreateDesktop(): Promise<void> {
    const desktop = document.createElement('nt-desktop');
    desktop.id = 'nt-desktop';
    desktop.style.position = 'fixed';
    desktop.style.top = '0';
    desktop.style.left = '0';
    desktop.style.width = '100%';
    desktop.style.height = 'calc(100% - var(--sys-taskbar-height, 48px))';
    desktop.style.zIndex = '1';

    document.body.appendChild(desktop);
    this.desktopElement = desktop;
  }

  /**
   * Step 6: Create taskbar component.
   * Creates the <nt-taskbar> element and appends it to the body.
   */
  private async _step6_CreateTaskbar(): Promise<void> {
    const taskbar = document.createElement('nt-taskbar');
    taskbar.id = 'nt-taskbar';

    document.body.appendChild(taskbar);
    this.taskbarElement = taskbar;
  }

  /**
   * Step 7: Initialize TaskbarController.
   * 【对接内核】Listens to WindowManager events.
   */
  private async _step7_InitTaskbarController(): Promise<void> {
    TaskbarController.instance.init();
  }

  /**
   * Step 8: Initialize SystemTray.
   * 【对接内核】Network status via SysCallBridge.
   */
  private async _step8_InitSystemTray(): Promise<void> {
    if (!this.taskbarElement) {
      throw new Error('Taskbar element not created yet. Step 6 must be completed before Step 8.');
    }

    const shadowRoot = (this.taskbarElement as any).shadowRoot;
    if (shadowRoot) {
      const trayContainer = shadowRoot.getElementById('taskbar-right');
      if (trayContainer) {
        SystemTray.instance.init(trayContainer);
      }
    }
  }

  /**
   * Step 9: Create start menu (hidden by default).
   */
  private async _step9_CreateStartMenu(): Promise<void> {
    const startMenu = document.createElement('nt-startmenu');
    startMenu.id = 'nt-startmenu';

    document.body.appendChild(startMenu);
    this.startMenuElement = startMenu;
  }

  /**
   * Step 10: Start the system.
   * Performs final startup tasks.
   */
  private async _step10_StartSystem(): Promise<void> {
    // Launch the initial terminal window
    try {
      TerminalUI.instance.init();
      console.log('[UIMain] Initial terminal window launched');
    } catch (err) {
      console.warn('[UIMain] Failed to launch initial terminal:', err);
    }

    // Dispatch system ready event
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('webnt-system-ready', {
        detail: {
          timestamp: Date.now(),
          version: '1.0.0',
        },
      }));
    }

    // Set system CSS variables
    document.documentElement.style.setProperty('--sys-taskbar-height', '48px');
    document.documentElement.style.setProperty('--sys-font-ui', "'Segoe UI', system-ui, sans-serif");
    document.documentElement.style.setProperty('--sys-font-size-sm', '12px');
    document.documentElement.style.setProperty('--sys-font-size-md', '14px');
    document.documentElement.style.setProperty('--sys-transition-fast', '100ms ease');
    document.documentElement.style.setProperty('--sys-transition-normal', '200ms ease');
    document.documentElement.style.setProperty('--sys-transition-slow', '350ms ease');
    document.documentElement.style.setProperty('--sys-accent', '#8ab4f8');
    document.documentElement.style.setProperty('--sys-warning', '#fdd663');
    document.documentElement.style.setProperty('--sys-danger', '#f28b82');
  }

  /**
   * Graceful shutdown sequence.
   * 【对接内核】Calls SysCallBridge for NtShutdown.
   */
  async shutdown(): Promise<void> {
    console.log('[UIMain] Shutting down...');

    try {
      await SysCallBridge.instance.call('NtShutdown');
    } catch (err) {
      console.warn('[UIMain] NtShutdown failed:', err);
    }

    this._cleanup();
    this.status.overall = 'shutdown';

    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('webnt-system-shutdown'));
    }
  }

  /**
   * System reboot.
   * 【对接内核】Calls SysCallBridge for NtReboot.
   */
  async reboot(): Promise<void> {
    console.log('[UIMain] Rebooting...');

    try {
      await SysCallBridge.instance.call('NtReboot');
    } catch (err) {
      console.warn('[UIMain] NtReboot failed:', err);
    }

    this._cleanup();

    // Re-initialize
    this.status = {
      display: false,
      kernelBridge: false,
      customElements: false,
      windowManagerUI: false,
      desktop: false,
      taskbar: false,
      taskbarController: false,
      systemTray: false,
      startMenu: false,
      started: false,
      overall: 'initializing',
      errors: [],
    };
    this.initialized = false;

    await this.init();
  }

  /**
   * Get the overall system status.
   * @returns SystemStatus object
   */
  getSystemStatus(): SystemStatus {
    return { ...this.status, errors: [...this.status.errors] };
  }

  /**
   * Global error handler.
   * @param error - The error to handle
   */
  handleError(error: Error): void {
    console.error('[UIMain] System error:', error);

    this.status.errors.push(error.message || 'Unknown error');

    // Keep only the last 50 errors
    if (this.status.errors.length > 50) {
      this.status.errors = this.status.errors.slice(-50);
    }

    // Dispatch error event
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('webnt-system-error', {
        detail: {
          message: error.message,
          stack: error.stack,
          timestamp: Date.now(),
        },
      }));
    }
  }

  /**
   * Get the desktop element.
   * @returns The desktop element or null
   */
  getDesktopElement(): HTMLElement | null {
    return this.desktopElement;
  }

  /**
   * Get the taskbar element.
   * @returns The taskbar element or null
   */
  getTaskbarElement(): HTMLElement | null {
    return this.taskbarElement;
  }

  /**
   * Get the start menu element.
   * @returns The start menu element or null
   */
  getStartMenuElement(): HTMLElement | null {
    return this.startMenuElement;
  }

  /**
   * Clean up all UI elements and resources.
   */
  private _cleanup(): void {
    // Destroy WindowManagerUI
    try {
      WindowManagerUI.instance.destroy();
    } catch (err) {
      console.warn('[UIMain] Error destroying WindowManagerUI:', err);
    }

    // Destroy TaskbarController
    try {
      TaskbarController.instance.destroy();
    } catch (err) {
      console.warn('[UIMain] Error destroying TaskbarController:', err);
    }

    // Destroy SystemTray
    try {
      SystemTray.instance.destroy();
    } catch (err) {
      console.warn('[UIMain] Error destroying SystemTray:', err);
    }

    // Remove desktop element
    if (this.desktopElement) {
      this.desktopElement.remove();
      this.desktopElement = null;
    }

    // Remove taskbar element
    if (this.taskbarElement) {
      this.taskbarElement.remove();
      this.taskbarElement = null;
    }

    // Remove start menu element
    if (this.startMenuElement) {
      this.startMenuElement.remove();
      this.startMenuElement = null;
    }
  }
}

export default UIMain;