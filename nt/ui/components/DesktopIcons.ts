/**
 * DesktopIcons — Desktop icon management for the WebNT-HTML5 Web OS Kernel.
 * Manages icon positions, selection state, and app launching.
 *
 * 【对接内核】All rendering is done through GlobalDisplay.API.
 * 【对接内核】App launching is done through WindowManager.createWindow().
 */

import GlobalDisplayAPI from '../../subsystem/display-pipeline/GlobalDisplay.API.js';
import WindowManager from '../../subsystem/window-manager/WindowManager.Core.js';

export interface IconDefinition {
  id: string;
  name: string;
  icon: string;
  appId: string;
  x: number;
  y: number;
  selected: boolean;
}

const ICON_WIDTH = 80;
const ICON_HEIGHT = 96;
const GRID_COL = ICON_WIDTH;
const GRID_ROW = ICON_HEIGHT + 8;

const STORAGE_KEY = 'webnt-desktop-icons';

export class DesktopIcons {
  private icons: Map<string, IconDefinition> = new Map();
  private layerId: string | null = null;
  private desktopWidth: number = 1920;
  private desktopHeight: number = 1080;
  private iconSize: number = 48;
  private columns: number = 8;

  constructor() {
    this.loadLayout();
  }

  setLayerId(layerId: string): void {
    this.layerId = layerId;
  }

  setDesktopDimensions(width: number, height: number): void {
    this.desktopWidth = width;
    this.desktopHeight = height;
    this.columns = Math.max(1, Math.floor(width / GRID_COL));
  }

  setIconSize(size: number): void {
    this.iconSize = size;
  }

  addIcon(icon: IconDefinition): void {
    this.icons.set(icon.id, { ...icon });
  }

  removeIcon(id: string): void {
    this.icons.delete(id);
  }

  moveIcon(id: string, x: number, y: number): void {
    const icon = this.icons.get(id);
    if (!icon) return;
    icon.x = Math.max(0, Math.min(x, this.desktopWidth - ICON_WIDTH));
    icon.y = Math.max(0, Math.min(y, this.desktopHeight - ICON_HEIGHT));
  }

  selectIcon(id: string): void {
    const icon = this.icons.get(id);
    if (!icon) return;
    icon.selected = true;
  }

  deselectAll(): void {
    for (const icon of this.icons.values()) {
      icon.selected = false;
    }
  }

  getSelectedIcons(): IconDefinition[] {
    const selected: IconDefinition[] = [];
    for (const icon of this.icons.values()) {
      if (icon.selected) {
        selected.push({ ...icon });
      }
    }
    return selected;
  }

  getIconAt(x: number, y: number): IconDefinition | null {
    for (const icon of this.icons.values()) {
      if (
        x >= icon.x &&
        x <= icon.x + ICON_WIDTH &&
        y >= icon.y &&
        y <= icon.y + ICON_HEIGHT
      ) {
        return icon;
      }
    }
    return null;
  }

  /**
   * 【对接内核】Launch the app associated with the icon.
   * Calls WindowManager.createWindow() to create the appropriate app window.
   */
  launchIcon(id: string): string | null {
    const icon = this.icons.get(id);
    if (!icon) return null;

    const wm = WindowManager.instance;
    let windowId: string | null = null;

    switch (icon.appId) {
      case 'terminal':
        windowId = wm.createWindow({
          title: 'Terminal',
          width: 720,
          height: 480,
          icon: 'terminal',
          appId: 'terminal',
          resizable: true,
        });
        break;

      case 'explorer':
        windowId = wm.createWindow({
          title: 'File Explorer',
          width: 800,
          height: 560,
          icon: 'folder',
          appId: 'explorer',
          resizable: true,
        });
        break;

      case 'settings':
        windowId = wm.createWindow({
          title: 'Settings',
          width: 700,
          height: 520,
          icon: 'gear',
          appId: 'settings',
          resizable: true,
        });
        break;

      case 'notepad':
        windowId = wm.createWindow({
          title: 'Notepad',
          width: 640,
          height: 480,
          icon: 'document',
          appId: 'notepad',
          resizable: true,
        });
        break;

      case 'webview':
        windowId = wm.createWindow({
          title: 'Web View',
          width: 900,
          height: 600,
          icon: 'globe',
          appId: 'webview',
          resizable: true,
        });
        break;

      case 'computer':
        windowId = wm.createWindow({
          title: 'System Info',
          width: 500,
          height: 400,
          icon: 'monitor',
          appId: 'computer',
          resizable: false,
        });
        break;

      case 'recyclebin':
        windowId = wm.createWindow({
          title: 'Recycle Bin',
          width: 600,
          height: 420,
          icon: 'bin',
          appId: 'recyclebin',
          resizable: true,
        });
        break;

      default:
        windowId = wm.createWindow({
          title: icon.name,
          width: 600,
          height: 400,
          icon: icon.icon,
          appId: icon.appId,
          resizable: true,
        });
        break;
    }

    return windowId;
  }

  saveLayout(): void {
    const layout: { id: string; x: number; y: number }[] = [];
    for (const icon of this.icons.values()) {
      layout.push({ id: icon.id, x: icon.x, y: icon.y });
    }
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(layout));
    } catch {
      // localStorage not available
    }
  }

  loadLayout(): void {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const layout = JSON.parse(raw) as { id: string; x: number; y: number }[];
        for (const entry of layout) {
          const icon = this.icons.get(entry.id);
          if (icon) {
            icon.x = entry.x;
            icon.y = entry.y;
          }
        }
      }
    } catch {
      // Ignore parse errors
    }
  }

  getIcons(): IconDefinition[] {
    return [...this.icons.values()].map((i) => ({ ...i }));
  }

  getIconCount(): number {
    return this.icons.size;
  }

  /**
   * 【对接内核】Render all icons to the desktop layer using GlobalDisplay.API.
   */
  render(): void {
    if (!this.layerId) return;
    const display = GlobalDisplayAPI.instance;

    // Clear the icon area on the layer
    for (const icon of this.icons.values()) {
      display.clearLayer(this.layerId);
      // Icons are rendered individually by the Desktop component
      // which calls drawIcon for each icon
    }
  }

  /**
   * 【对接内核】Draw a single icon on the display layer.
   */
  drawIcon(
    id: string,
    iconElement: HTMLElement,
    onDraw: (icon: IconDefinition) => void
  ): void {
    const icon = this.icons.get(id);
    if (!icon || !this.layerId) return;
    onDraw(icon);
  }
}

export default DesktopIcons;