/**
 * DisplayEventHub - Display event system for the WebNT-HTML5 Web OS Kernel.
 * Centralizes input events from the DOM and dispatches them to consumers.
 */

export type DisplayEventType =
  | 'click'
  | 'dblclick'
  | 'mousedown'
  | 'mouseup'
  | 'mousemove'
  | 'keydown'
  | 'keyup'
  | 'resize'
  | 'focus'
  | 'blur';

export interface MousePosition {
  x: number;
  y: number;
  clientX: number;
  clientY: number;
}

export interface KeyboardState {
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
  meta: boolean;
  capsLock: boolean;
  numLock: boolean;
}

type EventCallback = (data: any) => void;

let _instance: DisplayEventHub | null = null;

export class DisplayEventHub {
  private handlers: Map<string, Set<EventCallback>> = new Map();
  private mousePos: MousePosition = { x: 0, y: 0, clientX: 0, clientY: 0 };
  private keyboardState: KeyboardState = {
    ctrl: false,
    alt: false,
    shift: false,
    meta: false,
    capsLock: false,
    numLock: false,
  };
  private keysDown: Set<string> = new Set();
  private boundElement: HTMLElement | null = null;
  private bound: boolean = false;

  static get instance(): DisplayEventHub {
    if (!_instance) {
      _instance = new DisplayEventHub();
    }
    return _instance;
  }

  private constructor() {}

  bind(element: HTMLElement): void {
    if (this.bound && this.boundElement) {
      this.unbind();
    }
    this.boundElement = element;
    this.bound = true;

    element.addEventListener('click', this.handleMouseEvent('click'));
    element.addEventListener('dblclick', this.handleMouseEvent('dblclick'));
    element.addEventListener('mousedown', this.handleMouseEvent('mousedown'));
    element.addEventListener('mouseup', this.handleMouseEvent('mouseup'));
    element.addEventListener('mousemove', this.handleMouseEvent('mousemove'));
    element.addEventListener('keydown', this.handleKeyEvent('keydown'));
    element.addEventListener('keyup', this.handleKeyEvent('keyup'));
    element.addEventListener('focus', this.handleFocusEvent('focus'));
    element.addEventListener('blur', this.handleFocusEvent('blur'));

    window.addEventListener('resize', this.handleResize);
  }

  unbind(): void {
    if (!this.boundElement || !this.bound) return;

    this.boundElement.removeEventListener('click', this.handleMouseEvent('click'));
    this.boundElement.removeEventListener('dblclick', this.handleMouseEvent('dblclick'));
    this.boundElement.removeEventListener('mousedown', this.handleMouseEvent('mousedown'));
    this.boundElement.removeEventListener('mouseup', this.handleMouseEvent('mouseup'));
    this.boundElement.removeEventListener('mousemove', this.handleMouseEvent('mousemove'));
    this.boundElement.removeEventListener('keydown', this.handleKeyEvent('keydown'));
    this.boundElement.removeEventListener('keyup', this.handleKeyEvent('keyup'));
    this.boundElement.removeEventListener('focus', this.handleFocusEvent('focus'));
    this.boundElement.removeEventListener('blur', this.handleFocusEvent('blur'));

    window.removeEventListener('resize', this.handleResize);

    this.bound = false;
    this.boundElement = null;
  }

  on(eventType: DisplayEventType, callback: EventCallback): void {
    if (!this.handlers.has(eventType)) {
      this.handlers.set(eventType, new Set());
    }
    this.handlers.get(eventType)!.add(callback);
  }

  off(eventType: DisplayEventType, callback: EventCallback): void {
    const set = this.handlers.get(eventType);
    if (set) {
      set.delete(callback);
    }
  }

  emit(eventType: DisplayEventType, data: any): void {
    const set = this.handlers.get(eventType);
    if (set) {
      for (const handler of set) {
        try {
          handler(data);
        } catch (err) {
          console.error(`DisplayEventHub: Error in handler for "${eventType}":`, err);
        }
      }
    }
  }

  getMousePosition(): MousePosition {
    return { ...this.mousePos };
  }

  getKeyboardState(): KeyboardState {
    return { ...this.keyboardState };
  }

  isKeyDown(key: string): boolean {
    return this.keysDown.has(key.toLowerCase());
  }

  private handleMouseEvent = (type: DisplayEventType) => {
    return (event: Event) => {
      const e = event as MouseEvent;
      this.mousePos = {
        x: e.offsetX,
        y: e.offsetY,
        clientX: e.clientX,
        clientY: e.clientY,
      };
      this.keyboardState = {
        ctrl: e.ctrlKey,
        alt: e.altKey,
        shift: e.shiftKey,
        meta: e.metaKey,
        capsLock: this.keyboardState.capsLock,
        numLock: this.keyboardState.numLock,
      };
      this.emit(type, {
        x: e.offsetX,
        y: e.offsetY,
        clientX: e.clientX,
        clientY: e.clientY,
        button: e.button,
        ctrlKey: e.ctrlKey,
        altKey: e.altKey,
        shiftKey: e.shiftKey,
        metaKey: e.metaKey,
        target: e.target,
      });
    };
  };

  private handleKeyEvent = (type: DisplayEventType) => {
    return (event: Event) => {
      const e = event as KeyboardEvent;
      if (type === 'keydown') {
        this.keysDown.add(e.key.toLowerCase());
      } else if (type === 'keyup') {
        this.keysDown.delete(e.key.toLowerCase());
      }

      this.keyboardState = {
        ctrl: e.ctrlKey,
        alt: e.altKey,
        shift: e.shiftKey,
        meta: e.metaKey,
        capsLock: e.getModifierState?.('CapsLock') ?? this.keyboardState.capsLock,
        numLock: e.getModifierState?.('NumLock') ?? this.keyboardState.numLock,
      };

      this.emit(type, {
        key: e.key,
        code: e.code,
        ctrlKey: e.ctrlKey,
        altKey: e.altKey,
        shiftKey: e.shiftKey,
        metaKey: e.metaKey,
        repeat: e.repeat,
        target: e.target,
      });
    };
  };

  private handleFocusEvent = (type: DisplayEventType) => {
    return (event: Event) => {
      this.emit(type, { target: (event as FocusEvent).target });
    };
  };

  private handleResize = (event: Event) => {
    this.emit('resize', {
      width: window.innerWidth,
      height: window.innerHeight,
    });
  };
}

export default DisplayEventHub;