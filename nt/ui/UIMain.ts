/**
 * UIMain.ts — UI 主入口，WebNT-HTML5 Web OS 图形界面层初始化。
 * 单例模式，负责创建桌面、任务栏、开始菜单等所有 UI 组件。
 *
 * 【对接内核】通过 window.__WebNT__ 访问内核模块（由 index.html 启动流程注入）
 *   - __WebNT__.GlobalDisplayAPI  → 统一显示管线
 *   - __WebNT__.WindowManager     → 窗口管理器
 *   - __WebNT__.SysCallBridge     → 系统调用桥
 *   - __WebNT__.ProcessManager    → 进程管理器
 */

export interface SystemStatus {
  overall: 'initializing' | 'running' | 'error' | 'shutdown';
  steps: Record<string, boolean>;
  errors: string[];
}

let _instance: UIMain | null = null;

export class UIMain {
  private status: SystemStatus = {
    overall: 'initializing',
    steps: {},
    errors: [],
  };

  private appRoot: HTMLElement | null = null;
  private desktopElement: HTMLElement | null = null;
  private taskbarElement: HTMLElement | null = null;
  private startMenuElement: HTMLElement | null = null;
  private initialized: boolean = false;

  // 内核模块引用（从 window.__WebNT__ 获取）
  private get GlobalDisplayAPI(): any {
    return (window as any).__WebNT__?.GlobalDisplayAPI;
  }
  private get WindowManager(): any {
    return (window as any).__WebNT__?.WindowManager;
  }
  private get SysCallBridge(): any {
    return (window as any).__WebNT__?.SysCallBridge;
  }
  private get ProcessManager(): any {
    return (window as any).__WebNT__?.ProcessManager;
  }

  static get instance(): UIMain {
    if (!_instance) {
      _instance = new UIMain();
    }
    return _instance;
  }

