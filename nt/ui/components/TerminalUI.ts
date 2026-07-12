/**
 * TerminalUI.ts — Terminal UI logic for the WebNT-HTML5 Web OS Kernel.
 * Singleton controller that manages the <nt-terminal-window> custom element.
 *
 * 【对接内核】Command execution via TerminalExecutor.execute()
 * 【对接内核】Command parsing via TerminalLexer.tokenize()
 * 【对接内核】Command info via CommandRegistry.getCommand()
 */

import TerminalExecutor, { ExecutionContext } from '../../kernel/terminal/Terminal.Executor.js';
import TerminalLexer, { TokenType } from '../../kernel/terminal/Terminal.Lexer.js';
import CommandRegistry from '../../kernel/terminal/Terminal.CommandRegistry.js';
import WindowManager from '../../subsystem/window-manager/WindowManager.Core.js';

export interface TabInfo {
  tabId: string;
  name: string;
  outputBuffer: string[];
  history: string[];
  cwd: string;
  env: Record<string, string>;
  createdAt: number;
}

let _instance: TerminalUI | null = null;

export class TerminalUI {
  private terminalElement: HTMLElement | null = null;
  private windowId: string | null = null;
  private tabs: Map<string, TabInfo> = new Map();
  private activeTabId: string | null = null;
  private initialized: boolean = false;

  static get instance(): TerminalUI {
    if (!_instance) {
      _instance = new TerminalUI();
    }
    return _instance;
  }

  private constructor() {}

  /**
   * Initialize the terminal UI, create a terminal window, and register with WindowManager.
   * 【对接内核】Registers a window with WindowManager.createWindow().
   */
  init(): void {
    if (this.initialized) return;

    this.initialized = true;

    // Create the terminal window via WindowManager
    const wm = WindowManager.instance;
    this.windowId = wm.createWindow({
      title: 'Terminal',
      width: 720,
      height: 480,
      icon: 'terminal',
      appId: 'terminal',
      resizable: true,
    });

    // Create the terminal element
    this.terminalElement = document.createElement('nt-terminal-window');
    this.terminalElement.setAttribute('data-window-id', this.windowId);
    document.body.appendChild(this.terminalElement);

    // Create the initial tab
    this.createTab('tab1');
  }

