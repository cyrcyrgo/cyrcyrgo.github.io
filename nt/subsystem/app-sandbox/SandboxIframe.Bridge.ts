/**
 * SandboxIframeBridge - Sandboxed iframe bridge for the WebNT-HTML5 Web OS Kernel.
 * Creates isolated sandbox environments for running applications.
 */

export enum MessageType {
  REQUEST = 'REQUEST',
  RESPONSE = 'RESPONSE',
  EVENT = 'EVENT',
  HANDSHAKE = 'HANDSHAKE',
  ERROR = 'ERROR',
}

export interface SandboxMessage {
  type: MessageType;
  id: string;
  method?: string;
  payload?: any;
  error?: string;
  timestamp: number;
}

export interface SandboxInfo {
  sandboxId: string;
  appId: string;
  iframe: HTMLIFrameElement;
  ready: boolean;
  handshakeTimeout: ReturnType<typeof setTimeout> | null;
}

export interface AppManifest {
  name: string;
  version: string;
  entry: string;
  icon?: string;
  permissions?: string[];
  width?: number;
  height?: number;
}

let _instance: SandboxIframeBridge | null = null;

export class SandboxIframeBridge {
  private sandboxes: Map<string, SandboxInfo> = new Map();
  private messageCallbacks: Map<string, Set<(msg: SandboxMessage) => void>> = new Map();
  private idCounter: number = 0;
  private readonly HANDSHAKE_TIMEOUT = 5000;
  private readonly ALLOWED_ORIGIN = '*';

  static get instance(): SandboxIframeBridge {
    if (!_instance) {
      _instance = new SandboxIframeBridge();
    }
    return _instance;
  }

  private constructor() {
    if (typeof window !== 'undefined') {
      window.addEventListener('message', this.handleGlobalMessage);
    }
  }

  private generateSandboxId(): string {
    this.idCounter++;
    return `sbx_${Date.now()}_${this.idCounter}`;
  }

