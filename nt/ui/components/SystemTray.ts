/**
 * SystemTray.ts — System Tray controller for the WebNT-HTML5 Web OS Kernel.
 * Singleton controller that manages the system tray area (clock, network, volume, notifications).
 *
 * 【对接内核】Network status via SysCallBridge.call('NtGetSystemInfo').
 * 【对接内核】Volume control via Web Audio API.
 */

import SysCallBridge from '../../kernel/syscall/SysCall.Bridge.js';

export interface NotificationItem {
  id: string;
  title: string;
  message: string;
  type: 'info' | 'warning' | 'error';
  timestamp: number;
}

export interface NetworkInfo {
  status: string;
  adapterName: string;
  ipAddress: string;
  connected: boolean;
}

let _instance: SystemTray | null = null;

export class SystemTray {
  private container: HTMLElement | null = null;
  private clockInterval: ReturnType<typeof setInterval> | null = null;
  private clockElement: HTMLElement | null = null;
  private dateElement: HTMLElement | null = null;
  private notifications: NotificationItem[] = [];
  private notificationCount: number = 0;
  private volumeLevel: number = 50;
  private activeFlyout: string | null = null;
  private initialized: boolean = false;
  private showDate: boolean = false;
  private audioContext: AudioContext | null = null;
  private gainNode: GainNode | null = null;

  static get instance(): SystemTray {
    if (!_instance) {
      _instance = new SystemTray();
    }
    return _instance;
  }

  private constructor() {}

  /**
   * Initialize the system tray with the given container element.
   * The container should be the tray area inside <nt-taskbar>.
   */
  init(container: HTMLElement): void {
    if (this.initialized) return;

    this.container = container;
    this._findElements();
    this._bindTrayEvents();
    this.updateClock();
    this.startClock();
    this._initAudio();
    this.initialized = true;
  }

  /**
   * Destroy the system tray, cleaning up intervals and listeners.
   */
  destroy(): void {
    this.stopClock();
    this._unbindTrayEvents();
    this.clockInterval = null;
    this.container = null;
    this.initialized = false;
  }

  /* ── Element Discovery ── */

  private _findElements(): void {
    if (!this.container) return;

    this.clockElement = this.container.querySelector('#clock-time') || this.container.querySelector('.time');
    this.dateElement = this.container.querySelector('#clock-date') || this.container.querySelector('.date');
  }

  /* ── Event Binding ── */

  private _bindTrayEvents(): void {
    if (!this.container) return;

    // Network icon
    const netBtn = this.container.querySelector('#tray-network');
    if (netBtn) {
      netBtn.addEventListener('click', (e) => this.toggleFlyout('network'));
    }

    // Volume icon
    const volBtn = this.container.querySelector('#tray-volume');
    if (volBtn) {
      volBtn.addEventListener('click', (e) => this.toggleFlyout('volume'));
    }

    // Notification icon
    const notifBtn = this.container.querySelector('#tray-notification');
    if (notifBtn) {
      notifBtn.addEventListener('click', (e) => this.toggleFlyout('notification'));
    }

    // Clock
    const clockBtn = this.container.querySelector('#tray-clock');
    if (clockBtn) {
      clockBtn.addEventListener('click', () => this._toggleClockDate());
    }

    // Volume slider
    const volSlider = this.container.querySelector('#volume-slider');
    if (volSlider) {
      volSlider.addEventListener('input', (e: Event) => {
        const val = parseInt((e.target as HTMLInputElement).value, 10);
        this._setVolume(val);
      });
    }

    // Clear notifications
    const clearBtn = this.container.querySelector('#clear-notifications');
    if (clearBtn) {
      clearBtn.addEventListener('click', () => this.clearNotifications());
    }

    // Click outside to close flyouts
    document.addEventListener('mousedown', (e) => this._onClickOutside(e));
  }

  private _unbindTrayEvents(): void {
    // Event listeners on DOM elements will be cleaned up when the container is removed.
    // Document-level listeners:
    document.removeEventListener('mousedown', (e) => this._onClickOutside(e));
  }

  /* ── Clock ── */