  /**
   * Create a new terminal tab.
   * @param name - Tab name
   * @returns The tab ID
   */
  createTab(name: string): string {
    const tabId = `term-tab-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

    const tabInfo: TabInfo = {
      tabId,
      name,
      outputBuffer: [],
      history: [],
      cwd: '/',
      env: {
        HOME: '/root',
        USER: 'webnt',
        PATH: '/bin:/usr/bin',
        SHELL: '/bin/sh',
        TERM: 'xterm-256color',
      },
      createdAt: Date.now(),
    };

    this.tabs.set(tabId, tabInfo);
    this.activeTabId = tabId;

    // Delegate to the DOM element
    if (this.terminalElement && typeof (this.terminalElement as any).createTab === 'function') {
      (this.terminalElement as any).createTab(name);
    }

    return tabId;
  }

  /**
   * Close a terminal tab.
   * @param tabId - The tab ID to close
   */
  closeTab(tabId: string): void {
    if (!this.tabs.has(tabId)) return;

    this.tabs.delete(tabId);

    if (this.activeTabId === tabId) {
      const remaining = [...this.tabs.keys()];
      this.activeTabId = remaining.length > 0 ? remaining[remaining.length - 1] : null;
    }

    if (this.terminalElement && typeof (this.terminalElement as any).closeTab === 'function') {
      (this.terminalElement as any).closeTab(tabId);
    }

    // If no tabs remain, close the terminal window
    if (this.tabs.size === 0 && this.windowId) {
      WindowManager.instance.destroyWindow(this.windowId);
      this.windowId = null;
    }
  }

  /**
   * Switch to a specific terminal tab.
   * @param tabId - The tab ID to switch to
   */
  switchTab(tabId: string): void {
    if (!this.tabs.has(tabId)) return;
    this.activeTabId = tabId;

    if (this.terminalElement && typeof (this.terminalElement as any).switchTab === 'function') {
      (this.terminalElement as any).switchTab(tabId);
    }
  }

  /**
   * 【对接内核】Execute a command in a specific tab.
   * @param command - The command line to execute
   * @param tabId - The tab ID (optional, defaults to active tab)
   */
  async executeCommand(command: string, tabId?: string): Promise<void> {
    const targetTabId = tabId || this.activeTabId;
    if (!targetTabId) return;

    const tab = this.tabs.get(targetTabId);
    if (!tab) return;

    // Add to history
    tab.history.push(command);
    if (tab.history.length > 500) {
      tab.history.shift();
    }

    // Delegate execution to the DOM element
    if (this.terminalElement && typeof (this.terminalElement as any).executeCommand === 'function') {
      await (this.terminalElement as any).executeCommand(command, targetTabId);
    } else {
      // Fallback: execute directly via kernel
      try {
        const executor = TerminalExecutor.instance;
        const result = await executor.execute(command, {
          env: { ...tab.env },
          cwd: tab.cwd,
        });

        if (result.output) {
          tab.outputBuffer.push(result.output);
          this.writeOutput(targetTabId, result.output, result.exitCode === 0 ? 'normal' : 'error');
        }
      } catch (err: any) {
        this.writeOutput(targetTabId, `Error: ${err.message || 'Unknown error'}`, 'error');
      }
    }
  }

  /**
   * Get command history for a tab.
   * @param tabId - The tab ID (optional, defaults to active tab)
   * @returns Command history array
   */
  getHistory(tabId?: string): string[] {
    const targetTabId = tabId || this.activeTabId;
    if (!targetTabId) return [];

    const tab = this.tabs.get(targetTabId);
    return tab ? [...tab.history] : [];
  }

  /**
   * Clear the terminal screen for a tab.
   * @param tabId - The tab ID (optional, defaults to active tab)
   */
  clearScreen(tabId?: string): void {
    const targetTabId = tabId || this.activeTabId;
    if (!targetTabId) return;

    const tab = this.tabs.get(targetTabId);
    if (tab) {
      tab.outputBuffer = [];
    }

    if (this.terminalElement && typeof (this.terminalElement as any).clearScreen === 'function') {
      (this.terminalElement as any).clearScreen(targetTabId);
    }
  }

  /**
   * Write text to the terminal output.
   * @param tabId - The tab ID
   * @param text - The text to write
   * @param type - Output type: 'normal', 'error', 'success', 'warning', 'info'
   */
  writeOutput(tabId: string, text: string, type: 'normal' | 'error' | 'success' | 'warning' | 'info' = 'normal'): void {
    if (this.terminalElement && typeof (this.terminalElement as any).writeOutput === 'function') {
      (this.terminalElement as any).writeOutput(tabId, text, type);
    }
  }

  /**
   * 【对接内核】Handle tab completion for a given input.
   * Uses CommandRegistry.getCommand() to find matching commands.
   * @param input - The current input text
   * @param tabId - The tab ID
   * @returns Array of matching command names
   */
  handleTabComplete(input: string, tabId?: string): string[] {
    const targetTabId = tabId || this.activeTabId;
    if (!targetTabId) return [];

    const tokens = input.split(/\s+/);
    const currentWord = tokens[tokens.length - 1] || '';

    if (currentWord.length === 0) return [];

    // 【对接内核】Get all commands from CommandRegistry
    const registry = CommandRegistry.instance;
    const allCommands = registry.getAllCommands();

    const matches = allCommands
      .filter((cmd) => cmd.name.startsWith(currentWord))
      .map((cmd) => cmd.name);

    return matches;
  }

  /**
   * Set the current working directory for a tab.
   * @param tabId - The tab ID
   * @param cwd - The new working directory
   */
  setCwd(tabId: string, cwd: string): void {
    const tab = this.tabs.get(tabId);
    if (tab) {
      tab.cwd = cwd;
    }

    if (this.terminalElement && typeof (this.terminalElement as any).setCwd === 'function') {
      (this.terminalElement as any).setCwd(tabId, cwd);
    }
  }

  /**
   * Set an environment variable for a tab.
   * @param tabId - The tab ID
   * @param key - The variable name
   * @param value - The variable value
   */
  setEnv(tabId: string, key: string, value: string): void {
    const tab = this.tabs.get(tabId);
    if (tab) {
      tab.env[key] = value;
    }

    if (this.terminalElement && typeof (this.terminalElement as any).setEnv === 'function') {
      (this.terminalElement as any).setEnv(tabId, key, value);
    }
  }

  /**
   * Get tab info for a given tab ID.
   * @param tabId - The tab ID (optional, defaults to active tab)
   * @returns TabInfo or null
   */
  getTabInfo(tabId?: string): TabInfo | null {
    const targetTabId = tabId || this.activeTabId;
    if (!targetTabId) return null;

    const tab = this.tabs.get(targetTabId);
    return tab ? { ...tab, outputBuffer: [...tab.outputBuffer], history: [...tab.history], env: { ...tab.env } } : null;
  }

  /**
   * Get all tab IDs.
   * @returns Array of tab IDs
   */
  getAllTabIds(): string[] {
    return [...this.tabs.keys()];
  }

  /**
   * Get the active tab ID.
   * @returns The active tab ID or null
   */
  getActiveTabId(): string | null {
    return this.activeTabId;
  }

  /**
   * Get the DOM element for the terminal window.
   * @returns The terminal element or null
   */
  getElement(): HTMLElement | null {
    return this.terminalElement;
  }

  /**
   * Get the window manager window ID.
   * @returns The window ID or null
   */
  getWindowId(): string | null {
    return this.windowId;
  }

  /**
   * 【对接内核】Parse a command line using TerminalLexer.
   * @param commandLine - The command line to tokenize
   * @returns The parsed tokens
   */
  parseCommand(commandLine: string) {
    const lexer = TerminalLexer.instance;
    return lexer.tokenize(commandLine);
  }

  /**
   * 【对接内核】Get command info from CommandRegistry.
   * @param commandName - The command name
   * @returns Command definition or null
   */
  getCommandInfo(commandName: string) {
    const registry = CommandRegistry.instance;
    return registry.getCommand(commandName);
  }

  /**
   * Get all registered commands.
   * @returns Array of command definitions
   */
  getAllCommands() {
    const registry = CommandRegistry.instance;
    return registry.getAllCommands();
  }

  /**
   * Destroy the terminal UI and clean up resources.
   */
  destroy(): void {
    this.tabs.clear();
    this.activeTabId = null;

    if (this.terminalElement) {
      this.terminalElement.remove();
      this.terminalElement = null;
    }

    if (this.windowId) {
      WindowManager.instance.destroyWindow(this.windowId);
      this.windowId = null;
    }

    this.initialized = false;
  }
}

export default TerminalUI;