  private constructor() {
    // 全局错误处理
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
   * 【由 index.html 启动流程调用】设置 appRoot 容器引用
   * @param root - 主应用容器 DOM 元素
   */
  setAppRoot(root: HTMLElement): void {
    this.appRoot = root;
  }

  /**
   * 初始化整个 UI 系统（10 步序列）
   * 【对接内核】所有初始化通过 window.__WebNT__ 调用内核 API
   */
  async init(): Promise<void> {
    if (this.initialized) return;
    if (!this.appRoot) {
      throw new Error('UIMain: appRoot not set. Call setAppRoot() before init().');
    }

    this.status.overall = 'initializing';
    this.status.errors = [];
    const steps = this.status.steps;

    try {
      // Step 1: 确保内核模块已就绪
      this._ensureKernelReady();
      steps['kernel'] = true;
      console.log('[UIMain] Step 1/10: Kernel modules verified');

      // Step 2: 确保 Custom Elements 已注册（由启动画面注册）
      this._ensureElementsRegistered();
      steps['elements'] = true;
      console.log('[UIMain] Step 2/10: Custom Elements verified');

      // Step 3: 创建桌面主画布
      await this._createDesktop();
      steps['desktop'] = true;
      console.log('[UIMain] Step 3/10: Desktop created');

      // Step 4: 创建任务栏
      await this._createTaskbar();
      steps['taskbar'] = true;
      console.log('[UIMain] Step 4/10: Taskbar created');

      // Step 5: 初始化任务栏控制器
      await this._initTaskbarController();
      steps['taskbarController'] = true;
      console.log('[UIMain] Step 5/10: TaskbarController initialized');

      // Step 6: 初始化系统托盘
      await this._initSystemTray();
      steps['systemTray'] = true;
      console.log('[UIMain] Step 6/10: SystemTray initialized');

      // Step 7: 创建开始菜单（默认隐藏）
      await this._createStartMenu();
      steps['startMenu'] = true;
      console.log('[UIMain] Step 7/10: Start menu created');

      // Step 8: 设置 CSS 变量
      this._applySystemTheme();
      steps['theme'] = true;
      console.log('[UIMain] Step 8/10: System theme applied');

      // Step 9: 启动终端窗口
      await this._launchTerminal();
      steps['terminal'] = true;
      console.log('[UIMain] Step 9/10: Terminal launched');

      // Step 10: 完成
      this.status.overall = 'running';
      this.initialized = true;
      steps['started'] = true;
      console.log('[UIMain] Step 10/10: System started');
      console.log('[UIMain] WebNT-HTML5 UI system initialized successfully');

    } catch (err: any) {
      this.status.overall = 'error';
      this.status.errors.push(err.message || 'Unknown error');
      console.error('[UIMain] Initialization failed:', err);
      this.handleError(err);
    }
  }

  // ===== Step 1: 确保内核模块已就绪 =====
  private _ensureKernelReady(): void {
    const wnt = (window as any).__WebNT__;
    if (!wnt) {
      throw new Error(
        'Kernel modules not loaded. window.__WebNT__ is undefined. ' +
        'Ensure the boot sequence in index.html completed Phase 2.'
      );
    }
    if (!wnt.GlobalDisplayAPI?.instance) {
      throw new Error('GlobalDisplayAPI not available');
    }
    if (!wnt.WindowManager?.instance) {
      throw new Error('WindowManager not available');
    }
    if (!wnt.SysCallBridge?.instance) {
      throw new Error('SysCallBridge not available');
    }
  }

  // ===== Step 2: 确保 Custom Elements 已注册 =====
  private _ensureElementsRegistered(): void {
    const required = [
      'nt-desktop',
      'nt-taskbar',
      'nt-startmenu',
      'nt-contextmenu',
      'nt-terminal-window',
      'nt-window',
    ];
    for (const name of required) {
      if (!customElements.get(name)) {
        console.warn(`[UIMain] Custom Element <${name}> not yet registered. ` +
          `The boot screen should have registered it.`);
      }
    }
  }

  // ===== Step 3: 创建桌面主画布 =====
  private async _createDesktop(): Promise<void> {
    // 使用 GlobalDisplayAPI 创建桌面图层
    const display = this.GlobalDisplayAPI.instance;
    if (display && display.initialized) {
      // 创建桌面背景图层
      try {
        display.createLayer(1, 'desktop', // layerTypes.DESKTOP = 1
          window.innerWidth,
          window.innerHeight
        );
      } catch (e) { /* layer may already exist */ }
    }

    // 创建桌面 Custom Element
    const desktop = document.createElement('nt-desktop');
    desktop.id = 'nt-desktop';
    desktop.style.cssText = `
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: calc(100% - var(--sys-taskbar-height, 48px));
      z-index: 1;
      overflow: hidden;
    `;

    this.appRoot!.appendChild(desktop);
    this.desktopElement = desktop;
  }

  // ===== Step 4: 创建任务栏 =====
  private async _createTaskbar(): Promise<void> {
    const taskbar = document.createElement('nt-taskbar');
    taskbar.id = 'nt-taskbar';
    taskbar.style.cssText = `
      position: absolute;
      bottom: 0;
      left: 0;
      width: 100%;
      z-index: 1000;
    `;

    this.appRoot!.appendChild(taskbar);
    this.taskbarElement = taskbar;
  }

  // ===== Step 5: 初始化任务栏控制器 =====
  private async _initTaskbarController(): Promise<void> {
    // 任务栏控制器逻辑内联，避免 .ts 文件导入问题
    const taskbar = this.taskbarElement;
    if (!taskbar) return;

    const wm = this.WindowManager?.instance;
    if (!wm) return;

    // 监听窗口事件，同步任务栏窗口按钮
    try {
      wm.on('window-created', (info: any) => {
        taskbar.dispatchEvent(new CustomEvent('window-created', { detail: info }));
      });
      wm.on('window-destroyed', (info: any) => {
        taskbar.dispatchEvent(new CustomEvent('window-destroyed', { detail: info }));
      });
      wm.on('window-focused', (info: any) => {
        taskbar.dispatchEvent(new CustomEvent('window-focused', { detail: info }));
      });
      wm.on('window-state-changed', (info: any) => {
        taskbar.dispatchEvent(new CustomEvent('window-state-changed', { detail: info }));
      });
    } catch (e) {
      console.warn('[UIMain] WindowManager event binding failed:', e);
    }
  }

  // ===== Step 6: 初始化系统托盘 =====
  private async _initSystemTray(): Promise<void> {
    const taskbar = this.taskbarElement;
    if (!taskbar) return;

    // 等待 Shadow DOM 就绪后初始化时钟
    const initTray = () => {
      const shadow = (taskbar as any).shadowRoot;
      if (!shadow) {
        setTimeout(initTray, 100);
        return;
      }
      const trayContainer = shadow.getElementById('taskbar-right');
      if (!trayContainer) {
        setTimeout(initTray, 100);
        return;
      }

      // 时钟更新
      const updateClock = () => {
        const clockEl = shadow.querySelector('.taskbar-clock');
        if (clockEl) {
          const now = new Date();
          const hours = String(now.getHours()).padStart(2, '0');
          const mins = String(now.getMinutes()).padStart(2, '0');
          clockEl.textContent = `${hours}:${mins}`;
        }
      };
      updateClock();
      setInterval(updateClock, 1000);
    };
    initTray();
  }

  // ===== Step 7: 创建开始菜单（默认隐藏） =====
  private async _createStartMenu(): Promise<void> {
    const startMenu = document.createElement('nt-startmenu');
    startMenu.id = 'nt-startmenu';
    startMenu.style.cssText = `
      position: absolute;
      bottom: var(--sys-taskbar-height, 48px);
      left: 8px;
      z-index: 2000;
      display: none;
    `;

    this.appRoot!.appendChild(startMenu);
    this.startMenuElement = startMenu;

    // 监听任务栏开始按钮点击 → 切换开始菜单
    if (this.taskbarElement) {
      this.taskbarElement.addEventListener('startmenu-toggle', () => {
        const visible = startMenu.style.display === 'block';
        startMenu.style.display = visible ? 'none' : 'block';
      });
    }
  }

  // ===== Step 8: 应用系统主题 =====
  private _applySystemTheme(): void {
    const root = document.documentElement;
    root.style.setProperty('--sys-taskbar-height', '48px');
    root.style.setProperty('--sys-font-mono', "'Courier New', 'Consolas', monospace");
    root.style.setProperty('--sys-font-ui', "'Segoe UI', system-ui, -apple-system, sans-serif");
    root.style.setProperty('--sys-font-size-sm', '12px');
    root.style.setProperty('--sys-font-size-md', '14px');
    root.style.setProperty('--sys-font-size-lg', '16px');
    root.style.setProperty('--sys-accent', '#8ab4f8');
    root.style.setProperty('--sys-accent-hover', '#aecbfa');
    root.style.setProperty('--sys-warning', '#fdd663');
    root.style.setProperty('--sys-danger', '#f28b82');
    root.style.setProperty('--sys-success', '#81c995');
    root.style.setProperty('--sys-transition-fast', '100ms ease');
    root.style.setProperty('--sys-transition-normal', '200ms ease');
    root.style.setProperty('--sys-transition-slow', '350ms ease');

    // 检测暗色模式
    if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
      root.setAttribute('data-theme', 'dark');
    }
  }