  private generateMessageId(): string {
    return `msg_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  }

  createSandbox(
    appId: string,
    manifest: AppManifest,
    container: HTMLElement
  ): { iframe: HTMLIFrameElement; sandboxId: string } {
    const sandboxId = this.generateSandboxId();
    const iframe = document.createElement('iframe');

    iframe.style.width = `${manifest.width ?? 800}px`;
    iframe.style.height = `${manifest.height ?? 600}px`;
    iframe.style.border = 'none';
    iframe.style.overflow = 'hidden';
    iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin');
    iframe.setAttribute('allow', 'camera; microphone; geolocation');

    // Build srcdoc with handshake script
    const srcdoc = this.buildSandboxHTML(appId, sandboxId, manifest);
    iframe.srcdoc = srcdoc;

    const info: SandboxInfo = {
      sandboxId,
      appId,
      iframe,
      ready: false,
      handshakeTimeout: setTimeout(() => {
        if (!info.ready) {
          info.ready = true;
          this.notifyError(sandboxId, 'Handshake timeout');
        }
      }, this.HANDSHAKE_TIMEOUT),
    };

    this.sandboxes.set(sandboxId, info);
    container.appendChild(iframe);

    return { iframe, sandboxId };
  }

  sendToSandbox(sandboxId: string, message: Partial<SandboxMessage>): void {
    const sandbox = this.sandboxes.get(sandboxId);
    if (!sandbox) {
      console.warn(`SandboxIframeBridge: Sandbox ${sandboxId} not found`);
      return;
    }

    const msg: SandboxMessage = {
      type: message.type ?? MessageType.REQUEST,
      id: message.id ?? this.generateMessageId(),
      method: message.method,
      payload: message.payload,
      timestamp: Date.now(),
    };

    if (sandbox.iframe.contentWindow) {
      sandbox.iframe.contentWindow.postMessage(msg, this.ALLOWED_ORIGIN);
    }
  }

  onSandboxMessage(
    sandboxId: string,
    callback: (msg: SandboxMessage) => void
  ): void {
    if (!this.messageCallbacks.has(sandboxId)) {
      this.messageCallbacks.set(sandboxId, new Set());
    }
    this.messageCallbacks.get(sandboxId)!.add(callback);
  }

  offSandboxMessage(
    sandboxId: string,
    callback: (msg: SandboxMessage) => void
  ): void {
    const set = this.messageCallbacks.get(sandboxId);
    if (set) {
      set.delete(callback);
    }
  }

  destroySandbox(sandboxId: string): void {
    const sandbox = this.sandboxes.get(sandboxId);
    if (!sandbox) {
      console.warn(`SandboxIframeBridge: Sandbox ${sandboxId} not found`);
      return;
    }

    if (sandbox.handshakeTimeout) {
      clearTimeout(sandbox.handshakeTimeout);
    }

    if (sandbox.iframe.parentNode) {
      sandbox.iframe.parentNode.removeChild(sandbox.iframe);
    }

    this.sandboxes.delete(sandboxId);
    this.messageCallbacks.delete(sandboxId);
  }

  getSandboxInfo(sandboxId: string): SandboxInfo | null {
    return this.sandboxes.get(sandboxId) ?? null;
  }

  getAllSandboxes(): SandboxInfo[] {
    return [...this.sandboxes.values()];
  }

  private handleGlobalMessage = (event: MessageEvent): void => {
    const msg = event.data as SandboxMessage;
    if (!msg || !msg.type || !msg.id) return;

    // Find which sandbox this message belongs to
    for (const [sandboxId, sandbox] of this.sandboxes) {
      if (sandbox.iframe.contentWindow === event.source) {
        if (msg.type === MessageType.HANDSHAKE) {
          this.handleHandshake(sandboxId, sandbox);
        }

        const callbacks = this.messageCallbacks.get(sandboxId);
        if (callbacks) {
          for (const cb of callbacks) {
            try {
              cb(msg);
            } catch (err) {
              console.error(`SandboxIframeBridge: Error in callback for ${sandboxId}:`, err);
            }
          }
        }
        return;
      }
    }
  };

  private handleHandshake(sandboxId: string, sandbox: SandboxInfo): void {
    if (sandbox.handshakeTimeout) {
      clearTimeout(sandbox.handshakeTimeout);
      sandbox.handshakeTimeout = null;
    }
    sandbox.ready = true;

    this.sendToSandbox(sandboxId, {
      type: MessageType.HANDSHAKE,
      payload: {
        sandboxId,
        appId: sandbox.appId,
        status: 'ready',
        apis: ['nt.fs', 'nt.display', 'nt.sys', 'nt.net'],
      },
    });
  }

  private notifyError(sandboxId: string, error: string): void {
    const callbacks = this.messageCallbacks.get(sandboxId);
    if (callbacks) {
      for (const cb of callbacks) {
        try {
          cb({
            type: MessageType.ERROR,
            id: this.generateMessageId(),
            error,
            timestamp: Date.now(),
          });
        } catch (err) {
          console.error(`SandboxIframeBridge: Error in error callback:`, err);
        }
      }
    }
  }

  private buildSandboxHTML(
    appId: string,
    sandboxId: string,
    manifest: AppManifest
  ): string {
    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>${manifest.name}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: system-ui, sans-serif; overflow: hidden; }
  </style>
</head>
<body>
  <script>
    (function() {
      var bridge = window.parent;
      var ready = false;

      function send(msg) {
        bridge.postMessage(msg, '*');
      }

      function generateId() {
        return 'msg_' + Date.now() + '_' + Math.random().toString(36).slice(2, 9);
      }

      // Send handshake
      send({
        type: 'HANDSHAKE',
        id: generateId(),
        payload: {
          appId: '${appId}',
          sandboxId: '${sandboxId}',
          version: '${manifest.version}',
        },
        timestamp: Date.now()
      });

      // Listen for parent messages
      window.addEventListener('message', function(event) {
        var msg = event.data;
        if (!msg || !msg.type) return;

        if (msg.type === 'HANDSHAKE' && msg.payload && msg.payload.status === 'ready') {
          ready = true;
          window.__NT_SANDBOX_READY__ = true;
          window.__NT_APIS__ = msg.payload.apis || [];
        }

        if (msg.type === 'REQUEST' && msg.method) {
          handleRequest(msg);
        }
      });

      function handleRequest(msg) {
        if (msg.method === 'nt.getInfo') {
          send({
            type: 'RESPONSE',
            id: msg.id,
            payload: {
              appId: '${appId}',
              sandboxId: '${sandboxId}',
              name: '${manifest.name}',
              version: '${manifest.version}',
            },
            timestamp: Date.now()
          });
        } else {
          send({
            type: 'ERROR',
            id: msg.id,
            error: 'Unknown method: ' + msg.method,
            timestamp: Date.now()
          });
        }
      }

      window.__NT_SEND__ = function(method, payload) {
        send({
          type: 'REQUEST',
          id: generateId(),
          method: method,
          payload: payload,
          timestamp: Date.now()
        });
      };

      window.__NT_ON__ = function(callback) {
        window.addEventListener('message', function(event) {
          if (event.data && event.data.type === 'REQUEST') {
            callback(event.data);
          }
        });
      };
    })();
  </script>
</body>
</html>`;
  }
}

export default SandboxIframeBridge;