  /**
   * Start the clock update interval (1-second tick).
   */
  startClock(): void {
    if (this.clockInterval) return;
    this.updateClock();
    this.clockInterval = setInterval(() => this.updateClock(), 1000);
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

  /**
   * Update the clock display to the current time.
   */
  updateClock(): void {
    const now = new Date();
    const timeStr = this._formatTime(now);
    const dateStr = this._formatDate(now);

    if (this.clockElement) {
      this.clockElement.textContent = timeStr;
    }
    if (this.dateElement) {
      this.dateElement.textContent = dateStr;
    }
  }

  private _formatTime(date: Date): string {
    const h = String(date.getHours()).padStart(2, '0');
    const m = String(date.getMinutes()).padStart(2, '0');
    return `${h}:${m}`;
  }

  private _formatDate(date: Date): string {
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const months = [
      'January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December',
    ];
    return `${days[date.getDay()]}, ${months[date.getMonth()]} ${date.getDate()}, ${date.getFullYear()}`;
  }

  private _toggleClockDate(): void {
    this.showDate = !this.showDate;
    const clockEl = this.container?.querySelector('#tray-clock');
    if (clockEl) {
      if (this.showDate) {
        clockEl.classList.add('show-date');
      } else {
        clockEl.classList.remove('show-date');
      }
    }
  }

  /* ── Flyout Management ── */

  /**
   * Toggle a flyout panel (network, volume, notification).
   */
  toggleFlyout(panel: string): void {
    if (!this.container) return;

    const flyout = this.container.querySelector(`#flyout-${panel}`) as HTMLElement;
    if (!flyout) return;

    if (this.activeFlyout === panel && flyout.classList.contains('visible')) {
      flyout.classList.remove('visible');
      this.activeFlyout = null;
      return;
    }

    // Hide all flyouts
    this._hideAllFlyouts();

    // Show the target flyout
    flyout.classList.add('visible');
    this.activeFlyout = panel;

    // Update content based on panel type
    switch (panel) {
      case 'network':
        this.showNetworkPanel();
        break;
      case 'volume':
        this.showVolumePanel();
        break;
      case 'notification':
        this.showNotificationPanel();
        break;
    }
  }

  private _hideAllFlyouts(): void {
    if (!this.container) return;
    const panels = ['network', 'volume', 'notification'];
    for (const p of panels) {
      const el = this.container.querySelector(`#flyout-${p}`) as HTMLElement;
      if (el) el.classList.remove('visible');
    }
    this.activeFlyout = null;
  }

  private _onClickOutside(e: MouseEvent): void {
    if (!this.activeFlyout || !this.container) return;
    const path = e.composedPath();
    const flyout = this.container.querySelector(`#flyout-${this.activeFlyout}`);
    if (flyout && !path.includes(flyout)) {
      const trigger = this.container.querySelector(`#tray-${this.activeFlyout}`);
      if (trigger && !path.includes(trigger)) {
        this._hideAllFlyouts();
      }
    }
  }

  /* ── 【对接内核】Network Panel ── */

  /**
   * Show the network information panel with current connection details.
   */
  async showNetworkPanel(): Promise<void> {
    if (!this.container) return;

    const netInfo = await this._getNetworkInfo();

    const statusEl = this.container.querySelector('#net-status');
    const adapterEl = this.container.querySelector('#net-adapter');
    const ipEl = this.container.querySelector('#net-ip');

    if (statusEl) statusEl.textContent = netInfo.status;
    if (adapterEl) adapterEl.textContent = netInfo.adapterName;
    if (ipEl) ipEl.textContent = netInfo.ipAddress;
  }

  /**
   * 【对接内核】Retrieve network info via SysCallBridge.
   */
  private async _getNetworkInfo(): Promise<NetworkInfo> {
    try {
      const sysInfo = await SysCallBridge.instance.call('NtGetSystemInfo');
      return {
        status: 'Connected',
        adapterName: sysInfo?.arch || 'web',
        ipAddress: '127.0.0.1',
        connected: true,
      };
    } catch {
      return {
        status: 'Connected',
        adapterName: 'loopback',
        ipAddress: '127.0.0.1',
        connected: true,
      };
    }
  }

  /* ── Volume Panel ── */

  /**
   * Show the volume control panel with the current volume level.
   */
  showVolumePanel(): void {
    if (!this.container) return;

    const levelEl = this.container.querySelector('#vol-level');
    const sliderEl = this.container.querySelector('#volume-slider') as HTMLInputElement;

    if (levelEl) levelEl.textContent = `${this.volumeLevel}%`;
    if (sliderEl) sliderEl.value = String(this.volumeLevel);
  }

  /**
   * Initialize the Web Audio API context for volume control.
   */
  private _initAudio(): void {
    try {
      this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      this.gainNode = this.audioContext.createGain();
      this.gainNode.gain.value = this.volumeLevel / 100;
      this.gainNode.connect(this.audioContext.destination);
    } catch {
      // Audio API not available
      this.audioContext = null;
      this.gainNode = null;
    }
  }

  /**
   * Set the volume level (0-100).
   */
  private _setVolume(level: number): void {
    this.volumeLevel = Math.max(0, Math.min(100, level));

    if (this.gainNode && this.audioContext) {
      this.gainNode.gain.value = this.volumeLevel / 100;
    }

    // Update display if volume panel is visible
    if (this.container) {
      const levelEl = this.container.querySelector('#vol-level');
      if (levelEl) levelEl.textContent = `${this.volumeLevel}%`;
    }
  }

  /**
   * Get the current volume level.
   */
  getVolume(): number {
    return this.volumeLevel;
  }

  /**
   * Set the volume level programmatically.
   */
  setVolume(level: number): void {
    this._setVolume(level);
  }

  /* ── Notification Panel ── */

  /**
   * Show the notification list panel.
   */
  showNotificationPanel(): void {
    if (!this.container) return;

    const list = this.container.querySelector('#notification-list');
    if (!list) return;

    if (this.notifications.length === 0) {
      list.innerHTML = '<div style="text-align:center;opacity:0.5;padding:16px;">No notifications</div>';
      return;
    }

    list.innerHTML = '';
    for (const notif of this.notifications) {
      const item = document.createElement('div');
      item.className = `notification-item ${notif.type}`;
      item.innerHTML = `
        <div class="notification-title">${this._escapeHtml(notif.title)}</div>
        <div class="notification-message">${this._escapeHtml(notif.message)}</div>
      `;
      list.appendChild(item);
    }
  }

  /**
   * Add a notification to the system tray.
   */
  addNotification(title: string, message: string, type: 'info' | 'warning' | 'error' = 'info'): string {
    const id = `notif-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const notification: NotificationItem = {
      id,
      title,
      message,
      type,
      timestamp: Date.now(),
    };

    this.notifications.unshift(notification);
    this.notificationCount++;

    // Update badge
    this._updateNotificationBadge();

    // Re-render if notification panel is open
    if (this.activeFlyout === 'notification') {
      this.showNotificationPanel();
    }

    return id;
  }

  /**
   * Clear all notifications.
   */
  clearNotifications(): void {
    this.notifications = [];
    this.notificationCount = 0;
    this._updateNotificationBadge();

    if (this.activeFlyout === 'notification') {
      this.showNotificationPanel();
    }
  }

  /**
   * Remove a specific notification by ID.
   */
  removeNotification(id: string): void {
    const idx = this.notifications.findIndex((n) => n.id === id);
    if (idx !== -1) {
      this.notifications.splice(idx, 1);
      this.notificationCount = Math.max(0, this.notificationCount - 1);
      this._updateNotificationBadge();

      if (this.activeFlyout === 'notification') {
        this.showNotificationPanel();
      }
    }
  }

  /**
   * Get all notifications.
   */
  getNotifications(): NotificationItem[] {
    return [...this.notifications];
  }

  private _updateNotificationBadge(): void {
    if (!this.container) return;
    const badge = this.container.querySelector('#notification-badge');
    if (badge) {
      if (this.notificationCount > 0) {
        badge.classList.add('visible');
      } else {
        badge.classList.remove('visible');
      }
    }
  }

  /* ── Utility ── */

  private _escapeHtml(str: string): string {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  /**
   * Get the system tray container element.
   */
  getContainer(): HTMLElement | null {
    return this.container;
  }
}

export default SystemTray;