  // ===== Step 9: 启动终端 =====
  private async _launchTerminal(): Promise<void> {
    try {
      // 通过 WindowManager 创建终端窗口（作为内置应用窗口）
      const wm = this.WindowManager?.instance;
      if (wm) {
        const windowId = wm.createWindow({
          title: 'Terminal',
          width: 700,
          height: 450,
          x: Math.max(0, (window.innerWidth - 700) / 2),
          y: Math.max(0, (window.innerHeight - 450) / 2),
          appId: 'terminal',
          resizable: true,
          minimizable: true,
          maximizable: true,
          closable: true,
        });

        if (windowId) {
          // 创建终端窗口 DOM 元素
          const terminalWindow = document.createElement('nt-terminal-window');
          terminalWindow.id = `terminal-window-${windowId}`;
          terminalWindow.style.cssText = `
            position: absolute;
            width: 100%;
            height: 100%;
            z-index: 10;
          `;
          // 终端窗口作为独立弹窗，放到 appRoot 中
          this.appRoot!.appendChild(terminalWindow);
        }
      }
    } catch (err) {
      console.warn('[UIMain] Failed to launch terminal:', err);
    }
  }

  // ===== 公共方法 =====

  /**
   * 获取系统状态
   */
  getSystemStatus(): SystemStatus {
    return {
      overall: this.status.overall,
      steps: { ...this.status.steps },
      errors: [...this.status.errors],
    };
  }

  /**
   * 全局错误处理
   */
  handleError(error: Error): void {
    console.error('[UIMain] Error:', error.message);
    this.status.errors.push(error.message);
    if (this.status.errors.length > 50) {
      this.status.errors = this.status.errors.slice(-50);
    }
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('webnt-system-error', {
        detail: { message: error.message, timestamp: Date.now() },
      }));
    }
  }

  /**
   * 关机
   * 【对接内核】SysCallBridge.call('NtShutdown')
   */
  async shutdown(): Promise<void> {
    console.log('[UIMain] Shutting down...');
    try {
      await this.SysCallBridge?.instance?.call('NtShutdown');
    } catch (e) { /* ignore */ }
    this._cleanup();
    this.status.overall = 'shutdown';
    window.dispatchEvent(new CustomEvent('webnt-system-shutdown'));
  }

  /**
   * 重启
   * 【对接内核】SysCallBridge.call('NtReboot')
   */
  async reboot(): Promise<void> {
    console.log('[UIMain] Rebooting...');
    try {
      await this.SysCallBridge?.instance?.call('NtReboot');
    } catch (e) { /* ignore */ }
    this._cleanup();
    this.status = {
      overall: 'initializing',
      steps: {},
      errors: [],
    };
    this.initialized = false;
    await this.init();
  }

  // ===== 清理 =====
  private _cleanup(): void {
    [this.desktopElement, this.taskbarElement, this.startMenuElement].forEach(el => {
      if (el) el.remove();
    });
    this.desktopElement = null;
    this.taskbarElement = null;
    this.startMenuElement = null;
  }
}

export default UIMain;